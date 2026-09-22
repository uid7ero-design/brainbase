-- Phase C7.4 — Supplier Bills Foundation. Adds two tables
-- (commercial_supplier_bills, commercial_supplier_bill_lines) on top of
-- the C6.2 Purchasing and C7.3 Purchase Receipts foundations. This
-- migration is prepared and rehearsed only; it is NOT run against
-- Production or any shared Preview database during this phase.
--
-- Scope, per the C7.4 brief: Issued PO -> Supplier Bill, PO-backed only
-- (every bill belongs to exactly one PO, every bill line references a
-- concrete PO line), no approval gate, no supplier payments, no 3-way
-- matching, no bill-line <-> receipt-line allocation table. See each
-- column's own comment below for what was deliberately NOT anticipated.
--
-- Convention: raw SQL, not a Prisma model. No prisma migrate, no
-- prisma db push. Idempotent: every CREATE TABLE/INDEX uses IF NOT
-- EXISTS; the one ALTER TABLE (Section 0's PO supplier-anchor retrofit)
-- is wrapped in a DO block that checks pg_constraint first, matching the
-- exact idiom scripts/create-commercial-purchasing.sql's own Section 0
-- already established. No DROP, no DELETE, no TRUNCATE anywhere in this
-- file. Safe to re-run.

-- ── 0. Retrofit a supplier-consistency anchor onto commercial_purchase_orders ──
--
-- C7.4's own explicit rule: "the bill supplier must match the linked PO
-- supplier — do not allow a bill to point at a different supplier from
-- its PO." Rather than relying only on an application-level check, this
-- is enforced STRUCTURALLY: commercial_supplier_bills' own composite FK
-- (Section 1 below) references commercial_purchase_orders(id,
-- supplier_id), which requires this UNIQUE(id, supplier_id) anchor to
-- exist first — the exact same "retrofit the anchor just before the
-- first cross-tenant/cross-entity reference needs it" pattern
-- scripts/create-commercial-purchasing.sql's own Section 0 established
-- for commercial_cost_centres.
--
-- Purely additive and safe to run against current Production data: id is
-- already commercial_purchase_orders' own PRIMARY KEY (hence already
-- globally unique), so no existing row can ever violate a new
-- UNIQUE(id, supplier_id) constraint — adding a uniqueness constraint on
-- top of an already-unique column cannot fail. Does not touch, and is
-- independent of, the existing UNIQUE(id, organisation_id) anchor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_purchase_orders_id_supplier_id_key'
  ) THEN
    ALTER TABLE commercial_purchase_orders
      ADD CONSTRAINT commercial_purchase_orders_id_supplier_id_key UNIQUE (id, supplier_id);
  END IF;
END $$;

