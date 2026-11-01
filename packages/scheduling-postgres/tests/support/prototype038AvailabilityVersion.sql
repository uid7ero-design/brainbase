-- PROTOTYPE of the proposed availability-version guard (docs/architecture/scheduling-phase2c-availability-at-commit.md, option C).
--
-- THIS IS NOT A MIGRATION. It is not in packages/scheduling/sql, it is not numbered into the registry, and nothing applies it except
-- packages/scheduling-postgres/tests/availabilityAtCommit.integration.test.ts, against a DISPOSABLE database, to prove the design works on PostgreSQL 16 and 17
-- before anyone writes the real migration. The real migration would be reviewed, rehearsed and applied by the owner under the usual hand-off.
--
-- Idea: each availability OWNER (an offering, a resource) has a version number that EVERY change to what decides its availability bumps in the same transaction: its
-- rules, its closures and overrides, its pinned zone, its resource links, and a resource's active flag. A booking statement locks the version rows FOR SHARE and requires
-- the version it read to still be the current one. Because the bump is an UPDATE of that row, PostgreSQL itself serialises the two sides: a writer waits for an in-flight
-- booking to commit (the booking then stands, which is the approved rule: existing bookings survive availability changes), and a booking that waited for a writer
-- re-checks its WHERE clause against the writer's new row version (READ COMMITTED's re-evaluation of a locked row) and finds the version moved, so it inserts nothing.
-- All of it inside ONE statement, which is the only atomic unit the Neon HTTP driver offers.
--
-- WHY A TABLE AND NOT A COLUMN ON THE OWNER. scheduling_offerings and scheduling_resources have BEFORE UPDATE "touch" triggers (the 2B.2a edit tokens). Bumping a column
-- there would move updated_at on every availability change and invalidate every open configuration form, and would fire the 030 resource guards each time. A separate
-- table leaves the owner rows, their tokens and their guards exactly as they are.

CREATE TABLE IF NOT EXISTS scheduling_availability_versions (
  organisation_id text   NOT NULL,
  owner_kind      text   NOT NULL CHECK (owner_kind IN ('offering', 'resource')),
  owner_id        text   NOT NULL,
  version         bigint NOT NULL DEFAULT 0,
  CONSTRAINT scheduling_availability_versions_pk PRIMARY KEY (organisation_id, owner_kind, owner_id)
);

-- Every owner has a row from the moment it exists, so a booking always has a row to lock (a missing row could not be locked, and a first insert by a writer would be
-- invisible to a booking that had already taken its snapshot).
CREATE OR REPLACE FUNCTION scheduling_version_row_for_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO scheduling_availability_versions (organisation_id, owner_kind, owner_id)
  VALUES (NEW.organisation_id, CASE TG_TABLE_NAME WHEN 'scheduling_offerings' THEN 'offering' ELSE 'resource' END, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS scheduling_offerings_version_row ON scheduling_offerings;
CREATE TRIGGER scheduling_offerings_version_row AFTER INSERT ON scheduling_offerings FOR EACH ROW EXECUTE FUNCTION scheduling_version_row_for_owner();
DROP TRIGGER IF EXISTS scheduling_resources_version_row ON scheduling_resources;
CREATE TRIGGER scheduling_resources_version_row AFTER INSERT ON scheduling_resources FOR EACH ROW EXECUTE FUNCTION scheduling_version_row_for_owner();
-- Backfill for owners that already exist.
INSERT INTO scheduling_availability_versions (organisation_id, owner_kind, owner_id) SELECT organisation_id, 'offering', id FROM scheduling_offerings ON CONFLICT DO NOTHING;
INSERT INTO scheduling_availability_versions (organisation_id, owner_kind, owner_id) SELECT organisation_id, 'resource', id FROM scheduling_resources ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION scheduling_bump_one(p_org text, p_kind text, p_id text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO scheduling_availability_versions AS v (organisation_id, owner_kind, owner_id, version) VALUES (p_org, p_kind, p_id, 1)
  ON CONFLICT (organisation_id, owner_kind, owner_id) DO UPDATE SET version = v.version + 1;
$$;

CREATE OR REPLACE FUNCTION scheduling_bump_availability_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  j jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  org text := j ->> 'organisation_id';
  offering_id text;
  resource_id text;
BEGIN
  IF j ? 'owner_kind' THEN                      -- scheduling_availability_zones
    IF j ->> 'owner_kind' = 'offering' THEN offering_id := j ->> 'owner_id'; ELSE resource_id := j ->> 'owner_id'; END IF;
  ELSE                                          -- rules, exceptions and offering-resource links
    offering_id := j ->> 'offering_id';
    resource_id := j ->> 'resource_id';
  END IF;
  -- Fixed order (offering, then resource): the booking statement locks in the same order, so the two can never wait on each other in a cycle.
  IF offering_id IS NOT NULL THEN PERFORM scheduling_bump_one(org, 'offering', offering_id); END IF;
  IF resource_id IS NOT NULL THEN PERFORM scheduling_bump_one(org, 'resource', resource_id); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS scheduling_rules_bump_version ON scheduling_availability_rules;
CREATE TRIGGER scheduling_rules_bump_version AFTER INSERT OR UPDATE OR DELETE ON scheduling_availability_rules
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();
DROP TRIGGER IF EXISTS scheduling_exceptions_bump_version ON scheduling_availability_exceptions;
CREATE TRIGGER scheduling_exceptions_bump_version AFTER INSERT OR UPDATE OR DELETE ON scheduling_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();
DROP TRIGGER IF EXISTS scheduling_zones_bump_version ON scheduling_availability_zones;
CREATE TRIGGER scheduling_zones_bump_version AFTER INSERT OR UPDATE OR DELETE ON scheduling_availability_zones
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();
DROP TRIGGER IF EXISTS scheduling_links_bump_version ON scheduling_offering_resources;
CREATE TRIGGER scheduling_links_bump_version AFTER INSERT OR DELETE ON scheduling_offering_resources
  FOR EACH ROW EXECUTE FUNCTION scheduling_bump_availability_version();

-- A resource's own active flag is part of its availability.
CREATE OR REPLACE FUNCTION scheduling_resource_active_bump() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM scheduling_bump_one(NEW.organisation_id, 'resource', NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS scheduling_resources_active_bump ON scheduling_resources;
CREATE TRIGGER scheduling_resources_active_bump AFTER UPDATE OF active ON scheduling_resources
  FOR EACH ROW WHEN (NEW.active IS DISTINCT FROM OLD.active) EXECUTE FUNCTION scheduling_resource_active_bump();
