# Scheduling availability: timezone pinning (design proposal) and repeated-hour presentation

Status: **proposal for review. Nothing here is a migration, and no timezone field or rule data is touched.** The only code with this document is
a pure presentation helper (`labelLocalInstant`, section 8) and its tests; the calendar is not built.

Companion to `scheduling-phase2b3c-availability-screens.md` (section 5 there sketched an organisation-level pin; this document replaces that
sketch with a comparison of three models and a recommendation). Reviewed against the code on `main` at `3e390017` (PR #499 merged).

## 1. The problem in one paragraph

Weekly hours are wall-clock times with no zone (`09:00-17:00` on Monday). They only mean something once read in a zone, and today the zone
is *looked up every time*: the schedule's `timezone` override if the schedule has one, else `organisations.timezone`, else the platform
fallback `Australia/Adelaide`. So a rule saved today silently changes meaning if someone later edits the organisation's timezone or a
schedule's timezone, and a resource (which belongs to the organisation, not to a schedule) has no schedule to carry a zone at all. Pinning
means: the zone is decided **once, when the first hours are saved**, recorded, and used to read those hours from then on.

## 2. What the code does today (facts, checked)

| Fact | Where |
| --- | --- |
| Effective zone for an offering = `scheduling_schedules.timezone` (nullable) else the organisation's else `Australia/Adelaide` | `lib/scheduling/runtime.ts`, `lib/scheduling/dashboard/availability.ts` `effectiveTimezone` |
| A resource's hours are read in the **organisation** zone; resources have no schedule and no zone column | same |
| The organisation timezone is host-owned (`organisations.timezone`, nullable); the module has no copy | `010_shared_schema.sql` line 102 |
| The schedule form can set **and clear** `timezone` (blank = inherit) | `lib/scheduling/dashboard/forms.ts` |
| Rules and closures are zone-less (`day_of_week`, `time`, `date`) | `scheduling_availability_*` |
| The availability computation takes **one** `timezone` per query and reads every owner's rules in it | `computeAvailability` (`AvailabilityInput.timezone`) |
| Reservations, holds and occurrences **snapshot** their zone (`timezone text NOT NULL`) when created | `010_shared_schema.sql` (reservations, occurrences, series) |
| A resource can be assigned to offerings in several schedules (`scheduling_offering_resources`) | `010` |
| Pilot copy: 4 schedules, all `timezone` NULL; organisation `Australia/Adelaide`; **0 rules, 0 closures** | Neon rehearsal copy, 2026-10-25 |
| `scheduling_settings` is a module-owned, one-row-per-organisation table (currency) | `010` |
| Schedules, offerings and resources carry `updated_at` version tokens that the 2B.2b configuration API compares | `lib/scheduling/config/*` |

The last two rows of facts about the computation matter most: **there is one zone per query**, so two owners of different zones cannot be
combined correctly today. A resource shared by two schedules with different zones is read in whichever offering asks.

## 3. Requirements the model must meet

1. A saved rule never changes meaning because a *setting* changed later (organisation timezone, schedule override).
2. Concurrent first saves for one owner agree on one zone; none is lost, none is read in two zones.
3. A shared resource has one meaning, whoever asks.
4. Daylight saving: wall-clock hours keep their wall-clock meaning across transitions (a 09:00 opening stays 09:00 local).
5. Rules written before pinning (none in Production today) get a defined zone, never a guess at read time.
6. The pin is audited, and changing it later is a deliberate, versioned, confirmed act, never a side effect of another edit.
7. Standalone compatibility: the module may not depend on BrainBase-only tables (the organisation timezone arrives from the host adapter).
8. No effect on LD Tennis, Eve, or any booking data.

## 4. The three models

### A. Organisation-level pinned availability timezone

One new nullable column, `scheduling_settings.availability_timezone`. Set on the organisation's first rule or closure save; every owner of the
organisation reads its hours in it. Schedule overrides stop affecting availability (they would have to be refused or ignored).

- **Pros.** Smallest change (one column, no new table). A shared resource trivially has one meaning. The organisation timezone cannot move saved hours.
  Fits every current tenant: the pilot is one organisation in one zone.
- **Cons.** One zone for everything. A multi-zone organisation (a resort in Adelaide and one in Perth) cannot be modelled; the schedule-level
  override, which exists for exactly this, would stop doing anything for availability. Changing the pinned zone moves **every** owner at once.
  Pinning writes a row that *other* settings (currency) share, so it needs its own concurrency story.

### B. Resource-level timezone plus schedule-level offering timezones

Put the zone on the things that already have rows: `scheduling_resources.timezone` and `scheduling_schedules.timezone` (already exists), both
filled in at first save. The computation reads each owner in its own zone.

- **Pros.** Physically right (a court is somewhere; a service runs somewhere). Reuses the schedule column.
- **Cons.** Pinning **writes to schedules and resources**, which bumps their version tokens (`updated_at`), so saving the first hours of a court
  makes every open edit of that court stale for a reason the person cannot see. The schedule form can *clear* the zone again, which silently
  un-pins the schedule: the pin has to be defended with a trigger or a form change. These two tables are also the ones the host-visible
  configuration API owns; hiding a pin inside them mixes concerns. Needs a migration touching two existing tables (an `ADD COLUMN` on resources
  and a new rule that a non-null schedule zone is immutable once rules exist) and the same core change as C.

### C. Owner-pinned zone in its own module-owned table (recommended)

C1. A new table `scheduling_availability_zones`: one row per owner (an offering **or** a resource) holding the IANA zone that owner's
hours are read in. Nothing is written to schedules, resources, offerings or `organisations`.

```
scheduling_availability_zones
  organisation_id text NOT NULL
  resource_id     text            -- exactly one of these two
  offering_id     text
  timezone        text NOT NULL CHECK (scheduling_is_timezone(timezone))
  pinned_at       timestamptz NOT NULL DEFAULT now()
  pinned_by       text            -- the user id; nullable for backfill
  UNIQUE per owner (partial unique indexes), composite FKs to the owner (ON DELETE CASCADE), same shape as scheduling_availability_rules
```

C2 (rejected variant): a zone column on each rule. Rules of one owner in different zones would need a guard to stop overlap checks and
weekday logic mixing zones; it ends up as C1 with more rows.

C3 (rejected variant): store hours as UTC. Wall-clock opening hours (09:00 every day) are not a fixed UTC time: it breaks at every DST change.

## 5. Comparison

| | A. Org pin | B. Resource + schedule zones | **C1. Owner-pinned table** |
| --- | --- | --- | --- |
| Rules keep meaning when org timezone changes | yes | yes | yes |
| Rules keep meaning when a schedule override changes | only because overrides are ignored | only if the form is stopped from clearing it | yes (the override is only the *default* for the first save) |
| Shared resource, several schedules | one zone, trivially right | right (resource has its own) | right (resource has its own row) |
| Multi-zone organisation | **no** | yes | yes |
| Concurrent first saves | one row per org, contended with currency | writes two shared tables, bumps tokens | one row per owner, `ON CONFLICT DO NOTHING` in the same statement |
| Version tokens of schedules/resources disturbed | no | **yes** | no |
| Touches host tables or existing config tables | no | **yes** | no |
| Standalone compatible | yes | yes | yes (module-owned; org zone comes from the adapter) |
| Changing the zone later | moves every owner | per owner | per owner |
| New schema | 1 column | 1 column + guard on schedules | 1 table + 2 indexes |
| Core change | resolve one zone | per-owner zones in the computation | per-owner zones in the computation (same as B) |
| Production risk today | none (0 rules) | none (0 rules) | none (0 rules) |

**Recommendation: C1.** It is the only model that is correct for shared resources and multi-zone organisations *and* leaves the
schedule/resource version tokens and the host's organisation row alone. A is the right answer **only** if the business decides, now, that an
organisation has exactly one availability zone for ever; if so, say so and the migration shrinks to one column (section 7 notes the delta). Both A and C1 need the same
core change for shared resources if zones ever differ, so choosing C1 does not cost more later.

## 6. How C1 behaves

**What is pinned, and from what.** The first time an owner's hours or closure are saved, the zone is *resolved once* from today's chain and
written:

- offering: its schedule's `timezone` if set, else the organisation's (from the adapter's tenant context), else the fallback;
- resource: the organisation's, else the fallback (a resource has no schedule).

From then on that owner's hours are read in the pinned zone. The chain is only a **default for the first save**; after it, the
organisation's timezone and the schedule override no longer affect existing hours.

**One statement, no race (concurrent first saves).** The pin is written in the same single SQL statement as the first rule:

```sql
WITH pin AS (
  INSERT INTO scheduling_availability_zones (organisation_id, <owner column>, timezone, pinned_by)
  SELECT o.organisation_id, o.id, $zone, $user FROM <owner table> o WHERE o.organisation_id = $1 AND o.id = $2
  ON CONFLICT DO NOTHING
  RETURNING timezone
)
INSERT INTO scheduling_availability_rules ... -- unchanged
```

Two racing first saves both resolve a zone; one insert wins and the other is a no-op. The loser's rules are still valid, because **rules carry
no zone**: they are read in whatever the owner's row says, which is the winner's. The API reads the owner's row back (one extra read-only
statement) and returns the zone actually in force, so the person is told the truth. The existing 034 guard already serialises writers of one
owner; the pin adds no new lock. Fail-closed: before the migration the table does not exist, so the statement fails with 42P01 before any rule
is written and the route answers `503 AVAILABILITY_NOT_READY` (the same mapping as a missing column).

**Audit.** A pin is a write, so it is audited: `scheduling.availability_zone.pinned` (owner, zone, the chain level it came from), written with
the rule's own audit entry when the statement inserted the pin row (decided from the statement's own `RETURNING`).

