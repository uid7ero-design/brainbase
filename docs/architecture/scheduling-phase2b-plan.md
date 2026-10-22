# Scheduling Phase 2B: first usable BrainBase workflow (plan only)

Status: **plan for review. Nothing in this document is built.** It follows the merge-readiness and Preview rehearsal
review of Phase 2A (`scheduling-phase2a-rehearsal.md`, `scheduling-phase2a-evidence/`). LD Tennis is not connected to
the new engine in any step below.

## 1. Where this sits (renumbering)

The Phase 2 outline (`scheduling-phase2-schema-outline.md` section 9) used these names. They are now:

| Outline | Now | State |
| --- | --- | --- |
| 2A Schema | **2A Database foundation** | Built, CI green, rehearsed on a Preview branch. Not applied to Production |
| 2B Repositories | folded into 2A | The SQL repositories and the concurrency/DST/exclusion proofs shipped with 2A |
| 2D Module enablement | **2B First usable workflow** (this plan) | Not started |
| 2C Read-only LD Tennis shadow | **Later phase 2C** | Separate review. Not part of 2B |
| (new) | **Later: 2D public booking, 2E payments, 2F standalone app** | Separate, independently reviewable phases |

2B is the first phase in which anything reaches a user, so it is the first with a real rollout, and it is split into
packages that each merge, and can be enabled, on their own.

## 2. Scope

In scope (internal staff workflow, a dedicated internal test organisation only):

1. Organisation scheduling capability
2. Schedule creation and preset selection (several schedules per organisation)
3. Resource configuration (including appointment providers, rooms and virtual capacity)
4. Availability rules and exceptions
5. Occurrence generation and unattended top-up
6. Calendar display
7. Internal reservation creation and cancellation
8. CRM customer linking
9. Role-based permissions
10. Audit logging

Out of scope, each a later reviewable phase: public booking, any payment or deposit, the standalone customer-facing
application, notifications and reminders, LD Tennis shadowing or cut-over, waitlists, table combining, pooled room
inventory, recurring-series enrolment UI (the series tables exist but are not exposed), reporting.

## 3. Constraints carried from 2A

- **No Production SQL by an agent.** Every migration is a manual Neon SQL Editor handoff, Preview first, with a backup
  branch and separate approval (`feedback_production_migration_handoff`).
- The core stays host-free; BrainBase code lives in `lib/scheduling/**` and `app/**`. The shared SQL is not edited
  for BrainBase reasons: host needs go in `scripts/scheduling/1xx` files.
- Tenant is only ever the organisation from the authenticated session. Nothing trusts an organisation id from a
  request body.
