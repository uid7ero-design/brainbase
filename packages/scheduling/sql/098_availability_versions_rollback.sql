-- Scheduling Phase 2C.3 groundwork — ROLLBACK of 037_availability_versions.sql.
--
-- Removes the eight version triggers, the four functions, the scheduling_availability_versions table and the 2c.3.1 version marker. No rule, closure, pin, link, schedule,
-- offering, resource, reservation or hold row is touched, and no existing trigger or edit token changes. It is INDEPENDENT: nothing else depends on the version table. Booking
-- code that reads it must be switched off (its feature flag) BEFORE this runs; with the table gone such a statement fails closed rather than booking unguarded.
-- Idempotent.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS scheduling_resources_active_bump ON scheduling_resources;
DROP TRIGGER IF EXISTS scheduling_offering_resources_bump_version ON scheduling_offering_resources;
DROP TRIGGER IF EXISTS scheduling_availability_zones_bump_version ON scheduling_availability_zones;
DROP TRIGGER IF EXISTS scheduling_availability_exceptions_bump_version ON scheduling_availability_exceptions;
DROP TRIGGER IF EXISTS scheduling_availability_rules_bump_version ON scheduling_availability_rules;
DROP TRIGGER IF EXISTS scheduling_resources_version_row ON scheduling_resources;
DROP TRIGGER IF EXISTS scheduling_offerings_version_row ON scheduling_offerings;
DROP TABLE IF EXISTS scheduling_availability_versions;
DROP FUNCTION IF EXISTS scheduling_resource_active_bump();
DROP FUNCTION IF EXISTS scheduling_bump_availability_version();
DROP FUNCTION IF EXISTS scheduling_bump_availability_version_of(text, text, text);
DROP FUNCTION IF EXISTS scheduling_availability_version_row();
DROP FUNCTION IF EXISTS scheduling_availability_version_guard();

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2c.3.1';
  END IF;
END $$;

COMMIT;
