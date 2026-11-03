# Scheduling Phase 2C.3: staff facility hire (technical design)

Status: **design for approval. Nothing here is implemented, enabled or applied.** No route, repository method, migration, flag row or UI exists for it.
Baseline: `main` `e490f4ba`; migration 037 (`2c.3.1`) is applied to Production and verified; PR #528 holds the completion record.
Companions: `scheduling-phase2c-booking-architecture.md` (decisions), `scheduling-phase2c-availability-at-commit.md` (option C), `scheduling-phase2c3-offering-config-at-commit.md` (offering token decision), `scheduling-phase2c3-preflight-evidence.md` (measurements).

## 1. Scope

In: an authorised manager books, and cancels, a **resource hire** for a customer, for a linked, active resource, on a time the shared availability engine offers, creating the reservation and its exclusive hold **atomically**.
Out (unchanged from the approved decisions): public or customer booking, payments, recurring series and occurrence generation, classes, appointments, reschedule, manager override of availability (not authorised in the first release), drag-to-book, any change to LD Tennis or Eve.

## 2. What already exists (reuse, do not rebuild)

| Need | Existing piece |
| --- | --- |
| Availability decision | `computeAvailability` and `evaluateSlotBooking` (`@scheduling/core`): the calendar and the commit check are the same engine |
| Refusal taxonomy | `bookingRefusal`, `refusalCodeFromSchedulingError` |
| Reservation shape and write | `NewReservationInput`, `PostgresReservationRepository.create/createAssigned/cancel/getById`; reservation + hold in one operation; the lifecycle trigger makes the snapshot columns immutable (SCIMM), never revives a cancelled row, and releases the hold when it is cancelled |
| Double booking, party fit, link, lifecycle | `scheduling_holds_no_overlap` (gist EXCLUDE) with a per-resource advisory lock; 031/032 `SCPTY`/`SCLNK`; 030 `SCRIU`/`SCALU`; `SCARC` |
| Idempotency | unique `(organisation_id, idempotency_key)` on reservations |
| Availability at commit | migration 037 versions + the guarded statement shape (test fixture today) + the offering edit token (preflight decision) |
| Route discipline | `schedulingRoute(permission, handler)`: session, capability, permission, runtime, `no-store`; a containment test fails the build for any other route shape |
| Entitlement | `requireCapability(orgId, key)` over `organisation_modules` (no row = off) |
| Permissions | `scheduling.reserve` (write), `scheduling.view` (read); viewer reads are reduced DTOs (`bookingOverlay`) |
| Audit | `recordSchedulingAudit`; actions `scheduling.reservation.created` and `.cancelled` already in the closed list; `sanitiseAuditSummary` strips free text |
| Tenant isolation | composite keys, every statement organisation-scoped from the session |

New code is limited to: one repository method, two routes, one flag check, one form, tests.

## 3. Flags (default OFF, two independent switches)

1. **Global kill switch**: environment variable `SCHEDULING_STAFF_BOOKING` must equal `on`. Unset, empty or anything else = off, in every environment, including Preview. Read per request (not cached at import) so a Vercel env change takes effect on the next deploy without a code change.
2. **Per-organisation enablement**: a second capability key `scheduling.staff_booking`, checked with `requireCapability` exactly as `scheduling` is. It is registered for nobody; enabling an organisation is an explicit owner-run `organisation_modules` row (the same path as the pilot enablement), recorded in the runbook. No migration, no shared-core change, so a standalone consumer supplies its own entitlement.

Either switch off: both new routes answer `404 {"error":"not_found"}` (route not discoverable), the form is not rendered, and nothing is read from or written to the booking tables. Existing calendar reads are untouched.

## 4. Booking flow and the order that makes it safe

