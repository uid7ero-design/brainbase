# Scheduling Phase 2 — schema, concurrency and migration design (revision 2)

**Documentation only. Nothing here has been run, applied or reviewed against a
database, no Neon access was used to write it, and Phase 2 is not started.**
Table and column names are proposals. Revision 2 (2026-10-21) incorporates the
owner's approval of the 12 recommended defaults and four refinements, and
replaces the first outline where the review below found it wrong or
under-specified.

## 0. Approved defaults (owner, 2026-10-21)

| # | Question | Approved default |
| --- | --- | --- |
| 1 | New tables or evolve legacy in place? | New `scheduling_*` tables; legacy tennis tables untouched |
| 2 | Top-up of ongoing schedules in the new engine | Unattended trigger (cron-secret-authenticated route) plus the page-load call as a backstop. Legacy stack unchanged |
| 3 | Timezone source | Configurable IANA timezone; fallback `Australia/Adelaide` for organisations without one (see 0.1) |
| 4 | Customer link for public bookings | Find-or-create a CRM contact by normalised email, organisation-scoped (see 0.2) |
| 5 | Existing bookings with no email | Not auto-matched; imported customer-less and flagged for manual review |
| 6 | Pricing, deposits, online payment | Out of scope until after module enablement (2D) |
| 7 | Calendar sync, reminders | Out of scope; reminders reuse the notification port later |
| 8 | Roles | Reuse BrainBase roles through the adapter mapping; analyst denied |
| 9 | Public tenant resolution | Route slug resolved on the server; never an environment variable or request field |
| 10 | Waitlists, participant lists | Deferred; schema allows adding later |
| 11 | Standalone identity and tenancy | Separate decision after the BrainBase module works; **standalone deployability is an acceptance criterion throughout** (0.4) |
| 12 | Where the preset version lives | A config version on the schedule (0.3), bumped when a preset definition changes meaning |

Refinements, now binding on this design:

**0.1 Timezones.** Organisations support configurable IANA timezones, with no
duplicate setting. Resolution order, evaluated by the host adapter and passed in
through `TenantContext.timezone`: **schedule timezone** (nullable override), else
**`organisations.timezone`** (the existing nullable column), else `Australia/Adelaide`.
There is no timezone on scheduling settings. The fallback is applied **at read time,
never by backfilling**: the F.2A script deliberately adds a nullable column with no
default. Verified on a Production-derived copy: the column **exists** (F.2A is applied),
and all 6 organisations are NULL, so the fallback applies to every organisation today.
Wiring note: `organisationTimezoneSchema.test.ts` fails if any file under `app/api` or
`lib` mentions the organisation timezone column. The Phase 2 adapter must be the
deliberate, reviewed change that reads it, and that test is updated in the same PR
with a stated reason (details and exact edit in
`scheduling-crm-and-timezone-findings.md` section 2.3). Until then the adapter
keeps taking the timezone as an input. No production migration is proposed.

**0.2 CRM matching.** Organisation-scoped, normalised email only, never names,
booking snapshots preserved (design in section 3).

**0.3 Multiple presets per organisation.** The first outline and the Phase 1
core assumed one preset per organisation. That is replaced by a *schedule* level
(section 2).

**0.4 Standalone deployability** is an architectural acceptance criterion at
every phase. The checklist is section 8; a phase that fails an item does not
merge.

## 1. What changed from revision 1, and why

