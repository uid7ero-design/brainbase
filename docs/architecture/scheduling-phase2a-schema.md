# Scheduling Phase 2A: database foundation (design as built)

Implements the schema from the Phase 2 design (PR #463, `scheduling-phase2-schema-outline.md` revision 2) as raw SQL,
plus the first Postgres adapter. This document records **what was built, what differs from the approved outline, and
why**. Nothing here is applied anywhere. See `scheduling-phase2a-migration-package.md` for the manual package and
`scheduling-phase2a-rehearsal.md` for the evidence.

## 1. Layout

```
packages/scheduling/              @scheduling/core   (pure TS: types, presets, validators, ports)
  src/time.ts                     DST-aware local time -> instant resolver (new)
  src/persistence.ts              SchedulingConfigRepository port, SchedulingError (new)
  sql/001..090                    shared, host-free SQL (preflight, schema, verify, rollback)
packages/scheduling-postgres/     @scheduling/postgres (raw-SQL adapter over an injected SqlExecutor)
scripts/scheduling/110, 190       BrainBase host migration (3 FKs) and its rollback
lib/scheduling/adapters/brainbase unchanged in 2A (no wiring)
```

The adapter imports only `@scheduling/core`. It takes a `SqlExecutor` (`query(text, params) => rows`); wrappers for
node-postgres and for the Neon HTTP driver are structural, so neither driver is imported. Every repository operation is
**one SQL statement**, so the Neon HTTP driver (no interactive transactions) is sufficient.

## 2. Tables (13)

`scheduling_settings` (one per organisation: currency only), `scheduling_schedules` (preset, `preset_version`,
terminology, cancellation policy, optional timezone, public slug), `scheduling_resources`, `scheduling_offerings`
(recurrence columns, start time), `scheduling_offering_resources`, `scheduling_availability_rules`,
`scheduling_availability_exceptions`, `scheduling_occurrences`, `scheduling_series`, `scheduling_series_pauses`,
`scheduling_reservations`, `scheduling_resource_holds`, `scheduling_schema_migrations`.

Properties common to all of them: `organisation_id TEXT`; **the primary key is `(organisation_id, id)`** so an id is
unique per tenant; every cross-table link is a composite `(id, organisation_id)` foreign key, so a row can never point
at another tenant's row; `created_at`/`updated_at` (trigger-maintained) and `created_by` (`staff:<id>`, `customer:<id>`,
`public`, `system`) audit columns; no foreign key to any host table in the shared file.

## 3. Differences from the approved outline, with reasons

