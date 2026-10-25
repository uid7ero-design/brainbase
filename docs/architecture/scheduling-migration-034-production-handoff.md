# Scheduling migration 034 (availability integrity): Production handoff

Status: **SUPERSEDED by scheduling-migrations-034-035-production-handoff.md** (kept for its 06:55Z rehearsal record). Prepared, NOT executed. Nothing in this document has been run against Production. It is owner-run, in the manual Neon SQL editor, and
needs a separate explicit approval. Merging code never applies it: the application does not run migrations, and until 034 is applied every
availability route answers `503 AVAILABILITY_NOT_READY` and writes nothing.

| | |
| --- | --- |
| Migration | `packages/scheduling/sql/034_availability_integrity.sql` (version marker `2b.3.1`) |
| Rollback | `packages/scheduling/sql/095_availability_integrity_rollback.sql` |
| Merged in | PR #496, merge commit `403f07053ec97efc08d53b017ec29e7a6287ba51` on `main` |
| Needs | the `2a.2` scheduling schema only (it does not depend on 030-033, which Production already has) |
| Effect | 2 columns, 2 touch triggers, 3 functions, 2 guard triggers, 1 version marker. Nothing dropped, nothing rewritten. |

## 1. Verify the files (exact committed SHA-256)

Hash the **committed bytes** (LF). A Windows checkout may be CRLF, so strip carriage returns, or hash from git:

```
034_availability_integrity.sql                 ac2fd239fb4650bef8a414557781c6e6b0efd76390f34a962cae9e14d3b213ab
095_availability_integrity_rollback.sql        9d9a42665120da544dc1d0279e1f27e0f9b076304ba630517cbbddf1957573d2

git show 403f07053ec97efc08d53b017ec29e7a6287ba51:packages/scheduling/sql/034_availability_integrity.sql | sha256sum
git show 403f07053ec97efc08d53b017ec29e7a6287ba51:packages/scheduling/sql/095_availability_integrity_rollback.sql | sha256sum
```

Both were checked equal on the PR head (`8b39ff7b`), on `main` after the merge (`58eccfda`) and in the rehearsal below. The three functions the migration
creates have these `md5(prosrc)` values (line endings removed), which the verification in section 5 compares:

```
scheduling_availability_lock_owner            ec6ff1692bcb450fcfd842d62df33370
scheduling_availability_rule_integrity        889cc2be7a0b41d42ff5ec8d50ea81ba
scheduling_availability_exception_integrity   964334cde288e280d2d15ffc1e275ee3
```

## 2. What it changes, and what it cannot

| Object | Change |
| --- | --- |
| `scheduling_availability_rules`, `scheduling_availability_exceptions` | `ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`. Existing rows get the migration time (a valid first version). |
| triggers `..._rules_touch`, `..._exceptions_touch` | keep `updated_at` current on update, using the existing `scheduling_touch_updated_at()` |
| function `scheduling_availability_lock_owner(text,text,text)` | takes the owner's advisory lock, then refuses an inactive resource (`SCRES`) or an archived offering/schedule (`SCARC`) |
| functions + triggers `..._rules_integrity`, `..._exceptions_integrity` | BEFORE INSERT OR UPDATE: owner never changes (`SCOWN`); no overlapping rule of one owner (`SCOVL`); no same-kind overlapping closure (`SCOVL`) |
| `scheduling_schema_migrations` | one row, `2b.3.1` |

It does **not** touch reservations, holds, occurrences, schedules, offerings, resources, assignments, settings, `organisations`, entitlements or any
LD Tennis or Eve table. Deletes stay unguarded on purpose (availability can always be removed). Existing rows are never re-validated.

## 3. Rehearsal result (disposable Neon branch derived from Production, 2026-10-25)

Branch `rehearse/scheduling-034-20261025` (`br-delicate-cloud-a7omr0aw`), created from the Production branch at LSN `0/2F5DA958` (06:55:49Z), project
`empty-fire-62164682`, database `neondb`. Every statement below ran on that branch and nowhere else. 034 and 095 were applied as the
**same statements, in one transaction each** (the Neon tool runs a statement list in one transaction; BEGIN/COMMIT are implied).

**Baseline (before 034).**

```
versions       2a.1-brainbase, 2a.2, 2b.0-capability, 2b.0-crm-link, 2b.2.1, 2b.2.2, 2b.2.3, 2b.2.4
rules / closures                 0 / 0            (no inventory needed)
schedules / offerings / resources 4 / 4 / 5
reservations / holds / occurrences 0 / 0 / 0
audit_logs action LIKE 'scheduling.%'  29
availability columns             no updated_at; no availability triggers
fingerprints   schema_fp 9c69bb3b3962a237213ef4616277819b
               fn_fp     a4af63dd544b20600ce9ad73ae0af86d
               trg_fp    d94a0aae47316f4eb659d9482a7f5b6f
```

