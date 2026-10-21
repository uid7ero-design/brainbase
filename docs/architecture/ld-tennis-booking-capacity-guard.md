# LD Tennis booking capacity guard

Status: **prepared and safety-reviewed; not deployed; nothing applied to Production.** Separate from
the Scheduling & Bookings work. Owner approval is needed separately to merge, to deploy, and to apply
the one SQL migration to Production.

## 1. The defect

Every path that adds a booking to a session instance reads the live count, compares it with
`max_capacity`, and then INSERTs as separate statements with no lock. Concurrent requests for the
last place all succeed. Reproduced two ways:

| Evidence | Without the guard |
| --- | --- |
| Real Postgres 16 (Docker), the unmodified route handlers, capacity 2 or 3 | public booking 14 of 14 confirmed; staff enrol by name 12 of 12; from a contact 10 of 10; super_admin route 10 of 10; four paths together 14 of 16 for capacity 3; recurring propagation 8 of 8 into 1 free place |
| Real Neon (Postgres 17.11), `@neondatabase/serverless` HTTP driver, pooled host, capacity 5 | 30 of 30 confirmed |

A read-only aggregate on a snapshot of the production database found 233 session instances, none over
capacity and none exactly full, and 86 live instance bookings: no sign it has happened. The exposure is
real but unrealised.

## 2. The fix

`scripts/add-booking-capacity-guard.sql` adds one function and one `BEFORE INSERT` row trigger on
`bookings`. It takes a transaction-scoped advisory lock keyed on the instance id, counts live bookings
(`status != 'cancelled'`, the predicate every route uses) and refuses the insert with SQLSTATE `BKCAP`
when the instance is full. Inserts for one instance queue on the lock for milliseconds; other instances
do not contend. If it ever runs inside a `REPEATABLE READ` transaction it refuses with `BKISO` rather
than silently weaken the guarantee.

Why a trigger rather than an interactive transaction: the app's `sql` is the Neon **HTTP** driver, whose
`sql.transaction([...])` is a fixed batch (documented in `lib/tennisSchedule.ts`). Interactive
transactions need a second driver or Prisma plus re-plumbing every insert site, and a lock only protects
paths that take it. A trigger covers every writer, including future code and manual SQL, with the
existing driver. A single `INSERT … WHERE count < capacity`, and `SELECT … FOR UPDATE` inside one
statement, were rejected: under READ COMMITTED a statement sees one snapshot, so concurrent statements
still pass together. (Interactive transactions were verified to work on Neon too; see section 5.)

Application side (`lib/bookingCapacity.ts` and five call sites): a guard refusal is mapped to the
response each path **already** gives when its own pre-check finds the session full. Until the migration
is applied the error never occurs, so the code is inert.

| Path | On a guard refusal (same as its existing "full" answer) |
| --- | --- |
| `POST /api/tennis/book` (public) | 409 `{ error: 'This session is full' }`; the pipeline request created for the attempt is deleted |
| `POST /api/dashboard/sessions/[id]/instances/[instanceId]` | 409 `{ error: 'Session is full' }` |
| `POST /api/dashboard/enrolments` | 409 `{ error: 'Session is full' }` |
| `POST /api/bookings` (super_admin, instance booking) | 409 `{ error: 'Session instance is full' }` |
| `enrolLineageIntoInstance` (reconcile, weekly toggle, pause clear, generate) | outcome `capacity_blocked` (not `error`) |

## 3. Final safety review

