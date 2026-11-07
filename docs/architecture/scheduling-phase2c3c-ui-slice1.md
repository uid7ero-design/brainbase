# Scheduling Phase 2C.3c, UI slice 1: the read-only staff booking dialog

Status: implemented, **dark** (hidden unless the server says so), draft PR, stops at the slice 1 review gate. Follows `scheduling-phase2c3c-staff-booking-ui-design.md` (#544). Nothing here creates, changes or cancels a booking.

## 1. What exists

* `lib/scheduling/staffBookingVisibility.ts` (server-only): `getStaffBookingVisibility()` answers "may this page show the staff booking controls?". Order, mirroring `authorizeSchedulingRequest`: (1) `SCHEDULING_STAFF_BOOKING` is exactly `on` (checked first: with it off no session, capability table or database is touched); (2) an authenticated session, the organisation being the session's; (3) the organisation holds `scheduling.staff_booking` AND `scheduling`; (4) the role grants `scheduling.reserve`; (5) a managed-access row, if any, puts Scheduling at `use` (a platform owner has no row). Any refusal, unreadable state or thrown error is `false`. It takes no argument. It is a UX gate: every request the dialog makes is authorised again by `schedulingRoute()`.
* `app/scheduling/resources/[resourceId]/calendar/page.tsx` calls it on the server and passes `canBook` to `CalendarScreen` (default `false`). Only this page calls it (pinned).
* `CalendarScreen` renders a **Book** button only when `canBook && kind === 'resource' && resource is active`. The offering calendar never shows it. A `404` without a code from a booking read (a gate closed under the user) closes the dialog and removes the button until reload.
* `StaffBookDialog` (on the shared `Dialog`) is mounted only while open, so a closed dialog makes no request. It offers: the facility-hire offering (preselected and named when there is one), a date from the 14-day window of the basis response (`days[]`; empty days are `aria-disabled` and say "No times"), and an engine-offered start time. It shows the configured length and the pinned zone. There is no customer form, no free-time or duration input, no submit.
* `lib/scheduling/staffBooking/{key,basisClient,view}.ts`: pure, client-safe helpers. `key.ts` prepares the idempotency key **in memory only** (`bk_` + 32 hex; one key per distinct content; no rotate operation; never stored, rendered or sent). `basisClient.ts` is GET-only and maps refusals to fixed wording.

## 2. Decisions

* **Which offering?** The basis endpoint needs an offering and the resource calendar knows only the resource. No endpoint lists a resource's offerings, and slice 1 adds none. The dialog composes the existing configuration reads (`GET /schedules`, `GET /schedules/{id}/offerings`, `GET /offerings/{id}/resources`), keeps facility-hire, unarchived offerings with a duration that link this **active** resource, and (bounded at 40 offerings) offers them. The basis endpoint stays the authority. A dedicated read can replace this in a later slice if the fan-out proves slow.
* **Selection is never navigation.** A native radio group selects as arrow keys move. The offering radios therefore only select and a "Continue" button moves on; the start-time group stays on screen when a time is chosen and the summary appears beneath it, and focus is not moved. (The first draft advanced on selection, so one arrow press removed the group; the browser run caught it.)
* **No sticky footer on phones.** It covered the last day buttons (axe target-size). The footer scrolls with the sheet; Escape and the header close button remain.
* **Customer details stay out of storage.** Slice 1 has none; the key is not stored either (slice 2 adds the reload-recovery record `{key, payloadHash, savedAt}` only).

## 3. Tests

* Containment (`schedulingStaffBookingUiGate`, `…UiKey`): every switch value, gate order, tenant isolation, role and managed-access matrix; static rules that the slice has no write method, storage, server import, customer field or free-time input, and that only one page imports the helper.
* Components (jsdom + axe): the dialog flow, empty/error/loading states, keyboard path, focus, and the calendar with `canBook` false/undefined/true (no Book button, no dialog and no booking-related request when off; focus returns to the button on Close and Escape).
* PostgreSQL 16/17 (`schedulingStaffBookingUi2c3c.integration.test.ts`, in `verify-scheduling-phase2c.sh`): the gate over the real tables for ten people, agreeing with the API's 200/non-200 for each; the dialog's own client code against the real routes; tenant isolation; every table byte-identical after the reads.
* Browser (`tests/browser/scheduling/staffBooking.spec.ts`, Playwright, 390/768/1440 px, light and dark): run twice by the disposable harness. **Switch off** (default; the capability is held): no button for anyone, no dialog, no booking-related request, every booking endpoint `404`. **Switch on** (`SCHED_BROWSER_STAFF_BOOKING=on`): the button for exactly the people the API serves, the keyboard path, axe on three steps, no sideways scroll, focus return, nothing written (an audit-inclusive snapshot is unchanged).
* The disposable browser harness now applies migration 037 (Production has it) and, on its throwaway database only, registers the capability and entitles synthetic organisation A. The switch is unset unless the caller opts in.

## 4. Not in slice 1

Customer details, review, submit, the uncertain-outcome loop, the confirmation reference, cancel, the offering-calendar entry point, and enabling anything. Staff booking stays off everywhere; enabling it (2C.3d) is a separate owner-run step.