**Optimistic concurrency.** The pin is immutable until the guarded flow below, so it needs no version token of its own and does not disturb
anyone else's token. A change is an explicit operation carrying the zone it expects (compare-and-set), exactly like the other `STALE_WRITE`
flows.

**Organisation timezone change.** Pinned owners do not move. Owners with no hours yet follow the live chain until their first save. The
settings screen can show "N offerings and resources keep reading their hours in Australia/Adelaide".

**Changing a pinned zone (Phase 2B.3e, not now).** A confirmed, audited, manager-only operation using the comparison that already exists
(`compareAvailabilityAcrossTimezones`: it reports which days and windows shift, drop or merge in the new zone). It either re-reads the same
wall-clock hours in the new zone (the hours stay "09:00") or refuses when the new zone makes some window impossible. It never rewrites rules
silently and it never runs as a side effect of editing a schedule or organisation.

**Rules that exist before pinning.** A backfill in the migration inserts one pin row per owner that has rules or closures, using the zone the
chain resolves **at migration time** (schedule override, else organisation, else fallback), so the meaning today's reader gives them is the
meaning they keep. **Production has 0 rules and 0 closures**, so the backfill is a no-op there (the preflight asserts it; a non-zero count is
reported before anything runs). Owners with no hours are not pinned.

