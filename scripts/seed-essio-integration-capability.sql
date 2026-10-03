-- BrainBase Essio integration — capability registry seed. PREPARED ARTIFACT ONLY.
-- NOT run automatically. Not applied to any environment by this branch.
--
-- Registers the 'essio_integration' module key, identical in kind to
-- scripts/seed-assurance-capability.sql.
--
-- Grants NOTHING to any organisation: no organisation_modules row is touched.
-- Every organisation's entitlement stays off until a super_admin enables it
-- through the existing /admin/orgs capability UI. Integration access requires
-- BOTH a valid integration credential AND this capability enabled for the
-- credential's organisation (lib/integrationCredentials/service.ts); a valid
-- credential alone is insufficient. It does not affect normal Organiser
-- permissions.
--
-- Idempotent (ON CONFLICT (key) DO NOTHING). Additive only.
--
-- Depends on: scripts/create-essio-integration-b1.sql.

INSERT INTO modules (key, name, description, active) VALUES
  ('essio_integration', 'Essio integration',
   'Lets Essio create Organiser work from accepted visibility recommendations using a per-organisation integration credential.',
   true)
ON CONFLICT (key) DO NOTHING;
