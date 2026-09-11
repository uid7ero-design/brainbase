-- HR-1 People Foundation — registers the "people" capability in the
-- capability registry (public.modules). Run once, manually, against
-- the database, AFTER scripts/create-modules.sql (this script inserts
-- into that table) and independently of the hr_* table scripts above.
-- NOT run automatically by this task.
--
-- Purpose: REGISTRY seeding only, matching scripts/seed-modules-
-- registry.sql's own exact pattern and discipline. This makes the
-- 'people' capability exist as a concept the platform is aware of. It
-- grants nothing to anyone — no organisation becomes entitled to People
-- as a result of running this script. Entitlement remains entirely
-- organisation_modules' job (per-organisation, enabled = false by that
-- table's own column default), and is always a separate, later,
-- explicitly authorized step per organisation — HR-1 must not silently
-- enable People for every existing customer.
--
-- Idempotency: ON CONFLICT (key) DO NOTHING, matching scripts/seed-
-- modules-registry.sql exactly.
--
-- active = true: the platform-wide kill switch (see scripts/create-
-- modules.sql's own comment) — true means the capability is available
-- for use platform-wide, subject entirely to each organisation's own
-- organisation_modules.enabled entitlement, which remains independently
-- false (not entitled) for every organisation until a separate, later
-- step grants it.
--
-- Additive only: exactly one INSERT statement, into modules only. No
-- UPDATE, no DELETE, no DDL, no organisation_modules row, no
-- organisation id.

INSERT INTO modules (key, name, description, active) VALUES
  ('people', 'People', 'Workers, teams, and basic employment information for your organisation.', true)
ON CONFLICT (key) DO NOTHING;
