# Scheduling Phase 2C: bookings (architecture decisions and delivery plan)

Status: **approved for the non-writing foundation only** (2C.0 decisions, 2C.1 pure booking core, 2C.2 read side), 2026-10-31.
Baseline: `main` after PR #510 (Phase 2B.3 availability and calendar). Nothing in this document is enabled in Production.
No booking-writing route exists or is added by 2C.0 to 2C.2.

Companion documents:
- `scheduling-phase2c-availability-at-commit.md`: how availability is enforced when a booking is written (the Neon HTTP driver analysis, options A/B/C, evidence).
- `scheduling-phase2c-migration-plan.md`: the proposed migrations, split into independently reviewable pieces. Design only, none written or applied.
- `scheduling-phase2b-plan.md`: the 2B plan whose approved defaults this phase inherits.

## 1. Roadmap reconciliation

The 2B plan named "2C" the read-only LD Tennis shadow. That name is released:

| Phase | Meaning |
| --- | --- |
| 2A | Database foundation (applied to Production through 036) |
| 2B | Configuration, availability and the read-only calendar (complete) |
| **2C** | **Bookings: recurring sessions, reservations, operational booking management (this document)** |
| 2D | Public booking (separate review; not part of 2C) |
| 2E | Payments (separate review; not part of 2C) |
| 2F | Standalone app |
| **2G** | Read-only LD Tennis shadow (the former "2C"; scope unchanged) |

## 2. Approved decisions

1. Phase 2C is Bookings. The LD Tennis shadow is renumbered 2G.
2. Booking order: **facility hire, then coaching/classes (recurring series and enrolment), then appointments.** The other presets stay disabled.
3. The eight-week occurrence horizon, the daily top-up and the cap of 500 generated occurrences per run are **provisional defaults**, reconfirmed before any top-up runs (`DEFAULT_HORIZON_WEEKS`, `DEFAULT_MAX_OCCURRENCES_PER_RUN`).
4. Staff booking functionality is **disabled by default** (a kill switch plus per-organisation enablement, 2C.3).
5. **No public or customer booking endpoints.** The `public` and `customer` actors exist in the repositories and stay unreachable.
6. **Viewer identity protection is mandatory.** A viewer never receives a customer name, contact detail, customer id, note, payment status or attendance, in a response body, an error or an audit row. Redaction happens on the server before a response is built.
7. **Existing bookings survive availability-rule changes.** A rule removal or a new closure never cancels a booking. The calendar will flag "booked outside current availability" for staff (a later stage).
8. **Rescheduling preserves history.** A move creates a new reservation linked to the old one, and cancels the old one with reason `rescheduled`. Nothing is rewritten.
9. **Moving a class never silently re-enrols participants.** Moving = cancel the occurrence and create another; the enrolees are listed to staff, who re-enrol explicitly.
10. **No drag-to-book** initially. Booking is through the staff form.
11. **Unsupported `service_period` rules remain fail-closed.** An owner with one is unavailable as a whole, in the calendar and at commit, until the rule is removed. No meaning is invented for it in 2C.
12. **Manager overrides of availability are NOT authorised for the first release.** A booking is accepted only on a time the shared engine offers. (This supersedes the earlier "audited override" proposal; see the availability-at-commit document.)

## 3. Architecture

Everything builds on the existing tables, triggers and repositories. **No replacement booking infrastructure is created.**

```
          pure core (@scheduling/core)                 database (authority)                 hosts
 planOccurrences ───────────────┐
 evaluateSlotBooking ──┐        │          scheduling_occurrences   (slot unique key)
 evaluateHeadcount     ├─ advisory         scheduling_reservations  (lifecycle, snapshot, capacity guard)
 planSeriesEnrolments ─┘  checks           scheduling_resource_holds (gist EXCLUDE: no double booking)
 booking refusal taxonomy                   scheduling_series / _series_pauses
                          │
          repositories (@scheduling/postgres): ONE statement per operation (Neon HTTP: no interactive transaction)
                          │
          guarded APIs (schedulingRoute: auth → entitlement → runtime → handler)      [2C.3 onwards, kill switch default off]
```

