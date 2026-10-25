# Scheduling migrations 034 and 035 (availability): Production handoff

Status: **prepared, NOT executed.** Nothing here has been run against Production. Both migrations are owner-run in the manual Neon SQL editor, each
needs its own explicit approval, and merging code never applies either: the application does not run migrations.

- Until **034** is applied every availability route answers `503 AVAILABILITY_NOT_READY` and writes nothing.
- With 034 and without **035**, weekly hours and full-day closures work; a partial-day closure answers `503 PARTIAL_CLOSURES_NOT_READY` and writes
  nothing, and the closure dialog shows "Part of a day" disabled.

This document replaces `scheduling-migration-034-production-handoff.md` (kept for its 2026-10-25 06:55Z rehearsal record). The order is fixed:
**034, verify, then 035, verify.** Never run 034 again after 035 (it would put the date-only closure guard back; stricter, never looser).

## 1. Files and exact committed SHA-256

Hash the committed bytes (LF). A Windows checkout may be CRLF, so use `git show <commit>:<path> | sha256sum`.

```
034_availability_integrity.sql                       ac2fd239fb4650bef8a414557781c6e6b0efd76390f34a962cae9e14d3b213ab   (on main)
095_availability_integrity_rollback.sql              9d9a42665120da544dc1d0279e1f27e0f9b076304ba630517cbbddf1957573d2   (on main)
035_availability_partial_closures.sql                91f60dcd1b0a72a747a0d1b672c6a42f7388567d150609f6ac12e0196af2f93c   (PR #499)
096_availability_partial_closures_rollback.sql       22595731ece3ba8e1c78462d6e65c081fdc388f10012dd2c518051c4adcaa210   (PR #499)
```

`md5(prosrc)` of the functions after each migration (compare with `replace(prosrc, chr(13), '')`):

```
after 034                                      after 035 (only the exception guard changes)
lock_owner            ec6ff1692bcb450fcfd842d62df33370      lock_owner            ec6ff1692bcb450fcfd842d62df33370
rule_integrity        889cc2be7a0b41d42ff5ec8d50ea81ba      rule_integrity        889cc2be7a0b41d42ff5ec8d50ea81ba
exception_integrity   964334cde288e280d2d15ffc1e275ee3      exception_integrity   84d643d6cc5f9580795d07100ce563ad
```

## 2. Rehearsal (2026-10-25, fresh Neon branch derived from Production)

Branch `rehearse/scheduling-034-035-20261025` (`br-solitary-hat-a7u52qm5`), created from the Production branch at LSN `0/2F61DEF8`, project
`empty-fire-62164682`, database `neondb`. Every statement ran on that branch only. The migration files were applied as the same statements
(comments inside function bodies kept), **one transaction per file** (the Neon tool runs a statement list as one transaction).

Baseline: versions `2a.1-brainbase .. 2b.2.4`; 0 rules, 0 closures (no inventory needed); 4 schedules, 4 offerings, 5 resources; 0 reservations,
0 holds, 0 occurrences. Fingerprints (definitions in section 3; rehearsal values `schema 9c69...` are not comparable to other definitions):
schema `ba7b7014`, functions `d5b9221c`, triggers `597be2fb`.

