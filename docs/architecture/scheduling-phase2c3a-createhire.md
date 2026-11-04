# Scheduling Phase 2C.3a: `createHire` (repository only)

Status: **implemented on a draft branch, not merged, not wired to anything.** No route, no screen, no flag, no flag row, no migration, no Production SQL. Nothing in `app/`, `lib/` or `components/` can reach it (a containment test pins that).
Baseline: stacked on PR #531 (`c4cb8891`, the offering edit token and the Neon gate proofs). Production has migrations 030 to 037 and needs nothing new for this.
Companions: `scheduling-phase2c3-facility-hire-design.md` (PR #532: the approved design and the seven decisions), `scheduling-phase2c3-offering-config-at-commit.md`, `scheduling-phase2c-availability-at-commit.md`.

## 1. What it is

`PostgresHireRepository.createHire(tenant, request)` books one **facility hire**: one linked, active resource, for the offering's configured duration, starting on a time the shared availability engine offers, creating the reservation and its exclusive hold **atomically** (one statement, one transaction). `findHireByKey` and `readHireBasis` are its two companions. The contract (`HireRepository`, `HireRequest`, `HireResult`, the failure taxonomy, validation, payload comparison) is in `@scheduling/core` (`packages/scheduling/src/hire.ts`) and does no I/O, so a standalone host implements the same interface over its own database. The Postgres implementation is `packages/scheduling-postgres/src/hireRepository.ts`.

The seven owner decisions, and where each lives:

| # | Decision | Implementation |
| --- | --- | --- |
| 1 | offering edit token inside the booking statement | `o.updated_at = $4` and `o.duration_minutes = $21` in the `lo` CTE |
| 2 | transaction-local `statement_timeout` 5 s and `lock_timeout` 2 s | first statement of the batch: `set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`; no role is altered |
| 3 | schedule row `FOR SHARE` with its edit token | `ls` CTE: `s.updated_at = $5`, `s.archived_at IS NULL`, `s.preset_key = 'resource_hire'` |
| 4 | kill switch and `scheduling.staff_booking` capability, default off | **not in this slice** (2C.3b, host code); a containment test pins that neither name exists anywhere yet |
| 5 | accept the timezone-check cost for a single booking | unchanged; not optimised (series generation is not started) |
| 6 | name required, email and phone optional, no CRM link | `customer_id` NULL, `contact_link = 'none'`; validation in core |
| 7 | only the configured duration, only engine-generated starts | the request may state `durationMinutes` but it must equal the offering's (`duration_not_allowed`); the start must be on the engine's grid. `stepMinutes` may only **refine** the grid (at least 5, must divide the duration) so a calendar drawn at 30 minutes stays bookable; it cannot leave it |

## 2. The contract

`HireRequest`: `idempotencyKey` (16 to 80 of `[A-Za-z0-9_-]`, required), `offeringId`, `resourceId`, `start {date, time}` (local wall clock in the offering's pinned zone), optional `durationMinutes`, optional `stepMinutes`, `partySize` (1 to 1000), `customer {name (1..120), email?, phone?}`, `notes?` (at most 1000), optional `basis`. There is **no organisation field**: the tenant comes from the `TenantContext` and nothing in the request can name another.

`HireResult` is either `{ok: true, reservation, replayed, recovered?, attempts}` or a failure `{ok: false, code, family, retryable, message, problems?, basis?, attempts}`.

| family | codes | meaning |
| --- | --- | --- |
| invalid (never retried) | `validation` (field names only, never values), `duration_not_allowed`, `preset_not_supported`, `nonexistent_local_time` (DST gap), `resource_not_eligible`, `idempotency_conflict`, `not_found` | the request is wrong; `not_found` is also what another organisation's id answers |
| refusal (offer other times) | `offering_unavailable`, `resource_inactive`, `outside_availability`, `off_grid`, `in_the_past`, `resource_conflict`, `party_exceeds_resource`, `availability_changed` (carries a fresh `basis`) | the answer is no; nothing was written |
| transient | `contention_timeout` (`retryable`) | the database was busy; nothing was decided or written; the same request may be repeated |
| unknown | `outcome_unknown` (`retryable`) | the connection failed after the write was sent; the booking may or may not exist; ask again with the **same key** |

Thrown, not returned (the host answers 403/503): `permission_denied` (only **staff** with `scheduling.reserve` **and** `scheduling.view`; a customer or the public cannot call it whatever permissions they carry), `HireNotReadyError` (migration 037 missing, version rows missing, or an executor that cannot run a transaction), and any unexpected database error, which includes `40P01`: a deadlock is a defect to surface, never retried around.

## 3. The flow

1. **Key first.** `findByKey`: an earlier call with this key returns its reservation (`replayed`), or `idempotency_conflict` if it was a different request. The comparison is on what was **stored** (offering, resource, local start, party size, name, normalised email, phone, notes, and the duration only if the caller stated one), so a retry still matches after the offering's duration or name has been edited.
2. **Basis, one statement** (`HIRE_BASIS_SQL`: offering, schedule, resource, link, both versions, both zone pins, both edit tokens; one snapshot, so consistent). A foreign or missing id is `not_found`. A client-supplied `basis` that differs is `availability_changed` with the fresh one, before anything else is read.
3. **State checks** from the basis: preset is `resource_hire`, nothing archived, resource linked and active, a configured duration, a valid step.
4. **Inputs, read after the basis**: rules, closures and live holds of the offering and the resource (the existing batched reads).
5. **Decision** by `evaluateSlotBooking`, the same pure engine the calendar uses.
6. **Guarded write**: `sql.transaction([timeouts, HIRE_GUARDED_SQL])`. One row back is the reservation. Zero rows means the key now exists (replay) or the basis went stale (`availability_changed` with a fresh basis).
7. **Contention**: `55P03` (lock timeout) wrote nothing and is retried, at most `maxAttempts` (default 3, hard cap 5), each attempt re-reading from step 1 (the wait was most likely a writer, so the old basis is probably stale). `57014` (statement timeout) is `contention_timeout` and is not retried.

Why this order is sound: everything the decision used was read **after** the versions and tokens of step 2. Anything that changes availability afterwards moves a version (rules, closures, pins, links, resource active) or a token (any offering or schedule edit), and the guarded statement inserts nothing.

## 4. Locking: a deadlock the preflight missed, found by the stress test and fixed

**The finding.** The preflight (PR #531 and the design in #532) described the guarded statement's lock order as "offering before resource, the order every version bump uses: no lock cycle (60-way stress, no `40P01`)". That was wrong for resource writers. The stress test written for this slice, which races real bookings against **every kind** of configuration writer, produced `40P01` within seconds.

| | order |
| --- | --- |
| every resource-availability writer (closure, rule, pin), every link writer | per-resource **advisory lock**, then (037's AFTER trigger) the resource's or offering's **version row**, exclusively |
| resource deactivation | the resource **row**, then the advisory lock, then the version row |
| the preflight statement (`tests/support/guardedBooking.ts`) | offering version `S`, offering `S`, (schedule), resource version `S`, resource `S`, **then** the advisory lock inside the reservation insert trigger |

A booking that holds a version row and waits for the advisory lock, against a writer that holds the advisory lock and waits for the version row, is a cycle. PostgreSQL kills one of them. (The preflight stress used bookings and bump-only writers that skipped the advisory lock, so it could not see this. The fixture was never run by application code; only tests used it. The committed Neon gate proofs of #531 remain valid for what they assert, which is version semantics, not deadlock freedom.)

**The fix, in the statement only (no migration).** Order: `schedule S` -> `offering S` -> `resource S` -> **advisory lock** -> `offering version S` -> `resource version S` -> insert (its triggers take the same advisory lock again, re-entrantly). Rationale:

* schedule before offering and the advisory lock after both are the order 030 to 032 already document for every other writer;
* the resource row precedes the advisory lock because a deactivation takes the row first;
* the version rows come last because every writer takes them last (after the advisory lock or after the row).

Writer by writer, with the booking `B` taking the row locks `FOR SHARE`: resource-availability and link writers (advisory, then version): `B` has the advisory lock before any version row, so whoever gets the advisory lock first runs to completion; deactivation (row, advisory, version): `B` takes the row first, so they serialise on the row; offering-availability writers (their own advisory family, schedule `S`, offering `S`, then the offering version): they hold only locks compatible with `B`'s before they ask for the version, and `B` holds the version only after the resource advisory lock which they never take; schedule, offering and cancel writers hold a single row. No path takes two of these in the opposite order.

**Proof.**

* `hireLockOrder.integration.test.ts` makes the cycle deterministic (no timing luck): a writer that has taken the advisory lock, a booking that has locked both version rows and is observed blocked on the advisory lock, then the writer's version bump. With the **preflight shape** it deadlocks (`40P01`, characterised and asserted). With `HIRE_GUARDED_SQL` the booking waits holding nothing the writer needs, the writer bumps and commits, and the booking refuses with `availability_changed`.
* The stress test in `hireRepository.integration.test.ts`: 8 concurrent hirers racing 7 writer loops (offering rename, schedule rename, resource closure add/delete, offering closure add/delete, unlink/relink, resource deactivate/reactivate, cancel) for 6 seconds. **Before the fix: 34 to 41 deadlocks per run. After: 0 in repeated runs** (about 1,000 to 1,600 attempts and 50 bookings per run), no overlapping live holds, and every live reservation has exactly one live hold and no cancelled one has any.
* A containment test pins the order of the `FOR SHARE` clauses, the single advisory lock, and that the advisory lock appears before the first version-table reference.

**Consequence for concurrency.** Bookings of **one resource** now serialise on its advisory lock from just before the version rows until commit (milliseconds). They already serialised on it inside the insert trigger, so this widens an existing critical section slightly; bookings of different resources do not wait for each other (different advisory keys). Not re-measured on Neon for this slice; the preflight's guarded latency (44.6 ms median round trip, 29.8 ms of it network) is the baseline and the statement now does one extra lock call.

## 5. Idempotency and unknown outcomes

The unique key is `(organisation_id, idempotency_key)`, so keys are tenant-scoped (two organisations may reuse a value, neither can read the other's). `ON CONFLICT ... DO NOTHING` plus the key look-up make ten parallel same-key calls produce **one** reservation and **one** hold, all ten answered with it. The look-up is repeated before a hold-dependent `resource_conflict` is reported, because a concurrent twin's own hold looks exactly like "taken": the first version of the test caught this (9 of 10 answered), and it is now closed.

The key of a **cancelled** booking still resolves to it (state `cancelled`) and never creates a second booking; a new hire for the same time needs a new key.

| What happened | Result |
| --- | --- |
| the reply is lost after the commit | the key is read: found -> `ok`, `recovered: true`; asking again is a plain replay |
| the request never arrived or was aborted | key not found -> `outcome_unknown` (retryable, never "failed"); the same key then books |
| the resolving read fails too | `outcome_unknown`, not a guess |
| connection class `08`, `57P`, no SQLSTATE at all | unknown; any other SQLSTATE means the server rolled back: a definite failure or a defect |

Measured on the real Neon HTTP driver (this slice, twice): a client abort while the booking was running **cancelled the statement** (nothing written), consistent with the preflight; the key resolves either outcome.

## 6. Cancellation history

Nothing new is needed and nothing is bypassed: `PostgresReservationRepository.cancel` keeps the row (`status = cancelled`, `cancelled_at`, `cancelled_by`, `cancel_reason`; the customer snapshot, window and price are immutable), the lifecycle trigger releases the hold in the same statement, and the window is bookable again immediately. Tested on PostgreSQL 16 and 17 and on the Neon driver: the row and its snapshot survive, the hold is released, a new key books the same time, the old key still resolves to the cancelled row, and no history table exists or is added.

## 7. Standalone compatibility

* `HireRepository` and everything it needs are in `@scheduling/core` with no I/O.
* `SqlExecutor` gains one **optional** member, `transaction(statements)`: the statements run in order in one transaction, a transaction-local setting made by the first applies to the rest. `fromPgLike(pool)` implements it (a checked-out connection with `BEGIN`/`COMMIT`/`ROLLBACK`); `fromNeonHttpLike(sql)` implements it with `sql.transaction([...])` when the driver provides it. Existing repositories do not use it and are unchanged.
* An executor without `transaction` makes `createHire` **refuse** (`HireNotReadyError`, nothing written) rather than run unbounded. **For 2C.3b:** the BrainBase `createSchedulingExecutor` recorder wrapper returns a plain `{query}`, so it would be refused; that wrapper must pass `transaction` through (and count it) when the route is built.
* The package imports nothing from BrainBase (pinned).

## 8. Evidence

| Environment | Suite | Result |
| --- | --- | --- |
| LOCAL PostgreSQL 16 and 17 (Docker, disposable) | `hireRepository` (90), `hireLockOrder` (2); plus the whole Phase 2C set run unchanged: `availabilityVersions` 15, `availabilityAtCommit` 18, `offeringConfigAtCommit` 14, `bookingReads` 24, overlay 30 | **PG16: 193 of 193; PG17: 193 of 193** (the hire suites re-run on both after the last source edit: 92 of 92 each) |
| NEON-DISPOSABLE `br-patient-haze-a7ynj7wy`, real `@neondatabase/serverless` driver, role `rehearsal_037`, synthetic organisations only | `neonHttpHire` (17) | **17 of 17, twice** |
| core | `hire.test.ts` (pure contract) | passing |
| repository | containment `schedulingPhase2c3aContainment` (14): no caller, no route, no flag, no migration, no role change, SQL tenant-scoped, lock order | passing |

The existing gate-proof suites (`neonHttpAvailabilityVersions`, `neonHttpBookingGates`, `neonHttpBookingCost`) are unchanged and remain committed and reproducible.

What the repository tests cover: concurrency (8 parallel same window, 16 overlapping starts, 10 same key, mixed-writer stress), resource conflicts (exact, partial overlap, adjacent windows allowed), stale edits (12 kinds of change landing between decision and write, plus a client basis, plus three real lock interleavings observed through `pg_stat_activity`), DST (Adelaide spring-forward gap refused, instants either side of the gap, fall-back ambiguity taking the earlier instant and replaying), idempotency (replay, 8 variants of a different request, other resource, parallel, cancelled), lost responses (reply lost, request dropped, read also failing), timeouts (lock timeout with retry bounds and with a retry that succeeds, statement timeout not retried, nothing leaking to the pool), tenant isolation (foreign ids, the statement itself handed foreign ids, tenant-scoped keys), permissions (five actors refused for each of the three methods).

## 9. Not done, and what 2C.3b still needs

Not done, by design: HTTP routes, the staff form, the kill switch and capability check, audit writes, any enablement, any Production booking, series generation, public booking, payments, manager override.

Open items for 2C.3b: the executor wrapper must forward `transaction`; the routes must map failures to the stable codes (`contention_timeout` and `outcome_unknown` as 503/504 with `Retry-After`; `availability_changed` carrying the fresh basis); audit after commit, best effort; the calendar read should return the `basis` (`readHireBasis` exists for it).

Known limits: bookings of one resource serialise for milliseconds (4); the timezone check costs about 11 ms per inserted row (fine for one hire, blocks series generation until optimised); `stepMinutes` is a small, bounded extension beyond the literal wording of decision 7 and can be removed without touching anything else.

## 10. Corrections to earlier documents

* `scheduling-phase2c3-facility-hire-design.md` section 4.1 and the header comment of `tests/support/guardedBooking.ts` describe the old lock order. Section 4 above supersedes them; the fixture carries a warning and is kept only because the regression test needs the old shape to characterise the cycle.
