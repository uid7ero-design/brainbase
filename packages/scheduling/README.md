# @scheduling/core

The shared domain model for Scheduling & Bookings. Pure TypeScript, consumed as
source through the `@scheduling/core` path alias (root `tsconfig.json` and
`vitest.config.ts`), no build step, no runtime dependencies. It follows the
precedent set by `@ticketing/core` (`docs/architecture/decisions/0007-monorepo-boundary-standalone-ticketing.md`).

**Status: Phase 1 foundation.** It defines vocabulary, the six presets,
invariant checks and the ports a host must supply. It deliberately contains no
scheduling engine yet (no slot generation, no capacity arithmetic, no
persistence). Nothing in the running application imports it and no organisation
has the module.

| Module | Holds |
| --- | --- |
| `types` | Ids, local date/time conventions, presets keys, offerings, resources, availability, occurrences, reservations, recurrence, cancellation, customers |
| `presets` | The six preset definitions (data only), `resolveTerminology`, `defaultConfigForPreset` |
| `contracts` | The ports: tenant, clock, customers, reservations, availability, payments, notifications, and `SchedulingPlatform` |
| `validation` | Pure invariant checks, the preset consistency check, `assertSameTenant` |

## Two deployment modes, one engine

```
 BrainBase (module)                         Standalone product
 lib/scheduling/adapters/brainbase          apps/<product>/ (future)
        │  implements ports                         │  implements ports
        ▼                                           ▼
              @scheduling/core   (types, presets, validation, ports)
                          ▲
                          │  never imports downward
```

The dependency points one way. The core imports nothing outside itself, and
`packages/scheduling/tests/boundary.test.ts` reads its source to prove it: no
relative imports leaving the package, no `server-only`, Next.js, React, Stripe,
Resend, database client or `process.env`, no ambient clock or randomness, and
neither the host product's name nor any customer's name appears in it.

## What a host supplies (the ports)

| Port | BrainBase | Standalone |
| --- | --- | --- |
| `TenantContext` (organisation, timezone, actor, `can(permission)`) | `lib/org.ts` session via `staffTenantContext()`; public booking via `publicTenantContext()` | Its own auth and tenant table |
| `CustomerProvider` | CRM `contacts` (`organisation_id` TEXT, unique per org + email) | Its own customers table |
| `ReservationRepository`, `ResourceAvailability` | SQL over `scheduling_*` tables via the shared Neon client | Same SQL, its own connection |
| `PaymentProvider` (optional) | The existing payments foundation | Its own provider |
| `NotificationProvider` (optional) | The existing email layer | Its own sender |
| `Clock` | System clock plus organisation timezone | Same |
| Branding and terminology | `OrganisationSchedulingConfig.terminology` overrides | Same |

Because the persistence SQL is written once against `scheduling_*` tables and
only the connection and the customer table differ, the standalone product reuses
the engine rather than copying it.

## Tenant isolation

Isolation is in the signatures: every data-access port method takes
`tenant: TenantContext` first, and an implementation must scope by
`tenant.organisationId` (plain TEXT, matching `organisations.id`). There is no
method that accepts a bare id. `tests/support/reservationRepositoryContract.ts`
is an executable contract (cross-tenant reads, cancels, attendance, capacity,
concurrent overbooking) that the in-memory reference implementation passes now
and the SQL implementation in Phase 2 must pass against a real database.

## Presets are configuration, not code

A preset is a frozen, JSON-serialisable object (tests assert both). Behaviour
that differs between presets is chosen by closed unions (`TimeModel`,
`CapacitySemantics`, `AvailabilityStrategy`) that the engine implements once, so
a preset cannot inject behaviour. An organisation customises a preset only
through validated terminology overrides and policy values.

| Preset | Time model | Capacity | Resource | Availability |
| --- | --- | --- | --- | --- |
| `classes_coaching` | fixed occurrence | headcount per occurrence | optional | generated occurrences |
| `appointments` | bookable slot | exclusive resource | optional | weekly hours |
| `restaurant_tables` | bookable slot | party fits resource | table, required | service periods |
| `accommodation` | date range | exclusive resource | room, required | nightly inventory |
| `resource_hire` | bookable slot | exclusive resource | required | weekly hours |
| `event_capacity` | fixed occurrence | headcount per occurrence | optional | generated occurrences |

### Events-style reservations versus the ticketing product

`event_capacity` is a free or invitation-style registration against a dated
occurrence with a headcount cap (workshops, open days, info sessions). Anything
involving money or the door belongs to the ticketing product (Events / Eve,
`@ticketing/core`) and is listed in the preset's `outOfScope`: paid ticket
sales, ticket types and per-type inventory, promotions / presales / access
codes, platform fees and GST, QR wallet and check-in scanning, and organiser
payouts. The two products do not share tables. If a business needs paid
tickets it uses Events; scheduling never grows a second ticketing system.

## Tests

`npx vitest run --project packages` from the repository root.
