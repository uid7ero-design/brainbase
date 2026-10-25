-- Scheduling Phase 2B.3b — availability rule and exception integrity (version 2b.3.1)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Applied only by the owner, only after separate approval, and never as part of
--         merging the 2B.3b code (see docs/architecture/scheduling-phase2b3b-availability-api.md). Until it is applied, every
--         availability route answers 503 AVAILABILITY_NOT_READY and writes nothing.
--
-- WHY A MIGRATION (the reviewed need): the 2B.3b API needs two things the 2a.2 schema cannot give it.
--   1. A VERSION TOKEN. scheduling_availability_rules and scheduling_availability_exceptions have no updated_at, so an edit cannot be
--      refused when the row changed since it was read (expectedUpdatedAt). Every other editable scheduling table has one.
--   2. SERIALISED OVERLAP CHECKING. "No two rules of one owner overlap" is a rule over SEVERAL rows. A single INSERT ... WHERE NOT EXISTS
--      reads a snapshot taken before a concurrent writer commits, so two concurrent overlapping inserts both pass it. The repository
--      issues one statement per operation (no interactive transaction), so the check must live where the writer can take a lock first:
--      a trigger. Same technique, same lock family and same ordering rules as 030-033.
--
-- WHAT: 2 columns, 2 touch triggers, 2 guard functions and 2 guard triggers. Nothing is dropped or rewritten. Existing rows get
--       updated_at = the time of this migration (a valid first version). Existing rows are never re-validated: the guards act on
--       writes only. The pilot organisation has no availability rows, so no row is affected there.
--
-- THE GUARDS (INSERT and UPDATE; DELETE is deliberately unguarded so that availability can always be REMOVED):
--   rules:       same weekday, [start, end) overlapping, validity dates overlapping, same owner  -> SCOVL
--   exceptions:  same owner and same kind with a common date                                     -> SCOVL
--   both:        the owner of a row can never change (SCOWN); an ARCHIVED offering (or archived schedule) or an INACTIVE resource
--                takes no new or changed availability (SCARC / SCRES).
--   Core parity: packages/scheduling/src/availabilityRules.ts (validateAvailabilityRuleSet / validateAvailabilityExceptionSet) states
--   the same rules for the application; tests/availabilityIntegrity.integration.test.ts proves the two agree on generated cases.
--
-- LOCKS (deadlock-freedom, verified by the concurrency tests):
--   resource owner: the per-resource advisory lock of 010/030 (pg_advisory_xact_lock on 'scheduling_resource:<org>:<id>'). It serialises
--     availability writers of one resource AND orders them against a deactivation (030 takes the same lock before it decides).
--   offering owner: a per-offering availability advisory lock ('scheduling_availability:<org>:<id>'), THEN the schedule row and the offering
--     row FOR SHARE (the order of 032/033), so an archive in flight and an availability write wait for each other.
--   A function takes the owner lock BEFORE it reads anything it guards, and at most one advisory lock. The availability lock family is never
--   held together with another advisory lock by one statement; row locks are taken parent before child, as in 032.
--
-- REQUIRES: 010_shared_schema.sql (version 2a.2). READ COMMITTED (the guards raise SCISO under REPEATABLE READ or SERIALIZABLE).
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE; the marker uses ON CONFLICT DO NOTHING. One transaction.
-- ROLLBACK: packages/scheduling/sql/095_availability_integrity_rollback.sql (removes the triggers, functions and the two columns).
--
-- CUSTOM SQLSTATE CODES: SCOVL overlap   SCOWN owner cannot change   SCARC offering or schedule archived   SCRES resource inactive   SCISO unsafe isolation

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.scheduling_availability_rules') IS NULL
     OR NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2a.2') THEN
    RAISE EXCEPTION '034_availability_integrity.sql needs the 2a.2 scheduling schema (010_shared_schema.sql) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── Version tokens ──────────────────────────────────────────────────────────

ALTER TABLE scheduling_availability_rules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE scheduling_availability_exceptions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE TRIGGER scheduling_availability_rules_touch BEFORE UPDATE ON scheduling_availability_rules
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();
CREATE OR REPLACE TRIGGER scheduling_availability_exceptions_touch BEFORE UPDATE ON scheduling_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION scheduling_touch_updated_at();

