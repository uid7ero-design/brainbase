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
-- and one new trigger. It does not create, replace, alter, or drop any
-- existing table, row, trigger, or function.
--
-- public.set_updated_at() — a read-only Production pre-flight (Neon,
-- SELECT-only introspection against pg_proc/pg_trigger) confirmed this
-- shared trigger function ALREADY EXISTS in Production, with exactly the
-- expected body (NEW.updated_at = now(); RETURN NEW;), and is already
-- relied on by two other tables' triggers:
-- trg_web_service_leads_updated_at (web_service_leads) and
-- trg_implementations_updated_at (implementations). This script
-- therefore deliberately does NOT define or replace it — an earlier
-- draft included a CREATE OR REPLACE FUNCTION set_updated_at() here,
-- which was removed once Production evidence showed the function
-- already exists: redefining a shared, multi-table function for a new
-- table's benefit would have been an unnecessary, non-additive change
-- to an object two unrelated existing tables depend on. This script
-- only ever REFERENCES set_updated_at() by name in the new trigger
-- below; it never creates, replaces, alters, or drops it.

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

-- DROP TRIGGER IF EXISTS here only ever targets this script's OWN new
-- trigger name (trg_microsoft_connections_updated_at, on the new
-- microsoft_connections table only) so this script can be re-run
-- idempotently. It does not touch trg_web_service_leads_updated_at,
-- trg_implementations_updated_at, or any other existing trigger.
DROP TRIGGER IF EXISTS trg_microsoft_connections_updated_at ON microsoft_connections;
CREATE TRIGGER trg_microsoft_connections_updated_at
  BEFORE UPDATE ON microsoft_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