Principles:
- The **database is the only authority** on double booking (exclusion constraint), participant capacity (per-occurrence advisory lock) and lifecycle (state-machine triggers). Application checks never replace them.
- **Availability is advisory computation**, kept distinct from committed bookings. The same engine (`computeAvailability`) answers the calendar and the commit-time check, so an offered time is an accepted time.
- Every multi-step write is **one statement or one database function**, because separate HTTP requests are not one transaction.
- Local wall-clock fields are the source of truth for the future; instants are derived with `resolveLocalTime` in the pinned zone.

### 3.1 The three booking models

**Facility hire** (`resource_hire`, slot span, resource required). Staff pick a resource, start and duration; the evaluator confirms the offered slot; one statement writes the reservation and its exclusive hold. Overlap is refused by the exclusion constraint (`23P01`, mapped to `resource_conflict`); back-to-back is legal (half-open). Cancel releases the hold in the same statement. No capacity, no recurrence.

**Classes and coaching** (`classes_coaching`, occurrence span). `planOccurrences` expands the offering's weekly recurrence into dated occurrences, inserted idempotently through the slot unique key. A class with a court takes a hold in the same statement; a class without one takes none ("unassigned space"). Enrolment is a reservation on the occurrence; capacity is counted under the per-occurrence advisory lock (`SCCAP`). A series is a customer's standing enrolment: one `scheduling_series` row and one reservation per generated occurrence outside its pauses (`planSeriesEnrolments`). Cancelling a class uses `scheduling_cancel_occurrence`.

**Appointments** (`appointments` v2, slot span, resource required). Slots come from the engine; the practitioner or room is a resource; `createAssigned` picks a free linked resource when none is named. Rescheduling is an atomic replace (migration 039, on the linkage of 038).

### 3.2 Booking integrity matrix

| Guarantee | Mechanism | Test |
| --- | --- | --- |
| No double booking | gist `EXCLUDE` on holds plus `scheduling_hold_serialise` (advisory lock per resource, so the loser gets a clean `23P01`, not a deadlock) | N parallel creates for one range: exactly one wins (`exclusive.integration`, `contention.integration`, `availabilityAtCommit` part A) |
| Participant capacity | reservation guard counts live headcount under a per-occurrence advisory lock; occurrence guard stops capacity dropping below live headcount | capacity C with C+k parallel enrolments (`concurrency.integration`) |
| Resource allocation | 031: resource linked, active, right kind; 030: deactivate/unlink/kind change serialise with bookings | `resourceConcurrency.integration` |
| Staff and customer permissions | `scheduling.reserve` for staff writes; viewer reads reduced shapes only; customer/public unreachable | permission matrix at 2C.3 |
| Availability at commit | engine check in the host, then a versioned single-statement write (see the availability-at-commit document) | `availabilityAtCommit.integration` |
| Cancellation and released holds | lifecycle trigger releases holds in the same statement; a released hold is never reactivated | existing 010 suites |
| Series edits and exceptions | skip = cancel that reservation; `planSeriesEnrolments` never re-enrols a skipped date; database half proposed in migration 040 | `bookingCore.test` (core); 037c suite when written |
| Timezone and DST | local fields are the truth; gap = skipped and reported, ambiguous = earlier instant; occurrence timezone stored per row | `bookingCore.test` Adelaide spring-forward and fall-back |
| Concurrent requests | idempotency key per tenant; advisory locks; `lock_timeout` 5 s; `55P03` is `contention_timeout`, never "full" | existing contention suites |
| Tenant isolation | composite keys; every statement organisation-scoped from the session; a foreign id is `not_found` | `bookingReads.integration` for the new reads |
| Audit events | closed action list, written best-effort after commit, identity stored separately | extended in 2C.3 with reschedule/series actions |

## 4. Calendar integration (displayed, never merged)

Two separate layers from two separate reads. The availability computation (open hours, closures, bookable starts) stays exactly as shipped. Committed bookings come from the tenant-scoped range reads added in 2C.2. The UI overlays them with a legend and a per-layer toggle; **the two are never merged into one calculation.**

