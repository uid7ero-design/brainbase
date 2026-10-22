# Scheduling Phase 2A: rehearsal and test evidence

Date: 2026-10-22 (final corrections re-run on the same day). Nothing was applied to Production or to any shared Preview database. Every database below was
disposable.

## 1. Disposable Postgres (Docker): `scripts/tests/verify-scheduling-phase2a.sh [16|17]`

A fresh `postgres:<n>-alpine` container per run, removed on exit. Steps and results (identical on 16.14 and 17.11):

| Step | Result |
| --- | --- |
| Preflight on an empty database | runs clean |
| `010` applied twice | idempotent (second apply creates nothing) |
| `020` verification | version marker, 13 tables, exclusion constraint, 0 legacy dependencies |
| `110` twice, `190`, `110`, `190` | idempotent and reversible |
| Suites, one file at a time | contract 13, exclusive 13, appointments 21, concurrency 27, contention 16, schema 32, repositories 28 = **150 pass** on 16.14 and on 17.11 |
| `090` while reservations exist | **refuses** (data guard) |
| `090` after clearing test data | removes every `scheduling_*` table; an unrelated sentinel table is untouched |
| `010` re-applied | clean |

Raw logs: `scheduling-phase2a-evidence/docker-pg16-proof.txt` and `docker-pg17-proof.txt`. On the Postgres 17 run the vitest worker
process died once during the contention suite (no assertion failed) and the script's dead-worker retry re-ran it, which passed;
see `scheduling-phase2a-contention.md` section 6.

Unit and boundary tests (no database): 251 in the `packages` project (includes the 14 DST tests, the error-mapping table
and the boundary checks); 12 Phase 2A containment tests.

## 2. Mutation checks (do the tests bite?)

One guard was broken at a time on a fresh schema and the suites re-run without re-migrating.

| Mutation | Detected by |
| --- | --- |
| capacity trigger removed | contract (2), concurrency (10), exclusive (1), schema (2) |
| exclusion constraint removed | exclusive (4), concurrency, repositories (2) |
| duplicate-email index removed | contract (1), concurrency, schema (1) |
| release-holds-on-cancel trigger removed | exclusive (2), schema (2) |
| lifecycle/snapshot trigger removed | contract, exclusive, concurrency, schema, repositories |
| hold guard (no reactivation) removed | exclusive (1), schema (2) |
| hold to resource foreign key removed | **not detected at first** (the reservation FK masks it); a direct test was added and then detects it |
| occurrence guard removed / require-hold trigger removed | schema (2 each) |
| half-open CHECK removed | schema (verified directly) and concurrency |
| per-resource advisory lock removed | the regression test: 3 of 3 runs fail with 14 to 28 raw `40P01` |
| TypeScript: tenant filter dropped from `getById` | contract (1) |
| TypeScript: domain validation skipped | repositories (4) |
| TypeScript: published-only restriction removed | repositories (11; caused indirectly by a broken parameter list, so this one detects, but not for the intended reason) |

### 2.1 Mutation checks added in the final corrections

Each rule was broken on its own and a test failed for it (restored afterwards):

| Mutation | Detected by |
| --- | --- |
| preset/span CHECK dropped | schema suite |
| preset resource-kind test made permissive | appointments suite |
| customer link/active condition removed | appointments suite |
| candidate query ignores inactive resources | appointments suite |
| candidate query ignores which offering a resource is linked to | appointments suite |
| assignment tries only the first candidate | appointments suite (2 tests) |
| `55P03` left unmapped | concurrency suite (4) and error unit tests (3) |
| lock timeout reported as `resource_conflict` | concurrency suite (4) and error unit tests (4) |
| deadlock `40P01` disguised as `resource_conflict` | concurrency suite (real deadlock test) and error unit tests (3) |
| every error treated as retryable | retry unit tests (2) |
| appointments requirement back to optional | appointment unit tests (6) |

Two earlier mutations were first written in a way that broke the SQL instead of the rule; they were re-run with a precise
change (the first attempt is not counted as evidence).

## 3. Neon rehearsal: disposable branch of `brainbase-db` (PostgreSQL 17.11)

Branch `temp/scheduling-2a-rehearsal-20261022` (copy of Production, throwaway role `sched_2a_tester`, granted `CREATE` on
`public` on that branch only). Production and every other branch untouched. Script:
`scripts/tests/rehearse-scheduling-2a-neon.cjs`.

