# Scheduling Phase 2C.3c-B: the staff availability basis

Status: implemented behind the two 2C.3b gates (kill switch `SCHEDULING_STAFF_BOOKING=on` AND organisation capability `scheduling.staff_booking`), **not enabled anywhere**. Draft PR, stops at the 2C.3c implementation gate. Builds on `scheduling-phase2c3b-staff-booking-api.md`; the booking repository, its SQL and its lock order are unchanged.

## 1. What it is

`GET /api/scheduling/reservations/basis?offeringId=&resourceId=&from=&to=`

For ONE linked, active resource of ONE facility-hire offering it returns, in one response, everything a staff booking form needs and must not invent: the **basis** the booking will be checked against, the offering's configured **duration**, its pinned **zone**, and the **start times the shared availability engine offers** for the requested local dates.

It is the approved "Option B": a narrowly scoped staff-only read, not an extension of the viewer-level calendar API (`scheduling.view`), which is not touched (a containment test pins that the calendar and booking-overlay modules never mention a basis).

## 2. Contract

Request: four query parameters, all required, none repeated. Anything else (`step`, `organisationId`, `duration`, ...) is `400 VALIDATION` naming the parameter (never its value). `offeringId` and `resourceId` match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$`. `from` and `to` are inclusive LOCAL dates in the offering's pinned zone, `to >= from`, at most **14 days** (`HIRE_OFFER_MAX_DAYS`).

Response `200`, `Cache-Control: no-store`:

```json
{
  "basis": { "offeringVersion": "4", "resourceVersion": "6", "offeringToken": "2026-11-01T00:00:00.000000Z", "scheduleToken": "2026-10-01T00:00:00.000000Z" },
  "offering": { "id": "off-1", "durationMinutes": 60, "price": { "amountCents": 5000, "currency": "AUD" } },
  "resource": { "id": "court-1", "capacity": 4 },
  "timezone": "Australia/Adelaide",
  "range": { "from": "2026-11-16", "to": "2026-11-18" },
  "generatedAt": "2026-11-07T00:00:00Z",
  "days": [
    { "date": "2026-11-16", "starts": [ { "time": "09:00", "startsAt": "2026-11-15T22:30:00Z" } ] },
    { "date": "2026-11-17", "starts": [] }
  ]
}
```

* `basis` is opaque: the form echoes it in `POST /api/scheduling/reservations` (`basis`). It is the same four values `readHireBasis` returns and `createHire` re-checks under locks.
* `days` has an entry for **every** date in the range (empty `starts` where nothing is offered) so a date picker can disable them. `time` is the local `HH:MM` the booking request takes (`start.date` + `start.time`); `startsAt` is the instant, for display.
* No organisation, no customer data, no names (the form already holds the offering's and resource's names), no `step`.
* Stable refusals (fixed sentences, nothing echoed): `NOT_FOUND` 404 (absent OR another organisation's: identical), `OFFERING_NOT_BOOKABLE` 422, `OFFERING_UNAVAILABLE` 409 (archived), `RESOURCE_NOT_ELIGIBLE` 422 (not linked), `RESOURCE_INACTIVE` 409, `DURATION_NOT_ALLOWED` 422, `RANGE_TOO_LARGE` 422, `AVAILABILITY_UNREADABLE` 422, `BOOKING_NOT_READY` 503, plus the gate responses of 2C.3b (404 switch/capability, 401, 403, 503 when the entitlement cannot be determined).

## 3. Bounds

* Range: 14 local days. Starts: at most **1500** per response (`HIRE_OFFER_MAX_STARTS`); a range that would hold more is `422 RANGE_TOO_LARGE`, never silently truncated (a cut list would read as "nothing later is free"). A response is therefore bounded to roughly 100 KB (a test serves 480 one-minute starts in under 100 KB).
* Time: the route has an 8 s deadline (it is a read, so "timed out" is always safe).

## 4. The starts ARE the bookable starts

`packages/scheduling/src/hireOffer.ts` (`offeredHireStarts`) calls `computeAvailability`, the engine `evaluateSlotBooking` calls, with the same context `createHire` decides with: the offering's and the resource's rules and closures, the resource's live holds, `stepMinutes` = the configured duration, `now` = the repository clock, the resource's capacity, pinned zones required. A start is offered only if `createHire` would resolve its local time to that very instant, so on a daylight-saving fall-back day the repeated hour is offered **once** (the earlier instant, which is what the booking takes) and no offered time repeats; a spring-forward gap offers nothing.

Proved three ways: a core test probes every 15 minutes of three days and requires "offered if and only if `evaluateSlotBooking` accepts"; a PostgreSQL 16/17 test books **every** offered start through the real booking route and shows non-offered times (before the hours, off the grid, at closing, on a closed day) are refused; the same on the real Neon HTTP driver.

## 5. Consistency, and the limit of it

`PostgresHireRepository.readHireOffer` reads in the order `createHire` uses: (1) the basis row, ONE statement (so its versions and tokens agree); (2) the engine inputs (rules, closures, live holds) AFTERWARDS.

**Limit.** These are separate statements, not one snapshot. The existing SQL executor's `transaction()` takes statements only (no isolation level or read-only option), and a batch under READ COMMITTED gives each statement its own snapshot, so a repeatable-read snapshot is not available through it. The Neon driver itself supports `isolationLevel`/`readOnly` for a batch; using them would mean widening the shared executor contract and the adapter, which this phase deliberately does not do.

**Why that is safe.** The offer is advice; the commit decides. Anything that changes after step (1) moves a version or an edit token, and the guarded booking statement then inserts nothing: `AVAILABILITY_CHANGED` with a fresh basis. A change between (1) and (2) can only make the starts NEWER than the basis, so the old basis is refused at commit; an offer older than its basis cannot be produced. Holds are not part of the basis: a start taken by another booking after the read is `RESOURCE_CONFLICT` at commit (the overlap constraint). A forged basis can only be refused. Tests: every kind of change moves the basis and the old one cannot book; a writer racing the read yields only 201 or 409, never an error or an overlap.

## 6. Gates, permissions, privacy

Same two gates as every booking route (switch checked before the session or the database; then the organisation capability; then `scheduling.reserve`; the tenant is the session's). Viewer, analyst, unknown roles and `scheduling = view` users are 403 with no scheduling data; anonymous is 401; another organisation's manager gets the same 404 for a real id as for an absent one. A successful or refused read leaves every table byte-identical and writes no audit entry.

## 7. Not in this phase

The staff dialog (2C.3c implementation), a list of offerings or resources for the form (the existing configuration reads serve it), any write, price calculation beyond the offering's price, multi-resource search, recurrence, public or customer access.
