# Scheduling: CRM customer table and timezone configuration (findings)

Investigated 2026-10-21 against `main` at `1f28c76e`. Live-schema facts come from
read-only catalog and aggregate queries on a disposable branch of Production
(`temp/ld-booking-capacity-guard-proof-20261021`, a copy taken 2026-10-21). No
names, emails or phone numbers were read. Nothing was modified. Counts are for
that snapshot and will drift.

## 1. CRM: `contacts` versus `crm_contacts`

### 1.1 What the two tables are

| | `contacts` | `crm_contacts` |
| --- | --- | --- |
| Described in the repo as | "the separate, vertical-specific `contacts` table (LD-Tennis/coaching)" (`lib/crm/eventSync.ts` header; `tests/containment/crmContactsSchemaAlignment.test.ts`) | "the canonical CRM contact table" (generic CRM) |
| `id` | `text`, default `gen_random_uuid()::text` | `uuid`, default `gen_random_uuid()` |
| Organisation scope | `organisation_id text NOT NULL`, FK to `organisations` | `organisation_id text NOT NULL`, FK to `organisations` |
| Name | single `name text NOT NULL` | `first_name`, `last_name` both `NOT NULL` |
| Email / phone | nullable `text` each | nullable `text` each |
| Uniqueness | `UNIQUE (organisation_id, email)` (case-sensitive; NULLs never collide) | **no unique constraint on email or phone**; only `UNIQUE (id, organisation_id)` (for composite foreign keys) and the primary key |
| Lifecycle field | `status text NOT NULL DEFAULT 'lead'`, **no CHECK constraint** | `classification text NULL` with `CHECK (classification IS NULL OR classification IN ('CLIENT','LEAD','EVENT_CONTACT','SUPPLIER','PARTNER','OTHER'))` |
| Referenced by | `contact_journal` (FK, cascade) | `crm_deals`, `crm_activities`, `commercial_customers`, `commercial_suppliers`, `event_orders` (composite `(crm_contact_id, organisation_id)` FK, `ON DELETE SET NULL (crm_contact_id)`) |
| Triggers | none | none |
| Access gate | `requireRole` only, **no capability check** (`app/api/contacts/*`) | `requireCapability(org, 'crm')` (`app/api/crm/contacts/route.ts:11,58`) |
| Vertical-only columns | `address`, `age`, `program`, `session_times`, `next_action`, `last_contacted_at` | `company_id`, `job_title`, `created_by` |

`contacts.guardian_name`, `guardian_phone` and `session_id` are written by
`app/api/contacts/[id]/route.ts` and by the CRM alignment test's description,
but **do not exist** in the live schema (the live column list has none of them).
Declared in neither Prisma nor any script; the route tells the user to run a
manual `ALTER TABLE`. Not scheduling's concern, but it confirms `contacts` is the
less-governed of the two.

### 1.2 Usage in the snapshot (aggregate counts)

| Organisation | `contacts` rows | `crm_contacts` rows | `crm` capability enabled |
| --- | ---: | ---: | --- |
| `ld-tennis` | 5 | 0 | yes |
| `brainbase` | 0 | 3 | yes |
| `school-test-organisation` | 0 | 10 | yes |
| 3 other organisations | 0 | 0 | not listed |

So the tables are **disjoint in practice**: each organisation uses one, never
both. `contacts` is LD Tennis only. `crm_contacts` is used by the other two
active organisations and is where Events, Commercial customers/suppliers and
CRM deals/activities attach.

`contacts.status` live values: `active` 3, `lead` 2. Valid values per
`app/api/contacts/[id]/route.ts:17`: `lead`, `contacted`, `active`, `inactive`
(application-enforced on PATCH only; the create route `app/api/contacts/route.ts`
accepts any `status`). In LD Tennis, `active` means "in the squad"
(`ConvertToSquadButton`, `app/api/leads/[id]/convert/route.ts`).

### 1.3 Relationship between the tables