| First outline | Problem found in review | Revision |
| --- | --- | --- |
| One `preset_key` on `scheduling_settings` | Cannot host a restaurant, room hire and events in one organisation; terminology and cancellation policy are per-business-line, not per-organisation | `scheduling_schedules` level carries the preset, terminology, policy, timezone override and public slug (section 2) |
| Exclusion constraint on `scheduling_reservations` | A class holds a court once for N enrolments, so the constraint cannot live on per-customer rows; combined tables need several holds per reservation; resources shared across presets would not conflict | Separate `scheduling_resource_holds` table carries the only exclusion constraint (section 5) |
| `reserved_count` maintained by the application | Drifts if any writer (staff SQL, a future path, a bug) changes a reservation without updating it; the legacy system's many cancel paths are exactly this hazard | Counter maintained by a trigger on reservations in the same statement, with a `CHECK` on the occurrence (section 5.1). Needs proof on a disposable branch |
| Exclusion on `tstzrange` assumed trivially | Ranges are instants; DST makes the local-to-instant conversion lossy and tz rules can change | Store local date/time **and** instants, plus the timezone used; rules in section 4 |
| `btree_gist` assumed available | Not used anywhere in this repository yet (a Commercial schema comment defers the same decision); availability on the Neon plan is unverified | Treated as a verification gate; fallback in section 5.2 |
| `customer_id` plain TEXT only | Public bookings without email, and history stability when a contact is edited, were unspecified | Nullable `customer_id` plus a snapshot on every reservation (section 3) |
| FK to `organisations` in the shared schema | Blocks a standalone deployment that has its own tenant table | FK lives in a per-host migration (section 8) |

## 2. Multi-preset model

**Decision: the preset lives on a `schedule`, not on the organisation and not on
each offering.**

Why a schedule level rather than `preset_key` on each offering: terminology
("Squad" versus "Guests"), the default cancellation policy, the timezone
override, the public booking URL and the config version are properties of a
business line, not of one offering. Putting the preset on each offering would
duplicate and drift those settings across every offering of that line.

Why not a single preset per organisation: an organisation may run coaching
classes and facility hire on the same courts, or a restaurant with an events
programme.

```
organisation (host)
  └─ scheduling_settings        1 row: default currency, defaults only (no timezone: see 0.1)
       └─ scheduling_schedules  n rows: preset_key, name, public_slug, terminology,
            │                   cancellation_policy, timezone?, config_version
            └─ scheduling_offerings   (belong to exactly one schedule)
  └─ scheduling_resources       organisation-level; shared by offerings across schedules
       └─ scheduling_offering_resources  (which resources an offering may use)
```

Initial onboarding exposes one schedule per organisation, created from the
chosen preset. Nothing in the schema limits it to one.

### Phase 1 core: implemented (commit `e01fd83b` on `feat/scheduling-phase1-foundation`)

| Item | Result |
| --- | --- |
| `OrganisationSchedulingConfig` | Replaced by `SchedulingSettings` (organisation id, currency, nullable default timezone supplied by the host) and `ScheduleConfig` (id, organisation id, name, `presetKey`, `presetVersion`, terminology, cancellation policy, nullable timezone override) |
| `defaultConfigForPreset` / `validateOrganisationConfig` | `defaultScheduleConfig`, `defaultSettings`; `validateScheduleConfig`, `validateSettings`; deep-copied defaults and a deeply frozen preset registry |
| Timezone | `isIanaTimezone`, `resolveScheduleTimezone(schedule, settings, fallback)`; the fallback is a host parameter (BrainBase: `Australia/Adelaide`) |
| `Offering` | `scheduleId` added. Buffers, notice, advance limit and duration-by-party stay out until the engine needs them (no speculative fields) |
| `Reservation` | Snapshot: `scheduleId`, `presetKey`/`presetVersion`, `customerSnapshot` (with `emailNormalised`), nullable `customerId`, `timezone`, UTC `instants` |
| Validators | `validateReservationSnapshot`, `validateReservationAgainstSchedule` (judged by the preset the reservation snapshotted) |
| Ports | `NewReservationInput` carries the snapshot fields; `TenantContext.timezone` stays the resolved zone |
| Still to add in Phase 2 | the zero-price rule for events-style offerings (6.6); the CRM matching helper tests against a real adapter |

Note on timezone: `SchedulingSettings.timezone` in the core is the *host-resolved organisation default*.
In BrainBase it comes from the existing organisation timezone column; the scheduling tables store
**no** organisation-level timezone (no duplicate setting), only the schedule override.

## 3. Public booking, CRM matching and snapshots

Evidence for everything in this section is in
`scheduling-crm-and-timezone-findings.md` (live catalog and aggregate counts from a
Production-derived copy, plus repository references).