| Step | Result |
| --- | --- |
| apply 034 | function bodies equal the committed file; 4 triggers enabled; marker `2b.3.1` |
| apply 035 | new guard body `84d643d6...`; `start_time`/`end_time` `time` NULL; CHECK `..._window_ck`; marker `2b.3.2`; fingerprints schema `0743dca9`, functions `6de539fc`, triggers `fc9b72b7` |
| overlapping weekly rules | `SCOVL`; touching windows accepted |
| self-overlapping batch (one statement) | `SCOVL`, **0 rows left** |
| overnight pair (Wed 22:00-24:00 + Thu 00:00-06:00, one statement) | accepted, 2 rows |
| overnight batch overlapping a stored rule | `SCOVL`, 0 rows left |
| archived offering / inactive resource | `SCARC` / `SCRES` (both are real pilot rows) |
| owner change | `SCOWN` |
| rule naming another organisation | foreign-key violation `23503` |
| partial closures: 12:00-13:00 and 15:00-16:00, same date | both accepted |
| partial closure 12:30-13:30 over 12:00-13:00 | `SCOVL` |
| whole-day closure over a date holding partial closures | `SCOVL` |
| same window on another date | accepted |
| start >= end, or only one of start/end | `23514` (CHECK) |
| closure on the archived offering | `SCARC` |
| stale write | edit with the current token: 1 row; the same token again: 0 rows (the end time stayed 15:00) |
| **096 while partial-day closures exist** | **refused (`SCVER`), nothing changed** (columns, marker and guard intact) |
| 096 after those closures were removed | guard body back to `964334cd...` (034's), columns and marker gone, whole-day closure and rules kept |
| **095 with data present** | rules and closure kept; schema, function and trigger fingerprints equal the baseline exactly (`ba7b7014`, `d5b9221c`, `597be2fb`); marker `2b.3.1` removed |
| re-apply 034, then 034 again | identical fingerprints and bodies (idempotent) |
| re-apply 035, then 035 again | identical fingerprints and bodies (idempotent) |
| cleanup | 5 synthetic rules and 1 closure removed; rules 0, closures 0 |

Pilot data: schedules, offerings, resources and the scheduling settings row have identical content hashes on this branch and on the earlier
rehearsal branch, and the Scheduling `organisation_modules` row is identical; reservations, holds and occurrences remain 0. Both branches are copies
of Production, so this shows the migrations and tests did not alter pilot configuration; it does not read Production itself (no Production SQL ran).

Limits: the Neon tool serialises calls, so overlap tests there are sequence checks. Genuine concurrency (30 simultaneous overlapping inserts leave
exactly one; 12 identical overnight batches leave one whole batch; opposed-order batches never deadlock; racing edits, deactivations and archives never
deadlock) is proven on PostgreSQL 16.14 and 17.11 by `bash scripts/tests/verify-scheduling-phase2b3c.sh 16|17`.

## 3. Fingerprint queries (run identically before and after, on Production, read-only)

```sql
SELECT 'schema_fp', left(md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, '|' ORDER BY table_name, column_name)), 8)
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'scheduling\_%'
UNION ALL SELECT 'fn_fp', left(md5(string_agg(p.proname||md5(replace(p.prosrc, chr(13), '')), '|' ORDER BY p.proname)), 8)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'scheduling\_%'
UNION ALL SELECT 'trg_fp', left(md5(string_agg(tgname||tgenabled::text, '|' ORDER BY tgname)), 8)
  FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'scheduling\_%';
```

Pilot configuration to compare (counts and content hashes):

```sql
SELECT 'schedules', count(*), md5(string_agg(s::text, '|' ORDER BY id)) FROM scheduling_schedules s
UNION ALL SELECT 'offerings', count(*), md5(string_agg(s::text, '|' ORDER BY id)) FROM scheduling_offerings s
UNION ALL SELECT 'resources', count(*), md5(string_agg(s::text, '|' ORDER BY id)) FROM scheduling_resources s
UNION ALL SELECT 'settings', count(*), md5(string_agg(s::text, '|' ORDER BY s::text)) FROM scheduling_settings s
UNION ALL SELECT 'reservations', count(*), NULL FROM scheduling_reservations
UNION ALL SELECT 'holds', count(*), NULL FROM scheduling_resource_holds
UNION ALL SELECT 'occurrences', count(*), NULL FROM scheduling_occurrences;
```

Rehearsal values for the pilot copy: schedules 4 `218e5d78...`, offerings 4 `16f25b3e...`, resources 5 `4401bc8e...`, settings 1 `c7e82b3d...`, 0/0/0.
Production's hashes must match them unless someone changed pilot configuration since; the schedule and resource hashes include `updated_at`, so
any edit shows up.

---

# GATE A: migration 034

## A1. Preflight (read-only, Production)

```sql
SELECT version FROM scheduling_schema_migrations ORDER BY version;       -- includes 2a.2 and 2b.2.4; NOT 2b.3.1
SELECT (SELECT count(*) FROM scheduling_availability_rules) AS rules,
       (SELECT count(*) FROM scheduling_availability_exceptions) AS closures;   -- 0 | 0 (if not 0, inventory it and report; 034 never re-validates old rows)
SELECT table_name FROM information_schema.columns
 WHERE table_name IN ('scheduling_availability_rules','scheduling_availability_exceptions') AND column_name = 'updated_at';   -- no rows
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
   AND tgrelid IN ('scheduling_availability_rules'::regclass,'scheduling_availability_exceptions'::regclass);              -- 0
SELECT proname FROM pg_proc WHERE proname = 'scheduling_touch_updated_at';                                                  -- 1 row
```

Then record the section 3 fingerprints and pilot configuration. Confirm the Vercel deployment of `main` containing PR #499 is live.

## A2. Backup

Create a Neon branch from Production named `migration-backup/scheduling-availability-034-pre-<yyyymmdd>-<hhmm>z`. Record its id and the LSN. 034 is
additive and 095 reverses it, so this is a recovery point, not the rollback path. Keep it until A4 passes; delete it only on your say-so.

## A3. Execute

Neon SQL editor, **Production** branch, database `neondb`. Paste the committed `034_availability_integrity.sql` unedited (verify its SHA-256 from
`git show`). One transaction, `lock_timeout 5s`, `statement_timeout 120s`; if it cannot take its locks it fails and changes nothing, and can simply
be run again. Expected duration: well under a second.

## A4. Verify (read-only)

```sql
SELECT version FROM scheduling_schema_migrations WHERE version = '2b.3.1';                                -- 1 row
SELECT table_name, data_type, is_nullable FROM information_schema.columns
 WHERE column_name = 'updated_at' AND table_name IN ('scheduling_availability_rules','scheduling_availability_exceptions');   -- 2 rows, timestamptz, NO
SELECT tgname, tgenabled::text FROM pg_trigger WHERE NOT tgisinternal
   AND tgrelid IN ('scheduling_availability_rules'::regclass,'scheduling_availability_exceptions'::regclass) ORDER BY 1;     -- 4 rows, all O
SELECT proname, md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE proname LIKE 'scheduling\_availability\_%' ORDER BY 1;
--   exception_integrity 964334cde288e280d2d15ffc1e275ee3, lock_owner ec6ff1692bcb450fcfd842d62df33370, rule_integrity 889cc2be7a0b41d42ff5ec8d50ea81ba
```

Pilot configuration hashes and counts equal A1's. Then, as a signed-in **manager** of the pilot organisation (your own session; no test account is
created): `GET /api/scheduling/resources/<resource id>/availability` answers `200` with empty `rules`/`exceptions` and
`capabilities.partialClosures: false`. Make no write you do not intend to keep.

