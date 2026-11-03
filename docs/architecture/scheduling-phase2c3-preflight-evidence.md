# Scheduling Phase 2C.3 preflight: evidence

Date: 2026-11-03. Baseline: `main` `e490f4ba` (migration 037 / `2c.3.1` applied to Production and verified; completion record in PR #528).
Status: evidence only. No booking-writing route, no flag, no Production SQL, no Production booking, no change to LD Tennis or Eve, no new migration applied anywhere.

**Where each number comes from.** Three kinds of environment are kept apart throughout:

| Label | What it is |
| --- | --- |
| LOCAL | disposable Docker PostgreSQL 16 / 17, created and removed by `scripts/tests/verify-scheduling-phase2c.sh` |
| NEON-DISPOSABLE | Neon branch `br-patient-haze-a7ynj7wy` (`rehearse/scheduling-2c3-preflight-20261103`), a copy of Production data taken 2026-11-03 10:06Z, real `@neondatabase/serverless` HTTP driver, role `rehearsal_037` (not the application role), synthetic organisations only |
| PRODUCTION | read-only fingerprint queries only; nothing was measured or written there |

## 1. Production unchanged

The handoff fingerprint query (section 6.1 of the 037 handoff), run read-only against `br-lingering-bird-a7aif5zw` at the start and again at the end of this work, returned the verified post-037 values both times: schema `3712da5e`, functions `4e7b6a3e`, triggers `27afd5a9`, indexes `39:7df8b564`, constraints `118:58c10ab2`, triggers enabled `38/38`, markers through `2c.3.1`, booking tables `0/0/0/0`, version rows `9 rows 8a7f68a9f77ef9da0d0845d77e1a4a6d`.

## 2. Committed concurrency evidence (replaces the uncommitted "gate" files)

Two untracked files from the 037 gate were reviewed. `neonHttpAvailabilityVersions.gate…` was the committed suite with only the host constant changed, so it was not integrated. `neonHttp037Gate.rehearsal…` held 12 genuinely new proofs and is now `neonHttpBookingGates.integration.test.ts`, adapted rather than copied:

- no credential in the file (the URL comes from `NEON_REHEARSAL_URL`); `NEON_REHEARSAL_HOST` must name the endpoint, the role must be exactly `rehearsal_037`, 037 must be present, otherwise the suite refuses to run;
- the hard-coded (since deleted) rehearsal host and the hard-coded pilot organisation id were removed (the pilot is optional, read-only, via `NEON_REHEARSAL_PILOT_ORG`);
- sleeps (`sleep(500)`) were replaced by observed interleavings: the test waits until `pg_stat_activity` shows the booking inside its `pg_sleep` and the writer blocked on a lock, using leading-comment markers because `pg_stat_activity` truncates query text at 1,024 bytes;
- cleanup now removes the synthetic organisations and their offerings, resources and schedules;
- the former "FINDING" test (a duration edit books the old length) became the proof of the offering-token decision.

NEON-DISPOSABLE result: **12 of 12 on two consecutive runs after one fix** (the first run was 11 of 12 and exposed a bug in my new archive test: the driver's query object is a lazy thenable and must be started before it is observed).

Covered through the real driver: availability changed first leaves no reservation and no hold; 8 parallel overlapping windows give exactly one winner (the rest `23P01`); a kind change of a linked resource is refused (`SCRIU`); deactivation racing an in-flight booking is observed waiting, then refused; unlink while booked is refused (`SCALU`) and moves no version; every version source moves its owner by exactly one (and `active` set to the same value by zero); an archive waits for an in-flight booking; an archived schedule is refused (`SCARC`); `SET LOCAL statement_timeout` gives `57014`, writes nothing and does not leak; `SET LOCAL lock_timeout` behind a configuration writer gives `55P03`, writes nothing; another organisation can neither move, rewind, re-own nor forge version rows and books nothing with this organisation's ids; the pilot organisation's snapshot is identical before and after with no reservation or hold; the offering-token decision (section 3).
The earlier committed suite (`neonHttpAvailabilityVersions`, 12 tests: stale version, closure first/after, both race directions, idempotency key, abort mid-statement, lost response) is unchanged and was green twice on its own disposable branch.

LOCAL: `availabilityVersions` 15, `availabilityAtCommit` 18, `offeringConfigAtCommit` 14, `bookingReads` 24, overlay 30: **101 of 101 on PostgreSQL 16 and on PostgreSQL 17**.

## 3. Offering configuration at commit

See `scheduling-phase2c3-offering-config-at-commit.md`. Decision A (offering edit token inside the statement). Failing first: 9 of 14 fail with the token clause disabled; 14 of 14 pass on PG16 and PG17.

## 4. Performance (NEON-DISPOSABLE unless stated; client = this machine over the internet to ap-southeast-2)

Final run, medians in ms (n in brackets). A `SELECT 1` costs 29.8 (20): that is the network floor, not database work.

| Measurement | Result |
| --- | --- |
| Version + owner lookup, PK, round trip | 30.3 (20); server execution 0.04 ms |
| `SELECT scheduling_is_timezone('…')` round trip | 40.7 (20) |
| `scheduling_is_timezone()` server cost, **varying** argument | **10.9 ms per call** (50 calls, 547 ms), 11.1 ms for one call |
| Guarded booking, booked, round trip | 44.6 (12); p95 51.7 |
| Guarded booking, stale version (refused at the lock CTE) | 29.8 (8): no more than the floor |
| Guarded statement, server-side `EXPLAIN ANALYZE` | ~12-13 ms execution, of which ~11 ms is the timezone check; the individual integrity-trigger times in the plan were 0.002-0.105 ms each |
| 8 parallel bookings, one court, distinct times | 215 ms wall (one alone: 67 ms): they share the version rows `FOR SHARE`; only the hold insert serialises |
| 8 parallel bookings, 8 courts | 146 ms wall |
| Lock waiters left behind | 0 |

**Correction of an earlier claim.** The 2C.2 note and the 037 handoff said the timezone check costs about 11-12 ms "per call". That is right, but a constant-argument test shows 0.05 ms because PostgreSQL evaluates a STABLE function with a constant argument once. The per-row cost is real: the `CHECK` runs once per inserted row because the column value differs. Consequences: a single hire pays about 11 ms (about a quarter of the 45 ms round trip), which is acceptable; a 500-occurrence generation run (cap in the plan) would spend about 5.5 s in the check and must not ship before it is optimised. The function reads `pg_timezone_names` (598 rows) on every call. No optimisation is made here.

Query count for one booking: basis read (1), inputs (parallel reads, count as in the calendar), guarded write (1 batch statement including the `SET LOCAL`s). No PRODUCTION measurement exists.

**Timeouts.** `SET LOCAL statement_timeout` / `lock_timeout` in the same non-interactive batch as the booking is proved on the real driver (section 2). A role-level `ALTER ROLE` is not used because the role is shared with LD Tennis and Eve. Proposed values (for approval, section 11 of the design): 5 s and 2 s.

## 5. Migration 041 index (NEON-DISPOSABLE, scratch tables in schema `idx041`, synthetic data, real tables untouched)

100,000 reservations and 50,000 occurrences in the tenant (plus other tenants), spread over 2024-01 to 2027-06, one-week window near now, `ORDER BY starts_at, id LIMIT 201`:

| Query | Current | Proposed 041 `(organisation_id, ends_at)` btree | GiST `tstzrange` + `&&` |
| --- | --- | --- | --- |
| reservations | 89-178 ms, 110k-267k buffers (ordered scan filters 82k historical rows) | unchanged plan, the index is **not used** | **1.4 ms**, 559 buffers |
| occurrences | 8.6 ms (seq scan) | 10.7 ms (slower) | **1.7 ms** |

Sizes (150k reservations): heap 93 MB, GiST range index 11 MB, existing `starts_at` btree 16 MB. So 041 as proposed in 2C.2 adds nothing at this scale; the replacement is in draft branch `feat/scheduling-041-range-indexes` (separate PR, not applied). Its own local test found a caveat: at about 140 reservations per day, a one-week window (~1,000 matches) with `LIMIT 201` can still prefer the ordered scan (~15 ms); a 3-day window uses the index in under 1 ms. The equivalence of the new predicate with the old one is tested (about 300 windows, boundary cases included).

## 6. Calendar keyboard-scroll test

Real browser harness (`verify-scheduling-browser-local.mjs`, disposable PostgreSQL 17, real Next server, Chromium, desktop project), 15 repeats of the existing keyboard test on the branch that first added only a polled Home-after-End step: **12 passed, 3 failed**. Instrumented repeats (25) failed again at the same point: a `PageDown` (or `ArrowUp` from the end) was ignored for the whole 30 s poll while the grid was still the same element, still focused, and `scrollTop` was settled (80 px after two ArrowDown). No product defect: the grid has no key handler and focus is intact; it is Chromium dropping a key that arrives as the previous key-scroll animation finishes. Fix: wait until the scroll is settled (unchanged for 4 animation frames, a condition, not a delay) before every key press. Result: **30 of 30, twice**, in the real harness. Branch `fix/scheduling-calendar-home-end-deterministic`. The architecture note's "set `scroll-behavior: auto`" fallback is not warranted.

## 7. Other checks

- `tsc --noEmit` clean; ESLint clean on all touched files.
- Scheduling unit, component, DST and slot-grid, and containment suites: 49 files, 1,741 tests passed. (One containment file failed twice while `tsc` was running in parallel and passed alone and in the full group afterwards: a load-induced timeout, not a defect.)
- Local credential-shape scan of every added line (URLs with embedded credentials, `npg_` tokens, key prefixes, PEM headers): 0 hits. GitGuardian itself runs only on a pull request.
- No booking-writing route exists at `main`: 26 scheduling route files, none for reservations, bookings, occurrences, series, holds, enrolments or payments; nothing in `app/`, `lib/` or `components/` references the booking tables or the version table.

## 8. Vercel runtime logs

`get_runtime_errors` for the `brainbase` and `eve` projects returned **403** ("You don't have permission to access this resource") on every attempt (repeated across the session), and `list_deployments` returned a 403 that asks the team to be re-authorised. Permissions were not changed. Runtime-log evidence of absence of migration-related database errors therefore remains **unverified**; the health endpoint (`/api/health/db` 200), the unchanged Production fingerprint and CI/Vercel commit statuses (success on `main`) are the only runtime evidence.

## 9. Not done

Application code for booking, any route, any flag, any Production change, series generation, public booking, payments.
