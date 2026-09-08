-- Phase C4.1 — Invoice Domain Foundation. Adds the two invoice tables
-- (commercial_invoices, commercial_invoice_lines) on top of the C2
-- Commercial Core and C3 Quotes foundations (both already live in
-- production — see scripts/create-commercial-core.sql and
-- scripts/create-commercial-quotes.sql). This migration is prepared and
-- rehearsed only; it is NOT run against production during the C4.1
-- implementation phase (see the C4.1 brief's explicit "no production
-- migration" constraint).
--
-- Deliberately does NOT touch commercial_document_deliveries. That
-- table's document_type CHECK and its composite FK are still hardcoded to
-- 'quote' alone (see scripts/create-commercial-document-deliveries.sql's
-- own header comment, which already flags this for "a future Invoicing
-- phase") — widening it is explicit, separate, later work (C4.3), once an
-- actual invoice-delivery feature exists to justify it. C4.1 builds no
-- delivery/email feature at all, so there is nothing here that needs it.
--
-- Idempotent: every CREATE TABLE/INDEX uses IF NOT EXISTS; the one ALTER
-- TABLE (the commercial_quote_lines tenant-anchor retrofit) is wrapped in
-- a DO block that checks pg_constraint first, matching the exact idiom
-- scripts/create-commercial-quotes.sql's own Section 0 already
-- established for the identical situation (retrofitting a tenant anchor
-- onto a C2 table just before a new table first needs to composite-FK
-- onto it). No DROP, no DELETE, no TRUNCATE, no ALTER ... DROP anywhere
-- in this file. Safe to re-run.
--
-- NOT run automatically — a prepared migration artifact, rehearsed
-- against an isolated Neon Preview branch before any production
-- execution, following this repository's existing hand-written-SQL
-- migration convention.

-- ── 0. Retrofit tenant-integrity anchor onto commercial_quote_lines ─────
--
-- commercial_quote_lines (created by C3, already live in production) has
-- only a plain PRIMARY KEY(id) — no UNIQUE(id, organisation_id) anchor,
-- because nothing referenced it across a tenant boundary yet.
-- commercial_invoice_lines.source_quote_line_id (Section 2 below) is the
-- first thing that does, so — applying the exact C2-TIR/C3 lesson (do not
-- introduce a plain FK where a cross-tenant reference is possible) — the
-- anchor is added here, structurally, BEFORE the table that composite-FKs
-- onto it is created below.
--
-- Purely additive and safe to run against current production data: id is
-- already commercial_quote_lines' own PRIMARY KEY (hence already globally
-- unique), so no existing row can ever violate a new UNIQUE(id,
-- organisation_id) — adding one column-pair uniqueness constraint on top
-- of an already-unique column cannot fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_quote_lines_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_quote_lines
      ADD CONSTRAINT commercial_quote_lines_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;

-- ── 1. Invoices ───────────────────────────────────────────────────────
--
-- invoice_number is nullable and populated exactly once, by
-- allocateDocumentNumber('INVOICE') (lib/commercial/documentNumbering.ts,
-- already live since C2 — the 'INVOICE' document type and 'INV-' prefix
-- already exist in that allocator's own type union today, unused until
-- this phase), at the DRAFT -> ISSUED transition, never at creation — see
-- lib/commercial/invoiceLifecycle.ts / lib/commercial/invoices.ts's own
-- header comments for the full rationale (a deleted/abandoned draft
-- invoice must never permanently burn a gap in a tenant's visible invoice
-- sequence — the exact same reasoning scripts/create-commercial-quotes.sql
-- already documented for quote_number).
--
-- customer_id composite-FKs onto commercial_customers(id,
-- organisation_id) — structurally impossible for an ORG_A invoice to
-- reference an ORG_B customer. source_quote_id composite-FKs onto
-- commercial_quotes(id, organisation_id) and is NULLABLE — a standalone
-- invoice (no source quote) is a fully supported, first-class case, not
-- an edge case (quotes and invoicing are independently-entitlable
-- capability keys — see lib/commercial/authorize.ts's own
-- CommercialCapabilityKey union — so a tenant may have Invoicing without
-- Quotes at all). Deliberately NO UNIQUE constraint on source_quote_id:
-- one accepted quote must remain free to produce zero, one, or many
-- invoices (future progress/deposit invoicing), per the C4.0 architecture
-- report's explicit instruction not to foreclose that with a uniqueness
-- constraint added merely for convenience.
--
-- The six *_snapshot columns are invoice-level (customer identity at the
-- moment of ISSUE — see lib/commercial/invoices.ts's issueInvoice()) and
-- are deliberately NULL for the entire DRAFT lifetime, mirroring
-- commercial_quotes' own six identically-named snapshot columns exactly:
-- nothing has been shown to a customer yet, so the UI reads the LIVE
-- commercial_customers row (via customer_id) while drafting, and only
-- reads these snapshot columns from ISSUED onward.
--
-- due_date/payment_terms_days are both nullable in DRAFT (a due date
-- often is not yet decided while still drafting) but issueInvoice()
-- itself refuses to issue without a due_date already set — see that
-- function's own header comment. No organisation-level default
-- payment-terms-days exists yet (out of C4.1's scope; would be an
-- additive extension of the existing zero-migration
-- settings.commercial.businessProfile JSONB namespace in a later phase,
-- not a schema change here).
--
-- void_reason/voided_by/voided_at exist for the VOID terminal state —
-- the invoice equivalent of commercial_quotes' rejected_at/expired_at,
-- except VOID additionally always carries a required, non-empty reason
-- (enforced in application code, not a CHECK constraint, since "trimmed
-- non-empty" is not cleanly expressible as a simple CHECK without also
-- rejecting whitespace-only strings the same way the rest of this
-- codebase's validation lives in TypeScript, not SQL).
CREATE TABLE IF NOT EXISTS commercial_invoices (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id            TEXT NOT NULL REFERENCES organisations(id),
  customer_id                UUID NOT NULL,
  source_quote_id            UUID,
  invoice_number             TEXT,
  status                     TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'VOID')),
  currency                   TEXT NOT NULL DEFAULT 'AUD',
  issue_date                 DATE,
  due_date                   DATE,
  payment_terms_days         INTEGER,
  notes                      TEXT,
  terms                      TEXT,
  subtotal_cents             INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents                  INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents                INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  customer_name_snapshot     TEXT,
  billing_name_snapshot      TEXT,
  billing_address_snapshot   TEXT,
  email_snapshot             TEXT,
  phone_snapshot             TEXT,
  tax_identifier_snapshot    TEXT,
  created_by                 TEXT REFERENCES users(id),
  issued_by                  TEXT REFERENCES users(id),
  voided_by                  TEXT REFERENCES users(id),
  void_reason                TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at                  TIMESTAMPTZ,
  voided_at                  TIMESTAMPTZ,
  UNIQUE (organisation_id, invoice_number),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_invoices_customer_org_fkey
    FOREIGN KEY (customer_id, organisation_id)
    REFERENCES commercial_customers (id, organisation_id),
  CONSTRAINT commercial_invoices_quote_org_fkey
    FOREIGN KEY (source_quote_id, organisation_id)
    REFERENCES commercial_quotes (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_invoices_org ON commercial_invoices(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_invoices_org_status ON commercial_invoices(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_invoices_customer ON commercial_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_commercial_invoices_source_quote ON commercial_invoices(source_quote_id);

-- ── 2. Invoice lines ──────────────────────────────────────────────────
--
-- product_id is OPTIONAL (nullable) — a line may be freeform, matching
-- commercial_quote_lines' own established pattern exactly.
-- source_quote_line_id is ALSO optional (nullable) — set only when this
-- invoice line originated from a specific quote line (via
-- createInvoiceFromQuote()), for lineage/traceability only (e.g. a future
-- progress-invoicing feature could use it to know which quote line a
-- given invoice line already partially bills). Composite-FKs onto
-- commercial_quote_lines(id, organisation_id) — the anchor Section 0
-- above just added.
--
-- Every *_snapshot / unit_price_cents / tax_rate_snapshot value here is
-- captured ONCE, when the line is created (copied from the source quote
-- line's own already-snapshotted values, from the selected product's
-- current values, or entered directly for a freeform line) — never
-- re-derived from a live JOIN at read or calculation time, mirroring
-- commercial_quote_lines' own non-negotiable rule exactly. A line can
-- only be added/edited/deleted while the PARENT invoice is DRAFT (see
-- lib/commercial/invoices.ts's isInvoiceEditable() guard on every line
-- mutation).
--
-- Phase C4.1R — UNIQUE(id, organisation_id) restored. This anchor was
-- part of the original, locked C4.1 schema specification (matching the
-- same anchor every other Commercial line-item/document table carries —
-- commercial_quotes, commercial_quote_lines (see Section 0's own
-- retrofit above), commercial_customers, commercial_products,
-- commercial_tax_codes, commercial_financial_years — regardless of
-- whether a child table references them yet), but was mistakenly
-- dropped during implementation. Purely additive and safe: id is
-- already this table's own PRIMARY KEY (hence already globally unique),
-- so a UNIQUE(id, organisation_id) constraint on top of an
-- already-unique column can never fail against any existing row. Keeps
-- the table consistent with this codebase's established convention and
-- avoids a second future retrofit migration the day a child table (e.g.
-- a future credit-note-line lineage) needs to composite-FK onto it.
CREATE TABLE IF NOT EXISTS commercial_invoice_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        TEXT NOT NULL REFERENCES organisations(id),
  invoice_id             UUID NOT NULL,
  product_id             UUID,
  source_quote_line_id   UUID,
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
  CONSTRAINT commercial_invoice_lines_invoice_org_fkey
    FOREIGN KEY (invoice_id, organisation_id)
    REFERENCES commercial_invoices (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_invoice_lines_product_org_fkey
    FOREIGN KEY (product_id, organisation_id)
    REFERENCES commercial_products (id, organisation_id),
  CONSTRAINT commercial_invoice_lines_quote_line_org_fkey
    FOREIGN KEY (source_quote_line_id, organisation_id)
    REFERENCES commercial_quote_lines (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_invoice_lines_org ON commercial_invoice_lines(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_invoice_lines_invoice ON commercial_invoice_lines(invoice_id, position);
