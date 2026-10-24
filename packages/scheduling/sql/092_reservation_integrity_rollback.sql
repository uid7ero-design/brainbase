-- Scheduling Phase 2B.2 — ROLLBACK of 031_reservation_integrity.sql.
--
-- Removes ONLY the 3 triggers, 3 functions and the 2b.2.2 version marker that 031 added. No table, column, row or constraint is
-- touched, so no booking data is affected. After it the schema behaves as at version 2b.2.1 (030 stays in place). Idempotent.
-- lock_timeout makes it fail fast instead of queueing behind a long transaction.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS scheduling_reservations_integrity ON scheduling_reservations;
DROP TRIGGER IF EXISTS scheduling_occurrences_integrity ON scheduling_occurrences;
DROP TRIGGER IF EXISTS scheduling_resources_capacity_guard ON scheduling_resources;

DROP FUNCTION IF EXISTS scheduling_reservation_integrity();
DROP FUNCTION IF EXISTS scheduling_occurrence_integrity();
DROP FUNCTION IF EXISTS scheduling_resource_capacity_guard();

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.2.2';
  END IF;
END $$;

COMMIT;