**After 034 (additive).** The three function bodies equal the committed file byte for byte (hashes above, checked by extracting the `$$` bodies
from the committed file locally). Exactly four enabled availability triggers (`..._exceptions_integrity`, `..._exceptions_touch`, `..._rules_integrity`,
`..._rules_touch`, all `O`). `updated_at` is `timestamptz NOT NULL DEFAULT now()` on both tables. Marker `2b.3.1` present once. The functions of the
other 030-033 migrations are unchanged (`fn_fp` over every other `scheduling_*` function is still `a4af63dd...`), the trigger fingerprint over all other
scheduling tables is unchanged (`d94a0aae...`), counts unchanged (4/4/5 and 0/0/0).

**Behaviour on the pilot's own rows** (a real archived offering `9840fcd1-...` and a real inactive resource `d8dadad8-...` exist in the pilot):

| Case | Result |
| --- | --- |
| six overlapping inserts for one resource, sent together | one committed, five `SCOVL` |
| insert on the pilot's archived offering | `SCARC` ("offering ... is archived") |
| insert on the pilot's inactive resource | `SCRES` ("resource ... is inactive") |
| owner change of an existing rule | `SCOWN` |
| rule in another organisation naming this organisation's resource | foreign-key violation (`scheduling_availability_rules_resource_fk`), nothing written |
| touching window `10:00-24:00` next to `09:00-10:00` | accepted; `24:00` stored as `24:00:00` |
| closure overlapping an existing closure of the same owner | `SCOVL`; a disjoint closure is accepted |
| edit with the current version token | row returned with a new token; a second edit with the **old** token wrote 0 rows (stale) |

The six-at-once test went through the Neon tool, which may serialise calls, so it is a sequence check, not a race. Genuine concurrency is proven on
real Postgres 16.14 and 17.11 (30 simultaneous overlapping inserts leave exactly one row; racing edits, deactivations and archives never deadlock):
`bash scripts/tests/verify-scheduling-phase2b3c.sh 16|17`.

**Rollback with data (095), then idempotent re-application.** With 2 rules and 1 closure present, 095 returned the three fingerprints to the baseline
values exactly (`9c69bb3b...`, `a4af63dd...`, `d94a0aae...`), removed the marker, kept both rules and the closure with their labels, and 034 then
re-applied cleanly: same three function hashes, marker once, every row carries a version token again.

Not exercised on the branch: reservations, holds and occurrences are 0 in Production, so "no change to reservations or holds" is shown by their
counts staying 0 and by the repository suite (`availabilityIntegrity.integration.test.ts`: reading and writing availability changes no booking table).
Concurrent overlapping inserts at scale are covered by the PG 16/17 suites above, not the branch.

The rehearsal branch is left in place until you say it can be deleted (it holds a copy of Production data and 3 synthetic rows).

## 4. Preflight (read-only; run in the Neon SQL editor on the **Production** branch)

All of these must hold. Stop and report if any does not.

```sql
-- 1. The schema is at the expected version, and 034 is not already applied.
SELECT version FROM scheduling_schema_migrations ORDER BY version;
--    expect to include 2a.2 and 2b.2.4 and NOT 2b.3.1

-- 2. Availability is empty (or inventory it: nothing is changed, but report non-zero).
SELECT (SELECT count(*) FROM scheduling_availability_rules)      AS rules,
       (SELECT count(*) FROM scheduling_availability_exceptions) AS closures;
--    expect 0 | 0

-- 3. The tables do not already have updated_at, and have no availability triggers.
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_name IN ('scheduling_availability_rules','scheduling_availability_exceptions') AND column_name = 'updated_at';
--    expect no rows
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid IN ('scheduling_availability_rules'::regclass,'scheduling_availability_exceptions'::regclass);
--    expect 0

-- 4. The helper it reuses exists.
SELECT proname FROM pg_proc WHERE proname = 'scheduling_touch_updated_at';
--    expect 1 row

-- 5. Baseline fingerprints (record the output; compare after).
SELECT 'schema_fp', md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name))
  FROM information_schema.columns WHERE table_name LIKE 'scheduling\_%'
UNION ALL SELECT 'fn_fp', md5(string_agg(p.proname||md5(p.prosrc), ',' ORDER BY p.proname)) FROM pg_proc p WHERE p.proname LIKE 'scheduling\_%'
UNION ALL SELECT 'trg_fp', md5(string_agg(c.relname||'.'||t.tgname, ',' ORDER BY c.relname, t.tgname))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname LIKE 'scheduling\_%' AND NOT t.tgisinternal;
--    the rehearsal baseline (branch of 2026-10-25 06:55Z) was 9c69bb3b..., a4af63dd..., d94a0aae...: Production must match unless
--    something has been applied since. If it differs, find out why before going on.

-- 6. Pilot configuration to compare afterwards.
SELECT (SELECT count(*) FROM scheduling_schedules) AS schedules, (SELECT count(*) FROM scheduling_offerings) AS offerings,
       (SELECT count(*) FROM scheduling_resources) AS resources, (SELECT count(*) FROM scheduling_reservations) AS reservations,
       (SELECT count(*) FROM scheduling_resource_holds) AS holds, (SELECT count(*) FROM scheduling_occurrences) AS occurrences,
       (SELECT count(*) FROM audit_logs WHERE action LIKE 'scheduling.%') AS scheduling_audit;
--    rehearsal baseline: 4 | 4 | 5 | 0 | 0 | 0 | 29. A different audit count is fine (people use the system); a different 4/4/5 needs a reason.
```

