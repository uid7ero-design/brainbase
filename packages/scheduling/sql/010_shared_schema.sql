-- Scheduling & Bookings — Phase 2A: shared database foundation (version 2a.1)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Do not run against
-- Production without the approvals listed in docs/architecture/scheduling-phase2a-migration-package.md.
--
-- WHAT: 13 new tables, 11 functions and 16 triggers, all named scheduling_*. Nothing existing is
--       altered, renamed, dropped or read. No row is inserted except the version marker.
--
-- SHARED DDL (standalone-ready): this file references NO host table. organisation_id is TEXT
--   with no foreign key; customer_id is plain TEXT with no foreign key (it holds a
--   crm_contacts uuid, an LD Tennis contacts id, or a standalone host's id). Host-specific
--   foreign keys live in a per-host file (scripts/scheduling/110_brainbase_host.sql).
--   Every id is unique PER TENANT (primary key is (organisation_id, id)), so ids imported from
--   different sources can never collide across tenants. Tenant integrity between scheduling
--   tables is enforced by composite (id, organisation_id) foreign keys, so a row can never
--   point at another tenant's row.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS / CREATE OR REPLACE throughout. Re-running on an
--   existing install changes nothing. (A later version that must change a constraint on an
--   existing table ships as its own numbered file; this file never ALTERs.)
--
-- EXECUTION: one transaction (BEGIN/COMMIT below), so it applies completely or not at all.
--   Safe in the Neon SQL Editor and in psql -f. lock_timeout makes it fail fast instead of
--   queueing behind a long transaction; it touches only tables that do not exist yet.
--
-- ROLLBACK: packages/scheduling/sql/090_rollback.sql
--
-- REQUIRES: PostgreSQL 14+ (CREATE OR REPLACE TRIGGER), the btree_gist extension, and a role
--   allowed to CREATE EXTENSION (btree_gist is a trusted extension on Neon). The rehearsal
--   (docs/architecture/scheduling-phase2a-exclusion-rehearsal.md) installed it without
--   owner help.
--
-- CONCURRENCY MODEL (all database-side, so it holds for every writer and works over the Neon
--   HTTP driver, which has no interactive transactions):
--   * Headcount capacity: BEFORE INSERT trigger on scheduling_reservations takes
--     pg_advisory_xact_lock(per occurrence), then counts live headcount under READ COMMITTED
--     (a fresh snapshot per statement). Same pattern as the LD Tennis capacity guard.
--     Refusal: SQLSTATE SCCAP.
--   * Exclusive resources: one EXCLUDE USING gist constraint on scheduling_resource_holds
--     (organisation_id, resource_id, during &&) WHERE released_at IS NULL. Refusal: 23P01.
--   * A reservation holds EITHER an occurrence (headcount) OR a resource (exclusive), never
--     both (CHECK), so the two lock families are disjoint and cannot form a cycle.
--
-- CUSTOM SQLSTATE CODES raised by this file (mapped to domain errors by the adapter):
--   SCCAP capacity exceeded      SCISO unsafe isolation level   SCCLS occurrence not open
--   SCWIN window mismatch        SCRES resource inactive        SCLIF illegal lifecycle change
--   SCIMM immutable column       SCREA hold reactivation        SCHLD exclusive booking has no hold

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── Extension ───────────────────────────────────────────────────────────────
-- Named schema keeps the operator classes out of public. If btree_gist is already installed
-- (in any schema) this is a no-op.
CREATE SCHEMA IF NOT EXISTS scheduling_ext;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA scheduling_ext;

-- ─── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scheduling_is_timezone(tz text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT tz IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz)
$$;

CREATE OR REPLACE FUNCTION scheduling_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─── Version marker ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduling_schema_migrations (
  version     text PRIMARY KEY,
  description text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Organisation-wide settings (one row per organisation) ──────────────────
-- No timezone column on purpose: the organisation timezone is host-owned (BrainBase:
-- organisations.timezone). Only the per-schedule override lives here.

CREATE TABLE IF NOT EXISTS scheduling_settings (
  organisation_id text PRIMARY KEY CHECK (btrim(organisation_id) <> ''),
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Schedules: one business line, carries the preset ───────────────────────

CREATE TABLE IF NOT EXISTS scheduling_schedules (
  id                  text NOT NULL,
  organisation_id     text NOT NULL CHECK (btrim(organisation_id) <> ''),
  name                text NOT NULL CHECK (btrim(name) <> ''),
  preset_key          text NOT NULL CHECK (preset_key IN
                        ('classes_coaching','appointments','restaurant_tables','accommodation','resource_hire','event_capacity')),
  preset_version      integer NOT NULL CHECK (preset_version >= 1),
  public_slug         text CHECK (public_slug IS NULL OR public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  terminology         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terminology) = 'object'),
  cancellation_policy jsonb NOT NULL CHECK (jsonb_typeof(cancellation_policy) = 'object'),
  timezone            text CHECK (timezone IS NULL OR scheduling_is_timezone(timezone)),
  archived_at         timestamptz,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_schedules_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_schedules_slug_uk UNIQUE (organisation_id, public_slug)
);

-- ─── Resources: organisation level, shared across schedules ─────────────────

CREATE TABLE IF NOT EXISTS scheduling_resources (
  id              text NOT NULL,
  organisation_id text NOT NULL CHECK (btrim(organisation_id) <> ''),
  kind            text NOT NULL CHECK (kind IN ('court','table','room','practitioner','equipment','space')),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  capacity        integer NOT NULL CHECK (capacity > 0),
  min_party       integer CHECK (min_party IS NULL OR (min_party >= 1 AND min_party <= capacity)),
  active          boolean NOT NULL DEFAULT true,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_resources_pk PRIMARY KEY (organisation_id, id)
);

-- ─── Offerings: belong to exactly one schedule ──────────────────────────────

CREATE TABLE IF NOT EXISTS scheduling_offerings (
  id                    text NOT NULL,
  organisation_id       text NOT NULL,
  schedule_id           text NOT NULL,
  name                  text NOT NULL CHECK (btrim(name) <> ''),
  type_key              text,
  colour_key            text,
  duration_minutes      integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  capacity              integer CHECK (capacity IS NULL OR capacity > 0),
  price_cents           integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  start_time            time,
  recurrence_kind       text NOT NULL DEFAULT 'none' CHECK (recurrence_kind IN ('none','weekly')),
  recurrence_day_of_week smallint CHECK (recurrence_day_of_week IS NULL OR recurrence_day_of_week BETWEEN 0 AND 6),
  recurrence_start_date date,
  recurrence_end_mode   text CHECK (recurrence_end_mode IS NULL OR recurrence_end_mode IN ('ongoing','after_occurrences','on_date')),
  recurrence_end_count  integer CHECK (recurrence_end_count IS NULL OR recurrence_end_count > 0),
  recurrence_end_date   date,
  archived_at           timestamptz,
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_offerings_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_offerings_id_sched_org_uk UNIQUE (id, schedule_id, organisation_id),
  CONSTRAINT scheduling_offerings_schedule_fk FOREIGN KEY (schedule_id, organisation_id)
    REFERENCES scheduling_schedules (id, organisation_id),
  CONSTRAINT scheduling_offerings_recurrence_ck CHECK (
    (recurrence_kind = 'none'
       AND recurrence_day_of_week IS NULL AND recurrence_end_mode IS NULL
       AND recurrence_end_count IS NULL AND recurrence_end_date IS NULL)
    OR
    (recurrence_kind = 'weekly'
       AND recurrence_day_of_week IS NOT NULL AND start_time IS NOT NULL AND recurrence_end_mode IS NOT NULL
       AND ((recurrence_end_mode = 'ongoing'           AND recurrence_end_count IS NULL     AND recurrence_end_date IS NULL)
         OR (recurrence_end_mode = 'after_occurrences' AND recurrence_end_count IS NOT NULL AND recurrence_end_date IS NULL)
         OR (recurrence_end_mode = 'on_date'           AND recurrence_end_count IS NULL     AND recurrence_end_date IS NOT NULL)))
  )
);
CREATE INDEX IF NOT EXISTS scheduling_offerings_schedule_idx ON scheduling_offerings (organisation_id, schedule_id);

CREATE TABLE IF NOT EXISTS scheduling_offering_resources (
  organisation_id text NOT NULL,
  offering_id     text NOT NULL,
  resource_id     text NOT NULL,
  PRIMARY KEY (organisation_id, offering_id, resource_id),
  CONSTRAINT scheduling_offering_resources_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id),
  CONSTRAINT scheduling_offering_resources_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_offering_resources_resource_idx ON scheduling_offering_resources (organisation_id, resource_id);

-- ─── Availability ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduling_availability_rules (
  id              text NOT NULL,
  organisation_id text NOT NULL,
  resource_id     text,
  offering_id     text,
  kind            text NOT NULL DEFAULT 'hours' CHECK (kind IN ('hours','service_period')),
  label           text,
  day_of_week     smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  valid_from      date,
  valid_to        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_availability_rules_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_availability_rules_owner_ck CHECK (num_nonnulls(resource_id, offering_id) = 1),
  CONSTRAINT scheduling_availability_rules_time_ck CHECK (end_time > start_time),
  CONSTRAINT scheduling_availability_rules_valid_ck CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT scheduling_availability_rules_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id),
  CONSTRAINT scheduling_availability_rules_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_availability_rules_resource_idx ON scheduling_availability_rules (organisation_id, resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduling_availability_rules_offering_idx ON scheduling_availability_rules (organisation_id, offering_id) WHERE offering_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS scheduling_availability_exceptions (
  id              text NOT NULL,
  organisation_id text NOT NULL,
  resource_id     text,
  offering_id     text,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('closed','override')),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_availability_exceptions_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_availability_exceptions_owner_ck CHECK (num_nonnulls(resource_id, offering_id) = 1),
  CONSTRAINT scheduling_availability_exceptions_range_ck CHECK (to_date >= from_date),
  CONSTRAINT scheduling_availability_exceptions_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id),
  CONSTRAINT scheduling_availability_exceptions_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_availability_exceptions_resource_idx ON scheduling_availability_exceptions (organisation_id, resource_id, from_date) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduling_availability_exceptions_offering_idx ON scheduling_availability_exceptions (organisation_id, offering_id, from_date) WHERE offering_id IS NOT NULL;

-- ─── Occurrences: one dated instance of an offering ─────────────────────────
-- Local wall-clock fields are the source of truth for the future; starts_at/ends_at are the
-- derived UTC instants; timezone records the zone used. There is NO reserved_count column:
-- headcount is counted under the advisory lock, so there is no second copy to drift.

CREATE TABLE IF NOT EXISTS scheduling_occurrences (
  id               text NOT NULL,
  organisation_id  text NOT NULL,
  offering_id      text NOT NULL,
  resource_id      text,
  local_date       date NOT NULL,
  local_start_time time NOT NULL,
  timezone         text NOT NULL CHECK (scheduling_is_timezone(timezone)),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  capacity         integer NOT NULL CHECK (capacity > 0),
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','completed')),
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_occurrences_window_ck CHECK (ends_at > starts_at),
  CONSTRAINT scheduling_occurrences_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_occurrences_id_off_org_uk UNIQUE (id, offering_id, organisation_id),
  CONSTRAINT scheduling_occurrences_slot_uk UNIQUE (organisation_id, offering_id, local_date, local_start_time),
  CONSTRAINT scheduling_occurrences_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id),
  CONSTRAINT scheduling_occurrences_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_occurrences_range_idx ON scheduling_occurrences (organisation_id, offering_id, starts_at);

-- ─── Recurrence: series and pauses ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduling_series (
  id                        text NOT NULL,
  organisation_id           text NOT NULL,
  offering_id               text NOT NULL,
  customer_id               text,
  customer_name             text NOT NULL CHECK (btrim(customer_name) <> ''),
  customer_email            text,
  customer_email_normalised text,
  customer_phone            text,
  timezone                  text NOT NULL CHECK (scheduling_is_timezone(timezone)),
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  created_by                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_series_email_ck CHECK (
    (customer_email IS NULL AND customer_email_normalised IS NULL)
    OR (customer_email IS NOT NULL AND customer_email_normalised = lower(btrim(customer_email)))),
  CONSTRAINT scheduling_series_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_series_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_series_offering_idx ON scheduling_series (organisation_id, offering_id);

CREATE TABLE IF NOT EXISTS scheduling_series_pauses (
  id              text NOT NULL,
  organisation_id text NOT NULL,
  series_id       text NOT NULL,
  pause_from      date NOT NULL,
  pause_until     date NOT NULL,
  reason          text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_series_pauses_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_series_pauses_range_ck CHECK (pause_until >= pause_from),
  CONSTRAINT scheduling_series_pauses_series_fk FOREIGN KEY (series_id, organisation_id)
    REFERENCES scheduling_series (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_series_pauses_series_idx ON scheduling_series_pauses (organisation_id, series_id);

-- ─── Reservations ────────────────────────────────────────────────────────────
-- Snapshot columns (customer_*, preset_*, timezone, local_*, starts_at/ends_at, party_size,
-- price) are immutable after insert (trigger below), so editing a customer or reconfiguring
-- a schedule never rewrites history. customer_id carries NO foreign key: see header.

CREATE TABLE IF NOT EXISTS scheduling_reservations (
  id                        text NOT NULL,
  organisation_id           text NOT NULL,
  schedule_id               text NOT NULL,
  preset_key                text NOT NULL CHECK (preset_key IN
                              ('classes_coaching','appointments','restaurant_tables','accommodation','resource_hire','event_capacity')),
  preset_version            integer NOT NULL CHECK (preset_version >= 1),
  offering_id               text NOT NULL,
  span_kind                 text NOT NULL CHECK (span_kind IN ('occurrence','slot','stay')),
  occurrence_id             text,
  resource_id               text,
  series_id                 text,
  customer_id               text,
  customer_name             text NOT NULL CHECK (btrim(customer_name) <> ''),
  customer_email            text,
  customer_email_normalised text,
  customer_phone            text,
  contact_link              text NOT NULL DEFAULT 'none' CHECK (contact_link IN ('matched','created','none')),
  timezone                  text NOT NULL CHECK (scheduling_is_timezone(timezone)),
  local_start_date          date NOT NULL,
  local_start_time          time NOT NULL,
  local_end_date            date NOT NULL,
  local_end_time            time NOT NULL,
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  party_size                integer NOT NULL CHECK (party_size >= 1),
  status                    text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  attendance                text CHECK (attendance IS NULL OR attendance IN ('attended','absent','late')),
  payment_status            text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded','waived')),
  price_cents               integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency                  text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  notes                     text,
  idempotency_key           text CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> ''),
  cancelled_at              timestamptz,
  cancelled_by              text CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer','staff','system')),
  cancel_reason             text,
  created_by                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_reservations_window_ck CHECK (ends_at > starts_at),
  CONSTRAINT scheduling_reservations_one_target_ck CHECK (num_nonnulls(occurrence_id, resource_id) = 1),
  CONSTRAINT scheduling_reservations_span_ck CHECK (
    (span_kind = 'occurrence' AND occurrence_id IS NOT NULL)
    OR (span_kind IN ('slot','stay') AND resource_id IS NOT NULL)),
  CONSTRAINT scheduling_reservations_cancel_ck CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT scheduling_reservations_email_ck CHECK (
    (customer_email IS NULL AND customer_email_normalised IS NULL)
    OR (customer_email IS NOT NULL AND customer_email_normalised = lower(btrim(customer_email)))),
  CONSTRAINT scheduling_reservations_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_reservations_idem_uk UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT scheduling_reservations_offering_fk FOREIGN KEY (offering_id, schedule_id, organisation_id)
    REFERENCES scheduling_offerings (id, schedule_id, organisation_id),
  CONSTRAINT scheduling_reservations_occurrence_fk FOREIGN KEY (occurrence_id, offering_id, organisation_id)
    REFERENCES scheduling_occurrences (id, offering_id, organisation_id),
  CONSTRAINT scheduling_reservations_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id),
  CONSTRAINT scheduling_reservations_series_fk FOREIGN KEY (series_id, organisation_id)
    REFERENCES scheduling_series (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS scheduling_reservations_occurrence_idx ON scheduling_reservations (organisation_id, occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduling_reservations_customer_idx ON scheduling_reservations (organisation_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduling_reservations_time_idx ON scheduling_reservations (organisation_id, starts_at);
CREATE INDEX IF NOT EXISTS scheduling_reservations_series_idx ON scheduling_reservations (organisation_id, series_id, starts_at) WHERE series_id IS NOT NULL;
-- Duplicate guards (one person, one live place per occurrence). Matching is by linked customer
-- or normalised email, NEVER by name. Mirrors LD Tennis's rule and closes its same-email race.
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_reservations_dup_customer_uk
  ON scheduling_reservations (organisation_id, occurrence_id, customer_id)
  WHERE status <> 'cancelled' AND occurrence_id IS NOT NULL AND customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_reservations_dup_email_uk
  ON scheduling_reservations (organisation_id, occurrence_id, customer_email_normalised)
  WHERE status <> 'cancelled' AND occurrence_id IS NOT NULL AND customer_email_normalised IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_reservations_dup_series_uk
  ON scheduling_reservations (organisation_id, occurrence_id, series_id)
  WHERE status <> 'cancelled' AND occurrence_id IS NOT NULL AND series_id IS NOT NULL;

-- ─── Resource holds: the only place exclusivity is enforced ─────────────────

CREATE TABLE IF NOT EXISTS scheduling_resource_holds (
  id              text NOT NULL,
  organisation_id text NOT NULL,
  resource_id     text NOT NULL,
  during          tstzrange NOT NULL,
  reservation_id  text,
  occurrence_id   text,
  released_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_holds_pk PRIMARY KEY (organisation_id, id),
  CONSTRAINT scheduling_holds_owner_ck CHECK (num_nonnulls(reservation_id, occurrence_id) = 1),
  -- Half-open [start, end) ranges only: this is what makes back-to-back bookings and
  -- same-day hotel turnover legal. An inclusive upper bound or an empty range is a bug.
  CONSTRAINT scheduling_holds_halfopen_ck CHECK (
    NOT isempty(during) AND lower_inc(during) AND NOT upper_inc(during)
    AND NOT lower_inf(during) AND NOT upper_inf(during)),
  CONSTRAINT scheduling_holds_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id),
  CONSTRAINT scheduling_holds_reservation_fk FOREIGN KEY (reservation_id, organisation_id)
    REFERENCES scheduling_reservations (id, organisation_id),
  CONSTRAINT scheduling_holds_occurrence_fk FOREIGN KEY (occurrence_id, organisation_id)
    REFERENCES scheduling_occurrences (id, organisation_id),
  CONSTRAINT scheduling_holds_no_overlap EXCLUDE USING gist
    (organisation_id WITH =, resource_id WITH =, during WITH &&) WHERE (released_at IS NULL)
);
CREATE INDEX IF NOT EXISTS scheduling_holds_reservation_idx ON scheduling_resource_holds (organisation_id, reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduling_holds_occurrence_idx ON scheduling_resource_holds (organisation_id, occurrence_id) WHERE occurrence_id IS NOT NULL;

-- ─── Trigger functions ───────────────────────────────────────────────────────

-- BEFORE INSERT on reservations: capacity, occurrence state and resource state.
CREATE OR REPLACE FUNCTION scheduling_reservation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  occ        record;
  res_active boolean;
  live_count bigint;
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_reservation_guard requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;

  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'a reservation must be created pending or confirmed, not %', NEW.status USING ERRCODE = 'SCLIF';
  END IF;

  IF NEW.resource_id IS NOT NULL THEN
    SELECT active INTO res_active FROM scheduling_resources
      WHERE id = NEW.resource_id AND organisation_id = NEW.organisation_id;
    IF FOUND AND NOT res_active THEN
      RAISE EXCEPTION 'resource_inactive' USING ERRCODE = 'SCRES';
    END IF;
  END IF;

  IF NEW.occurrence_id IS NOT NULL THEN
    -- Serialise every writer for this occurrence. Held to end of transaction.
    PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_capacity:' || NEW.organisation_id || ':' || NEW.occurrence_id, 0));

    -- FOR SHARE: a concurrent cancellation of the occurrence waits for us (or we see it
    -- cancelled), so a booking can never slip in after the occurrence closed.
    SELECT status, capacity, starts_at, ends_at, timezone INTO occ
      FROM scheduling_occurrences
      WHERE id = NEW.occurrence_id AND organisation_id = NEW.organisation_id
      FOR SHARE;
    IF NOT FOUND THEN
      RETURN NEW; -- the composite foreign key reports the missing/cross-tenant occurrence
    END IF;
    IF occ.status <> 'scheduled' THEN
      RAISE EXCEPTION 'occurrence_not_open' USING ERRCODE = 'SCCLS', DETAIL = 'status=' || occ.status;
    END IF;
    IF NEW.starts_at <> occ.starts_at OR NEW.ends_at <> occ.ends_at OR NEW.timezone <> occ.timezone THEN
      RAISE EXCEPTION 'reservation window does not match its occurrence' USING ERRCODE = 'SCWIN';
    END IF;

    SELECT COALESCE(SUM(party_size), 0) INTO live_count FROM scheduling_reservations
      WHERE organisation_id = NEW.organisation_id AND occurrence_id = NEW.occurrence_id AND status <> 'cancelled';
    IF live_count + NEW.party_size > occ.capacity THEN
      RAISE EXCEPTION 'occurrence_full' USING ERRCODE = 'SCCAP',
        DETAIL = format('capacity=%s live=%s requested=%s', occ.capacity, live_count, NEW.party_size);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE UPDATE on reservations: immutable snapshot and the lifecycle state machine.
--   pending   -> confirmed | cancelled
--   confirmed -> cancelled | completed | no_show
--   cancelled, completed, no_show are terminal. A cancelled reservation is NEVER revived: its
--   place or resource may already belong to someone else, so a new booking must be made.
CREATE OR REPLACE FUNCTION scheduling_reservation_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.organisation_id, NEW.schedule_id, NEW.preset_key, NEW.preset_version, NEW.offering_id,
      NEW.span_kind, NEW.occurrence_id, NEW.resource_id, NEW.series_id, NEW.customer_name, NEW.customer_email,
      NEW.customer_email_normalised, NEW.customer_phone, NEW.contact_link, NEW.timezone, NEW.local_start_date,
      NEW.local_start_time, NEW.local_end_date, NEW.local_end_time, NEW.starts_at, NEW.ends_at, NEW.party_size,
      NEW.price_cents, NEW.currency, NEW.idempotency_key, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.schedule_id, OLD.preset_key, OLD.preset_version, OLD.offering_id,
      OLD.span_kind, OLD.occurrence_id, OLD.resource_id, OLD.series_id, OLD.customer_name, OLD.customer_email,
      OLD.customer_email_normalised, OLD.customer_phone, OLD.contact_link, OLD.timezone, OLD.local_start_date,
      OLD.local_start_time, OLD.local_end_date, OLD.local_end_time, OLD.starts_at, OLD.ends_at, OLD.party_size,
      OLD.price_cents, OLD.currency, OLD.idempotency_key, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'reservation snapshot columns are immutable' USING ERRCODE = 'SCIMM';
  END IF;

  -- A staff member may link a customer-less booking to a customer later, but not re-point one.
  IF OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'customer_id cannot be changed once set' USING ERRCODE = 'SCIMM';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'pending'   AND NEW.status IN ('confirmed', 'cancelled'))
         OR (OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'completed', 'no_show'))) THEN
      RAISE EXCEPTION 'illegal reservation status change % -> %', OLD.status, NEW.status USING ERRCODE = 'SCLIF';
    END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER UPDATE on reservations: cancellation releases the holds in the same statement, for
-- every writer, not just the repository.
CREATE OR REPLACE FUNCTION scheduling_reservation_release_holds() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE scheduling_resource_holds SET released_at = now()
    WHERE organisation_id = NEW.organisation_id AND reservation_id = NEW.id AND released_at IS NULL;
  RETURN NULL;
END;
$$;

-- Deferred constraint trigger: an exclusive-resource reservation or a resource-bearing
-- occurrence must own a live hold by the end of the statement/transaction.
CREATE OR REPLACE FUNCTION scheduling_require_hold() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'scheduling_reservations' THEN
    IF NEW.resource_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM scheduling_reservations r
                    WHERE r.id = NEW.id AND r.organisation_id = NEW.organisation_id AND r.status <> 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM scheduling_resource_holds h
                        WHERE h.organisation_id = NEW.organisation_id AND h.reservation_id = NEW.id AND h.released_at IS NULL) THEN
      RAISE EXCEPTION 'exclusive reservation % has no live resource hold', NEW.id USING ERRCODE = 'SCHLD';
    END IF;
  ELSE
    IF NEW.resource_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM scheduling_occurrences o
                    WHERE o.id = NEW.id AND o.organisation_id = NEW.organisation_id AND o.status = 'scheduled')
       AND NOT EXISTS (SELECT 1 FROM scheduling_resource_holds h
                        WHERE h.organisation_id = NEW.organisation_id AND h.occurrence_id = NEW.id AND h.released_at IS NULL) THEN
      RAISE EXCEPTION 'occurrence % has a resource but no live resource hold', NEW.id USING ERRCODE = 'SCHLD';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- BEFORE UPDATE on holds: a hold is identified by (resource, range, owner) forever; the only
-- legal change is releasing it. A released hold is never re-armed: the range may have been
-- taken, and silently re-arming it would either fail late (23P01) or resurrect a booking.
CREATE OR REPLACE FUNCTION scheduling_hold_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL AND NEW.released_at IS NULL THEN
    RAISE EXCEPTION 'a released resource hold cannot be reactivated' USING ERRCODE = 'SCREA';
  END IF;
  IF OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at THEN
    RAISE EXCEPTION 'a released resource hold cannot be changed' USING ERRCODE = 'SCIMM';
  END IF;
  IF (NEW.id, NEW.organisation_id, NEW.resource_id, NEW.during, NEW.reservation_id, NEW.occurrence_id)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.resource_id, OLD.during, OLD.reservation_id, OLD.occurrence_id) THEN
    RAISE EXCEPTION 'resource hold identity is immutable' USING ERRCODE = 'SCIMM';
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE INSERT on holds: serialise writers per (organisation, resource) BEFORE the exclusion
-- constraint's index check. Without this, two concurrent inserts for overlapping ranges can each
-- find the other's uncommitted entry and wait on it forever; Postgres then kills one with
-- SQLSTATE 40P01 (deadlock_detected) instead of the clean 23P01 conflict. With the lock the loser
-- waits here, then sees the winner's COMMITTED hold and fails with 23P01. Releasing a hold
-- (UPDATE) never needs the lock because freeing a range cannot conflict.
-- Lock ordering: a statement takes at most one of {occurrence capacity lock, resource lock}
-- (a reservation targets an occurrence XOR a resource), so no cycle between them exists. A future
-- statement that inserts several holds MUST insert them in resource_id order.
CREATE OR REPLACE FUNCTION scheduling_hold_serialise() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.released_at IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || NEW.organisation_id || ':' || NEW.resource_id, 0));
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE UPDATE on occurrences: only status and capacity may change; lowering capacity below
-- the live headcount is refused under the same advisory lock the booking guard uses.
CREATE OR REPLACE FUNCTION scheduling_occurrence_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count bigint;
BEGIN
  IF (NEW.id, NEW.organisation_id, NEW.offering_id, NEW.resource_id, NEW.local_date, NEW.local_start_time,
      NEW.timezone, NEW.starts_at, NEW.ends_at)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.offering_id, OLD.resource_id, OLD.local_date, OLD.local_start_time,
      OLD.timezone, OLD.starts_at, OLD.ends_at) THEN
    RAISE EXCEPTION 'occurrence identity and time are immutable' USING ERRCODE = 'SCIMM';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'scheduled' AND NEW.status IN ('cancelled', 'completed')) THEN
    RAISE EXCEPTION 'illegal occurrence status change % -> %', OLD.status, NEW.status USING ERRCODE = 'SCLIF';
  END IF;

  IF NEW.capacity < OLD.capacity THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_capacity:' || NEW.organisation_id || ':' || NEW.id, 0));
    SELECT COALESCE(SUM(party_size), 0) INTO live_count FROM scheduling_reservations
      WHERE organisation_id = NEW.organisation_id AND occurrence_id = NEW.id AND status <> 'cancelled';
    IF live_count > NEW.capacity THEN
      RAISE EXCEPTION 'capacity cannot drop below the live headcount' USING ERRCODE = 'SCCAP',
        DETAIL = format('capacity=%s live=%s', NEW.capacity, live_count);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER UPDATE on occurrences: closing an occurrence releases its resource holds.
