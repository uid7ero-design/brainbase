# 0014 — Scheduling & Bookings foundation (Phase 1)

Status: Proposed (Phase 1 foundation, awaiting owner review). No schema change,
no data change, no route, no navigation entry; the module is enabled for no
organisation. Phases 2 onward are not authorised by this ADR.

## 1. Context

LD Tennis runs a live sessions feature (weekly templates, generated dated
instances, enrolments held as `bookings`, recurring lineages, pauses, archive,
public booking). The intent is a reusable Scheduling & Bookings product with
selectable presets (classes, appointments, restaurant tables, accommodation,
resource hire, events-style capacity) that runs as a BrainBase module and as a
standalone product on one engine. The current implementation is tennis-named,
raw-SQL, and coupled to BrainBase's session, CRM and navigation. The measured
baseline and dependency map are in
`docs/architecture/scheduling-phase1-ld-tennis-baseline.md`.

## 2. Decisions

1. **A shared package, `packages/scheduling` (`@scheduling/core`)**, not a
   folder under `lib/`. The repository already established this boundary for
   ticketing (ADR 0007); a package has its own manifest and tsconfig (no
   ambient DOM/Node types) so independence is enforced by the compiler and by
   `boundary.test.ts`, and `apps/*` can consume it later exactly as `apps/eve`
   consumes `@ticketing/core`. The BrainBase-specific code lives in
   `lib/scheduling/adapters/brainbase` and `lib/scheduling/compatibility/tennis`
   and depends on the core, never the reverse. This differs from the
   `lib/scheduling/core/...` layout suggested in the brief for that reason.
2. **Presets are data** over closed behaviour unions; no hooks, no functions. **A preset belongs
   to a schedule, not to an organisation.** An organisation has one `SchedulingSettings` record
   (tenant, currency, optional default timezone) and any number of `ScheduleConfig` records, each a
   business line with its own preset, preset version, terminology, cancellation policy and optional
   timezone override. A restaurant, a coaching programme and an events programme can coexist in one
   organisation without sharing configuration (corrected 2026-10-21; the first revision assumed one
   preset per organisation).
3. **Ports with the tenant first.** Isolation is structural, and proven by an
   executable repository contract the Phase 2 SQL adapter must pass.
4. **New `scheduling_*` tables later; legacy tennis tables untouched.** Not
   created in Phase 1 (a containment test fails if any `scheduling_*`
   identifier appears in `scripts/`, `prisma/` or `backend_migration/`).
5. **`organisation_id` is TEXT**, `OrganisationId = string`.
6. **Money is integer cents plus a currency code** (ADR 0002).
7. **Local calendar dates (`YYYY-MM-DD`) and wall-clock times (`HH:MM`)** in the
   organisation's timezone, matching `session_instances` today. Instants are
   produced only at the edges, through the `Clock` port, never `new Date()` in
   the core.
8. **Compatibility is a pure mapping layer, read-only toward the live system.**
   It imports no tennis runtime code and nothing imports it.
9. **Events-style capacity stays separate from Eve.** See section 4.

## 3. Standalone readiness

Independent today: all types, presets, validation, the port definitions, the
tenant-isolation contract. Platform-specific (supplied through ports): identity
and tenant resolution, the customer table, database connection and SQL
adapters, payments, notifications, branding. Not built and not decided:
the standalone UI, its authentication and tenant management, deployment. A
standalone application would add `apps/<name>`, an alias for `@scheduling/core`
in its tsconfig, and implement `SchedulingPlatform`; it would not copy domain
code.

## 4. Boundary with the ticketing product

`event_capacity` covers free/invitation registrations with a headcount cap.
Ticket sales, ticket types and per-type inventory, promotions and access codes,
fees/GST, wallet/QR, door check-in and payouts remain in Events/Eve and are
recorded in the preset's `outOfScope`. No shared tables. A future need to sell
paid tickets from a scheduled occurrence is solved by linking an occurrence to
an Events listing, not by extending the scheduling schema.

## 5. What Phase 1 deliberately does not do

No engine (no slot generation, capacity arithmetic or persistence), no tables,
no routes, no UI, no nav, no capability row, no backfill, no dual writes, no
change to any tennis file. A reserved capability key (`scheduling`) is exported
by the adapter but is not seeded in `modules` and is checked nowhere.

## 6. Consequences and risks

- The package is source-aliased in three places (root `tsconfig.json`,
  `vitest.config.ts`; a standalone app would add its own), the same trade-off
  ticketing accepted.
- Preset definitions carry a `version`. A schedule records the version it was configured against and
  a reservation records the preset and version it was made under, so changing a preset later never
  silently reinterprets existing data.
- A reservation is a snapshot: customer details (with the normalised email used for matching), the
  timezone in force, the UTC window, and the preset/version. Editing a customer, a schedule or an
  organisation timezone later does not rewrite history. Customers are matched on organisation +
  normalised email only, never on a name.
- The brief's "no direct imports from the core into BrainBase" is satisfied;
  the converse (adapters importing the core) is required and intended.

See the baseline document for pre-existing defects found during discovery that
affect Phase 2 design.

## 7. Amendment (2026-10-21): multiple presets per organisation (implemented)

The owner approved the Phase 2 defaults with one refinement: **an organisation may run more than one
preset**. The preset therefore belongs to a *schedule* (a business line within an organisation), not to
the organisation. This is implemented in the Phase 1 core (commit `e01fd83b`): `SchedulingSettings`
(one per organisation) and `ScheduleConfig` (any number, each with its own preset, preset version,
terminology, cancellation policy and optional timezone override) replace the single
`OrganisationSchedulingConfig`; reservations snapshot the schedule, preset and version, customer and
timezone; two schedules with different presets are proved not to leak configuration into each other.
Standalone deployability is an acceptance criterion for every phase.
Details: `docs/architecture/scheduling-phase2-schema-outline.md`.
