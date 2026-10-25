# Scheduling migrations 034, 035 and 036 (availability): Production handoff

Status: **prepared, NOT executed.** Nothing here has been run against Production. All three migrations are owner-run in the manual Neon SQL editor, each
needs its **own explicit approval**, and merging code never applies any of them: the application does not run migrations.

Replaces `scheduling-migrations-034-035-production-handoff.md` (kept for its record of the 2026-10-25 rehearsal). The order is fixed: **034, verify, then 035,
verify, then 036, verify.** Rollback is the reverse: **097, then 096, then 095.** Never re-run 034 after 035 (it would put the date-only closure guard back).

What the application does until each gate has been passed (all verified by tests, section 3):

| Applied | Reading hours | Creating hours / closures | Removing | Partial-day closures |
| --- | --- | --- | --- | --- |
| nothing (today) | `503 AVAILABILITY_NOT_READY` | `503 AVAILABILITY_NOT_READY`, nothing written | `503` | `503` |
| 034 | works (empty) | `503 AVAILABILITY_ZONES_NOT_READY`, nothing written | works | `503 PARTIAL_CLOSURES_NOT_READY` |
| 034 + 035 | works | `503 AVAILABILITY_ZONES_NOT_READY`, nothing written | works | works only once 036 lets a closure be created |
| 034 + 035 + 036 | works | works; the owner's zone is pinned in the same statement as its first rule or closure | works | works |

## 1. Files and exact committed SHA-256

Hash the committed bytes (LF). A Windows checkout may be CRLF, so use `git show <commit>:<path> | sha256sum`.

```
034_availability_integrity.sql                       ac2fd239fb4650bef8a414557781c6e6b0efd76390f34a962cae9e14d3b213ab   (on main)
095_availability_integrity_rollback.sql              9d9a42665120da544dc1d0279e1f27e0f9b076304ba630517cbbddf1957573d2   (on main)
035_availability_partial_closures.sql                91f60dcd1b0a72a747a0d1b672c6a42f7388567d150609f6ac12e0196af2f93c   (on main)
096_availability_partial_closures_rollback.sql       22595731ece3ba8e1c78462d6e65c081fdc388f10012dd2c518051c4adcaa210   (on main)
036_availability_zones.sql                           68b24e2dd51640a62050823801d4e89bc6eb73b2db6160fc907a75cce531f628   (the persistence PR; re-verify on main after the merge)
097_availability_zones_rollback.sql                  ba0bbf55541fa521ca05d7a3204212be1951f14b621b8ab982a8a19a6b56563b   (the persistence PR; re-verify on main after the merge)
```

`md5(replace(prosrc, chr(13), ''))` of the functions each migration leaves behind:

```
034  scheduling_availability_lock_owner            ec6ff1692bcb450fcfd842d62df33370
034  scheduling_availability_rule_integrity        889cc2be7a0b41d42ff5ec8d50ea81ba
034  scheduling_availability_exception_integrity   964334cde288e280d2d15ffc1e275ee3     (035 replaces it with 84d643d6cc5f9580795d07100ce563ad)
036  scheduling_availability_zone_guard            513304b5b2ba5088f45da0ae69120a18
036  scheduling_availability_zone_required         18960d67bbba5cfd43f0a67035fb115e
```

## 2. Rehearsal (2026-10-25/26, fresh Neon branch derived from Production)

Branch `rehearse/scheduling-034-035-036-20261026` (`br-red-firefly-a7b237wk`), created from the Production branch at LSN `0/2F633498`, project `empty-fire-62164682`,
database `neondb`. Every statement below ran on that branch only. Each file ran as the same statements, **one transaction per file** (the Neon tool runs a
statement list as one transaction). The fingerprint queries are those of section 4.

| State | schema_fp | fn_fp | trg_fp | versions |
| --- | --- | --- | --- | --- |
| baseline (Production copy) | `ba7b7014` | `d5b9221c` | `597be2fb` | `2a.1-brainbase .. 2b.2.4` |
| after 034 + 035 | `0743dca9` | `6de539fc` | `fc9b72b7` | `.. 2b.3.1, 2b.3.2` |
| after 036 | `5a19f258` | `6d2b8e6f` | `83133d61` | `.. 2b.3.3` |

Baseline inventory: 0 rules, 0 closures, 4 schedules, 4 offerings, 5 resources, 0 reservations, holds and occurrences; schedule timezones all NULL; the pilot
organisation `Australia/Adelaide`.