None in data: no foreign key, no shared id, no sync in either direction. The
separation is deliberate and guarded: `lib/crm/eventSync.ts` "must never import
from, or write to" `contacts`, and `crmContactsSchemaAlignment.test.ts` guards the
vertical-only fields from leaking into `crm_contacts`. Writers of `contacts`:
`/api/contacts`, `/api/contacts/[id]`, `/api/lead` (public enquiry, creates
`status = 'lead'`, `ON CONFLICT DO NOTHING`), `/api/leads/[id]/convert`
(promotes to `active`), `/api/admin/client-data/contacts/[id]`. Writers of
`crm_contacts`: `/api/crm/*`, Events sync (`lib/crm/eventSync.ts`,
classification `EVENT_CONTACT` for brand-new rows only, never reclassifies an
existing contact), Events backfills, Commercial links.

### 1.4 Duplicate and case risk (counts only)

- `contacts`: 1 group of rows whose emails are equal after `lower(btrim())` but
  differ as stored (2 rows), and 1 stored email that is not already normalised.
  The unique constraint is case-sensitive and cannot see this. `ON CONFLICT
  (organisation_id, email)` therefore does **not** dedupe case variants; a lookup
  on `lower(btrim(email))` must come first.
- `crm_contacts`: 0 duplicate-email groups, 0 non-normalised emails, 0 NULL
  emails today. No constraint prevents them, though: there is no unique key to
  `ON CONFLICT` on at all.

### 1.5 A defect found in the existing Events sync (outside this task; reported)

`syncEventOrderContact` finds-or-creates in a **single statement**: a CTE takes
`pg_advisory_xact_lock`, then looks up and inserts in the same statement. Under
READ COMMITTED the statement's snapshot is taken at its start, so a caller that
waited on the lock does not see the row the previous holder committed and inserts
again. Reproduced on a scratch Postgres 16 container: one caller held the lock
for 3 seconds inside its statement while 5 more started and queued; **6 contacts
were created for one email**. The same lock followed by a **separate** lookup
statement (a PL/pgSQL function) created exactly 1. The repository's own proof
(`scripts/tests/verify-events-crm-sync-concurrency.sh`) passes because its 10
`psql` processes do not overlap inside a statement of about a millisecond. The
live window is narrow (two simultaneous bookings by one new purchaser), and the
effect is a duplicate CRM contact, not data loss. Scheduling must not copy that
SQL shape (section 1.7). Fixing Events sync is a separate change.

### 1.6 Recommendation

**Authoritative CRM customer record for scheduling: `crm_contacts`** for every
organisation except the LD Tennis cutover case below.

Reasons: it is the platform's generic CRM (capability-gated, one governed
vocabulary, used by Events, Commercial, deals and activities, 2 of the 3 active
organisations); `contacts` is a self-described vertical table with no capability
gate, an unconstrained status, and drifted columns. It matches the owner's
direction (reuse the authoritative CRM table, no new CRM subsystem).

LD Tennis exception, not a second design: LD Tennis's customers (its "squad") are
in `contacts` and have **no** `crm_contacts` rows. Until a separately approved
decision moves them, the BrainBase adapter's `CustomerProvider` for that tenant
resolves against `contacts`. This costs nothing in the shared schema: the
reservation stores `customer_id` as plain TEXT (fits a text id and a uuid id) and
a booking-time snapshot; which table the id points at is a host adapter detail.
Standalone deployability is unchanged: `@scheduling/core` sees only `CustomerRef`;
BrainBase maps it to `crm_contacts` (or `contacts` for LD Tennis); a standalone
host supplies its own customer store through the same port. Scheduling creates
no CRM tables.

Referential integrity: `crm_contacts` offers `UNIQUE (id, organisation_id)` for a
tenant-safe composite foreign key (as `event_orders` uses), but the id is `uuid`
whereas `customer_id` must also carry `contacts` text ids and standalone ids. So
the shared schema keeps `customer_id` as a soft link (no database foreign key),
enforced by the adapter (organisation-scoped lookup plus the `contactToCustomerRef`
tenant assertion) and made safe for history by the snapshot. A host that wants a
hard link can add a host-owned column later; this is not required for 2A.

### 1.7 Public booking: classification and find-or-create

**Matching:** organisation-scoped, `lower(btrim(email))` only; never by name;
a booking with no email is customer-less (snapshot only). A matched contact is
used as is and **never** updated from public input (no name, phone or
classification overwrite).

