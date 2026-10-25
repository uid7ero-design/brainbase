# Scheduling Phase 2B.3a: the shared availability core

Status: built, pure and standalone. No SQL, no route, no screen, no reservation, no hold. Merged behaviour elsewhere is unchanged.

Code: `packages/scheduling/src/availabilityRules.ts` (validation, overnight splitting, date helpers) and
`packages/scheduling/src/availability.ts` (the computation). Both are exported from `@scheduling/core`, import nothing outside the
package, take no clock and perform no I/O. Tests: `packages/scheduling/tests/availability*.test.ts`.

## 1. Approved product decisions, and where they live

| Decision | Implementation |
| --- | --- |
| A. Read-only calendar in 2B.3d (day, week) | Not built here. 2B.3a supplies the free intervals the calendar will draw. |
| B. An offering with no rules is unavailable | `computeAvailability` returns no slots and the reason `no_offering_availability`. The same rule applies to resources (`resource_no_availability:<id>`). |
| C. Overlapping rules are refused | `validateAvailabilityRuleSet` and `validateAvailabilityExceptionSet`. The repository protection is specified in section 6 (2B.3b); no SQL migration. |
| D. Timezone changes are not silent | Section 5. |
| E. 44 px targets | Applies to 2B.3c and 2B.3d screens; nothing visual in 2B.3a. |
| F. Free-slot calculation is advisory | The computation is pure and read-only. The database hold exclusion constraint stays the only authority. |
| G. Participant and resource capacity stay separate | The computation never reads `Offering.capacity` or `Resource.capacity`; a test proves they change nothing. |

## 2. Semantics

All intervals are half-open instants `[start, end)`. Adjacent intervals touch and never overlap, so back-to-back bookings are legal and a
boundary instant belongs to the later interval.

**Rules.** A rule is a local wall-clock window on one weekday (`0` = Sunday), valid between inclusive `validFrom`/`validTo` dates (either may
be null). `endTime` may be `24:00`, the only way to say "until midnight". `24:00` is accepted by the availability validators only:
`isLocalTime` and the existing `validateAvailabilityRule` are unchanged. PostgreSQL's `time` and the table's `end_time > start_time` check
already allow it, so storing it needs no SQL.