**Authoritative customer table: `crm_contacts`.** It is the platform's generic CRM
(uuid id, `organisation_id` TEXT, `first_name`/`last_name`, capability-gated by `crm`,
a governed `classification` vocabulary, referenced by Events, Commercial, deals and
activities). `contacts` is a self-described LD Tennis vertical table (text id,
single `name`, an unconstrained `status`, no capability gate). The two share no keys
and no sync, and in the snapshot each organisation uses exactly one: `ld-tennis` has
5 `contacts` and 0 `crm_contacts`; the other two active organisations use only
`crm_contacts`. **LD Tennis exception:** its customers live in `contacts`, so for that
tenant the BrainBase adapter's `CustomerProvider` resolves against `contacts` until a
separately approved migration. This is an adapter detail only: the shared schema stores
`customer_id` as plain TEXT plus a booking snapshot, and `@scheduling/core` sees only
`CustomerRef`. A standalone host supplies its own customer store through the same port.
Scheduling creates no CRM tables.

Find-or-create (all steps scoped to the tenant's organisation):

1. Normalise the email: trim and lowercase only. Do **not** strip dots or `+tag`
   suffixes. Reject malformed input.
2. No email: `customer_id` stays NULL. The reservation is customer-less and carries its
   snapshot; staff may link it later. A name is never used to find or merge a customer,
   in any path.
3. Look up `WHERE organisation_id = $org AND lower(btrim(email)) = $norm`. The lower-cased
   lookup is required: `contacts`' unique constraint is case-sensitive (the snapshot has
   1 case-variant duplicate pair), and `crm_contacts` has no unique constraint at all.
4. Not found: create. **On `crm_contacts` there is no unique key, so `ON CONFLICT` is not
   available, and the single-statement lock-lookup-insert shape used by Events sync is
   unsafe** (reproduced: 6 contacts for one email under forced overlap, because the
   statement's snapshot predates the lock wait). Use a host-owned database function that
   takes `pg_advisory_xact_lock(hashtext(org), hashtext('email:' || norm))`, then runs the
   lookup as a **separate statement**, then inserts if absent (1 contact for 6 overlapping
   callers in the same test). It is part of the BrainBase host migration, not the shared
   DDL. Optional hardening, needing a product decision: a unique index on
   `(organisation_id, lower(btrim(email)))` for `crm_contacts` (0 duplicates today).
   On `contacts` (LD Tennis): lookup first, then `INSERT ... ON CONFLICT (organisation_id,
   email) DO NOTHING RETURNING id`, re-select if nothing returned.
5. Found: use it as is. **Never overwrite** the contact's name, phone or classification
   from public input; the person who types an email is not authenticated.
6. Every reservation stores a snapshot captured at booking time: name, email (as typed),
   normalised email, phone, plus `contact_link` (`matched`, `created`, `none`) and
   the timezone used. Later contact edits do not rewrite booking history. Comparing the
   snapshot name with the contact's current name lets staff spot a different person on a
   shared address without any automatic action.

**Classification of a contact created by a public booking.** `crm_contacts`:
`classification = 'LEAD'` (existing value; "known person, relationship not confirmed by
staff"; mirrors LD Tennis, where the public enquiry creates `status = 'lead'` and only
staff promote to `active`/squad). `contacts` (LD Tennis): `status = 'lead'`. A booking
alone never produces `active`. `CLIENT` would assert an unconfirmed relationship,
`EVENT_CONTACT` is Events-specific, `OTHER` is meaningless, NULL hides the person from
classification filters. **Documented gap, not filled:** no existing value means "booked
customer", and there is no first-class source field (Events uses an informal `notes`
marker; scheduling writes `Scheduling / Public Booking` the same way). A distinct
classification would be a CHECK-constraint change on `crm_contacts` and is not proposed.

## 4. Timezones and DST

**Configuration (least disruptive, no duplicate settings).** Reuse the existing
organisation column (nullable, no default, all NULL today); add one nullable `timezone` on
the schedule as an override; remove `timezone` from scheduling settings. Resolution at read
time: schedule, else organisation column, else `Australia/Adelaide`; no backfill (the NULL
means "not configured" and the fallback already gives the intended answer). The
organisation-level value is a host concept (BrainBase column; a standalone tenant table) that
arrives through `TenantContext.timezone`, so the shared DDL carries only the schedule
override and the per-row snapshot. Unrelated existing settings stay as they are: the per-user
preference (`users.timezone`, default Adelaide) is a display setting, and each event has its
own required timezone. Validation reuses the `Intl.supportedValuesOf('timeZone')` approach
already in `packages/ticketing/src/validation.ts`, exposed once as `isIanaTimezone` in the
core; offsets and abbreviations are rejected.

