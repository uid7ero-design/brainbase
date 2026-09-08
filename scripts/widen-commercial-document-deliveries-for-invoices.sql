-- Phase C4.3B — widens commercial_document_deliveries.document_type to
-- support invoice deliveries alongside the existing quote deliveries.
-- This is exactly the migration
-- scripts/create-commercial-document-deliveries.sql's own header
-- comment already flagged and pre-authorized: "A future Invoicing phase
-- that adds 'invoice' to this CHECK will need to drop this specific FK
-- (a polymorphic association cannot composite-FK onto two different
-- parent tables at once) and decide its own tenant-isolation
-- enforcement for that case."
--
-- NOT run automatically — a prepared migration artifact, rehearsed
-- against an isolated Neon Preview branch before any production
-- execution, following this repository's existing hand-written-SQL
-- migration convention (see CLAUDE.md — no prisma/migrations
-- directory).
--
-- Constraint names below were confirmed empirically against a real
-- Preview branch's actual information_schema/pg_constraint state before
-- this file was finalized — never assumed merely from source comments
-- on the original CREATE TABLE (per this phase's own explicit
-- instruction). See this migration's own rehearsal report for the
-- verification transcript.
--
-- WHAT THIS DOES:
--   1. Widens the document_type CHECK from ('quote') to
--      ('quote', 'invoice'). Postgres has no "ALTER CHECK to add a
--      value" — an unnamed single-column CHECK gets Postgres's default
--      name, <table>_<column>_check, which the DROP/ADD pair below
--      targets directly.
--   2. DROPS commercial_document_deliveries_quote_org_fkey — the
--      composite FK that previously anchored (document_id,
--      organisation_id) onto commercial_quotes(id, organisation_id).
--      It cannot be widened or duplicated: a single FK cannot point at
--      two different parent tables, and Postgres has no CHECK-
--      conditional FK. NO REPLACEMENT cross-table FK is added —
--      document_id becomes a bare UUID with no FK at all, the standard
--      accepted shape for a polymorphic association. Tenant/document
--      integrity for WRITES is now an explicit APPLICATION invariant
--      (see lib/commercial/documentDeliveries.ts's own header comment
--      and recordQuoteDeliveryAttempt()/recordInvoiceDeliveryAttempt(),
--      and tests/containment/commercialDocumentDeliveryIntegrity.test.ts
--      for the enforced/tested proof) rather than a DB constraint.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   - Does not touch organisation_id's own plain
--     REFERENCES organisations(id) FK — untouched, still real, still
--     enforced.
--   - Does not touch any index. idx_commercial_document_deliveries_org
--     and idx_commercial_document_deliveries_document already key on
--     columns (including document_type) that remain valid and correct
--     for invoice rows without modification — no deficiency was found
--     that would justify changing them.
--   - Does not delete, truncate, or backfill any row. Every existing
--     quote delivery row remains valid under the widened CHECK with
--     zero changes to its own data — 'quote' is still an accepted
--     document_type value, and no row's document_type/document_id ever
--     changes.
--   - Does not add a document_id FK of any kind (see above).
--
-- IDEMPOTENCY: DROP CONSTRAINT IF EXISTS is trivially safe to re-run —
-- dropping an already-absent constraint is a documented Postgres
-- no-op, not an error. The ADD CONSTRAINT for the widened CHECK is
-- guarded by a pg_constraint existence check (DO block), matching the
-- exact idiom scripts/create-commercial-invoices.sql's own Section 0
-- already established, since "ADD CONSTRAINT IF NOT EXISTS" is not
-- valid PostgreSQL syntax. Every statement here is safe to replay in
-- full, in order, any number of times, against a database already at
-- the post-migration state.

-- ── 1. Drop the quote-only composite FK ──────────────────────────────
ALTER TABLE commercial_document_deliveries
  DROP CONSTRAINT IF EXISTS commercial_document_deliveries_quote_org_fkey;

-- ── 2. Widen the document_type CHECK to accept 'invoice' too ────────
ALTER TABLE commercial_document_deliveries
  DROP CONSTRAINT IF EXISTS commercial_document_deliveries_document_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_document_deliveries_document_type_check'
  ) THEN
    ALTER TABLE commercial_document_deliveries
      ADD CONSTRAINT commercial_document_deliveries_document_type_check
      CHECK (document_type IN ('quote', 'invoice'));
  END IF;
END $$;