**Daylight saving.** Pinning removes a class of surprise, not the DST rules: wall-clock hours keep their meaning across a transition, the
documented repeated/missing-hour handling (section 6 of the 2B.3c document) is unchanged, and presentation uses section 8.

**Shared resources.** A resource has its own row, so its hours mean one thing for every offering. If an offering is in another zone, the
computation converts **each owner's windows in its own zone** to instants and intersects the instants, which is correct physically. The
screens show the resource's zone on its page and, where an assigned resource's zone differs from the offering's, a plain note. (Today the
computation reads both in one zone; that is the core change below.)

## 7. The required migration (to be written and rehearsed only after you approve a model)

`packages/scheduling/sql/036_availability_zones.sql` (version `2b.3.3`), rollback `097_availability_zones_rollback.sql`. One transaction each,
idempotent, requires 034 (it reuses the owner lock and the SCVER convention), nothing dropped or rewritten.

1. `CREATE TABLE IF NOT EXISTS scheduling_availability_zones` as in section 4, two partial unique indexes (one per owner column), the same
   `resource_id`/`offering_id` exactly-one CHECK as the rules table, composite foreign keys with `ON DELETE CASCADE`.
2. Backfill: one pin per owner with rules or closures, zone resolved as in section 6 from `scheduling_schedules.timezone` and the organisation
   zone passed in as a **migration parameter** (a `DO` block reading `organisations.timezone` only if that host table exists, else the fallback),
   `pinned_by` NULL.
3. A BEFORE UPDATE trigger on the table that refuses any change of `timezone` unless a transaction-local setting names the guarded flow
   (the immutability that A/B would need a guard for).
4. Marker row `2b.3.3`.

Rollback refuses while any pin exists whose zone differs from what the chain currently resolves for that owner (dropping it would silently
re-read those hours in another zone); otherwise it drops the table and the marker.

