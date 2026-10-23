# Scheduling Phase 2B.2b: the configuration API (implemented)

Status: **implemented on `feat/scheduling-phase2b2b-config-api`, draft PR, not merged, not deployed.** It adds the HTTP routes
that let a signed-in manager configure Scheduling: schedules, offerings, resources, and which resources an offering uses. It adds
no page, no navigation entry, no booking, no payment and no public access, and enables nothing: the `scheduling` capability is
still registered for nobody, so every one of these routes answers 403 until an organisation is deliberately enabled.

## 1. Routes

All routes are `schedulingRoute(<permission>, <handler>)` (the central guard from 2B.1). Reads need `scheduling.view`; every
write needs `scheduling.manage`. The organisation is the session's and is never read from a request.

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/scheduling/schedules` | view | list schedules |
| `POST /api/scheduling/schedules` | manage | create a schedule |
| `GET /api/scheduling/schedules/{scheduleId}` | view | one schedule and its offerings |
| `PATCH /api/scheduling/schedules/{scheduleId}` | manage | edit (needs `expectedUpdatedAt`) |
| `POST /api/scheduling/schedules/{scheduleId}/archive` | manage | archive (one-way) |
| `GET /api/scheduling/schedules/{scheduleId}/offerings` | view | list offerings |
| `POST /api/scheduling/schedules/{scheduleId}/offerings` | manage | create an offering |
| `GET /api/scheduling/offerings/{offeringId}` | view | one offering and its assigned resources |
| `PATCH /api/scheduling/offerings/{offeringId}` | manage | edit (needs `expectedUpdatedAt`) |
| `POST /api/scheduling/offerings/{offeringId}/archive` | manage | archive (one-way; reservations untouched) |
| `GET /api/scheduling/offerings/{offeringId}/resources` | view | assigned resources |
| `POST /api/scheduling/offerings/{offeringId}/resources` | manage | assign `{ resourceId }` (idempotent) |
| `DELETE /api/scheduling/offerings/{offeringId}/resources/{resourceId}` | manage | unassign (the link only; idempotent) |
| `GET /api/scheduling/resources` | view | list resources |
| `POST /api/scheduling/resources` | manage | create a resource |
| `GET /api/scheduling/resources/{resourceId}` | view | one resource |
| `PATCH /api/scheduling/resources/{resourceId}` | manage | edit name / kind / capacity / minParty (needs `expectedUpdatedAt`; `active` is refused here) |
| `POST /api/scheduling/resources/{resourceId}/deactivate` | manage | deactivate (needs `expectedUpdatedAt`) |
| `POST /api/scheduling/resources/{resourceId}/reactivate` | manage | reactivate (needs `expectedUpdatedAt`) |

**Dynamic parameters.** `schedulingRoute` now passes Next's `params` promise through: it is awaited only after authorisation and
the runtime succeeded, only string segments are kept, and the handler reads them with `idParam`, which accepts only the shape of
an id the repository mints. Anything else is a plain 404 and reaches no query. A parameter is never an organisation.

## 2. Scope and presets

Only `classes_coaching`, `appointments` and `resource_hire` (facility hire) can be created or switched to. Restaurant tables,
accommodation and events remain fully supported by the core and the database but are refused here (400, listing the allowed
presets) until they have a configuration interface. `publicSlug` is never accepted: public booking is not part of this API.

Preset-aware validation (pure functions in `@scheduling/core`, so a standalone host refuses the same shapes):

- `validateOfferingPatch` (2B.2a): per-field rules and the preset's recurrence kinds and end modes.
- `validateOfferingForPreset` (new): the combination, checked on the RESULT of a create or edit. Classes need a capacity and a
  duration; exclusive-resource presets (appointments, hire) take their capacity from the resource, so `capacity` must be empty;
  appointments need a duration; a weekly offering needs its start time.
- Assignment checks the resource is active and of a kind the offering's preset accepts (409 `RESOURCE_INACTIVE` /
  `KIND_NOT_ACCEPTED` with the accepted kinds). The database enforces the same rule against a race once the 2B.2 concurrency
  migration (030) is applied.

## 3. Optimistic concurrency and the error contract

An edit carries `expectedUpdatedAt`, the `updatedAt` read earlier; the repository writes only if it still matches, in the same
statement. A stale token is **HTTP 409 `STALE_WRITE`** and nothing is written. Every error body is `{ error, code, ... }` with no
internal detail:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` (+ `problems`) | malformed body, unknown field, or a rule failure |
| 401 / 403 / 503 | (guard) | no session; not entitled or not permitted; entitlement or configuration unavailable |
| 404 | `NOT_FOUND` | missing, or another organisation's row (indistinguishable) |
| 409 | `STALE_WRITE` | changed since read; reload and retry |
| 409 | `ARCHIVED` | the row (or its schedule/offering) is archived; archiving is one-way |
| 409 | `PRESET_LOCKED` | a schedule's preset cannot change once it has offerings |
| 409 | `RESOURCE_IN_USE` | kind change / deactivation / capacity under a live reservation |
| 409 | `ALLOCATION_IN_USE` | unassign while a live reservation holds the resource for the offering |
| 409 | `RESOURCE_INACTIVE`, `KIND_NOT_ACCEPTED`, `CONFLICT` | assignment or lifecycle refusals |
| 413 / 415 | | body over 32 KB / not `application/json` |
| 503 | `TRY_AGAIN` | a lock wait timed out; nothing was written |

