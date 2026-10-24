-- Scheduling Phase 2B.2 — reservation integrity (version 2b.2.2)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review, after 030_resource_concurrency.sql (2b.2.1). Applied only by the owner, only
--         after separate approval (see docs/architecture/scheduling-reservation-integrity.md).
--
-- WHAT: 3 functions and 3 triggers, all named scheduling_*, closing the findings 030 left open:
--         1. a reservation's party size is never checked against the resource's capacity / minimum party, and a capacity change can
--            race a new reservation;
--         2. a staff reservation (or an occurrence) can use a resource the offering is not assigned to (only the customer path
--            checked);
--         3. a reservation's preset snapshot is free text, tied to nothing;
--         4. an offering can be archived while a reservation is being created for it.
--       Nothing is altered, dropped or replaced; no row is read or written except the version marker. It guards NEW writes only:
--       existing rows are never re-validated (Production holds none).
--
-- LOCKS (same family and ordering rules as 030, which this file relies on):
--   * the per-resource advisory lock (scheduling_resource:<organisation>:<resource>), taken before the reads it guards, at most
--     one advisory lock per function;
--   * the OFFERING row, FOR SHARE, taken by the reservation guard BEFORE the advisory lock: an archive (an UPDATE of that row)
--     waits for an in-flight reservation, and a reservation that starts after an archive committed sees it. FOR SHARE on the
--     offering never conflicts with the foreign-key KEY SHARE a hold or reservation takes on it. Order is always
--     offering row -> resource lock; no function takes them the other way round, so there is no cycle.
--
-- REQUIRES: 030 applied (version 2b.2.1). READ COMMITTED (the guards raise SCISO otherwise).
-- IDEMPOTENT: CREATE OR REPLACE throughout. One transaction. ROLLBACK: 092_reservation_integrity_rollback.sql.
--
-- CUSTOM SQLSTATE CODES raised by this file (mapped by the adapter):
--   SCPTY party size does not fit the resource   SCLNK resource not assigned to the offering
--   SCPRE reservation preset differs from its schedule's preset   SCARC offering or schedule archived
--   SCRIU (030's code) a resource capacity / minimum party change under a live reservation it would no longer fit

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2b.2.1') THEN
    RAISE EXCEPTION '031_reservation_integrity.sql needs 030_resource_concurrency.sql (version 2b.2.1) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── BEFORE INSERT on reservations ───────────────────────────────────────────────────────────────────────────────────────

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

-- ─── BEFORE INSERT on occurrences: a resource-bearing occurrence uses a resource its offering is assigned ──────────────

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

-- ─── BEFORE UPDATE OF capacity, min_party on resources ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scheduling_resource_capacity_guard() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
BEGIN
  IF NEW.capacity IS NOT DISTINCT FROM OLD.capacity AND NEW.min_party IS NOT DISTINCT FROM OLD.min_party THEN
    RETURN NEW;
  END IF;
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_resource_capacity_guard requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || OLD.organisation_id || ':' || OLD.id, 0));
  -- a live reservation's party must still fit (past or released holds are history)
  IF EXISTS (
       SELECT 1 FROM scheduling_resource_holds h
         JOIN scheduling_reservations v ON v.organisation_id = h.organisation_id AND v.id = h.reservation_id
        WHERE h.organisation_id = OLD.organisation_id AND h.resource_id = OLD.id
          AND h.released_at IS NULL AND upper(h.during) > now()
          AND (v.party_size > NEW.capacity OR v.party_size < COALESCE(NEW.min_party, 0))) THEN
    RAISE EXCEPTION 'a live reservation of resource % would no longer fit its new capacity', OLD.id USING ERRCODE = 'SCRIU';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER scheduling_reservations_integrity BEFORE INSERT ON scheduling_reservations
  FOR EACH ROW EXECUTE FUNCTION scheduling_reservation_integrity();
CREATE OR REPLACE TRIGGER scheduling_occurrences_integrity BEFORE INSERT ON scheduling_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling_occurrence_integrity();
CREATE OR REPLACE TRIGGER scheduling_resources_capacity_guard BEFORE UPDATE OF capacity, min_party ON scheduling_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_resource_capacity_guard();

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.2.2', 'Phase 2B.2 reservation integrity: party fits the resource, resource assigned to the offering, reservation preset equals its schedule preset, no reservation on an archived offering')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname IN ('scheduling_reservations_integrity', 'scheduling_occurrences_integrity', 'scheduling_resources_capacity_guard')) <> 3 THEN
    RAISE EXCEPTION '031_reservation_integrity.sql: expected 3 enabled triggers';
  END IF;
END $$;

COMMIT;
