-- Organisation capability entitlement — schema foundation only.
-- Run once, manually, against the production database, AFTER
-- scripts/create-modules.sql (this table's module_key foreign key
-- requires the modules table to already exist). NOT run automatically
-- by this task — see the Modular Platform Foundation Phase F.4B report
-- for the exact authorization/verification steps before this is
-- executed.
--
-- Purpose: the per-organisation record of which capabilities
-- (modules.key) an organisation is entitled to, and how each behaves
-- for that organisation. This is the single source of truth an
-- eventual server-side entitlement primitive (not built in this
-- phase) must consult — never the UI alone, and never
-- organisations.plan directly (plan remains a separate, commercial-
-- tier concept that may inform provisioning defaults but must not be
-- read as a substitute for checking this table at runtime).
--
-- Data-safety invariants this schema is designed to uphold (see the
-- Phase F.4B report for the full list):
--   - No entitlement row for (org, module) = not entitled.
--   - enabled = false = not entitled — identical in effect to a
--     missing row; a row's mere existence never implies access.
--   - Disabling a module (flipping enabled to false) must never delete
--     this row's own config, and never touches any module-owned
--     business data in any other table — this table holds no business
--     data itself, only entitlement/configuration metadata.
--   - `config` is for genuinely module-specific BEHAVIOUR (e.g. a
--     future Bookings module's cancellation-window setting) — it is
--     explicitly NOT integration credential/connection storage. An
--     external integration (Microsoft 365, Google, Instagram) is never
--     modelled inside this JSON; integrations remain governed entirely
--     by the existing, separate lib/globalIntegrationAccess.ts model.
--
-- Foreign keys deliberately use ON DELETE RESTRICT on BOTH
-- organisation_id and module_key — organisation/module metadata must
-- never disappear implicitly as a side effect of deleting an
-- organisation or a module row. If organisation deletion is ever
-- supported, it must be its own explicit, separately reviewed
-- lifecycle operation with its own cleanup/archive behaviour — not an
-- implicit cascade from this table. Likewise, retiring a capability
-- platform-wide should ordinarily use modules.active = false (see
-- scripts/create-modules.sql); an actual DELETE of a modules row is
-- deliberately blocked while any organisation still has an entitlement
-- row referencing it.
--
-- organisation_id is TEXT, matching Production-confirmed
-- organisations.id (TEXT, verified by direct read-only introspection
-- in Phase F.1) — never UUID. This corrects the exact type mismatch
-- found in the legacy app/api/admin/migrate/route.ts,
-- app/api/admin/seed-demo/route.ts, and app/api/admin/seed/route.ts
-- definitions, none of which are used or referenced here.
--
-- Identity design: a surrogate TEXT id (gen_random_uuid()::text),
-- matching the convention already used consistently by every other
-- standalone table-creation script in this repository — unlike
-- modules (a small, rarely-inserted registry), this table is expected
-- to grow with real, individually-referenceable rows (e.g. for a
-- future audit log entry), so it follows the repository-wide surrogate
-- id pattern rather than modules' own key-as-PK exception.
--
-- Timestamps use TIMESTAMPTZ, matching the same rationale documented
-- in scripts/create-modules.sql.
--
-- Additive only: creates one new table, referencing the already-
-- created organisations and modules tables. Does not touch
-- organisations, users, any integration table, or any existing row.
-- No row is inserted by this script.

CREATE TABLE IF NOT EXISTS organisation_modules (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL,
  module_key      TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT false,
  config          JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organisation_modules_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_module_key_fkey
    FOREIGN KEY (module_key) REFERENCES modules(key) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_organisation_id_module_key_key
    UNIQUE (organisation_id, module_key)
);