```
 staff form                    POST /api/scheduling/reservations (hire)                       database
 ──────────                    ─────────────────────────────────────────                       ────────
 1 pick resource, date,        (the slot list comes from the existing calendar read; it also
   start, duration              returns an opaque `basis`: versions + offering token it used)
 2 enter details, confirm  ──►  a. flags, session, scheduling.reserve, tenant, validate body
                                b. READ BASIS FIRST (1 statement): offering+resource versions,
                                   offering updated_at, offering/resource/schedule state     ──► reads
                                c. if the client sent `basis` and it differs → AVAILABILITY_CHANGED
                                d. read inputs (rules, closures, zones, links, live holds, resource details) in parallel
                                e. evaluateSlotBooking (pure) → refusal, or ok
                                f. GUARDED WRITE: one batch  [SET LOCAL timeouts, booking]   ──► reservation + hold, or nothing
                                g. 0 rows → AVAILABILITY_CHANGED (or resolve by idempotency key)
                                h. audit (best effort, after commit); respond with the reservation
```

Why this order is sound: every input the decision used was read **after** the versions and token in (b). Anything that changes availability after (b) moves a version (rules, closures, pins, links, resource active) or the offering token (any offering edit), and the guarded statement refuses. The decision can therefore be stale only in ways the statement detects. The client `basis` (c) is a UX guard (the staff member confirms what they saw); the integrity guard is the server-read basis in (b), which the client cannot supply or forge.

### 4.1 The guarded statement (single statement, as proved in `guardedBooking.ts` + the token variant)

`lov` (offering version row, `FOR SHARE`, version equals) → `lo` (offering row, not archived, `updated_at` equals the token, `FOR SHARE`) → `lrv` (resource version row) → `lr` (resource row, `active`, `FOR SHARE`) → `res` (INSERT reservation, `ON CONFLICT (organisation_id, idempotency_key) DO NOTHING`) → `hold` (INSERT hold from `res`) → `SELECT id FROM res`. Offering is always before resource (the order every bump uses): no lock cycle (60-way stress, no `40P01`).
Open for approval, see section 11: lock the **schedule** row `FOR SHARE` with its own edit token if the reservation snapshots any schedule setting.

### 4.2 Timeouts (transaction-local; no role or global setting changes)

`sql.transaction([ SET LOCAL statement_timeout = '5s', SET LOCAL lock_timeout = '2s', <guarded booking> ])` per request. Proven on a disposable branch with the real driver: `57014` writes nothing and does not leak to the next request; `55P03` behind a configuration writer writes nothing. A normal booking is about 45 ms round trip, so these are generous; a writer holds the row for milliseconds. `55P03` maps to `CONTENTION_TIMEOUT` (retryable, never "unavailable"). A role-level `ALTER ROLE` is **not** used: the role is shared with LD Tennis and Eve.

### 4.3 Outcomes and what the client may assume

| Outcome | Certain about the booking? |
| --- | --- |
| 1 row | Committed |
| 0 rows, key not found | Not written (stale basis, archived, inactive, or key conflict handled) → `AVAILABILITY_CHANGED` |
| `23P01` | Not written → `RESOURCE_CONFLICT` |
| `SCPTY`, `SCLNK`, `SCRIU`, `SCARC` | Not written → mapped refusals |
| `57014`, `55P03` inside the batch | Not written (transaction rolled back) → `CONTENTION_TIMEOUT` |
| Network error, client abort, platform timeout, lost response | **Unknown.** Never assumed uncommitted. The server (and the form) resolve by reading the reservation by the idempotency key. |

Measured on the real driver: an abort mid-statement cancelled the statement (0 rows, twice); a response lost after commit left the booking committed. Only the key distinguishes them.

## 5. API

Both routes are `schedulingRoute('scheduling.reserve', …)`; both are **404 when a flag is off**.

