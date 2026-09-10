-- Phase C6.2 — Purchasing / Purchase Orders Foundation. Adds three tables
-- (commercial_suppliers, commercial_purchase_orders,
-- commercial_purchase_order_lines) on top of the C2 Commercial Core, C3
-- Quotes, and C4.1 Invoices foundations (all already live in Production —
-- see scripts/create-commercial-core.sql, scripts/create-commercial-
-- quotes.sql, scripts/create-commercial-invoices.sql). This migration is
-- prepared and rehearsed only; it is NOT run against Production or
-- Preview during the C6.2 implementation phase.
--
-- Scope, per the C6.1 architecture review and C6.2 domain-contract
-- freeze: suppliers + purchase orders + PO lines + lifecycle + atomic
-- numbering ONLY. No Purchase Request table, no receiving, no bills/AP,
-- no supplier payments, no budgeting/encumbrance engine — see this
-- file's own column comments for where each of those was deliberately
-- NOT anticipated with a speculative column.
--
-- Convention: raw SQL, not a Prisma model — matches every other
-- Commercial table (CLAUDE.md's own documented "Prisma Client is used
-- only in one narrow vertical" note). No prisma migrate, no prisma db
-- push.
--
-- Money: every *_cents column is INTEGER, paired with a row-scoped
-- currency TEXT column, per docs/architecture/decisions/
-- 0002-money-and-currency-standard.md. Tax rates are NUMERIC(5,2), per
-- the same ADR. No floating-point money anywhere in this file.
--
-- Tenant scoping: every table carries organisation_id TEXT NOT NULL
-- REFERENCES organisations(id) (organisations.id is TEXT/cuid, never
-- ::uuid). Every cross-table reference within this migration composite-
-- FKs onto (parent_id, organisation_id), structurally preventing
-- cross-organisation linkage — the same pattern every prior Commercial
-- migration (C2/C3/C4.1/C5.2) has established.
--
-- Idempotent: every CREATE TABLE/INDEX uses IF NOT EXISTS. The one ALTER
-- TABLE (Section 0's commercial_cost_centres tenant-anchor retrofit) is
-- wrapped in a DO block that checks pg_constraint first, matching the
-- exact idiom scripts/create-commercial-quotes.sql's own Section 0 and
-- scripts/create-commercial-invoices.sql's own Section 0 already
-- established for the identical situation (retrofitting a tenant anchor
-- onto a pre-existing Commercial Core table just before a new table
-- first needs to composite-FK onto it). No DROP, no DELETE, no TRUNCATE,
-- no ALTER ... DROP anywhere in this file. Safe to re-run.
--
-- NOT run automatically — a prepared migration artifact, rehearsed
-- against disposable PostgreSQL (and, later, an isolated Neon Preview
-- branch) before any Production execution, following this repository's
-- existing hand-written-SQL migration convention.

-- ── 0. Retrofit tenant-integrity anchor onto commercial_cost_centres ────
--
-- commercial_cost_centres (created by C2, already live in Production)
-- has only a plain PRIMARY KEY(id) plus UNIQUE(organisation_id, code) —
-- no UNIQUE(id, organisation_id) anchor, because nothing referenced it
-- across a tenant boundary yet (confirmed empirically this phase: no
-- migration between C2 and now added one — commercial_products and
-- commercial_customers both got this exact retrofit in
-- scripts/create-commercial-quotes.sql's own Section 0 when THEY first
-- needed it; commercial_cost_centres never has, until now).
-- commercial_purchase_orders.cost_centre_id and
-- commercial_purchase_order_lines.cost_centre_id (Sections 2 and 3
-- below) are the first things that do — applying the exact
-- C2-TIR/C3/C4.1 lesson (do not introduce a plain FK where a
-- cross-tenant reference is possible), the anchor is added here,
-- structurally, BEFORE the tables that composite-FK onto it are created.
--
-- Purely additive and safe to run against current Production data: id is
-- already commercial_cost_centres' own PRIMARY KEY (hence already
-- globally unique), so no existing row can ever violate a new
-- UNIQUE(id, organisation_id) — adding one column-pair uniqueness
-- constraint on top of an already-unique column cannot fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_cost_centres_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_cost_centres
      ADD CONSTRAINT commercial_cost_centres_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;

-- ── 1. Suppliers ──────────────────────────────────────────────────────
--
-- Deliberately a SEPARATE table from commercial_customers, not a reused
-- or merged model — see the C6 architecture review's Section D for the
-- full rationale (mirrors commercial_customers' own header comment
-- exactly: a Commercial module must be usable by a tenant with
-- Purchasing enabled but CRM disabled, and Sales/Purchasing are
-- independently-entitlable capability keys, so a supplier is not a
-- customer merely because both are external parties). crm_company_id/
-- crm_contact_id are OPTIONAL, PLAIN (non-composite) foreign keys —
-- matching commercial_customers' own identical columns exactly, for the
-- identical reason: crm_companies/crm_contacts carry no
-- UNIQUE(id, organisation_id) anchor of their own today, and adding one
-- is a cross-team CRM-schema change out of this phase's bounded scope.
-- Fail-closed application-level ownership validation (mirroring
-- lib/commercial/customers.ts's assertCrmCompanyOwnership()/
-- assertCrmContactOwnership()) is therefore REQUIRED in the domain
-- layer for these two columns, not optional hardening.
--
-- UNIQUE(id, organisation_id) is included from the very first creation
-- of this table (unlike commercial_customers, which needed a later
-- retrofit) — commercial_purchase_orders.supplier_id below needs to
-- composite-FK onto it immediately.
--
-- No supplier balance, AP status, payable account, or bank/payment
-- detail columns — explicitly out of C6.2 scope (see the C6
-- architecture review's Section C/D: those belong to a later
-- Bills/AP/Supplier-Payments phase this table must not anticipate with
-- a speculative column).
CREATE TABLE IF NOT EXISTS commercial_suppliers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       TEXT NOT NULL REFERENCES organisations(id),
  name                  TEXT NOT NULL,
  legal_name            TEXT,
  contact_name          TEXT,
  email                 TEXT,
  phone                 TEXT,
  billing_address       TEXT,
  tax_business_number   TEXT,
  supplier_reference    TEXT,
  payment_terms_days    INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  crm_company_id        UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  crm_contact_id        UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  created_by            TEXT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_suppliers_org ON commercial_suppliers(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_suppliers_active ON commercial_suppliers(organisation_id, active);

-- ── 2. Purchase orders ────────────────────────────────────────────────
--
-- purchase_order_number is nullable and populated exactly once, by
-- allocateDocumentNumberAtomically-style logic inside
-- issuePurchaseOrderAtomically() (lib/commercial/purchaseOrders.ts,
-- mirroring lib/commercial/invoices.ts's own issueInvoiceAtomically()
-- exactly), at the APPROVED -> ISSUED transition, never at creation and
-- never at PENDING_APPROVAL/APPROVED — a deleted/abandoned/returned
-- draft must never permanently burn a gap in a tenant's visible PO
-- sequence, the same reasoning already established for quote_number/
-- invoice_number. The 'PURCHASE_ORDER' document type and 'PO-' prefix
-- already exist in lib/commercial/documentNumbering.ts's own type union
-- today (registered since Phase C2), unused until this phase.
--
-- supplier_id composite-FKs onto commercial_suppliers(id,
-- organisation_id) — structurally impossible for an ORG_A purchase order
-- to reference an ORG_B supplier.
--
-- Five statuses (DRAFT, PENDING_APPROVAL, APPROVED, ISSUED, CANCELLED) —
-- one more than commercial_invoices' three, because a PO has a genuine
-- internal approval gate an invoice does not. No payment/receipt states
-- (no PAID, no RECEIVED) — those belong to later, separate phases,
-- mirroring invoiceLifecycle.ts's own identical reasoning for omitting
-- PAID before C5 existed.
--
-- The eleven *_snapshot columns are populated/frozen ONLY at ISSUE (see
-- lib/commercial/purchaseOrders.ts's issuePurchaseOrderAtomically()) and
-- are deliberately NULL for the entire DRAFT/PENDING_APPROVAL/APPROVED
-- lifetime — mirroring commercial_invoices' own six identically-shaped
-- snapshot columns exactly: nothing has been sent to a supplier yet, so
-- the UI reads the LIVE commercial_suppliers row (via supplier_id) while
-- drafting/approving, and only reads these snapshot columns from ISSUED
-- onward.
--
-- return_reason is populated only on a PENDING_APPROVAL -> DRAFT return
-- (never cleared afterward — it is history, not current state, exactly
-- like void_reason/cancel_reason are never cleared on a later state).
-- cancel_reason is required by the application on any -> CANCELLED
-- transition (enforced in TypeScript, not a CHECK constraint, matching
-- commercial_invoices.void_reason's own identical "trimmed non-empty is
-- not cleanly expressible as a simple CHECK" rationale).
--
-- No committed/encumbrance/budget-consumption column — cost_centre_id
-- (this table and the line table) is the only fact C6.2 stores for a
-- later Budgeting phase; the calculation itself belongs entirely to that
-- later phase, per the C6 architecture review's Section M.
CREATE TABLE IF NOT EXISTS commercial_purchase_orders (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                       TEXT NOT NULL REFERENCES organisations(id),
  supplier_id                           UUID NOT NULL,
  purchase_order_number                 TEXT,
  status                                TEXT NOT NULL DEFAULT 'DRAFT'
                                         CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED')),
  currency                              TEXT NOT NULL DEFAULT 'AUD',
  cost_centre_id                        UUID,
  supplier_reference                    TEXT,
  delivery_date                         DATE,
  delivery_address_line1                TEXT,
  delivery_address_line2                TEXT,
  delivery_suburb                       TEXT,
  delivery_state                        TEXT,
  delivery_postcode                     TEXT,
  delivery_country                      TEXT,
  payment_terms_days                    INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  internal_notes                        TEXT,
  supplier_notes                        TEXT,
  subtotal_cents                        INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents                             INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents                           INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  CHECK (total_cents = subtotal_cents + tax_cents),
  supplier_name_snapshot                TEXT,
  supplier_legal_name_snapshot          TEXT,
  supplier_contact_name_snapshot        TEXT,
  supplier_email_snapshot               TEXT,
  supplier_phone_snapshot               TEXT,
  supplier_address_snapshot             TEXT,
  supplier_tax_business_number_snapshot TEXT,
  supplier_reference_snapshot           TEXT,
  payment_terms_days_snapshot           INTEGER,
  return_reason                         TEXT,
  cancel_reason                         TEXT,
  created_by                            TEXT REFERENCES users(id),
  submitted_by                          TEXT REFERENCES users(id),
  approved_by                           TEXT REFERENCES users(id),
  issued_by                             TEXT REFERENCES users(id),
  cancelled_by                          TEXT REFERENCES users(id),
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at                          TIMESTAMPTZ,
  approved_at                           TIMESTAMPTZ,
  issued_at                             TIMESTAMPTZ,
  cancelled_at                          TIMESTAMPTZ,
  UNIQUE (organisation_id, purchase_order_number),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_purchase_orders_supplier_org_fkey
    FOREIGN KEY (supplier_id, organisation_id)
    REFERENCES commercial_suppliers (id, organisation_id),
  CONSTRAINT commercial_purchase_orders_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_orders_org ON commercial_purchase_orders(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_orders_org_status ON commercial_purchase_orders(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_orders_supplier ON commercial_purchase_orders(organisation_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_commercial_purchase_orders_org_issued ON commercial_purchase_orders(organisation_id, issued_at);

-- ── 3. Purchase order lines ───────────────────────────────────────────
--
-- product_id is OPTIONAL (nullable) — a line may be freeform (ad-hoc
-- purchasing), matching commercial_invoice_lines'/commercial_quote_lines'
-- own established pattern exactly.
--
-- No tax_code_id column — matching commercial_invoice_lines' own exact
-- current semantics: there is no persisted tax-code foreign key on a
-- line row anywhere in this codebase today, only the two snapshot
-- columns below (tax_code_snapshot/tax_rate_snapshot), captured once at
-- the moment the line is created/edited from whichever tax code was
-- selected at input time. Introducing a tax_code_id column here would be
-- inventing a new convention Sales does not use, not reusing an existing
-- one.
--
-- quantity is INTEGER, exactly matching commercial_invoice_lines.quantity
-- / commercial_quote_lines.quantity's own type/scale precisely (no
-- fractional-quantity purchasing exists anywhere in Commercial today).
--
-- position (not "sort_order") — matching commercial_invoice_lines' own
-- exact column name, for the exact same purpose.
--
-- Every *_snapshot / unit_price_cents / tax_rate_snapshot value here is
-- captured ONCE, when the line is created (from the selected product's
-- current values, or entered directly for a freeform line) — never
-- re-derived from a live JOIN at read or calculation time, mirroring
-- commercial_invoice_lines'/commercial_quote_lines' own non-negotiable
-- rule exactly. A line can only be added/edited/deleted while the
-- PARENT purchase order is DRAFT (see lib/commercial/purchaseOrders.ts's
-- isPurchaseOrderEditable() guard on every line mutation).
--
-- cost_centre_id is an OPTIONAL line-level override of the PO-level
-- cost_centre_id — a future Budgeting phase may want per-line
-- attribution; C6.2 stores only the relational fact, no calculation.
--
-- No received_quantity, billed_quantity, matched_quantity, or payment
-- field of any kind — explicitly out of C6.2 scope (receiving/AP/
-- three-way-matching belong to later, separate phases; see the C6
-- architecture review's Section M for why nothing here blocks adding
-- those later without touching this table).
CREATE TABLE IF NOT EXISTS commercial_purchase_order_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        TEXT NOT NULL REFERENCES organisations(id),
  purchase_order_id      UUID NOT NULL,
  product_id             UUID,
  cost_centre_id         UUID,
  position               INTEGER NOT NULL DEFAULT 0,
  description_snapshot   TEXT NOT NULL,
  sku_snapshot           TEXT,
  unit_snapshot          TEXT,
  quantity               INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents       INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  tax_code_snapshot      TEXT,
  tax_rate_snapshot      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100),
  line_subtotal_cents    INTEGER NOT NULL DEFAULT 0 CHECK (line_subtotal_cents >= 0),
  line_tax_cents         INTEGER NOT NULL DEFAULT 0 CHECK (line_tax_cents >= 0),
  line_total_cents       INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_po_lines_po_org_fkey
    FOREIGN KEY (purchase_order_id, organisation_id)
    REFERENCES commercial_purchase_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_po_lines_product_org_fkey
    FOREIGN KEY (product_id, organisation_id)
    REFERENCES commercial_products (id, organisation_id),
  CONSTRAINT commercial_po_lines_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_po_lines_org ON commercial_purchase_order_lines(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_po_lines_po ON commercial_purchase_order_lines(purchase_order_id, position);