| Thing | Where it is drawn |
| --- | --- |
| Recurring occurrence with a court | block in that resource's lane, "name n/capacity" |
| Recurring occurrence with no court | the **Unassigned space** row under the lanes; it never occupies a resource and is never drawn in a lane |
| Individual reservation (hire, appointment) | block in the resource lane; viewers see "Booked" only |
| Cancelled session or reservation | hatched, labelled "Cancelled", off by default ("Show cancelled"); a released hold is never drawn as occupied time |
| Resource hold | solid occupied block with its owner kind (session or booking), no customer data |
| Booking without a resource hold | only enrolments in an occurrence with no court; they count towards the session's headcount and have no block of their own |

Every state has words and a mark, never colour alone. The 2C.2 DTOs carry exactly this information (`BookingOverlay`); the screen is 2C.4.

## 5. Outstanding decisions

| Decision | Resolution |
| --- | --- |
| Unsupported `service_period` | Fail closed everywhere; no work in 2C; revisit with restaurant tables |
| Closure re-anchoring of bookable starts | Keep as shipped. The commit-time evaluator uses the same engine, so an offered start is an accepted start. Residual: a grid anchored by the *range* (24-hour windows) is reported by `anchorAtRangeEdge` and is a 2C.3 decision (see the availability-at-commit document, "Known limitation") |
| Resource-free bookings | Appointments and hire always require a resource. The only resource-free case is a class with no court: "Unassigned space" row, capacity still enforced per occurrence |
| Server-side statement timeout | A role-level `ALTER ROLE ... SET statement_timeout` (about 20 s, above the 5 s `lock_timeout` and the 8 s calendar deadline), proven on a disposable branch first, only after confirming which roles LD Tennis and Eve use. An owner-run change, not a repository migration. Not part of 2C.1/2C.2 |
| Real manager/viewer Production acceptance | Done in the dedicated internal test organisation with owner-created manager and viewer logins, before any booking write is enabled. Read-only for the calendar; a checklist per role including viewer redaction |
| Calendar Home-after-End | Not a product defect (Home works from the top; ArrowUp works from the end). A time-boxed manual check in 2C.4; if it reproduces, set `scroll-behavior: auto` on the grid scroller |

## 6. Delivery stages

| Stage | Content | Writes? | Migration? |
| --- | --- | --- | --- |
| 2C.0 | This decision record, the availability-at-commit analysis with failing-first concurrency tests, the migration plan | no | no |
| **2C.1** | Pure booking core: `planOccurrences`, `evaluateSlotBooking`, `evaluateHeadcount`, `planSeriesEnrolments`, refusal taxonomy | no | no |
| **2C.2** | Read side: tenant-scoped range reads, viewer-reduced DTOs, overlay inputs, bounds and pagination, read-only API | no | no |
| 2C.3 | Facility hire end to end behind the kill switch: guarded create/cancel APIs, versioned commit, staff form | yes (flag off) | 037 availability versions |
| 2C.4 | Operational calendar layers (read-only UI) | no | no |
| 2C.5 | Reschedule linkage, atomic reschedule and series-skip guard staged and rehearsed | no deploy dependency | 038, 039, 040 |
| 2C.6 | Classes: generation adapter (dry run, then write), top-up cron (off), enrolment, series | yes (flag off) | 040 |
| 2C.7 | Appointments: slot picker, practitioner assignment, reschedule | yes (flag off) | 038, 039 |
| 2C.8 | Hardening and acceptance in the internal test organisation | n/a | n/a |

Test matrix for every stage that writes: PostgreSQL 16 and 17 proof script, the real Neon HTTP driver on a disposable branch, N-way concurrency, cross-tenant, the viewer/manager/analyst/unauthenticated permission matrix, `tsc`, ESLint, the containment suites, Playwright at 390/768/1440 in both themes, and axe/keyboard checks.

## 7. What stays untouched

The internal Scheduling pilot, LD Tennis, Eve, Production users and permissions, and every Production table. 2C.1 and 2C.2 create no reservation, occurrence, hold or series, in any database. No payments and no public booking.