## A5. Rollback

`095_availability_integrity_rollback.sql`: one transaction, idempotent; drops the 4 triggers, 3 functions and 2 `updated_at` columns and removes
`2b.3.1`; deletes or changes no rule or closure. **Run 096 first if 035 has been applied** (095 does not touch the 035 columns, but 096's guard
restore depends on 034's function existing). After it the fingerprints equal A1's (rehearsed with data present) and the routes answer
`503 AVAILABILITY_NOT_READY`. If 034 fails, nothing is applied; do not edit the file; report the error. Restoring the backup branch is a last resort
and discards anything written since.

---

# GATE B: migration 035 (after Gate A has passed and been verified)

## B1. Preflight (read-only, Production)

```sql
SELECT version FROM scheduling_schema_migrations ORDER BY version;       -- includes 2b.3.1; NOT 2b.3.2
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'scheduling_availability_exceptions' AND column_name IN ('start_time','end_time');   -- no rows
SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE proname = 'scheduling_availability_exception_integrity';   -- 964334cde288e280d2d15ffc1e275ee3
SELECT count(*) FROM scheduling_availability_exceptions;                  -- note it: every existing closure becomes a whole-day closure by definition
```

Record the section 3 fingerprints. 035 needs the 2b.3.1 marker or it raises `SCVER` and changes nothing.

## B2. Backup

Branch `migration-backup/scheduling-availability-035-pre-<yyyymmdd>-<hhmm>z`, same convention and retention as A2.

## B3. Execute

Paste the committed `035_availability_partial_closures.sql` unedited into the Neon SQL editor on **Production** (SHA-256 above). One transaction; adds two
nullable columns, one CHECK and replaces one function; idempotent. Do **not** run 034 afterwards.

## B4. Verify (read-only)

```sql
SELECT version FROM scheduling_schema_migrations WHERE version = '2b.3.2';                               -- 1 row
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_name = 'scheduling_availability_exceptions' AND column_name IN ('start_time','end_time');  -- 2 rows, time, YES
SELECT conname FROM pg_constraint WHERE conname = 'scheduling_availability_exceptions_window_ck';       -- 1 row
SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE proname = 'scheduling_availability_exception_integrity';   -- 84d643d6cc5f9580795d07100ce563ad
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname LIKE 'scheduling\_availability\_%';   -- 4
SELECT count(*) FROM scheduling_availability_exceptions WHERE start_time IS NOT NULL OR end_time IS NOT NULL;   -- unchanged from before: 0
```

Pilot configuration equal to B1's. The availability `GET` now reports `capabilities.partialClosures: true`.

## B5. Rollback

`096_availability_partial_closures_rollback.sql`. **It refuses (`SCVER`, nothing changed) while any partial-day closure exists**, because dropping the
columns would silently turn it into a whole-day closure. Remove those closures first (rehearsed). Then it restores 034's guard body (md5
`964334cde...`), drops the CHECK and both columns and removes `2b.3.2`. Whole-day closures and weekly rules are untouched. Never run 034 as a
substitute for 096.

---

## Not part of this handoff

Timezone pinning (a possible `scheduling_settings.availability_timezone` column) is a separate, unapproved migration and is not part of 034 or 035. The pilot's data,
entitlements, accounts and memberships are not changed by anything here.
