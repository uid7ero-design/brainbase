# Scheduling Phase 2C.3c, UI slice 2: customer details, review, booking and confirmation

Status: implemented, **dark** (hidden unless the server says so), draft PR, stops at the slice 2 review gate. Follows `scheduling-phase2c3c-staff-booking-ui-design.md` (#544) and `scheduling-phase2c3c-ui-slice1.md`. It adds no migration, no environment variable, no capability and no API: it connects the slice 1 dialog to the booking API that already exists (`POST /api/scheduling/reservations`, `GET /api/scheduling/reservations?idempotencyKey=`).

## 1. What was added

* `lib/scheduling/staffBooking/machine.ts`: the pure state machine from "customer details" to "booked" (no I/O, clock, timers, randomness or React).
* `lib/scheduling/staffBooking/submitClient.ts`: the **only** file in the UI that sends a write: one `POST /api/scheduling/reservations` with the `Idempotency-Key` header, and the read-only lookup `GET …?idempotencyKey=`. It classifies every response.
* `app/scheduling/_components/StaffBookDialog.tsx`: the slice 1 dialog extended. After a start time is chosen, "Continue to customer details" starts the machine; the dialog performs the effects (the POST, the lookups and their timers) and feeds the results back as actions.
* `lib/scheduling/staffBooking/key.ts`: `BookingContent` now also carries the party size and the trimmed customer fields. Still one holder, still no rotate operation. No second idempotency system.
* `CalendarScreen` passes `onBooked={calendar.reload}`: the calendar re-reads when the dialog closes after a booking was made (or may have been).

Reused unchanged: the shared `Dialog`, `Field`, `StateMessage`, `FormActions`; the basis endpoint and its starts; the visibility gate; the reservation repository, lock order and routes.

## 2. The steps

Offering (if several) → Date → Start time → **Customer** → **Review** → **Booked**.

* **Customer**: name (required, 120), email (optional, 254), phone (optional, digits and `+ ( ) - .`, 3 to 32), party size (whole number, 1 to the resource's capacity from the basis response), notes (optional, 1000). The client limits equal the core limits (`HIRE_*`), pinned by a test. Validation is a convenience: the API re-checks everything. Messages are fixed wording and never echo a typed value. A failed submit shows an error summary (`role="alert"`, takes focus, links to each field); fields carry `aria-invalid` and `aria-describedby`. Every field and the form have `autocomplete="off"` and neutral names, so the browser does not insert the staff member's own details. No CRM call, no customer account, no storage: details live in the reducer state and in the one POST body.
* **Review**: offering, resource, local date, start, end, configured length, pinned zone, party size, customer details, price, and the statement that no payment is collected through this workflow. Nothing is sent before **Confirm booking**.
* **Booked**: heading "Booked" takes focus; the **full** reservation id in a read-only monospace field with **Copy reference** (announced; if the clipboard is blocked the field is selected and the message says so); the resource, date, times, length, party and customer summary; "No payment was collected". **Done** (and Escape, and the close button) close the dialog, tell the calendar to re-read, and focus returns to the Book button. There are no payment controls anywhere.

## 3. The idempotency rule

* The key is asked of the holder in **one** place: REVIEW (`holder.keyFor(content)`), once per distinct content (resource, offering, date, time, party, trimmed customer fields). Going back and forth with unchanged content keeps the key; changing anything makes a new one.
* SUBMIT freezes `{key, body}` into `attempt`. Every retry re-sends that frozen attempt verbatim: the same key and the same bytes.
* While the outcome is uncertain (`submitting`, `checking`, `unsure`) every action that could change the booking, the key or the step (`FIELD`, `REVIEW`, `BACK`, `START`, `NEW_ATTEMPT`) returns the same state object. The dialog cannot be closed while sending or checking (Escape and the scrim say "please wait").
* The only transition that discards the key is `NEW_ATTEMPT`, reachable only from `conflict` (IDEMPOTENCY_CONFLICT), on the staff member's explicit "Start a new booking".
* A second activation while a booking is in flight lands in a state that ignores it, and the button is disabled and `aria-busy`.

## 4. Responses

A response is **definitive** only when it is a success or one of the API's own stable codes. Everything else is **uncertain**: a network error, a timeout (20 s), any 5xx, `OUTCOME_UNKNOWN`, an unparseable body, a "success" whose body is not a reservation, an unknown 4xx.

| Response | UI |
| --- | --- |
| 201 / 200 (replay / recovered) | Booked |
| `AVAILABILITY_CHANGED` | back to time selection; the basis is re-read; details kept; the previous start is preselected only if the fresh read still offers it |
| `RESOURCE_CONFLICT` | "That time was just taken. Nothing was booked."; back to time selection; fresh times; details kept |
| `OFF_GRID`, `OUTSIDE_AVAILABILITY`, `IN_THE_PAST`, `RESOURCE_INACTIVE`, `OFFERING_UNAVAILABLE`, `RESOURCE_NOT_ELIGIBLE`, `NONEXISTENT_LOCAL_TIME`, `DURATION_NOT_ALLOWED`, `OFFERING_NOT_BOOKABLE`, `NOT_FOUND` | fixed wording per code; back to time selection with a re-read |
| `VALIDATION` / `PARTY_NOT_ALLOWED` | back to the form with the named fields flagged (field names only) |
| `CONTENTION_TIMEOUT` | "Nothing was booked." and **Try again**, the same key and the same body |
| `IDEMPOTENCY_CONFLICT` | nothing is overwritten or created; the existing booking under the key is looked up and shown; **Start a new booking** is the only way forward |
| `BOOKING_NOT_READY`, 404 without a code | "Booking isn't available right now. Nothing was booked."; a closed gate also hides the Book button until reload |
| 401 / 403 | "Your session has ended or you do not have permission…"; no retry |
| uncertain | **"Checking whether your booking was saved"** |

### Uncertain outcomes

"Checking…" shows a polite status, never a failure. The dialog looks the booking up by the **original** key at 0.5, 1.5, 3 and 6 seconds (read only). A found booking ends in the same Booked state as a normal booking (if it differs from what was submitted, the real booking is shown and the screen says it was saved earlier). After the four lookups the dialog says it could not confirm, and offers only **Try again** (the same key and body: a safe replay) or Close (with the warning to look in the calendar first). It never offers a fresh start from that state.

## 5. What is deliberately not here

* **No reload-recovery record.** The design allowed `sessionStorage` to hold `{key, payloadHash, savedAt}`. Slice 2 stores **nothing** (a static test pins it): a reload during an uncertain outcome forgets the attempt. The database still protects the venue: an overlapping second booking is refused by the exclusive hold, and a repeated request with the same content is a different key only if the staff member started again. A reload-recovery record can be added later if the owner wants it; it needs no server change.
* No cancel (slice 3), no payment, no recurrence, no public booking, no short reference (the opaque id is the reference, as decided).
* No enabling: the capability stays unregistered in Production and the switch unset. That is 2C.3d, an owner step.

## 6. Tests

* `tests/containment/schedulingStaffBookingUiMachine.test.ts`: validation, limits equal to core, every transition, response classification, and a **property test** (3,000 random sequences of 80 actions with a counting key generator) proving that no sequence mints, replaces or discards a key during an uncertain outcome, that every send carries the episode's key and the very same payload object, and that an uncertain state can only be left by a found booking, the bounded wait, or a same-key resend.
* `tests/containment/schedulingStaffBookingUiGate.test.ts`: static rules: one POST in one file, to one URL, with the key header; the key holder touched in exactly two places in the machine; the machine is pure; the dialog creates no key and has no payment control; every customer field has autocomplete off; no storage or logging anywhere; only the dialog imports the submit functions.
* `tests/components/scheduling/StaffBookDialogBooking.test.tsx` (jsdom + axe): the whole flow, the validation summary, one POST on a double click, every refusal, uncertain outcomes with a fake clock, focus and keyboard.
* `scripts/tests/schedulingStaffBookingUi2c3cBooking.integration.test.ts` (PostgreSQL 16 and 17): the machine and client against the real routes: one booking = one reservation + one exclusive hold; five concurrent identical sends; same-key replay; IDEMPOTENCY_CONFLICT; two staff racing for one court; stale offering/court/hours versions; a reply lost after commit; a request that never arrives (four sends, one key, one booking); roles; tenants; the kill switch; cancellation history; no customer detail in audit rows, console or error bodies.
* `tests/browser/scheduling/staffBooking.spec.ts` (Chromium, 390/768/1440 px, light and dark): OFF mode (the full workflow does not exist, the complete POST is a 404, nothing written, no booking-related request) and ON mode (the whole workflow, a lost reply, a real RESOURCE_CONFLICT, AVAILABILITY_CHANGED, axe on every state, no sideways scroll, target sizes, focus, Copy, calendar refresh).
