# Scheduling Phase 2B.2 plan: first usable configuration workflows

Status: **plan only. No code, no SQL, no migration, no entitlement.** It builds on the merged Phase 2B.1 guard, runtime and
audit writer (`lib/scheduling/route.ts`, `runtime.ts`, `audit.ts`; main `54c4db28`). Scheduling stays disabled for every
organisation until the separately approved internal-test-organisation enablement. Phase 2B.2 is not started by this document.

## 1. Scope

In: create and edit schedules; choose a preset; define services (offerings); add and manage resources; assign resources to
offerings; show the organisation timezone and currency; validation and lifecycle rules; dynamic route parameters; audit of
every mutation; a responsive configuration dashboard.

Initial presets (the only ones selectable in the UI): **Classes / coaching** (`classes_coaching`), **Appointments**
(`appointments`) and **Facility hire** (`resource_hire`). The other three presets (`restaurant_tables`, `accommodation`,
`event_capacity`) stay in the core, are not offered, and the API rejects them for now.

Out (unchanged exclusions): public booking pages, customer bookings and reservations, payments, notifications, the calendar
and occurrence views, availability rules and exceptions, series, attendance, the restaurant, hotel and events interfaces, LD
Tennis migration, any Production activation. Availability rules and occurrence generation are 2B.3 or later.

## 2. Standalone compatibility (the rule that shapes everything)

- Every behaviour lives in `@scheduling/core` (types, presets, validation) and the `SchedulingConfigRepository` contract,
  implemented by `@scheduling/postgres`. BrainBase adds routes, a UI and its audit call. Nothing in the packages imports
  BrainBase.
- The contract has create and archive, but **no update methods**. "Edit" therefore needs additive contract changes, made in the
  packages with the repository tests: `updateSchedule`, `updateOffering`, `updateResource`, `unlinkOfferingResource` and
  `listOfferingResources`. Each takes the `TenantContext`, enforces `scheduling.manage` in the repository (as the existing
  writers do) and filters by the tenant organisation in SQL. They are additive (no existing signature changes), so a
  standalone host that does not edit is unaffected.
- Validation (names, capacity, duration, price, terminology keys, timezone, preset rules) is in the core and shared. The
  route layer parses transport shape only and calls the core; it never re-implements a rule.

## 3. Data model use (no new tables)

All tables exist from the approved 2A schema: `scheduling_schedules`, `scheduling_resources`, `scheduling_offerings` and the
offering-to-resource link. 2B.2 needs **no migration** unless the work in section 4 finds a missing constraint, in which case
it is raised as a separately approved migration, never bundled. Presets and terms are per schedule; `preset_version` is
recorded at creation.

## 4. Workflows, rules and lifecycle

| Area | Create | Edit | End of life |
| --- | --- | --- | --- |
| Schedule | name, preset (one of three), optional timezone override, cancellation policy, terminology overrides | name, terminology, cancellation policy, timezone override. **Preset is immutable** once the schedule has any offering | archive (soft, `archived_at`); not deleted |
| Offering (service) | under one active schedule: name, type key, colour, duration (null only for date-range), capacity, price (organisation currency), resource kinds | all of those except the schedule; changing duration or capacity never rewrites existing occurrences or reservations (none exist yet; the rule is recorded for 2B.3) | archive; an archived offering is hidden from new work and kept |
| Resource | kind, name, capacity, minimum party, active | name, capacity, minimum party, kind only while unassigned | deactivate (`active = false`), never delete |
| Assignment | link a resource to an offering of a compatible kind | unlink | unlink only; refused once the offering has an occurrence holding the resource (2B.3 enforces; 2B.2 records) |

Rules to enforce (core validation, with named error codes):

- A schedule has exactly one preset for its life; the preset decides what an offering needs (a resource for facility hire,
  a headcount for classes, a person for appointments). An offering that does not satisfy its preset's requirement cannot be
  published, only saved as draft-equivalent (no resource link yet), and is not bookable in any case until a later phase.
- An archived schedule accepts no new offering and no edit except un-archive by a manager, which is audited.
- Price currency is the organisation's settings currency; the API does not accept a currency from the request.
- A resource assigned to offerings cannot change kind. Deactivating a resource that is linked to an active offering is
  allowed and warns (the response lists the affected offerings); it is blocked only where a future occurrence holds it (2B.3).
- Names are trimmed, non-empty, bounded in length, unique per organisation where the schema says so (schedule public slug is
  not set in 2B.2: public slugs belong to public booking).
- Optimistic concurrency: every edit carries the `updated_at` the client read; a stale write is `409 STALE_WRITE` and
  changes nothing.

Timezone and currency: the organisation timezone stays `organisations.timezone` (read-only here, Adelaide fallback, as in
2B.1). A schedule may override it. Currency is `scheduling_settings.currency`, shown read-only. Neither is editable in 2B.2
(changing a currency under existing prices is a separate, deliberate decision).

## 5. API (all through `schedulingRoute`, nothing else)

Base `/api/scheduling`. Reads need `scheduling.view` (privacy-reduced for viewers where relevant); writes need
`scheduling.manage`. Analyst and unknown roles stay denied.

- `GET/POST schedules`, `GET/PATCH schedules/[scheduleId]`, `POST schedules/[scheduleId]/archive` (and `unarchive`)
- `GET/POST schedules/[scheduleId]/offerings`, `GET/PATCH offerings/[offeringId]`, `POST offerings/[offeringId]/archive`
- `GET/POST resources`, `GET/PATCH resources/[resourceId]`, `POST resources/[resourceId]/deactivate` (and `activate`)
- `PUT/DELETE offerings/[offeringId]/resources/[resourceId]`, `GET offerings/[offeringId]/resources`
- `GET presets` (the three offered presets, labels and requirements, from the core)

