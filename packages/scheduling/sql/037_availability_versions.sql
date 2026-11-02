-- Scheduling Phase 2C.3 groundwork — per-owner availability versions (version 2c.3.1)
--
-- STATUS: NOT APPLIED ANYWHERE. Staged for review. Applied only by the owner, only after separate approval, and never as part of merging code.
--         Nothing in the application reads these rows yet: no booking-writing route exists, and none is authorised by this file.
--
-- WHY: a booking is accepted only on a start the availability engine offers. The engine runs in the application; the booking is written by the database. Between the two a
--   rule edit, a closure, a pinned-zone change, an unlinked resource or a deactivated resource can commit, and the Neon HTTP driver cannot hold a transaction open across
--   "evaluate, then insert". The answer (docs/architecture/scheduling-phase2c-availability-at-commit.md, option C) is that every change to what decides an owner's
--   availability bumps a version number IN THE SAME TRANSACTION as the change, and the single booking statement locks that version row FOR SHARE and requires the version
--   the application read. PostgreSQL serialises the two sides on the row: a writer waits for an in-flight booking (the booking stands: existing bookings survive availability
--   changes), and a booking that waited for a writer re-checks its WHERE clause against the writer's new row version and inserts nothing.
--
-- WHAT:
--   * one new module-owned table, scheduling_availability_versions: one row per OWNER (an offering or a resource, resource_id XOR offering_id), a bigint version. Composite
--     foreign keys carry the organisation, so a row can never name another organisation's owner, and it goes with its owner (ON DELETE CASCADE).
--   * a row exists from the moment an owner exists: an AFTER INSERT trigger on offerings and resources creates it, and a backfill creates it for owners that already exist, WITH
--     or WITHOUT availability rules. An owner that has no rules therefore still has a row to lock, and a first rule written later bumps it. (A row that did not exist could not be
--     locked, and one a writer inserted after a booking took its snapshot would be invisible to that booking.)
--   * AFTER triggers on rules, exceptions and pinned zones (insert/update/delete), offering-resource links (insert/delete) and a resource's active flag (when it changes) bump the
--     version of every owner they concern. A bump is an UPDATE ... SET version = version + 1 of an EXISTING row and never an insert, so deleting an owner cannot recreate its row
--     while the cascade runs. Offering is always bumped before resource, and the booking statement locks in the same order, so the two can never wait on each other in a cycle.
--   * NOTHING existing changes: no table, column, constraint, trigger or edit token (scheduling_offerings.updated_at and scheduling_resources.updated_at do not move on a bump,
--     and the 030 resource guards do not fire). A separate table is the reason.
--
-- NOT HERE: the booking statement itself, any route, any booking. Overrides are not authorised.
--
-- REQUIRES 036 (version 2b.3.3). IDEMPOTENT (apply twice: no change). One transaction. Needs READ COMMITTED, like 034.
-- ROLLBACK: packages/scheduling/sql/098_availability_versions_rollback.sql (independent: nothing else depends on it).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.scheduling_availability_zones') IS NULL
     OR NOT EXISTS (SELECT 1 FROM scheduling_schema_migrations WHERE version = '2b.3.3') THEN
    RAISE EXCEPTION '037_availability_versions.sql needs 036_availability_zones.sql (version 2b.3.3) first'
      USING ERRCODE = 'SCVER';
  END IF;
END $$;

