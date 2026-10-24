# Scheduling schedule-archive ordering (version 2b.2.3)

Status: **implemented on `fix/scheduling-schedule-archive-race`, draft PR, not merged, not applied anywhere.** It adds one additive
migration (`032_schedule_archive_ordering.sql`, rollback `093_schedule_archive_ordering_rollback.sql`) and tests. It changes no
application code and activates nothing. Applying it is a separate owner-run step, after 030 and 031, and needs its own approval.

## 1. The finding

`docs/architecture/scheduling-reservation-integrity.md` (section 5) recorded one remaining limit of 031: the reservation guard locks
the **offering** row `FOR SHARE`, but reads the **schedule** row (for its archived flag and preset) without a lock. So archiving a
schedule and creating a reservation for one of its offerings never wait for each other.

| | Offering archive (protected by 031) | Schedule archive (this change) |
| --- | --- | --- |
| archive in flight, reservation starts | reservation waits, then is refused (`SCARC`) | **reservation proceeds, commits** |
| reservation in flight, archive starts | archive waits for it | **archive commits immediately** |
| ordering guarantee | once the archive returned, nothing new is booked | **none**: a reservation can commit after `archiveSchedule` returned |

Reproduced first, with deterministic two-connection tests (a transaction held open, no timing): against 030 + 031 the two in-flight
tests fail because nothing waits.

### Severity, honestly

This is **not an integrity violation**. The end state (an archived schedule holding a reservation) is also reachable serially, by
booking and then archiving; archiving a schedule never cancels or blocks on its reservations by design, and it has no read-your-write
effect on any other row. What is missing is only the ordering guarantee that offerings already have: *once the archive has returned,
no new reservation commits on that schedule*. That matters when a caller archives a schedule and then reasons about its remaining
reservations (a clean-up, a count, a hand-over), and for consistency with how an offering archive behaves. Production has no
schedules, reservations or holds, and no route can write a reservation yet, so nothing is exposed today. The change is cheap and
makes the two archive levers behave the same, so it is proposed as a separate, optional step rather than folded into 031.

Occurrence creation reads the schedule's archived flag in its own statement and has the same property. It is not changed here:
an occurrence is created by staff configuration, not by customers. **Superseded:** it is closed separately by 033 (`docs/architecture/scheduling-occurrence-integrity.md`).

## 2. The fix

`032` replaces **one** function, `scheduling_reservation_integrity()` (the BEFORE INSERT guard 031 created). It now reads the
offering's `schedule_id` (a column that never changes), locks the **schedule row `FOR SHARE`**, and only then locks the offering
row and runs every other check exactly as 031 did. No trigger, table, column, constraint, index or row changes except the version
marker `2b.2.3`.

Effect: a schedule archive (an UPDATE of that row) waits for reservations in flight; a reservation that starts after the archive
committed sees the archived flag and is refused (`SCARC` -> `offering_unavailable`). Many reservations share the lock; only a schedule
edit or archive waits, for the length of one insert.

### Lock ordering (checked against every writer in the repository)

Order everywhere: **schedule row -> offering row -> per-resource advisory lock**, parent before child.

| Writer | Locks taken | Cycle with the guard? |
| --- | --- | --- |
| reservation guard (this file) | schedule share -> offering share -> resource advisory | - |
| `createOffering` | schedule row (UPDATE) -> INSERT of a *new* offering row | no: same order; the new row cannot be held by anyone |
| `updateSchedule`, `archiveSchedule` | the schedule row only | no |
| `updateOffering`, `archiveOffering` | the offering row only (the schedule is *read*, not locked) | no |
| resource guards (030/031), holds | the resource advisory lock only | no |

No writer takes an offering row and then a schedule row, and none holds the resource lock while waiting for either, so the wait graph
has no cycle. A 40-round stress test races bookings, schedule edit and archive, offering edit and archive and asserts no `40P01` and
no half-written reservation.

## 3. Idempotence, rollback

- Needs 031 (`2b.2.2`); refuses otherwise (`SCVER`). `CREATE OR REPLACE`, one transaction, `lock_timeout 5s`. Guards new writes only.
- Rollback `093` restores 031's function **byte for byte** (a containment test compares the two texts) and removes the `2b.2.3` marker.
  **Roll back in reverse order: 093, then 092, then 091.** Running 092 first drops the function but leaves the `2b.2.3` marker
  behind; 093 afterwards would recreate a function with no trigger. The Production handoff states the order.
- `090` (full rollback) already drops the function by name and needs no change.

## 4. Verification

- **Failing first.** `scheduleArchiveRace.integration.test.ts` fails 3 of 4 against 030 + 031 (two ordering tests and the stress
  round); the fourth (a raw INSERT after a committed archive is refused) already held and is pinned.
- **After 032** all 4 pass. The schema suite proves 032 idempotent byte for byte, `093` returns the exact 031 definitions, and 032
  refuses without 031. Containment tests pin the file list, the single function, the lock order inside it, and `093` equal to 031's text.
- **PostgreSQL 16 and 17**: `scripts/tests/verify-scheduling-phase2a.sh` applies 030, 031 and 032 twice each, runs the suites, rolls
  back 093 -> 092 -> 091 on a database that holds data, re-applies all three, then runs the 090 guard and rollback.
- **Mutation check:** removing the schedule `FOR SHARE` makes the two ordering tests fail.

## 5. Alternative considered

Folding the schedule lock into 031 itself, so there is one migration instead of three. Nothing has applied 031 anywhere, so this is
possible, but 031 is merged and its hashes were already recorded for the Production gate; a separate small migration keeps what was
reviewed unchanged and can be skipped if the ordering guarantee is not wanted. The owner can choose either; both end in the same schema.
