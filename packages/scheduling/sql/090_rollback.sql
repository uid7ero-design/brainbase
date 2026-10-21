-- Scheduling Phase 2A — ROLLBACK of 010_shared_schema.sql.
--
-- Drops ONLY objects named scheduling_* (and the scheduling_ext schema if it is empty). It
-- never touches an existing BrainBase/LD Tennis object. On a BrainBase database run
-- scripts/scheduling/190_brainbase_host_rollback.sql FIRST.
--
-- DATA GUARD: if scheduling_reservations has rows the script refuses unless you opt in, in
-- the SAME run:   SET scheduling.rollback_confirm = 'yes';   (put it on the line above BEGIN).
--
-- btree_gist is deliberately NOT dropped: other objects may use it, and leaving it is harmless.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE n bigint := 0;
BEGIN
  IF to_regclass('public.scheduling_reservations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM scheduling_reservations' INTO n;
  END IF;
  IF n > 0 AND COALESCE(current_setting('scheduling.rollback_confirm', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'scheduling_reservations holds % rows; rollback would destroy them. SET scheduling.rollback_confirm = yes to proceed.', n;
  END IF;
END $$;

DROP TABLE IF EXISTS scheduling_resource_holds CASCADE;
DROP TABLE IF EXISTS scheduling_reservations CASCADE;
DROP TABLE IF EXISTS scheduling_series_pauses CASCADE;
DROP TABLE IF EXISTS scheduling_series CASCADE;
DROP TABLE IF EXISTS scheduling_occurrences CASCADE;
DROP TABLE IF EXISTS scheduling_availability_exceptions CASCADE;
DROP TABLE IF EXISTS scheduling_availability_rules CASCADE;
DROP TABLE IF EXISTS scheduling_offering_resources CASCADE;
DROP TABLE IF EXISTS scheduling_offerings CASCADE;
DROP TABLE IF EXISTS scheduling_resources CASCADE;
DROP TABLE IF EXISTS scheduling_schedules CASCADE;
DROP TABLE IF EXISTS scheduling_settings CASCADE;
DROP TABLE IF EXISTS scheduling_schema_migrations CASCADE;

DROP FUNCTION IF EXISTS scheduling_cancel_occurrence(text, text, text);
DROP FUNCTION IF EXISTS scheduling_occurrence_release_holds();
DROP FUNCTION IF EXISTS scheduling_occurrence_guard();
DROP FUNCTION IF EXISTS scheduling_hold_serialise();
DROP FUNCTION IF EXISTS scheduling_hold_guard();
DROP FUNCTION IF EXISTS scheduling_require_hold();
DROP FUNCTION IF EXISTS scheduling_reservation_release_holds();
DROP FUNCTION IF EXISTS scheduling_reservation_lifecycle();
DROP FUNCTION IF EXISTS scheduling_reservation_guard();
DROP FUNCTION IF EXISTS scheduling_touch_updated_at();
DROP FUNCTION IF EXISTS scheduling_is_timezone(text);

-- Remove the helper schema only if nothing lives in it (an extension installed there keeps it
-- alive; the check below skips the drop in that case, which is the safe outcome).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = 'scheduling_ext')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'scheduling_ext') THEN
    DROP SCHEMA IF EXISTS scheduling_ext;
  END IF;
END $$;

COMMIT;
