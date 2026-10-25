-- Scheduling Phase 2B.3c — partial-day closures (version 2b.3.2)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Applied only by the owner, only after separate approval, and never as part of
--         merging the 2B.3c code. Until it is applied the availability API still works for weekly hours and FULL-DAY closures; a
--         PARTIAL-DAY closure answers 503 PARTIAL_CLOSURES_NOT_READY and writes nothing, and the screen says so.
--
-- WHY A MIGRATION: a closure stores dates and a kind only (scheduling_availability_exceptions has no hours), so "closed 12:00-13:00 on
--   Good Friday" cannot be stored. The product decision for 2B.3c is regular weekly hours + full-day closures + PARTIAL-DAY closures.
--
-- WHAT: two nullable columns (start_time, end_time, a local wall-clock window; both NULL = the whole day, exactly what every existing
--   row means), one CHECK that they are both set or both NULL and that start < end ('24:00' is a valid end), and the exception guard
--   function replaced by a version that compares TIME RANGES as well as dates. Nothing is dropped or rewritten; existing rows keep
--   their meaning (no window = the whole day). No new trigger: scheduling_availability_exceptions_integrity (034) calls the function.
--
-- THE GUARD (replaces 034's function, same locks, same lock order, same SQLSTATE): two closures of one owner overlap when they share a
--   date AND their time ranges overlap, a whole-day closure covering every time. So "closed 12:00-13:00" and "closed 15:00-16:00" on
--   one date coexist, and a whole-day closure cannot coexist with either. Same-kind only, as in 034 (a closure inside an override range
--   is still allowed). Core parity: validateAvailabilityExceptionSet in packages/scheduling/src/availabilityRules.ts.
--
-- ORDER: requires 034 (version 2b.3.1). Do not re-run 034 after this file: it would put the date-only guard back (stricter, never looser).
-- REQUIRES: READ COMMITTED, as 034. IDEMPOTENT: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, constraint added only if missing. One transaction.
-- ROLLBACK: packages/scheduling/sql/096_availability_partial_closures_rollback.sql. It REFUSES while any partial-day closure exists
--   (dropping the columns would silently turn it into a full-day closure): delete those closures first.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.scheduling_availability_exceptions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2b.3.1') THEN
    RAISE EXCEPTION '035_availability_partial_closures.sql needs 034_availability_integrity.sql (version 2b.3.1) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── The window ─────────────────────────────────────────────────────────────

ALTER TABLE scheduling_availability_exceptions ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE scheduling_availability_exceptions ADD COLUMN IF NOT EXISTS end_time time;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_availability_exceptions_window_ck'
                  AND conrelid = 'scheduling_availability_exceptions'::regclass) THEN
    ALTER TABLE scheduling_availability_exceptions ADD CONSTRAINT scheduling_availability_exceptions_window_ck
      CHECK ((start_time IS NULL AND end_time IS NULL)
          OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time));
  END IF;
END $$;

-- ─── The guard, now over time ranges as well as dates ───────────────────────

CREATE OR REPLACE FUNCTION scheduling_availability_exception_integrity() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_availability_exception_integrity requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
                           OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
                           OR NEW.offering_id IS DISTINCT FROM OLD.offering_id) THEN
    RAISE EXCEPTION 'the owner of an availability exception cannot change' USING ERRCODE = 'SCOWN';
  END IF;

  PERFORM scheduling_availability_lock_owner(NEW.organisation_id, NEW.resource_id, NEW.offering_id);

  IF EXISTS (
    SELECT 1 FROM scheduling_availability_exceptions e
     WHERE e.organisation_id = NEW.organisation_id
       AND e.resource_id IS NOT DISTINCT FROM NEW.resource_id
       AND e.offering_id IS NOT DISTINCT FROM NEW.offering_id
       AND e.id <> NEW.id
       AND e.kind = NEW.kind
       AND e.from_date <= NEW.to_date AND NEW.from_date <= e.to_date
       AND COALESCE(e.start_time, '00:00'::time) < COALESCE(NEW.end_time, '24:00'::time)
       AND COALESCE(NEW.start_time, '00:00'::time) < COALESCE(e.end_time, '24:00'::time)
  ) THEN
    RAISE EXCEPTION 'availability exception overlaps another % exception of the same owner', NEW.kind USING ERRCODE = 'SCOVL';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.3.2', 'Phase 2B.3c partial-day closures: start_time/end_time window on availability exceptions, overlap compared over time ranges')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'scheduling_availability_exceptions'
         AND column_name IN ('start_time', 'end_time')) <> 2 THEN
    RAISE EXCEPTION '035_availability_partial_closures.sql: expected the start_time and end_time columns';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname IN ('scheduling_availability_rules_touch', 'scheduling_availability_exceptions_touch',
                        'scheduling_availability_rules_integrity', 'scheduling_availability_exceptions_integrity')) <> 4 THEN
    RAISE EXCEPTION '035_availability_partial_closures.sql: expected the 4 enabled availability triggers of 034';
  END IF;
END $$;

COMMIT;