-- ─── The version rows ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduling_availability_versions (
  organisation_id text   NOT NULL,
  resource_id     text,
  offering_id     text,
  owner_kind      text   GENERATED ALWAYS AS (CASE WHEN resource_id IS NOT NULL THEN 'resource' ELSE 'offering' END) STORED,
  owner_id        text   GENERATED ALWAYS AS (COALESCE(resource_id, offering_id)) STORED,
  version         bigint NOT NULL DEFAULT 0,
  CONSTRAINT scheduling_availability_versions_pk PRIMARY KEY (organisation_id, owner_kind, owner_id),
  CONSTRAINT scheduling_availability_versions_owner_ck CHECK (num_nonnulls(resource_id, offering_id) = 1),
  CONSTRAINT scheduling_availability_versions_version_ck CHECK (version >= 0),
  CONSTRAINT scheduling_availability_versions_resource_fk FOREIGN KEY (resource_id, organisation_id)
    REFERENCES scheduling_resources (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT scheduling_availability_versions_offering_fk FOREIGN KEY (offering_id, organisation_id)
    REFERENCES scheduling_offerings (id, organisation_id) ON DELETE CASCADE
);

-- A version only ever moves forward by one, by the bump function below. A hand edit that rewinds or skips is refused, because a rewound version would let a stale booking pass.
CREATE OR REPLACE FUNCTION scheduling_availability_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.offering_id IS DISTINCT FROM OLD.offering_id THEN
    RAISE EXCEPTION 'an availability version cannot change owner' USING ERRCODE = 'SCIMM';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'an availability version only moves forward by one' USING ERRCODE = 'SCIMM';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER scheduling_availability_versions_forward BEFORE UPDATE ON scheduling_availability_versions
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_version_guard();

-- An owner has a row from the moment it exists.
CREATE OR REPLACE FUNCTION scheduling_availability_version_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'scheduling_offerings' THEN
    INSERT INTO scheduling_availability_versions (organisation_id, offering_id) VALUES (NEW.organisation_id, NEW.id) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO scheduling_availability_versions (organisation_id, resource_id) VALUES (NEW.organisation_id, NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER scheduling_offerings_version_row AFTER INSERT ON scheduling_offerings
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_version_row();
CREATE OR REPLACE TRIGGER scheduling_resources_version_row AFTER INSERT ON scheduling_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_availability_version_row();

-- Backfill: every owner that exists, with or without availability rules.
INSERT INTO scheduling_availability_versions (organisation_id, offering_id) SELECT organisation_id, id FROM scheduling_offerings ON CONFLICT DO NOTHING;
INSERT INTO scheduling_availability_versions (organisation_id, resource_id) SELECT organisation_id, id FROM scheduling_resources ON CONFLICT DO NOTHING;

-- ─── The bump ───────────────────────────────────────────────────────────────

-- UPDATE of an existing row, never an insert: if the owner is being deleted its row is already gone (or going) and there is nothing to bump.
CREATE OR REPLACE FUNCTION scheduling_bump_availability_version_of(p_org text, p_kind text, p_id text) RETURNS void
LANGUAGE sql AS $$
  UPDATE scheduling_availability_versions v SET version = v.version + 1
   WHERE v.organisation_id = p_org AND v.owner_kind = p_kind AND v.owner_id = p_id;
$$;

CREATE OR REPLACE FUNCTION scheduling_bump_availability_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  j jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  org text := j ->> 'organisation_id';
  the_offering text;
  the_resource text;
BEGIN
  IF j ? 'owner_kind' THEN
    -- scheduling_availability_zones (and no other table here has these columns): the pin of one owner.
    IF j ->> 'owner_kind' = 'offering' THEN the_offering := j ->> 'owner_id'; ELSE the_resource := j ->> 'owner_id'; END IF;
  ELSE
    -- rules, exceptions, and offering-resource links: each names its offering and/or resource.
    the_offering := j ->> 'offering_id';
    the_resource := j ->> 'resource_id';
  END IF;
  -- A rule that changes OWNER moves both the old and the new owner.
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) ->> 'offering_id' IS DISTINCT FROM the_offering AND to_jsonb(OLD) ->> 'offering_id' IS NOT NULL THEN
      PERFORM scheduling_bump_availability_version_of(org, 'offering', to_jsonb(OLD) ->> 'offering_id');
    END IF;
  END IF;
  -- Fixed order, offering then resource: the booking statement locks in the same order, so neither can wait on the other in a cycle.
  IF the_offering IS NOT NULL THEN PERFORM scheduling_bump_availability_version_of(org, 'offering', the_offering); END IF;
  IF the_resource IS NOT NULL THEN PERFORM scheduling_bump_availability_version_of(org, 'resource', the_resource); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER scheduling_availability_rules_bump_version AFTER INSERT OR UPDATE OR DELETE ON scheduling_availability_rules
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();
CREATE OR REPLACE TRIGGER scheduling_availability_exceptions_bump_version AFTER INSERT OR UPDATE OR DELETE ON scheduling_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();
CREATE OR REPLACE TRIGGER scheduling_availability_zones_bump_version AFTER INSERT OR UPDATE OR DELETE ON scheduling_availability_zones
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();
CREATE OR REPLACE TRIGGER scheduling_offering_resources_bump_version AFTER INSERT OR DELETE ON scheduling_offering_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();

-- A resource's own active flag is part of its availability.
CREATE OR REPLACE FUNCTION scheduling_resource_active_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM scheduling_bump_availability_version_of(NEW.organisation_id, 'resource', NEW.id);
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER scheduling_resources_active_bump AFTER UPDATE OF active ON scheduling_resources
  FOR EACH ROW WHEN (NEW.active IS DISTINCT FROM OLD.active) EXECUTE FUNCTION scheduling_resource_active_bump();

-- ─── Version marker and verification ─────────────────────────────────────────

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2c.3.1', 'Phase 2C.3 groundwork: per-owner availability versions (scheduling_availability_versions), bumped by rules, closures, pins, links and resource active')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.scheduling_availability_versions') IS NULL THEN
    RAISE EXCEPTION '037_availability_versions.sql: expected the scheduling_availability_versions table';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled = 'O'
         AND tgname IN ('scheduling_availability_versions_forward', 'scheduling_offerings_version_row', 'scheduling_resources_version_row',
                        'scheduling_availability_rules_bump_version', 'scheduling_availability_exceptions_bump_version', 'scheduling_availability_zones_bump_version',
                        'scheduling_offering_resources_bump_version', 'scheduling_resources_active_bump')) <> 8 THEN
    RAISE EXCEPTION '037_availability_versions.sql: expected the 8 enabled version triggers';
  END IF;
  IF EXISTS (SELECT 1 FROM scheduling_offerings o WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability_versions v WHERE v.organisation_id = o.organisation_id AND v.owner_kind = 'offering' AND v.owner_id = o.id))
     OR EXISTS (SELECT 1 FROM scheduling_resources r WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability_versions v WHERE v.organisation_id = r.organisation_id AND v.owner_kind = 'resource' AND v.owner_id = r.id)) THEN
    RAISE EXCEPTION '037_availability_versions.sql: an owner has no version row';
  END IF;
END $$;

COMMIT;
