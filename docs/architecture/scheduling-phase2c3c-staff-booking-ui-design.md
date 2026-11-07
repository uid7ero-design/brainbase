# Scheduling Phase 2C.3c: staff booking dialog, implementation design

Status: **design only**. No component, route or style is added by this document. The dialog is implemented only after the two API PRs (2C.3c-A unexpected-outcome safety, 2C.3c-B availability basis) pass review. Everything the dialog calls is disabled by default (`SCHEDULING_STAFF_BOOKING` unset; no organisation holds `scheduling.staff_booking`).

APIs used (all staff-only, all behind both gates + `scheduling.reserve` unless noted):

| Purpose | Call |
| --- | --- |
| Linked resources of an offering (active flag) | `GET /api/scheduling/offerings/{id}/resources` (existing, `scheduling.view`) |
| Basis + offered starts for one (offering, resource) and a date window | `GET /api/scheduling/reservations/basis?offeringId&resourceId&from&to` (2C.3c-B) |
| Create | `POST /api/scheduling/reservations` with `Idempotency-Key` |
| Reconcile an uncertain create | `GET /api/scheduling/reservations?idempotencyKey=` |
| Read one booking | `GET /api/scheduling/reservations/{id}` |
| Cancel | `POST /api/scheduling/reservations/{id}/cancel` |

## 1. Where it lives and when it exists at all

* **Entry points**: a "Book" button on the resource calendar (`/scheduling/resources/{id}/calendar`, resource preselected) and on the offering calendar (`/scheduling/offerings/{id}/calendar`, resource chosen in step 1). Cancel is reached by opening a booking block in the calendar (§8).
* **Existence rule (fail closed)**: the button is rendered only when the **server component** that renders the page has decided that (a) the kill switch is on, (b) the organisation holds `scheduling.staff_booking`, and (c) the user holds `scheduling.reserve` (the same checks the API makes, via the existing page-access helper). That decision is passed down as a boolean prop; the default is `false`. With the flags off nothing renders and **no booking API call is ever made** (no prefetch, no probing). If an API call later answers `404 not_found` (a flag was turned off mid-session) the dialog closes with a plain message and the button disappears until reload.
* The dialog never links to, or is reachable from, any public, customer or Eve surface.

## 2. The workflow (the eleven requirements)

One dialog (`Dialog` from `components/ui/app`, width ~560), five steps plus a result. A step is a state of one reducer; there is no routing.

```
choose-resource -> choose-date -> choose-time -> customer -> review -> submitting -> done
                                      ^             ^           |         |  \-> checking (uncertain)
                                      |             |           |         |  \-> refused (known)
                                      +-------------+-----------+---------+       (back to the right step)
```

1. **Choose a linked, active resource.** Radio group (`fieldset` + `legend`) from `GET offerings/{id}/resources`, inactive ones listed disabled with the reason "Inactive" (never silently hidden; never selectable). One active resource: preselected and the step is skipped with the choice stated in the summary. None: an explanatory empty state, no booking possible.
2. **Select an available date.** Window of 14 local days from today (or the shown calendar day), fetched with `basis?from&to` for the chosen resource. Days from the response's `days[]`: a day with `starts: []` is shown as "No times" (text, not colour only) and is `aria-disabled`. "Earlier/Later" buttons move the 14-day window (a new `basis` request each; the previous basis is discarded). The zone is always shown ("Times are Adelaide time") using `timezone` from the response.
3. **Select an engine-generated start.** Only `days[].starts[]` are rendered, as a radio group of buttons labelled with the local `time`. The duration is read-only text from `offering.durationMinutes` ("60 minutes, ends 10:00"). There is **no free-time input, no duration field, no step control**. The chosen `{date, time}` and the response's `basis` are kept together.
4. **Customer details.** Name (required), email, phone, party size (1..`resource.capacity`, validated client-side for convenience only), notes. At least one of email or phone is a UX nudge, not a rule the UI invents (the API decides). `autocomplete="off"` on the customer fields: the browser must not offer the **staff member's own** details for someone else.
5. **Review.** A read-only summary: resource, date, start and end in the offering zone, duration, party size, customer details, notes, **price** (`offering.price`, "Price is recorded on the booking; payment is not taken here"). Buttons "Back" and "Confirm booking" (primary, single click, disabled while submitting).
6. **Submit with a stable key** (§3).
7. **Confirmed reference.** Result state shows "Booked", the day/time, and the reservation **reference**: the full `reservation.id` in a monospace read-only field with a "Copy" button. (A short human reference does not exist yet; see §10 open decision.) Focus moves to the result heading; "Done" closes and refreshes the calendar.
8. **AVAILABILITY_CHANGED** (`409`): nothing was booked. Keep the customer details and the chosen start in memory, **refetch `basis` for the same window**, and go back to the time step with a visible, polite-announced banner "The available times changed. Check the time and confirm again." If the chosen start is still offered it is preselected; otherwise it is cleared. The 409 body's `basis` is *not* used on its own (it carries no starts).
9. **RESOURCE_CONFLICT** (`409`): "That time was just taken." Refetch and return to the time step as in 8. **CONTENTION_TIMEOUT** (`503`, `Retry-After`): "The system was busy. Nothing was booked." with a "Try again" button that resubmits with the **same key** (nothing was written, so this is safe and cannot duplicate).
10. **OUTCOME_UNKNOWN** and every uncertain result: the `checking` state (§4). No second booking can be created from it.
11. **Cancel** with an explicit confirmation (§8).