**Overnight / cross-midnight.** Stored as two rules, one ending at `24:00` and one starting at `00:00` on the next weekday
(`splitOvernightRule` builds the pair and shifts the second half's validity dates by one day). The computation merges them into one
continuous instant interval, so a slot can straddle local midnight.

**Ownership.** A rule or exception belongs to exactly one owner, an offering or a resource, matching the table's `num_nonnulls = 1`
check (the established single-rule validator only required at least one; the set validator requires exactly one). "Both" is a property of the
computation: for an offering that uses resources, a resource can offer a slot only where the offering's availability and that resource's
availability overlap, minus that resource's active holds. An offering with no resources (an empty resource list) is decided by its own
availability alone.

**Exceptions.** Inclusive local date ranges. `closed` removes the dates and beats any override on the same date. `override` replaces the
owner's weekly windows on those dates with its own `windows`. The stored exception row has no hours, so `windows` is the core's
addition (see risk 1). An override with no windows is refused by validation and, if it reaches the computation, counts as closed.
Two exceptions of the same owner and kind may not share a date; a closure inside an override range is allowed.

**Daylight saving (boundary rules).**
- A time that does not exist (spring forward) resolves to the instant the clocks jump, so `02:30-05:00` on the changeover day opens at the
  jump rather than 30 minutes late. A window wholly inside the gap disappears.
- A time that happens twice (fall back) resolves to the earlier instant, the same rule as `resolveLocalTime`. A window spanning the
  repeated hour keeps its true elapsed length (a `00:00-06:00` window is 7 real hours on a fall-back day).
- A `00:00-24:00` rule is 23 hours on a spring-forward day and 25 on a fall-back day.
- Every window touched by these rules is reported in `adjustments` (`start_in_gap`, `end_in_gap`, `start_ambiguous`, `end_ambiguous`,
  `dropped_in_gap`) so a screen can tell the user.

**Slots.** Starts lie on a grid anchored at the start of each continuous offering interval and advance by `stepMinutes`. A slot is kept only if
its whole `[start, start + duration)` lies inside the resource's free intervals. Holds and resource hours remove slots but never shift the
others. `notBefore` (supplied by the caller; the core has no clock) drops earlier slots.

**Inactive and archived.** An inactive resource and an archived offering have no availability. Released holds and other resources' holds are
ignored.

## 3. API

| Function | Purpose |
| --- | --- |
| `validateAvailabilityRuleSet`, `validateAvailabilityRuleForSet` | Rules: reuses `validateAvailabilityRule`, adds `24:00`, exclusive ownership, unique ids, no same-owner overlap. |
| `validateAvailabilityException`, `validateAvailabilityExceptionSet` | Exceptions: dates, kind, ownership, windows, same-kind overlap. |
| `splitOvernightRule` | Cross-midnight rule to its two storable parts. |
| `expandOwnerAvailability` | One owner's weekly rules and exceptions to instant intervals over local dates, in one zone. |
| `localWindowOnDate` | One local window on one date to an instant interval, with the daylight-saving handling. |
| `normaliseIntervals`, `intersectIntervals`, `subtractIntervals`, `subtractHolds` | The interval algebra, half-open. |
| `generateSlots` | Slots from anchors, allowed intervals, duration and step. |
| `computeAvailability` | Validates, then returns free intervals per resource, slots, adjustments and reasons; or `invalid_input` / `timezone_changed`. |
| `compareAvailabilityAcrossTimezones` | The review that must precede a timezone change. |

Query range is at most `MAX_AVAILABILITY_QUERY_DAYS` (93) days. Output is plain data and deterministic: the same input always gives the same
output regardless of list order, and the input is never modified.

## 4. Tests

Deterministic unit tests: Australia/Adelaide summer and winter and both 2026 changeover days, Australia/Perth, Europe/London and
America/New_York changeovers, overnight rules (including across both Adelaide changeovers), interval boundaries, adjacent and overlapping rules,
exceptions replacing and removing availability, offering/resource intersection, holds, missing rules, timezone-change scenarios, input
validation, determinism and purity. Seeded property tests (a fixed-seed generator, no new dependency): 300 random inputs over six zones with
inputs placed on changeover dates (including Lord Howe's 30-minute shift) check that slots are unique, sorted, exactly the requested length,
inside the free intervals, clear of active holds, on active resources and offerings only, and repeatable; interval-algebra properties; and
continuity of all-day rules across every changeover. Static tests pin that the modules reference no repository or write port, no clock, and
no asynchronous call, and the existing package boundary test covers every new file.

## 5. Timezone-change policy

Rules are wall-clock times with no zone of their own, so changing the zone they are read in changes which instants the same rules mean. That
must never happen silently.

1. The zone is an explicit argument to every computation; there is no default.
2. If the caller passes the zone the rules were authored in (`authoredTimezone`) and it differs from the zone being read,
   `computeAvailability` refuses (`timezone_changed`) unless the caller sets `allowTimezoneReinterpretation` after a confirmation.
3. Before any change is saved, the host runs `compareAvailabilityAcrossTimezones` over a horizon (the next 93 days): UTC offsets in both zones,
   how many slots are removed, added and unchanged, and every window that lands on a nonexistent or repeated time in the new zone. If
   `requiresConfirmation` is true the user must confirm explicitly; the confirmation and the report are audited.
4. History is never re-derived. Existing reservations and occurrences keep their stored instants and stored zone. Only availability computed
   after a confirmed change uses the new zone.
5. Recommended storage (2B.3b, no SQL): the first time rules are saved for a schedule, the API writes the resolved zone into the existing
   nullable `scheduling_schedules.timezone`, which pins the schedule. A later change of the organisation's timezone then does not move
   that schedule's availability, and a change of the schedule's own timezone goes through step 3.

## 6. Prepared, not built: later stages

Each stage is its own draft PR, ships Playwright specs in `tests/browser/scheduling/` run through the merged harness
(`npm run test:scheduling:browser`), and starts only after the previous review gate.

**2B.3b PostgreSQL repository and guarded CRUD API.** Adapter in `packages/scheduling-postgres` plus routes under `schedulingRoute()` for rules and
exceptions: manage permission, the effective-permission rules of the dashboard, a version token and `STALE_WRITE` 409, audit rows, tenant
isolation. Overlap protection without SQL: every rule or exception write runs in one transaction that first locks the owner's row
(`SELECT ... FOR UPDATE` on the resource or offering, the same lock the resource-concurrency work uses), reads that owner's rules, runs
`validateAvailabilityRuleSet` over existing plus new, and only then inserts. Concurrent editors serialise on the lock, so two requests cannot
both pass validation against stale data. PostgreSQL integration proofs cover concurrent overlapping inserts, ownership, cross-organisation
isolation and the `24:00` round trip. Browser coverage: permission matrix and stale writes for rules and exceptions through the API.

**2B.3c Working-hours and closure screens.** Per-resource and per-offering weekly hours editor and closure list at a 44 px target where practical
(WCAG 2.2 AA minimum), keyboard first, 390 px first, a daylight-saving notice from `adjustments`, and the timezone review dialog. Browser
coverage: manager vs view-only vs denied, stale write, responsive and axe in light and dark, dialog focus trap.

**2B.3d Read-only availability calendar and free-slot API.** Day and week views (month later), `GET` availability using `computeAvailability`
(reads holds, writes nothing), viewer privacy, times shown in the schedule zone with the zone name. Browser coverage as above plus a
"calendar writes nothing" proof (row hashes unchanged) and DST-week rendering.

**2B.3e Hardening.** Timezone-change flow end to end, accessibility pass, audit completeness, performance with realistic rule counts, DST fixtures
against live zone data, documentation.

## 7. Risks needing a decision before 2B.3b

1. **Override windows have no column.** `scheduling_availability_exceptions` stores dates and a kind only. An override needs hours.
   Options: ship closures only in 2B.3b/c and defer overrides; add a reviewed migration (a `windows` column) in 2B.3b; or express a special
   opening as validity-dated rules (cannot replace a weekday's normal hours, so only partly equivalent).
2. **Overlap protection is application-level.** Locking the owner row serialises writers, but a direct SQL writer could still insert an
   overlapping rule. Acceptable while the API is the only writer; revisit if another writer appears (a reviewed exclusion constraint would close it).
3. **Pinning the zone.** Confirm that writing `scheduling_schedules.timezone` on first rule save is acceptable (section 5.5).
4. **"Open whenever the offering is" for resources.** Missing resource rules mean unavailable, so a resource that should follow the
   offering needs explicit `00:00-24:00` rules. The UI can offer that as a one-click default that writes explicit rules; confirm.
5. **Repeated-hour end times.** An end inside a repeated hour resolves to the earlier instant. That is deterministic and reported, but a
   business open "until 02:30" on a fall-back night is open for the first 02:30 only; confirm this is acceptable or whether a repeated-hour
   window should extend to the later pass.
6. **Slot grid anchor.** The grid is anchored at the start of each continuous offering interval. If a business wants slots on fixed clock
   minutes regardless of opening time, the anchor changes (a small core change).
