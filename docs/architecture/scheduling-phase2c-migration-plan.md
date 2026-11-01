# Scheduling Phase 2C: migration plan (design only)

Status: **proposal. No migration file is written, none is applied, no Production SQL is run.** Numbers are provisional; the next free number in the repository is 037.
Companions: `scheduling-phase2c-booking-architecture.md`, `scheduling-phase2c-availability-at-commit.md`.

## 1. Principle: small, independent pieces

The earlier sketch put reschedule linkage, atomic replacement, series-skip protection and every other guard into one "037". That is withdrawn. Each piece below:

- answers one question and can be reviewed, rehearsed, applied and rolled back on its own;
- has its own rollback file (`09x_..._rollback.sql`), its own registry version row, and its own PostgreSQL 16/17 rehearsal;
- is applied by the owner through the usual hand-off (Neon console, staged file, verified afterwards), never by the application;
- is **additive** and tolerated by older code: the code that needs a piece stays behind its feature flag until the piece is applied.

Order is by when a stage needs the piece, not by number.

| Piece | Name | Needed by | Depends on |
| --- | --- | --- | --- |
| 037 | Availability versions | 2C.3 facility hire writes | none |
| 038 | Reschedule linkage | 2C.5 / 2C.7 | none |
| 039 | Atomic reschedule function | 2C.7 appointments | 038 |
| 040 | Series-skip guard | 2C.6 top-up writes | none |
| 041 | Range-read indexes | 2C.2/2C.4, only if the plan check shows a need | none |

Not migrations: the statement timeout (an owner-run `ALTER ROLE`, see the architecture document), occurrence generation (the slot unique key already gives idempotent inserts), series tables (exist), holds and capacity (exist), manager override columns (**overrides are not authorised for the first release**, so no override-reason column is proposed).

## 2. 037 Availability versions

**Purpose.** Make "the availability the engine used is the availability in force at commit" a database guarantee for a single-statement booking. See the availability-at-commit document, sections 4 and 5.

**Shape.**
- `scheduling_availability_versions (organisation_id, owner_kind, owner_id, version bigint)`, primary key on all three, owner kind checked.
- AFTER INSERT triggers on offerings and resources create the owner's version row; a backfill creates rows for the owners that exist.
- A bump function and AFTER triggers on rules, exceptions, zones (insert/update/delete), offering-resource links (insert/delete), and a resource's `active` (when it changes). The bump is an `INSERT ... ON CONFLICT DO UPDATE SET version = version + 1`, offering before resource.
- No change to any existing table, trigger or edit token.

**Risks and answers.**
- Write amplification: one extra single-row upsert per rule/closure/zone/link write. Configuration writes are rare and human-speed. A batch write (`createRules`, many rules in one statement) bumps the same row repeatedly inside one transaction; the cost is bounded by the batch size the repository already accepts.
- Lock contention: a booking holds `FOR SHARE` on two version rows for the length of one statement; a configuration write waits at most that long. Bookings never wait for each other on these rows (share locks do not conflict).
- Lock order: offering, then resource (id order). Documented and tested against deadlock.
- Tenant isolation: every row carries `organisation_id`; the booking statement filters on it first.

**Rollback (098).** Drop the triggers, the functions and the table. The booking code falls back to the unversioned statement only if its feature flag is turned off first.

**Proof before applying.** `availabilityAtCommit.integration.test.ts` already proves the mechanism with a prototype of this file (`tests/support/prototype038AvailabilityVersion.sql`, not a migration). The real migration needs: idempotent apply twice, backfill on a database with existing owners, rollback then re-apply, registry row, the existing availability suites unchanged (034/035/036), and a disposable Neon branch rehearsal.

## 3. 038 Reschedule linkage

**Purpose.** "Rescheduling preserves historical records": a move creates a new reservation linked to the old one; the old one is cancelled with reason `rescheduled`; nothing is rewritten.

