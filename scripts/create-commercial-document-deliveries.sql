-- Phase C3-POLISH-R §8 — delivery-tracking model for Commercial document
-- sends (Quotes now; the same table serves future Invoicing without a
-- schema change). Deliberately a DEDICATED table, not folded into
-- audit_logs: audit_logs already gets one 'commercial_quote.sent' entry
-- per attempt (lib/commercial/auditLog.ts's logQuoteEmailSent, matching
-- ADR-0003's audit-wiring convention), but the brief's own §8 explicitly
-- rejects burying delivery state in audit logs alone — this table is
-- what powers "last delivery status/history" on the quote detail UI and
-- the resend cooldown check, both of which need to QUERY structured
-- delivery rows (status/channel/recipient/provider), not grep
-- audit_logs.before_state/after_state JSON.
--
-- Convention: raw SQL, matches scripts/create-commercial-quotes.sql and
-- every other organisation-scoped table in this codebase. Idempotent
-- (IF NOT EXISTS throughout, safe to re-run). NOT run automatically —
-- rehearsed on Preview only; NOT executed against production by this
-- phase (see the C3-POLISH-R final report's "Production Follow-Up
-- Required" section).
--
-- document_type is currently CHECK-constrained to 'quote' alone, which
-- is what makes the composite FK below to commercial_quotes(id,
-- organisation_id) valid today. A future Invoicing phase that adds
-- 'invoice' to this CHECK will need to drop this specific FK (a
-- polymorphic association cannot composite-FK onto two different parent
-- tables at once) and decide its own tenant-isolation enforcement for
-- that case — noted here so that future migration doesn't skip it
-- silently.
--
-- channel supports 'SMS' now even though no SMS provider is wired up
-- anywhere in this codebase yet (Phase C3-POLISH-R §10 — "future SMS —
-- architecture now, transport later"). No code path in this phase ever
-- writes channel = 'SMS'; the CHECK constraint accepting it is what lets
-- a future SMS transport be added without an ALTER TABLE.
--
-- status is deliberately NOT allowed to be 'DELIVERED' by anything this
-- phase writes, even though the CHECK constraint below accepts it for
-- forward-compatibility with a future webhook-based delivery-confirmation
-- integration. Resend's REST API (lib/email.ts's sendEmail(), reused by
-- lib/commercial/quoteEmail.ts) confirms only that Resend ACCEPTED the
-- send request for delivery — not that the recipient's inbox actually
-- received it. Per the brief's own §8 instruction ("do not invent
-- provider semantics the current email provider cannot actually
-- verify"), this phase's application code only ever transitions a row
-- PENDING -> SENT or PENDING -> FAILED; DELIVERED stays reserved,
-- unused, and honestly unreachable until a real webhook exists.
CREATE TABLE IF NOT EXISTS commercial_document_deliveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       TEXT NOT NULL REFERENCES organisations(id),
  document_type         TEXT NOT NULL CHECK (document_type IN ('quote')),
  document_id           UUID NOT NULL,
  channel               TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  recipient             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED')),
  provider              TEXT,
  provider_message_id   TEXT,
  attempted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  error_summary         TEXT,
  created_by            TEXT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite tenant-integrity anchor onto commercial_quotes(id,
  -- organisation_id) — see scripts/create-commercial-quotes.sql's own
  -- UNIQUE(id, organisation_id). Structurally prevents a delivery row
  -- from ever pointing at a different organisation's quote, matching
  -- this codebase's established composite-FK pattern (commercial_quotes
  -- -> commercial_customers, commercial_quote_lines -> commercial_quotes).
  CONSTRAINT commercial_document_deliveries_quote_org_fkey
    FOREIGN KEY (document_id, organisation_id)
    REFERENCES commercial_quotes (id, organisation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commercial_document_deliveries_org ON commercial_document_deliveries(organisation_id);
-- Powers both "delivery history for this document" (UI) and the resend
-- cooldown check (most recent attempted_at for a given document+channel).
CREATE INDEX IF NOT EXISTS idx_commercial_document_deliveries_document ON commercial_document_deliveries(organisation_id, document_type, document_id, attempted_at DESC);