| Check | Result |
| --- | --- |
| Preflight on the copy | PG 17.11, no `scheduling_*`, `btree_gist` 1.7 available, `organisations.id` text, baseline **212 / 58 / 64** |
| `010` first apply and second apply | pass; the role is not a superuser and installed the extension itself |
| Inventory | **225 / 69 / 80** = +13 tables, +11 functions, +16 triggers |
| `020` verification | all eight checks match their EXPECTED notes (one note corrected: the constraint prints `WHERE ((released_at IS NULL))`) |
| `110` twice, `190`, `110` | exactly 3 FKs, all to `organisations`; reversible |
| Upgrade path | the later `010` (adds function-level `lock_timeout`) applied in place over the live schema |
| Driver x connection matrix, 17 tests per cell | **68 pass**: Neon HTTP, Neon WebSocket pool (and node-postgres elsewhere) against the **direct** and the **pooled** (PgBouncer) host. Each cell runs the shared contract suite (13), 30 racers for 5 places, 30 racers for one court slot, overlapping-range deadlock regression, idempotent retries + cancel |
| Full suites, direct host | contract 13, exclusive 13, concurrency 23, repositories 28, schema 29 |
| Full suites, pooled host | contract 13, exclusive 13, concurrency 21 (+2 skipped), repositories 28, schema 29 |
| Rollback | `090` returned the branch to **212 / 58 / 64**; 0 scheduling tables; only `scheduling_ext` + `btree_gist` remain, as documented |

### Honest limits of the rehearsal

- Two concurrency tests need a real session (`BEGIN ISOLATION LEVEL ...`, distinct backend connections) and are skipped
  on the pooled host by design: PgBouncer transaction mode does not keep sessions. The refusal of REPEATABLE READ is
  therefore proven on the direct host only. No code path in this design uses those features.
- Not measured: behaviour at realistic volume (the per-resource lock serialises writes to one resource; each is a few
  milliseconds), long-running lock waits beyond the 5 s bound, Prisma drift reporting, mixed hourly and nightly use of
  one resource at scale.
- One vitest worker process died once on the Postgres 17 container run ("Worker exited unexpectedly"); the same suite
  then passed 8 of 8 standalone runs and two full harness runs. Treated as a tooling flake of this Windows machine, not
  a product failure; noted for completeness.
- The deadlock described in `scheduling-phase2a-schema.md` section 3 was found by running the suites repeatedly; it
  appeared on Docker before it was looked for on Neon. The fix was then proven on both.

## 3.1 Neon final-corrections run (disposable branch `br-muddy-wind-a7bfn6m9`, PostgreSQL 17.11)

The same disposable branch was reused (no further copy of production data). It started at exactly 212 tables / 58 functions / 64
triggers, with no scheduling objects.

| Step | Result |
| --- | --- |
| preflight, `010` twice, `020` | pass; second apply reproduces every scheduling function, trigger, index, constraint and column definition **byte for byte** |
| Fingerprint of every non-scheduling object (6,917 relation, column, index, constraint, trigger and function definitions) | **identical** before, after `010`, and after `110` / `190` |
| inventory | 225 / 69 / 80 after apply (+13 tables, +11 functions, +16 triggers) |
| `110` twice, `190`, `110` | exactly 3 foreign keys, all to `organisations`; removed cleanly |
| Suites, **direct** host | contract 13, exclusive 13, appointments 21, concurrency 27, contention 16, schema 32, repositories 28, driver matrix 76: **all pass** |
| Suites, **pooled** (PgBouncer) host | same, with 2 session-state concurrency tests and 1 contention test skipped by design (they need a real session): **all pass** |
| `090` after truncating test data | branch back to exactly **212 / 58 / 64**, 0 scheduling tables |

Driver matrix (76 tests): Neon HTTP, Neon WebSocket, each against direct and pooled hosts, now also covering the stuck-lock
`contention_timeout` mapping and array-parameter assignment through each driver. Raw logs are in
`scheduling-phase2a-evidence/`.

## 4. CI-equivalent commands

See the PR description for the results of `npx tsc --noEmit`, the CI `vitest run` with its three excludes, and
`npx eslint .` on this branch.

## 5. Clean-up

The Neon branch and its throwaway role were approved for deletion after this evidence was saved into
`scheduling-phase2a-evidence/`; see the PR for confirmation. Docker containers are removed by the scripts. No secret is committed; the connection strings were
kept in a scratch file outside the repository.
