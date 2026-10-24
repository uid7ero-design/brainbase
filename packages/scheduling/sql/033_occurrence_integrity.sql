-- Scheduling Phase 2B.3 — occurrence integrity (version 2b.2.4)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review, after 032_schedule_archive_ordering.sql (2b.2.3). Applied only by the owner, only
--         after separate approval (see docs/architecture/scheduling-occurrence-integrity.md).
--
-- WHAT: replaces ONE function, scheduling_occurrence_integrity() (the BEFORE INSERT guard on occurrences that 031 created). 031 made
--       it check only the resource assignment of a resource-bearing occurrence. Two gaps remained, both reproduced against 031+032:
--         1. nothing refused an occurrence on an ARCHIVED offering or schedule: the repository checked "not archived" only in its own
--            statement (a snapshot read, no lock), and a raw INSERT was accepted;
--         2. an offering or schedule archive in flight did not hold an occurrence creation back, so an occurrence could commit after
--            the archive had already returned (reservations have had this ordering since 031 for offerings and 032 for schedules).
--       After this file an occurrence is created under the same ordering as a reservation: an archive waits for an occurrence in flight,
--       and an occurrence that starts after an archive committed is refused (SCARC; the repository reports offering_unavailable).
--       The resource-assignment check is unchanged. No trigger, table, column, constraint, index or row is touched except the marker.
--
-- CAPACITY (deliberately NOT checked here): an occurrence's capacity is the number of PARTICIPANTS (headcount_per_occurrence presets:
--       classes_coaching, event_capacity). The resource, when there is one, is occupied exclusively for the occurrence's time by its
--       resource hold, whatever the headcount; resource.capacity is the party a reservation of that resource may bring (the
--       party_fits_resource / exclusive_resource presets) and is not a limit on a class's participants. Comparing them would refuse a
--       class of 12 on a court whose capacity is 4. Pinned by a test. Participant capacity itself is enforced per reservation (SCCAP).
--
-- LOCKS: schedule row FOR SHARE, then offering row FOR SHARE, then (for a resource-bearing occurrence) the per-resource advisory lock.
--   Identical to 032's reservation guard: parent before child, then the resource lock, always in that order. The writers of those rows
--   are unchanged (see 032), no writer takes an offering row and then a schedule row, and none takes the resource lock before either,
--   so there is no cycle. scheduling_cancel_occurrence takes the per-occurrence capacity lock and the occurrence row only. FOR SHARE on
--   the schedule or offering never conflicts with the foreign-key KEY SHARE an occurrence takes on it; many creators share the locks.
--
-- REQUIRES: 032 applied (version 2b.2.3). READ COMMITTED (the guard raises SCISO otherwise, for every occurrence now).
-- IDEMPOTENT: CREATE OR REPLACE. One transaction. ROLLBACK: 094_occurrence_integrity_rollback.sql (restores 031's function).
--
-- CUSTOM SQLSTATE CODES: SCARC offering or schedule archived   SCLNK resource not assigned to the offering   SCISO unsafe isolation level

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2b.2.3') THEN
    RAISE EXCEPTION '033_occurrence_integrity.sql needs 032_schedule_archive_ordering.sql (version 2b.2.3) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION scheduling_occurrence_integrity() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  off record;
  sid text;
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_occurrence_integrity requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;

  -- Which schedule the offering belongs to (never changes), read without a lock so the parent can be locked first.
  SELECT o.schedule_id INTO sid FROM scheduling_offerings o
   WHERE o.id = NEW.offering_id AND o.organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the composite foreign key reports a missing or cross-tenant offering
  END IF;

  -- Schedule row, then offering row, both FOR SHARE for the rest of the transaction (see LOCKS above).
  PERFORM 1 FROM scheduling_schedules s WHERE s.id = sid AND s.organisation_id = NEW.organisation_id FOR SHARE;
  SELECT o.archived_at AS offering_archived, s.archived_at AS schedule_archived INTO off
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

  IF NEW.resource_id IS NULL THEN
    RETURN NEW;
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

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.2.4', 'Phase 2B.3 occurrence integrity: no occurrence on an archived offering or schedule, ordered against an archive in flight')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname = 'scheduling_occurrences_integrity') <> 1 THEN
    RAISE EXCEPTION '033_occurrence_integrity.sql: expected the occurrence guard trigger to be enabled';
  END IF;
END $$;

COMMIT;
