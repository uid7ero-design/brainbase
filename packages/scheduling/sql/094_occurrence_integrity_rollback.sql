-- Scheduling Phase 2B.3 — ROLLBACK of 033_occurrence_integrity.sql.
--
-- Restores the scheduling_occurrence_integrity() function exactly as 031_reservation_integrity.sql created it (a resource-bearing
-- occurrence must use a resource its offering is assigned; no archive check) and removes the 2b.2.4 version marker. No trigger, table,
-- column, row or constraint is touched, so no occurrence or reservation data is affected. After it the schema behaves as at version
-- 2b.2.3. Idempotent. Needs 031 (the trigger that calls the function) to be in place. lock_timeout makes it fail fast.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION scheduling_occurrence_integrity() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
BEGIN
  IF NEW.resource_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_occurrence_integrity requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || NEW.organisation_id || ':' || NEW.resource_id, 0));
  IF NOT EXISTS (SELECT 1 FROM scheduling_offering_resources l
                  WHERE l.organisation_id = NEW.organisation_id AND l.offering_id = NEW.offering_id AND l.resource_id = NEW.resource_id)
     AND EXISTS (SELECT 1 FROM scheduling_resources r WHERE r.id = NEW.resource_id AND r.organisation_id = NEW.organisation_id) THEN
    RAISE EXCEPTION 'resource % is not assigned to offering %', NEW.resource_id, NEW.offering_id USING ERRCODE = 'SCLNK';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.2.4';
  END IF;
END $$;

COMMIT;
