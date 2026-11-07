# Scheduling Phase 2C.3b: guarded staff booking API

Status: implemented behind two default-OFF gates, **not enabled anywhere**. Draft PR, stops at the 2C.3b review gate. Design: `scheduling-phase2c3-facility-hire-design.md` (sections 3, 5, 6). Repository: `scheduling-phase2c3a-createhire.md` (unchanged by this phase).

## 1. What this phase adds (and does not)

Adds: three route files (four methods), one handler module, the second gate in the access guard, the host executor's `transaction()` forwarding, tests.
Does not add: a screen (2C.3c), a public or customer path, recurring generation, a migration, a `modules` row or `organisation_modules` row, an environment variable value, or any change to `PostgresHireRepository`, its SQL, its lock order or the deadlock regression.

## 2. Host SQL executor (`lib/scheduling/runtime.ts`)

`createSchedulingExecutor(signal?, recorder?)` wrapped the driver in an object with `query` only whenever a recorder was supplied, so `transaction()` was dropped and `createHire` refused every call (`HireNotReadyError`). Now:

* `transaction` exists on the recorded executor **if and only if** the driver has one. It is forwarded, never emulated, and never replaced by a stub. A driver without it yields an executor without it; `createHire` then throws `HireNotReadyError` before any statement is sent.
* The statements and the time of the one round trip are recorded (numbers only). A failing transaction is recorded too, and its error (SQLSTATE and all) reaches the repository untouched, so `55P03`, `57014`, `23P01` and unknown outcomes are classified exactly as before.
* The deadline signal is passed to the batch as it is to every query. The transaction-local `lock_timeout = 2000 ms` and `statement_timeout = 5000 ms` are the first statement of the batch (`set_config(..., true)`), unchanged.
* The runtime exposes `hire: PostgresHireRepository`, built without a query.

## 3. Gates (all default OFF)

Order, each step failing closed before the next:

1. **Kill switch** `SCHEDULING_STAFF_BOOKING` must equal exactly `on` (read per request). Otherwise `404 {"error":"not_found"}` for every caller, **before the session, the capability table or the database are touched**.
2. **Session** (401).
3. **Organisation capability** `scheduling.staff_booking` for the session's organisation: absent, disabled, inactive or unregistered is the same `404`; only a failure to determine it is `503`. It is registered for nobody (no `modules` row exists, none is created here), so every organisation is denied today.
4. Base capability `scheduling` (403), role permission `scheduling.reserve` (403), per-user `scheduling = use` (403), tenant from the session.

## 4. API

All responses `Cache-Control: no-store`. Errors are `{ error, code }` with a fixed sentence per code: no request field, customer detail or repository text is ever echoed.

| Route | Success | Notes |
| --- | --- | --- |
| `POST /api/scheduling/reservations` | `201` created, `200 {replayed:true}` | Header `Idempotency-Key` (16-80 of `[A-Za-z0-9_-]`), JSON body, unknown fields refused at every level (including `organisationId`, `stepMinutes`, a body key). `recovered:true` when a lost reply was resolved by key. |
| `GET /api/scheduling/reservations?idempotencyKey=` | `200` | One booking by key (the lost-response check), never a list; any other parameter is `400`. |
| `GET /api/scheduling/reservations/{id}` | `200` | Facility-hire bookings only; anything else is `404`. |
| `POST /api/scheduling/reservations/{id}/cancel` | `200` | Optional `{reason}` (max 200, no markup or control characters). Already cancelled: `200 {alreadyCancelled:true}`. Started: `422 IN_THE_PAST`. Row, snapshot and history stay; the hold is released by the same `UPDATE` (trigger). |

Failure vocabulary (create): `VALIDATION` 400, `NOT_FOUND` 404, `IDEMPOTENCY_CONFLICT` 409, `RESOURCE_CONFLICT` 409, `AVAILABILITY_CHANGED` 409 (with the fresh `basis`), `OFFERING_UNAVAILABLE` / `RESOURCE_INACTIVE` / `OUTSIDE_AVAILABILITY` / `OFF_GRID` 409, `DURATION_NOT_ALLOWED` / `OFFERING_NOT_BOOKABLE` / `NONEXISTENT_LOCAL_TIME` / `RESOURCE_NOT_ELIGIBLE` / `IN_THE_PAST` / `PARTY_NOT_ALLOWED` 422, `CONTENTION_TIMEOUT` 503 + `Retry-After: 1`, `OUTCOME_UNKNOWN` 504 (`retryable`; repeat with the same key or look it up by key), `BOOKING_NOT_READY` 503 (no transaction or missing 037; nothing written). An UNEXPECTED error from the repository (anything it did not classify) is never a bare 500 (2C.3c-A): the handler looks the booking up by the request's ORIGINAL idempotency key and returns it (`201`, `recovered: true`, audited once with `recovered: true`) when it is this request's, `409 IDEMPOTENCY_CONFLICT` when a different request holds the key, and otherwise `504 OUTCOME_UNKNOWN` (`retryable`, repeat with the SAME key). It never says the booking failed, never makes a key and never calls `createHire` a second time. A failure while building the response of a committed booking is also `504 OUTCOME_UNKNOWN`; a failure of the re-read after a committed cancel is still `200`.

## 5. Permissions and privacy

| Caller | Result |
| --- | --- |
| Switch off | 404, everyone |
| Organisation without the capability | 404 |
| Anonymous | 401 |
| viewer, analyst, unknown role, `scheduling = view` user | 403, body without any scheduling data |
| manager, admin, super_admin (and a manager with no per-user restriction) | allowed |
| Another organisation's manager | 404 for any id, key or offering of this organisation |

Customer details appear only in a success body for `scheduling.reserve`. The success view is an explicit allow-list (no organisation, key, creator, customer id, series or attendance).

## 6. Audit and observability

`scheduling.reservation.created` / `.cancelled` through `recordSchedulingAudit`, after the commit, best effort. Summary: offering, resource, local date and start, duration, party size, `source: staff_form` (cancel adds `has_reason`). **No `identity`, name, email, phone, note, reason text, IP or user agent.** A pure replay writes no entry; a recovered booking writes one. A failing audit store never changes the response. The request log line and `Server-Timing` keep status, duration, statement count and database time (numbers only; the booking transaction counts its statements and times once).

## 7. Enabling (owner-run, NOT performed, separate approval)

1. Register the capability: one `modules` row `scheduling.staff_booking` (not staged here; 2C.3d).
2. Entitle exactly one internal test organisation with an `organisation_modules` row.
3. Set `SCHEDULING_STAFF_BOOKING=on` for that environment only.
Rollback is the reverse and takes effect on the next request (switch) or immediately (row).

## 8. Evidence

See the PR description for the run results (PostgreSQL 16/17, Neon driver, CI). Suites: `tests/containment/schedulingHostExecutor2c3b.test.ts`, `schedulingStaffBookingRoutes.test.ts`, `schedulingPhase2c3bContainment.test.ts`; `scripts/tests/schedulingStaffBooking2c3b.integration.test.ts` (PG16/17 via `verify-scheduling-phase2c.sh`); `schedulingStaffBooking2c3bNeon.integration.test.ts` (opt-in, real driver, disposable branch).

## 9. Known limits

* Neon latency of the whole request was measured once (first call about 470 ms, 10 statements); the booking itself is one round trip.
* The write routes have no request deadline: a write must never be answered "timed out" while it may commit. Waiting is bounded by the transaction-local timeouts (at most 3 attempts).
* The timezone check costs about 11 ms per row (matters for series generation, not here).
