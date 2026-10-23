-- Scheduling Phase 2B.0 — dedicated INTERNAL TEST organisation: REMOVE (the stated deletion plan).
--
-- STATUS: DEFINED, NOT RUN ANYWHERE. Manual, separately approved, Preview first.
--
-- WHAT: deletes the Scheduling entitlement row of the internal test organisation and then the organisation itself.
--
-- REFUSES (the whole transaction rolls back, nothing is deleted) while ANY of these still belong to it:
--   * a row in any scheduling_* table (settings, schedules, resources, reservations, ...);
--   * a CRM contact (crm_contacts) or a user (users);
--   * any other foreign-key dependent: the organisations foreign keys are NO ACTION / RESTRICT, so Postgres refuses too.
-- Clear test data through the application or a reviewed statement first; this file never deletes data it did not create.
--
-- It touches only the organisation whose slug is 'zz-scheduling-internal-test'. Any other organisation, entitlement
-- or contact is out of reach of every statement below.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  org_id text;
  t text;
  n bigint;
BEGIN
  SELECT id INTO org_id FROM organisations WHERE slug = 'zz-scheduling-internal-test';
  IF org_id IS NULL THEN
    RAISE NOTICE 'no internal test organisation exists; nothing to remove';
    RETURN;
  END IF;

  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'scheduling\_%'
       AND c.relname <> 'scheduling_schema_migrations'
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE organisation_id = $1', t) INTO n USING org_id;
    IF n > 0 THEN
      RAISE EXCEPTION '% still holds % row(s) for the internal test organisation; remove them first', t, n;
    END IF;
  END LOOP;

  IF to_regclass('public.crm_contacts') IS NOT NULL THEN
    SELECT count(*) INTO n FROM crm_contacts WHERE organisation_id = org_id;
    IF n > 0 THEN RAISE EXCEPTION 'crm_contacts holds % row(s) for the internal test organisation; remove them first', n; END IF;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    SELECT count(*) INTO n FROM users WHERE organisation_id = org_id;
    IF n > 0 THEN RAISE EXCEPTION 'users holds % row(s) for the internal test organisation; remove them first', n; END IF;
  END IF;

  DELETE FROM organisation_modules WHERE organisation_id = org_id;
  DELETE FROM organisations WHERE id = org_id AND slug = 'zz-scheduling-internal-test';
END $$;

COMMIT;