- A `contention_timeout` is retryable; deadlocks surface raw. Bookings that may be retried carry an idempotency key.
- Appointments need a resource; customers may name a provider or be auto-assigned.
- Light and dark themes both work; the UI is checked at 390px (the repository's visual conventions apply).

## 4. Work packages

Each package is one reviewable PR, ordered by dependency. Sizes: S under a day, M one to three days, L about a week.

| # | Package | Size | Needs SQL on Production? |
| --- | --- | --- | --- |
| 2B.0 | Decisions and host SQL (section 5) | M | Yes (manual, two small files) |
| 2B.1 | Capability and access layer | M | No (uses 2B.0 data) |
| 2B.2 | Configuration: schedules, presets, resources | L | No |
| 2B.3 | Availability rules and exceptions | M | No |
| 2B.4 | Occurrence generation and unattended top-up | L | No |
| 2B.5 | Calendar (read-only) | L | No |
| 2B.6 | Internal reservations and cancellation, CRM linking | L | No |
| 2B.7 | Hardening: audit completeness, observability, kill switch, load re-check | M | No |

### 2B.0 Decisions and host SQL

Two small host files in `scripts/scheduling/`, each idempotent, rollback documented, rehearsed on a Preview branch
and a disposable copy exactly as 2A was:

- `120_brainbase_capability.sql`: insert the `scheduling` row into `modules` (`active = true`) and **no**
  `organisation_modules` row. Seeding nothing for any organisation keeps every organisation without the module.
  Enabling the test organisation is a separate, later one-row statement (section 8). Creating that organisation is a
  third reviewed, manual statement (section 5, decision 1); it is not part of the numbered files.
- `130_brainbase_crm_link.sql`: a host function that finds or creates a `crm_contacts` row for an organisation by
  normalised email under a per-(organisation, email) advisory lock, so two simultaneous bookings by a new customer
  cannot create two contacts (`crm_contacts` has no unique email index and the Events sync can duplicate; the
  function removes that race for scheduling without changing the CRM schema). Names are never used to match.

No change to shared SQL. If a gap in the shared schema is found, it ships as its own numbered file with its own review.

### 2B.1 Capability and access layer

- `lib/scheduling/access.ts`: `authorizeSchedulingRequest(req, permission)` = session, then `requireCapability(org,
  'scheduling')` (`lib/capabilities/requireCapability.ts`), then `permissionsForRole` (already in the Phase 1 adapter:
  viewer = view; manager, admin, super_admin = manage, reserve, attendance; analyst denied). It resolves the
  `TenantContext` the repositories require. Mirrors the existing `authorizeCommercialRequest` shape.
- `lib/scheduling/runtime.ts`: builds `createPostgresScheduling` over the app's existing `lib/db` executor. A test
  proves the Neon HTTP driver works through it (the 2A driver matrix is the model).
- Resolves the role's data scope with the permission: `viewer` receives the reduced, privacy-preserving shape (section 5);
  the reduction happens in the server read layer, not in the UI.
- Fails closed: no entitlement row, a disabled row or an inactive module all give the same denial.
- Tests: capability on/off, role matrix, cross-organisation denial, super_admin override handling as other modules do it.

### 2B.2 Configuration

- API routes under `app/api/scheduling/**` (schedules, resources, offerings, linking) and a settings area in the
  ops shell, behind the capability (no navigation item for organisations without it).
- Preset selection per schedule, with the preset's wording as defaults and terminology overrides; the preset version
  is stamped; `upgradeScheduleConfig` is exposed as an explicit action.
- Resource screens by kind (practitioner, room, court, table, equipment, space, **virtual**). Appointment services
  must have at least one linked resource before they can be published; the UI explains why.
- Organisation timezone setting surface (reuses `organisations.timezone`; fallback Australia/Adelaide), plus the
  per-schedule override. The first reader of `organisations.timezone` updates `organisationTimezoneSchema.test.ts`
  deliberately.
- Initial presets exposed: `classes_coaching`, `appointments`, `resource_hire` (approved decision 2). The other three
  stay in the core and database but are not offered in the UI yet.

### 2B.3 Availability

- Weekly rules and dated exceptions for resources and offerings (the tables exist). Validation in the core
  (`validateAvailabilityRule`), DST legality through `resolveLocalTime`, rules cannot overlap themselves.
- A pure function `computeFreeSlots(rules, exceptions, holds, window)` in the core, tested on its own (property tests
  over DST weeks), used by the calendar and by assisted appointment booking.

### 2B.4 Occurrence generation and unattended top-up

- Core: a pure `planOccurrences(offering, horizon, existing, pauses)` returning the occurrences to create. Local wall
  time to instants only through `resolveLocalTime` (gap = skip with a recorded reason, ambiguous = earlier);
  never generates in a paused window; never regenerates a cancelled occurrence.
- Adapter: batch insert using the `scheduling_occurrences` slot unique key with `ON CONFLICT DO NOTHING`, so a repeat
  run, or two overlapping runs, create nothing twice. An occurrence that needs a court takes its hold in the same
  statement (already modelled). Any statement inserting several holds orders them by `resource_id` (rule from 2A).
- Route `app/api/cron/scheduling-top-up` protected by `CRON_SECRET` with `secureCompare` (same pattern as the existing
  cron routes), registered in `vercel.json` only in the PR that is approved to turn it on. Runs per enabled
  organisation, bounded work per run (organisation and offering caps), a rolling horizon (approved decision 4: 8 weeks ahead, run daily, at most 500 occurrences per organisation per run), and
  returns a summary. A `contention_timeout` ends that offering's turn and is retried on the next tick; it never fails
  the whole run.
- Safety: a master kill switch (environment flag, default off), a dry-run mode that returns the plan without writing,
  and a per-run limit on rows created.
- Tests: idempotent re-run, concurrent runs, DST weeks (spring forward and fall back, Adelaide and Perth), pauses,
  cancelled occurrences stay cancelled, court conflicts reported not hidden.

### 2B.5 Calendar

- Read-only week and day views of occurrences and slot/stay reservations, filtered by schedule and resource, using
  the schedule's timezone for display and UTC instants underneath. Keyboard and screen-reader friendly, 390px layout,
  both themes.
- Read APIs return the reduced shape for `viewer` (section 5) and paginate by date window; no unbounded queries; every query is tenant scoped in SQL.
- Resource rows show holds, so a court taken by a class and by a hire is visible in one place.

### 2B.6 Internal reservations and cancellation, CRM linking

- Staff create a reservation from the calendar: choose offering and time, find or create the customer, then book
  with an idempotency key (`createAssigned` for exclusive presets; staff may name the provider or take the assignment;
  customers are never asked to choose an internal resource).
- Customer linking: look up by normalised email in the organisation (never by name), otherwise create through the
  2B.0 function with classification `LEAD` (approved decision 3). `customer_id` holds the `crm_contacts` id as text; the
  booking keeps its immutable name/email snapshot.
- Cancellation (single and "this and future" for a series), attendance, and refusal messages that map the domain
  errors honestly: full, resource taken, closed, busy-try-again (`contention_timeout` with one bounded retry, as in
  the 2A retry policy).
- No payment fields are shown or collected; `price` is recorded only if the offering has one.

### 2B.7 Hardening

- Audit completeness check: every mutation has an `audit_logs` row (section 6); a test enumerates the routes.
- Operational view for staff: last top-up run, counts, errors.
- Re-run the 2A contention suite against the repositories as wired in the app (through `lib/db`), on Docker and on a
  Preview branch, and publish the numbers again. Repeat the Windows-host note if it recurs.
- Docs: runbook for enabling, disabling and rolling back an organisation.

## 5. Approved defaults (2026-10-22) and what is still open

The owner approved these defaults. They are inputs to 2B.0; changing one reopens the affected package.

| # | Decision | Approved default | Effect on the plan |
| --- | --- | --- | --- |
| 1 | First organisation | A **dedicated internal test organisation**: not BrainBase HQ, not any customer, not LD Tennis | Creating it is a data change on Production and is approved separately (2B.0). No real customer data ever enters it |
| 2 | Presets offered | The first three: `classes_coaching`, `appointments`, `resource_hire` | The other three stay in the core and database, hidden in the UI |
| 3 | Customer table and status | `crm_contacts`; new customers are classified `LEAD` | LD Tennis keeps resolving against `contacts` and is not touched |
| 4 | Top-up | **Daily, 8 weeks ahead, capped at 500 occurrences** per organisation per run | 2B.4 |
| 5 | Names | Split on the last space; one word becomes first name with last name `-`; never used for matching | 2B.6 |
| 6 | Viewer permissions | **Privacy preserving**, rules below | 2B.1, 2B.5 |

### Viewer permissions (decision 6)

| Role | Sees | Never sees |
| --- | --- | --- |
| `viewer` | Schedules, offerings, resources, occurrences, times, headcount and remaining capacity, reservation status, and whether a slot or court is taken | Customer name, email, phone, notes, the CRM link, price paid, cancellation reason text. A booking shows as "Booked" or a neutral label |
| `analyst` | Nothing (denied, as in the Phase 1 adapter) | Everything |
| `manager`, `admin`, `super_admin` | Everything above plus customer name, email, phone and notes | Not applicable |

These rules are enforced **on the server**: the read API returns a reduced shape for `viewer`, so withheld fields never
reach the browser (they are not merely hidden in the UI). A test asserts that a viewer's responses contain none of the
withheld fields, including in error bodies. Viewers cannot reach the customer search or the reservation detail route.
Reading customer details as a manager is not audited per view in 2B (no read audit exists elsewhere in BrainBase); this
is recorded as a known limit.

### Still open (do not block planning, do block 2B.0)

- **Creating the test organisation.** The route by which organisations are created, and whether a billing or onboarding
  record is required, is checked in the 2B.0 design. The default is a single reviewed one-row statement run manually,
  named so it cannot be mistaken for a customer, with a stated deletion plan.
- **Staff accounts in it.** Which internal users belong to the test organisation, with which roles.

## 6. Audit logging

Reuses the existing `audit_logs` table (ADR-0003 standard; no new schema), written after the mutation commits,
best-effort, as `lib/commercial/auditLog.ts` does. Actions use `<resource_type>.<verb>`:
`scheduling_schedule.created|updated|archived`, `scheduling_resource.created|updated|deactivated`,
`scheduling_offering.created|updated|archived`, `scheduling_availability.changed`, `scheduling_occurrence.created_batch|cancelled`,
`scheduling_reservation.created|cancelled|attendance_set`, `scheduling_contact.linked|created`. Before/after states
carry ids and the changed fields, not free text beyond what the row already holds. The unattended job logs one
`scheduling_topup.run` row per organisation per run with counts, so an unattended write is attributable (user_id null,
action says system).

## 7. Testing strategy

- Core: pure unit and property tests (DST, availability, planning) with no database.
- Adapter and wiring: the existing real-Postgres suites plus new ones for batch generation and the host function, on
  Docker 16 and 17 and a Preview branch, one file per run.
- Routes: authorization matrix per route (no session, no capability, wrong role, other organisation).
- UI: component tests for the calendar and forms; visual check at 390px, light and dark.
- Rollout rehearsal for 2B.0 exactly as 2A: Preview, disposable copy, rollback, fingerprint comparison.
- CI stays tsc, vitest and eslint; the real-database suites remain manual proofs.

## 8. Rollout and approvals

1. Merge 2B.1 to 2B.7 as they are approved. Each is inert until the capability is enabled for an organisation.
2. Production SQL (separately approved, manual, backup branch first): `010` and `110` from 2A, then `120`, then `130`.
3. Create the **dedicated internal test organisation** (reviewed one-row statement, separately approved), then enable the
   capability for it (one `organisation_modules` row). No customer organisation, no BrainBase HQ, no LD Tennis.
4. Run the top-up in dry-run for a week, then switch the kill switch on for that organisation.
5. Review before any second organisation, any public surface or any LD Tennis work.

Rollback at each step: disable the organisation row (instant), turn the kill switch off, then the documented SQL
rollbacks. No existing table is altered by any step.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| A hot resource's lock queue exceeds the 5 s bound | Bounded retry, idempotency keys, capacity guidance in the runbook; measured again in 2B.7 |
| Unattended job writes too much or twice | Slot unique key, dry-run, per-run cap, kill switch, one audit row per run |
| Duplicate CRM contacts | Host function under an advisory lock; matching by normalised email only |
| DST errors in generated times | Single resolver, gap and overlap tests across Adelaide and Perth |
| Scope creep into public booking or payments | Explicit exclusions; separate phases and reviews |
| A viewer sees customer personal data | Server-side reduced response shape, response-shape tests, no customer routes for viewers |
| The test organisation is mistaken for, or mixed with, a real one | Dedicated name, reviewed one-row creation, no customer data, deletion plan, capability never enabled elsewhere in 2B |
| Merging code that redeploys Production | Every package is inert without the capability; merges to `main` redeploy Production, so merges are scheduled and approved |
| Local proof harness instability on Windows | Documented in the contention doc; CI does not depend on it |
