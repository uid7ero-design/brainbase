# Scheduling Phase 2A: manual Neon migration package

**Status: staged, rehearsed, NOT applied to Production or to any shared Preview database.**
Applying any step to Production needs the explicit approvals listed in section 9.

| File | Purpose | Writes? |
| --- | --- | --- |
| `packages/scheduling/sql/001_preflight.sql` | Eight read-only checks | no |
| `packages/scheduling/sql/010_shared_schema.sql` | The shared, host-free schema (13 tables, 11 functions, 16 triggers) | yes, new objects only |
| `packages/scheduling/sql/020_verify.sql` | Eight read-only verifications | no |
| `scripts/scheduling/110_brainbase_host.sql` | Three foreign keys to `organisations(id)` | yes, three constraints |
| `scripts/scheduling/190_brainbase_host_rollback.sql` | Removes those three constraints | yes |
| `packages/scheduling/sql/090_rollback.sql` | Removes every `scheduling_*` object (data guard) | yes |

Every writing file is one `BEGIN ... COMMIT` transaction, idempotent, and begins with
`SET LOCAL lock_timeout = '5s'` so it fails fast instead of queueing. Run each file whole in the
Neon SQL Editor (the console accepts multi-statement scripts, as it did for the Assurance
migrations). Nothing here is executed by the application, a route, a build step or CI.

## 1. What it changes, and what it cannot touch

- Creates 13 `scheduling_*` tables, 11 `scheduling_*` functions, 16 triggers (all on those tables), indexes and
  constraints, the schema `scheduling_ext` and the `btree_gist` extension (installed `WITH SCHEMA scheduling_ext`).
- Alters, drops, renames, reads or writes **no existing object**. Verified three ways: a static test over the SQL text
  (`tests/containment/schedulingPhase2aContainment.test.ts`, `packages/scheduling-postgres/tests/boundary.test.ts`), a
  catalogue fingerprint of everything that is not `scheduling_*` taken before and after apply and rollback
  (`schema.integration.test.ts`), and the Neon rehearsal inventory below.
- Inserts exactly one row: the version marker in `scheduling_schema_migrations` (plus one more for the host file).
- The host file adds three foreign keys (settings, schedules, resources to `organisations.id`). It adds **no** reference
  to `crm_contacts`, `contacts`, `bookings`, `sessions` or `session_instances`.
- No customer is migrated, matched or backfilled. No LD Tennis row is read.

## 2. Backup and dependency considerations

- **Backup = a Neon branch taken immediately before the first write** (copy-on-write, instant, no extra load). Name it
  `rollback/pre-scheduling-2a-<date>`. The change is additive, so this is a safety net rather than the rollback path
  (the rollback path is `090`/`190`). Keep it until the stabilisation period ends, then delete it.
- `brainbase-db` history retention is 6 hours, so a point-in-time restore is only available shortly after the change;
  take the branch.
- **Role:** run as the database owner (the role the other BrainBase migrations use). It must be able to
  `CREATE` in `public` and `CREATE EXTENSION btree_gist` (preflight step 4 checks).
- **Dependencies:** none on the application. No deploy is needed before or after: the application does not reference
  these tables (a containment test pins that). The only external dependency is `organisations.id` being `TEXT`
  (preflight step 5) for the host file.
- **Locks:** the migration creates new tables; the only existing object it touches is the system catalogue. The host
  file takes a brief lock on the three NEW tables. No existing table is locked, so LD Tennis traffic is unaffected.
  Still, run in a quiet period and check preflight step 7 (no long transaction).
- **Prisma:** the tables are raw SQL and deliberately not in `prisma/schema.prisma`; `prisma generate` and the existing
  drift tooling are unaffected (a containment test asserts the schema file has no `scheduling_`).
- **Timeouts:** `lock_timeout` is 5 s for the script; the scheduling functions carry their own 5 s lock timeout at run time.

## 3. Execution order and stopping conditions

Always Preview/disposable first, Production only after separate approval.

| # | Step | Run | Expected | STOP if |
| --- | --- | --- | --- | --- |
| 0 | Backup branch | Neon console | branch `ready` | branch not ready |
| 1 | `001_preflight.sql` | read-only | section 4.1 | any listed STOP condition |
| 2 | `010_shared_schema.sql` | write | no error; ends in `COMMIT` | any error (the transaction rolls back; nothing changed). `SCVER` means a pre-release `2a.1` install exists: run `090` first (it only ever existed on a disposable branch) |
| 3 | `020_verify.sql` | read-only | section 4.3 | any mismatch |
| 4 | `110_brainbase_host.sql` | write | no error; `COMMIT` | `VALIDATE` fails (a scheduling row names a missing organisation) |
| 5 | `020_verify.sql` again | read-only | check 7 now returns 3 rows, all to `organisations` | other than 3 |
| 6 | Smoke (optional, Preview only) | the repository suites against the Preview URL | all green | any failure |

