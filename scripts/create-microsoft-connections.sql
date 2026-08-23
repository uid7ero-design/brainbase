-- Microsoft 365 connection — durable, encrypted OAuth token storage.
-- Run once against the production database. NOT run automatically by
-- this task — see the Founder OS Phase E.5A report for the exact
-- authorization/verification steps before this is executed.
--
-- Purpose: BrainBase's own, single, global Microsoft 365 business
-- connection (James's own account) — NOT a per-client/per-organisation
-- integration. Deliberately has no organisation_id column, matching the
-- same global, non-org-scoped model already established for Gmail/
-- Google Calendar/Spotify (see lib/globalIntegrationAccess.ts) — access
-- is gated by requireGlobalIntegrationAccess() in application code, not
-- by tenant. This is the SAME documented "temporary containment"
-- pattern already in use for those three integrations, not a new one.
--
-- Column/id convention: TEXT id (gen_random_uuid()::text), matching
-- every table created since the Web Systems pipeline (web_service_leads,
-- deployment_proposals, client_onboarding, implementations,
-- social_connections) — not the older UUID convention still used by
-- client_pipeline/crm_*.
--
-- Tokens are stored ENCRYPTED (AES-256-GCM via the existing, already-
-- proven lib/social/crypto.ts encrypt()/decrypt() — see
-- lib/microsoft/tokens.ts for the application-layer detail). Never
-- plaintext, unlike the existing Gmail/Google Calendar filesystem token
-- store, which this deliberately does not copy.
--
-- Exactly one row is expected to exist at a time — the application layer
-- (lib/microsoft/tokens.ts's writeConnection()) enforces this via an
-- atomic DELETE+INSERT, not a DB constraint, keeping this schema as
-- small as possible. Additive only: this script creates one new table
-- and (idempotently) a shared trigger function already defined
-- identically by scripts/create-web-service-leads.sql and
-- scripts/create-implementations.sql — it does not alter any existing
-- table or row.

CREATE TABLE IF NOT EXISTS microsoft_connections (
  id                      TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_email           TEXT         NOT NULL,
  ms_tenant_id            TEXT,
  encrypted_access_token  TEXT         NOT NULL,
  encrypted_refresh_token TEXT         NOT NULL,
  expires_at              TIMESTAMPTZ  NOT NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Reuses the shared set_updated_at() trigger function already
-- established by scripts/create-web-service-leads.sql — CREATE OR
-- REPLACE with an identical body is idempotent/harmless if it already
-- exists, and defining it here too keeps this script runnable
-- standalone.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_microsoft_connections_updated_at ON microsoft_connections;
CREATE TRIGGER trg_microsoft_connections_updated_at
  BEFORE UPDATE ON microsoft_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