- **Source of truth for the future is the local wall clock**: store
  `local_date`, `local_start_time`, `timezone` and the derived `starts_at` /
  `ends_at` (timestamptz). A weekly 16:00 class stays 16:00 across a DST change
  because recurrence is expanded in local time and converted per occurrence.
- **Past records are authoritative in UTC.** If a government changes a zone's
  rules, a maintenance job re-derives instants for future occurrences from the
  local fields; past ones are not touched.
- **Gap (spring forward, nonexistent local time):** staff-entered slots in the
  gap are rejected with a clear message. For generated recurring occurrences,
  resolve forward by the length of the gap (02:30 becomes 03:30) and flag it.
- **Overlap (fall back, ambiguous local time):** resolve to the earlier of the
  two instants and record the UTC offset used. Durations are computed on
  instants, so a 60-minute class is always 60 real minutes.
- **Adelaide** observes daylight saving (UTC+10:30 summer, +9:30 winter;
  changeovers on the first Sunday of October and April). The exact rules must
  come from the timezone database, never from constants in our code.
- **Hotel stays**: nights are local calendar dates, not multiples of 24 hours.
  Check-in and check-out times of day are offering settings; the held range is
  from local check-in time to local check-out time in the property's timezone.
- **Validation**: names are checked in the core with `Intl.DateTimeFormat`
  (pure, no I/O) and by the host against the database's timezone list on write.
- **Snapshots** keep the timezone used at booking time, so a later change to an
  organisation's timezone never reinterprets existing bookings.
- Production runs in UTC on Vercel (stated in the F.2A script), so every "today"
  must come from `Clock.today(timezone)`, never `new Date()` local components.

## 5. Concurrency design (revised)

### 5.1 Headcount capacity (classes, events-style)

`scheduling_occurrences` carries `capacity` and `reserved_count`, with
`CHECK (reserved_count BETWEEN 0 AND capacity)`. A trigger on
`scheduling_reservations` (insert, status change, party size change, delete)
adjusts `reserved_count` on the occurrence row **in the same statement**. The
row lock serialises concurrent writers, the update re-evaluates against the
latest row version, and the `CHECK` rejects the second writer atomically. It
works over the Neon HTTP driver because it needs no interactive transaction.

**Evidence now available (2026-10-21, `docs/architecture/ld-tennis-booking-capacity-guard.md`).**
A different database-side pattern was proven on a disposable Neon branch for the live LD Tennis
system: a `BEFORE INSERT` row trigger that takes `pg_advisory_xact_lock` keyed on the parent id,
then counts live children and raises a dedicated SQLSTATE when full. Over the Neon HTTP driver, on both
the pooled and direct hosts, 30 parallel bookings into a capacity-5 instance produced exactly 5
confirmed (30 of 30 without it), refusals arrived as `error.code`, and concurrent UPDATEs and cancels
produced no deadlock. It needs no counter column and cannot drift, because there is no second copy
of the number to keep in step.

**Recommendation for the new tables:** use that proven pattern as the default for headcount
capacity (advisory lock plus count in a trigger on `scheduling_reservations`), and keep the
`reserved_count` counter described above only as an optimisation if counting a large occurrence
ever proves slow. Both are database-enforced for every writer; the count-under-lock version
is the one demonstrated on this platform. The counter variant remains unproven here.

One rule applies to either: it must be installed before any application path writes to the table,
and every refusal must map to the response the caller already gives for "full".

### 5.2 Exclusive resources (appointments, tables, rooms, hire, and classes that occupy a court)

All exclusivity lives in one table, `scheduling_resource_holds`:
`(organisation_id, resource_id, during tstzrange, reservation_id NULL,
occurrence_id NULL, released_at NULL)`, with exactly one of reservation or
occurrence set, and

