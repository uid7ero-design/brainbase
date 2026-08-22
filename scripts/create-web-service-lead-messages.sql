-- Outbound email history for BrainBase Web Systems / Strategy Call leads
-- (web_service_leads). Run once against the production database. Additive
-- only: creates one new table plus one supporting index; does not alter
-- any existing table. Safe to re-run (CREATE TABLE/INDEX IF NOT EXISTS) —
-- every statement is idempotent.
--
-- No organisation_id column: web_service_leads itself has no organisation
-- concept (it's BrainBase's own global sales-lead table, not a client
-- org's data) — see app/api/web-services/lead/route.ts, which never sets
-- organisation_id on insert. Adding one here with no source of truth to
-- populate it from would misrepresent the data model rather than protect
-- it. Access control for this table is enforced entirely by role
-- (super_admin) in app/api/web-services/leads/[id]/messages/route.ts, not
-- by tenant scoping.
--
-- Deliberately its own table, not client_pipeline/pipeline_messages (a
-- different concern: founder<->client request threads and /tennis/book's
-- session bookings) and not contact_journal (Squad-contact-scoped staff
-- notes, unrelated to web_service_leads). Mirrors the already-shipped,
-- already-validated tennis_lead_messages design
-- (scripts/create-tennis-lead-messages.sql) with the organisation_id
-- column and its index omitted, since this table has no equivalent.
--
-- id/lead_id/created_by all use TEXT to match this codebase's existing
-- convention (web_service_leads.id and users.id are both TEXT) — a real
-- FK is only possible with matching types.
--
-- direction is TEXT with a CHECK restricted to 'outbound' for now — no
-- inbound capture exists anywhere in this codebase yet. Widening the
-- CHECK later to add 'inbound' is a one-line additive change, not a
-- restructure.
--
-- lead_id cascades on lead delete (a lead's message history has no
-- meaning once the lead itself — deletable via the existing
-- super_admin-only DELETE /api/web-services/leads/[id] — is gone).
CREATE TABLE IF NOT EXISTS web_lead_messages (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id           TEXT        NOT NULL REFERENCES web_service_leads(id) ON DELETE CASCADE,
  direction         TEXT        NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound')),
  subject           TEXT        NOT NULL,
  body              TEXT        NOT NULL,
  from_address      TEXT        NOT NULL,
  to_address        TEXT        NOT NULL,
  resend_message_id TEXT,
  created_by        TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the message-thread read (lead_id match, chronological) — the
-- only query shape this table serves.
CREATE INDEX IF NOT EXISTS idx_web_lead_messages_lead ON web_lead_messages (lead_id, created_at ASC);

-- Rollback (not run automatically — keep for reference if this needs to be reverted):
--   DROP TABLE IF EXISTS web_lead_messages;
