-- Client Implementations — core record (Phase 2A)
-- Run once against the production database. NOT run automatically by
-- this task — see the Phase 2A checkpoint report for the exact command.
--
-- Purpose: one trustworthy, generic, vertical-agnostic "we are delivering
-- a service to this client" record, attached to the existing authoritative
-- organisations/users infrastructure. Deliberately minimal — no services
-- list, no milestones, no tasks, no progress tracking. Those are later,
-- separate slices (see the Client Implementations Phase 1 audit report).
--
-- Column/id convention: TEXT ids (gen_random_uuid()::text), matching every
-- table created since the Web Systems pipeline (web_service_leads,
-- deployment_proposals, client_onboarding, managed_services) — NOT the
-- older UUID convention still used by client_pipeline/crm_*. See the
-- Phase 1 audit's schema-drift finding for why TEXT was chosen
-- deliberately here, not by default.
--
-- stage vocabulary (deliberately small, generic, vertical-agnostic —
-- NOT Web Systems' web-build-specific onboarding_stage vocabulary):
--   planning         — not yet started
--   discovery        — early scoping/requirements
--   setup            — environment/account/infrastructure setup
--   build            — active delivery work
--   client_review    — awaiting client feedback/sign-off
--   testing          — pre-launch validation
--   ready_to_launch  — build complete, launch scheduled
--   live             — delivered and in production for the client
--   on_hold          — paused (terminal off-path, not part of the
--                      linear sequence above)
--   cancelled        — abandoned (terminal off-path)
-- Plain TEXT + CHECK, not a Postgres ENUM — matching client_onboarding.
-- onboarding_stage's own convention (TEXT, validated in application code
-- via a VALID_STAGES set), not web_service_leads.status's native-ENUM
-- convention. Native enums are append-only in Postgres and, per the
-- Phase 1 audit, make a stage vocabulary hard to evolve once shipped
-- (exactly what happened to web_service_leads' 12-value enum, where the
-- UI only ever grew to show 10 of them). TEXT + CHECK can be altered
-- with a plain ALTER TABLE ... DROP/ADD CONSTRAINT later if the
-- vocabulary needs to change.
--
-- organisation_id has NO explicit ON DELETE clause (defaults to NO
-- ACTION), matching client_pipeline's own organisation_id FK convention.
-- This is deliberate: deleting an organisation that still has an
-- implementation attached must fail loudly, not silently orphan or
-- cascade-delete implementation history.

CREATE TABLE IF NOT EXISTS implementations (
  id                  TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id     TEXT         NOT NULL REFERENCES organisations(id),
  name                TEXT         NOT NULL,
  service_type        TEXT,
  stage               TEXT         NOT NULL DEFAULT 'planning'
                        CHECK (stage IN (
                          'planning', 'discovery', 'setup', 'build',
                          'client_review', 'testing', 'ready_to_launch',
                          'live', 'on_hold', 'cancelled'
                        )),
  health              TEXT         NOT NULL DEFAULT 'on_track'
                        CHECK (health IN ('on_track', 'at_risk', 'blocked')),
  owner_user_id       TEXT         REFERENCES users(id) ON DELETE SET NULL,
  target_launch_date  DATE,
  actual_launch_date  DATE,
  summary             TEXT,
  next_action         TEXT,
  source_lead_id      TEXT         REFERENCES web_service_leads(id) ON DELETE SET NULL,
  source_proposal_id  TEXT         REFERENCES deployment_proposals(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_implementations_org   ON implementations(organisation_id);
CREATE INDEX IF NOT EXISTS idx_implementations_stage ON implementations(stage);

-- Reuses the shared set_updated_at() trigger function already established
-- by scripts/create-web-service-leads.sql — CREATE OR REPLACE with an
-- identical body is idempotent/harmless if that function already exists,
-- and defining it here too keeps this script runnable standalone.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_implementations_updated_at ON implementations;
CREATE TRIGGER trg_implementations_updated_at
  BEFORE UPDATE ON implementations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