CREATE OR REPLACE FUNCTION scheduling_occurrence_release_holds() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE scheduling_resource_holds SET released_at = now()
    WHERE organisation_id = NEW.organisation_id AND occurrence_id = NEW.id AND released_at IS NULL;
  RETURN NULL;
END;
$$;

-- Atomic occurrence cancellation: one call closes the occurrence, cancels its live
-- reservations (which releases their holds) and returns their ids. A function, not two
-- client statements, because the Neon HTTP driver has no interactive transactions; each
-- statement inside it sees a fresh snapshot, so a booking that committed while the
-- occurrence update waited is still caught by the second statement.
CREATE OR REPLACE FUNCTION scheduling_cancel_occurrence(p_org text, p_occurrence text, p_reason text)
RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE
  closed int;
  ids    text[];
BEGIN
  UPDATE scheduling_occurrences SET status = 'cancelled'
    WHERE id = p_occurrence AND organisation_id = p_org AND status = 'scheduled';
  GET DIAGNOSTICS closed = ROW_COUNT;
  IF closed = 0 THEN
    RETURN NULL; -- unknown, wrong tenant, or already closed
  END IF;
  WITH c AS (
    UPDATE scheduling_reservations
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancel_reason = p_reason
     WHERE organisation_id = p_org AND occurrence_id = p_occurrence AND status IN ('pending', 'confirmed')
    RETURNING id)
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::text[]) INTO ids FROM c;
  RETURN ids;