**Classification for a contact created by a public booking.**
- On `crm_contacts`: `LEAD`. It is the existing value that says "known person, relationship
  not confirmed by staff", which is what an unauthenticated form submission is. It mirrors
  LD Tennis, where the public enquiry creates `status = 'lead'` and only staff promote to
  `active`. `CLIENT` would assert a relationship nobody has confirmed. `EVENT_CONTACT` is
  Events-origin-specific. `OTHER` carries no meaning. NULL is permitted by the CHECK, but
  hides the person from classification filters.
- On `contacts` (LD Tennis): `status = 'lead'`, exactly as `/api/lead` does today. A
  booking alone must never produce `active` (squad).
- **Documented gap, not filled:** there is no value meaning "booked customer / attendee"
  and no first-class "source" field (Events records source in an informal `notes` marker,
  `Events / Event Booking`). Scheduling should write a similar marker (`Scheduling / Public
  Booking`) and nothing else. If the owner wants a distinct classification, that is a CHECK
  constraint change on `crm_contacts` and is **not proposed here**.

**Race-safe find-or-create on `crm_contacts`.** There is no unique key, so
`ON CONFLICT` is unavailable and the Events single-statement shape is unsafe
(1.5). Two correct options:

1. **Preferred, no CRM schema change:** a host-owned database function (part of
   the BrainBase host migration, not the shared DDL) that takes
   `pg_advisory_xact_lock(hashtext(org), hashtext('email:' || norm))`, then runs the
   lookup as a **separate statement** inside the function, then inserts if absent.
   Each statement in a PL/pgSQL function takes a fresh snapshot, so the waiter sees the
   committed row. Verified on the scratch container (exactly 1 contact for 6 overlapping
   callers) and it is the same lock-then-count shape proven on Neon for the booking
   capacity guard. It is called as one statement from the Neon HTTP driver.
2. **Optional hardening, needs approval:** a unique index on
   `(organisation_id, lower(btrim(email))) WHERE email IS NOT NULL` on `crm_contacts`.
   There are 0 duplicates today, but this changes CRM schema and rules for every
   organisation (a family sharing an address would be blocked from separate
   contacts), so it is a product decision, not a scheduling detail.

For LD Tennis (`contacts`): look up `lower(btrim(email))` first (case-insensitive),
then `INSERT ... ON CONFLICT (organisation_id, email) DO NOTHING RETURNING id`, then
re-select if nothing returned. The residual gap (a legacy mixed-case row racing a new
lower-case insert) is the same advisory-lock function pattern, or retire the gap with a
functional unique index after cleaning the 1 existing duplicate group.

## 2. Timezone configuration

### 2.1 What exists

| Where | Fact |
| --- | --- |
| `organisations.timezone` | `text NULL`, **no default**. Present in the Production-derived schema (the F.2A script, `scripts/add-organisations-timezone.sql`, has been applied). **All 6 organisations have NULL.** Prisma: `Organisation.timezone String?` (`prisma/schema.prisma:18`). |
| `users.timezone` | `text NULL DEFAULT 'Australia/Adelaide'` (7 users, all Adelaide). A per-user display preference edited on the profile page (`ProfileClient.tsx`, `/api/account/profile`). Not a business timezone. |
| `events.timezone` | `text NOT NULL`, no default; validated as an IANA name by `isValidTimezone` using `Intl.supportedValuesOf('timeZone')` (`packages/ticketing/src/validation.ts:46`). 4 events, all `Australia/Adelaide`. |
| Application code | **Nothing reads `organisations.timezone`.** `tests/containment/organisationTimezoneSchema.test.ts` ("no route reads or writes organisations.timezone") fails if any file under `app/api` or `lib` contains `organisations.timezone`, `organisation.timezone` or `org.timezone`. |
| Hard-coded Adelaide | `app/dashboard/page.tsx:93,121` (SQL `AT TIME ZONE 'Australia/Adelaide'`), `lib/assurance/deadlineRules.ts:28` (`DEFAULT_ASSURANCE_TIME_ZONE`), `lib/dashboard/greeting.ts`, `app/api/weather/route.ts`, `lib/commercial/dates.ts` convention. |
| Server time | Vercel runs in UTC (the F.2A script says so). Several tennis routes compute "today" in server-local time (Phase 1 baseline finding 5). |

