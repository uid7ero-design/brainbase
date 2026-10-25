# Scheduling: owner-pinned availability zones (model C1, as built)

Status: implemented on a draft PR; **migration 036 is staged and NOT applied anywhere.** Design and trade-offs are in
`scheduling-availability-timezone-pinning.md` (merged); this document records what was built, how the first write stays atomic on the Neon HTTP driver, and the zone-change policy.
The pure shared-core change (each owner read in its own zone) is a separate PR.

## 1. What a pin is

`scheduling_availability_zones` holds one row per **owner** (an offering or a resource): the IANA zone that owner's weekly hours and closures are read in, how it was pinned
(`first_rule`, `first_closure`, or `backfill`), who, and when. It is module-owned (the standalone core needs nothing from the host), carries the organisation in composite foreign keys to the owner
(a pin can never name another organisation's resource or offering, and it is removed with its owner), and is the only thing the migration adds.

- **Decided once.** The first rule, overnight window or closure saved for an owner pins its zone. The zone is the default for that first save only: an offering's schedule timezone if it has one, else the
  tenant's (the organisation's, or the platform fallback); a resource has no schedule, so the tenant's. The browser's timezone is never used.
- **Never changed by a write.** A later write naming another zone is ignored for the pin (the rule is still stored, read in the pinned zone).
- **Not coupled to anything else.** Establishing a pin writes nothing to `organisations`, `scheduling_schedules`, `scheduling_resources` or `scheduling_offerings`: no timezone field and no version token moves
  (tested by content hash on PostgreSQL and on the real Neon driver). Changing the organisation's timezone or a schedule's timezone later does not move a pinned owner's hours.
- **Shared resources.** A resource has one pin, whichever offering or schedule asks; an offering of another schedule keeps its own pin. The pure computation (separate PR) reads each owner in its own zone and intersects instants.

## 2. First-write atomicity, and the Neon HTTP driver

**The driver's limits (observed against a real Neon branch).** `@neondatabase/serverless` `neon(url)` (what `lib/db.ts` uses) sends **one statement per HTTPS request**; each request is its own implicit transaction.
A request naming two statements is refused (`42601`, "cannot insert multiple commands into a prepared statement"), and a transaction-local setting from one request is gone in the next: there is no interactive
`BEGIN ... COMMIT` across requests. (`sql.transaction([...])` batches non-interactively, but the scheduling adapter deliberately does not depend on it: `executor.ts` states that every repository operation is ONE statement.)
Errors arrive as `NeonDbError` with the SQLSTATE in `.code`; concurrent calls are separate server connections, so a Promise.all of calls is a real race.

**So the pin and the rule are one statement**, a CTE (`PostgresAvailabilityRepository.pinCte`):

```sql
WITH pin AS (
  INSERT INTO scheduling_availability_zones (organisation_id, <owner column>, timezone, source, pinned_by)
  SELECT z.organisation_id, z.id, $zone::text, 'first_rule', $by::text FROM <owner table> z WHERE z.organisation_id = $org AND z.id = $owner
  ON CONFLICT DO NOTHING RETURNING timezone),
forced AS (SELECT count(*) AS n FROM pin)
INSERT INTO scheduling_availability_rules (...) SELECT ... FROM <owner table> o CROSS JOIN forced WHERE ...
RETURNING id, updated_at, (SELECT n FROM forced)::int AS pinned
```

- **Atomic.** One statement commits or rolls back as a whole: a refused first write (overlap, archived offering, inactive resource) leaves **no pin** (tested on PostgreSQL 16/17 and the Neon driver).
- **Ordered.** The `forced` aggregate makes the pin insert run before the first rule tuple is produced, so the BEFORE INSERT trigger of 036 (which refuses availability whose owner has no pin) sees it.
- **Race-free.** `ON CONFLICT DO NOTHING` on the owner's primary key: of N racing first writes one pin wins and the rest are no-ops, so two zones can never be established; a racing writer waits on an
  uncommitted pin and, if that transaction rolls back, pins its own zone; if it commits, uses the winner's (both tested). **Rules carry no zone**, so the losers' rules are read in the winner's zone: nothing is lost
  and nothing disagrees. The statement reports whether *it* created the pin, so exactly one writer audits it.
- **Fail closed.** Without 036 the statement does not analyse (`undefined_table`, `42P01`, naming `scheduling_availability_zones`): nothing is written, the repository raises
  `AvailabilityZonesNotReadyError` and the route answers `503 AVAILABILITY_ZONES_NOT_READY`. Reads (`getZone` is `null`, `capabilities.zones: false`) and removals keep working. Proved on the real driver
  before 036 was applied.
