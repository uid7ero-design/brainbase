-- Phase C7.3 — widens commercial_document_attachments.document_type to
-- support purchase_receipt attachments alongside the existing
-- purchase_order attachments. Mirrors scripts/widen-commercial-document-
-- deliveries-for-purchase-orders.sql's own pattern exactly (same
-- DROP/re-ADD-guarded-by-pg_constraint idiom, since Postgres has no
-- "ALTER CHECK to add a value").
--
-- NOT run automatically — a prepared migration artifact, to be
-- rehearsed against an isolated Neon Preview branch (or disposable local
-- Postgres) before any Production execution, following this
-- repository's existing hand-written-SQL migration convention. NOT
-- executed against Production or any shared Preview database by this
-- phase.
--
-- WHAT THIS DOES:
--   Widens the document_type CHECK from ('purchase_order') to
--   ('purchase_order', 'purchase_receipt'). The DROP/ADD pair below
--   targets the constraint by its Postgres-default name,
--   commercial_document_attachments_document_type_check.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   - Does not touch storage_key, the private Blob store, or any other
--     column/index on this table — reuses the exact same attachment
--     infrastructure (lib/commercial/attachmentStorage.ts's
--     buildCommercialAttachmentKey()/createCommercialAttachmentStore(),
--     already document-type-generic) a purchase_order attachment uses
--     today. No second Blob/storage mechanism, no raw Blob URL ever
--     returned to a client for either document type.
--   - Does not delete, truncate, rewrite, or backfill any row. Every
--     existing purchase_order attachment row remains valid under the
--     widened CHECK with zero changes to its own data.
--
-- IDEMPOTENCY: the ADD CONSTRAINT is guarded by a pg_constraint
-- existence check (DO block); DROP CONSTRAINT IF EXISTS is trivially
-- safe to re-run. Safe to replay in full, in order, any number of times.
--
-- EXECUTION MECHANICS: this repo's `sql` client (lib/db.ts's
-- neon(process.env.DATABASE_URL!)) executes one statement per HTTP
-- call; whoever applies this migration must issue the two top-level
-- statements below individually (or via sql.transaction([...]) for
-- atomic execution) — never by unsafe()-ing this whole file in one call.

ALTER TABLE commercial_document_attachments
  DROP CONSTRAINT IF EXISTS commercial_document_attachments_document_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_document_attachments_document_type_check'
  ) THEN
    ALTER TABLE commercial_document_attachments
      ADD CONSTRAINT commercial_document_attachments_document_type_check
      CHECK (document_type IN ('purchase_order', 'purchase_receipt'));
  END IF;
END $$;