> exclusion constraint over `(organisation_id =, resource_id =, during &&)`
> where `released_at IS NULL`, using the `btree_gist` extension.

A reservation can create several holds (two tables, a practitioner and a room);
a class occurrence creates one hold for its court regardless of enrolments.
Buffers are part of the held range. Ranges are half-open, so back-to-back
bookings and same-day hotel turnover do not collide.

**Verified (2A rehearsal, `docs/architecture/scheduling-phase2a-exclusion-rehearsal.md`).** On a
disposable Neon branch, `btree_gist` 1.7 installs without owner help, idempotently, into a named
schema; the partial exclusion constraint above rejects overlap (SQLSTATE `23P01`) and accepts adjacent
half-open ranges; setting `released_at` (or deleting the hold) frees the range; same-day hotel turnover
works on both Adelaide DST days; 30 concurrent racers for one range give exactly one winner over the HTTP
and WebSocket drivers on pooled and direct hosts, with no deadlock; the same resource and range in two
organisations never conflict; a reservation plus its holds can be written in one CTE statement, and a
multi-row hold insert is all-or-nothing; the migration is idempotent and rolls back cleanly; it coexists
with the capacity trigger. Consequences for the design:

- **Install in 2A:** `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA <named schema>` in the 2A migration.
- **No "reactivate":** setting `released_at` back to NULL fails with `23P01` if the slot was re-taken, so a
  cancelled reservation is never revived; a new booking goes through the normal hold path.
- **One statement:** the repository creates a reservation and its holds in a single CTE.
- **Composite FK** `(reservation_id, organisation_id)` on holds, with an index for the cancel flow.
- **Error mapping:** `23P01` -> `resource_conflict`; `23503` -> tenant/programming error; `BKCAP` -> capacity refusal.
- **Timeouts:** the branch had `statement_timeout` and `lock_timeout` at 0; set explicit timeouts and keep transactions short.
- **Ambiguous local times:** Postgres resolves Adelaide DST gaps and overlaps silently, so the application
  must validate local times itself (section 4) instead of relying on the database.
- **Not tested:** performance at realistic volume, lock-wait behaviour behind an open transaction, Prisma
  drift reporting (tables stay raw SQL), mixed hourly and nightly use of one resource in one table.

### 5.3 Other guards

Duplicate guard: partial unique index on `(occurrence_id, customer_id)` where
the reservation is live and `customer_id` is not null, plus
`(occurrence_id, normalised_email)` for customer-less bookings. Series guard:
partial unique on `(occurrence_id, series_id)` where live (mirrors the legacy
`uniq_bookings_instance_recurring_group`). Tenant integrity: composite
`(id, organisation_id)` foreign keys between scheduling tables, the pattern
`event_sessions` already uses.

## 6. Does the schema safely support each requirement?

### 6.1 Class enrolment and recurrence — **supported**

- Tables: offerings (recurrence columns copied from `sessions`: day, start date,
  end mode, end count, end date), occurrences, reservations, `series`,
  `series_pauses`.
- Mechanism: occurrence counter (5.1); series unique per occurrence; pauses with
  `until >= from`, as in `booking_recurrence_pauses`.
- Legacy comparison (`prisma/schema.prisma`, `add-recurring-pause-support.sql`):
  the legacy lineage is just `bookings.recurring_group_id`, with no row of its
  own; migration creates one `series` per distinct group id. Rows with
  `is_recurring = true` but no group id (older name/email-matched rows) have no
  lineage and must go to manual review.
- Risks: reconcile rules (cancel stale future occurrences unless paid or
  attended; reactivate in place) are engine behaviour, not schema, and must be
  re-implemented and re-tested; a court hold can now conflict with a hire
  booking at generation time (see 6.7).

### 6.2 One-to-one appointments — **supported**

- Tables: availability rules and exceptions on the provider resource, offering
  duration and buffers, `min_notice` / `max_advance`, reservation with a slot
  span, one hold per provider (plus a room if needed).
- Mechanism: exclusion constraint on the provider's hold including buffers.
- Risks: slot search must subtract holds from hours in local time across DST;
  multi-resource appointments depend on 5.2 working.

