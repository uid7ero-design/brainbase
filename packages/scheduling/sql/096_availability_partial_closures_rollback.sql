-- Scheduling Phase 2B.3c — ROLLBACK of 035_availability_partial_closures.sql.
--
-- Restores the date-only exception guard of 034 (its function body, verbatim), then drops the window constraint and the two columns,
-- and removes the 2b.3.2 version marker. 034 itself stays in force. It REFUSES, changing nothing, while any partial-day closure exists:
-- dropping the columns would turn "closed 12:00-13:00" into "closed all day". Delete or edit those closures first. Idempotent.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'scheduling_availability_exceptions' AND column_name = 'start_time') THEN
    IF EXISTS (SELECT 1 FROM scheduling_availability_exceptions WHERE start_time IS NOT NULL OR end_time IS NOT NULL) THEN
      RAISE EXCEPTION '096_availability_partial_closures_rollback.sql: partial-day closures exist; remove them first (rolling back would make them full-day closures)'
        USING ERRCODE = 'SCVER';
    END IF;
  END IF;
END $$;

-- The guard first: it must stop naming the columns before they go (034's body, verbatim).
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
  ) THEN
    RAISE EXCEPTION 'availability exception overlaps another % exception of the same owner', NEW.kind USING ERRCODE = 'SCOVL';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE scheduling_availability_exceptions DROP CONSTRAINT IF EXISTS scheduling_availability_exceptions_window_ck;
ALTER TABLE scheduling_availability_exceptions DROP COLUMN IF EXISTS start_time;
ALTER TABLE scheduling_availability_exceptions DROP COLUMN IF EXISTS end_time;

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.3.2';
  END IF;
END $$;

COMMIT;
