-- Scheduling Phase 2B.0 — BrainBase capability registration (version 2b.0-capability)
--
-- STATUS: NOT APPLIED ANYWHERE. Manual Neon SQL Editor handoff, Preview first, backup branch first, separate
-- approval for Production. Run only AFTER packages/scheduling/sql/010_shared_schema.sql (it records a marker in
-- scheduling_schema_migrations).
--
-- WHAT: registers ONE platform-wide row in public.modules: key = 'scheduling'. Nothing else.
--
-- WHAT IT DOES NOT DO: it inserts NO organisation_modules row, so NO organisation is entitled to Scheduling as a
--   result. lib/capabilities/requireCapability.ts authorises only when modules.active AND an organisation_modules
--   row with enabled = true exist, so with this file applied every organisation is still DENIED (NO_ENTITLEMENT).
--   The only visible effect is a "Scheduling & Bookings" row in the super_admin capability toggle
--   (app/actions/orgModules.ts), defaulted to off for every organisation. Enabling the dedicated internal test
--   organisation is a separate, later, separately approved statement
--   (scripts/scheduling/manual/internal-test-org-2-enable-capability.sql).
--
-- active = true is the platform-wide availability switch (scripts/create-modules.sql), as approved in the Phase 2B
--   plan. Setting it to false later withdraws Scheduling from every organisation at once, whatever their rows say.
--
-- IDEMPOTENT: ON CONFLICT (key) DO NOTHING, the same rationale as scripts/seed-modules-registry.sql. Re-running
--   changes nothing; it never overwrites a name, description or active flag that someone has since edited.
--
-- ADDITIVE: no DDL, no UPDATE, no DELETE, no existing table altered. The two preconditions below fail loudly (the
--   whole transaction rolls back) if the registry tables are missing.
--
-- ROLLBACK: scripts/scheduling/191_brainbase_capability_rollback.sql
--
-- REQUIRES: public.modules and public.organisation_modules (scripts/create-modules.sql,
--   scripts/create-organisation-modules.sql), and the Phase 2A schema marker table.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.modules') IS NULL OR to_regclass('public.organisation_modules') IS NULL THEN
    RAISE EXCEPTION 'the capability registry tables (modules, organisation_modules) do not exist';
  END IF;
  IF to_regclass('public.scheduling_schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'run packages/scheduling/sql/010_shared_schema.sql first';
  END IF;
END $$;

INSERT INTO modules (key, name, description, active)
VALUES ('scheduling', 'Scheduling & Bookings', 'Schedules, resources, availability and reservations for classes, appointments and hire. Internal staff workflow only.', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.0-capability', 'BrainBase host: scheduling capability registered in modules; no organisation entitled')
ON CONFLICT (version) DO NOTHING;

COMMIT;
