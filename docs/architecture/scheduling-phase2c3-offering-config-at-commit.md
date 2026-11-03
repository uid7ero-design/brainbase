# Scheduling Phase 2C.3 preflight: offering configuration at commit

Status: **decision and proof only.** No application code, no migration, nothing applied anywhere. The guarded booking statement still exists only as a test fixture.
Baseline: `main` `e490f4ba`; migration 037 (`2c.3.1`) is applied to Production and verified.
Companions: `scheduling-phase2c-availability-at-commit.md` (option C), `scheduling-migration-037-completion-record.md`, `scheduling-phase2c-booking-architecture.md`.

## 1. The question

037 versions what decides **availability**: rules, closures, pinned zones, offering-resource links and a resource's `active` flag. An offering's **own columns** (`duration_minutes`, `capacity`, `price_cents`, `start_time`, `name`, `type_key`, `colour_key`, recurrence, `archived_at`) are not versioned. Could a booking commit against an offering that was edited after the application read it?

## 2. What the code does today (read, not assumed)

| Fact | Where |
| --- | --- |
| The staff calendar's slot length is `offering.durationMinutes`; the step defaults to it | `packages/scheduling/src/availabilityCalendar.ts:237-238` |
| The commit-time evaluator takes the duration from the **requested window** (`ends - starts`), and `offering` contributes only `id` and `archivedAt` | `packages/scheduling/src/bookingEvaluation.ts:84-116` |
| A reservation snapshots `price_cents` and `currency` from the offering | `scheduling_reservations` columns, `reservationRepository` |
| Every offering edit goes through `updateOffering(expectedUpdatedAt)`: `UPDATE … WHERE updated_at = $3`, and a BEFORE UPDATE trigger (`scheduling_touch_updated_at`) sets `updated_at := now()` on **every** update, archive included | `configRepository.ts:506-560`, `010_shared_schema.sql:73` |
| The guarded statement already takes `FOR SHARE` on the offering row | `tests/support/guardedBooking.ts` (`lo`) |

## 3. Finding (proved, deterministic)

A duration edit does not move either availability version, and the statement locks the offering row but never reads what is in it. So the 037-only statement accepts a 60-minute booking against an offering that is now 90 minutes (test: `CHARACTERISATION`). The same gap covers a price edit between read and commit: the reservation would carry the price the application read, not the price in force. This is not a Production defect today (no booking path exists); it is a gap the 2C.3 statement must close.

## 4. Options

**A. Validate in the atomic statement, using the lock it already holds.** The statement also requires the offering's edit token (`updated_at`, `$12`) that the application read.

**B. Extend availability-version invalidation.** A trigger on `scheduling_offerings` bumps the offering's version when booking-relevant columns change. Needs a new migration (038-numbering is reserved for reschedule linkage; this would be a separate one), applied to Production, with its own rollback, and an agreed list of "booking-relevant" columns that must be kept in step with the engine forever.

| Concern | A: edit token | B: version bump |
| --- | --- | --- |
| Duration and slot interval | any duration edit moves the token | only if `duration_minutes` is on the trigger's list |
| Price/currency snapshot | covered | needs `price_cents` on the list |
| Offering capacity, start time, recurrence | covered | needs listing |
| Archive / active state | covered, and `archived_at IS NULL` is already a predicate | needs listing (or already a predicate) |
| New column added later | covered automatically (every update moves `updated_at`) | silently uncovered until someone edits the trigger |
| Concurrent config edits | writers already serialise on `updated_at = $3`; the booking joins that protocol | separate mechanism beside the token |
| Form optimistic concurrency | **reuses the token every form already carries**; no new state | two tokens for one row |
| Writer vs in-flight booking | writer waits on the `FOR SHARE` row lock; the booking stands | writer waits on the version row |
| Booking that waited for a writer | READ COMMITTED re-evaluation sees the new `updated_at`: inserts nothing | same, via the version |
| Tenant isolation | token is per row; predicate is already `organisation_id = $1` | same |
| Standalone Scheduling consumers | no schema coupling: the token is a column of the shared table they already own | adds a migration every consumer must run |
| Production risk | none (no SQL change) | a DDL change on a shared database |
| Cost | a harmless false refusal when someone edits only a colour or name during the few milliseconds between read and commit (the caller re-reads and retries) | none beyond the trigger |

## 5. Decision: A

Safest (fails closed on **any** offering edit, including columns that do not exist yet), simplest (one predicate; no migration; no Production change) and the most compatible (a standalone app already owns `updated_at` and its form tokens). The false-refusal cost is bounded to the window between the staff member's read and their confirm, and the response is the same `AVAILABILITY_CHANGED` with a fresh read.

If a later measurement shows offering edits are frequent enough to annoy staff, narrow the token to a hash of the booking-relevant columns; do that in the 2C.3 repository, still without a migration.

## 6. Other booking-relevant fields

| Field | Enforced by | Verdict |
| --- | --- | --- |
| Party size vs resource `capacity`/`min_party` | `scheduling_reservation_integrity` (031/032) raises `SCPTY` at insert, after `pg_advisory_xact_lock` on the resource; the capacity guard on `scheduling_resources` refuses lowering below live bookings | **Already database-enforced at commit** (test `PARTY LIMITS`). Offering `capacity` is headcount for occurrences and plays no part in facility hire |
| Offering archived / schedule archived | `archived_at IS NULL` predicate under `FOR SHARE`; `SCARC` trigger | Enforced |
| Resource active, linked | version bump + `r.active` predicate under `FOR SHARE`; `SCLNK`/`SCALU` | Enforced |
| Resource kind change | `SCRIU` once linked or ever held | Enforced |
| Overlap | `EXCLUDE` on holds plus the per-resource advisory lock (`23P01`) | Enforced |
| Schedule-level edits (timezone fallback, cancellation policy, preset) | an unpinned owner has no rules and therefore no availability; a schedule is archive-guarded | **Open for the 2C.3 implementation**: lock the schedule row `FOR SHARE` with its own edit token if the reservation snapshots any schedule setting. Not decided here |

## 7. Proof

`packages/scheduling-postgres/tests/offeringConfigAtCommit.integration.test.ts` (14 tests), run by `scripts/tests/verify-scheduling-phase2c.sh` on PostgreSQL 16 and 17.

- **Failing first.** `SCHEDULING_SKIP_OFFERING_TOKEN=1` turns the token clause into a no-op: **9 of 14 fail** on PG17 (duration, price, capacity, start time, name; writer-first; booking-first second attempt; tenant case; the real-repository case). The archive variant passes without the token because the archived predicate already refuses it.
- **Green.** 14 of 14 on PG16 and on PG17.
- Interleavings are **observed** (`pg_stat_activity` wait events), never slept for: a writer holding an uncommitted offering update while the booking blocks behind it; a slow in-flight booking while the writer blocks behind it.
- The booking that committed first stands, the writer then applies, and a second booking with the old token inserts nothing.
- No reservation and no hold exist after any refusal.

## 8. Not done here

Application code, a route, a flag, a migration, any Production access. The Neon HTTP-driver run of this statement is in the preflight evidence for the same change set.
