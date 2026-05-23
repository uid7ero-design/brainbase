-- Web Service Leads table
-- Run once against the production database.

CREATE TYPE web_lead_status AS ENUM ('new', 'contacted', 'proposal_sent', 'won', 'lost');

CREATE TABLE IF NOT EXISTS web_service_leads (
  id                  TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  organisation_id     TEXT         REFERENCES organisations(id) ON DELETE SET NULL,
  full_name           TEXT         NOT NULL,
  business_name       TEXT,
  email               TEXT         NOT NULL,
  phone               TEXT,
  website_url         TEXT,
  business_type       TEXT,
  service_interest    TEXT[]       NOT NULL DEFAULT '{}',
  budget_range        TEXT,
  project_description TEXT,
  status              web_lead_status NOT NULL DEFAULT 'new',
  source              TEXT         DEFAULT 'website',
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_web_service_leads_created ON web_service_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_service_leads_status  ON web_service_leads (status);
CREATE INDEX IF NOT EXISTS idx_web_service_leads_email   ON web_service_leads (email);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_web_service_leads_updated_at
  BEFORE UPDATE ON web_service_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