| # | Question | Finding | Evidence |
| --- | --- | --- | --- |
| 1 | Locking and count semantics under READ COMMITTED | Correct. The advisory lock serialises inserts per instance; each statement in a PL/pgSQL function takes a fresh snapshot, so after the lock the count sees every committed row. Under `REPEATABLE READ` the count would be stale, so the guard refuses (`BKISO`); no booking path uses that level (only `ReadCommitted` or autocommit) | Docker: 20 of 20 tests; Neon: exactly 5 of 30 pooled and direct; `BKISO` test; isolation grep shows `RepeatableRead` is used only by unrelated Commercial budgeting code |
| 2 | Lock ordering and deadlock | The guard takes only the advisory lock and never a row lock, and no application transaction both writes bookings and updates instances/bookings, so no lock-ordering cycle can include it. The only multi-statement transactions that touch these tables are archive (`sql.transaction`: UPDATE sessions, bookings, instances; no insert) and the Prisma session DELETE (deletes only) | Docker: archive-style transaction racing inserts, 3 rounds, no `40P01`; Neon: concurrent UPDATEs and cancels with inserts, no deadlock |
| 3 | Cancellation handling | A booking counts only while `status != 'cancelled'`. Inserting an already-cancelled row is never refused. A cancel frees the place immediately for the next insert; a cancel racing inserts never lets the live count exceed capacity. No path re-activates a cancelled booking (verified by search and by a test that fails if one appears), so inserts are the only way a count grows | Docker cancel-race test (4 rounds); containment test over every `UPDATE bookings` statement |
| 4 | Advisory-lock key | `hashtextextended('booking_capacity:' \|\| instance_id, 0)`: one 64-bit key per instance, with a prefix no other lock in the application uses (others use different prefixes or the two-integer form, a separate key space). A hash collision could only make two instances queue behind each other; it cannot admit a wrong booking | grep of every `pg_advisory_*` use in the repository |
| 5 | All insertion paths protected | Exactly seven `INSERT INTO bookings` statements exist (repository-wide search, case-insensitive, including scripts and Prisma create calls). **Five** can write a `session_instance_id` and are guarded: `/api/tennis/book`, staff enrol by name, staff enrol from a contact, `/api/bookings` instance branch, and recurring propagation (`enrolLineageIntoInstance`, which reconcile, the weekly toggle, pause clear and generate all call). The other **two**, in the legacy super_admin branches of `/api/bookings`, do not write an instance id, so they cannot affect instance capacity (they have a separate, older session-level count with its own unguarded read-then-insert: super_admin only, no UI caller, out of scope and listed under residual risks). A test fails if a new insert site appears | `tests/containment/bookingCapacityGuard.test.ts` |
| 6 | Excludes cancelled consistently with the app | Same predicate (`status != 'cancelled'`) as the count in every route and in `enrolLineageIntoInstance`; the multi-path concurrency tests assert the route-visible and the DB count agree | Docker + mocked tests |
| 7 | Other triggers, constraints, transactions | Production's `bookings` has no other triggers (checked on the branch). Tested with a second `BEFORE INSERT` trigger that edits the row and an `AFTER INSERT` trigger that writes another table: both still run for exactly the admitted rows and capacity holds. Also tested: multi-row `INSERT … SELECT` into a nearly full instance (whole statement refused, nothing inserted), `ON CONFLICT DO NOTHING` (silent no-op when not full, refused `BKCAP` when full), the partial unique lineage index and both foreign keys | Docker safety suite |
| 8 | Rollback removes nothing unrelated | Exactly one trigger and one function are dropped. On the branch's real tables the object inventory (58 functions, 64 triggers, 211 tables, all indexes and constraints, as hashes) is identical before apply and after rollback, and +1 function/+1 trigger while applied | Neon branch, hashes before and after; Docker inventory test |
| 9 | Error mapping preserves API contracts | Every refusal returns the same status and JSON body the path's own "full" check returns; every other failure is unchanged (500 / `error` outcome) | mocked per-route tests + Docker response-body assertions |
| 10 | No payment or notification for a refused booking | None of the five insert-site files imports or calls any email, Stripe, Resend or notification code (search + a test that fails if one is added). The only follow-on writes (the internal pipeline message and the pipeline status update) happen after a successful insert and are skipped on refusal; the public route also deletes the pipeline request it created | grep; mocked test asserting no `pipeline_messages` insert and one `DELETE FROM client_pipeline` |
| 11 | Same-email duplicate race | **Not addressed by this change**; documented separately in `docs/architecture/ld-tennis-booking-duplicate-email-race.md` | see that note |

## 4. Verification summary

| Check | Result |
| --- | --- |
| `bash scripts/tests/verify-booking-capacity-concurrency.sh both` (Docker postgres:16-alpine) | before the fix: 8 failed, 5 passed (expected); after: migration applied twice, **20 of 20** pass (13 race/contract + 7 safety) |
| Existing tennis/booking/enrolment/lead containment tests | 766 passed, 0 failed |
| `tests/containment/bookingCapacityGuard.test.ts` | passes (route mappings, insert-site discipline, SQL shape, side-effect check) |
| `tsc --noEmit`, ESLint on changed files | clean |
| Harness hygiene | the script no longer leaks containers (it recorded them in a subshell array before) |

## 5. Neon evidence (disposable branch, never Production)

Branch `temp/ld-booking-capacity-guard-proof-20261021`, a copy of Production's branch, a throwaway role,
a scratch schema (no production table written), Postgres 17.11, default isolation READ COMMITTED.

| Check | Result |
| --- | --- |
| Control, no guard, HTTP driver, pooled host, capacity 5, 30 parallel | 30 of 30 confirmed |
| Guard on, pooled host and direct host | exactly 5 confirmed, 25 refused; refusals arrive as `NeonDbError.code === 'BKCAP'` |
| 40 parallel inserts with the application pre-check bypassed, capacity 3 | 3 confirmed, 37 `BKCAP` |
| Concurrent UPDATEs and cancels alongside inserts | no deadlock, no unexpected error |
| Alternative: interactive transaction on the WebSocket `Pool`, `SELECT … FOR UPDATE` | also correct (pooled and direct); not used, see section 2 |
| Final migration text applied twice to the branch's **real** `public.bookings` | one enabled trigger; with capacity 2, 2 inserts succeeded and 2 were refused, inside a rolled-back block |
| Rollback on the branch | inventory hashes identical to the pre-apply baseline |