### 6.3 Restaurant table allocation — **supported with change**

- Tables: tables as resources with capacity and `min_party`; service periods as
  availability rules of a "service period" kind with a sitting interval;
  turn time by party size on the offering; holds.
- Mechanism: exclusion per table over the turn-time range. Party size against
  the table's range cannot be a cross-table `CHECK`; it is enforced in the
  repository and double-checked by a constraint trigger.
- Gap, deferred: **table combinations.** Several holds per reservation work, but
  which tables may be joined (adjacency, joined capacity) needs a
  `resource group` concept not in this outline. First release: staff pick the
  tables manually; automatic combining is a later phase. Also deferred:
  walk-ins and waitlist.

### 6.4 Hotel room date-range availability — **supported with change**

- Tables: room types as offerings; rooms as resources; reservation with a stay
  span; one hold per night range from check-in time to check-out time.
- Mechanism: the same exclusion constraint on the room, so double-booking a
  room is impossible; nights are local dates (section 4).
- Change: the first outline treated the stay as a `daterange`. It is a
  `tstzrange` from check-in time to check-out time, so same-day turnover works.
- Gap, deferred: **type-level inventory** (sell "any double", assign a room
  later) and **configurable overbooking**. Release one assigns a specific room
  at booking; pooled inventory needs a nightly counter model not designed here.

### 6.5 Facility hire — **supported**

- Tables: spaces as resources, customer-selected duration within offering
  min/max, price per slot or hour as integer cents, hold per booking.
- Mechanism: exclusion constraint (variable length is the reason the grid
  fallback is insufficient, see 5.2).
- Risks: pricing rules beyond a flat per-slot rate are out of scope.

### 6.6 Events-style reservations without duplicating Eve — **supported**

- Eve owns `events`, `event_sessions`, `event_ticket_types`, `event_orders`,
  `event_order_items`, `event_attendees`, promotion and access-code tables,
  notifications and inventory (`lib/events`, `packages/ticketing`, ADR 0007 and
  0013). The scheduling schema shares **no table, foreign key or ticket
  concept** with them.
- Scheduling's version: an `event_capacity` schedule's offering with an
  occurrence and a headcount counter; price must be zero (a core validation to
  add); no ticket types, fees, promotions, QR or check-in.
- Link, if ever wanted: an optional `external_ref_kind` / `external_ref_id` text
  pair on the offering pointing at an Events listing. It carries an id only: no
  foreign key, no join, no read of `event_*` tables from scheduling.
- Risk: pressure to add paid tickets here. The answer stays "use Events".

### 6.7 Multiple presets within one organisation — **supported with change**

- Tables: schedules (section 2), organisation-level resources,
  `offering_resources`, one holds table.
- Mechanism: because every offering's holds go to the same table keyed by
  `(organisation_id, resource_id)`, a court used for coaching classes (schedule A,
  occurrence holds) and for hire (schedule B, reservation holds) cannot be
  double-booked. This is the reason holds are separate from reservations.
- Change: generating a class occurrence onto a court already held by a hire
  booking must fail softly (skip and report a conflict), not abort the batch.
  Ongoing classes generated ten weeks ahead will block hire in those slots,
  which is the intended precedence but should be stated to the business.

### 6.8 Standalone and BrainBase deployments — **supported with change**

See section 8. The change is moving every host-specific foreign key out of the
shared migration. Evidence this is feasible: ADR 0007 already runs the
standalone Eve product on the shared database, `users` and `organisations`
tables, so the BrainBase host migration can simply add foreign keys, while a
truly separate standalone deployment supplies its own tenant and customer
tables and its own host migration with the same shared scheduling DDL.