**Shape.**
- `scheduling_reservations.rescheduled_from_id text NULL`, with a composite foreign key `(rescheduled_from_id, organisation_id)` to the same table (so a link cannot cross tenants).
- The lifecycle/immutability trigger adds the column to the immutable set (set at insert, never changed). The reservation guard refuses a self-link and a link to a reservation that is not cancelled (a move's source must already be cancelled in the same statement; see 039).
- A partial unique index on `(organisation_id, rescheduled_from_id) WHERE rescheduled_from_id IS NOT NULL`: one reservation can be moved from at most once, so a retry or a double click cannot fork the history.
- A cancellation reason value `rescheduled` is accepted by the existing reason column (check the current type; a text column needs no change).

**Open question for approval.** Whether `rescheduled_from_id` chains are shown to viewers: **no.** Viewer shapes never carry it (it would link two bookings of one customer).

**Rollback (099).** Drop the index, the foreign key, the column; restore the trigger function from 031's definition. Safe only while no reservation has the column set; otherwise the rollback loses link history (documented, and the rollback refuses by default).

## 4. 039 Atomic reschedule function

**Purpose.** The Neon HTTP driver has no interactive transaction, so "cancel the old, create the new" must be one statement.

**Shape.** `scheduling_reschedule_reservation(...)`: one call that (1) locks and cancels the original with reason `rescheduled` (so its hold is released by the existing lifecycle trigger in the same statement), (2) inserts the replacement with `rescheduled_from_id` set, taking its hold, (3) returns both ids. It takes locks in the 2A order (resources in `resource_id` order, one advisory lock per function), sets the function-level `lock_timeout = '5s'`, checks the availability versions exactly as 037's statement does, and refuses a replacement whose window overlaps its own hold only if it overlaps *another* live hold (the old hold is released in the same transaction, so moving 10:00 to 10:30 on the same court works).

**Failure behaviour.** Any failure rolls back both halves: the original stays confirmed and keeps its hold. Idempotency: the key is on the replacement; a replay returns the replacement.

**Tests (when written).** Move to a free time; move onto a taken time (original untouched); move to the same resource overlapping its own old hold; two simultaneous moves of one reservation (exactly one wins; the partial unique index from 038 is the backstop); move across a DST change; cross-tenant ids; a viewer cannot call it; PostgreSQL 16 and 17; the real driver.

**Rollback (100).** Drop the function.

## 5. 040 Series-skip guard

**Purpose.** The duplicate-booking guards ignore cancelled rows (`WHERE status <> 'cancelled'`), so after a manager skips one date of a standing enrolment, a later top-up would see no live reservation and enrol the customer again. The core planner (`planSeriesEnrolments`) never does that, but a database must not rely on every writer being the planner.

**Shape.** A BEFORE INSERT trigger on `scheduling_reservations`: when `series_id` is set and `occurrence_id` is set and `created_by` starts with `system:` (the automatic top-up), refuse with a new SQLSTATE `SCSKP` if a cancelled reservation exists for the same `(organisation_id, series_id, occurrence_id)`. A manager's explicit re-enrolment (a staff actor) is **not** refused: re-enrolling a skipped date on purpose is allowed; doing it silently is not.

The check and the insert race with a concurrent skip (the cancel commits between the trigger's read and the insert). The trigger therefore takes the same per-occurrence advisory lock the capacity guard takes, so a skip (a cancel) and an automatic insert serialise.

**Rollback (101).** Drop the trigger and function.

**Open question for approval.** Is "system actors cannot re-enrol a skipped date, staff can" the right rule? The alternative (nobody can, a skipped date is final) is simpler but blocks a manager from undoing a mistaken skip except by creating the reservation as a one-off without a series link.

## 6. 041 Range-read indexes (conditional)

The 2C.2 reads filter by `organisation_id` and a time range. The existing indexes are checked by `EXPLAIN` in `bookingReads.integration.test.ts` (the test prints the plan and fails on a sequential scan once the tables are large enough to prefer an index). If a plan check fails, 041 adds the narrowest index that fixes it (for example `(organisation_id, starts_at)` on reservations and occurrences, partial on `status <> 'cancelled'` where the read excludes cancelled). Its result is recorded in the 2C.2 PR; nothing is proposed beyond what the evidence needs.

## 7. What is deliberately not here

- No override-reason column or table: manager overrides are not authorised for the first release.
- No migration for occurrence generation, series, capacity or holds: they exist.
- No change to LD Tennis, Eve or the shared `audit_logs`.
- No Production application. Every piece follows the owner hand-off: staged file with checksum, rehearsal evidence on PostgreSQL 16/17 and a disposable Neon branch, rollback tested, owner applies in the Neon console, post-apply verification query, code deployed after.