- **Every writer is held to it.** The trigger refuses an unpinned owner's availability for raw SQL too (`SCZON`); the legacy `SchedulingConfigRepository.addAvailabilityRule/Exception` pin in the same way.

Audit: the pin is audited as `scheduling.availability_zone.pinned` (owner, zone, source) by the writer whose statement created it, before that write's own audit entry; a refusal audits nothing.

## 3. What the database enforces (migration 036)

| Rule | How | SQLSTATE |
| --- | --- | --- |
| availability needs its owner's pin | BEFORE INSERT trigger on rules and closures (fires after 034's guard) | `SCZON` |
| a pin cannot be updated (zone, owner, organisation, anything) | BEFORE UPDATE trigger | `SCZON` |
| a pin cannot be removed while its owner exists | BEFORE DELETE trigger (the owner's delete cascades it) | `SCZON` |
| valid IANA zone | CHECK `scheduling_is_timezone` | `23514` |
| exactly one owner; a recorded source | CHECKs | `23514` |
| the owner is of the SAME organisation (tenant isolation in the database) | composite foreign keys | `23503` |
| one pin per owner | primary key `(organisation_id, owner_kind, owner_id)` | `23505` |
| a missing / other-organisation owner is still a foreign-key refusal | the zone trigger stands aside, as 034's guard does | `23503` |

**Backfill.** Availability that predates pinning gets a pin holding the zone the reader resolves today (the schedule's override, else `organisations.timezone`, else the platform fallback), so no saved hours change
meaning; with no `organisations.timezone` to resolve from it refuses (`SCVER`) rather than guess. Production has none. **Rollback** (097) refuses while an owner with availability is pinned to a zone the reader would not resolve.

## 4. Changing a zone: policy (initial release) and the later design

**Initial release.**

- A pinned zone **cannot be edited through the UI or the API**; there is no endpoint, no form field and no migration that offers it. The screens show the zone and say it is fixed.
- The database refuses every update or delete of a pin (`SCZON`), so even a direct SQL session cannot change one by accident. A zone change needs a **reviewed conversion** (below): an explicit migration or script that is approved and rehearsed, never inferred.
- A zone is **never inferred** from the browser, the organisation's timezone, a schedule's timezone, or a change to either.
- Historical availability is **not rewritten**: rules, closures, reservations, occurrences and holds keep what they are (reservations, occurrences and holds already snapshot their own `timezone` and UTC instants).
- Whatever the conversion, it is **refused while reservations, occurrences or relevant holds exist** for the owner (see preconditions).

**The later guarded operation (Phase 2B.3e; not built).** Inputs: the owner, the zone it expects to leave (compare-and-set against the pin), the new zone, and a typed confirmation. It runs only when all hold:

1. no live reservation, occurrence or active hold references the owner (for a resource: any offering it is assigned to; for an offering: its own occurrences and reservations); the refusal reports the counts;
2. the comparison report (`compareAvailabilityAcrossTimezones`, extended to owners) has been shown and confirmed: which days and windows shift, drop or merge, and every window that lands on a repeated or missing hour in the new zone;
3. the owner's rules and closures are unchanged since the report (version tokens), or the operation refuses;
4. the caller is a manager and the change is audited with the old and new zone, the report's counts, and the actor.

It then, in one reviewed statement or migration taking the owner lock, either **re-reads the same wall-clock hours in the new zone** (rules untouched, the pin replaced: "09:00 stays 09:00") or refuses when some window becomes impossible. It never rewrites a rule's times
to "preserve instants" (that is a different, lossy conversion: not representable across a DST change) and never runs as a side effect of editing a schedule or the organisation. Until it exists, the trigger makes any change impossible.

## 5. Evidence

- PostgreSQL 16.14 and 17.11: `availabilityZones.integration.test.ts` (34 tests: atomic first writes, refused writes leave no pin, 12 simultaneous first writes naming 12 zones, a rollback-then-pin race and a commit-then-pin race, the database refusals, nothing else
  touched, idempotent migration, backfill from a schedule override / organisation / fallback, refusal without a resolvable organisation, rollback with data and its refusal, reapplication, fail closed and recovery) plus 9 API tests and the earlier suites updated for 036.
- The real Neon HTTP driver against a disposable branch (`neonDriver.integration.test.ts`, gated by `SCHEDULING_NEON_DRIVER_URL`): 5 tests before 036 and 18 after.
- The migration rehearsal on a fresh Neon branch from Production: `scheduling-migrations-034-035-036-production-handoff.md`.
