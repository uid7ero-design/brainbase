# Scheduling migration 037 (availability versions): Production completion record

Status: **applied to Production and independently verified (read-only) on 2026-11-03.** Documentation only: this change contains no code, SQL or configuration.
Verified at `main` `1228f83d` (contains #518 `98ab440f`, #524 `44959d91`, #525 `0c06f387`).
Design: `scheduling-phase2c-availability-at-commit.md`. Sequence: `scheduling-phase2c-migration-plan.md`.

## 1. What happened (and what is not known)

| Fact | Evidence |
| --- | --- |
| Marker `2c.3.1` is in `scheduling_schema_migrations` | `applied_at = 2026-11-02T15:47:38.348795+00:00` (Production, read-only query) |
| A protected pre-migration backup branch was created 43 s earlier | Neon branch `br-flat-river-a7sgrqzy`, `migration-backup/scheduling-037-pre-20261102-1547z`, parent `br-lingering-bird-a7aif5zw`, parent LSN `0/33CD8EB8`, parent timestamp `2026-11-02T15:46:49Z`, created `2026-11-02T15:46:55Z`, `creation_source: console` |
| Who ran the migration, and by which method (Neon SQL editor or `run_sql_transaction`) | **Not recorded in any evidence read for this record.** The backup branch was created from the Neon console by the project owner's account, but that does not establish who executed the migration. |

## 2. Files (SHA-256 of the Git blob, LF; a Windows working copy has CRLF and hashes differently)

| File | SHA-256 |
| --- | --- |
| `packages/scheduling/sql/037_availability_versions.sql` | `e6e086a63d086dc90d7bc19ec9afd94c66f38412426cac9a0f411eb79b9f82d9` |
| `packages/scheduling/sql/098_availability_versions_rollback.sql` | `b10f26d35649a35019a9000d84d2531ee405c80f4bc69b46255ded5e4b507c37` |

Identical at `3848b14b` (#525), `1228f83d` and `origin/main`. Rollback 098 has **not** been run.

## 3. Production identity

Neon project `brainbase-db` (`empty-fire-62164682`), branch `production` = `br-lingering-bird-a7aif5zw`, database `neondb`, PostgreSQL 17.11, owner role `neondb_owner` (shared by BrainBase, LD Tennis and Eve; nothing in 037 changes a role or setting).

## 4. Verified schema (read-only, 2026-11-03)

Fingerprint query: section 6.1 of the 037 handoff (schema, functions, triggers, indexes, constraints, trigger states, markers, booking-table counts, version rows). Every value equals the rehearsed "expected after 037" value.

| Check | Production | Expected |
| --- | --- | --- |
| schema | `3712da5e` | `3712da5e` |
| functions | `4e7b6a3e` | `4e7b6a3e` |
| triggers | `27afd5a9` | `27afd5a9` |
| indexes | `39:7df8b564` | `39:7df8b564` |
| constraints | `118:58c10ab2` | `118:58c10ab2` |
| scheduling triggers enabled | `38/38` | `38/38` |
| version rows | `9 rows 8a7f68a9f77ef9da0d0845d77e1a4a6d` | same |
| markers | `2a.1-brainbase … 2b.3.3, 2c.3.1` | baseline + `2c.3.1` |
| pilot configuration hash | `e45c51b3a5b21893ba02fa42dedff05f` | unchanged from baseline |

Function bodies, `md5(prosrc)`, all five equal the values recorded in the handoff:

| Function | md5(prosrc) |
| --- | --- |
| `scheduling_availability_version_guard` | `b1cf00a87a3bdf1df258a6e33e3467e1` |
| `scheduling_availability_version_row` | `c336666b500d4e928926cfb335210c02` |
| `scheduling_bump_availability_version_of` | `6f418d4ce86b75f08854ee8176bf3788` |
| `scheduling_bump_availability_version` | `038a8ed92808a50bcc9b3f3263829a9b` |
| `scheduling_resource_active_bump` | `40e592cae4b11ea8270df21a879392ae` |

These are exact body-hash equalities. The migration file itself was not re-executed; the equivalence of Production to the file rests on these hashes, the aggregate fingerprints (which cover definitions of all `scheduling_*` functions, triggers, indexes and constraints) and the object checks below.

Object checks against the committed file:

- Table columns: `organisation_id text NOT NULL`, `resource_id text`, `offering_id text`, `owner_kind` and `owner_id` generated stored (`CASE`/`COALESCE` as in the file), `version bigint NOT NULL DEFAULT 0`.
- Constraints: `…_pk` PRIMARY KEY `(organisation_id, owner_kind, owner_id)` (the only index); `…_owner_ck` `num_nonnulls(resource_id, offering_id) = 1`; `…_version_ck` `version >= 0`; composite foreign keys `(resource_id, organisation_id)` to `scheduling_resources(id, organisation_id)` and `(offering_id, organisation_id)` to `scheduling_offerings(id, organisation_id)`, both `ON DELETE CASCADE` (database-enforced tenant isolation).
- Eight triggers, all enabled (`O`): `scheduling_availability_versions_forward` (BEFORE UPDATE, forward-by-one, `SCIMM`), `scheduling_offerings_version_row`, `scheduling_resources_version_row`, and bump triggers on rules, exceptions, zones, offering-resource links and `scheduling_resources_active_bump` (`AFTER UPDATE OF active … WHEN new.active IS DISTINCT FROM old.active`).
- Marker description equals the file's text.
- Ownership: table and all five functions owned by `neondb_owner`, none `SECURITY DEFINER`. Table ACL is NULL (default), the same as the neighbouring `scheduling_availability_rules`, `…_zones` and `scheduling_resources`. No grants were added or changed.
- Compatibility with 030–036: the constraint, index and trigger fingerprints equal the rehearsal built on a copy of Production with 030–036 applied; the 30 pre-existing scheduling triggers are unchanged (`38/38` = 30 + 8).
- Quiet: 0 idle-in-transaction sessions, 0 ungranted locks, 0 prepared transactions.

## 5. Pilot preservation (organisation `422aba11-12e0-43be-9a59-9b31976f5973`, ZZ Scheduling Internal Test)

- 4 schedules, 4 offerings, 5 resources, 3 offering-resource links; 0 closures.
- 1 availability rule: Monday 09:00-12:00 on offering `d13849d2-b812-4b8a-bb7c-29b893359b4e`.
- 1 timezone pin: that offering, `Australia/Adelaide`, source `first_rule`.
- Pilot configuration hash `e45c51b3a5b21893ba02fa42dedff05f`, equal to the baseline recorded before the migration.
- 9 version rows (4 offering + 5 resource), all version 0, all in the pilot organisation. 0 rows with a missing owner, 0 offerings or resources without a row, 0 owner/organisation mismatches.
- 0 reservations, 0 resource holds, 0 occurrences, 0 series.
- Version 0 everywhere is expected: no availability-affecting edit has been made since the migration.

## 6. Application state

- Public health (2026-11-03): `https://hlna.com.au/api/health/db` 200 `{"ok":true}`; `https://hlna.com.au/login` 200; `https://eveevents.com.au/` 200; `https://www.ldtennis.com.au/` 307 to `/tennis`, which returns 200.
- Main `1228f83d`: CI `checks` and `eve` success; Vercel statuses "brainbase" and "eve" success.
- No booking-writing route: at `1228f83d` there are 26 route files under `app/api/scheduling`, none named for reservations, bookings, occurrences, series, holds, enrolments or payments; nothing under `app/`, `lib/` or `components/` references the booking repositories, the booking tables or `scheduling_availability_versions`. The 2C.1 containment test pins this.
- Not available to this verification: Vercel runtime logs and deployment lists (the Vercel connector returned 403 for the team). Absence of migration-related database errors in runtime logs is therefore **not verified here**; the health endpoint and the unchanged pilot read are the only runtime evidence.

## 7. Regression and concurrency evidence

From the handoff rehearsal (disposable branch from Production, exact committed statements) and the #525 review. This record did not re-run them.

- PostgreSQL 16.14 and 17.11: the Phase 2C proofs pass 87/87 each; the Phase 2A suites pass 90/90 with 037 applied. Without the migration the booking-at-commit tests fail (14 of 18), so they exercise it.
- Real Neon HTTP driver, committed suite 12/12 (two runs, on two disposable branches): stale version writes nothing; closure-first refuses and booking-first stands; both race directions; deactivation and unlinking cannot bypass; 8 parallel overlapping requests give 1 winner and 7 `23P01`; one idempotency key gives one reservation; another organisation is refused; an abort mid-statement cancelled the statement (0 rows) and the retry converged to 1; a response lost after commit is resolved only by the idempotency key.
- Gate proofs 12/12 on the rehearsal branch (cross-organisation, kind change `SCRIU`, unlink `SCALU`, timeouts `57014`/`55P03`, version movement by exactly 1).
- Lock ordering: 60-way stress with no `40P01`; offering is always locked before resource.
- Slot grid and DST: #524 differential over 800 seeded scenarios, and the PG16/17 calendar proofs.
- The 2C.2 read side (#518) is reads only.

Evidence limits: the gate-proof test files are not committed (they sit untracked in a local worktree), and the rehearsal branch `br-lingering-dawn-a7z1x3o4` named in the handoff was not found in the project in this verification. Earlier rehearsal branch `br-super-math-a74e5s2u` still exists and has not been touched.

## 8. Remaining risks and open items (for Phase 2C.3)

- Offering duration and other offering/schedule settings are not versioned: 2C.3 must require `ends - starts = offering.duration_minutes` under the offering's `FOR SHARE` lock, or a later migration must bump on a duration edit.
- A hand `DELETE` of a version row is not blocked; that owner then fails closed until 037 is re-applied (it re-backfills).
- `scheduling_is_timezone()` costs about 11 ms per call on the rehearsal compute (73 ms cold); it runs once per reservation insert. Unmeasured on Production. Optimise before any bulk series write.
- Server-side timeout must be per transaction (`SET LOCAL statement_timeout` and `lock_timeout` in the same non-interactive batch); do not `ALTER ROLE` (the role is shared with LD Tennis and Eve).
- Rollback 098 is safe today (nothing reads the table). Once a booking path exists, switch it off before running 098.
- Index migration 041 and the deterministic calendar keyboard-scroll regression remain open and are outside this migration.
- The executor and method of the Production apply are unrecorded.

## 9. Backups

- `br-flat-river-a7sgrqzy` (037 pre-migration) kept.
- Earlier protected backups kept: `br-cold-sunset-a73datgx` (034), `br-damp-voice-a7hquxpb` (035), `br-steep-salad-a7r4thmc` (036).
- Rehearsal branch `br-super-math-a74e5s2u` kept; deletion needs separate approval.