Core and API changes that accompany it (after the migration is approved and applied, behind a capability check like `partialClosures`):
`resourceTimezone`/`offeringTimezone` on the computation input, `computeAvailability` converting each owner in its own zone, the repository's
create statements gaining the `pin` CTE, `GET availability` returning `timezone` + `pinned` + `source`, and the screens' timezone panel reading
the pinned zone instead of resolving it.

If you choose **A** instead: the migration is one `ALTER TABLE scheduling_settings ADD COLUMN availability_timezone text CHECK (...)`, pinned by
the same CTE against the settings row, with the same audit and the same refusal on change; the schedule override is ignored for availability and
the schedule form says so.

## 8. Repeated-hour presentation (verified, helper built, calendar not built)

When the clocks go back, one local time happens twice, so a slot list that shows only "02:30" is ambiguous. The rule: **a local time that
repeats carries its UTC offset, nothing else does.**

`labelLocalInstant(instant, timezone)` in `@scheduling/core` (`packages/scheduling/src/time.ts`) returns `{ date, time, offset, repeated, text }`, with
`text` = `02:30 UTC+10:30` when repeated and `02:30` otherwise. The offset is read **at the instant** and `repeated` is decided by resolving the
local time back to instants (two candidates = repeated), so it is correct for any zone and any size of change.

The brief's example (`02:30 UTC+10:30` / `02:30 UTC+09:30`) is verified for the chosen zone, **not assumed for others**. Taken from the
zone database (ICU) for 2027:

| Zone | Fall-back (repeat) | Offsets | Spring-forward (skip) |
| --- | --- | --- | --- |
| Australia/Adelaide | Sun 4 Apr 2027, local 02:00-03:00 repeats | `+10:30` then `+09:30` | Sun 3 Oct 2027, 02:00-03:00 does not exist |
| Australia/Sydney | Sun 4 Apr 2027, 02:00-03:00 | `+11:00` then `+10:00` (not the Adelaide offsets) | Sun 3 Oct 2027 |
| Australia/Lord_Howe | Sun 4 Apr 2027, **01:30-02:00** (half an hour) | `+11:00` then `+10:30` | Sun 3 Oct 2027, 02:00-02:30 skipped |
| Pacific/Auckland | Sun 4 Apr 2027, 02:00-03:00 | `+13:00` then `+12:00` | Sun 26 Sep 2027 |
| Europe/London | Sun 31 Oct 2027, 01:00-02:00 | `+01:00` then `+00:00` | Sun 28 Mar 2027 |
| Australia/Perth, Darwin | none | none | none |

The tests (`packages/scheduling/tests/localInstantLabels.test.ts`, 26 cases) assert, for five zones across every 2027 transition at five-minute
steps, that **no two instants of a day share a label** and that exactly twice the repeated length carries an offset (Adelaide: 24 instants
over 60 minutes; Lord Howe: 12 over 30). A skipped time is never the label of any instant.

**Slot generation stays deterministic**, using the approved window-anchored grid (unchanged, `generateSlots`): slots are anchored at the start of
each continuous operating interval and step in elapsed minutes, so on the fall-back day an hourly 00:00-06:00 window yields
`00:00 01:00 02:00 UTC+10:30 02:00 UTC+09:30 03:00 04:00 05:00`, and on the spring-forward day `00:00 01:00 03:00 04:00 05:00`. The labels are
presentation only; they never change which slots exist.

Open for the calendar phase (decision 3 in the report): whether customers see `02:30 UTC+10:30`, a friendlier "02:30 (second time)", or the
repeated hour is not offered at all. The helper returns the data for all three; the default above is the unambiguous, locale-independent one.

## 9. Decisions needed

1. **Model.** C1 (recommended) or A (only if one zone per organisation is the permanent product rule).
2. Approve writing and rehearsing `036` (and its rollback) on a fresh Neon branch, then a separate Production approval. Production has no hours,
   so the backfill is empty; applying 036 before the first hours are saved is the safe order.
3. Approve the core change (per-owner zones in the computation) as its own PR before the calendar reads resource hours.
4. Pin timing for owners with no hours: pin on the first saved rule or closure (recommended), or when an owner is first assigned or opened.
5. Whether the guarded zone-change flow (2B.3e) may be used when reservations already exist for the owner (recommended: refuse, show the count).
6. Customer-facing wording of the repeated hour (section 8).
