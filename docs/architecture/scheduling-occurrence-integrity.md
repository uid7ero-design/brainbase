# Scheduling occurrence integrity (version 2b.2.4)

Status: **implemented on `fix/scheduling-occurrence-integrity`, draft PR, not merged, not applied anywhere.** It adds one additive
migration (`033_occurrence_integrity.sql`, rollback `094_occurrence_integrity_rollback.sql`), one small repository mapping and tests.
It activates nothing. Applying it is a separate owner-run step, after 030, 031 and 032, and needs its own approval.

## 1. The findings (reproduced first)

The 2B.2 reservation guards protect reservations. Occurrence creation was the remaining unprotected writer:

| | Reservation (030-032) | Occurrence (before 033) |
| --- | --- | --- |
| raw INSERT into an archived offering or schedule | refused (`SCARC`) | **accepted** |
| offering or schedule archive in flight, creation starts | creation waits, then is refused | **proceeds and commits** |
| creation in flight, archive starts | archive waits | **archive commits immediately** |
| resource assigned to the offering | checked (`SCLNK`) | checked (`SCLNK`, resource-bearing only) |

`createOccurrence` checked "not archived" only in its own statement's WHERE clause: a snapshot read with no lock. Reproduced with
deterministic two-connection tests (a transaction held open, no timing): against 030 + 031 + 032, 8 of the 15 tests in
`occurrenceIntegrity.integration.test.ts` fail (the two raw INSERTs, the four in-flight archive tests, the isolation test and the
resource variant). Severity: latent. No route calls `createOccurrence` and nothing consumes the reservation repository, so nothing is
exposed today. It must be closed before any occurrence-writing route, series generator or classes/coaching workflow exists.

## 2. The fix

`033` replaces **one** function, `scheduling_occurrence_integrity()` (the BEFORE INSERT guard 031 created). It now:

1. requires READ COMMITTED for **every** occurrence (it takes locks; `SCISO` otherwise). Before it did so only for a resource-bearing one;
2. reads the offering's `schedule_id`, locks the **schedule row `FOR SHARE`**, then the **offering row `FOR SHARE`**;
3. refuses an archived offering or schedule (`SCARC`; the repository reports `offering_unavailable`);
4. for a resource-bearing occurrence takes the per-resource advisory lock and checks the assignment exactly as 031 did (`SCLNK`).

