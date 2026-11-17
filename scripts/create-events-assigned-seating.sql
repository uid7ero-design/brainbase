-- Eve assigned seating — Phase S1: additive database foundation (version seating-s1).
--
-- DO NOT apply to Production without the approvals in the S1 PR. This script only CREATES
-- objects and ADDS nullable / defaulted columns. It never rewrites, backfills or deletes an
-- existing row. Every existing ticket type becomes seating_mode = 'GENERAL_ADMISSION' (a
-- constant default, so PostgreSQL 11+ adds it without a table rewrite), and every existing
-- attendee keeps NULL seat columns. No trigger added to an existing table fires for a row
-- that does not touch the new seating columns.
--
-- Idempotent: every statement is IF NOT EXISTS / CREATE OR REPLACE / guarded DO block, so a
-- second run changes nothing.
--
-- REQUIRES: PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT) and btree_gist (trusted on Neon; already
-- installed in Production by Scheduling 2A — then this is a no-op).
-- Rollback: scripts/rollback-events-assigned-seating.sql (refuses while any seating data exists).
--
-- Model (see the S1 PR for the full write-up):
--   Reusable, per organisation:   seating_venues → seating_layouts (versioned DRAFT → PUBLISHED →
--                                 RETIRED; frozen once not DRAFT) → seating_layout_sections →
--                                 seating_layout_groups (ROW | TABLE) → seating_layout_seats
--   Per event:                    event_seating (one PUBLISHED layout version per event)
--                                 event_ticket_type_sections (seated type → eligible sections)
--                                 event_seats (inventory copied per event + session; labels filled
--                                   from the layout by trigger and immutable afterwards)
--                                 event_seat_holds (one row per held seat; an EXCLUDE constraint
--                                   allows at most one ACTIVE hold per seat at any instant)
--   Existing tables:              event_ticket_types.seating_mode
--                                 event_attendees.event_seat_id / seat_snapshot / seat_released_at
--                                   (partial UNIQUE: at most one unreleased attendee per seat)

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── Version marker ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events_schema_migrations (
  version     text        PRIMARY KEY,
  description text        NOT NULL,
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Extension ───────────────────────────────────────────────────────────────
-- btree_gist gives text '=' a GiST operator class, needed by the hold EXCLUDE constraint.
-- Installed only if absent anywhere; whether THIS script installed it is recorded on the marker
-- so the rollback restores the exact pre-migration state.
DO $$
DECLARE installed boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    CREATE SCHEMA IF NOT EXISTS events_ext;
    CREATE EXTENSION btree_gist WITH SCHEMA events_ext;
    installed := true;
  END IF;
  INSERT INTO events_schema_migrations (version, description, details)
  VALUES ('seating-s1', 'Eve assigned seating S1: layouts, event seat inventory, holds, attendee seat columns',
          jsonb_build_object('installed_btree_gist', installed))
  ON CONFLICT (version) DO NOTHING;
END $$;

-- ─── Existing tables: additive columns ───────────────────────────────────────
ALTER TABLE event_ticket_types ADD COLUMN IF NOT EXISTS seating_mode text NOT NULL DEFAULT 'GENERAL_ADMISSION';
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS event_seat_id    text;
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS seat_snapshot    jsonb;
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS seat_released_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_seating_mode_check') THEN
    ALTER TABLE event_ticket_types ADD CONSTRAINT event_ticket_types_seating_mode_check
      CHECK (seating_mode IN ('GENERAL_ADMISSION', 'ASSIGNED'));
  END IF;
  -- A seat reference and its snapshot always travel together; a release needs a seat.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_attendees_seat_snapshot_check') THEN
    ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_seat_snapshot_check
      CHECK ((event_seat_id IS NULL) = (seat_snapshot IS NULL)
             AND (seat_released_at IS NULL OR event_seat_id IS NOT NULL));
  END IF;
END $$;

-- ─── Reusable layouts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seating_venues (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id text        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address         text        CHECK (address IS NULL OR length(address) <= 500),
  timezone        text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seating_venues_id_org_key UNIQUE (id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS seating_venues_org_name_active_key
  ON seating_venues (organisation_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS seating_layouts (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id text        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  venue_id        text,       -- NULL = an event-specific layout with no reusable venue
  name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  version         integer     NOT NULL CHECK (version >= 1),
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  source_spec     jsonb,
  published_at    timestamptz,
  retired_at      timestamptz,
  created_by      text        REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seating_layouts_id_org_key UNIQUE (id, organisation_id),
  CONSTRAINT seating_layouts_venue_fkey FOREIGN KEY (venue_id, organisation_id)
    REFERENCES seating_venues (id, organisation_id),
  CONSTRAINT seating_layouts_version_key UNIQUE NULLS NOT DISTINCT (organisation_id, venue_id, name, version),
  CONSTRAINT seating_layouts_status_dates_check CHECK (
    (status = 'DRAFT' AND published_at IS NULL AND retired_at IS NULL)
    OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND published_at IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS seating_layouts_venue_idx ON seating_layouts (organisation_id, venue_id);

CREATE TABLE IF NOT EXISTS seating_layout_sections (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id text        NOT NULL,
  layout_id       text        NOT NULL,
  name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  sort_order      integer     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seating_layout_sections_layout_fkey FOREIGN KEY (layout_id, organisation_id)
    REFERENCES seating_layouts (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT seating_layout_sections_scope_key UNIQUE (id, layout_id, organisation_id),
  CONSTRAINT seating_layout_sections_sort_key UNIQUE (layout_id, sort_order)
);
CREATE UNIQUE INDEX IF NOT EXISTS seating_layout_sections_name_key
  ON seating_layout_sections (layout_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS seating_layout_groups (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id text        NOT NULL,
  layout_id       text        NOT NULL,
  section_id      text        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('ROW', 'TABLE')),
  label           text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  sort_order      integer     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seating_layout_groups_section_fkey FOREIGN KEY (section_id, layout_id, organisation_id)
    REFERENCES seating_layout_sections (id, layout_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT seating_layout_groups_scope_key UNIQUE (id, section_id, layout_id, organisation_id),
  CONSTRAINT seating_layout_groups_label_key UNIQUE (section_id, kind, label),
  CONSTRAINT seating_layout_groups_sort_key UNIQUE (section_id, sort_order)
);

CREATE TABLE IF NOT EXISTS seating_layout_seats (
  id                   text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id      text        NOT NULL,
  layout_id            text        NOT NULL,
  section_id           text        NOT NULL,
  group_id             text        NOT NULL,
  label                text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 20),
  sort_order           integer     NOT NULL,
  active               boolean     NOT NULL DEFAULT true,
  -- Factual seat features only. Nothing here describes a person.
  wheelchair_space     boolean     NOT NULL DEFAULT false,
  companion_seat       boolean     NOT NULL DEFAULT false,
  step_free            boolean     NOT NULL DEFAULT false,
  restricted_view      boolean     NOT NULL DEFAULT false,
  companion_of_seat_id text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seating_layout_seats_group_fkey FOREIGN KEY (group_id, section_id, layout_id, organisation_id)
    REFERENCES seating_layout_groups (id, section_id, layout_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT seating_layout_seats_scope_key UNIQUE (id, layout_id, organisation_id),
  CONSTRAINT seating_layout_seats_label_key UNIQUE (group_id, label),
  CONSTRAINT seating_layout_seats_sort_key UNIQUE (group_id, sort_order),
  CONSTRAINT seating_layout_seats_companion_fkey FOREIGN KEY (companion_of_seat_id, layout_id, organisation_id)
    REFERENCES seating_layout_seats (id, layout_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT seating_layout_seats_companion_check CHECK (
    companion_of_seat_id IS NULL OR (companion_of_seat_id <> id AND companion_seat))
);
CREATE INDEX IF NOT EXISTS seating_layout_seats_layout_idx ON seating_layout_seats (layout_id, section_id);
CREATE INDEX IF NOT EXISTS seating_layout_seats_companion_idx ON seating_layout_seats (companion_of_seat_id)
  WHERE companion_of_seat_id IS NOT NULL;

-- ─── Per-event seating ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_seating (
  event_id            text        PRIMARY KEY,
  organisation_id     text        NOT NULL,
  layout_id           text        NOT NULL,
  layout_version      integer     NOT NULL,   -- filled from the layout by trigger
  allocation_mode     text        NOT NULL DEFAULT 'BUYER_SELECT' CHECK (allocation_mode IN ('BUYER_SELECT')),
  attached_by_user_id text        REFERENCES users(id) ON DELETE SET NULL,
  attached_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seating_event_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_seating_layout_fkey FOREIGN KEY (layout_id, organisation_id)
    REFERENCES seating_layouts (id, organisation_id),
  CONSTRAINT event_seating_scope_key UNIQUE (event_id, organisation_id, layout_id)
);
CREATE INDEX IF NOT EXISTS event_seating_layout_idx ON event_seating (layout_id);
CREATE INDEX IF NOT EXISTS event_seating_organisation_idx ON event_seating (organisation_id);

CREATE TABLE IF NOT EXISTS event_ticket_type_sections (
  organisation_id   text        NOT NULL,
  event_id          text        NOT NULL,
  ticket_type_id    text        NOT NULL,
  layout_id         text        NOT NULL,
  layout_section_id text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_type_id, layout_section_id),
  CONSTRAINT event_tt_sections_ticket_type_fkey FOREIGN KEY (ticket_type_id, event_id, organisation_id)
    REFERENCES event_ticket_types (id, event_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_tt_sections_seating_fkey FOREIGN KEY (event_id, organisation_id, layout_id)
    REFERENCES event_seating (event_id, organisation_id, layout_id) ON DELETE CASCADE,
  CONSTRAINT event_tt_sections_section_fkey FOREIGN KEY (layout_section_id, layout_id, organisation_id)
    REFERENCES seating_layout_sections (id, layout_id, organisation_id)
);
CREATE INDEX IF NOT EXISTS event_tt_sections_event_idx ON event_ticket_type_sections (event_id, layout_section_id);
CREATE INDEX IF NOT EXISTS event_tt_sections_organisation_idx ON event_ticket_type_sections (organisation_id);

CREATE TABLE IF NOT EXISTS event_seats (
  id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id   text        NOT NULL,
  event_id          text        NOT NULL,
  event_session_id  text,       -- NULL for an event without sessions, as event_order_items
  layout_id         text        NOT NULL,
  layout_seat_id    text        NOT NULL,
  -- Snapshot of the layout, filled by trigger on INSERT and immutable afterwards.
  layout_section_id text        NOT NULL,
  section_name      text        NOT NULL,
  section_sort      integer     NOT NULL,
  group_kind        text        NOT NULL CHECK (group_kind IN ('ROW', 'TABLE')),
  group_label       text        NOT NULL,
  group_sort        integer     NOT NULL,
  seat_label        text        NOT NULL,
  seat_sort         integer     NOT NULL,
  wheelchair_space  boolean     NOT NULL,
  companion_seat    boolean     NOT NULL,
  step_free         boolean     NOT NULL,
  restricted_view   boolean     NOT NULL,
  -- The only mutable state: whether the seat is offered for sale. Held / assigned are NOT stored
  -- here; they are derived from event_seat_holds and event_attendees.
  sale_status       text        NOT NULL DEFAULT 'AVAILABLE' CHECK (sale_status IN ('AVAILABLE', 'BLOCKED')),
  block_note        text        CHECK (block_note IS NULL OR length(block_note) <= 200),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seats_seating_fkey FOREIGN KEY (event_id, organisation_id, layout_id)
    REFERENCES event_seating (event_id, organisation_id, layout_id) ON DELETE CASCADE,
  CONSTRAINT event_seats_session_fkey FOREIGN KEY (event_session_id, event_id, organisation_id)
    REFERENCES event_sessions (id, event_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_seats_layout_seat_fkey FOREIGN KEY (layout_seat_id, layout_id, organisation_id)
    REFERENCES seating_layout_seats (id, layout_id, organisation_id),
  CONSTRAINT event_seats_section_fkey FOREIGN KEY (layout_section_id, layout_id, organisation_id)
    REFERENCES seating_layout_sections (id, layout_id, organisation_id),
  CONSTRAINT event_seats_scope_key UNIQUE (id, event_id, organisation_id),
  CONSTRAINT event_seats_inventory_key UNIQUE NULLS NOT DISTINCT (event_id, event_session_id, layout_seat_id)
);
-- Seat map / door list / occupancy: one ordered range scan per event + session.
CREATE INDEX IF NOT EXISTS event_seats_map_idx
  ON event_seats (event_id, event_session_id, section_sort, group_sort, seat_sort);
CREATE INDEX IF NOT EXISTS event_seats_section_idx ON event_seats (event_id, layout_section_id);
CREATE INDEX IF NOT EXISTS event_seats_layout_seat_idx ON event_seats (layout_seat_id);
CREATE INDEX IF NOT EXISTS event_seats_organisation_idx ON event_seats (organisation_id);

CREATE TABLE IF NOT EXISTS event_seat_holds (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id  text        NOT NULL,
  event_id         text        NOT NULL,   -- filled from the seat by trigger
  event_session_id text,                   -- filled from the seat by trigger
  event_seat_id    text        NOT NULL,
  secret_hash      text        NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  hold_started_at  timestamptz NOT NULL,   -- when the buyer's hold group began (20-minute cap anchor)
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  renewal_count    smallint    NOT NULL DEFAULT 0 CHECK (renewal_count BETWEEN 0 AND 1),
  state            text        NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED')),
  order_id         text,
  consumed_at      timestamptz,
  released_at      timestamptz,
  CONSTRAINT event_seat_holds_seat_fkey FOREIGN KEY (event_seat_id, event_id, organisation_id)
    REFERENCES event_seats (id, event_id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_seat_holds_order_fkey FOREIGN KEY (order_id, organisation_id)
    REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_seat_holds_window_check CHECK (
    created_at >= hold_started_at
    AND expires_at > created_at
    AND expires_at <= hold_started_at + interval '20 minutes'                       -- absolute cap
    AND (renewal_count = 1 OR expires_at <= hold_started_at + interval '10 minutes')), -- initial window
  CONSTRAINT event_seat_holds_lifecycle_check CHECK (
    (state = 'ACTIVE'   AND consumed_at IS NULL AND released_at IS NULL)
    OR (state = 'CONSUMED' AND consumed_at IS NOT NULL AND order_id IS NOT NULL AND released_at IS NULL)
    OR (state = 'RELEASED' AND released_at IS NOT NULL AND consumed_at IS NULL)
    OR (state = 'EXPIRED'  AND consumed_at IS NULL AND released_at IS NULL)),
  -- THE hold invariant: two ACTIVE holds on one seat can never have overlapping windows. An
  -- expired ACTIVE row no longer overlaps "now", so it never blocks a new hold, and no clock
  -- value is needed in the index (now() is not allowed there). Concurrent inserts serialise on
  -- the GiST index exactly like a unique index.
  CONSTRAINT event_seat_holds_one_active_per_seat EXCLUDE USING gist
    (event_seat_id WITH =, tstzrange(created_at, expires_at, '[)') WITH &&) WHERE (state = 'ACTIVE')
);
CREATE INDEX IF NOT EXISTS event_seat_holds_secret_idx ON event_seat_holds (secret_hash);
CREATE INDEX IF NOT EXISTS event_seat_holds_active_event_idx ON event_seat_holds (event_id, expires_at)
  WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS event_seat_holds_order_idx ON event_seat_holds (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_seat_holds_organisation_idx ON event_seat_holds (organisation_id);

-- ─── Attendee seat assignment (existing table) ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_attendees_event_seat_fkey') THEN
    ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_event_seat_fkey
      FOREIGN KEY (event_seat_id, event_id, organisation_id) REFERENCES event_seats (id, event_id, organisation_id);
  END IF;
END $$;
-- THE assignment invariant: at most one unreleased attendee per event seat.
CREATE UNIQUE INDEX IF NOT EXISTS event_attendees_active_seat_key
  ON event_attendees (event_seat_id) WHERE event_seat_id IS NOT NULL AND seat_released_at IS NULL;

-- ─── Trigger functions ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION events_seating_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Layout freeze, parent: a non-DRAFT layout's content columns never change; the only allowed
-- transitions are DRAFT → PUBLISHED and PUBLISHED → RETIRED. Publishing needs at least one
-- active seat. Only DRAFT layouts can be deleted.
CREATE OR REPLACE FUNCTION seating_layout_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A frozen layout disappears only with its organisation (ON DELETE CASCADE: the parent row is
    -- already gone), so organisation deletion keeps behaving exactly as before.
    IF OLD.status <> 'DRAFT' AND EXISTS (SELECT 1 FROM organisations WHERE id = OLD.organisation_id) THEN
      RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: layout % is % and cannot be deleted', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: a layout must be created as DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.organisation_id, NEW.venue_id, NEW.version, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM (OLD.id, OLD.organisation_id, OLD.venue_id, OLD.version, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: layout identity columns are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.name, NEW.source_spec, NEW.published_at)
     IS DISTINCT FROM (OLD.name, OLD.source_spec, OLD.published_at) THEN
    RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: layout % is % and cannot be edited; create a new version', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')) THEN
      RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: layout status % → % is not allowed', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' AND NOT EXISTS (
      SELECT 1 FROM seating_layout_seats WHERE layout_id = NEW.id AND organisation_id = NEW.organisation_id AND active) THEN
      RAISE EXCEPTION 'SEATING_LAYOUT_EMPTY: a layout needs at least one active seat to be published'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'RETIRED' AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: retired layout is immutable' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Layout freeze, children: sections, groups and seats change only while the parent is DRAFT.
-- FOR SHARE on the parent serialises against a concurrent publish (which takes FOR UPDATE).
CREATE OR REPLACE FUNCTION seating_layout_child_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_layout text;
  target_org    text;
  layout_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_layout := OLD.layout_id; target_org := OLD.organisation_id;
  ELSE target_layout := NEW.layout_id; target_org := NEW.organisation_id; END IF;
  SELECT status INTO layout_status FROM seating_layouts WHERE id = target_layout AND organisation_id = target_org FOR SHARE;
  -- A missing parent means the layout itself is being deleted (a DRAFT, by the parent guard).
  IF layout_status IS NOT NULL AND layout_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: layout % is %; % on % refused', target_layout, layout_status, TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.layout_id, NEW.organisation_id) IS DISTINCT FROM (OLD.layout_id, OLD.organisation_id) THEN
    RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: rows cannot move between layouts' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- event_seating: attach only a PUBLISHED layout of the same organisation; record its version.
-- The layout of an event never changes in place (detach = delete, allowed only while nothing
-- references the inventory). Deleting is refused while an ASSIGNED ticket type exists, unless the
-- event itself is being deleted.
CREATE OR REPLACE FUNCTION event_seating_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  layout_status text;
  layout_ver    integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM events WHERE id = OLD.event_id)
       AND EXISTS (SELECT 1 FROM event_ticket_types WHERE event_id = OLD.event_id AND organisation_id = OLD.organisation_id
                     AND seating_mode = 'ASSIGNED') THEN
      RAISE EXCEPTION 'SEATING_IN_USE: event % still has ASSIGNED ticket types', OLD.event_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.event_id, NEW.organisation_id, NEW.layout_id, NEW.layout_version, NEW.attached_at)
     IS DISTINCT FROM (OLD.event_id, OLD.organisation_id, OLD.layout_id, OLD.layout_version, OLD.attached_at) THEN
    RAISE EXCEPTION 'SEATING_LAYOUT_FROZEN: an event''s attached layout cannot be changed in place' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status, version INTO layout_status, layout_ver FROM seating_layouts
      WHERE id = NEW.layout_id AND organisation_id = NEW.organisation_id FOR SHARE;
    IF layout_status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'SEATING_LAYOUT_NOT_PUBLISHED: only a PUBLISHED layout can be attached (layout % is %)',
        NEW.layout_id, coalesce(layout_status, 'missing') USING ERRCODE = 'check_violation';
    END IF;
    NEW.layout_version := layout_ver;
  END IF;
  RETURN NEW;
END;
$$;

-- event_seats: on INSERT copy every snapshot column from the layout seat (callers supply only
-- event / session / layout_seat_id); afterwards only sale_status / block_note may change, and a
-- seat cannot be BLOCKED while an unreleased attendee holds it.
CREATE OR REPLACE FUNCTION event_seats_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT ls.id, ls.layout_id, ls.section_id, sec.name AS section_name, sec.sort_order AS section_sort,
           g.kind, g.label AS group_label, g.sort_order AS group_sort, ls.label AS seat_label, ls.sort_order AS seat_sort,
           ls.active, ls.wheelchair_space, ls.companion_seat, ls.step_free, ls.restricted_view
      INTO s
      FROM seating_layout_seats ls
      JOIN seating_layout_groups g ON g.id = ls.group_id
      JOIN seating_layout_sections sec ON sec.id = ls.section_id
     WHERE ls.id = NEW.layout_seat_id AND ls.organisation_id = NEW.organisation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SEAT_NOT_FOUND: layout seat % not found for this organisation', NEW.layout_seat_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NOT s.active THEN
      RAISE EXCEPTION 'SEAT_INACTIVE: layout seat % is inactive', NEW.layout_seat_id USING ERRCODE = 'check_violation';
    END IF;
    NEW.layout_id := s.layout_id;
    NEW.layout_section_id := s.section_id;
    NEW.section_name := s.section_name;
    NEW.section_sort := s.section_sort;
    NEW.group_kind := s.kind;
    NEW.group_label := s.group_label;
    NEW.group_sort := s.group_sort;
    NEW.seat_label := s.seat_label;
    NEW.seat_sort := s.seat_sort;
    NEW.wheelchair_space := s.wheelchair_space;
    NEW.companion_seat := s.companion_seat;
    NEW.step_free := s.step_free;
    NEW.restricted_view := s.restricted_view;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.organisation_id, NEW.event_id, NEW.event_session_id, NEW.layout_id, NEW.layout_seat_id,
      NEW.layout_section_id, NEW.section_name, NEW.section_sort, NEW.group_kind, NEW.group_label, NEW.group_sort,
      NEW.seat_label, NEW.seat_sort, NEW.wheelchair_space, NEW.companion_seat, NEW.step_free, NEW.restricted_view,
      NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.event_id, OLD.event_session_id, OLD.layout_id, OLD.layout_seat_id,
      OLD.layout_section_id, OLD.section_name, OLD.section_sort, OLD.group_kind, OLD.group_label, OLD.group_sort,
      OLD.seat_label, OLD.seat_sort, OLD.wheelchair_space, OLD.companion_seat, OLD.step_free, OLD.restricted_view,
      OLD.created_at) THEN
    RAISE EXCEPTION 'SEAT_SNAPSHOT_IMMUTABLE: event seat inventory is a snapshot; only sale_status/block_note may change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sale_status = 'BLOCKED' AND OLD.sale_status <> 'BLOCKED' AND EXISTS (
    SELECT 1 FROM event_attendees WHERE event_seat_id = NEW.id AND seat_released_at IS NULL) THEN
    RAISE EXCEPTION 'SEAT_ASSIGNED: seat % is assigned and cannot be blocked; reassign or release first', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- event_seat_holds: event/session come from the seat; a hold may only start on a seat that is
-- AVAILABLE and not assigned (advisory — the attendee unique index stays the authority); only
-- the documented transitions are allowed, and terminal rows never change.
CREATE OR REPLACE FUNCTION event_seat_holds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  seat record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT event_id, event_session_id, sale_status INTO seat FROM event_seats
     WHERE id = NEW.event_seat_id AND organisation_id = NEW.organisation_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SEAT_NOT_FOUND: seat % not found for this organisation', NEW.event_seat_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'HOLD_STATE_INVALID: a hold must be created ACTIVE' USING ERRCODE = 'check_violation';
    END IF;
    IF seat.sale_status <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'SEAT_UNAVAILABLE: seat % is %', NEW.event_seat_id, seat.sale_status USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM event_attendees WHERE event_seat_id = NEW.event_seat_id AND seat_released_at IS NULL) THEN
      RAISE EXCEPTION 'SEAT_UNAVAILABLE: seat % is assigned', NEW.event_seat_id USING ERRCODE = 'check_violation';
    END IF;
    NEW.event_id := seat.event_id;
    NEW.event_session_id := seat.event_session_id;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.organisation_id, NEW.event_id, NEW.event_session_id, NEW.event_seat_id, NEW.secret_hash,
      NEW.hold_started_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.event_id, OLD.event_session_id, OLD.event_seat_id, OLD.secret_hash,
      OLD.hold_started_at, OLD.created_at) THEN
    RAISE EXCEPTION 'HOLD_IMMUTABLE: hold identity columns cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'HOLD_IMMUTABLE: hold % is % (terminal)', OLD.id, OLD.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'ACTIVE' THEN
    -- Renewal is the only in-place change of an ACTIVE hold: once, forward, before expiry.
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.renewal_count IS DISTINCT FROM OLD.renewal_count THEN
      IF NOT (OLD.renewal_count = 0 AND NEW.renewal_count = 1 AND NEW.expires_at > OLD.expires_at AND OLD.expires_at > now()) THEN
        RAISE EXCEPTION 'HOLD_RENEWAL_REFUSED: a hold may be renewed once, forward, before it expires'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      RAISE EXCEPTION 'HOLD_IMMUTABLE: order is set only when the hold is consumed' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.state = 'EXPIRED' AND OLD.expires_at > now() THEN
    RAISE EXCEPTION 'HOLD_STATE_INVALID: hold % has not expired yet', OLD.id USING ERRCODE = 'check_violation';
  ELSIF NEW.state = 'CONSUMED' AND OLD.expires_at <= now() THEN
    RAISE EXCEPTION 'HOLD_EXPIRED: hold % expired before it was consumed', OLD.id USING ERRCODE = 'check_violation';
  ELSIF NEW.state <> 'ACTIVE' AND (NEW.expires_at, NEW.renewal_count) IS DISTINCT FROM (OLD.expires_at, OLD.renewal_count) THEN
    RAISE EXCEPTION 'HOLD_IMMUTABLE: a closing hold keeps its window' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- event_ticket_types.seating_mode: ASSIGNED only on an event with seating; back to GA only while
-- no unreleased seated attendee of the type exists. Fires only when seating_mode is involved.
CREATE OR REPLACE FUNCTION event_ticket_types_seating_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seating_mode = 'ASSIGNED' AND NOT EXISTS (
    SELECT 1 FROM event_seating WHERE event_id = NEW.event_id AND organisation_id = NEW.organisation_id) THEN
    RAISE EXCEPTION 'SEATING_NOT_CONFIGURED: event % has no seating layout attached', NEW.event_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.seating_mode = 'ASSIGNED' AND NEW.seating_mode <> 'ASSIGNED' AND EXISTS (
    SELECT 1 FROM event_attendees a JOIN event_order_items oi ON oi.id = a.order_item_id
     WHERE oi.ticket_type_id = OLD.id AND a.event_seat_id IS NOT NULL AND a.seat_released_at IS NULL) THEN
    RAISE EXCEPTION 'SEATING_IN_USE: ticket type % has seated attendees', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- event_ticket_type_sections: a mapping cannot be removed while an unreleased attendee of that
-- type sits in that section (unless the parent rows are being deleted with the event).
CREATE OR REPLACE FUNCTION event_tt_sections_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM events WHERE id = OLD.event_id) AND EXISTS (
    SELECT 1 FROM event_attendees a
      JOIN event_order_items oi ON oi.id = a.order_item_id
      JOIN event_seats es ON es.id = a.event_seat_id
     WHERE oi.ticket_type_id = OLD.ticket_type_id AND es.layout_section_id = OLD.layout_section_id
       AND a.seat_released_at IS NULL) THEN
    RAISE EXCEPTION 'SEATING_IN_USE: section mapping is in use by seated attendees' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- event_attendees seat columns. Fires ONLY when a seating column is set or changed, so general
-- admission inserts/updates never run it.
--   assign / reassign (unreleased): the seat must be AVAILABLE, in the attendee's own event +
--     session, the ticket type must be ASSIGNED and mapped to the seat's section, and the
--     snapshot must describe exactly that seat (it is written by the application formatter).
--   release: only seat_released_at changes; a released assignment is history and immutable.
CREATE OR REPLACE FUNCTION event_attendees_seat_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  seat  record;
  item  record;
  snap  jsonb;
  extra text[];
BEGIN
  IF TG_OP = 'INSERT' AND NEW.seat_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'SEAT_HISTORY_IMMUTABLE: an attendee cannot be created with a released seat' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.event_seat_id IS NOT NULL AND NEW.event_seat_id IS NULL THEN
    -- Clearing would erase the issued seat; release (seat_released_at) keeps the history.
    RAISE EXCEPTION 'SEAT_HISTORY_IMMUTABLE: release a seat with seat_released_at instead of clearing it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.seat_released_at IS NOT NULL AND NEW.seat_released_at IS NOT NULL THEN
    -- Still released: history is frozen. (Released → unreleased with a seat is a fresh assignment.)
    RAISE EXCEPTION 'SEAT_HISTORY_IMMUTABLE: a released seat assignment cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.seat_released_at IS NULL AND NEW.seat_released_at IS NOT NULL THEN
    IF (NEW.event_seat_id, NEW.seat_snapshot) IS DISTINCT FROM (OLD.event_seat_id, OLD.seat_snapshot) THEN
      RAISE EXCEPTION 'SEAT_HISTORY_IMMUTABLE: release must keep the seat and its snapshot' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.event_seat_id IS NULL THEN
    RETURN NEW;  -- nothing assigned; the CHECK forbids a snapshot or release without a seat
  END IF;

  SELECT id, event_session_id, layout_id, layout_section_id, section_name, group_kind, group_label, seat_label, sale_status
    INTO seat FROM event_seats
   WHERE id = NEW.event_seat_id AND event_id = NEW.event_id AND organisation_id = NEW.organisation_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEAT_NOT_FOUND: seat % is not part of event %', NEW.event_seat_id, NEW.event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF seat.sale_status <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'SEAT_UNAVAILABLE: seat % is %', seat.id, seat.sale_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT oi.ticket_type_id, oi.event_session_id, tt.seating_mode INTO item
    FROM event_order_items oi JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id
   WHERE oi.id = NEW.order_item_id AND oi.organisation_id = NEW.organisation_id;
  IF NOT FOUND OR item.seating_mode <> 'ASSIGNED' THEN
    RAISE EXCEPTION 'SEAT_NOT_ALLOWED: only an ASSIGNED ticket type can carry a seat' USING ERRCODE = 'check_violation';
  END IF;
  IF item.event_session_id IS DISTINCT FROM seat.event_session_id THEN
    RAISE EXCEPTION 'SEAT_SESSION_MISMATCH: seat % belongs to another session', seat.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_ticket_type_sections
                  WHERE ticket_type_id = item.ticket_type_id AND layout_section_id = seat.layout_section_id) THEN
    RAISE EXCEPTION 'SECTION_NOT_ELIGIBLE: ticket type % may not use this section', item.ticket_type_id
      USING ERRCODE = 'check_violation';
  END IF;

  snap := NEW.seat_snapshot;
  IF jsonb_typeof(snap) <> 'object' THEN
    RAISE EXCEPTION 'SEAT_SNAPSHOT_INVALID: snapshot must be an object' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(k) INTO extra FROM jsonb_object_keys(snap) k
   WHERE k NOT IN ('v', 'layout_id', 'layout_version', 'section', 'group_kind', 'group', 'seat', 'display');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'SEAT_SNAPSHOT_INVALID: unexpected keys %', extra USING ERRCODE = 'check_violation';
  END IF;
  IF snap->>'v' IS DISTINCT FROM '1'
     OR snap->>'layout_id' IS DISTINCT FROM seat.layout_id
     OR (snap->>'layout_version') IS DISTINCT FROM
        (SELECT layout_version::text FROM event_seating WHERE event_id = NEW.event_id)
     OR snap->>'section' IS DISTINCT FROM seat.section_name
     OR snap->>'group_kind' IS DISTINCT FROM seat.group_kind
     OR snap->>'group' IS DISTINCT FROM seat.group_label
     OR snap->>'seat' IS DISTINCT FROM seat.seat_label
     OR jsonb_typeof(snap->'display') IS DISTINCT FROM 'string'
     OR length(btrim(snap->>'display')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'SEAT_SNAPSHOT_INVALID: snapshot does not describe seat %', seat.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Triggers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER seating_venues_touch BEFORE UPDATE ON seating_venues
  FOR EACH ROW EXECUTE FUNCTION events_seating_touch_updated_at();
CREATE OR REPLACE TRIGGER seating_layouts_guard BEFORE INSERT OR UPDATE OR DELETE ON seating_layouts
  FOR EACH ROW EXECUTE FUNCTION seating_layout_guard();
CREATE OR REPLACE TRIGGER seating_layout_sections_guard BEFORE INSERT OR UPDATE OR DELETE ON seating_layout_sections
  FOR EACH ROW EXECUTE FUNCTION seating_layout_child_guard();
CREATE OR REPLACE TRIGGER seating_layout_groups_guard BEFORE INSERT OR UPDATE OR DELETE ON seating_layout_groups
  FOR EACH ROW EXECUTE FUNCTION seating_layout_child_guard();
CREATE OR REPLACE TRIGGER seating_layout_seats_guard BEFORE INSERT OR UPDATE OR DELETE ON seating_layout_seats
  FOR EACH ROW EXECUTE FUNCTION seating_layout_child_guard();
CREATE OR REPLACE TRIGGER event_seating_guard BEFORE INSERT OR UPDATE OR DELETE ON event_seating
  FOR EACH ROW EXECUTE FUNCTION event_seating_guard();
CREATE OR REPLACE TRIGGER event_seats_guard BEFORE INSERT OR UPDATE ON event_seats
  FOR EACH ROW EXECUTE FUNCTION event_seats_guard();
CREATE OR REPLACE TRIGGER event_seat_holds_guard BEFORE INSERT OR UPDATE ON event_seat_holds
  FOR EACH ROW EXECUTE FUNCTION event_seat_holds_guard();
CREATE OR REPLACE TRIGGER event_tt_sections_guard BEFORE DELETE ON event_ticket_type_sections
  FOR EACH ROW EXECUTE FUNCTION event_tt_sections_guard();
CREATE OR REPLACE TRIGGER event_ticket_types_seating_insert_guard BEFORE INSERT ON event_ticket_types
  FOR EACH ROW WHEN (NEW.seating_mode <> 'GENERAL_ADMISSION') EXECUTE FUNCTION event_ticket_types_seating_guard();
CREATE OR REPLACE TRIGGER event_ticket_types_seating_update_guard BEFORE UPDATE OF seating_mode ON event_ticket_types
  FOR EACH ROW WHEN (NEW.seating_mode IS DISTINCT FROM OLD.seating_mode) EXECUTE FUNCTION event_ticket_types_seating_guard();
CREATE OR REPLACE TRIGGER event_attendees_seat_insert_guard BEFORE INSERT ON event_attendees
  FOR EACH ROW WHEN (NEW.event_seat_id IS NOT NULL OR NEW.seat_snapshot IS NOT NULL OR NEW.seat_released_at IS NOT NULL)
  EXECUTE FUNCTION event_attendees_seat_guard();
CREATE OR REPLACE TRIGGER event_attendees_seat_update_guard BEFORE UPDATE ON event_attendees
  FOR EACH ROW WHEN ((NEW.event_seat_id, NEW.seat_snapshot, NEW.seat_released_at)
                     IS DISTINCT FROM (OLD.event_seat_id, OLD.seat_snapshot, OLD.seat_released_at))
  EXECUTE FUNCTION event_attendees_seat_guard();

COMMIT;
