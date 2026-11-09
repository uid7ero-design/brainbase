-- Scheduling Phase 2C.4 — ROLLBACK of 041_range_indexes.sql.
--
-- Drops the two GiST range indexes and the 2c.4.1 version marker. No table, column, row or other index is touched. It is INDEPENDENT: nothing depends on these indexes, and the
-- booking range reads return the same rows without them (only slower on large tables). Idempotent.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS scheduling_reservations_range_gist;
DROP INDEX IF EXISTS scheduling_occurrences_range_gist;

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2c.4.1';
  END IF;
END $$;

COMMIT;