## 7. Revised schema (proposal)

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `scheduling_settings` | `organisation_id` PK, `currency` | currency 3 upper letters; **no timezone column** (organisation timezone is host-owned, schedule override lives on the schedule) |
| `scheduling_schedules` | `id`, `organisation_id`, `preset_key`, `name`, `public_slug`, `terminology` jsonb, `cancellation_policy` jsonb, `timezone` NULL, `config_version` int, `archived_at` | `UNIQUE(organisation_id, public_slug)`; `preset_key` CHECK against the six keys; `UNIQUE(id, organisation_id)` |
| `scheduling_resources` | `id`, `organisation_id`, `kind`, `name`, `capacity`, `min_party` NULL, `active` | `capacity > 0`; organisation level, shared across schedules |
| `scheduling_offerings` | `id`, `organisation_id`, `schedule_id`, `name`, `type_key`, `colour_key`, `duration_minutes` NULL, `capacity` NULL, `price_cents`, `currency`, recurrence columns, buffers, `min_notice_minutes`, `max_advance_days`, `duration_by_party` jsonb NULL, `checkin_time` / `checkout_time` NULL, `external_ref_kind` / `external_ref_id` NULL, `archived_at` | composite FK to schedules `(schedule_id, organisation_id)`; `price_cents >= 0` |
| `scheduling_offering_resources` | `offering_id`, `resource_id`, `organisation_id` | PK `(offering_id, resource_id)`; composite FKs |
| `scheduling_availability_rules`, `scheduling_availability_exceptions` | owner (resource or offering), weekday or date range, local times, kind (`hours`, `service_period`) | time and date CHECKs mirroring `validateAvailabilityRule` |
| `scheduling_occurrences` | `id`, `organisation_id`, `offering_id`, `local_date`, `local_start_time`, `timezone`, `starts_at`, `ends_at`, `capacity`, `reserved_count`, `status` | `UNIQUE(offering_id, local_date, local_start_time)`; `CHECK(reserved_count BETWEEN 0 AND capacity)`; `ends_at > starts_at` |
| `scheduling_series`, `scheduling_series_pauses` | series: `id`, `organisation_id`, `offering_id`, `customer_id`, snapshot; pauses: `series_id`, `pause_from`, `pause_until`, `reason` | pause `until >= from`; replaces `recurring_group_id` + `booking_recurrence_pauses` |
| `scheduling_reservations` | `id`, `organisation_id`, `schedule_id`, `offering_id`, `occurrence_id` NULL, `starts_at` / `ends_at`, local fields, `timezone`, `customer_id` NULL, snapshot (`name`, `email`, `email_normalised`, `phone`), `contact_link`, `party_size`, `status`, `attendance`, `payment_status`, `price_cents`, `currency`, `series_id` NULL, `notes` | statuses CHECKed; partial unique guards (5.3); counter trigger (5.1); **no FK to a customer table** |
| `scheduling_resource_holds` | `id`, `organisation_id`, `resource_id`, `during` tstzrange, `reservation_id` NULL, `occurrence_id` NULL, `released_at` NULL | exactly one owner; the only exclusion constraint (5.2) |
| `scheduling_participants`, `scheduling_waitlist` | deferred | not in 2A |

## 8. Standalone deployability checklist (acceptance criterion)

A change fails review if any item is false.

| # | Check | How verified |
| --- | --- | --- |
| 1 | The shared scheduling DDL references no BrainBase table (`organisations`, `users`, `contacts`, `crm_contacts`, `bookings`, `sessions`, `session_instances`) | Static test over the shared migration files |
| 2 | `organisation_id` is TEXT with no FK to a host table in the shared DDL; the FK to the host tenant table is added by a per-host migration | Same static test; host migration reviewed separately |
| 3 | `customer_id` is plain nullable TEXT with **no database foreign key** in the shared DDL: it must hold `crm_contacts` uuids, LD Tennis `contacts` text ids and standalone ids. Integrity is the adapter's organisation-scoped lookup plus the booking snapshot | Same |
| 4 | Tenant integrity between scheduling tables uses composite `(id, organisation_id)` FKs inside the shared DDL | Real-Postgres test |
| 5 | The core and the repository contract suite run with no host import | Existing boundary test; contract suite on real Postgres |
| 6 | The same SQL file set applies to an empty database with only a host tenant table | CI job: empty Postgres + minimal host migration |
| 7 | All time and tenant context enters through ports (`Clock`, `TenantContext`) | Existing boundary test |
| 8 | No Next.js, Neon-specific or Vercel API in shared SQL adapters; the connection is injected | Import check on the adapter package |
| 9 | Branding, terminology and public slugs are data on the schedule, not code | Review |

