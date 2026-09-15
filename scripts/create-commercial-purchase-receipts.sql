-- Phase C7.3 — Purchase Receipts Foundation. Adds two tables
-- (commercial_purchase_receipts, commercial_purchase_receipt_lines) on
-- top of the C6.2 Purchasing foundation (scripts/create-commercial-
-- purchasing.sql, already live in Production). This migration is
-- prepared and rehearsed only; it is NOT run against Production or any
-- shared Preview database during this phase.
--
-- Scope, per the C7.1 audit and its approved C7.3 corrections: purchase
-- receipts ONLY — supporting BOTH goods and services from day one, PO-
-- backed only (no standalone/unexpected receipts), no approval gate, no
-- supplier bills, no PO<->bill matching, no supplier payments, no
-- budgets/encumbrance. See each column's own comment below for where
-- something was deliberately NOT anticipated with a speculative column.
--
-- Convention: raw SQL, not a Prisma model — matches every other
-- Commercial table (CLAUDE.md's own documented "Prisma Client is used
-- only in one narrow vertical" note). No prisma migrate, no prisma db
-- push.
--
-- Tenant scoping: every table carries organisation_id TEXT NOT NULL
-- REFERENCES organisations(id) (organisations.id is TEXT/cuid, never
-- ::uuid). Every cross-table reference composite-FKs onto
-- (parent_id, organisation_id), structurally preventing cross-
-- organisation linkage — the same pattern every prior Commercial
-- migration (C2/C3/C4.1/C5.2/C6.2/C6.9) has established.
--
-- Idempotent: every CREATE TABLE/INDEX uses IF NOT EXISTS. No DROP, no
-- DELETE, no TRUNCATE, no ALTER ... DROP anywhere in this file. Safe to
-- re-run.
--
-- NOT run automatically — a prepared migration artifact, rehearsed
-- against disposable PostgreSQL (and, later, an isolated Neon Preview
-- branch) before any Production execution, following this repository's
-- existing hand-written-SQL migration convention.

-- ── 1. Purchase receipts (the header) ────────────────────────────────
--
-- Deliberately named "Purchase Receipt", not "Goods Receipt" — this
-- table records BOTH goods and services being received/rendered against
-- an issued purchase order, never just physical goods.
--
-- receipt_number is nullable and populated exactly once, by the
-- existing allocateDocumentNumber-style atomic allocator
-- (lib/commercial/documentNumbering.ts, widened this phase to add the
-- 'PURCHASE_RECEIPT' document type / 'GR-' prefix), at the DRAFT ->
-- POSTED transition, never at creation — the exact same reasoning
-- already established for purchase_order_number/invoice_number/
-- quote_number: a deleted/abandoned draft must never permanently burn a
-- gap in a tenant's visible receipt sequence.
--
-- purchase_order_id is NOT NULL and composite-FKs onto
-- commercial_purchase_orders(id, organisation_id) — C7.3 is strictly
-- PO-backed; there is no standalone-receipt concept in this phase (see
-- the C7.1 audit's own Section D, explicitly revised for C7.3: "Every
-- purchase receipt must belong to one purchase order").
--
-- Three statuses only (DRAFT, POSTED, CANCELLED) — deliberately no
-- approval gate (PENDING_APPROVAL), per the explicit C7.3 instruction
-- not to add one. Mirrors commercial_invoices' own three-state shape
-- more closely than commercial_purchase_orders' five-state shape.
--
-- No received_quantity/billed_quantity/matched_quantity/paid_cents/
-- payment_id/financial_period_id/committed/encumbrance column anywhere
-- in this file, and none is added to commercial_purchase_orders or
-- commercial_purchase_order_lines by this migration either — received-
-- to-date is DERIVED at read time from POSTED, non-cancelled receipt
-- lines (see lib/commercial/purchaseReceipts.ts's
-- getReceivedQuantitiesForPurchaseOrder()), exactly mirroring
-- commercial_invoices' own `overdue`/amount_paid_cents "never a
-- stored/cached column that could drift" rule. This is also why
-- tests/containment/commercialPurchasingSchema.test.ts's own existing
-- negative assertions (no received_quantity/committed/encumbrance
-- column on the PO/PO-line tables) remain true, unmodified, after this
-- migration.
--
-- No supplier-bill/matching/payment column of any kind — explicitly out
-- of C7.3 scope (see the C7.1 audit's Section Q and this phase's own
-- explicit "Do NOT implement" list). A FUTURE 3-way-matching phase would
-- need an explicit bill-line <-> receipt-line allocation/match table —
-- this schema is compatible with that (each receipt line already has
-- its own stable id and its own source_purchase_order_line_id lineage
-- pointer) without needing any change here.
CREATE TABLE IF NOT EXISTS commercial_purchase_receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     TEXT NOT NULL REFERENCES organisations(id),
  purchase_order_id   UUID NOT NULL,
  receipt_number      TEXT,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  received_date       DATE,
  delivery_reference  TEXT, -- the supplier's own delivery-note/docket reference, freeform
  notes               TEXT,
  cancel_reason       TEXT, -- required by the application on any -> CANCELLED transition (enforced in TypeScript, matching commercial_purchase_orders.cancel_reason's own identical "trimmed non-empty is not cleanly expressible as a simple CHECK" rationale)
  created_by          TEXT REFERENCES users(id),
  posted_by           TEXT REFERENCES users(id),
  cancelled_by        TEXT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at           TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  UNIQUE (organisation_id, receipt_number),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_purchase_receipts_po_org_fkey
    FOREIGN KEY (purchase_order_id, organisation_id)
    REFERENCES commercial_purchase_orders (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipts_org ON commercial_purchase_receipts(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipts_org_status ON commercial_purchase_receipts(organisation_id, status);
-- Tenant-scoped "receipts for this PO" read (PO detail page's linked-
-- receipts panel, GET /api/commercial/purchase-orders/[id]/receipts) and
-- the over-receipt guard's own PO-level lock/lookup both key on this.
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipts_org_po ON commercial_purchase_receipts(organisation_id, purchase_order_id);

-- ── 2. Purchase receipt lines ─────────────────────────────────────────
--
-- source_purchase_order_line_id is NOT NULL — deliberately NOT the
-- nullable "lineage only" pattern commercial_invoice_lines.
-- source_quote_line_id uses. C7.3's own explicit correction: a normal
-- receipt line MUST reference a concrete PO line (a freeform PO line
-- still has a line id — see commercial_purchase_order_lines, whose
-- product_id is optional but whose own id never is); unexpected/
-- unplanned receipt lines with no PO-line link are explicitly not part
-- of this phase.
--
-- quantity_received is NUMERIC(14,4), NOT the INTEGER type
-- commercial_purchase_order_lines.quantity uses — an approved,
-- deliberate C7.3 design correction: PO line quantity is integer-only
-- today (matching commercial_invoice_lines/commercial_quote_lines
-- exactly, per scripts/create-commercial-purchasing.sql's own header),
-- but a receipt must support fractional receiving of a SERVICE line
-- (e.g. "6.5 of 10 consulting hours delivered so far") from day one —
-- copying the PO line's own INTEGER-only type here would foreclose that
-- immediately. This does not change commercial_purchase_order_lines
-- itself in any way (still INTEGER, unmodified) — the over-receipt guard
-- compares this NUMERIC sum against that INTEGER ordered quantity, which
-- Postgres compares correctly without any cast.
--
-- No unit_price_cents/tax_code_snapshot/tax_rate_snapshot/line_total_cents
-- column — a receipt line is a QUANTITY fact only, never a financial
-- one; money/tax belongs to a future Supplier Bill line, explicitly out
-- of C7.3 scope.
--
-- description_snapshot/sku_snapshot/unit_snapshot are copied from the
-- source PO line's OWN already-frozen snapshot columns at the moment
-- this receipt line is created — never re-derived from a live product
-- join afterward, matching every other Commercial line table's
-- "snapshot once, never re-derive" rule exactly, and specifically
-- preserving PO-line identity/snapshot data so a receipt remains
-- auditable even after a later catalogue (product) edit.
CREATE TABLE IF NOT EXISTS commercial_purchase_receipt_lines (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                TEXT NOT NULL REFERENCES organisations(id),
  purchase_receipt_id            UUID NOT NULL,
  source_purchase_order_line_id  UUID NOT NULL,
  position                       INTEGER NOT NULL DEFAULT 0,
  description_snapshot           TEXT NOT NULL,
  sku_snapshot                   TEXT,
  unit_snapshot                  TEXT,
  quantity_received              NUMERIC(14,4) NOT NULL CHECK (quantity_received > 0),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_purchase_receipt_lines_receipt_org_fkey
    FOREIGN KEY (purchase_receipt_id, organisation_id)
    REFERENCES commercial_purchase_receipts (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_purchase_receipt_lines_po_line_org_fkey
    FOREIGN KEY (source_purchase_order_line_id, organisation_id)
    REFERENCES commercial_purchase_order_lines (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipt_lines_org ON commercial_purchase_receipt_lines(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipt_lines_receipt ON commercial_purchase_receipt_lines(purchase_receipt_id, position);
-- Load-bearing for both (a) the derived "received-to-date per PO line"
-- read used throughout the UI/API, and (b) the over-receipt guard's own
-- tenant-scoped aggregate-by-PO-line read performed, under FOR UPDATE,
-- on every receipt post — see lib/commercial/purchaseReceipts.ts's
-- postPurchaseReceipt() for the exact statement this index serves.
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipt_lines_org_po_line ON commercial_purchase_receipt_lines(organisation_id, source_purchase_order_line_id);
