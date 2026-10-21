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

**0.1 Timezones.** Organisations support configurable IANA timezones.
Resolution order, evaluated by the host adapter and passed in through
`TenantContext.timezone`: schedule timezone, else scheduling settings
timezone, else the organisation's canonical timezone, else `Australia/Adelaide`.
The fallback is applied **at read time, never by backfilling** existing
organisations (the F.2A script deliberately adds a nullable column with no
default, and no existing row is modified). Status caveat: the F.2A script
(`scripts/add-organisations-timezone.sql`) exists, but whether it has been
applied to Production was not checked here. Wiring note: the containment test
`organisationTimezoneSchema.test.ts` fails if any file under `app/api` or `lib`
mentions `organisations.timezone` / `org.timezone`. The Phase 2 adapter must be
the deliberate, reviewed change that reads it, and that test is updated in the
same PR with a stated reason (it is a "nothing consumes this yet" guard, not a
permanent rule). Until then the adapter's tenant builder keeps taking the
timezone as an input.

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
  └─ scheduling_settings        1 row: default timezone, default currency, defaults only
       └─ scheduling_schedules  n rows: preset_key, name, public_slug, terminology,
            │                   cancellation_policy, timezone?, config_version
            └─ scheduling_offerings   (belong to exactly one schedule)
  └─ scheduling_resources       organisation-level; shared by offerings across schedules
       └─ scheduling_offering_resources  (which resources an offering may use)
