-- Scheduling Phase 2B.2 — schedule archive ordering (version 2b.2.3)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review, after 031_reservation_integrity.sql (2b.2.2). Applied only by the owner, only
--         after separate approval (see docs/architecture/scheduling-schedule-archive-ordering.md).
--
-- WHAT: replaces ONE function, scheduling_reservation_integrity() (the BEFORE INSERT guard on reservations that 031 created), so
--       that it also locks the SCHEDULE row FOR SHARE. 031 locked only the offering row, so archiving a schedule and creating a
--       reservation for one of its offerings never waited for each other: a reservation could commit after archiveSchedule had
--       already returned. After this file an archive waits for a reservation in flight, and a reservation that starts after the
--       archive committed is refused (SCARC, offering_unavailable). Every other check in the function is unchanged, byte for byte.
--       No trigger, table, column, constraint, index or row is touched except the version marker.
--
-- LOCKS: schedule row FOR SHARE, then offering row FOR SHARE, then (for a resource booking) the per-resource advisory lock.
--   Parent before child, then the resource lock, always in that order. The writers of those rows are:
--     createOffering   UPDATE schedule (exclusive), then INSERT of a NEW offering row     -> schedule -> (new row), same order
--     updateSchedule / archiveSchedule   the schedule row only
--     updateOffering / archiveOffering   the offering row only (the schedule is read, not locked)
--   No writer takes an offering row and then a schedule row, and none takes the resource lock before either, so there is no cycle.
--   FOR SHARE on the schedule never conflicts with the foreign-key KEY SHARE a reservation or offering takes on it, and many
--   reservations share it concurrently; only a schedule UPDATE (an edit or an archive) waits for them, briefly.
--
-- REQUIRES: 031 applied (version 2b.2.2). READ COMMITTED (the guard raises SCISO otherwise).
-- IDEMPOTENT: CREATE OR REPLACE. One transaction. ROLLBACK: 093_schedule_archive_ordering_rollback.sql (restores 031's function).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2b.2.2') THEN
    RAISE EXCEPTION '032_schedule_archive_ordering.sql needs 031_reservation_integrity.sql (version 2b.2.2) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION scheduling_reservation_integrity() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  off record;
  res record;
  sid text;
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_reservation_integrity requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;

  -- Which schedule the offering belongs to (never changes), read without a lock so the parent can be locked first.
  SELECT o.schedule_id INTO sid FROM scheduling_offerings o
   WHERE o.id = NEW.offering_id AND o.organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the composite foreign key reports a missing or cross-tenant offering
  END IF;

  -- Schedule row, then offering row, both FOR SHARE for the rest of the transaction (see LOCKS above).
  PERFORM 1 FROM scheduling_schedules s WHERE s.id = sid AND s.organisation_id = NEW.organisation_id FOR SHARE;
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

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.2.3', 'Phase 2B.2 schedule archive ordering: the reservation guard also locks the schedule row FOR SHARE, so a schedule archive and a new reservation wait for each other')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname = 'scheduling_reservations_integrity') <> 1 THEN
    RAISE EXCEPTION '032_schedule_archive_ordering.sql: expected the enabled trigger scheduling_reservations_integrity (031)';
  END IF;
END $$;

COMMIT;
