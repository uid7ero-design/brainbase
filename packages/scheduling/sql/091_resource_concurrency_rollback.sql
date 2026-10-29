-- Scheduling Phase 2B.2 — ROLLBACK of 030_resource_concurrency.sql.
--
-- Removes ONLY the 4 triggers, 5 functions and the 2b.2.1 version marker that 030 added. No table, column, row or constraint is
-- touched, so no booking data is affected. After it the schema behaves exactly as at version 2a.2 (the Phase 2B.2a repository
-- guards still apply; the database-level backstops and the race protection are gone). Idempotent.
-- Safe to run while the schema is in use: DROP TRIGGER takes a short lock on the table; lock_timeout makes it fail fast.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS scheduling_resources_guard ON scheduling_resources;
DROP TRIGGER IF EXISTS scheduling_holds_resource_state ON scheduling_resource_holds;
DROP TRIGGER IF EXISTS scheduling_offering_resources_guard ON scheduling_offering_resources;
DROP TRIGGER IF EXISTS scheduling_offering_resources_release_guard ON scheduling_offering_resources;

DROP FUNCTION IF EXISTS scheduling_resource_guard();
DROP FUNCTION IF EXISTS scheduling_hold_resource_state();
DROP FUNCTION IF EXISTS scheduling_link_guard();
DROP FUNCTION IF EXISTS scheduling_link_release_guard();
DROP FUNCTION IF EXISTS scheduling_preset_allows_resource_kind(text, text);

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.2.1';
  END IF;
END $$;

COMMIT;
