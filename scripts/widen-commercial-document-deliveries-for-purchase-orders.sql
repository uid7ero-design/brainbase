-- Phase C6.5 — widens commercial_document_deliveries.document_type to
-- support purchase_order deliveries alongside the existing quote and
-- invoice deliveries. Mirrors
-- scripts/widen-commercial-document-deliveries-for-invoices.sql's own
-- pattern exactly.
--
-- NOT run automatically — a prepared migration artifact, to be
-- rehearsed against an isolated Neon Preview branch before any
-- Production execution, following this repository's existing
-- hand-written-SQL migration convention (see CLAUDE.md — no
-- prisma/migrations directory). NOT executed against Production or any
-- shared Preview database by this phase.
--
-- WHAT THIS DOES:
--   Widens the document_type CHECK from ('quote', 'invoice') to
--   ('quote', 'invoice', 'purchase_order'). Postgres has no "ALTER
--   CHECK to add a value" — the DROP/ADD pair below targets the
--   constraint by its Postgres-default name,
--   commercial_document_deliveries_document_type_check, exactly as the
--   prior invoice widening already did.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   - No FK is dropped here — the invoice widening
--     (scripts/widen-commercial-document-deliveries-for-invoices.sql)
--     already dropped commercial_document_deliveries_quote_org_fkey,
--     the table's last composite FK onto a specific parent table.
--     document_id has been a bare, FK-less UUID since that migration;
--     this widening changes nothing about that. Tenant/document
--     integrity for WRITES remains the explicit APPLICATION invariant
--     lib/commercial/documentDeliveries.ts's own recordPurchaseOrderDeliveryAttempt()
--     enforces (assertSameOrganisation()), matching
--     recordQuoteDeliveryAttempt()/recordInvoiceDeliveryAttempt()'s
--     identical discipline.
--   - Does not touch organisation_id's own REFERENCES organisations(id)
--     FK, or either existing index — both already key on columns
--     (including document_type) that remain valid and correct for
--     purchase_order rows without modification.
--   - Does not delete, truncate, rewrite, or backfill any row. Every
--     existing quote/invoice delivery row remains valid under the
--     widened CHECK with zero changes to its own data.
--
-- IDEMPOTENCY: the ADD CONSTRAINT is guarded by a pg_constraint
-- existence check (DO block), the same idiom the invoice widening
-- already established. DROP CONSTRAINT IF EXISTS is trivially safe to
-- re-run. Every statement here is safe to replay in full, in order, any
-- number of times, against a database already at the post-migration
-- state — verified against a disposable local Postgres instance during
-- this phase's own rehearsal (see this phase's final report, Section E).
--
-- EXECUTION MECHANICS: identical caveat to the invoice widening's own
-- header — this repo's `sql` client (lib/db.ts's
-- neon(process.env.DATABASE_URL!)) executes one statement per HTTP
-- call; whoever applies this migration must issue the two top-level
-- statements below individually (or via sql.transaction([...]) for
-- atomic execution, matching the invoice widening's own preferred
-- Production execution method) — never by unsafe()-ing this whole file
-- in one call.

-- ── Widen the document_type CHECK to accept 'purchase_order' too ────
ALTER TABLE commercial_document_deliveries
  DROP CONSTRAINT IF EXISTS commercial_document_deliveries_document_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_document_deliveries_document_type_check'
  ) THEN
    ALTER TABLE commercial_document_deliveries
      ADD CONSTRAINT commercial_document_deliveries_document_type_check
      CHECK (document_type IN ('quote', 'invoice', 'purchase_order'));
  END IF;
END $$;
