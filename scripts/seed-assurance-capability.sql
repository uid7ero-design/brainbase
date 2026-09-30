-- BrainBase Assurance — capability registry seed. PREPARED ARTIFACT ONLY.
-- NOT run automatically. Not applied to any environment by this branch.
--
-- Registers the 'assurance' module key as a concept the platform is aware
-- of, identical in kind to scripts/seed-commercial-capabilities.sql and
-- scripts/seed-hr-module-registry.sql.
--
-- Grants NOTHING to any organisation: no organisation_modules row is
-- touched. Every organisation's own entitlement stays off until a
-- super_admin enables it through the existing /admin/orgs capability UI.
-- Until this row exists, /assurance renders "Assurance isn't enabled" and
-- every /api/assurance route returns 403 (fail closed).
--
-- Idempotent (ON CONFLICT (key) DO NOTHING). Additive only: one INSERT
-- into modules. No UPDATE, no DELETE, no DDL.
--
-- Depends on: A0.1A..A0.1D-3 Assurance schema already applied (the UI
-- reads those tables). Does NOT depend on A0.1E-1 Audit.

INSERT INTO modules (key, name, description, active) VALUES
  ('assurance', 'Assurance', 'Incidents, investigations, inspections, findings, corrective actions, evidence and verification.', true)
ON CONFLICT (key) DO NOTHING;