Do **not** proceed to the next step on a warning you cannot explain. Re-running a writing step is always safe.

## 4. Expected output per step

### 4.1 Preflight (`001`)

| Check | Expected |
| --- | --- |
| 1 | `version_num >= 140000` (Neon `brainbase-db` is 17.11) |
| 2 | 0 rows on the first run |
| 3 | one row, `default_version` 1.7, `installed_version` NULL |
| 4 | `true, true, true` |
| 5 | `organisations.id` is `text` |
| 6 | 0 rows |
| 7 | 0 rows |
| 8 | record `tables_before, functions_before, triggers_before`. On the 2026-10-22 production copy: **212 / 58 / 64** |

### 4.2 Apply (`010`)

Success is the absence of an error and a final `COMMIT`. A re-run prints only "already exists, skipping" notices.

### 4.3 Verify (`020`)

| Check | Expected |
| --- | --- |
| 1 | one row `2a.2` |
| 2 | 13 tables; `row_count` 0 except `scheduling_schema_migrations` = 1 |
| 3 | tables +13, functions +11, triggers +16 (production copy: **225 / 69 / 80**) |
| 4 | `scheduling_holds_no_overlap ... EXCLUDE USING gist (organisation_id WITH =, resource_id WITH =, during WITH &&) WHERE ((released_at IS NULL))` |
| 5 | `btree_gist` 1.7 in schema `scheduling_ext` |
| 6 | 16 triggers, all `tgenabled = 'O'` |
| 7 | 0 rows after `010`; 3 rows (all to `organisations`) after `110` |
| 8 | `legacy_dependencies = 0` |

## 5. Rollback

1. `scripts/scheduling/190_brainbase_host_rollback.sql` (removes the three foreign keys).
2. `packages/scheduling/sql/090_rollback.sql`. If any reservation exists it **refuses**:
   `scheduling_reservations holds N rows; rollback would destroy them`. To proceed knowingly, put
   `SET scheduling.rollback_confirm = 'yes';` on the line above `BEGIN` in the same run.
3. Verify the inventory equals the preflight baseline (rehearsal: exactly **212 / 58 / 64**).

Left behind on purpose: the `btree_gist` extension and the empty `scheduling_ext` schema (other objects may use the
extension; dropping it is a separate, optional `DROP EXTENSION btree_gist; DROP SCHEMA scheduling_ext;`). Rolling
back twice is harmless.

Application code needs no revert: nothing references these tables.

## 6. Monitoring after a real apply

- Immediately: run `020` and compare with section 4.3.
- First 24 h: nothing should have changed for LD Tennis or any other module. Watch Neon for unexpected lock waits
  (`pg_stat_activity` waiting on `Lock`) and the runtime error rate; both should be flat because nothing queries
  the new tables.
- Once Phase 2B code runs against it: alert on `contention_timeout` (SQLSTATE `55P03`, a stuck waiter) and on any raw
  `40P01` (must stay at zero; the per-resource lock exists to prevent it), and watch the refusal mix (`SCCAP`,
  `23P01`) for abnormal ratios. A rise in `contention_timeout` means a long transaction is holding a booking lock, not
  that places have run out.

## 7. Known operational limits

- A booking that waits more than 5 s for a capacity or resource lock fails with `55P03`, which the adapter reports as
  the retryable `contention_timeout` (never as "full"). Nothing was written. Retry policy: `scheduling-phase2a-contention.md`.
- The per-resource lock serialises writes to one resource. Measured on the disposable databases (see
  `scheduling-phase2a-contention.md`): 100 simultaneous requests for one resource complete in well under a second on a
  local container. That is a correctness result, not a production capacity figure.
- Session-level settings (`SET lock_timeout`, isolation level) do not survive the Neon HTTP driver or PgBouncer; the
  design does not depend on them.

## 8. Rehearsal evidence

See `scheduling-phase2a-rehearsal.md`.

## 9. Approvals needed before Production

1. Merge of the Phase 1 PR (#461) and of this PR, in that order, by the owner.
2. Confirmation that `crm_contacts` is the authoritative customer table (design only; no SQL here depends on it).
3. Approval to apply `010` then `110` to the **Preview** database and run the suites there.
4. Separate approval to apply `010` then `110` to **Production**, in a quiet period, with the backup branch taken.
5. Approval to start Phase 2B (nothing in this PR reads or writes these tables from the application).
