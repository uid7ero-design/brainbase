-- Outbound email history for LD Tennis website-enquiry leads (tennis_leads).
-- Run once against the production database. Additive only: creates one new
-- table plus supporting indexes; does not alter any existing table. Safe to
-- re-run (CREATE TABLE/INDEX IF NOT EXISTS) — every statement is idempotent.
--
-- Deliberately its own table, not client_pipeline/pipeline_messages: those
-- model founder<->client request threads (and /tennis/book's session
-- bookings) — a different lifecycle and audience from a sales lead's own
-- outbound-email audit trail. See app/api/leads/[id]/messages/route.ts for
-- the application-layer usage. Also deliberately not contact_journal:
-- that's a free-text staff-notes log keyed to a Squad *contact* (which may
-- not exist yet for a given lead, and is only loosely linked to
-- tennis_leads via organisation+email, not a hard FK) — reusing it here
-- would blur an editable internal note against an immutable record of what
-- was actually transmitted to the customer.
--
-- id/lead_id/organisation_id/created_by all use TEXT to match this
-- codebase's existing convention for these tables (tennis_leads.id,
-- tennis_leads.organisation_id, and users.id are all TEXT, per
-- prisma/schema.prisma) — a real FK is only possible with matching types.
--
-- direction is TEXT with a CHECK restricted to 'outbound' for now — this
-- migration/task implements outbound-only history (no inbound capture
-- exists anywhere in this codebase yet). 'inbound' is reserved for a
-- future automated-capture enhancement; widening the CHECK later is a
-- one-line additive change, not a restructure.
--
-- lead_id cascades on lead delete (a lead's message history has no
-- meaning once the lead itself — deletable via the existing "Delete lead"
-- action — is gone). organisation_id intentionally does NOT cascade,
-- matching tennis_leads.organisation_id's own onDelete: NoAction.
CREATE TABLE IF NOT EXISTS tennis_lead_messages (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id   TEXT        NOT NULL REFERENCES organisations(id),
  lead_id           TEXT        NOT NULL REFERENCES tennis_leads(id) ON DELETE CASCADE,
  direction         TEXT        NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound')),
  subject           TEXT        NOT NULL,
  body              TEXT        NOT NULL,
  from_address      TEXT        NOT NULL,
  to_address        TEXT        NOT NULL,
  resend_message_id TEXT,
  created_by        TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the message-thread read (lead_id match, chronological) and any
-- future org-wide reporting/cleanup query.
CREATE INDEX IF NOT EXISTS idx_tennis_lead_messages_lead ON tennis_lead_messages (lead_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tennis_lead_messages_org  ON tennis_lead_messages (organisation_id);

-- Rollback (not run automatically — keep for reference if this needs to be reverted):
--   DROP TABLE IF EXISTS tennis_lead_messages;
