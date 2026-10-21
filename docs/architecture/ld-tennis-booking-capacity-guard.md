# LD Tennis booking capacity guard

Status: **prepared, not deployed, nothing applied to Production.** Separate from the
Scheduling & Bookings work. Owner approval is needed to merge, to deploy, and (separately)
to apply the one SQL migration to Production.

## 1. The defect

Every path that adds a booking to a session instance reads the live count, compares it with
`max_capacity`, and then INSERTs as separate statements with no lock. Concurrent requests for
the last place all succeed. Reproduced two ways:

| Evidence | Without the guard |
| --- | --- |
| Real Postgres 16 (Docker), the unmodified route handlers, capacity 2 or 3 | public booking 14 of 14 confirmed; staff enrol by name 12 of 12; from a contact 10 of 10; super_admin route 10 of 10; four paths together 14 of 16 for capacity 3; recurring propagation 8 of 8 into 1 free place |
| Real Neon (Postgres 17.11), `@neondatabase/serverless` HTTP driver, pooled host, capacity 5 | 30 of 30 confirmed |

A read-only count on a snapshot of the production database found 233 session instances, none
over capacity and none exactly full, so there is no sign it has happened. The exposure is
real but unrealised.

## 2. The fix

A database-side guard, because it is the one place every writer passes through.

`scripts/add-booking-capacity-guard.sql` adds one function and one `BEFORE INSERT` row
trigger on `bookings`. It takes a transaction-scoped advisory lock keyed on the instance id,
counts live bookings (`status != 'cancelled'`, the same predicate every route uses) and
refuses the insert with SQLSTATE `BKCAP` when the instance is full. Inserts for the same
instance queue on the lock for milliseconds; other instances do not contend.

Why this and not an interactive transaction, as the brief preferred first:

- The app's `sql` is the Neon **HTTP** driver, whose `sql.transaction([...])` is a fixed batch
  (non-interactive, documented in `lib/tennisSchedule.ts`). Interactive transactions need a
  second driver (WebSocket `Pool`) or Prisma, plus re-plumbing every insert site and the
  mocked tests behind them. It was verified to work (section 4), but it is a larger change
  and a lock only protects paths that take it, so a missed or future path stays unsafe.
- The trigger covers **all** writers uniformly, including future code and manual SQL, with the
  existing driver and no new connection mechanism. A single `INSERT … WHERE count < capacity`
  and `SELECT … FOR UPDATE` inside one statement were rejected: under READ COMMITTED they
  see one snapshot, so concurrent statements still pass together.
- An advisory lock was chosen over a row lock on `session_instances` so it cannot interact
  with the row locks that reconcile, archive, pause and cancel already take (no deadlock
  cycle is possible with them). Each statement inside a PL/pgSQL function takes a fresh
  snapshot, so after the lock the count sees every committed row.

Application side (`lib/bookingCapacity.ts` and five call sites): a guard refusal is mapped to
the response each path **already** gives when its own pre-check finds the session full. Until
the migration is applied the error never occurs, so the code is inert.

| Path | On a guard refusal (same as its existing "full" answer) |
| --- | --- |
| `POST /api/tennis/book` (public) | 409 `{ error: 'This session is full' }`, and the pipeline request created for the attempt is deleted so nothing is left behind |
| `POST /api/dashboard/sessions/[id]/instances/[instanceId]` | 409 `{ error: 'Session is full' }` |
| `POST /api/dashboard/enrolments` | 409 `{ error: 'Session is full' }` |
| `POST /api/bookings` (super_admin, instance booking) | 409 `{ error: 'Session instance is full' }` |
| `enrolLineageIntoInstance` (recurring propagation: reconcile, weekly toggle, pause clear, generate) | outcome `capacity_blocked` (not `error`) |

All other failures behave exactly as before. A test fails if a new `INSERT INTO bookings` site
is added without this handling, and if any code path ever re-activates a cancelled booking or
moves a booking to another instance (inserts are then provably the only way a count grows).

Customer-facing behaviour is unchanged: same status codes, same JSON bodies, same rows.

## 3. Semantics of the guard

- Counts `status != 'cancelled'` for the instance; limits only rows that have a
  `session_instance_id` (legacy one-off appointments have none); never refuses a row inserted
  already cancelled; capacity is `session_instances.max_capacity` at insert time.
- Lowering `max_capacity` later never removes bookings; it only blocks new ones.
- UPDATEs are not guarded. Verified by search: no path un-cancels a booking or changes its
  instance.
- Instances already over capacity are untouched; the guard only blocks further inserts into
  them. (None exist in the snapshot checked.)

## 4. Verification

**Failing test first.** `4ad517f0` adds the regression harness with no fix; run on that
commit it fails 8 of 13 tests with the overbooking numbers above.

**After the fix**, all on the final code:

