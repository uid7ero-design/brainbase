-- Scheduling Phase 2A — rollback of 110_brainbase_host.sql.
-- Drops only the three organisation foreign keys and the host version marker. The scheduling
-- tables and their data are untouched (use packages/scheduling/sql/090_rollback.sql for those).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE IF EXISTS scheduling_settings  DROP CONSTRAINT IF EXISTS scheduling_settings_organisation_fk;
ALTER TABLE IF EXISTS scheduling_schedules DROP CONSTRAINT IF EXISTS scheduling_schedules_organisation_fk;
ALTER TABLE IF EXISTS scheduling_resources DROP CONSTRAINT IF EXISTS scheduling_resources_organisation_fk;

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2a.1-brainbase';
  END IF;
END $$;

COMMIT;