- **034 and 035:** function bodies equal the committed files by hash; four enabled triggers; marker rows present.
- **036:** both function bodies equal the committed file by hash; three enabled zone triggers; marker `2b.3.3`; the table exists with its constraints.
- **Database enforcement (15 cases):** a rule or closure without a pin is `SCZON`; one naming another organisation's owner is a foreign-key error (`23503`); an
  invalid zone, an invalid source or two owners is `23514`; a pin under the wrong organisation is `23503`; a second pin for an owner is `23505`; updating a pin's
  zone or organisation is `SCZON`; deleting a pin while its owner exists is `SCZON`; after a valid pin a rule is accepted and an overlapping one is still
  `SCOVL`; a pin whose owner is deleted goes with it.
- **Real Neon HTTP driver (`@neondatabase/serverless`, the application's own driver) against this branch, with a disposable role:** *before* 036, reads work and
  every create is refused (`AvailabilityZonesNotReadyError`, the driver reporting `42P01`) with nothing written (5 tests); *after* 036, 18 tests pass:
  first-write pinning in one request, refused first writes leaving no pin, 12 simultaneous first writes naming 12 zones leave one pin, racing identical windows,
  a first rule racing a first closure, stale writes, overlap/archived/inactive guards, overnight create and remove (8 simultaneous removals: one wins), partial-day
  closures, tenant isolation, a shared resource with offerings of two schedules, and that creating a pin changes no row of schedules, offerings or resources.
  The role's credential was a local random secret (the API-issued password was refused afterwards); it and its grants live only on the rehearsal branch.
- **Rollback with data (a rule and a partial-day closure present):** `097` first **refused** (`SCVER`, nothing changed) while the pinned zone differed from what the
  reader resolves; once the organisation's zone matched, `097` ran and the fingerprints equalled the independent 034+035 branch exactly; `096` **refused** while the
  partial-day closure existed, ran after it was removed; `095` then returned all three fingerprints to the baseline exactly, the rule kept.
- **Reapplication:** `034`, `035`, `036` re-applied in order; `036` rebuilt the pin by backfill (source `backfill`, the zone the reader resolved); fingerprints equal the
  first post-036 state; `036` applied a second time: identical fingerprints (idempotent).
- **Pilot data:** schedules, offerings, resources, scheduling settings and the Scheduling `organisation_modules` row have the same count and content hash as the baseline
  after the whole sequence; the pilot organisation's timezone is unchanged; 0 pilot pins, rules and closures; 0 reservations, holds and occurrences.

Limits: overlap and concurrency are proven on real PostgreSQL 16.14 and 17.11 (`bash scripts/tests/verify-scheduling-phase2b3c.sh 16|17`) and over the real Neon HTTP driver
(separate HTTP requests are separate server connections); the Neon SQL tool used for the statement runs may serialise calls. The pilot-data comparison is against a copy of
Production, not Production itself (no Production SQL was run). The rehearsal branch holds synthetic organisations `zz-drv-a` and `zz-drv-b` and a role `driver_proof`; it is kept
until you say it can be deleted, together with `br-solitary-hat-a7u52qm5` and `br-delicate-cloud-a7omr0aw`.

## 3. What each gate changes, and what cannot

| | 034 | 035 | 036 |
| --- | --- | --- | --- |
| Adds | `updated_at` on rules and closures, 3 functions, 4 triggers, marker `2b.3.1` | `start_time`/`end_time` on closures, a CHECK, a replaced guard, marker `2b.3.2` | one table (`scheduling_availability_zones`), 2 functions, 3 triggers, marker `2b.3.3` |
| Existing rows | gain a version token | unchanged (no window = whole day) | unchanged; owners that have availability are pinned by backfill (none in Production) |
| Touches | availability tables | the closures table | **nothing else**: not `organisations`, schedules, offerings, resources, reservations, holds, occurrences or any version token |
| Production effect | none until used | none until used | none until the first hours are saved |

It does not touch LD Tennis, Eve, users, entitlements or memberships.

## 4. Fingerprint queries (identical before and after, on Production, read-only)

```sql
SELECT 'schema_fp', left(md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, '|' ORDER BY table_name, column_name)), 8)
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'scheduling\_%'
UNION ALL SELECT 'fn_fp', left(md5(string_agg(p.proname||md5(replace(p.prosrc, chr(13), '')), '|' ORDER BY p.proname)), 8)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'scheduling\_%'
UNION ALL SELECT 'trg_fp', left(md5(string_agg(tgname||tgenabled::text, '|' ORDER BY tgname)), 8)
  FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'scheduling\_%'
UNION ALL SELECT 'versions', string_agg(version, ',' ORDER BY version) FROM scheduling_schema_migrations;
```

Pilot configuration (counts and content hashes; the rehearsal values are the Production copy's):

```sql
SELECT 'schedules', count(*)::text||' '||md5(string_agg(s::text, '|' ORDER BY id)) FROM scheduling_schedules s            -- 4 218e5d787924336fb434bd65ea3e45d7
UNION ALL SELECT 'offerings', count(*)::text||' '||md5(string_agg(s::text, '|' ORDER BY id)) FROM scheduling_offerings s   -- 4 16f25b3e5cb0f2d66e555e1cc6a8c7e3
UNION ALL SELECT 'resources', count(*)::text||' '||md5(string_agg(s::text, '|' ORDER BY id)) FROM scheduling_resources s   -- 5 4401bc8eb6ee02452f16f01281dd735e
UNION ALL SELECT 'settings', count(*)::text||' '||md5(string_agg(s::text, '|' ORDER BY s::text)) FROM scheduling_settings s -- 1 c7e82b3d77df2ee66cb26c6ee1723405
UNION ALL SELECT 'reservations/holds/occurrences', (SELECT count(*) FROM scheduling_reservations)||'/'||(SELECT count(*) FROM scheduling_resource_holds)||'/'||(SELECT count(*) FROM scheduling_occurrences); -- 0/0/0
```

Production's hashes must match unless someone changed pilot configuration since (the schedule and resource rows include `updated_at`, so any edit shows).
The baseline fingerprints for Production are `ba7b7014`, `d5b9221c`, `597be2fb` while nothing is applied; if they differ, find out why before going on.

---

# GATE A: migration 034

## A1. Preflight (read-only, Production)

```sql
SELECT version FROM scheduling_schema_migrations ORDER BY version;       -- includes 2a.2 and 2b.2.4; NOT 2b.3.1
SELECT (SELECT count(*) FROM scheduling_availability_rules) AS rules, (SELECT count(*) FROM scheduling_availability_exceptions) AS closures;   -- 0 | 0
SELECT table_name FROM information_schema.columns
 WHERE table_name IN ('scheduling_availability_rules','scheduling_availability_exceptions') AND column_name = 'updated_at';   -- no rows
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('scheduling_availability_rules'::regclass,'scheduling_availability_exceptions'::regclass);   -- 0
SELECT proname FROM pg_proc WHERE proname = 'scheduling_touch_updated_at';   -- 1 row
```

Record the section 4 fingerprints and pilot configuration. Confirm the deployment of `main` that contains the three code PRs is live.

## A2. Backup
Neon branch from Production named `migration-backup/scheduling-availability-034-pre-<yyyymmdd>-<hhmm>z`; record its id and the LSN. Keep it until A4 passes; delete only on your say-so.

## A3. Execute
Neon SQL editor, **Production** branch, database `neondb`. Paste the committed `034_availability_integrity.sql` unedited (verify its SHA-256 from `git show`). One transaction with `lock_timeout 5s`; if it cannot take its locks it changes nothing and can be run again. Well under a second.

## A4. Verify (read-only)
`2b.3.1` present once; `updated_at` is `timestamptz NOT NULL` on both tables; four enabled triggers (`..._exceptions_integrity`, `..._exceptions_touch`, `..._rules_integrity`, `..._rules_touch`);
the three function bodies match section 1; the section 4 fingerprints changed and the pilot configuration did not. Signed in as a manager of the pilot organisation (your own session):
`GET /api/scheduling/resources/<id>/availability` answers `200` with empty `rules` and `exceptions`, `capabilities.zones: false` (before it answered 503).

## A5. Rollback
`095_availability_integrity_rollback.sql`: one transaction, idempotent; drops the four triggers, three functions and two `updated_at` columns and removes `2b.3.1`; deletes no rule or closure. **Run 097 and 096 first if they have been applied.** The fingerprints return to the baseline (rehearsed with data).

---

# GATE B: migration 035 (after Gate A has passed)

## B1. Preflight
`2b.3.1` present, `2b.3.2` absent; no `start_time`/`end_time` columns on `scheduling_availability_exceptions`; `scheduling_availability_exception_integrity` has md5 `964334cd...`; record the fingerprints.

## B2. Backup
`migration-backup/scheduling-availability-035-pre-<yyyymmdd>-<hhmm>z`, same convention.

## B3. Execute
Paste the committed `035_availability_partial_closures.sql` unedited. One transaction; two nullable columns, one CHECK, one replaced function; idempotent. **Do not run 034 afterwards.**

## B4. Verify
`2b.3.2` present; two `time` columns, nullable; the CHECK `scheduling_availability_exceptions_window_ck`; the guard body md5 `84d643d6...`; four enabled availability triggers; no closure has a window; pilot configuration unchanged.

## B5. Rollback
`096_availability_partial_closures_rollback.sql`. **It refuses (`SCVER`, nothing changed) while any partial-day closure exists** (rehearsed): remove those closures first. Then it restores 034's guard (md5 `964334cd...`), drops the CHECK and columns, removes `2b.3.2`. **Run 097 first if 036 has been applied.**

---

# GATE C: migration 036 (after Gate B has passed)

## C1. Preflight (read-only, Production)

```sql
SELECT version FROM scheduling_schema_migrations ORDER BY version;       -- includes 2b.3.1 and 2b.3.2; NOT 2b.3.3
SELECT to_regclass('scheduling_availability_zones');                     -- NULL
SELECT to_regprocedure('scheduling_is_timezone(text)');                  -- present
SELECT (SELECT count(*) FROM scheduling_availability_rules) AS rules, (SELECT count(*) FROM scheduling_availability_exceptions) AS closures;   -- 0 | 0: the backfill is empty
SELECT id, timezone FROM organisations WHERE id IN (SELECT organisation_id FROM scheduling_settings);   -- the pilot organisation: Australia/Adelaide (informational)
SELECT id, timezone FROM scheduling_schedules;                           -- all NULL (informational)
```

If rules or closures exist, **stop**: inventory them and report; the backfill would pin each owner to the zone the reader resolves (schedule override, else organisation, else `Australia/Adelaide`),
which is correct but must be reviewed first. Record the fingerprints and pilot configuration.

## C2. Backup
`migration-backup/scheduling-availability-036-pre-<yyyymmdd>-<hhmm>z`.

## C3. Execute
Paste the committed `036_availability_zones.sql` unedited (SHA-256 above, verified against `main`). One transaction; it creates one table and five objects; idempotent; it refuses (`SCVER`) without 2b.3.1. Well under a second on an empty table.

## C4. Verify (read-only)

```sql
SELECT version FROM scheduling_schema_migrations WHERE version = '2b.3.3';                                        -- 1 row
SELECT to_regclass('scheduling_availability_zones');                                                              -- the table
SELECT tgname, tgenabled::text FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
  ('scheduling_availability_zones_immutable','scheduling_availability_rules_zone','scheduling_availability_exceptions_zone') ORDER BY 1;   -- 3 rows, all O
SELECT proname, md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE proname LIKE 'scheduling\_availability\_zone%' ORDER BY 1;
--   scheduling_availability_zone_guard 513304b5b2ba5088f45da0ae69120a18, scheduling_availability_zone_required 18960d67bbba5cfd43f0a67035fb115e
SELECT count(*) FROM scheduling_availability_zones;                                                               -- 0 (nothing to backfill)
```

The section 4 fingerprints differ from Gate B's only by the new objects; the pilot configuration is unchanged; reservations/holds/occurrences 0/0/0. Then, as a manager of the pilot organisation
(your own session; no account is created): `GET /api/scheduling/resources/<id>/availability` answers `200` with `capabilities.zones: true` and `zone: { pinned: false, timezone: "Australia/Adelaide" }` (a read pins nothing).
**Do not save hours as part of verification** unless you intend to keep them: the first save pins that owner's zone permanently.

## C5. Rollback
`097_availability_zones_rollback.sql`: one transaction, idempotent; drops the two availability triggers, the table, the two functions and `2b.3.3`; no rule or closure is touched.
**It refuses (`SCVER`, nothing changed) while an owner that has availability is pinned to a zone the reader would not resolve** (rehearsed): rolling back would silently re-read those hours in another zone.
Pins of owners with no availability are dropped. After it, creating hours answers `503 AVAILABILITY_ZONES_NOT_READY` again.

---

## Not part of this handoff
Changing a pinned zone is not offered by any migration, screen or API (`docs/architecture/scheduling-availability-zones.md`, "Changing a zone"). The pilot's data, entitlements, accounts and memberships are not changed by anything here.