Also confirm in the Vercel dashboard that the deployment for `main` at or after `403f0705` is live (it is only needed for the routes to start answering;
the migration itself does not depend on it).

## 5. Backup requirement

Immediately before running, create a Neon branch from Production named `migration-backup/scheduling-availability-pre-<yyyymmdd>-<hhmm>z` (the
convention used for 030-033). Record its branch id and the Production LSN. 034 is additive and 095 reverses it, so this is a belt-and-braces recovery
point, not the rollback path. Keep it until the post-migration verification has passed and you have used the routes once; delete it only on your say-so.

## 6. Execution

1. Preflight above: all expected values.
2. Backup branch created.
3. Open the Neon SQL editor on the **Production** branch, database `neondb`.
4. Paste the committed `034_availability_integrity.sql` exactly (verify the SHA-256 of what you paste, or paste from the file at the merge commit). It
   is one transaction (`BEGIN` ... `COMMIT`) with `lock_timeout = 5s` and `statement_timeout = 120s`; it fails and changes nothing if it cannot
   take its locks within 5 s, and you can simply run it again. It is idempotent.
5. Run it once. Do not edit it.

Expected duration: well under a second (two `ALTER TABLE ... ADD COLUMN` on empty tables, five object creations).

## 7. Verification after execution (read-only)

```sql
-- the marker, the columns, the four enabled triggers
SELECT version FROM scheduling_schema_migrations WHERE version = '2b.3.1';                       -- 1 row
SELECT table_name, data_type, is_nullable FROM information_schema.columns
 WHERE column_name = 'updated_at' AND table_name IN ('scheduling_availability_rules','scheduling_availability_exceptions'); -- 2 rows, timestamptz, NO
SELECT tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal
   AND tgrelid IN ('scheduling_availability_rules'::regclass,'scheduling_availability_exceptions'::regclass) ORDER BY tgname;   -- 4 rows, all 'O'

-- the three functions are byte-for-byte the committed ones
SELECT proname, md5(replace(prosrc, chr(13), '')) FROM pg_proc
 WHERE proname IN ('scheduling_availability_lock_owner','scheduling_availability_rule_integrity','scheduling_availability_exception_integrity') ORDER BY proname;
--   exception_integrity 964334cde288e280d2d15ffc1e275ee3, lock_owner ec6ff1692bcb450fcfd842d62df33370, rule_integrity 889cc2be7a0b41d42ff5ec8d50ea81ba

-- nothing else moved: re-run preflight 5 with the new objects excluded; the fn and trigger fingerprints of everything else must equal the baseline
SELECT 'fn_fp_excluding_new', md5(string_agg(p.proname||md5(p.prosrc), ',' ORDER BY p.proname)) FROM pg_proc p
 WHERE p.proname LIKE 'scheduling\_%' AND p.proname NOT IN ('scheduling_availability_lock_owner','scheduling_availability_rule_integrity','scheduling_availability_exception_integrity')
UNION ALL SELECT 'trg_fp_excluding_avail', md5(string_agg(c.relname||'.'||t.tgname, ',' ORDER BY c.relname, t.tgname))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname LIKE 'scheduling\_%' AND NOT t.tgisinternal
   AND c.relname NOT IN ('scheduling_availability_rules','scheduling_availability_exceptions');
-- and preflight 6 again: the schedule, offering, resource, reservation, hold and occurrence counts are unchanged.
```

Then, as a signed-in **manager** of the pilot organisation (do this yourself; no one else's account is used and no test account is created):
`GET /api/scheduling/resources/<a resource id>/availability` must answer `200` with empty `rules` and `exceptions` (it answered `503
AVAILABILITY_NOT_READY` before). Make no write unless you intend to keep it.

## 8. Rollback

`packages/scheduling/sql/095_availability_integrity_rollback.sql` (SHA-256 above). One transaction, idempotent. It drops the four triggers, the
three functions and the two `updated_at` columns and removes the `2b.3.1` marker. **No rule or closure row is deleted or changed**; version tokens
are derived data. After it the schema is as it was at `2b.2.4`/`2a.2`, and the availability routes answer `503 AVAILABILITY_NOT_READY` again.
Rehearsed with data present (section 3): the schema, function and trigger fingerprints came back to the baseline values exactly.

If 034 itself fails: it is a single transaction, so nothing is applied; read the error, do not edit the file, and report it.
Restoring from the backup branch is a last resort and would discard anything written since the branch was made.

## 9. Not part of this handoff

- `035_availability_partial_closures.sql` (partial-day closures, version `2b.3.2`), staged by Phase 2B.3c, needs 034 first and its own review and
  approval. Its handoff is in `docs/architecture/scheduling-phase2b3c-availability-screens.md`.
- The Scheduling pilot's data, entitlements, accounts and memberships are not changed by anything here.