### 2.2 Recommendation (least disruptive, no duplicate settings)

1. **Organisation level: reuse `organisations.timezone`.** It already exists in
   Production, nullable, with the right semantics ("canonical business timezone",
   IANA names, not offsets). Do **not** add a timezone column to scheduling's
   settings. The previous outline's `scheduling_settings.timezone` is removed.
2. **Schedule level: one nullable `timezone` on the schedule** (overrides the
   organisation; for a business with, say, a venue in another state).
3. **Resolution order (read time, in the host adapter):** schedule timezone, else
   `organisations.timezone`, else `Australia/Adelaide`. The fallback is a constant in the
   adapter, applied on read. **No backfill:** all 6 organisations are NULL today and the
   fallback already yields the intended answer; writing the value would discard the
   "not configured" signal that the F.2A design relies on. A settings UI (2D) lets an
   organisation set its own.
4. **Standalone:** the organisation-level timezone belongs to the host's tenant store
   (BrainBase: `organisations.timezone`; standalone: its own tenant table) and arrives
   through `TenantContext.timezone`. The shared DDL carries only the schedule override and
   the per-reservation snapshot, so it needs no host table.
5. **Validation:** reuse the existing approach (`Intl.supportedValuesOf('timeZone')`),
   exposed as one pure helper in `@scheduling/core` (`isIanaTimezone`), not a second
   copy. Reject offsets and abbreviations (`+10:30`, `ACST`).
6. **Snapshots:** every occurrence and reservation stores `local_date`,
   `local_start_time`, `timezone` (the one used) and the derived `starts_at` / `ends_at`.
   History is immutable: changing a schedule's or organisation's timezone re-derives
   **future, not-yet-started** occurrences only, never booked-and-past rows, and never
   rewrites a reservation's stored timezone.
7. **DST (Adelaide, `Australia/Adelaide`, UTC+9:30 winter / +10:30 summer; changes on the
   first Sunday of April and October):**
   - Recurrence expands in local time, so a 16:00 class stays 16:00 across a change.
   - Spring forward: local times that do not exist (02:00 to 03:00 on the October changeover)
     are rejected for staff-entered slots; generated occurrences move forward by the gap and
     are flagged.
   - Fall back: local times that occur twice (02:00 to 03:00 on the April changeover)
     resolve to the earlier instant and store the offset used.
   - Durations are measured on instants (a 60-minute class is 60 real minutes);
     hotel nights are local calendar dates.
   - Rules always come from the timezone database (`Intl` in the core, the database's
     `pg_timezone_names` for write-time validation), never constants.
   - Tests must cover the two Adelaide changeovers and a zone that does not observe DST.

### 2.3 What the Phase 2 adapter must change in the existing guard test

`organisationTimezoneSchema.test.ts` is a "nothing consumes this yet" guard, not a
permanent rule. The PR that makes the BrainBase adapter read the column must, in the
same PR: (a) update the "No application consumer wired yet" block to allow exactly one
reviewed consumer file (the adapter's timezone resolver) and assert there is exactly one;
(b) keep the script-shape assertions untouched (they prove the migration stays a single
nullable column); (c) state the reason in the commit message. Until then the Phase 1
adapter keeps taking the timezone as an input and contains no literal match for the
forbidden patterns (a Phase 1 containment test already passes with that wording).

**No production migration is proposed.** The column exists; the fallback is read-time
code; the settings UI arrives with 2D.

## 3. Decisions for the owner

1. Confirm `crm_contacts` as the authoritative customer table, with LD Tennis resolving
   against `contacts` until its separately approved migration.
2. Confirm `LEAD` for a contact created by a public booking (and `status = 'lead'` on
   `contacts`), accepting that no "booked customer" value exists, or ask for a distinct
   classification (a CHECK change, not proposed here).
3. Choose find-or-create hardening: the host function (no CRM schema change, recommended)
   or the optional unique index (a CRM rule change).
4. Approve removing `timezone` from scheduling settings in favour of
   `organisations.timezone` plus a schedule override.
5. Separately: the Events sync duplicate-contact race (1.5) is real but narrow; decide
   whether to fix it (outside scheduling).
