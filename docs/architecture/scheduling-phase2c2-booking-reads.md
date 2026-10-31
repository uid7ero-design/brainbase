# Scheduling Phase 2C.2: the read side of bookings

Status: **implemented, read-only, behind the existing Scheduling guard. No screen uses it yet. No migration. No booking, occurrence, hold or series is created by anything in this stage.**
Companions: `scheduling-phase2c-booking-architecture.md` (decisions), `scheduling-phase2c-availability-at-commit.md`, `scheduling-phase2c-migration-plan.md`.

## 1. What was added

| Layer | File | What |
| --- | --- | --- |
| Core (pure) | `packages/scheduling/src/bookingOverlay.ts` | Bounds, keyset cursor, `ViewerReservation` and its whitelist projection, the identity guard, `buildBookingOverlay` |
| Repository | `packages/scheduling-postgres/src/bookingReadRepository.ts` | `listOccurrencesInRange`, `listReservationsInRange` (viewer-reduced), `listReservationDetailsInRange` (full, staff who may reserve), `listLiveHoldsInRange`, `readBookingOverlay` |
| Host | `lib/scheduling/runtime.ts`, `lib/scheduling/config/bookingOverlay.ts`, `app/api/scheduling/calendar-overlay/route.ts` | The repository in the runtime; one GET route, `schedulingRoute('scheduling.view', ...)` with the calendar's 8 s deadline |
| Proofs | `packages/scheduling-postgres/tests/bookingReads.integration.test.ts`, `scripts/tests/schedulingBookingOverlay2c2.integration.test.ts`, `packages/scheduling/tests/bookingOverlay.test.ts`, `tests/containment/schedulingPhase2c2Containment.test.ts` | |

The route is named `calendar-overlay`, not `booking-...`: an existing containment test (2B.2b) deliberately forbids any route path that names booking, payment, checkout or public access, and a read-only calendar layer does not need to be the exception.

## 2. The two calendar layers stay apart

The availability calculation (open hours, closures, bookable starts) is unchanged and does not know bookings exist. The overlay shows what is **committed** and does not call the availability computation. A screen draws both, one over the other. A containment test pins that no availability module references the overlay, and that the overlay module and the repository import nothing from availability.

## 3. The API

```
GET /api/scheduling/calendar-overlay?from=YYYY-MM-DD[&to=YYYY-MM-DD][&offeringId=ID][&resourceIds=ID,ID][&includeCancelled=1][&limit=N]
```

`from`/`to` are inclusive **local dates in the organisation's timezone**, at most 14 days apart (the availability calendar's bound). They become the half-open instant range `[00:00 of from, 00:00 of the day after to)` through `resolveLocalTime`, so an Adelaide spring-forward day is 23 hours and a fall-back day 25 (tested), and a Perth organisation's day starts at Perth midnight.

Response:

```jsonc
{
  "zone": "Australia/Adelaide",
  "range": { "from": "2026-12-07", "to": "2026-12-13", "fromInstant": "...Z", "toInstant": "...Z" },
  "overlay": {
    "lanes": [ { "resourceId": "...", "items": [ /* occurrence | booking | hold, ordered by start */ ] } ],
    "unassignedSpace": [ /* sessions with no court or room */ ],
    "counts": { "occurrences": 0, "slotBookings": 0, "holds": 0, "cancelled": 0, "unassignedSpace": 0 },
    "truncated": { "occurrences": false, "slotBookings": false, "holds": false }
  }
}
```

Errors: 400 `INVALID_INPUT` (unknown, repeated or malformed parameter, range over 14 days, more than 100 resources, limit outside 1..500), 401/403/503 from the guard, 504 `SCHEDULING_TIMEOUT` from the deadline, a generic 500 if the identity guard ever trips. `Cache-Control: no-store` and `Server-Timing` as for every Scheduling route.

### How each thing is shown

