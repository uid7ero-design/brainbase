-- Scheduling Phase 2B.3d groundwork — owner-pinned availability zones (version 2b.3.3)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Applied only by the owner, only after separate approval, and never as part of merging
--         code. Until it is applied, creating availability (a rule, an overnight window, a closure) answers 503 AVAILABILITY_ZONES_NOT_READY
--         and writes nothing; reading, editing and removing existing availability is unaffected (there is none in Production).
--
-- WHY: weekly hours are wall-clock times with no zone. Today the zone is looked up on every read (the schedule's override, else the
--   organisation's, else a fallback), so a saved rule silently changes meaning when either setting later changes, and a resource, which
--   belongs to the organisation and not to a schedule, has no zone of its own. This file gives each OWNER (an offering or a resource) its own
--   pinned zone, decided once when its first availability is saved and never inferred again. Design: docs/architecture/scheduling-availability-timezone-pinning.md
--   (model C1).
--
-- WHAT:
--   * one new module-owned table, scheduling_availability_zones: one row per owner (resource_id XOR offering_id), the IANA zone its hours are
--     read in, how it was pinned (first_rule | first_closure | backfill), who, and when. Composite foreign keys to the owner carry the organisation,
--     so a pin can never name another organisation's resource or offering. Nothing is written to organisations, scheduling_schedules,
--     scheduling_resources or scheduling_offerings: no timezone field and no version token moves.
--   * immutability: a pin cannot be changed (zone, owner, organisation, source, who, when; an UPDATE that changes nothing is allowed), and cannot be deleted while its owner exists (it goes only with
--     its owner). Changing a zone is NOT possible here: it needs a reviewed conversion (see the design document, "Changing a pinned zone").
--   * availability needs a pin: a BEFORE INSERT trigger on scheduling_availability_rules and scheduling_availability_exceptions refuses a row
--     whose owner has no pin (SQLSTATE SCZON). The application writes the pin and the first rule in ONE statement (a CTE), so they commit
--     together or not at all; the trigger makes the same true for any other writer.
--   * BACKFILL: an owner that already has availability gets a pin holding the zone today's reader resolves for it (the schedule's override,
--     else organisations.timezone, else the platform fallback 'Australia/Adelaide'), so existing hours keep the meaning they have now. Where
--     there is no organisations table to resolve from and availability exists, this file REFUSES (SCVER) rather than guess. Production has no
--     availability, so the backfill is empty there (the preflight asserts it).
--
-- REQUIRES 034 (version 2b.3.1). Independent of 035. IDEMPOTENT. One transaction. Needs READ COMMITTED like 034.
-- ROLLBACK: packages/scheduling/sql/097_availability_zones_rollback.sql (run it BEFORE 096 and 095; see the handoff).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.scheduling_availability_rules') IS NULL
     OR NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2b.3.1') THEN
    RAISE EXCEPTION '036_availability_zones.sql needs 034_availability_integrity.sql (version 2b.3.1) first'
      USING ERRCODE = 'SCVER';
  END IF;
  IF to_regprocedure('scheduling_is_timezone(text)') IS NULL THEN
    RAISE EXCEPTION '036_availability_zones.sql needs scheduling_is_timezone(text) from 010_shared_schema.sql'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── The pin ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduling_availability_zones (
  organisation_id text NOT NULL,
  resource_id     text,
  offering_id     text,
  owner_kind      text GENERATED ALWAYS AS (CASE WHEN resource_id IS NOT NULL THEN 'resource' ELSE 'offering' END) STORED,
  owner_id        text GENERATED ALWAYS AS (COALESCE(resource_id, offering_id)) STORED,
  timezone        text NOT NULL,
  source          text NOT NULL,
  pinned_by       text,
  pinned_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_availability_zones_pk PRIMARY KEY (organisation_id, owner_kind, owner_id),
  CONSTRAINT scheduling_availability_zones_owner_ck CHECK (num_nonnulls(resource_id, offering_id) = 1),
  CONSTRAINT scheduling_availability_zones_tz_ck CHECK (scheduling_is_timezone(timezone)),
  CONSTRAINT scheduling_availability_zones_source_ck CHECK (source IN ('first_rule', 'first_closure', 'backfill')),
  CONSTRAINT scheduling_availability_zones_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT scheduling_availability_zones_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id) ON DELETE CASCADE
);

