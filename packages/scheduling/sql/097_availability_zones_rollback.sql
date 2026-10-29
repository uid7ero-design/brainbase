-- Scheduling Phase 2B.3d groundwork — ROLLBACK of 036_availability_zones.sql.
--
-- Removes the two "availability needs a pin" triggers, the immutability trigger, the two functions, the scheduling_availability_zones table and the
-- 2b.3.3 version marker. No rule, closure, schedule, offering, resource or organisation row is touched. After it, availability is read in the
-- zone the reader resolves (the schedule's override, else the organisation's, else the fallback) and creating availability answers 503
-- AVAILABILITY_ZONES_NOT_READY again.
--
-- It REFUSES, changing nothing (SQLSTATE SCVER), while any owner that HAS availability is pinned to a zone different from the one the reader would
-- resolve for it after the rollback: dropping the pin would silently re-read those hours in another zone. (Where there is no
-- organisations.timezone to compare with, it refuses while any owner with availability is pinned at all.) Pins of owners with no availability carry
-- no meaning and are dropped. Run this BEFORE 096 and 095. Idempotent.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  moved integer := 0;
  fallback constant text := 'Australia/Adelaide'; -- BRAINBASE_FALLBACK_TIMEZONE
  host boolean := to_regclass('public.organisations') IS NOT NULL
                  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'organisations' AND column_name = 'timezone');
BEGIN
  IF to_regclass('public.scheduling_availability_zones') IS NULL THEN
    RETURN;
  END IF;
  IF NOT host THEN
    SELECT count(*) INTO moved FROM scheduling_availability_zones z
     WHERE EXISTS (SELECT 1 FROM scheduling_availability_rules r WHERE r.organisation_id = z.organisation_id AND COALESCE(r.resource_id, r.offering_id) = z.owner_id)
        OR EXISTS (SELECT 1 FROM scheduling_availability_exceptions e WHERE e.organisation_id = z.organisation_id AND COALESCE(e.resource_id, e.offering_id) = z.owner_id);
  ELSE
    EXECUTE $q$
      SELECT count(*) FROM scheduling_availability_zones z
        LEFT JOIN scheduling_offerings o ON o.id = z.offering_id AND o.organisation_id = z.organisation_id
        LEFT JOIN scheduling_schedules s ON s.id = o.schedule_id AND s.organisation_id = o.organisation_id
        LEFT JOIN organisations org ON org.id = z.organisation_id
       WHERE (EXISTS (SELECT 1 FROM scheduling_availability_rules r WHERE r.organisation_id = z.organisation_id AND COALESCE(r.resource_id, r.offering_id) = z.owner_id)
           OR EXISTS (SELECT 1 FROM scheduling_availability_exceptions e WHERE e.organisation_id = z.organisation_id AND COALESCE(e.resource_id, e.offering_id) = z.owner_id))
         AND z.timezone IS DISTINCT FROM COALESCE(CASE WHEN z.offering_id IS NOT NULL THEN s.timezone END, org.timezone, $1)
    $q$ INTO moved USING fallback;
  END IF;
  IF moved > 0 THEN
    RAISE EXCEPTION '097_availability_zones_rollback.sql: % owner(s) with availability are pinned to a zone the reader would not resolve; rolling back would re-read their hours in another zone', moved
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

DROP TRIGGER IF EXISTS scheduling_availability_rules_zone ON scheduling_availability_rules;
DROP TRIGGER IF EXISTS scheduling_availability_exceptions_zone ON scheduling_availability_exceptions;
DROP TABLE IF EXISTS scheduling_availability_zones;
DROP FUNCTION IF EXISTS scheduling_availability_zone_required();
DROP FUNCTION IF EXISTS scheduling_availability_zone_guard();

DO $$
BEGIN
  IF to_regclass('public.scheduling_schema_migrations') IS NOT NULL THEN
    DELETE FROM scheduling_schema_migrations WHERE version = '2b.3.3';
  END IF;
END $$;

COMMIT;
