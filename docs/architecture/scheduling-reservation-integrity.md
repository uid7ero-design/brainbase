# Scheduling reservation integrity (version 2b.2.2)

Status: **implemented on `fix/scheduling-reservation-integrity`, draft PR, not merged, not applied anywhere.** It adds one additive
migration (`031_reservation_integrity.sql`, rollback `092_reservation_integrity_rollback.sql`) and small adapter and test changes.
It activates no reservation-writing API: the only code that writes reservations is the shared repository, which no route calls yet.
Production holds no Scheduling data. Applying 031 is a separate owner-run step, after 030, and needs its own approval.

## 1. Findings (each reproduced first by a failing test)

| # | Finding on main (030 applied) | Failing-first result | Protection (031) |
| --- | --- | --- | --- |
| 1 | A resource's `capacity` / `min_party` is never compared with a reservation's party size, by the repository or the database. | a party of 5 on a capacity-4 court was accepted | `scheduling_reservation_integrity` refuses it (`SCPTY` -> `capacity_exceeded`) |
| 1b | A capacity or minimum-party change can race a new reservation. 2B.2a only checks live reservations in its own statement. | a reduction and a booking both committed | `scheduling_resource_capacity_guard` takes the per-resource lock and refuses a change a live reservation no longer fits (`SCRIU` -> `resource_in_use`); the reservation guard re-reads capacity under the same lock |
| 2 | A staff reservation, or an occurrence, may use a resource the offering is not assigned to. Only the customer path checked. | accepted | `SCLNK` -> `offering_unavailable`, for every actor and every writer |
| 2b | A staff booking and an unlink race (the booking read the assignment at its snapshot). | accepted | assignment checked under the resource lock, against the unlink guard from 030 |
| 3 | A reservation's `preset_key` is free text; nothing ties it to the preset of its offering's schedule. | an appointments offering was booked as `resource_hire` | `SCPRE` -> `invalid_input`. The preset version is deliberately not compared (a preset definition may be revised while old schedules keep their version). |
| 4 | An offering can be archived while a reservation is created for it. | both committed | the reservation guard locks the offering row `FOR SHARE`: an archive waits for an in-flight reservation, a reservation after an archive is refused (`SCARC` -> `offering_unavailable`) |
| 5 | Cross-organisation allocations. | **already impossible** (all foreign keys are composite `(id, organisation_id)`) | none needed; pinned by tests so it stays that way |

The resource-kind rules were already closed by 030 (a hold is refused on a resource whose kind the owning reservation's preset does
not accept, evaluated under the lock; links are refused for an unaccepted kind). 031 adds the preset-snapshot check that makes that
kind check meaningful.

## 2. Behaviour change that needs your decision

**Staff reservations now require the resource to be assigned to the offering.** Before, only customers and the public did. This is the
rule the dashboard (2B.2c) already implies ("assign resources to an offering"), and it closes the staff/unlink race, but it is a
change to what a manager can do: booking a court that is not assigned to the offering is refused until it is assigned. Production has
no reservations, no reservation-writing route exists yet, and the shared fixtures were updated, so nothing is affected today. If you
prefer staff to be free of the rule, the alternative is to keep 030's behaviour and accept that a staff booking can land on a resource
that was unassigned at the same moment. Recommendation: keep the rule.

## 3. Design

Three triggers, nothing replaced:

| Trigger | On | Rule |
| --- | --- | --- |
| `scheduling_reservations_integrity` | BEFORE INSERT on reservations | offering not archived (row locked `FOR SHARE`); `preset_key` equals the schedule's; for a resource booking, under the resource lock: party fits `[min_party, capacity]`, resource assigned to the offering |
| `scheduling_occurrences_integrity` | BEFORE INSERT on occurrences | a resource-bearing occurrence uses a resource its offering is assigned (under the resource lock) |
| `scheduling_resources_capacity_guard` | BEFORE UPDATE OF capacity, min_party on resources | under the resource lock, no change a live reservation would no longer fit |