END;
$$;

-- ─── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER scheduling_settings_touch BEFORE UPDATE ON scheduling_settings
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_schedules_touch BEFORE UPDATE ON scheduling_schedules
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_resources_touch BEFORE UPDATE ON scheduling_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_offerings_touch BEFORE UPDATE ON scheduling_offerings
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_series_touch BEFORE UPDATE ON scheduling_series
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();

CREATE OR REPLACE TRIGGER scheduling_reservations_guard BEFORE INSERT ON scheduling_reservations
  FOR EACH ROW EXECUTE FUNCTION scheduling_reservation_guard();
CREATE OR REPLACE TRIGGER scheduling_reservations_lifecycle BEFORE UPDATE ON scheduling_reservations
  FOR EACH ROW EXECUTE FUNCTION scheduling_reservation_lifecycle();
CREATE OR REPLACE TRIGGER scheduling_reservations_touch BEFORE UPDATE ON scheduling_reservations
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_reservations_release_holds AFTER UPDATE OF status ON scheduling_reservations
  FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION scheduling_reservation_release_holds();
-- CONSTRAINT TRIGGER has no OR REPLACE form, so it is guarded by a catalog check instead.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'scheduling_reservations_require_hold' AND tgrelid = 'scheduling_reservations'::regclass) THEN
    CREATE CONSTRAINT TRIGGER scheduling_reservations_require_hold AFTER INSERT ON scheduling_reservations
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION scheduling_require_hold();
  END IF;