```

Initial onboarding exposes one schedule per organisation, created from the
chosen preset. Nothing in the schema limits it to one.

### Phase 1 core changes required (described only; no code changed)

| Phase 1 item | Assumption | Minimal change |
| --- | --- | --- |
| `OrganisationSchedulingConfig` (`types.ts`) | One `presetKey`, `terminology` and `cancellationPolicy` per organisation | Split into `SchedulingSettings` (organisation id, nullable timezone, currency, default policy) and `ScheduleConfig` (id, organisation id, `presetKey`, name, `terminology`, `cancellationPolicy`, nullable timezone, config version) |
| `defaultConfigForPreset` (`presets.ts`) | Returns an organisation config | Returns a `ScheduleConfig`; takes a schedule name and slug |
| `validateOrganisationConfig` (`validation.ts`) | Validates preset, terminology and policy as one record | Becomes `validateScheduleConfig`; a separate small `validateSettings` for timezone and currency; both check the IANA name with a pure `isIanaTimezone` using `Intl.DateTimeFormat` |
| `resolveTerminology(presetKey, overrides)` | None: it already takes the preset as an argument | Unchanged; callers pass the schedule's preset and overrides |
| `validateReservationForPreset(r, preset)` | None: preset is an argument | Unchanged; the caller resolves the preset through reservation, offering, schedule |
| `Offering` | No schedule link | Add `scheduleId`, `bufferBeforeMinutes`, `bufferAfterMinutes`, `minNoticeMinutes`, `maxAdvanceDays`; add a duration-by-party-size rule used by restaurants |
| `Reservation` | No snapshot, no instants | Add `scheduleId`, a `customerSnapshot` (name, email, normalised email, phone), `timezone`, `startsAt`/`endsAt` instants; `customerId` becomes nullable |
| `TimeSpan` slot / stay | Local fields only | Carry the timezone and the derived instants alongside the local fields |
| `CustomerProvider.findOrCreate` | Matching rule undocumented | Document and test the section 3 rule; nothing in the port changes |
| `PRESETS`, boundary tests, `TenantContext` | None | Unchanged. `TenantContext.timezone` stays the *resolved* timezone |
| `event_capacity` | Price implied 0 | Add the validation rule that an events-style offering has a zero price (section 6.6) |

## 3. Public booking, CRM matching and snapshots

Customer table used in BrainBase: the Phase 1 mapping targets `contacts` (the
LD Tennis CRM, `UNIQUE(organisation_id, email)`). **Open question:** the
platform also has `crm_contacts` (classification, used by Events sync). Which is
the scheduling customer table for non-tennis organisations needs an owner
decision before 2B.

Find-or-create (all steps scoped to the tenant's organisation):

1. Normalise the email: trim and lowercase only. Do **not** strip dots or
   `+tag` suffixes; those are distinct mailboxes to us. Reject malformed input.
2. No email → `customer_id` stays NULL. The reservation is customer-less and
   carries its snapshot; staff may link it manually later. A name is never used
   to find or merge a customer, in any path.
3. Email present → look up `WHERE organisation_id = $org AND LOWER(TRIM(email)) = $norm`.
   Use the lower-cased lookup because the existing unique constraint is
   case-sensitive, so legacy rows may hold mixed case.
4. Not found → `INSERT … (organisation_id, name, email = normalised, phone,
   status = 'lead') ON CONFLICT (organisation_id, email) DO NOTHING RETURNING id`;
   if nothing returns, re-select (another request created it first). This is
   race-safe for new addresses. The residual gap is a legacy mixed-case row
   racing a new lower-case insert, which the case-sensitive index cannot see;
   a functional unique index on `(organisation_id, lower(email))` closes it but
   needs a duplicate audit first, so it is a separately approved hardening.
5. Found → use it as is. **Never overwrite** the contact's name or phone from
   public input; the person who types an email is not authenticated.
6. Every reservation stores a snapshot captured at booking time: name, email
   (as typed), normalised email, phone, plus `contact_link` (`matched`,
   `created`, `none`). Later contact edits do not rewrite booking history.
   Comparing snapshot name with the contact's current name lets staff spot a
   different person on a shared address without any automatic action.

The new-contact status (`lead`, matching `/api/lead`) is an assumption for
approval; in LD Tennis "Squad" means `active`, so a booking alone must not make
someone a squad member.

## 4. Timezones and DST

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

Because the counter is maintained by the database rather than by each code
path, it cannot drift when a path forgets it, which is the hazard the legacy
system's many cancel paths (archive, pause, remove-future, single cancel,
reconcile) illustrate. This is the design for the new tables. The live LD Tennis
fix is evaluated separately and has no counter column; the two should be
consistent in discipline (database-enforced, one rule for every writer) but not
in mechanism. **Unproven:** to be demonstrated on a disposable Neon branch with
a real concurrent test before 2B depends on it.

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

**Verification gate:** `btree_gist` availability on the Neon plan is unverified
(no `EXCLUDE` constraint exists in this repository yet). If unavailable, the
fallback is a slot-grid row per `(resource, slot)` or per `(room, night)` with a
plain unique key; it works for fixed grids and for hotels but cannot express
variable-length hire, so hire would then need a locking function. Decide after
the check.

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
| `scheduling_settings` | `organisation_id` PK, `timezone` NULL, `currency`, `default_cancellation_policy` jsonb | IANA name validated on write; currency 3 upper letters |
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
| 3 | `customer_id` is plain nullable TEXT; the host adds its own FK (`contacts` for BrainBase) | Same |
| 4 | Tenant integrity between scheduling tables uses composite `(id, organisation_id)` FKs inside the shared DDL | Real-Postgres test |
| 5 | The core and the repository contract suite run with no host import | Existing boundary test; contract suite on real Postgres |
| 6 | The same SQL file set applies to an empty database with only a host tenant table | CI job: empty Postgres + minimal host migration |
| 7 | All time and tenant context enters through ports (`Clock`, `TenantContext`) | Existing boundary test |
| 8 | No Next.js, Neon-specific or Vercel API in shared SQL adapters; the connection is injected | Import check on the adapter package |
| 9 | Branding, terminology and public slugs are data on the schedule, not code | Review |

## 9. Phase 2 sequence (updated)

- **2.0 Decisions and prerequisites** (no code): owner answers section 10;
  confirm whether the F.2A organisation timezone column is applied in
  Production; run the overbooking-detection query; disposable-branch check of
  `btree_gist`, trigger-maintained counters and interactive-transaction support.
- **Core update (small PR):** the Phase 1 core changes in section 2, with tests;
  still no database.
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

1. Approve the schedule-level preset model (section 2) over a preset on each offering.
2. Which table is the scheduling customer table for non-tennis organisations:
   `contacts` or `crm_contacts`? (section 3)
3. Status given to a contact created by a public booking (`lead` assumed).
4. Approve a disposable-branch verification of `btree_gist`, the counter trigger
   and interactive transactions (this document used no database).
5. Accept the first-release deferrals: automatic table combining, pooled hotel
   inventory and overbooking policy, waitlists.
6. A duplicate-email audit of `contacts` so the functional unique index can be
   proposed.
7. Confirm where an organisation sets its timezone (scheduling settings in 2D,
   or the organisation settings that F.2A anticipates).
