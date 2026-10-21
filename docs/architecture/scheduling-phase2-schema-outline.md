# Scheduling Phase 2 — proposed schema and migration outline

**Documentation only. Nothing here has been run, applied or reviewed against a
database, and Phase 2 is not started or authorised.** Table and column names
are proposals for owner review.

## 1. Proposed tables (all `organisation_id TEXT NOT NULL REFERENCES organisations(id)`)

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `scheduling_settings` | One row per organisation: `preset_key`, `timezone`, `currency`, `terminology jsonb`, `cancellation_policy jsonb`, `config_version int` | PK `organisation_id`; `preset_key` CHECK against the six keys |
| `scheduling_resources` | Courts, tables, rooms, providers | `kind` CHECK; `capacity > 0`; `UNIQUE(organisation_id, id)` |
| `scheduling_offerings` | What can be booked (the generalised `sessions` + `session_types`) | `price_cents >= 0`, `currency`; recurrence stored as columns mirroring `sessions` (`recurrence_kind`, `day_of_week`, `start_date`, `end_mode`, `end_after_occurrences`, `end_date`) so the verified rule maths carries over; `archived_at` |
| `scheduling_availability_rules`, `scheduling_availability_exceptions` | Weekly hours, closures, overrides | time and date CHECKs mirroring `validateAvailabilityRule` |
| `scheduling_occurrences` | Dated instances (generalised `session_instances`) | `UNIQUE(offering_id, date, start_time)`; `capacity`, `reserved_count`, `CHECK (reserved_count BETWEEN 0 AND capacity)`; `status` CHECK |
| `scheduling_reservations` | The booking (generalised `bookings`) | `customer_id TEXT NOT NULL`; `span_kind` CHECK; `occurrence_id` or `(starts_at, ends_at)` or `(check_in, check_out)` per kind; `status`/`attendance`/`payment_status` CHECKs; `series_id` |
| `scheduling_series`, `scheduling_series_pauses` | Customer-joins-series lineage and pause windows (generalised `recurring_group_id`, `booking_recurrence_pauses`) | pause `until >= from` |
| `scheduling_participants` | Extra people on a reservation | later phase if needed |
| `scheduling_waitlist` | Waiting entries | later phase |

Rules carried over from the platform's own decisions: composite
`(organisation_id, …)` indexes first; every FK includes the organisation where
the parent key allows; `TEXT` ids (`gen_random_uuid()::text`); DATE columns cast
`::text` on read; money as integer cents with currency; idempotent, `NOT VALID`
then `VALIDATE` constraints, each with a documented rollback and header
(pattern of `scripts/add-events-order-legal-acceptance.sql`).

**Customer link.** `customer_id` is plain TEXT in the shared schema. BrainBase's
host migration adds the foreign key to `contacts(id)`; the standalone product
adds its own to its customers table. This keeps one engine schema and avoids a
cross-product foreign key.

## 2. Concurrency approach

The Neon HTTP client's `sql.transaction()` is non-interactive (the existing
archive code documents this), so "read capacity, then insert" is unsafe there
and is exactly the overbooking race found in `/api/tennis/book`. Recommended:

1. **Headcount (classes, events):** claim a place with one atomic statement:
   `WITH claimed AS (UPDATE scheduling_occurrences SET reserved_count = reserved_count + $n WHERE id=$id AND organisation_id=$org AND status='scheduled' AND reserved_count + $n <= capacity RETURNING id) INSERT … SELECT … FROM claimed`.
   Zero rows means `capacity_exceeded`. Cancels decrement in the same way.
   Row lock plus `CHECK` makes it correct under concurrency with no
   interactive transaction.
2. **Exclusive resource over time or nights (appointments, hire, hotel,
   tables):** a PostgreSQL exclusion constraint over
   `(organisation_id, resource_id, tstzrange(starts_at, ends_at))` (or
   `daterange(check_in, check_out)` for stays) `WHERE status` is live, using
   `btree_gist`. A conflicting insert fails with a constraint error mapped to
   `resource_conflict`. **To verify first:** that `btree_gist` is available on
   the Neon plan, on a disposable branch.
3. **Duplicate guard:** unique partial index on
   `(occurrence_id, customer_id) WHERE status <> 'cancelled'`, replacing the
   email-matching read.
4. The repository contract suite already contains the sequential and concurrent
   cases; the SQL adapter must pass it on real Postgres (the repository has a
   Docker proof harness precedent in `tests/postgres-proof`, run sequentially).

## 3. Migration sequence (each step independently shippable, staged handoff)

- **2A — Schema.** Additive migration creating the tables above, empty. Staged
  SQL with pre-check, verification and rollback; applied by hand in the Neon
  console (the established production path), Preview first. Nothing reads or
  writes them yet.
- **2B — Repositories.** SQL implementations of `ReservationRepository` and
  `ResourceAvailability` plus offering/occurrence persistence in
  `lib/scheduling/adapters/brainbase`, passing the contract suite on a
  disposable Postgres. Still no route or UI.
- **2C — Read-only shadow.** A script (run against a disposable branch first)
  that copies LD Tennis data into `scheduling_*` and compares counts, per-instance
  enrolment, capacity, recurring lineages and pauses with the legacy tables. No
  writes to legacy tables, no dual writes.
- **2D — Module enablement.** Seed the `scheduling` capability row; enable for
  one internal organisation only; first routes and UI behind `requireCapability`.
- **Later — LD Tennis cutover.** A per-organisation switch with a freeze window
  and one-shot backfill, decided separately. Legacy tables remain the source of
  truth until then; dual writes are not planned.

## 4. Compatibility strategy

Legacy tables, routes, URLs, labels and the `ld-tennis` nav gate stay until a
cutover is approved. The compatibility mappers in
`lib/scheduling/compatibility/tennis` define the verified translation
(recurrence rules, booking statuses) and are extended, with tests, as each field
is migrated. Statuses the core cannot represent (`reschedule_requested`) and
free-text `attendance_status` must have an explicit mapping decision before 2C.
`/dashboard/sessions` keeps working throughout; a new module UI would live
elsewhere and the old URL redirects only at cutover.

## 5. Unresolved questions and recommended defaults

| # | Question | Recommended default |
| --- | --- | --- |
| 1 | New tables for everything, or evolve legacy in place? | New `scheduling_*` tables (decided in the brief); legacy untouched |
| 2 | Is the missing automatic top-up for ongoing sessions real in production? | Verify against production first; if real, fix in the legacy stack separately (it is a live defect), not folded into this work |
| 3 | Timezone source | `organisations.timezone`, default `Australia/Adelaide`; engine uses `Clock.today(tz)` |
| 4 | Customer link for public bookings | Find-or-create a CRM contact by normalised email at booking time (new behaviour; legacy creates none) |
| 5 | Existing bookings with no email | Do not auto-match; import as customer-less legacy rows flagged for manual review |
| 6 | Pricing, deposits, online payment in scheduling | Out of scope until after 2D; reuse the payments foundation then |
| 7 | Calendar sync (Google/Outlook), reminders | Out of scope; reminders reuse the notification port later |
| 8 | Roles | Reuse BrainBase roles via the adapter mapping (viewer view; manager and above manage); analyst denied |
| 9 | Tenant resolution on the public surface | Route slug resolved server-side, never an env var or request field |
| 10 | Waitlists and participant lists | Defer; schema allows adding without change to existing tables |
| 11 | Standalone product's identity and tenancy | Separate decision after the BrainBase module works; core is ready for it |
| 12 | Where preset version lives | `scheduling_settings.config_version`, bumped when a preset definition changes meaning |