## 3. The idempotency key

* Format `bk_` + 32 hex characters from `crypto.randomUUID()` with hyphens removed (35 characters; the API accepts 16-80 of `[A-Za-z0-9_-]`).
* **One key per distinct booking content.** The key is created when the user reaches *review*, tied to a hash of the exact payload (resource, date, time, party, customer, notes, basis not included). The same content always resubmits with the same key. If the user goes back and changes anything, the key is discarded and a new one is made at the next *review*. The key is **never** regenerated by a retry, a timeout, a reload of the dialog during the same attempt, or a double click.
* `sessionStorage` (tab-scoped, cleared on success) holds only `{ key, payloadHash, savedAt }`. **Never names, emails, phones or notes** in storage, URLs, logs or analytics. On reopening the dialog for the same resource/date with a stored pending key, the dialog first runs the reconcile lookup (§4) instead of starting fresh.
* Double-submit guard: the confirm button is disabled and `aria-busy` from click until a final state; a second activation is ignored.

## 4. Uncertain outcomes: never a second booking

Uncertain = HTTP `504 OUTCOME_UNKNOWN`, a network error/abort, a timeout, or any `5xx` (after 2C.3c-A the server returns 504 for these, but the client treats any 5xx and any thrown fetch the same way).

`checking` state: text "Checking whether the booking was saved... Do not book again." with a spinner and `role="status"`.

1. `GET /api/scheduling/reservations?idempotencyKey={same key}` at 0.5 s, 1.5 s, 3 s, 6 s (the server settles a lost write quickly; bounded, then stops).
2. **200** with a reservation: success. The returned reservation is compared with what was submitted (resource, date, time); if it differs the dialog shows the real booking and says it was already made under that key.
3. **404** on every attempt: the result is still not provable (an in-flight write may land late). The dialog offers **"Try again"**, which re-POSTs with the **same key** (a safe replay: it books once or returns the existing booking), and "Close". It never offers "Start over" with a fresh key from this state.
4. The only ways to a new key: the user changes the booking content, or the server answered with a **known definitive refusal** (a 4xx with a stable code, §5).

## 5. Error matrix

| Response | Meaning | UI |
| --- | --- | --- |
| `VALIDATION` 400 + `problems[]` | a field | Inline error on the named field(s) + error summary (links focus the field); stay on `customer`/`review`. Field NAMES map to labels; values are never echoed. |
| `AVAILABILITY_CHANGED` 409 | stale basis | §2.8 |
| `RESOURCE_CONFLICT` 409 | taken | §2.9 |
| `OFF_GRID` / `OUTSIDE_AVAILABILITY` 409 | not offered (should not occur) | refetch and return to time step; message "That time is no longer offered." |
| `RESOURCE_INACTIVE` / `OFFERING_UNAVAILABLE` 409, `RESOURCE_NOT_ELIGIBLE` 422 | configuration changed | message names the cause; return to resource step; refetch resources |
| `IN_THE_PAST` 422 | time passed while open | refetch; return to time step |
| `PARTY_NOT_ALLOWED` 422 | party too big | inline on party size |
| `NONEXISTENT_LOCAL_TIME` 422, `DURATION_NOT_ALLOWED`, `OFFERING_NOT_BOOKABLE` 422 | not reachable via offered starts | generic "This can't be booked. Pick another time." + refetch |
| `IDEMPOTENCY_CONFLICT` 409 | the key already holds a different booking | run the §4 lookup, show what exists, then require the user to confirm a new attempt (new key) |
| `CONTENTION_TIMEOUT` 503 | busy, nothing written | §2.9, same key |
| `BOOKING_NOT_READY` 503 | system not ready, nothing written | "Booking isn't available right now." Close; no retry loop |
| `OUTCOME_UNKNOWN` 504 / network / 5xx | uncertain | §4 |
| 401 | session ended | sign-in prompt; the payload is kept in memory only until the dialog closes |
| 403 | no permission | explanation, no retry |
| 404 `not_found` (no `code`) | a gate is off | close, hide the button |

Messages use fixed wording per code (never server text), consistent with `lib/scheduling/dashboard/api.ts` `problemFrom`.

