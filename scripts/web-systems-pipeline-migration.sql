-- ============================================================
-- BrainBase Web Systems — Pipeline & Deployment Infrastructure
-- Run this against your Neon database once.
-- ============================================================

-- ── 1. Extend web_lead_status enum ────────────────────────────────────────────
-- Postgres does not allow removing enum values, only adding.
-- Existing values: NEW | CONTACTED | PROPOSAL_SENT | WON | LOST
-- We expand the pipeline significantly.

ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'DISCOVERY';
ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'QUALIFIED';
ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'PROPOSAL_APPROVED';
ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'ONBOARDING';
ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'IN_DEPLOYMENT';
ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'ACTIVE_CLIENT';
ALTER TYPE web_lead_status ADD VALUE IF NOT EXISTS 'PAUSED';

-- ── 2. Add operational columns to web_service_leads ───────────────────────────
ALTER TABLE web_service_leads
  ADD COLUMN IF NOT EXISTS priority     TEXT    DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS score        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pipeline_notes TEXT;

-- ── 3. Proposal status enum ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM (
    'draft', 'sent', 'viewed', 'approved', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. deployment_proposals table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deployment_proposals (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  lead_id             TEXT        REFERENCES web_service_leads(id) ON DELETE SET NULL,
  organisation_id     TEXT        REFERENCES organisations(id) ON DELETE SET NULL,
  proposal_title      TEXT        NOT NULL DEFAULT 'Untitled Proposal',
  proposal_type       TEXT        NOT NULL DEFAULT 'website_deployment'
                                  CHECK (proposal_type IN (
                                    'website_deployment',
                                    'operational_deployment',
                                    'coaching_deployment',
                                    'automation_deployment',
                                    'full_system'
                                  )),
  deployment_scope    TEXT,
  monthly_recurring   NUMERIC(10,2) DEFAULT 0,
  one_time_cost       NUMERIC(10,2) DEFAULT 0,
  status              proposal_status NOT NULL DEFAULT 'draft',
  proposal_content    TEXT,
  included_modules    TEXT[]      DEFAULT '{}',
  notes               TEXT,
  sent_at             TIMESTAMPTZ,
  viewed_at           TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposals_lead        ON deployment_proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status      ON deployment_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_created_at  ON deployment_proposals(created_at DESC);

CREATE OR REPLACE FUNCTION update_deployment_proposals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_proposals_updated ON deployment_proposals;
CREATE TRIGGER trg_proposals_updated
  BEFORE UPDATE ON deployment_proposals
  FOR EACH ROW EXECUTE FUNCTION update_deployment_proposals_updated_at();

-- ── 5. onboarding_stage enum ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE onboarding_stage AS ENUM (
    'discovery',
    'content_collection',
    'infrastructure_setup',
    'website_build',
    'integrations',
    'review',
    'deployment',
    'live',
    'maintenance'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. client_onboarding table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_onboarding (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  organisation_id       TEXT        REFERENCES organisations(id) ON DELETE SET NULL,
  lead_id               TEXT        REFERENCES web_service_leads(id) ON DELETE SET NULL,
  proposal_id           TEXT        REFERENCES deployment_proposals(id) ON DELETE SET NULL,
  client_name           TEXT        NOT NULL DEFAULT '',
  onboarding_stage      onboarding_stage NOT NULL DEFAULT 'discovery',
  assigned_to           TEXT,
  target_launch_date    DATE,
  hosting_status        TEXT        DEFAULT 'pending' CHECK (hosting_status IN ('pending','configured','live')),
  domain_status         TEXT        DEFAULT 'pending' CHECK (domain_status IN ('pending','transferred','configured','live')),
  deployment_status     TEXT        DEFAULT 'not_started' CHECK (deployment_status IN ('not_started','in_progress','review','complete')),
  integrations_status   TEXT        DEFAULT 'not_started' CHECK (integrations_status IN ('not_started','in_progress','complete')),
  crm_status            TEXT        DEFAULT 'not_started' CHECK (crm_status IN ('not_started','configured','syncing','live')),
  launch_status         TEXT        DEFAULT 'not_started' CHECK (launch_status IN ('not_started','scheduled','live')),
  checklist             JSONB       DEFAULT '[]',
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_onboarding_stage      ON client_onboarding(onboarding_stage);
CREATE INDEX IF NOT EXISTS idx_onboarding_lead       ON client_onboarding(lead_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_created    ON client_onboarding(created_at DESC);

CREATE OR REPLACE FUNCTION update_client_onboarding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_onboarding_updated ON client_onboarding;
CREATE TRIGGER trg_onboarding_updated
  BEFORE UPDATE ON client_onboarding
  FOR EACH ROW EXECUTE FUNCTION update_client_onboarding_updated_at();

-- ── 7. managed_services table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managed_services (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  organisation_id   TEXT        REFERENCES organisations(id) ON DELETE SET NULL,
  lead_id           TEXT        REFERENCES web_service_leads(id) ON DELETE SET NULL,
  onboarding_id     TEXT        REFERENCES client_onboarding(id) ON DELETE SET NULL,
  client_name       TEXT        NOT NULL DEFAULT '',
  hosting_provider  TEXT        DEFAULT 'vercel',
  domain_provider   TEXT,
  domain_name       TEXT,
  ssl_status        TEXT        DEFAULT 'active' CHECK (ssl_status IN ('active','expiring','expired','pending')),
  hosting_plan      TEXT        DEFAULT 'starter',
  maintenance_plan  TEXT        DEFAULT 'standard' CHECK (maintenance_plan IN ('none','standard','growth','full_system')),
  monthly_value     NUMERIC(10,2) DEFAULT 0,
  annual_value      NUMERIC(10,2) GENERATED ALWAYS AS (monthly_value * 12) STORED,
  renewal_date      DATE,
  status            TEXT        DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','pending')),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_managed_status    ON managed_services(status);
CREATE INDEX IF NOT EXISTS idx_managed_created   ON managed_services(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_managed_renewal   ON managed_services(renewal_date);

CREATE OR REPLACE FUNCTION update_managed_services_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_managed_updated ON managed_services;
CREATE TRIGGER trg_managed_updated
  BEFORE UPDATE ON managed_services
  FOR EACH ROW EXECUTE FUNCTION update_managed_services_updated_at();

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Tables created: deployment_proposals, client_onboarding, managed_services
-- Enum extended: web_lead_status (added DISCOVERY, QUALIFIED, PROPOSAL_APPROVED,
--                ONBOARDING, IN_DEPLOYMENT, ACTIVE_CLIENT, PAUSED)
-- Columns added: web_service_leads.priority, .score, .pipeline_notes
