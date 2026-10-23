-- Scheduling Phase 2B.2 — resource concurrency hardening (version 2b.2.1)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Production still has no scheduling data; this file is applied only after the
--         owner approves it, and only by the owner (see docs/architecture/scheduling-resource-concurrency.md).
--
-- WHAT: 5 functions and 4 triggers, all named scheduling_*, that close the races the Phase 2B.2a report left open:
--         1. deactivating a resource while a reservation is being created for it,
--         2. unlinking a resource from an offering while a reservation is being created for it,
--         3. changing a resource's kind while it is being linked or booked,
--         4. linking a resource that is inactive or of a kind the offering's preset does not accept.
--       Nothing is altered, dropped or rewritten: no table or column changes, no existing function or trigger is replaced, and no
--       row is read or written except the version marker. It adds guards on writes only; existing rows are never re-validated.
--
-- WHY IN THE DATABASE: BrainBase and the standalone application both write these tables. A guard that lives in one repository's SQL
--   is bypassed by the other writer, and a plain "NOT EXISTS live hold" check cannot see an uncommitted concurrent insert. Each
--   guard here first takes the SAME per-resource advisory lock that scheduling_hold_serialise (010) takes before a hold is written,
--   then reads the state it protects with a fresh READ COMMITTED snapshot. Whichever transaction gets the lock second therefore
--   sees the first one's committed work and decides on it.
--
-- LOCK ORDER (the deadlock-freedom argument; verified by tests/resourceConcurrency.integration.test.ts):
--   Every function here takes AT MOST ONE advisory lock: pg_advisory_xact_lock(per organisation + resource), the lock family that
--   scheduling_hold_serialise already uses, and takes it BEFORE reading anything it guards. Row locks are always taken before the
--   advisory lock (a BEFORE ROW trigger runs after the row is locked) or are compatible with it (the foreign-key check on the
--   resource row takes KEY SHARE, which does not conflict with the NO KEY UPDATE of a deactivation). The capacity lock family
--   (scheduling_capacity:*) is never held together with a resource lock by one statement. Hence there is no cycle between a
--   booking, a deactivation, an unlink, a link and a kind change. A future statement that touches several resources MUST visit
--   them in resource_id order (the rule 010 already states for holds).
--
-- REQUIRES: 010_shared_schema.sql (version 2a.2) already applied. READ COMMITTED (the same requirement as the reservation guard;
--   the guards raise SCISO under REPEATABLE READ or SERIALIZABLE rather than decide on a stale snapshot).
--
-- IDEMPOTENT: CREATE OR REPLACE throughout; the version marker uses ON CONFLICT DO NOTHING. Re-running changes nothing.
-- EXECUTION: one transaction. lock_timeout makes it fail fast instead of queueing behind a long transaction.
-- ROLLBACK: packages/scheduling/sql/091_resource_concurrency_rollback.sql (restores the 2b.2a behaviour; no data is touched).
--
-- CUSTOM SQLSTATE CODES raised by this file (mapped by the adapter):
--   SCRIU resource in use (deactivate or change the kind of a resource that is booked / linked)
--   SCALU allocation in use (unlink a resource that a live reservation of that offering holds)
--   SCKND link refused (resource inactive, or its kind is not accepted by the offering's preset)
--   SCRES resource inactive (010's code, now also raised for a hold that races a deactivation)
--   SCISO unsafe isolation level (010's code)

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.scheduling_resources') IS NULL
     OR NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2a.2') THEN
    RAISE EXCEPTION '030_resource_concurrency.sql needs the 2a.2 scheduling schema (010_shared_schema.sql) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── The preset-to-resource-kind table (mirror of PRESETS[*].resources.kinds in @scheduling/core) ───────────────────────────
-- A parity test fails if this drifts from the TypeScript presets. An unknown preset allows nothing.

CREATE OR REPLACE FUNCTION scheduling_preset_allows_resource_kind(p_preset text, p_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_preset
    WHEN 'classes_coaching'  THEN p_kind IN ('court', 'space', 'practitioner')
    WHEN 'appointments'      THEN p_kind IN ('practitioner', 'room', 'virtual')
    WHEN 'restaurant_tables' THEN p_kind IN ('table')
    WHEN 'accommodation'     THEN p_kind IN ('room', 'space')
    WHEN 'resource_hire'     THEN p_kind IN ('court', 'room', 'space', 'equipment')
    WHEN 'event_capacity'    THEN p_kind IN ('space', 'room')
    ELSE false
  END
$$;

-- ─── 1 + 3. BEFORE UPDATE on resources: deactivation and kind change ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scheduling_resource_guard() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
BEGIN
  IF NOT ((OLD.active AND NOT NEW.active) OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    RETURN NEW; -- reactivation, rename, capacity: nothing to protect here
  END IF;

  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_resource_guard requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || OLD.organisation_id || ':' || OLD.id, 0));

  -- A live hold is one that still matters: not released and not yet ended. Past or released holds are history.
  IF OLD.active AND NOT NEW.active AND EXISTS (
       SELECT 1 FROM scheduling_resource_holds h
        WHERE h.organisation_id = OLD.organisation_id AND h.resource_id = OLD.id
          AND h.released_at IS NULL AND upper(h.during) > now()) THEN
    RAISE EXCEPTION 'resource % has live reservations and cannot be deactivated', OLD.id USING ERRCODE = 'SCRIU';
  END IF;

  -- What a resource IS cannot change once an offering uses it or any reservation has ever held it.
  IF NEW.kind IS DISTINCT FROM OLD.kind AND (
       EXISTS (SELECT 1 FROM scheduling_offering_resources l WHERE l.organisation_id = OLD.organisation_id AND l.resource_id = OLD.id)
       OR EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE h.organisation_id = OLD.organisation_id AND h.resource_id = OLD.id)) THEN
    RAISE EXCEPTION 'the kind of resource % cannot change while it is linked to an offering or has been booked', OLD.id USING ERRCODE = 'SCRIU';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 1. BEFORE INSERT on holds: a live hold may not land on a resource that is (being) deactivated ─────────────────────────
-- Takes the resource lock itself (re-entrant with scheduling_hold_serialise, which also takes it) so it does not depend on
-- the order in which Postgres fires the two BEFORE INSERT triggers.

CREATE OR REPLACE FUNCTION scheduling_hold_resource_state() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  res    record;
  preset text;
BEGIN
  IF NEW.released_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || NEW.organisation_id || ':' || NEW.resource_id, 0));
  SELECT active, kind INTO res FROM scheduling_resources
    WHERE id = NEW.resource_id AND organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- a missing resource is reported by the foreign key
  END IF;
  IF NOT res.active THEN
    RAISE EXCEPTION 'resource_inactive' USING ERRCODE = 'SCRES';
  END IF;

  -- The booking statement chose this resource using the kind it saw at ITS snapshot; a kind change that committed while it ran
  -- is only visible now, under the lock. The preset of the owning reservation / occurrence must still accept the kind.
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT v.preset_key INTO preset FROM scheduling_reservations v
      WHERE v.id = NEW.reservation_id AND v.organisation_id = NEW.organisation_id;
  ELSE
    SELECT s.preset_key INTO preset FROM scheduling_occurrences o
      JOIN scheduling_offerings f ON f.id = o.offering_id AND f.organisation_id = o.organisation_id
      JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
     WHERE o.id = NEW.occurrence_id AND o.organisation_id = NEW.organisation_id;
  END IF;
  IF FOUND AND NOT scheduling_preset_allows_resource_kind(preset, res.kind) THEN
    RAISE EXCEPTION 'a % resource is not accepted by the % preset', res.kind, preset USING ERRCODE = 'SCRES';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. BEFORE INSERT on links: the resource must be active and of a kind the preset accepts ───────────────────────────────

