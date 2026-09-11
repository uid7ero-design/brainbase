-- C6.9 remediation — supporting-document attachments for Commercial
-- documents (Purchase Orders first; the same table serves a future
-- Invoices/Bills/Contracts attachment feature without a schema change,
-- matching commercial_document_deliveries' own already-established
-- generic-across-document-types design exactly).
--
-- Convention: raw SQL, matches every other organisation-scoped Commercial
-- table (see scripts/create-commercial-document-deliveries.sql, which
-- this table mirrors closely). Idempotent (IF NOT EXISTS throughout,
-- safe to re-run). NOT run automatically — rehearsed on Preview only, NOT
-- executed against Production by this phase.
--
-- document_type is a bare, FK-less discriminator CHECK-constrained to
-- 'purchase_order' alone for now (widen the CHECK later, the same way
-- commercial_document_deliveries was widened for invoice/purchase_order,
-- when a second document type actually needs attachments). document_id
-- deliberately carries NO composite FK to any specific parent table —
-- a polymorphic association cannot composite-FK onto more than one
-- parent table at once (see commercial_document_deliveries' own header
-- comment and its two widen-*.sql migrations, which had to DROP their
-- original composite FK for exactly this reason). Tenant/document
-- ownership integrity for WRITES is an explicit APPLICATION invariant
-- enforced in lib/commercial/documentAttachments.ts, not a DB
-- constraint — the raw insert primitive there is not exported; every
-- caller must supply an already-resolved, tenant-scoped parent document
-- row, matching lib/commercial/documentDeliveries.ts's identical
-- discipline exactly.
--
-- storage_key is the sole reference into the separate, dedicated PRIVATE
-- Commercial attachment Blob store (lib/commercial/attachmentStorage.ts)
-- — this table never stores a raw Blob URL, and the application never
-- returns one to a client; every read goes through an authenticated,
-- tenant-checked API route that streams bytes back server-side (see
-- app/api/commercial/purchase-orders/[id]/attachments/[attachmentId]/route.ts).
--
-- size_bytes is BIGINT (not INTEGER) to comfortably exceed this
-- feature's own ~20MB application-level ceiling without any risk of
-- integer overflow on a future, larger limit.
CREATE TABLE IF NOT EXISTS commercial_document_attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT NOT NULL REFERENCES organisations(id),
  document_type     TEXT NOT NULL CHECK (document_type IN ('purchase_order')),
  document_id       UUID NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('SUPPLIER_QUOTE', 'SPECIFICATION', 'SCOPE_OF_WORK', 'APPROVAL', 'OTHER')),
  original_filename TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_key       TEXT NOT NULL UNIQUE,
  uploaded_by       TEXT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commercial_document_attachments_org ON commercial_document_attachments(organisation_id);
-- Powers "list attachments for this document" (PO detail UI's Supporting
-- Documents section) — the only list query this feature needs.
CREATE INDEX IF NOT EXISTS idx_commercial_document_attachments_document ON commercial_document_attachments(organisation_id, document_type, document_id, created_at DESC);