-- ─── Immutability of a pin ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scheduling_availability_zone_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- An update that changes NOTHING is allowed: it is how a first write reads the pin it conflicts with (ON CONFLICT DO UPDATE SET timezone = timezone).
    IF NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id AND NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
       AND NEW.offering_id IS NOT DISTINCT FROM OLD.offering_id AND NEW.timezone IS NOT DISTINCT FROM OLD.timezone
       AND NEW.source IS NOT DISTINCT FROM OLD.source AND NEW.pinned_by IS NOT DISTINCT FROM OLD.pinned_by AND NEW.pinned_at IS NOT DISTINCT FROM OLD.pinned_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a pinned availability zone cannot be changed: a reviewed conversion is required' USING ERRCODE = 'SCZON';
  END IF;
  -- DELETE: only together with the owner (the foreign key's cascade runs after the owner row is gone).
  IF EXISTS (SELECT 1 FROM scheduling_resources r WHERE OLD.resource_id IS NOT NULL AND r.id = OLD.resource_id AND r.organisation_id = OLD.organisation_id)
     OR EXISTS (SELECT 1 FROM scheduling_offerings o WHERE OLD.offering_id IS NOT NULL AND o.id = OLD.offering_id AND o.organisation_id = OLD.organisation_id) THEN
    RAISE EXCEPTION 'a pinned availability zone cannot be removed while its owner exists' USING ERRCODE = 'SCZON';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER scheduling_availability_zones_immutable BEFORE UPDATE OR DELETE ON scheduling_availability_zones
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_zone_guard();

-- ─── Availability needs a pin ────────────────────────────────────────────────
-- Named so that it fires AFTER 034's guard (triggers fire in name order): the owner lock is taken first, then the pin is checked.

CREATE OR REPLACE FUNCTION scheduling_availability_zone_required() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A missing or other-organisation owner, or a row with no single owner, is reported by the composite foreign key / owner CHECK, as in 034.
  IF num_nonnulls(NEW.resource_id, NEW.offering_id) <> 1
     OR (NEW.resource_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scheduling_resources r WHERE r.id = NEW.resource_id AND r.organisation_id = NEW.organisation_id))
     OR (NEW.offering_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scheduling_offerings o WHERE o.id = NEW.offering_id AND o.organisation_id = NEW.organisation_id)) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scheduling_availability_zones z
     WHERE z.organisation_id = NEW.organisation_id
       AND z.owner_kind = CASE WHEN NEW.resource_id IS NOT NULL THEN 'resource' ELSE 'offering' END
       AND z.owner_id = COALESCE(NEW.resource_id, NEW.offering_id)
  ) THEN
    RAISE EXCEPTION 'availability needs a pinned timezone for its owner (pin it in the same statement as the first rule or closure)' USING ERRCODE = 'SCZON';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER scheduling_availability_rules_zone BEFORE INSERT ON scheduling_availability_rules
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_zone_required();
CREATE OR REPLACE TRIGGER scheduling_availability_exceptions_zone BEFORE INSERT ON scheduling_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_zone_required();

-- ─── Backfill: existing availability keeps the meaning it has today ─────────

DO $$
DECLARE
  have_rules integer;
  fallback constant text := 'Australia/Adelaide'; -- BRAINBASE_FALLBACK_TIMEZONE (lib/scheduling/adapters/brainbase)
  host boolean := to_regclass('public.organisations') IS NOT NULL
                  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'organisations' AND column_name = 'timezone');
BEGIN
  SELECT (SELECT count(*) FROM scheduling_availability_rules) + (SELECT count(*) FROM scheduling_availability_exceptions) INTO have_rules;
  IF have_rules = 0 THEN
    RETURN; -- nothing to pin (Production)
  END IF;
  IF NOT host THEN
    RAISE EXCEPTION '036_availability_zones.sql: availability exists but there is no organisations.timezone to resolve its zone from; pin the owners explicitly first'
      USING ERRCODE = 'SCVER';
  END IF;
  EXECUTE $q$
    INSERT INTO scheduling_availability_zones (organisation_id, resource_id, offering_id, timezone, source)
    SELECT x.organisation_id, x.resource_id, x.offering_id,
           COALESCE(CASE WHEN x.offering_id IS NOT NULL THEN s.timezone END, org.timezone, $1), 'backfill'
      FROM (SELECT organisation_id, resource_id, offering_id FROM scheduling_availability_rules
            UNION SELECT organisation_id, resource_id, offering_id FROM scheduling_availability_exceptions) x
      LEFT JOIN scheduling_offerings o ON o.id = x.offering_id AND o.organisation_id = x.organisation_id
      LEFT JOIN scheduling_schedules s ON s.id = o.schedule_id AND s.organisation_id = o.organisation_id
      LEFT JOIN organisations org ON org.id = x.organisation_id
    ON CONFLICT DO NOTHING
  $q$ USING fallback;
END $$;

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.3.3', 'Phase 2B.3d groundwork: owner-pinned availability zones (scheduling_availability_zones), immutable pins, availability needs a pin')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.scheduling_availability_zones') IS NULL THEN
    RAISE EXCEPTION '036_availability_zones.sql: expected the scheduling_availability_zones table';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname IN ('scheduling_availability_zones_immutable', 'scheduling_availability_rules_zone', 'scheduling_availability_exceptions_zone')) <> 3 THEN
    RAISE EXCEPTION '036_availability_zones.sql: expected the 3 enabled zone triggers';
  END IF;
  IF EXISTS (
    SELECT 1 FROM scheduling_availability_rules r
     WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability_zones z WHERE z.organisation_id = r.organisation_id
                          AND z.owner_kind = CASE WHEN r.resource_id IS NOT NULL THEN 'resource' ELSE 'offering' END AND z.owner_id = COALESCE(r.resource_id, r.offering_id))
  ) OR EXISTS (
    SELECT 1 FROM scheduling_availability_exceptions e
     WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability_zones z WHERE z.organisation_id = e.organisation_id
                          AND z.owner_kind = CASE WHEN e.resource_id IS NOT NULL THEN 'resource' ELSE 'offering' END AND z.owner_id = COALESCE(e.resource_id, e.offering_id))
  ) THEN
    RAISE EXCEPTION '036_availability_zones.sql: some availability still has no pinned zone';
  END IF;
END $$;

COMMIT;