### `POST /api/scheduling/reservations`
Headers: `Idempotency-Key` (required, 16-80 chars `[A-Za-z0-9_-]`, generated once per form instance, kept across retries; tenant-scoped by the unique index so two organisations may reuse a value).
Body: `{ offeringId, resourceId, start: { date: "YYYY-MM-DD", time: "HH:mm" }, durationMinutes, partySize, customer: { name, email?, phone? }, notes?, basis? }`. Local wall-clock fields in the resource's pinned zone are the input; instants are derived with `resolveLocalTime` (a DST gap is refused, an ambiguous time takes the earlier instant, as in the core). Unknown fields are rejected. No `organisationId` is accepted from the body.
Responses: `201` created, `200 {replayed:true}` for a repeat of the same key and payload, with the reservation.
Errors (stable `code`): `AVAILABILITY_CHANGED` 409 (with a fresh `basis` so the form re-renders without another read), `RESOURCE_CONFLICT` 409, `IDEMPOTENCY_CONFLICT` 409 (same key, different window/resource), `CONTENTION_TIMEOUT` 503 + `Retry-After`, `OUTCOME_UNKNOWN` 504 (the form then queries by key), `PARTY_NOT_ALLOWED` 422, `OFFERING_UNAVAILABLE` 409, `NOT_FOUND` 404 (also any foreign id), `VALIDATION` 400 (field list), 401/403 from the guard.

### `POST /api/scheduling/reservations/{id}/cancel`
Body: `{ reason?: string (bounded, no markup) }`. Calls `reservations.cancel({ reservationId, cancelledBy: 'staff', reason, scope: 'this_occurrence' })`: the row stays, with `status = cancelled`, `cancelled_at`, `cancelled_by = staff` and `cancel_reason`; its snapshot (customer, window, price) is immutable and it is never revived or deleted, which IS the cancellation history. The lifecycle trigger releases the hold in the same statement, so the window is free for a new booking immediately. Outcomes: `200` cancelled; `200` with the current state if already cancelled (idempotent); `422 IN_THE_PAST` for a booking that has already started or ended (the repository rejects `in_the_past`); `404` for absent or foreign. A new booking for the same time is a new reservation with its own key.

### Read
`GET /api/scheduling/reservations/{id}` (for the confirmation and the unknown-outcome check; by id or by `?idempotencyKey=`). Staff with `scheduling.reserve` get the full reservation; a viewer gets `404` (the reduced overlay DTO is unchanged and is the only viewer surface). No list endpoint is added in 2C.3.

## 6. Authorisation, tenant isolation, redaction, audit

- Order: flags → session (401) → capability `scheduling` and `scheduling.staff_booking` → `scheduling.reserve` (403) → tenant from the session → validate → database. The organisation never comes from the request.
- Every statement is scoped `organisation_id = $session`; composite foreign keys make a foreign offering, resource or version row impossible; a foreign id answers `NOT_FOUND`, indistinguishable from absent.
- Viewer identity redaction is unchanged and server-side: the overlay DTO never carries name, contact, customer id, note, payment status or attendance; the new read returns them only to `scheduling.reserve`. Error bodies never echo customer fields.
- Audit: `scheduling.reservation.created` / `.cancelled` through `recordSchedulingAudit`, after commit, best effort (a failed audit never fails or undoes a booking), summary limited to ids, resource, local window, party size, source `staff_form`. No names, emails, phones or notes in audit rows.

## 7. Staff form (UI)

Entry: from the calendar of a hire offering ("New booking", visible only when both flags are on and the viewer has `scheduling.reserve`).
Steps in one dialog (focus trap, Escape, focus return): 1 resource (linked, active only) → 2 date and an offered start (slots from the existing calendar read, never typed free-form) and a duration from the allowed set → 3 details (name required; email, phone, party size, notes) → 4 **Confirm**: summary in words, zone shown ("Adelaide"), and the submit button. The submit is disabled while in flight; the idempotency key is created when the dialog opens and reused on retry.
States, each with text and an icon, never colour alone: loading, no availability, submitting, `AVAILABILITY_CHANGED` ("That time just changed. Here are the times now available." with the fresh slots), conflict, contention ("Busy, try again"), unknown outcome ("Checking whether it was saved…" then resolved by key), success (reservation reference), cancelled.
Layouts 390 / 768 / 1440, light and dark; keyboard-only path; errors announced in a live region; no hover-only controls. Cancel is on the confirmation and on the existing booking block, with a confirm step naming the booking.

