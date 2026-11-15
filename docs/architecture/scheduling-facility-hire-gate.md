# Scheduling: independent facility-hire feature gate

Status: **implemented, dark, draft PR**. No Production configuration, capability, entitlement, migration or environment variable is created or changed by this change. Stops at the independent feature-gate review gate.

## 1. Why

`SCHEDULING_STAFF_BOOKING` and the `scheduling.staff_booking` capability were introduced in Phase 2C.3b as the gate of **staff facility-hire booking**. Coach (squads, class enrolment, roster enrolment) later reused the same pair as its own gate. Production now has the switch `on` and LD Tennis entitled (the module and the entitlement were created together at 2026-11-09 08:59:59Z; their description names Coach squads). Because the pair was shared, that also opened every facility-hire route (reservation create / read-by-key, availability basis, reservation read, cancellation) and the calendar Book button for LD Tennis staff. Facility hire was never approved for activation.

## 2. Decision

Two features, two switches, two capabilities. Neither pair can authorise the other.

| Feature | Environment switch | Organisation capability |
| --- | --- | --- |
| Coach squads, class enrolment, roster enrolment (**unchanged**) | `SCHEDULING_STAFF_BOOKING` | `scheduling.staff_booking` |
| Staff facility-hire booking (**new**) | `SCHEDULING_FACILITY_HIRE` | `scheduling.facility_hire` |

Naming follows the existing convention (`SCHEDULING_<FEATURE>` / `scheduling.<feature>`, phase documents already call the feature "staff facility hire").

Facility-hire access requires, in this order: (1) `SCHEDULING_FACILITY_HIRE` exactly `on` (read per call, before any session, capability or database access; any other value, including `ON`, `true`, `1`, ` on`, is off); (2) an authenticated session; (3) an active entitlement `scheduling.facility_hire` for the **session's** organisation; (4) the existing base `scheduling` entitlement; (5) a role granting `scheduling.reserve`; (6) the existing managed-access rule (`scheduling` = `use`); (7) the tenant context from the session. When (1) or (3) fails the answer is `404 {"error":"not_found"}`, byte-identical to a route that does not exist. A failure to *determine* the entitlement is 503, never a pass.

## 3. Code

* `lib/scheduling/adapters/brainbase/index.ts`: `SCHEDULING_FACILITY_HIRE_ENV`, `SCHEDULING_FACILITY_HIRE_CAPABILITY_KEY`, `facilityHireKillSwitchOn()`. The staff-booking constants are untouched.
* `lib/scheduling/access.ts`: `SchedulingFeature = 'staff_booking' | 'facility_hire'` and one table (`FEATURE_GATES`) mapping each feature to its own switch and capability. Order and failure semantics are unchanged: switch, session, feature capability, base capability, permission, managed access, tenant. `route.ts` only forwards the feature.
* The four facility-hire route files (`reservations`, `reservations/basis`, `reservations/[reservationId]`, `reservations/[reservationId]/cancel`) now declare `feature: 'facility_hire'`.
* `lib/scheduling/facilityHireVisibility.ts` (server-only): `getFacilityHireVisibility()`, same checks and order as the API, for the calendar page only. `staffBookingVisibility.ts` is unchanged and now serves Coach only. The two helpers share no import and neither may name the other's key (pinned).
* `app/scheduling/resources/[resourceId]/calendar/page.tsx` asks `getFacilityHireVisibility()`. The Book button and dialog are rendered only from that boolean, so with the gate off nothing renders and no booking request is made.
* Coach (`coachSquads.ts`, `coachActions.ts`, `/coaching` pages) is **not modified**.
* The disposable browser harness registers and entitles **both** capabilities for its synthetic organisation and sets only the switch asked for (`SCHED_BROWSER_FACILITY_HIRE=on` or `SCHED_BROWSER_COACH=on`).

## 4. Dependency map (main at e906325c)

| File / route | Feature | Env gate | Org capability | User permission | After this change | Regression risk |
| --- | --- | --- | --- | --- | --- | --- |
| `POST/GET /api/scheduling/reservations` | facility hire | `SCHEDULING_STAFF_BOOKING` | `scheduling.staff_booking` | `scheduling.reserve` | **`SCHEDULING_FACILITY_HIRE` / `scheduling.facility_hire`** | Production: 404 for everyone until the new pair is set (intended). |
| `GET /api/scheduling/reservations/basis` | facility hire | same | same | `scheduling.reserve` | new pair | same |
| `GET /api/scheduling/reservations/[reservationId]` | facility hire | same | same | `scheduling.reserve` | new pair | same |
| `POST /api/scheduling/reservations/[reservationId]/cancel` | facility hire | same | same | `scheduling.reserve` | new pair | same |
| `app/scheduling/resources/[resourceId]/calendar/page.tsx` -> `CalendarScreen` -> `StaffBookDialog` | facility hire | same (via `getStaffBookingVisibility`) | same | `scheduling.reserve` | `getFacilityHireVisibility` | Book button disappears in Production (intended). |
| `lib/scheduling/coachSquads.ts` `squadSession()` (squads page, squad actions) | Coach | `SCHEDULING_STAFF_BOOKING` | `scheduling.staff_booking` | `scheduling.manage` + `scheduling.reserve` | **unchanged** | none |
| `lib/scheduling/coachActions.ts` `manageClass` action `enrol` | Coach | `SCHEDULING_STAFF_BOOKING` | `scheduling.staff_booking` | `scheduling.reserve` | **unchanged** | none. `enrol` calls `submitBooking` (Coach class path), not the facility-hire repository or routes. |
| `app/coaching/page.tsx` "Teams and squads" link | Coach | via `getStaffBookingVisibility` | same | same | **unchanged** | none |
| `app/coaching/roster/[id]/page.tsx` enrol control | Coach | via `getStaffBookingVisibility` | same | same | **unchanged** | none |
| `app/class-booking/[org]/[link]` (public class booking) | Coach / public | not gated by either | n/a | n/a | **unchanged** | none (not touched) |
| `lib/scheduling/access.ts` / `route.ts` | shared guard | generalised | generalised | unchanged | feature table | every gated route re-tested (section 6) |

