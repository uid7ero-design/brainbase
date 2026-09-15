-- Phase C7.4 — widens commercial_document_attachments.document_type to
-- support supplier_bill attachments alongside the existing
-- purchase_order and purchase_receipt attachments. Mirrors
-- scripts/widen-commercial-document-attachments-for-purchase-receipts.sql's
-- own pattern exactly (same DROP/re-ADD-guarded-by-pg_constraint idiom).
--
-- NOT run automatically — a prepared migration artifact, to be
-- rehearsed against an isolated Neon Preview branch (or disposable local
-- Postgres) before any Production execution. NOT executed against
-- Production or any shared Preview database by this phase.
--
-- WHAT THIS DOES:
--   Widens the document_type CHECK from ('purchase_order',
--   'purchase_receipt') to ('purchase_order', 'purchase_receipt',
--   'supplier_bill').
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   - Does not touch storage_key, the private Blob store, or any other
--     column/index on this table — reuses the exact same attachment
--     infrastructure a purchase_order/purchase_receipt attachment uses
--     today. No second Blob/storage mechanism, no raw Blob URL ever
--     returned to a client for any document type.
--   - Does not delete, truncate, rewrite, or backfill any row.
--
-- IDEMPOTENCY: the ADD CONSTRAINT is guarded by a pg_constraint
-- existence check (DO block); DROP CONSTRAINT IF EXISTS is trivially
-- safe to re-run. Safe to replay in full, in order, any number of times.

ALTER TABLE commercial_document_attachments
  DROP CONSTRAINT IF EXISTS commercial_document_attachments_document_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_document_attachments_document_type_check'
  ) THEN
    ALTER TABLE commercial_document_attachments
      ADD CONSTRAINT commercial_document_attachments_document_type_check
      CHECK (document_type IN ('purchase_order', 'purchase_receipt', 'supplier_bill'));
  END IF;
END $$;