-- ── 1. Supplier bills (the header) ───────────────────────────────────
--
-- source_purchase_order_id is NOT NULL and double-composite-FK'd: once
-- onto commercial_purchase_orders(id, organisation_id) for ordinary
-- tenant scoping, and again onto commercial_purchase_orders(id,
-- supplier_id) — the Section 0 anchor above — which structurally
-- guarantees supplier_id on this row can never diverge from the linked
-- PO's own supplier_id. Currency consistency (bill currency must match
-- PO currency) is enforced in the domain layer instead (lib/commercial/
-- supplierBills.ts's createSupplierBill() copies currency directly from
-- the PO — there is no client-supplied currency parameter at all, so
-- there is no code path capable of writing a mismatched value); a
-- database-level equivalent would require a self-referencing composite
-- FK Postgres does not support without duplicating the PO's currency
-- onto this table, which would reintroduce exactly the "derived value
-- stored redundantly" risk this schema otherwise avoids everywhere else.
--
-- supplier_invoice_number is the SUPPLIER's own invoice identifier —
-- deliberately distinct from bill_number (BrainBase's own internal,
-- atomically-allocated document number, nullable until POSTED, exactly
-- mirroring purchase_order_number/receipt_number's own "populated once,
-- at the DRAFT -> POSTED transition, never at creation" rule). Duplicate
-- detection is enforced STRUCTURALLY via
-- supplier_invoice_number_canonical, a STORED generated column (lower +
-- trim of the raw value — see scripts/web-systems-pipeline-migration.sql
-- for this repo's existing GENERATED ALWAYS AS ... STORED precedent),
-- never computed only in the application layer, so no insert/update path
-- can forget to keep it in sync. The UNIQUE constraint below is scoped
-- to (organisation_id, supplier_id, ...canonical) — the SAME supplier
-- invoicing the SAME organisation twice with the same number (trimmed,
-- case-insensitive) is rejected at the database level, not just by an
-- application pre-check (which cannot see a concurrent insert).
-- supplier_invoice_number itself is NOT NULL — a supplier bill records a
-- specific received invoice; there is no "unknown invoice number" bill
-- in this phase.
--
-- Three statuses only (DRAFT, POSTED, CANCELLED) — no approval gate, per
-- the explicit C7.4 instruction not to add one, mirroring
-- commercial_purchase_receipts' own identical three-state shape more
-- closely than commercial_purchase_orders' five-state shape.
--
-- No paid_cents/payment_id/payment_status column anywhere in this file —
-- supplier payments are explicitly out of C7.4 scope; a POSTED bill
-- represents a real payable FACT only, with no payment-state tracking
-- yet (see the C7.4 brief's own "payment state is NOT part of lifecycle
-- yet"). No bill-line <-> receipt-line match/allocation table either —
-- 3-way matching is a later, separate phase; this schema stays
-- compatible with it (each bill line already carries its own stable id
-- and its own source_purchase_order_line_id lineage pointer) without
-- implementing it now.
CREATE TABLE IF NOT EXISTS commercial_supplier_bills (
  id                                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                        TEXT NOT NULL REFERENCES organisations(id),
  supplier_id                            UUID NOT NULL,
  source_purchase_order_id               UUID NOT NULL,
  supplier_invoice_number                TEXT NOT NULL,
  supplier_invoice_number_canonical      TEXT GENERATED ALWAYS AS (lower(btrim(supplier_invoice_number))) STORED,
  bill_number                            TEXT,
  status                                 TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  currency                               TEXT NOT NULL DEFAULT 'AUD',
  bill_date                              DATE,
  due_date                               DATE,
  subtotal_cents                         INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents                              INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents                            INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  CHECK (total_cents = subtotal_cents + tax_cents),
  supplier_name_snapshot                 TEXT,
  supplier_legal_name_snapshot           TEXT,
  supplier_contact_name_snapshot         TEXT,
  supplier_email_snapshot                TEXT,
  supplier_phone_snapshot                TEXT,
  supplier_address_snapshot              TEXT,
  supplier_tax_business_number_snapshot  TEXT,
  supplier_reference_snapshot            TEXT,
  cancel_reason                          TEXT,
  created_by                             TEXT REFERENCES users(id),
  posted_by                              TEXT REFERENCES users(id),
  cancelled_by                           TEXT REFERENCES users(id),
  created_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at                              TIMESTAMPTZ,
  cancelled_at                           TIMESTAMPTZ,
  UNIQUE (organisation_id, bill_number),
  UNIQUE (id, organisation_id),
  -- Explicitly named (rather than left to Postgres's auto-generated,
  -- length-truncated default) so the domain layer
  -- (lib/commercial/supplierBills.ts) can reliably match this exact
  -- constraint by name when translating a 23505 unique-violation into a
  -- friendly "duplicate supplier invoice number" error.
  CONSTRAINT commercial_supplier_bills_supplier_invoice_unique
    UNIQUE (organisation_id, supplier_id, supplier_invoice_number_canonical),
  CONSTRAINT commercial_supplier_bills_po_org_fkey
    FOREIGN KEY (source_purchase_order_id, organisation_id)
    REFERENCES commercial_purchase_orders (id, organisation_id),
  CONSTRAINT commercial_supplier_bills_po_supplier_fkey
    FOREIGN KEY (source_purchase_order_id, supplier_id)
    REFERENCES commercial_purchase_orders (id, supplier_id),
  CONSTRAINT commercial_supplier_bills_supplier_org_fkey
    FOREIGN KEY (supplier_id, organisation_id)
    REFERENCES commercial_suppliers (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org ON commercial_supplier_bills(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org_status ON commercial_supplier_bills(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org_supplier ON commercial_supplier_bills(organisation_id, supplier_id);
-- Tenant-scoped "bills for this PO" read (PO detail page's linked-bills
-- panel, GET /api/commercial/purchase-orders/[id]/bills) and the
-- over-billing guard's own PO-level lock/lookup both key on this.
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org_po ON commercial_supplier_bills(organisation_id, source_purchase_order_id);

-- ── 2. Supplier bill lines ────────────────────────────────────────────
--
-- source_purchase_order_line_id is NOT NULL — the identical C7.3
-- correction applied here: a normal bill line MUST reference a concrete
-- PO line; there is no freeform/unmatched bill line in this phase.
--
-- Unlike commercial_purchase_receipt_lines (a pure quantity fact),
-- a bill line is a MONEY fact — it carries its own quantity/
-- unit_price_cents/tax_code_snapshot/tax_rate_snapshot/line_total_cents,
-- matching commercial_invoice_lines'/commercial_purchase_order_lines'
-- shape exactly, because a supplier's actual invoiced price/quantity for
-- a line can legitimately differ from what was originally ordered (a
-- partial delivery, a negotiated adjustment) — the over-billing guard
-- (lib/commercial/supplierBills.ts's postSupplierBillAtomically())
-- compares this line's OWN line_total_cents against the source PO
-- line's ordered line_total_cents, a VALUE comparison, not a
-- quantity-only one, per the C7.4 brief's explicit instruction.
--
-- quantity stays INTEGER, matching commercial_purchase_order_lines.quantity
-- exactly (unlike C7.3's receipt lines, no fractional-quantity billing
-- requirement was specified for this phase).
--
-- product_id is OPTIONAL (nullable), matching every other Commercial
-- line table's identical "ad-hoc lines are supported" pattern, and is
-- snapshotted from the source PO line at line-creation time (never
-- re-derived from a live join afterward).
CREATE TABLE IF NOT EXISTS commercial_supplier_bill_lines (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                TEXT NOT NULL REFERENCES organisations(id),
  supplier_bill_id               UUID NOT NULL,
  source_purchase_order_line_id  UUID NOT NULL,
  product_id                     UUID,
  position                       INTEGER NOT NULL DEFAULT 0,
  description_snapshot           TEXT NOT NULL,
  sku_snapshot                   TEXT,
  unit_snapshot                  TEXT,
  quantity                       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents               INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  tax_code_snapshot              TEXT,
  tax_rate_snapshot              NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100),
  line_subtotal_cents            INTEGER NOT NULL DEFAULT 0 CHECK (line_subtotal_cents >= 0),
  line_tax_cents                 INTEGER NOT NULL DEFAULT 0 CHECK (line_tax_cents >= 0),
  line_total_cents               INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_supplier_bill_lines_bill_org_fkey
    FOREIGN KEY (supplier_bill_id, organisation_id)
    REFERENCES commercial_supplier_bills (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_supplier_bill_lines_po_line_org_fkey
    FOREIGN KEY (source_purchase_order_line_id, organisation_id)
    REFERENCES commercial_purchase_order_lines (id, organisation_id),
  CONSTRAINT commercial_supplier_bill_lines_product_org_fkey
    FOREIGN KEY (product_id, organisation_id)
    REFERENCES commercial_products (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bill_lines_org ON commercial_supplier_bill_lines(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bill_lines_bill ON commercial_supplier_bill_lines(supplier_bill_id, position);
-- Load-bearing for both (a) the derived "billed-to-date per PO line"
-- read used throughout the UI/API, and (b) the over-billing guard's own
-- tenant-scoped aggregate-by-PO-line read performed, under FOR UPDATE,
-- on every bill post — see lib/commercial/supplierBills.ts's
-- postSupplierBill() for the exact statement this index serves.
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bill_lines_org_po_line ON commercial_supplier_bill_lines(organisation_id, source_purchase_order_line_id);