**Dynamic route parameters.** `schedulingRoute` is extended, not bypassed: the handler receives `params` as a resolved,
validated object. Rules: params are identifiers only (a strict shape, length-bounded); the organisation is never a param
(the 2B.1 containment checker already rejects an organisation id from a param or the request); an identifier is only ever
used together with the session's tenant, so a foreign identifier is "not found" (404) and never reveals existence in
another organisation. The containment checker gains: every `[param]` route still uses `schedulingRoute`; every mutating
method (POST, PUT, PATCH, DELETE) calls the audit writer after its repository call (an unaudited mutation fails the
build); no route reads the request body before the guard.

Responses use the 2B.1 conventions: 401, 403, 503 (not configured or unavailable), `no-store`, a generic 500. Writes add
400 (validation, with the core error code), 404, 409 (`STALE_WRITE`, uniqueness, lifecycle refusal), 422 for preset rule
failures.

## 6. Tenant isolation and permission checks

- Organisation from the session only; every repository call takes the `TenantContext`; every statement filters
  `organisation_id` (existing 2A guarantee, extended to the new update methods and proved the same way).
- Identifier-only params; cross-organisation ids are 404 and untouched (tested for every route, read and write).
- Viewer: read lists and details, no write controls; a write attempt is 403 even if the request is crafted.
- Impersonation: a super_admin session acts in the impersonated organisation only, and the audit record carries the acting
  user (unchanged 2B.1 behaviour).
- Tests: a role-by-route matrix (generated from the route list so a new route cannot be missed), a cross-organisation matrix,
  a stale-write test, concurrency tests on real Postgres 16 and 17 (two edits, two assignments, archive racing an offering
  create).

## 7. Audit (every mutation, none skipped)

Writes use `recordSchedulingAudit` after the repository call returns, with the actions already in the closed list
(`scheduling.schedule.created|updated|archived`, `scheduling.offering...`, `scheduling.resource...`); any action not in the
list (for example offering-resource link and unlink, unarchive) is added to the list in the same change with its test.
Summaries carry ids, changed field **names**, counts and codes, never free text such as names or notes. No customer data
exists in 2B.2, so `identity` is unused. A failed audit write is logged without payload and never fails or reverses the
committed change (proved in 2B.1). The build fails if a mutating route lacks the call.

## 8. Responsive dashboard

One configuration area, reached only after the module is enabled for the organisation (no navigation entry before then):

- **Overview**: organisation timezone and currency (read-only, with the source "organisation" or "default"), counts of
  schedules, services, resources, and a setup checklist (schedule, service, resource, assignment).
- **Schedules**: list and detail; create with a preset picker (three cards with a one-line explanation of when to use each);
  edit; archive. The preset is shown, not editable, after the first service.
- **Services**: per schedule; form adapts to the preset (facility hire asks for a resource kind and no headcount; classes
  asks for capacity and duration; appointments asks for duration and the staff resource).
- **Resources**: list with kind, capacity, active toggle; create and edit; shows which services use it.
- **Assignments**: on the service page, a resource picker limited to compatible kinds.

Design: mobile first; single column below 640px with a sticky primary action, tables collapse to cards, 44px touch targets,
no horizontal scroll at 360px; forms validate inline with the core codes mapped to plain wording; viewers see the same pages
read-only. Wording comes from the preset's terminology (`resolveTerms`), so "class", "appointment" and "booking" read
correctly. The shell, tokens and theme come from the existing ops design system (light and dark); no new visual language.
Server components read through the runtime (no client-side organisation id); client components receive data as props and
call the routes; no server-only runtime constant is imported into a client component (the known bundle-leak failure). A
visual harness check at 360, 768 and 1280px is part of acceptance.

## 9. Delivery slices (each its own reviewed PR; no auto-start)

1. **2B.2a** package contract: update and unlink methods, validation, repository tests on Postgres 16 and 17. No BrainBase
   change.
2. **2B.2b** route layer: dynamic params in `schedulingRoute`, the containment checker extensions, the routes and audit calls,
   with the permission and isolation matrices.
3. **2B.2c** dashboard UI behind the capability, with the visual harness evidence.
4. **2B.2d** Preview rehearsal on a disposable Neon branch: enable the internal test organisation there (with the corrected
   enablement SQL), walk the workflows, record evidence, delete the branch.

## 10. Preconditions and open decisions

- The corrected enablement SQL (explicit settings, same transaction) is reviewed and merged first.
- CRM correction #472: independent of 2B.2 (no customer or booking work), but it shares the identity lock key with the
  Scheduling host function, so it should merge before any booking phase.
- Decisions needed: (a) whether 2B.2 includes un-archive; (b) whether a viewer sees pricing; (c) which staff of the internal
  test organisation exist and their roles; (d) confirm that availability rules move to 2B.3.
- Risks: additive contract changes touch the shared packages (mitigated by being additive and tested in isolation);
  optimistic concurrency needs `updated_at` returned by every read; UI scope creep into the calendar (excluded here).

## 11. Acceptance for 2B.2

tsc, ESLint, unit, containment and API permission suites green; repository tests and the real-Postgres proofs pass on 16 and
17; every route in the role and cross-organisation matrices; no mutating route unaudited; no migration unless separately
approved; no organisation enabled in Production; CI green; draft PRs only.