| Thing | Representation |
| --- | --- |
| Recurring occurrence with a court | `occurrence` item in that resource's lane, `placement: "resource"`, `liveHeadcount`, `capacity`, `remaining`, and `holdId` of the live hold that occupies the court |
| Occurrence **without** a resource | `occurrence` item in `unassignedSpace`, `placement: "unassigned_space"`, `resourceId: null`, `holdId: null`. It is never in a lane and never occupies a resource; its enrolments are part of `liveHeadcount` |
| Individual reservation (hire, appointment) | `booking` item in its resource lane, `state: "booked"`, with `holdId` |
| Cancelled session / booking | the same item with `status: "cancelled"` / `state: "cancelled"` and `holdId: null`; returned **only** with `includeCancelled=1` |
| Resource hold | backs its owner (the owner's `holdId`). A live hold whose owner is not in the read (outside the page, filtered out) becomes a `hold` item with `owner: "occurrence" | "booking" | "unknown"`. A released hold is never returned |
| Enrolment | not a block: it counts towards its session's `liveHeadcount`. (`listReservationsInRange` returns it as `kind: "enrolment"`.) |

The overlay is **identical for a viewer and a manager**: it carries no customer data for any role. Full reservation detail is a different read (section 5).

## 4. Bounds and pagination

- Range at most 31 days at the repository (the API narrows to 14); at most 100 resources; page size 1..500 (default 200). A value outside is refused (`invalid_input`), never silently clamped.
- Range reads use **keyset pagination** on `(start instant, id)`, a total order. The cursor carries the last row's start at microsecond precision, so rows added or cancelled between pages cannot make a boundary skip or repeat a row (tested, including two sessions with the same start and a page boundary between them). A tampered cursor is `invalid_input`, refused before any SQL.
- The overlay is not paginated (a calendar needs the whole window); each of its three parts is capped at `limit` and `truncated` says so, so a view is never presented as complete when it is not.
- Three statements per overlay however many resources there are (tested at 1, 5, 20 and 50 resources, and over HTTP at 30 extra resources).
- **Half-open**: a thing is in range when it overlaps `[from, to)`; one that ends exactly at `from`, or starts exactly at `to`, is not.

## 5. Privacy: server-side redaction before any response

1. **A viewer read selects no customer column at all.** `listReservationsInRange` reads ids, offering, span, resource, instants, timezone and `status = 'cancelled'`. The name, email, phone, customer id, notes, payment, attendance, series, creator, idempotency key, cancellation reason, price and party size are never read from the table. A test asserts the statement text mentions none of them.
2. **Reduction by whitelist.** `toViewerReservation` builds a new object from named fields, so a column added to `Reservation` later cannot leak through it. Everything not cancelled is "booked" (pending, confirmed, completed, no-show are staff detail).
3. **Full detail is a separate method** (`listReservationDetailsInRange`) that needs `scheduling.reserve` and refuses a caller without it **before any SQL runs** (tested with a statement spy). No route exposes it in 2C.2.
4. **The identity guard.** Before any body is sent, the handler walks it for identity-bearing property names (`customerName`, `email`, `phone`, `notes`, `customerId`, `seriesId`, `paymentStatus`, `attendance`, `partySize`, ...) and answers a generic 500, with nothing else, if one is found. It checks **structure only**, not free text: an offering or resource a member of staff named "Book via info@club.example" is configuration, not a customer, and must not take a calendar down. Tests check bodies built from known customer data for both names and email-like text.
5. Tests send recognisable customers (names, emails, notes, a cancellation reason) through bookings, then assert none of those strings, and none of a list of identity words, appears in any response for a viewer or a manager.

## 6. Read-only, proved three ways

1. **The server holds the connection read-only.** Every repository method runs on a pool with `default_transaction_read_only=on`; a write would fail with `25006`. The test first proves the guard is real by showing a `CREATE TEMP TABLE` and an `UPDATE` fail with `25006` on that pool.
2. **Content hashes.** A hash of every Scheduling table, `organisations` and `audit_logs` is identical before and after the full set of reads. Over HTTP the hash also covers the user and access tables, for every role in the matrix including denied and malformed requests, and no `scheduling.*` audit row is written.
3. **Statement text.** Every statement the repository sends starts with `SELECT` and contains no write keyword, no row-locking clause, no advisory lock and no function that writes. A containment test pins the same on the source.

## 7. Evidence

| Suite | PG 16 | PG 17 |
| --- | --- | --- |
| `bookingReads.integration.test.ts` (24 tests) | 24 passed | 24 passed |
| `schedulingBookingOverlay2c2.integration.test.ts` (30 tests, real session, middleware, guards) | 30 passed | 30 passed |
| `availabilityAtCommit.integration.test.ts` (18 tests, from 2C.0) | 18 passed | 18 passed |


### Index finding (migration 041, no longer conditional)

At 8,120 occurrences, 4,000 reservations and 4,000 holds, with the window near "now" and history behind it, `EXPLAIN` shows:

| Statement | Without 041 | With `(organisation_id, ends_at)` indexes |
| --- | --- | --- |
| occurrences | Seq Scan | Bitmap Index Scan on the new index |
| reservations | Seq Scan | Bitmap Index Scan on the new index |
| holds | Bitmap Index Scan on `scheduling_holds_no_overlap` | unchanged (the exclusion constraint's index serves it) |

The existing `(organisation_id, starts_at)` indexes cannot serve an overlap query: `starts_at < to` selects **all of history**. An index on `ends_at` selects only things that end after the window opens, which is the present and the future. Migration 041 is therefore recommended as two indexes, `scheduling_occurrences (organisation_id, ends_at)` and `scheduling_reservations (organisation_id, ends_at)`. It is **not** applied or written here; the test creates them in a disposable database only. At today's Production size (a handful of rows) the sequential scan is harmless; it matters as history grows.

### Side finding: a per-row timezone check

`scheduling_is_timezone()` (the CHECK on every `timezone` column) reads `pg_timezone_names` on **every** inserted row: about 12 ms each on PostgreSQL 17 in a container. It makes any bulk load of thousands of rows take minutes, and adds that much to every single booking insert. It is not a correctness problem, and Neon's cost may differ, but it is a cheap thing to fix (cache the validation, or compare against a small constant list) and belongs with the 2C.3 write-path measurements. It is not changed here.

## 8. What 2C.2 deliberately does not do

No screen, no navigation entry, no write route, no migration, no audit write, no change to LD Tennis or Eve, no Production access. `bookingReads` is built per request over the same executor as everything else (so it gets the same deadline and statement recorder) and nothing calls it except the one handler.
