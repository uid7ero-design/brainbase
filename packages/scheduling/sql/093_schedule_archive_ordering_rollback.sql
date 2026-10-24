-- Scheduling Phase 2B.2 — ROLLBACK of 032_schedule_archive_ordering.sql.
--
-- Restores the scheduling_reservation_integrity() function exactly as 031_reservation_integrity.sql created it (offering row
-- locked FOR SHARE, schedule row read without a lock) and removes the 2b.2.3 version marker. No trigger, table, column, row or
-- constraint is touched, so no booking data is affected. After it the schema behaves as at version 2b.2.2. Idempotent.
-- Needs 031 (the trigger that calls the function) to be in place. lock_timeout makes it fail fast instead of queueing.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION scheduling_reservation_integrity() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  off record;
  res record;
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_reservation_integrity requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;

  -- The offering row is locked FOR SHARE for the rest of the transaction (see LOCKS above).
  SELECT o.archived_at AS offering_archived, s.archived_at AS schedule_archived, s.preset_key INTO off
    FROM scheduling_offerings o
    JOIN scheduling_schedules s ON s.id = o.schedule_id AND s.organisation_id = o.organisation_id
   WHERE o.id = NEW.offering_id AND o.organisation_id = NEW.organisation_id
     FOR SHARE OF o;
  IF NOT FOUND THEN
    RETURN NEW; -- the composite foreign key reports a missing or cross-tenant offering
  END IF;
  IF off.offering_archived IS NOT NULL OR off.schedule_archived IS NOT NULL THEN
    RAISE EXCEPTION 'offering % is archived', NEW.offering_id USING ERRCODE = 'SCARC';
  END IF;
  -- The preset a reservation records is the preset of its schedule. (The version is recorded for later migration decisions and
  -- is deliberately not compared: a preset definition may be revised while old schedules keep the version they were made under.)
  IF NEW.preset_key IS DISTINCT FROM off.preset_key THEN
    RAISE EXCEPTION 'reservation preset % is not the preset of its schedule (%)', NEW.preset_key, off.preset_key USING ERRCODE = 'SCPRE';
  END IF;

  IF NEW.resource_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || NEW.organisation_id || ':' || NEW.resource_id, 0));
    SELECT capacity, min_party INTO res FROM scheduling_resources WHERE id = NEW.resource_id AND organisation_id = NEW.organisation_id;
    IF NOT FOUND THEN
      RETURN NEW; -- the foreign key reports a missing or cross-tenant resource
    END IF;
    IF NEW.party_size > res.capacity OR (res.min_party IS NOT NULL AND NEW.party_size < res.min_party) THEN
      RAISE EXCEPTION 'a party of % does not fit resource % (capacity %, minimum %)', NEW.party_size, NEW.resource_id, res.capacity, COALESCE(res.min_party, 1)
        USING ERRCODE = 'SCPTY';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM scheduling_offering_resources l
                    WHERE l.organisation_id = NEW.organisation_id AND l.offering_id = NEW.offering_id AND l.resource_id = NEW.resource_id) THEN
      RAISE EXCEPTION 'resource % is not assigned to offering %', NEW.resource_id, NEW.offering_id USING ERRCODE = 'SCLNK';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.2.3';
  END IF;
END $$;

COMMIT;