No trigger, table, column, constraint, index or row changes except the version marker `2b.2.4`. It requires 032 (`SCVER` otherwise).
The one application change: `createOccurrence` maps the `offering_unavailable` raised by the guard (an archive that committed between
its statement snapshot and the guard's locks) to the same result it already returns for the snapshot case, instead of throwing.

### Lock ordering

Identical to the reservation guard in 032: **schedule row -> offering row -> per-resource advisory lock**, parent before child.
`createOffering` takes the schedule then inserts a *new* offering; `updateSchedule`/`archiveSchedule` take the schedule only;
`updateOffering`/`archiveOffering` the offering only; `scheduling_cancel_occurrence` the per-occurrence capacity lock and the occurrence
row; resource guards the resource lock only. No writer takes an offering row then a schedule row, and none holds a resource lock while
waiting for either, so there is no cycle. A 40-round stress test races three occurrence creations (one resource-bearing), a booking on
an existing occurrence, schedule edit and archive, offering edit and archive: no `40P01`. FOR SHARE never conflicts with the key-share an
occurrence insert takes through its foreign keys, so concurrent creators share the locks.

## 3. Occurrence and recurrence semantics (inspected)

- An occurrence is one dated instance of an offering: local date/time are the source of truth, `starts_at`/`ends_at` the derived UTC
  instants. Unique per `(organisation, offering, local_date, local_start_time)`; `resource_id` optional, composite-FK scoped to the organisation.
- A resource-bearing occurrence owns one **exclusive hold** for its whole window (deferred `SCHLD` trigger requires it; the exclusion
  constraint stops overlap). Reservations of an occurrence hold the occurrence (headcount), never the resource.
- Reservations may target an occurrence only for the headcount presets (`classes_coaching`, `event_capacity`; table CHECK).
- Recurrence: `scheduling_series` rows describe a pattern and `scheduling_series_pauses` pause it. **No generator exists**, so nothing
  creates occurrences from a series yet. A generator must go through `createOccurrence` (or the same guard) and treat `duplicate_occurrence`
  and `resource_conflict` as per-date results, not failures.
- Occurrences carry their own `capacity` (participants), independent of the offering default.

## 4. Capacity per preset (participants versus physical occupancy)

| Preset | Capacity meaning | Resource role | Rule enforced |
| --- | --- | --- | --- |
| `classes_coaching` | participants per occurrence (`headcount_per_occurrence`) | optional court/room, occupied **exclusively** for the window | participants <= occurrence capacity (`SCCAP`); **no** comparison with `resource.capacity` |
| `event_capacity` | participants per occurrence | same | same |
| `resource_hire`, `appointments` | one exclusive booking | the resource itself | party <= `resource.capacity` / `min_party` (`SCPTY`, 031) |
| `restaurant_tables` | party fits the table | the table | `SCPTY` |
| `accommodation` | exclusive stay | the room | `SCPTY` (party) |

`resource.capacity` is how many people one *reservation* of that resource may bring. For a class the resource is merely reserved, so a class
of 12 on a court with capacity 4 is valid. 033 deliberately does **not** compare them (a containment test pins that the guard never reads a
capacity), and a test books exactly 12 participants onto such a class, refuses the 13th (`SCCAP`) and asserts one hold. If a venue wants a
physical headcount limit (fire safety) it is a **new** rule, to be designed as an optional resource field, not inferred from `capacity`.

### First-release restriction: occurrences for `classes_coaching` only

The database still accepts an occurrence on an offering of any preset (033 does not read the preset; a schema change would need its own
rehearsal). The restriction is enforced in the **shared persistence layer**, not the dashboard: `createOccurrence` (in
`@scheduling/postgres`) inserts only where the offering's schedule preset is in `OCCURRENCE_WRITING_PRESETS` (`@scheduling/core`),
currently `['classes_coaching']`, and returns `preset_not_supported` otherwise, writing no occurrence and no resource hold. The test is part
of the same INSERT, and a schedule's preset is locked once it has offerings, so eligibility cannot change under a writer. Any other
route, job or script that goes through the repository gets the same answer. A caller that writes SQL directly can still insert (the
guard in 033 is about archive state, assignment and isolation), so there is no raw-SQL route in the application, and a containment test
pins that nothing but the repository writes `scheduling_occurrences`.

### Future expansion: `event_capacity` (not enabled)

`event_capacity` has the same capacity semantics as classes (participants per occurrence, one exclusive resource hold), so enabling it is
a one-line change to `OCCURRENCE_WRITING_PRESETS` plus the checks below. It stays closed until all of these exist, separate from the Eve
ticketing product (Eve sells tickets, issues QR codes and takes payments through Stripe; Scheduling event_capacity is a headcount against
a dated occurrence and takes no payment):

1. A written decision on whether an internal event booking and an Eve ticket order may ever refer to the same event, and if so a
   mapping owned by neither product's tables. The default is no link: Scheduling must not read or write `event_*` tables, and Eve must
   not read `scheduling_*` tables (the existing containment tests keep this).
2. A waitlist or overbooking policy, and a physical headcount limit if the venue needs one (see above).
3. Its own tests (capacity, cancellation, archive races) and, if the database should also refuse other presets, a migration with its own
   rehearsal.

Restaurant, hotel and every other occurrence-writing flow stay closed the same way (they are not in the list).

## 5. Safety properties and tests

`packages/scheduling-postgres/tests/occurrenceIntegrity.integration.test.ts` (15 tests, real Postgres): raw INSERTs into archived
offering/schedule refused (with and without a resource); live offering still accepts; repository results after either archive; the four
two-way archive races; the 40-round deadlock stress; cross-organisation (foreign key refuses, another organisation's archive does not
affect this one); `SCLNK` for an unassigned resource; `SCISO` under REPEATABLE READ; class capacity versus resource capacity; cancelling
an occurrence after its schedule was archived; duplicate-slot and resource-conflict results. Mutation checks: removing the schedule lock
fails the two schedule race tests, removing the offering lock fails the two offering race tests. The schema suite proves 033 idempotent
byte for byte, 094 restoring 031's function exactly with data untouched, and `SCVER` without 032. The containment suite pins the SQL.

## 6. Rollout

Owner-run, after 030, 031 and 032, with its own approval, preflight, verification and rollback (094). Rollback order is 094, 093, 092, 091.