Production connection: the runtime `DATABASE_URL` is a hidden secret and was not read, so whether it
uses the pooled or the direct host is unconfirmed. The fix works identically on both. Confirm in the
Vercel dashboard if wanted (does the host contain `-pooler`?).

## 6. Production rollout (each step needs its own approval; nothing here has been run)

**Order: code first, then SQL.** SQL before code would turn a raced booking into a 500 instead of a
409 (still no overbooking).

1. **Review and merge** this PR (code is inert without the migration).
2. **Deploy to Production** through the normal flow. Smoke: make one normal booking path call on Preview
   and confirm the same responses as before.
3. **Pre-checks** (read-only; run in the Neon SQL editor on Production):
   ```sql
   -- (a) instances already over capacity (expect no rows; the guard does not touch them)
   SELECT si.id, si.date, si.max_capacity,
          COUNT(b.*) FILTER (WHERE b.status != 'cancelled') AS live
   FROM session_instances si JOIN bookings b ON b.session_instance_id = si.id
   GROUP BY si.id, si.date, si.max_capacity
   HAVING COUNT(b.*) FILTER (WHERE b.status != 'cancelled') > si.max_capacity;
   -- (b) no other trigger on bookings (expect no rows) and the guard not already present
   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND NOT tgisinternal;
   -- (c) nothing long-running holding locks on bookings (expect no rows)
   SELECT pid, state, now() - xact_start AS open_for, left(query, 80)
   FROM pg_stat_activity WHERE xact_start IS NOT NULL AND query ILIKE '%bookings%' AND pid <> pg_backend_pid();
   -- (d) inventory baseline to compare after apply/rollback
   SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS functions,
          (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
          (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS tables;
   ```
   Stop and investigate if (a), (b) or (c) return rows.
4. **Apply to the Preview database branch first** (`scripts/add-booking-capacity-guard.sql` in the Neon SQL
   editor), then run the Preview smoke: ten parallel `POST /api/tennis/book` requests at an instance with
   one free place must give exactly one 201 and nine 409s with `{"error":"This session is full"}`; clean up
   the synthetic booking and pipeline row.
5. **Apply to Production** in a quiet period. The script sets `lock_timeout = '5s'`, so it fails fast
   instead of queueing behind traffic; `DROP/CREATE TRIGGER` takes a brief lock on `bookings`. If it
   fails on the timeout, simply re-run it.
6. **Post-apply verification** (read-only):
   ```sql
   SELECT tgname, tgenabled FROM pg_trigger
   WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'bookings_capacity_guard';  -- one row, 'O'
   -- repeat query (d): exactly +1 function and +1 trigger versus the baseline
   ```
   No synthetic test data is inserted into Production.
7. **Monitor for 72 hours.** In Vercel request logs for `/api/tennis/book`, `/api/dashboard/enrolments*`,
   `/api/dashboard/sessions/*/instances/*` and `/api/bookings`: (a) any **5xx** is a stop signal (a `BKISO`
   or unexpected database error would appear as a 500); (b) 409 "full" responses should occur only for
   genuinely full sessions, so compare their count with the capacity in the calendar; (c) bookings continue
   to appear normally in the dashboard. Example: `vercel logs --project brainbase --environment production
   --status-code 5xx --query "api/tennis/book"`.
8. **Rollback triggers:** any unexplained 5xx on the booking routes, unexpected booking refusals, or lock
   waits reported by staff.

**Rollback (instant, no data change):**
```sql
DROP TRIGGER IF EXISTS bookings_capacity_guard ON public.bookings;
DROP FUNCTION IF EXISTS public.booking_capacity_guard();
```
then re-run inventory query (d): it must equal the baseline. Behaviour returns to today's. The application
code needs no revert (the mapping is inert without the trigger). Verified on the branch.

## 7. Residual risks

- **Same-email duplicates** (not fixed here): see `ld-tennis-booking-duplicate-email-race.md`.
- **Legacy session-level branch** of `POST /api/bookings` (no instance id): its own count-then-insert race
  on session-level capacity remains. super_admin only, no UI caller, out of scope.
- A refused public booking creates then deletes a pipeline request; if the delete fails it is logged and an
  orphan request remains (race case only).
- A duplicate lineage racing into a full instance reports `capacity_blocked` rather than `already_present`
  (cosmetic).
- Inserts for one instance queue for milliseconds; a manual SQL session that inserts a booking and idles in
  an open transaction would block that instance's inserts until it ends. Application paths are single
  statements.
- `BKISO`: if a future change runs booking inserts inside a `REPEATABLE READ` transaction they will fail
  loudly (a 500) rather than risk overbooking. Intended.
- The tests in `scripts/tests/` need Docker and are not part of CI.

## 8. Disposable resources

Neon branch `br-quiet-lake-a74p2jfi` and role `bk_tester` were proof-only. Their disposition is recorded in
the pull request / completion report.