## 9. Phase 2 sequence (updated)

- **2.0 Decisions and prerequisites** (no code): owner answers section 10. Done: the organisation timezone
  column is present (all NULL); `btree_gist`, exclusion constraints and the capacity trigger are rehearsed
  on a disposable branch. Still open: run the overbooking-detection query in production (the LD Tennis fix
  PR documents it).
- **Core update:** done (`e01fd83b`), no database.
- **2A — Schema:** shared DDL plus the BrainBase host migration, empty tables,
  idempotent, `NOT VALID` then `VALIDATE`, header with rollback, staged for the
  manual Neon console handoff, Preview first.
- **2B — Repositories:** SQL implementations passing the existing repository
  contract suite and the new concurrency, DST and exclusion tests on real
  Postgres.
- **2C — Read-only shadow:** copy LD Tennis into the new tables on a disposable
  branch and compare counts, enrolment, capacity, lineages and pauses; no
  writes to legacy tables, no dual writes.
- **2D — Module enablement:** `scheduling` capability seeded and enabled for one
  internal organisation only; first routes and UI behind `requireCapability`;
  the timezone settings surface and the unattended top-up route arrive here.
- **Later:** LD Tennis cutover as a separate, separately approved decision.

## 10. Outstanding approvals and open questions before 2A

1. ~~Approve the schedule-level preset model~~ **Approved and implemented** in the Phase 1 core (`e01fd83b`).
2. **Recommended, confirm:** `crm_contacts` is the authoritative customer table; LD Tennis
   resolves against `contacts` until a separately approved migration (section 3).
3. **Recommended, confirm:** a contact created by a public booking is `LEAD` (`crm_contacts`)
   / `status = 'lead'` (`contacts`). No existing value means "booked customer"; that gap is
   documented, not filled.
4. ~~Rehearse btree_gist and exclusion constraints~~ **Done** (`scheduling-phase2a-exclusion-rehearsal.md`, 17 of 17
   checks passed). Remaining untested: performance at volume, lock waits behind open transactions, Prisma drift reporting.
5. ~~Accept the first-release deferrals~~ **Approved** (section 11): table combining, pooled hotel inventory, waitlists.
6. Done in part: `crm_contacts` has 0 duplicate-email groups; `contacts` has 1 (case
   variants, LD Tennis). Choose find-or-create hardening: the host function (recommended, no CRM
   schema change) or an optional unique index on `crm_contacts` (a CRM rule change).
7. Approve: reuse `organisations.timezone` (exists in Production, all NULL) plus a schedule
   override, with the read-time `Australia/Adelaide` fallback, and no timezone on scheduling
   settings. The F.2A column is applied; only the setting surface (2D) is missing.
8. Separately, outside scheduling: the Events CRM sync can create duplicate contacts when two
   bookings by one new purchaser overlap (reproduced; findings section 1.5). Decide whether to fix.

## 11. Approved first-release limitations (deliberate; schema stays extensible)

These are deferred on purpose. The schema leaves room for each without a rewrite, and nothing speculative is built for them.

| Preset | First release does | First release does NOT do | Room left in the schema |
| --- | --- | --- | --- |
| Restaurant tables | A reservation is assigned **one table** (`resource_id`), chosen by party size (`min_party` to `capacity`) | Combine several tables for a large party; auto-assign across combinations | Holds are already one row per resource, so a reservation can later own several holds; the one-statement create writes N hold rows |
| Accommodation | The bookable thing is an **individually identified unit** (a specific room), held for `[check-in, check-out)` | Pooled room-type inventory ("2 of 5 Deluxe left"), overbooking policy, automatic unit assignment | Offerings can later reference a room type with a pool of units; no pooled counter is introduced now |
| All presets | Customers book directly; capacity refusals are final | Waitlists and automatic promotion | `waitlisted` already exists as a reservation status and the participants/waitlist tables are named but not created |

Consequence to state to customers and in onboarding: a restaurant cannot seat a party larger than its largest single table
until table combining ships, and a hotel cannot sell "any room of this type" until pooled inventory ships.