## 8. Standalone compatibility

The only new shared-core surface is a repository method and pure helpers (basis comparison, idempotency-key validation, hire request mapping). Flags, capability, routes, audit and the form are host code. The statement uses only shared tables and migration 037; no BrainBase table is referenced from `packages/scheduling*`.

## 9. Test plan (all must pass before any enablement)

1. Repository, PostgreSQL 16 and 17: guarded create with every refusal; stale version of each of rules, closure, pin, link, resource active, offering edit; booking-first stands; writer-first refuses; N parallel overlapping, one winner; same key parallel, one reservation; cancel releases the hold and a new booking succeeds; cancel history preserved; cross-tenant; viewer cannot read the reservation.
2. Real Neon HTTP driver on a disposable branch: the gate suite plus the same cases through the route-level repository, abort and lost-response resolution by key, `57014` and `55P03`.
3. Route integration (real session, middleware, guards): flag matrix (global off, org off, both on), permission matrix (manager, analyst, viewer, unauthenticated), no-organisation-in-body, error codes, `no-store`.
4. Containment: no route other than the two named writes a reservation; no app code reads the version table directly (only the repository); no public or customer path; LD Tennis and Eve untouched.
5. DST and grid: Adelaide spring-forward and fall-back starts, midnight-crossing windows, evaluator equals calendar.
6. Playwright at 390/768/1440 in both themes; axe; keyboard-only booking and cancel; the `AVAILABILITY_CHANGED` re-render; unknown-outcome resolution.
7. `tsc`, ESLint, GitGuardian on the PR.

## 10. Delivery slices (each a separate draft PR, each stops at a review)

| Slice | Content | Writes anywhere? |
| --- | --- | --- |
| 2C.3a | `createHire` repository method + tests (PG16/17, Neon driver); no route | tests only (disposable) |
| 2C.3b | `POST/GET /reservations`, cancel route, flags (404 when off), audit, route tests | flag off: none |
| 2C.3c | staff form + Playwright | flag off: none |
| 2C.3d | internal-test-organisation enablement runbook (owner-run capability row), acceptance checklist per role | only in the internal test organisation, by the owner, after a separate approval |
Production booking in any organisation other than the internal test organisation needs its own gate.

## 11. Decisions needed from the owner before 2C.3a

1. **Approve option A for offering configuration** (edit token inside the statement), see `scheduling-phase2c3-offering-config-at-commit.md`.
2. **Approve the timeouts**: `statement_timeout` 5 s, `lock_timeout` 2 s, as `SET LOCAL` per request.
3. **Schedule row**: lock it `FOR SHARE` with its own edit token in the statement (recommended: cheap, same pattern) or accept the archive trigger alone. Needed if the reservation snapshots the cancellation policy or terminology.
4. **Flag mechanism**: environment kill switch + `scheduling.staff_booking` capability (recommended), or a settings column (needs a shared-schema migration).
5. **`scheduling_is_timezone()`**: accept about 12 ms per booking insert for single hire (measured), and defer the optimisation to before any series generation (see the evidence document: a 500-occurrence run would spend about 6 s in the check).
6. **Customer fields**: confirm the minimum (name required; email and phone optional) for a staff-entered hire, and that no CRM link is created in 2C.3.
7. **Allowed durations** in the form (free minutes within the offering's limits, or multiples of the offering's duration).

## 12. Risks

- A false `AVAILABILITY_CHANGED` when a manager edits an offering's name during a booking: bounded to milliseconds, harmless, retried with the returned basis.
- Unknown outcome on a lost response: handled by key; the form must never present "failed" for that case.
- Version-row hand-deletion fails closed for an owner until 037 is re-applied; no application path deletes version rows.
- The kill switch is an environment variable: changing it needs a deploy, which is the intended friction for the first release.
- Nothing here has run against Production; first real traffic would be the internal test organisation only.