| # | Outline | As built | Why |
| --- | --- | --- | --- |
| 1 | Global `id` primary keys with `UNIQUE (id, organisation_id)` | Primary key `(organisation_id, id)` | Ids imported from different sources (LD Tennis ids, a standalone host's ids) can collide across tenants; a tenant-scoped key makes that impossible to exploit and lets the shared contract suite use identical ids in two tenants |
| 2 | `reserved_count` kept on the occurrence by trigger | No counter; headcount counted under a per-occurrence advisory lock | The outline itself recommended this (section 5.1) after the LD Tennis proof: no second copy of the number can drift |
| 3 | `config_version` on the schedule | `preset_version` | Matches the Phase 1 core name (`ScheduleConfig.presetVersion`) |
| 4 | Offering buffers, `min_notice`, `max_advance`, `duration_by_party`, check-in/out times, `external_ref_*` | Not created | Nothing in 2A reads them; adding a nullable column later is additive. Avoids speculative schema |
| 5 | Reservation may have a resource or an occurrence | **Exactly one** of `occurrence_id` / `resource_id` (CHECK), plus `span_kind` | Makes the headcount lock family and the resource lock family disjoint, so lock cycles cannot occur; see 5 |
| 6 | Duplicate guard on `(occurrence, customer_id)` and email | Three partial unique indexes (customer, normalised email, series), all tenant-first | Closes the LD Tennis same-email race for the new engine (proven with 12 racers) |
| 7 | (not specified) | `idempotency_key`, unique per tenant | A retried HTTP call must not double-book; replays of a full occurrence still succeed |
| 8 | (not specified) | Per-resource advisory lock before the exclusion index check | **Deadlock found and fixed in 2A**, see 5.3 |
| 9 | (not specified) | `lock_timeout = '5s'` on the four waiting functions | HTTP driver and PgBouncer cannot carry session settings |
| 10 | Status list incl. `waitlisted` | `pending, confirmed, cancelled, completed, no_show` | Waitlists are deferred; the CHECK can be widened later. The core type keeps `waitlisted` |
| 11 | Hold `during` a `tstzrange` | Plus CHECK: half-open, bounded, non-empty | An inclusive upper bound would silently break back-to-back and same-day turnover |
| 12 | Cancel releases holds (app) | Trigger releases holds on any cancelling write; `scheduling_cancel_occurrence()` function closes an occurrence and cancels its reservations atomically | Every writer is covered, and the HTTP driver cannot run two statements in one transaction |
| 13 | (not specified) | Deferred constraint triggers: an exclusive reservation or a resource-bearing occurrence must own a live hold | A writer that skips the hold cannot create an un-protected booking |
| 14 | (not specified) | Local wall-clock columns derived **in SQL** from the instants and timezone | They cannot disagree; DST legality is checked in TypeScript (`time.ts`) because Postgres resolves gaps and overlaps silently |
| 15 | Resource kinds: court, table, room, practitioner, equipment, space | Adds `virtual` | An online appointment line is modelled explicitly, with its own capacity and hold, so remote and in-person appointments are exclusive in exactly the same way. Staff create it deliberately; booking never invents one |
| 16 | (not specified) | CHECK `scheduling_reservations_preset_span_ck`: preset decides span (headcount presets = occurrence; appointments, restaurant tables, facility hire = slot; accommodation = stay) | With the existing one-target and span checks, an appointment can never be stored without a concrete resource, or as a headcount booking |
| 17 | (not specified) | Resource eligibility inside the single create statement: kind accepted by the preset; for customers and the public additionally an active resource linked to the offering | A customer cannot reach an unrelated or internal-only resource by guessing an id |
| 18 | Version marker `2a.1` | `2a.2`; `010` stops with SQLSTATE `SCVER` on a `2a.1` install | 2a.1 existed only on a disposable branch. Two CHECKs changed, and `CREATE TABLE IF NOT EXISTS` cannot alter them, so an old install must be rolled back (090) first rather than silently keep the old rules |

### Findings that change earlier statements

- **Appointments preset (resolved in the final corrections).** Phase 1 said an appointment's resource was
  `optional`, but the database cannot enforce exclusivity without one. The preset is now **version 2**:
  `requirement: 'required'`, kinds `practitioner`, `room` and `virtual`. See section 9.
- **The earlier "no deadlock" claim.** The Neon exclusion rehearsal (17/17) reported no deadlock with 30 racers on one
  identical range. With *different but overlapping* ranges, plain exclusion-constraint inserts deadlock
  (`40P01`) intermittently: first seen as a failed run of the full proof on Postgres 16, then in 1 of 6 repeat runs, and made reliable by a
  25-round x 16-racer test (14 to 28 raw deadlocks per run). The per-resource advisory lock removes it (12 of 12 clean runs; the regression test
  fails 3 of 3 without the trigger). The earlier rehearsal's other results stand.

## 4. Lifecycle

```
pending   -> confirmed | cancelled
confirmed -> cancelled | completed | no_show
cancelled, completed, no_show are terminal
```

Enforced by trigger (`SCLIF`). A cancelled reservation is never revived (its place or resource may already belong to
someone else); a released hold is never re-armed (`SCREA`). The booking snapshot (customer name/email/phone, schedule,
preset and version, timezone, local and UTC window, party size, price) is immutable (`SCIMM`); `customer_id` may be set
once on a customer-less booking but never re-pointed. Occurrences accept only status and capacity changes; capacity
cannot drop below the live headcount.

## 5. Concurrency

### 5.1 Headcount (classes, events-style)

`BEFORE INSERT` trigger on reservations: take `pg_advisory_xact_lock('scheduling_capacity:<org>:<occurrence>')`, read
the occurrence `FOR SHARE`, refuse if it is not `scheduled` (`SCCLS`) or the window differs (`SCWIN`), then
`SUM(party_size)` of live reservations under READ COMMITTED (a fresh snapshot per statement); refuse `SCCAP` when full.
Refuses REPEATABLE READ / SERIALIZABLE (`SCISO`). The `FOR SHARE` makes a concurrent occurrence cancellation wait for
(or be seen by) every booking, so no live reservation can survive on a cancelled occurrence (tested with 20 racers).

### 5.2 Exclusive resources

One partial exclusion constraint on `scheduling_resource_holds`
`(organisation_id =, resource_id =, during &&) WHERE released_at IS NULL`. A class occurrence and a hire booking on the
same court conflict because both write holds. A reservation and its hold are written by **one CTE statement**.

### 5.3 Lock ordering

A statement takes at most one of `{occurrence capacity lock, resource lock}` (CHECK: a reservation targets an
occurrence XOR a resource). Occurrence creation with a court takes only the resource lock. Cancellation takes row locks
only. Hence no cycle between advisory locks is possible. A future statement that inserts several holds must insert
them in `resource_id` order (comment in the SQL). The `FOR SHARE` on the occurrence row cannot cycle either: cancellation
never takes an advisory lock.

### 5.4 Timeouts and transaction boundaries

The Neon HTTP driver runs one statement as one implicit transaction; nothing here assumes more. Waiting functions carry
`SET lock_timeout = '5s'`; a stuck waiter fails with `55P03`, which the adapter maps to the retryable
`contention_timeout` (never to a business refusal; see section 6 and `scheduling-phase2a-contention.md`). Statement
timeouts are the caller's choice (none is imposed by the schema).

## 6. Error mapping (`@scheduling/postgres` `mapPgError`)

| Database | Domain error |
| --- | --- |
| `SCCAP` | `capacity_exceeded` |
| `23P01` | `resource_conflict` |
| `23505` on a duplicate/idempotency index | `duplicate_reservation` |
| `23505` otherwise (slug, occurrence slot) | `conflict` |
| `SCCLS`, `SCRES` | `offering_unavailable` |
| `23503` (missing row **or another tenant's row**, indistinguishable by design) | `not_found` |
| `SCWIN`, `23514`, `23502`, `22P02`, `22007` | `invalid_input` |
| `SCLIF`, `SCIMM`, `SCREA`, `SCHLD` | `lifecycle_violation` |
| `SCISO` | `unsafe_isolation` |
| `55P03` raised by our `lock_timeout` (message "canceling statement due to lock timeout", or a `scheduling_*` function in the context) | `contention_timeout` (`retryable: true`; nothing was written) |
| `55P03` from anything else (NOWAIT, another system) | **unmapped** (rethrown) |
| `40P01`, `40001`, `57014`, connection errors | **unmapped** (rethrown). A deadlock cannot happen in this schema by design; if one ever did it is a defect to surface, not to retry |

## 7. Actors and tenancy

The tenant is only ever `TenantContext.organisationId`, supplied by the host after authentication; no repository input
carries an organisation id. Staff need `scheduling.view|manage|reserve|attendance`. A `public` or `customer` actor reads
and books **published** (`public_slug` set, not archived) schedules only, reads no other reservation, and a customer may
cancel only their own booking when the schedule's policy allows and it has not started. Public tenant resolution (slug to
organisation) is a host concern and is not built in 2A.

## 8. Standalone compatibility

| # | Checklist item (outline section 8) | Result |
| --- | --- | --- |
| 1 | Shared DDL references no BrainBase table | Pass (static test, 10 host names) |
| 2 | `organisation_id` TEXT, no host FK in shared DDL | Pass; FKs only in `110_brainbase_host.sql` |
| 3 | `customer_id` plain nullable TEXT, no FK | Pass |
| 4 | Composite tenant FKs inside shared DDL | Pass (real-Postgres tests for each link) |
| 5 | Core and contract suite run with no host import | Pass; the SAME contract suite passes in memory and on Postgres and Neon |
| 6 | Same SQL applies to an empty database with only a host tenant table | Pass: the Docker proof starts from an empty database; the shared file needs no `organisations` at all |
| 7 | Time and tenant enter through ports | Pass |
| 8 | No Next.js / Neon / Vercel API in the adapter | Pass (boundary test); drivers are injected |
| 9 | Branding, terminology, slugs are data | Pass |

A standalone deployment with its own Neon project applies `001`, `010`, `020` and omits `110`.

## 9. Appointments need a resource (preset v2)

| Question | Answer |
| --- | --- |
| What changed | `appointments` preset **version 2**: resource `required`; kinds `practitioner`, `room`, `virtual`. Same exclusive-resource model as restaurant tables, accommodation and facility hire |
| What is "virtual" | A deliberately created resource (a video room, a telehealth line) with a capacity and a hold like any other. It is never created during a booking |
| Can a customer choose? | Yes: `createAssigned` with a `resourceId` books that provider (customers may name only an active resource linked to the offering). No: `createAssigned` without one assigns a free linked, active resource of an accepted kind, least-booked first |
| Does the customer see the resource? | Never required to. The core exports `withoutInternalResource()` for the customer-facing shape; the host decides what to render |
| When is the resource fixed? | At insert. A reservation row cannot exist without it (CHECKs), and its hold is written in the same statement, so an appointment is never "confirmed" without a concrete resource |
| No resource configured | `offering_unavailable` (a configuration gap), distinct from `resource_conflict` ("all busy"). Nothing is created on the way |
| Existing schedules | A schedule stamped v1 stays valid (`validateScheduleConfig` accepts 1..2) and books under the current rule; `upgradeScheduleConfig()` moves the stamp, keeping terminology, timezone and policy. An old in-memory v1 snapshot without a resource is still read as v1 history (`PRESET_VERSION_NOTES`); new bookings need the current rule. Nothing is persisted at v1 anywhere, and the Phase 2A database never allowed a resourceless appointment |
| A business with no named practitioner | Creates one `practitioner` (or `room`) resource for itself and links it to its services |
| Not in 2A | An appointment needing two resources at once (practitioner **and** room). The holds table already allows several holds per reservation; the booking path is a later phase |

## 10. Not built (by design)

Availability search, occurrence generation and top-up, recurrence reconciliation, payments, notifications, public
booking pages, CRM find-or-create (the host function from the Phase 2 design), routes, navigation, the module
capability, data migration from LD Tennis. Waitlists, table combining and pooled room-type inventory stay deferred; the
holds table already allows several holds per reservation.