## 6. Accessibility

* Built on the existing `Dialog` (`role="dialog"`, `aria-modal`, labelled title, focus return, scrim, close button). On every step change focus moves to the step heading (`tabIndex={-1}`); on error it moves to the error summary.
* A real `<ol>` step list with `aria-current="step"`; completed steps are buttons that go back (disabled while submitting).
* Resource, time and party controls are native radio inputs inside `fieldset`/`legend`, styled as buttons: arrow keys move within a group, Space/Enter selects, Tab leaves the group. The date control is a list of day buttons (not a custom grid role), each with an accessible name such as "Mon 16 Nov, 8 times" or "Tue 17 Nov, no times" and `aria-disabled` (still focusable, so it can be announced) for empty days.
* All inputs have visible labels, `aria-describedby` for hints and errors, `aria-invalid`, correct `type`/`inputmode` (`email`, `tel`); errors are text, never colour alone. Status and result messages use `role="status"` / `aria-live="polite"`; failures use `role="alert"`.
* Escape closes; if the form is dirty or a submit is uncertain it first asks (a `ConfirmDialog`) and never closes silently during `submitting`/`checking`.
* Touch targets at least 44x44 px; text contrast from the shared tokens (AA in both themes); `prefers-reduced-motion` removes the spinner animation and transitions.

## 7. Responsive layout and themes

* >= 640 px: centred dialog, two-column review. < 640 px (the existing `useNarrow`): full-height sheet, single column, sticky footer with the primary action and `padding-bottom: env(safe-area-inset-bottom)`; the day list wraps (no horizontal drag), the time buttons wrap in a grid of 3.
* Light/dark through the existing CSS variables used by `scheduling.module.css` (`--bg-surface`, `--bg-base`, `--text-primary`, `--text-secondary`, `--border`, `--radius-lg`...). No hard-coded colours; states (selected, disabled, error) use border/weight/icon in addition to colour. Verified at 390 px and 1280 px in both themes before review.

## 8. Cancel with explicit confirmation

* **Reaching it**: the booking overlay already returns each booking's `id` (no customer data, any role). Clicking a booking block (staff with `scheduling.reserve` only, flags on) calls `GET /reservations/{id}`: `200` shows the staff view (customer, party, notes, price, status); `404` (a class or other booking, or a flag off) shows the existing read-only block with no actions.
* **Dialog** (existing `ConfirmDialog`, `danger`): "Cancel this booking?" states resource, date/time, customer name; what will happen ("The time is released and can be booked again. The booking stays in the history as cancelled. No payment is taken or refunded here."); optional reason (max 200 characters, no `<` `>`; the counter is announced); buttons **"Keep booking"** (default focus) and **"Cancel booking"**.
* **Results**: `200` -> "Cancelled", calendar refreshed; `200 alreadyCancelled` -> same message ("It was already cancelled"); `422 IN_THE_PAST` -> "This booking has already started and can't be cancelled here"; uncertain (504/network) -> re-read `GET /reservations/{id}` and show the real status; never say "failed" until the read says it is not cancelled.

## 9. Privacy and logging

* Customer fields exist only in component state and the POST body. Not in URLs, `localStorage`, `sessionStorage`, console, error reports or analytics. The viewer-level calendar never gets them (unchanged).
* The UI shows what the API returns to `scheduling.reserve` and nothing for viewers/analysts (those users never see the button).

## 10. Open decisions and prerequisites for the implementation PR

1. **Reference**: only the opaque reservation `id` exists. Showing it in full with a copy button is the default; a short human reference needs a stored column (a migration, out of scope here) and an owner decision.
2. **Server-side flag state for the page**: a small helper that answers "kill switch on AND capability held" for a session, reusing `staffBookingKillSwitchOn` and `requireCapability`, so the page never has to call the API to find out. No new endpoint.
3. **Component test setup**: confirm which React component test runner the repo uses for `app/scheduling/_components` and add an accessibility check (axe) to the existing Scheduling browser harness (Docker, disposable database) at 390 px and 1280 px, light and dark.
4. **Window size**: 14 days per request is the API maximum; whether the dialog should pre-load the next window is a UX choice (default: no, load on navigation).

## 11. Test plan for the implementation PR (not part of this one)

* Reducer unit tests: every transition in §2, key reuse/rotation in §3, the §4 loop with a fake clock (no duplicate POST under any sequence of failures), the §5 matrix.
* Component tests: keyboard-only path through all steps; focus placement; error summary; disabled/empty states; stale basis recovery keeps customer details.
* Harness (disposable Postgres + the real routes): book, replay, AVAILABILITY_CHANGED after a hours edit, RESOURCE_CONFLICT from two sessions, a dropped response (reconcile), cancel, viewer sees no button; both themes and both widths.
* Default-OFF: with the flag unset, nothing renders and a network spy proves no booking call is made.
