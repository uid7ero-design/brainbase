-- Scheduling Phase 2B.0 — rollback of 120_brainbase_capability.sql.
-- Removes the 'scheduling' row from modules and the 2b.0-capability marker. It REFUSES while any organisation_modules
-- row still references the capability: disable and remove those rows deliberately first (the foreign key from
-- organisation_modules.module_key is ON DELETE RESTRICT, so Postgres would refuse anyway; this gives the clear reason).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.organisation_modules') IS NOT NULL THEN
    SELECT count(*) INTO n FROM organisation_modules WHERE module_key = 'scheduling';
    IF n > 0 THEN
      RAISE EXCEPTION 'organisation_modules still holds % row(s) for scheduling; disable and remove them first', n;
    END IF;
  END IF;
  IF to_regclass('public.modules') IS NOT NULL THEN
    DELETE FROM modules WHERE key = 'scheduling';
  END IF;
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.0-capability';
  END IF;
END $$;

COMMIT;