| Check | Result |
| --- | --- |
| `bash scripts/tests/verify-booking-capacity-concurrency.sh both` (Docker postgres:16-alpine) | before: 8 failed, 5 passed (expected failure); after: migration applied twice, 13 of 13 pass |
| Existing tennis/booking/enrolment/lead containment tests | 766 passed, 0 failed |
| New `tests/containment/bookingCapacityGuard.test.ts` | 22 passed |
| `tsc --noEmit`, ESLint on the changed files | clean |

**Disposable Neon branch** (`temp/ld-booking-capacity-guard-proof-20261021`, a copy of
Production's branch; a throwaway role; a scratch schema, so no production table was written):

| Check | Result |
| --- | --- |
| Control, no guard, HTTP driver, pooled host, capacity 5, 30 parallel | 30 of 30 confirmed |
| Migration applied twice | one enabled trigger, no error |
| Guard on, pooled host and direct host | exactly 5 confirmed, 25 refused; refusals surface as `NeonDbError.code === 'BKCAP'` |
| 40 parallel inserts with the pre-check bypassed, capacity 3 | 3 confirmed, 37 `BKCAP` |
| Cancelled rows, instance-less rows, cancel-frees-place | behave as specified |
| Concurrent instance UPDATEs and cancels alongside inserts | no deadlock, no unexpected error |
| Alternative: interactive transaction, WebSocket `Pool`, `SELECT … FOR UPDATE` | also correct on pooled and direct hosts (30 parallel, exactly 5) |
| Migration applied twice to the branch's **real** `public.bookings` | applied; with capacity 2, 2 inserts succeeded and 2 were refused `BKCAP`; the test ran inside a rolled-back block, nothing persisted |
| Documented rollback run on the branch | trigger 0, function 0, test rows 0 |
| Isolation | default `READ COMMITTED` confirmed on the branch |

**Production connection strategy.** The runtime `DATABASE_URL` is a hidden secret and was not
read, so whether production uses the pooled or direct host is **unconfirmed** (the
Production endpoint also reports `pooler_enabled: false`, which is not authoritative).
It does not matter for this fix: it works identically through the HTTP driver on both hosts
(PgBouncer transaction mode included, because the advisory lock is transaction-scoped).
It would matter for the interactive-transaction alternative, which was only shown to work in
a test. To confirm: in the Vercel dashboard, check whether the `DATABASE_URL` host contains
`-pooler`.

## 5. Rollout (each step needs its own approval)

1. Review and merge this PR. The code is inert without the migration.
2. Deploy to Production through the normal flow.
3. Run the **pre-check** at the top of `scripts/add-booking-capacity-guard.sql` in the Neon
   console (read-only; expect no rows).
4. Apply `scripts/add-booking-capacity-guard.sql` in the Neon SQL editor, **Preview branch
   first** with a Preview smoke (parallel public bookings against a capacity-1 instance),
   then Production. It takes a brief lock on `bookings` for the `DROP/CREATE TRIGGER` and sets
   `lock_timeout = '5s'`, so it fails fast rather than queueing behind traffic.
5. Run the `VERIFY` query from the file header (one enabled trigger).
6. Watch for a rise in 409 responses on the booking routes in the first days; a refusal is
   the system working.

Order matters: code first, then SQL. SQL before code would turn a raced booking into a 500
instead of a 409 (still no overbooking).

## 6. Rollback

- Database (instant, no data change): `DROP TRIGGER IF EXISTS bookings_capacity_guard ON
  public.bookings; DROP FUNCTION IF EXISTS public.booking_capacity_guard();` Verified on the
  branch. Behaviour returns to today's.
- Code: revert the commit. Not required for safety, since the mapping is inert without the
  trigger.
- No migration of data, no schema change to undo.

## 7. Residual risks and what this does not fix

- **Duplicate-email race in public booking.** Two simultaneous requests with the same email
  can still both pass the duplicate check. The guard is about capacity and deliberately
  ignores email because the contact-based staff route has never enforced email uniqueness.
  A partial unique index would fix it but is a schema change needing its own approval.
- A refused public booking now ends after the pipeline row was created and deleted; if that
  cleanup fails it is logged and an orphan request remains (previously a "full" refusal
  happened before any insert). Only in the race case.
- A duplicate recurring lineage racing into a full instance reports `capacity_blocked`
  instead of `already_present`. Cosmetic, race-only.
- The legacy `session_id` branch of `POST /api/bookings` (no instance) has its own capacity
  semantics and is out of scope.
- Brief waiting: inserts for the same instance serialise for a few milliseconds.

## 8. Disposable resources left behind (need your OK to remove)

Neon branch `br-quiet-lake-a74p2jfi` (`temp/ld-booking-capacity-guard-proof-20261021`) in
project `empty-fire-62164682`, and its role `bk_tester`. The branch holds a copy of
Production data and is not auto-expiring. Deleting a branch is a destructive action, so it
has been left for your approval.
