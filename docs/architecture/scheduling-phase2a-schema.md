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

### Findings that change earlier statements

- **Appointments preset.** Phase 1 says an appointments reservation's resource is `optional`. The database cannot
  enforce exclusivity without a resource, so 2A requires one for every slot or stay. A business with no named
  practitioner should create one `practitioner` resource for itself. Tightening the preset to `required` is a preset
  version bump and an owner decision; it is **not** done here.
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
`SET lock_timeout = '5s'`; a stuck waiter fails with `55P03`, which is **not** mapped to a business error. Statement
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
| `40P01`, `40001`, `55P03`, `57014`, connection errors | **unmapped** (rethrown) |

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

## 9. Not built (by design)

Availability search, occurrence generation and top-up, recurrence reconciliation, payments, notifications, public
booking pages, CRM find-or-create (the host function from the Phase 2 design), routes, navigation, the module
capability, data migration from LD Tennis. Waitlists, table combining and pooled room-type inventory stay deferred; the
holds table already allows several holds per reservation.