Not changed: the booking repository, SQL, lock order, availability engine, idempotency, `provableNotBooked`, tenant isolation and every API contract (status codes, bodies).

Open pull requests (read-only assessment): #549 (Slice 2 booking UI, head ce3c4cf5) and #554 (reload recovery, stacked on #549, head f84ff199) both authorise through the **old shared** helper (`getStaffBookingVisibility` / `getStaffBookingContext`). See section 8.

## 5. Capability registration (separate, owner-approved release step; NOT part of this PR)

No migration registers the key, exactly like `scheduling.staff_booking` (no migration in this repository registers it either). Production registration is a database write and is therefore documented, not executed:

```sql
-- OWNER-RUN, SEPARATELY APPROVED. Not executed by this change.
-- 1. Register the module (inactive rows are denied by requireCapability; this row is inert until an organisation is entitled AND the switch is on).
INSERT INTO modules (key, name, description, active, updated_at)
VALUES ('scheduling.facility_hire', 'Scheduling facility hire', 'Staff-managed facility-hire bookings.', true, now())
ON CONFLICT (key) DO NOTHING;
-- 2. Entitle ONE organisation (verify the target organisation id first; verify the unique key on organisation_modules before using ON CONFLICT).
INSERT INTO organisation_modules (organisation_id, module_key, enabled, updated_at)
VALUES ('<organisation id>', 'scheduling.facility_hire', true, now());
```

Rollback of that step: `UPDATE organisation_modules SET enabled = false, updated_at = now() WHERE organisation_id = '<id>' AND module_key = 'scheduling.facility_hire';` (and, if the module row must go, set `modules.active = false`). Neither statement touches `scheduling` or `scheduling.staff_booking`.

## 6. Verification

* `tests/containment/schedulingFacilityHireGate.test.ts` (31 tests, written failing first: 15 failed against the shared gate, all pass now): Coach pair alone cannot open any facility-hire route or the Book visibility; the facility-hire pair alone cannot open Coach; all five route handlers answer `404 not_found` with the session, capability table, database and runtime untouched when off; exact-`on` matrix; base entitlement, role, no-session, 503-on-undeterminable, cross-tenant (capability asked for the session organisation only).
* `schedulingStaffBookingUiGate`, `schedulingPhase2b0/2c3a/2c3b` containment: pins now state the two independent allow-lists; the helpers share nothing.
* PostgreSQL 16 and 17 and Neon driver suites (hire routes, basis, UI visibility over real tables) renamed to the new pair, plus a real-database case: Coach switch on and `scheduling.staff_booking` entitled still answers 404 on a facility-hire route.
* Playwright (disposable database): default-OFF, facility-hire ON, and Coach-ON-only runs.

## 7. Limitations

* With this change deployed and no new configuration, Production facility hire (API and Book button) is **off for everyone**, including LD Tennis. That is the intended containment. Coach is unaffected because its pair is untouched.
* The two Production records that already exist (`scheduling.staff_booking` module and the LD Tennis entitlement) are deliberately left as they are. They now mean Coach only.
* If an operator sets `SCHEDULING_FACILITY_HIRE` and entitles an organisation, that organisation reaches the same API as before; nothing in this change relaxes any other check.

## 8. Integration impact on #549 and #554 (assessed, not changed)

Merge order: **this PR first**, then #549, then #554. Merging #549 first would put the booking-write dialog behind the Coach pair, which Production already has on.

Required changes when #549 is rebased onto this PR:
* `app/scheduling/resources/[resourceId]/calendar/page.tsx` and `CalendarScreen` props: use the facility-hire visibility (conflicts with the page edit here).
* #554 `getStaffBookingContext()` (visibility + `recoverySecret`) must move to the facility-hire helper: the recovery secret is derived only when the facility-hire gate holds, so reload recovery cannot exist without it. Rename to `getFacilityHireContext()`; behaviour otherwise identical.
* Test names/pins in #549/#554 that mention the switch, the capability or `getStaffBookingVisibility` (UiGate, UiKey, Phase2b3dCalendar, Phase2b2c containment, component tests' `TEST_SECRET`, browser spec env name) need the same renames. Integration suites in #549/#554 follow the rename done here.

Reload recovery cannot bypass the gate: the dialog is not rendered without the server-derived `canBook`/`recoverySecret`; a stored record is read only by the dialog; its lookup is `GET /api/scheduling/reservations`, which is 404 when the gate is off.
