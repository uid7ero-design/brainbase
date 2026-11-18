-- Eve assigned seating — Phase S1 rollback (undoes scripts/create-events-assigned-seating.sql).
--
-- SAFE ONLY BEFORE ANY SEATING DATA EXISTS. The first block REFUSES (raises, rolling back the whole
-- transaction) if any seating table has a row, any attendee carries a seat, or any ticket type is
-- ASSIGNED. It never drops real seating data: if it refuses, nothing has changed. There is no
-- "force" mode on purpose — once seated tickets exist, use the EVE_ASSIGNED_SEATING_ENABLED kill
-- switch (S3+) instead of a schema rollback.
--
-- Restores the exact pre-migration schema: removes the three attendee columns, the ticket type
-- column, every new table / function / trigger / index / constraint, the version marker, and
-- btree_gist ONLY if seating-s1 installed it (recorded on the marker) and nothing else uses it.
-- Existing event / order / attendee rows are untouched (column drops on all-NULL columns).
-- Idempotent: a second run is a no-op.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  n bigint := 0;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['seating_venues', 'seating_layouts', 'seating_layout_sections', 'seating_layout_groups',
                           'seating_layout_seats', 'event_seating', 'event_ticket_type_sections', 'event_seats',
                           'event_seat_holds'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'ROLLBACK_REFUSED: % has % row(s); seating data exists', t, n;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_attendees' AND column_name = 'event_seat_id') THEN
    EXECUTE 'SELECT count(*) FROM event_attendees WHERE event_seat_id IS NOT NULL OR seat_snapshot IS NOT NULL OR seat_released_at IS NOT NULL' INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'ROLLBACK_REFUSED: % attendee(s) carry seat data', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_ticket_types' AND column_name = 'seating_mode') THEN
    EXECUTE 'SELECT count(*) FROM event_ticket_types WHERE seating_mode <> ''GENERAL_ADMISSION''' INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'ROLLBACK_REFUSED: % ticket type(s) are ASSIGNED', n; END IF;
  END IF;
END $$;

-- Existing tables: triggers, index, constraints, columns.
DROP TRIGGER IF EXISTS event_attendees_seat_insert_guard ON event_attendees;
DROP TRIGGER IF EXISTS event_attendees_seat_update_guard ON event_attendees;
DROP TRIGGER IF EXISTS event_ticket_types_seating_insert_guard ON event_ticket_types;
DROP TRIGGER IF EXISTS event_ticket_types_seating_update_guard ON event_ticket_types;
DROP INDEX IF EXISTS event_attendees_active_seat_key;
ALTER TABLE event_attendees DROP CONSTRAINT IF EXISTS event_attendees_event_seat_fkey;
ALTER TABLE event_attendees DROP CONSTRAINT IF EXISTS event_attendees_seat_snapshot_check;
ALTER TABLE event_attendees DROP COLUMN IF EXISTS seat_released_at;
ALTER TABLE event_attendees DROP COLUMN IF EXISTS seat_snapshot;
ALTER TABLE event_attendees DROP COLUMN IF EXISTS event_seat_id;
ALTER TABLE event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_seating_mode_check;
ALTER TABLE event_ticket_types DROP COLUMN IF EXISTS seating_mode;

-- New tables, children first (their triggers and indexes go with them).
DROP TABLE IF EXISTS event_seat_holds;
DROP TABLE IF EXISTS event_seats;
DROP TABLE IF EXISTS event_ticket_type_sections;
DROP TABLE IF EXISTS event_seating;
DROP TABLE IF EXISTS seating_layout_seats;
DROP TABLE IF EXISTS seating_layout_groups;
DROP TABLE IF EXISTS seating_layout_sections;
DROP TABLE IF EXISTS seating_layouts;
DROP TABLE IF EXISTS seating_venues;

DROP FUNCTION IF EXISTS event_attendees_seat_guard();
DROP FUNCTION IF EXISTS event_tt_sections_guard();
DROP FUNCTION IF EXISTS event_ticket_types_seating_guard();
DROP FUNCTION IF EXISTS event_seat_holds_guard();
DROP FUNCTION IF EXISTS event_seats_guard();
DROP FUNCTION IF EXISTS event_seating_guard();
DROP FUNCTION IF EXISTS seating_layout_child_guard();
DROP FUNCTION IF EXISTS seating_layout_guard();
DROP FUNCTION IF EXISTS events_seating_touch_updated_at();

-- Marker and (only if this migration installed it and nothing else depends on it) btree_gist.
DO $$
DECLARE installed boolean := false;
BEGIN
  IF to_regclass('public.events_schema_migrations') IS NOT NULL THEN
    SELECT coalesce((details->>'installed_btree_gist')::boolean, false) INTO installed
      FROM events_schema_migrations WHERE version = 'seating-s1';
    DELETE FROM events_schema_migrations WHERE version = 'seating-s1';
    IF NOT EXISTS (SELECT 1 FROM events_schema_migrations) THEN
      DROP TABLE events_schema_migrations;
    END IF;
  END IF;
  IF coalesce(installed, false) THEN
    BEGIN
      DROP EXTENSION IF EXISTS btree_gist;          -- RESTRICT: fails if anything else uses it
      DROP SCHEMA IF EXISTS events_ext;             -- RESTRICT: fails if not empty
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'btree_gist kept: other objects depend on it';
    END;
  END IF;
END $$;

COMMIT;