## 4. Audit

After a successful mutation, one entry is written through the existing audit module (best effort, never undoes the change):
`scheduling.schedule.created|updated|archived`, `scheduling.offering.created|updated|archived`,
`scheduling.resource.created|updated|deactivated|reactivated|linked|unlinked`. Five of these actions are new in the closed list
(`offering.archived`, `resource.deactivated|reactivated|linked|unlinked`). The summary holds ids, the preset key and the NAMES of
the changed fields, never their values: a schedule name typed by a user is not stored. Refusals (400/404/409) and reads write
nothing. A repeated assignment or unassignment that changed nothing is not audited.

## 5. Verification

- `tests/containment/schedulingPhase2b2bContainment.test.ts` (13, runs in CI): the exact route set and the permission of every
  method; no booking/payment/public route; the configuration modules import no database, session, capability gate or Postgres
  package, contain no SQL and take no organisation input; every repository mutation is audited after its failure branch; the
  preset scope; the guard resolves params after authorisation.
- `scripts/tests/schedulingConfigApi2b2b.integration.test.ts` (26, real PostgreSQL via
  `scripts/tests/verify-scheduling-phase2b2b.sh`): the real guard, capability lookup, runtime, repositories and audit module.
  It covers 401/403 on every operation, the viewer/analyst matrix, create/edit/archive for each entity, preset-aware refusals, 409
  `STALE_WRITE` including 12 simultaneous edits (one winner), `PRESET_LOCKED`, `ARCHIVED`, `RESOURCE_IN_USE` and
  `ALLOCATION_IN_USE` under a real reservation (history untouched), cross-organisation access on every operation in both
  directions (404 and byte-identical rows), hostile ids, impersonation, and the audit trail.
- `packages/scheduling/tests/configuration.test.ts`: `validateOfferingForPreset`.

## 6. Known limits

- The race protection for deactivation/unassign/kind change is in the separate 2B.2 concurrency migration (030). Without it the
  routes behave exactly as the 2B.2a repository does: sequential refusals are enforced, and the narrow concurrent-booking
  window documented in 2B.2a remains. Apply 030 before enabling Scheduling for anyone.
- `GET` of a resource lists all resources and filters (there is no `getResource` in the repository). Fine at configuration scale.
- Archived schedules and offerings are returned by the list routes with `archivedAt` set; the client decides how to show them.
- A viewer sees configuration (names, capacities) but no customer data; the reduced read shape for customer data arrives with
  the reservation routes.
- Rate limiting is not added here (none of the existing Scheduling routes has it).
