-- Phase C7.5D1 — explicit Purchase Receipt line <-> Supplier Bill line
-- quantity allocations. Additive only: no cached match state is added to
-- purchase orders, receipt lines, or bill lines.
--
-- An allocation is explicit audit evidence. Same-PO-line lineage makes a
-- pair eligible to match; it does not itself mean that the pair is matched.
-- Active allocations are rows with reversed_at IS NULL.

-- Structural anchors so an allocation can composite-FK both line ids with
-- the SAME organisation_id and source_purchase_order_line_id. PostgreSQL
-- accepts a non-partial UNIQUE index as a foreign-key target; using indexes
-- keeps this live retrofit additive and naturally idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_purchase_receipt_lines_match_identity_key
  ON commercial_purchase_receipt_lines(id, organisation_id, source_purchase_order_line_id);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_supplier_bill_lines_match_identity_key
  ON commercial_supplier_bill_lines(id, organisation_id, source_purchase_order_line_id);

CREATE TABLE IF NOT EXISTS commercial_purchase_receipt_bill_allocations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT NOT NULL REFERENCES organisations(id),
  purchase_order_line_id    UUID NOT NULL,
  purchase_receipt_line_id  UUID NOT NULL,
  supplier_bill_line_id     UUID NOT NULL,
  quantity_allocated        NUMERIC(14,4) NOT NULL CHECK (quantity_allocated > 0),
  created_by                TEXT REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_by               TEXT REFERENCES users(id),
  reversed_at               TIMESTAMPTZ,
  reversal_reason           TEXT,
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_match_allocation_reversal_check
    CHECK (
      (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
      OR
      (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND btrim(reversal_reason) <> '')
    ),
  CONSTRAINT commercial_match_allocation_receipt_line_fkey
    FOREIGN KEY (purchase_receipt_line_id, organisation_id, purchase_order_line_id)
    REFERENCES commercial_purchase_receipt_lines
      (id, organisation_id, source_purchase_order_line_id),
  CONSTRAINT commercial_match_allocation_bill_line_fkey
    FOREIGN KEY (supplier_bill_line_id, organisation_id, purchase_order_line_id)
    REFERENCES commercial_supplier_bill_lines
      (id, organisation_id, source_purchase_order_line_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_match_allocations_org
  ON commercial_purchase_receipt_bill_allocations(organisation_id);

CREATE INDEX IF NOT EXISTS idx_commercial_match_allocations_po_line
  ON commercial_purchase_receipt_bill_allocations(organisation_id, purchase_order_line_id)
  WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_commercial_match_allocations_receipt_line
  ON commercial_purchase_receipt_bill_allocations(organisation_id, purchase_receipt_line_id)
  WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_commercial_match_allocations_bill_line
  ON commercial_purchase_receipt_bill_allocations(organisation_id, supplier_bill_line_id)
  WHERE reversed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commercial_match_allocations_active_pair_unique
  ON commercial_purchase_receipt_bill_allocations(
    organisation_id, purchase_receipt_line_id, supplier_bill_line_id
  )
  WHERE reversed_at IS NULL;