CREATE OR REPLACE FUNCTION scheduling_link_guard() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  res record;
  preset text;
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_link_guard requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || NEW.organisation_id || ':' || NEW.resource_id, 0));

  SELECT active, kind INTO res FROM scheduling_resources WHERE id = NEW.resource_id AND organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing or cross-tenant resource
  END IF;
  SELECT s.preset_key INTO preset FROM scheduling_offerings o
    JOIN scheduling_schedules s ON s.id = o.schedule_id AND s.organisation_id = o.organisation_id
   WHERE o.id = NEW.offering_id AND o.organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing or cross-tenant offering
  END IF;

  IF NOT res.active THEN
    RAISE EXCEPTION 'resource % is inactive and cannot be linked', NEW.resource_id USING ERRCODE = 'SCKND';
  END IF;
  IF NOT scheduling_preset_allows_resource_kind(preset, res.kind) THEN
    RAISE EXCEPTION 'a % resource cannot be linked to a % offering', res.kind, preset USING ERRCODE = 'SCKND';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 2. BEFORE DELETE on links: not while a live reservation of this offering holds the resource ──────────────────────────

CREATE OR REPLACE FUNCTION scheduling_link_release_guard() RETURNS trigger
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'scheduling_link_release_guard requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || OLD.organisation_id || ':' || OLD.resource_id, 0));

  IF EXISTS (
       SELECT 1 FROM scheduling_resource_holds h
        WHERE h.organisation_id = OLD.organisation_id AND h.resource_id = OLD.resource_id
          AND h.released_at IS NULL AND upper(h.during) > now()
          AND (EXISTS (SELECT 1 FROM scheduling_reservations v WHERE v.organisation_id = h.organisation_id AND v.id = h.reservation_id AND v.offering_id = OLD.offering_id)
            OR EXISTS (SELECT 1 FROM scheduling_occurrences o WHERE o.organisation_id = h.organisation_id AND o.id = h.occurrence_id AND o.offering_id = OLD.offering_id))) THEN
    RAISE EXCEPTION 'a live reservation of offering % holds resource %; it cannot be unlinked', OLD.offering_id, OLD.resource_id USING ERRCODE = 'SCALU';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER scheduling_resources_guard BEFORE UPDATE OF active, kind ON scheduling_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_resource_guard();
CREATE OR REPLACE TRIGGER scheduling_holds_resource_state BEFORE INSERT ON scheduling_resource_holds
  FOR EACH ROW EXECUTE FUNCTION scheduling_hold_resource_state();
CREATE OR REPLACE TRIGGER scheduling_offering_resources_guard BEFORE INSERT ON scheduling_offering_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_link_guard();
CREATE OR REPLACE TRIGGER scheduling_offering_resources_release_guard BEFORE DELETE ON scheduling_offering_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_link_release_guard();

-- ─── Version marker ──────────────────────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.2.1', 'Phase 2B.2 resource concurrency: deactivation, unlink, kind change and link guards serialised on the per-resource advisory lock')
ON CONFLICT (version) DO NOTHING;

-- Self-check: the four triggers exist and are enabled, or the whole file rolls back.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname IN ('scheduling_resources_guard', 'scheduling_holds_resource_state', 'scheduling_offering_resources_guard', 'scheduling_offering_resources_release_guard')) <> 4 THEN
    RAISE EXCEPTION '030_resource_concurrency.sql: expected 4 enabled triggers';
  END IF;
END $$;

COMMIT;
