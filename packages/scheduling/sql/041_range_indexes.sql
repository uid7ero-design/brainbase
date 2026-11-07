-- Scheduling Phase 2C.4 — range indexes for the booking read side (version 2c.4.1)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Applied only by the owner, only after separate approval, and never as part of merging code.
--         The application is correct whether or not this file is applied: it only makes the 2C.2 range reads fast on large tables.
--
-- WHY: the booking read repository selects reservations and occurrences that overlap a window, ordered by (starts_at, id). A btree on (organisation_id, ends_at) does NOT help
--   (the planner keeps the starts_at-ordered scan and filters most rows away). A GiST index on the half-open range of each row, queried with the range overlap operator
--   (&&), does. Measured on a disposable Neon branch with SYNTHETIC data (not Production), 100k reservations / 50k occurrences for one organisation, a one-week window:
--   about 89-178 ms down to about 1.4 ms for reservations, and about 8-11 ms down to about 1.7 ms for occurrences. See
--   docs/architecture/scheduling-migration-041-range-indexes.md. The holds table already uses the same pattern (scheduling_holds_no_overlap).
--
-- WHAT:
--   * scheduling_reservations_range_gist ON scheduling_reservations USING gist (organisation_id, tstzrange(starts_at, ends_at, '[)'))
--   * scheduling_occurrences_range_gist  ON scheduling_occurrences  USING gist (organisation_id, tstzrange(starts_at, ends_at, '[)'))
--   * one registry row, 2c.4.1.
--   NOTHING existing changes: no table, column, constraint, trigger, function or row. Only two new indexes and one registry row.
--
-- The matching predicate (bookingReadRepository.ts) is tstzrange(starts_at, ends_at, '[)') && tstzrange($from, $to, '[)'). It is exactly equivalent to
--   starts_at < $to AND ends_at > $from   for a non-empty window ($from < $to, which the read validation enforces; ends_at > starts_at is already a CHECK).
--
-- PLAIN CREATE INDEX (not CONCURRENTLY) is intentional: CONCURRENTLY cannot run inside a transaction, and this file is one transaction. It takes a lock that blocks writes to
--   the two tables while it builds. That is acceptable because Production's scheduling tables are empty, so the build is instant. On a large populated database, build the
--   indexes CONCURRENTLY by hand outside a transaction instead.
--
-- REQUIRES 037 (version 2c.3.1) and the btree_gist extension (installed by 010). IDEMPOTENT (apply twice: no change). One transaction.
-- ROLLBACK: packages/scheduling/sql/099_range_indexes_rollback.sql (independent: nothing depends on these indexes).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2c.3.1') THEN
    RAISE EXCEPTION '041_range_indexes.sql needs 037_availability_versions.sql (version 2c.3.1) first'
      USING ERRCODE = 'SCVER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION '041_range_indexes.sql needs the btree_gist extension (installed by 010_shared_schema.sql)'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── The indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS scheduling_reservations_range_gist
  ON scheduling_reservations USING gist (organisation_id, tstzrange(starts_at, ends_at, '[)'));
CREATE INDEX IF NOT EXISTS scheduling_occurrences_range_gist
  ON scheduling_occurrences USING gist (organisation_id, tstzrange(starts_at, ends_at, '[)'));

-- ─── Version marker and verification ────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2c.4.1', 'Phase 2C.4: GiST range indexes on reservations and occurrences for the booking range reads (scheduling_reservations_range_gist, scheduling_occurrences_range_gist)')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.scheduling_reservations_range_gist') IS NULL OR to_regclass('public.scheduling_occurrences_range_gist') IS NULL THEN
    RAISE EXCEPTION '041_range_indexes.sql: expected both range indexes';
  END IF;
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('scheduling_reservations_range_gist', 'scheduling_occurrences_range_gist') AND i.indisvalid) <> 2 THEN
    RAISE EXCEPTION '041_range_indexes.sql: expected both range indexes to be valid';
  END IF;
END $$;

COMMIT;