-- ─── The owner lock and owner state check shared by both guards ─────────────

CREATE OR REPLACE FUNCTION scheduling_availability_lock_owner(p_org text, p_resource text, p_offering text) RETURNS void
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  st record;
  sid text;
BEGIN
  IF p_resource IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || p_org || ':' || p_resource, 0));
    IF EXISTS (SELECT 1 FROM scheduling_resources r WHERE r.id = p_resource AND r.organisation_id = p_org AND r.active = false) THEN
      RAISE EXCEPTION 'resource % is inactive', p_resource USING ERRCODE = 'SCRES';
    END IF;
    RETURN; -- a missing or cross-tenant resource is reported by the composite foreign key
  END IF;

  IF p_offering IS NULL THEN
    RETURN; -- the owner CHECK constraint reports a row with no owner
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_availability:' || p_org || ':' || p_offering, 0));
  SELECT o.schedule_id INTO sid FROM scheduling_offerings o WHERE o.id = p_offering AND o.organisation_id = p_org;
  IF NOT FOUND THEN
    RETURN; -- the composite foreign key reports a missing or cross-tenant offering
  END IF;
  PERFORM 1 FROM scheduling_schedules s WHERE s.id = sid AND s.organisation_id = p_org FOR SHARE;
  SELECT o.archived_at AS offering_archived, s.archived_at AS schedule_archived INTO st
    FROM scheduling_offerings o
    JOIN scheduling_schedules s ON s.id = o.schedule_id AND s.organisation_id = o.organisation_id
   WHERE o.id = p_offering AND o.organisation_id = p_org
     FOR SHARE OF o;
  IF st.offering_archived IS NOT NULL OR st.schedule_archived IS NOT NULL THEN
    RAISE EXCEPTION 'offering % is archived', p_offering USING ERRCODE = 'SCARC';
  END IF;
END;
$$;

-- ─── Rules ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scheduling_availability_rule_integrity() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_availability_rule_integrity requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
                           OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
                           OR NEW.offering_id IS DISTINCT FROM OLD.offering_id) THEN
    RAISE EXCEPTION 'the owner of an availability rule cannot change' USING ERRCODE = 'SCOWN';
  END IF;

  PERFORM scheduling_availability_lock_owner(NEW.organisation_id, NEW.resource_id, NEW.offering_id);

  -- A fresh READ COMMITTED snapshot per statement inside the function: whoever got the lock second sees the first one's committed rows.
  IF EXISTS (
    SELECT 1 FROM scheduling_availability_rules r
     WHERE r.organisation_id = NEW.organisation_id
       AND r.resource_id IS NOT DISTINCT FROM NEW.resource_id
       AND r.offering_id IS NOT DISTINCT FROM NEW.offering_id
       AND r.id <> NEW.id
       AND r.day_of_week = NEW.day_of_week
       AND r.start_time < NEW.end_time AND NEW.start_time < r.end_time
       AND COALESCE(r.valid_from, '-infinity'::date) <= COALESCE(NEW.valid_to, 'infinity'::date)
       AND COALESCE(NEW.valid_from, '-infinity'::date) <= COALESCE(r.valid_to, 'infinity'::date)
  ) THEN
    RAISE EXCEPTION 'availability rule overlaps another rule of the same owner' USING ERRCODE = 'SCOVL';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER scheduling_availability_rules_integrity BEFORE INSERT OR UPDATE ON scheduling_availability_rules
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_rule_integrity();

-- ─── Exceptions ──────────────────────────────────────────────────────────────

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

CREATE OR REPLACE TRIGGER scheduling_availability_exceptions_integrity BEFORE INSERT OR UPDATE ON scheduling_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_exception_integrity();

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.3.1', 'Phase 2B.3b availability integrity: updated_at version tokens, no overlapping rules or same-kind exceptions per owner, no availability on an archived offering or inactive resource')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname IN ('scheduling_availability_rules_touch', 'scheduling_availability_exceptions_touch',
                        'scheduling_availability_rules_integrity', 'scheduling_availability_exceptions_integrity')) <> 4 THEN
    RAISE EXCEPTION '034_availability_integrity.sql: expected 4 enabled availability triggers';
  END IF;
END $$;

COMMIT;