END $$;

CREATE OR REPLACE TRIGGER scheduling_occurrences_guard BEFORE UPDATE ON scheduling_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling_occurrence_guard();
CREATE OR REPLACE TRIGGER scheduling_occurrences_touch BEFORE UPDATE ON scheduling_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_occurrences_release_holds AFTER UPDATE OF status ON scheduling_occurrences
  FOR EACH ROW WHEN (NEW.status <> 'scheduled' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION scheduling_occurrence_release_holds();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'scheduling_occurrences_require_hold' AND tgrelid = 'scheduling_occurrences'::regclass) THEN
    CREATE CONSTRAINT TRIGGER scheduling_occurrences_require_hold AFTER INSERT ON scheduling_occurrences
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION scheduling_require_hold();
  END IF;
END $$;

CREATE OR REPLACE TRIGGER scheduling_holds_guard BEFORE UPDATE ON scheduling_resource_holds
  FOR EACH ROW EXECUTE FUNCTION scheduling_hold_guard();
CREATE OR REPLACE TRIGGER scheduling_holds_serialise BEFORE INSERT ON scheduling_resource_holds
  FOR EACH ROW EXECUTE FUNCTION scheduling_hold_serialise();

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2a.1', 'Phase 2A shared scheduling schema: settings, schedules, resources, offerings, availability, occurrences, series, reservations, resource holds')
ON CONFLICT (version) DO NOTHING;

COMMIT;
