# Scheduling Phase 2B.3d: the read-only availability calendar

Status: implemented on `feat/scheduling-availability-calendar`, draft PR, **not merged, not deployed**. No migration, no Production SQL.
The authenticated Production availability test (the first Monday 09:00-12:00 rule and its zone pin) is completed separately, before the calendar is released.

## What it is

A calendar that answers, for one offering or one resource, over a day or a week:

- when it is **open** (weekly hours after closures),
- what a **closure** removed (whole-day or part-day),
- what is **free** (the offering's hours intersected with each resource's hours, minus the resource's live holds),
- what is **held** (live reservations and scheduled sessions on a resource),
- which **start times are bookable** on the offering's window-anchored grid (advisory: the database's exclusion constraint stays the only authority on booking).

It is **read only for everyone**. It creates no reservation, occurrence, hold or payment; it saves no hours, pins no zone and writes no audit entry.

## Where it lives

| Layer | File | Notes |
| --- | --- | --- |
| Pure view model | `packages/scheduling/src/availabilityCalendar.ts` | `buildOfferingCalendar`, `buildResourceCalendar`, `calendarRules`, `calendarExceptions`. Built on `computeAvailability` and `expandOwnerAvailability`; adds only days, lanes and clipping. No clock, database or randomness. |
| Repository read | `PostgresSchedulingConfigRepository.listLiveHoldsForResources` | One `SELECT`, tenant scoped, live holds only, half-open overlap, needs `scheduling.view`. Added to the persistence port. |
| API | `lib/scheduling/config/calendar.ts` and two `GET` routes | `/api/scheduling/offerings/{id}/calendar` and `/api/scheduling/resources/{id}/calendar`, behind `scheduling.view`. |
| Pure client helpers | `lib/scheduling/dashboard/calendar.ts` | Dates, wall-clock labels in a named zone, positions inside a day. No Intl wording that depends on locale data. |
| Screens | `app/scheduling/_components/CalendarScreen.tsx` and two pages | Time grid on 768px and up, agenda below. |

## API contract

`GET .../calendar?from=YYYY-MM-DD[&to=YYYY-MM-DD][&step=MINUTES]` (`step` only on the offering route).

- `from`/`to` are inclusive **local dates in the zone the calendar is drawn in**, at most 14 days apart (`to` defaults to `from`).
- Anything else (unknown or repeated parameter, bad date, range over 14 days, bad step) is `400 INVALID_INPUT`.
- `404` for a missing id **and** for another organisation's id (the same answer). `401`/`403` come from the central guard.
- `422 CALENDAR_UNAVAILABLE` when the stored hours cannot be drawn (the engine refuses an invalid set); nothing is guessed.
- `503 AVAILABILITY_NOT_READY` / `AVAILABILITY_ZONES_NOT_READY` before migrations 034 / 036, as the hours API does.
- The body never carries an organisation, a reservation id, an occurrence id or a hold id. A hold is `{ startsAt, endsAt, kind: 'reservation' | 'session' }`.

Response: `{ offering | resource, zone: { value, pinned, source }, timezone, fromDate, toDate, days[], lanes[], slots[], slot, adjustments[], reasons[] }`.

## Decisions

1. **Days have their true length.** Each day carries `minutes` (1380, 1440 or 1500 for Adelaide), its UTC offset at the start of the day and the instants of its whole local hours. The grid draws a 23-hour day shorter and a 25-hour day longer, labels it, and never shows a 02:00 on the day it does not exist.
2. **Each owner is read in its own pinned zone.** The calendar is drawn in the offering's zone; a resource in another zone is read in its zone (a wider range, then clipped) and keeps its true instants. The screen says so ("Court A's hours are set in Australia/Perth (UTC+8)").
3. **Missing hours mean not available**, drawn as nothing, with the reason in words. Nothing is implied.
4. **Looking never pins.** An owner with no hours shows the zone its first save would pin, labelled "not fixed yet"; no row is written.
5. **Held time is shown even outside a resource's hours.** A booking made before the resource opens is still held.
6. **Slots are window-anchored**, exactly as the engine computes them: the grid starts at the start of each continuous offering window; holds and resource hours remove slots but never shift the others. `step` changes the spacing only.
7. **Narrow screens get an agenda, not a squeezed grid.** The same agenda is available under the grid for screen readers and keyboard users.

## Out of scope (deliberately)

- Creating or moving anything: reservations, occurrences, holds, payments, recurrence.
- Offering-level occurrences that hold no resource are not drawn as occupied time (only resource holds are). That belongs with reservations (a later phase).
- Public or customer-facing availability.
- Editing from the calendar. The page links to the existing hours screen ("Edit hours" for a manager, "View hours" for a viewer).

## Evidence

Run on 2026-10-29 against `origin/main` be98c897 plus this branch:

| Check | Result |
| --- | --- |
| Core view-model tests (`packages/scheduling/tests/availabilityCalendar.test.ts`): Adelaide 23- and 25-hour days, windows in the missing and repeated hour, shared resources across Adelaide/Perth, missing hours, closures, holds, purity | 38 pass |
| Helper tests and containment (`schedulingCalendarLib`, `schedulingPhase2b3dCalendarContainment`, the three updated 2B pins) | 16 + 17 pass |
| PostgreSQL 16.14 and 17 (`bash scripts/tests/verify-scheduling-phase2b3d.sh 16` and `17`): calendar API 30, read path 11, plus 036 and 034 regression 88 + 37 | PASS on both |
| Playwright harness, calendar spec at 1440, 768 and 390 px, real login, synthetic accounts | 39 pass |
| Playwright harness, the whole Scheduling suite (regression) | 215 pass, 214 skipped by design, 0 fail |
| `tsc --noEmit` | clean |
| ESLint | 0 errors in Scheduling code; repo-wide total identical to `main` (259 problems, 160 errors, 99 warnings) |
| Full `vitest run` | 20,190 pass; the same 19 failures as `main` (3 files: `clientDayOverviewStaticCheck`, `dashboardPolishStaticCheck`, `tennisSessionReactivateCancelledInstance`), none in Scheduling |

The browser harness found and this branch fixes three defects in the new screen: hour labels below AA contrast, a 34 px link target (the 44 px rule), and a sideways-scrolling grid with no keyboard access.

## Outstanding risks

1. **Production is unverified.** The authenticated Production availability test (first rule and zone pin) is still to be done separately; the calendar has only been exercised on disposable data.
2. **Read cost grows with resources.** An offering with N linked resources makes about 3N+4 reads (rules, closures and zone per owner, plus holds in one query). Fine for the pilot; batch the owner reads before an offering with dozens of resources.
3. **Occupied time is resource holds only.** An occurrence that holds no resource is not drawn; reservations without a resource are invisible to the calendar. Both belong with the reservations phase.
4. **Rule `kind`.** (Superseded in 2B.3e.) `service_period` rules are no longer drawn or bookable as hours: an owner that has one is unavailable, with the reason in words. See `scheduling-availability-hardening-2b3e.md`.
5. **Client media query.** The grid/agenda switch uses `matchMedia`, so the first paint on a phone can briefly render the wide layout.
6. **The calendar is read-only by construction, not by permission alone.** A containment test pins that it has no write route, no write call, no audit call and no form; relaxing that is a deliberate change.