**Lock ordering.** At most one advisory lock per function, the same per-resource lock 030 and the hold serialiser use, always taken
before the reads it guards. The reservation guard first takes the offering row `FOR SHARE` and only then the resource lock; nothing
takes them in the other order. `FOR SHARE` on the offering never conflicts with the foreign-key `KEY SHARE` a hold or reservation takes,
and an offering archive/edit (an UPDATE of that row) holds no resource lock while it waits. So there is no cycle between a booking, an
unlink, a deactivation, a capacity change, a link and an archive. The 40-round stress test asserts no `40P01`.

**Idempotent and additive.** `CREATE OR REPLACE` throughout; one transaction; `SET LOCAL lock_timeout`; needs 030 (version 2b.2.1) and
READ COMMITTED; guards new writes only and never re-validates existing rows; the only row it writes is its version marker.

## 4. Adapter and fixtures

- `errors.ts`: `SCPTY` -> `capacity_exceeded`, `SCLNK` and `SCARC` -> `offering_unavailable`, `SCPRE` -> `invalid_input`.
- `createAssigned` needed no change: it already picks only assigned, active resources.
- Fixtures: `makeWorld` assigns the resources it seeds where an offering can use them; `seedOccurrence` assigns first (opt out with
  `autoLink: false`); a few tests assign explicitly. The appointments test that documented "staff can book an unassigned provider"
  now asserts the refusal and then the booking once assigned. `schema.integration.test.ts` pins the new objects and proves 031/092
  idempotence, reversibility and the 030 dependency.

## 5. Known limits

- The schedule-archived check reads the schedule row without a lock (the offering row is locked): a schedule archived at the same
  instant as a reservation is created for one of its offerings can still be booked. An archived schedule only matters for new bookings,
  and archiving an offering is the lever that is protected. **Investigated and fixed separately** by 032
  (`docs/architecture/scheduling-schedule-archive-ordering.md`): not an integrity violation, an ordering guarantee only.
- Offering capacity edits do not touch existing occurrences (by design in 2B.2a), so they cannot reduce an occurrence below its bookings.
- A reservation's customer is not tied to a customer table in the shared schema (the host owns that); out of scope here.
- Availability rules (opening hours) are not enforced by the database; that is a repository/route concern for the reservation API.

## 6. Applying it (owner-run, after approval; not part of this PR's merge)

Order: 030 first (separate handoff), then 031 in the Neon SQL editor (one transaction; re-running is a no-op). Check the three
triggers and the `2b.2.2` marker. Rollback `092` (then, if wanted, `091`); no data is touched. Deploying the code does not need 031 first.

## 7. Verification (recorded 2026-10-24)

- **Failing first.** `reservationIntegrity.integration.test.ts` was written before 031 and failed 15 of 19 tests against main with 030
  applied (the others were the cross-organisation checks, which already held, and one race 030 already closed). It now has 20 tests.
- **Races** use a second connection holding a transaction open (fixed order, not timing): capacity reduction vs reservation (both
  orders), unlink vs staff reservation (both orders), unlink vs occurrence insert, archive vs reservation (both orders). Backstop
  tests issue raw SQL with no repository. A 40-round stress test races capacity change, unlink and four bookings on one resource and
  checks every live reservation still fits and is assigned; no `40P01`.
- **PostgreSQL 16.14 and 17.11**: `scripts/tests/verify-scheduling-phase2a.sh` passes on both (it applies 030 and 031 twice, runs ten
  suites, rolls back 092 then 091 on a database holding data, re-applies both, then runs the 090 guard and rollback).
- **Mutation checks** (each makes at least one test fail): removing the resource lock from the reservation, occurrence or capacity
  guard; the offering `FOR SHARE`; the archived, preset, party-fit or assignment checks; the capacity guard's live-reservation check.
  The occurrence guard's lock survived the first run and gained its own test.
- **Fixtures.** Existing suites booked unassigned resources freely; `makeWorld`, `seedOccurrence` and a few tests now assign first, and
  the appointments test that documented "staff can book an unassigned provider" asserts the refusal then the booking once assigned
  (section 2). The schema tests that insert deliberately inconsistent rows to prove CHECK constraints now use a schedule per preset so
  the structural error, not 031, is what they observe.
- Not run: the Neon driver-matrix suite and a Neon rehearsal of 031 (the 030 rehearsal branch was for 030).
