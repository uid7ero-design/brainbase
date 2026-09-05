-- Phase C3 — First visible Commercial module: Quotes. Adds the two
-- quote tables (commercial_quotes, commercial_quote_lines) on top of the
-- C2 Commercial Core foundation (already live in production — see
-- scripts/create-commercial-core.sql). This migration is prepared and
-- rehearsed only; it is NOT run against production during the C3
-- implementation phase (see the C3 brief's explicit "no production
-- writes" constraint).
--
-- Idempotent: every statement uses IF NOT EXISTS (or an equivalent
-- existence check for the two constraint types that don't support the
-- keyword directly — see the DO blocks in Section 0). No DROP, no
-- DELETE, no TRUNCATE, no ALTER ... DROP anywhere in this file.

-- ── 0. Retrofit tenant-integrity anchors onto the two C2 tables Quotes
--       now needs to composite-FK onto ─────────────────────────────────
--
-- commercial_customers and commercial_products were both created by C2
-- (already live in production) with only a plain PRIMARY KEY(id) — no
-- UNIQUE(id, organisation_id) anchor, because nothing referenced them
-- across a tenant boundary yet. Quotes is the first thing that does
-- (commercial_quotes -> commercial_customers, commercial_quote_lines ->
-- commercial_products), so — applying the exact C2-TIR lesson (do not
-- repeat the plain-FK mistake that let a cross-tenant product/tax-code
-- link through) — both anchors are added here, structurally, BEFORE the
-- two new tables that composite-FK onto them are created below.
--
-- Purely additive and safe to run against the current production data:
-- id is already each table's own PRIMARY KEY (hence already globally
-- unique), so no existing row can ever violate a new UNIQUE(id,
-- organisation_id) — adding one column-pair uniqueness constraint on top
-- of an already-unique column cannot fail. `ADD CONSTRAINT IF NOT
-- EXISTS` is not valid PostgreSQL syntax (unlike CREATE TABLE/INDEX),
-- so a DO block existence-checks pg_constraint first — the idempotent
-- equivalent for a constraint, not new appetite for smaller-blast-radius
-- destructive DDL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_customers_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_customers
      ADD CONSTRAINT commercial_customers_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_products_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_products
      ADD CONSTRAINT commercial_products_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;

-- ── 1. Quotes ─────────────────────────────────────────────────────────
--
-- quote_number is nullable and populated exactly once, by
-- allocateDocumentNumber('QUOTE') (lib/commercial/documentNumbering.ts,
-- already live from C2), at the DRAFT -> SENT transition (issue time),
-- never at creation — see lib/commercial/quoteLifecycle.ts's own header
-- comment for the full rationale (a deleted/abandoned draft must never
-- permanently burn a gap in a tenant's visible quote sequence).
--
-- customer_id composite-FKs onto commercial_customers(id,
-- organisation_id) — structurally impossible for an ORG_A quote to
-- reference an ORG_B customer, matching the C2-TIR-established pattern,
-- not an application-level check alone.
--
-- The six *_snapshot columns are quote-level (customer identity at the
-- moment of issue — see lib/commercial/quotes.ts's issueQuote()) and are
-- deliberately NULL for the entire DRAFT lifetime: nothing has been
-- shown to a customer yet, so the UI reads the LIVE commercial_customers
-- row (via customer_id) while drafting, and only reads these snapshot
-- columns from SENT onward. This is a different rule from quote LINES
-- (see commercial_quote_lines below), which snapshot at line-creation
-- time, not at issue time — the two are snapshotted at different moments
-- for a deliberate reason documented on each table.
CREATE TABLE IF NOT EXISTS commercial_quotes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id            TEXT NOT NULL REFERENCES organisations(id),
  customer_id                UUID NOT NULL,
  quote_number               TEXT,
  status                     TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  currency                   TEXT NOT NULL DEFAULT 'AUD',
  issue_date                 DATE,
  expiry_date                DATE,
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
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at                  TIMESTAMPTZ,
  accepted_at                TIMESTAMPTZ,
  rejected_at                TIMESTAMPTZ,
  -- Not in the C3 brief's suggested column list, but added for the exact
  -- same reason accepted_at/rejected_at exist: EXPIRED is a third
  -- terminal outcome alongside ACCEPTED/REJECTED (see
  -- lib/commercial/quoteLifecycle.ts), and leaving it the only terminal
  -- state with no "when" column would be an inconsistent, not a leaner,
  -- design.
  expired_at                 TIMESTAMPTZ,
  UNIQUE (organisation_id, quote_number),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_quotes_customer_org_fkey
    FOREIGN KEY (customer_id, organisation_id)
    REFERENCES commercial_customers (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_org ON commercial_quotes(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_org_status ON commercial_quotes(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_customer ON commercial_quotes(customer_id);

-- ── 2. Quote lines ────────────────────────────────────────────────────
--
-- product_id is OPTIONAL (nullable) — a line may be freeform (no
-- catalogue product behind it), matching commercial_products.
-- default_tax_code_id's own established "nullable + composite FK still
-- works under MATCH SIMPLE" pattern from C2-TIR. When product_id IS
-- set, it composite-FKs onto commercial_products(id, organisation_id) —
-- an ORG_A line can never reference an ORG_B product.
--
-- Every *_snapshot / unit_price_cents / tax_rate_snapshot value here is
-- captured ONCE, when the line is created (copied from the selected
-- product's current values, or entered directly for a freeform line) —
-- never re-derived from a live JOIN to commercial_products at read or
-- calculation time (the C3 brief's explicit §9 requirement: "Do not
-- calculate an issued quote by joining live catalogue values"). A line
-- can only be added/edited/deleted while the PARENT quote is DRAFT (see
-- lib/commercial/quotes.ts's isQuoteEditable() guard on every line
-- mutation) — that guard, not a second issue-time copy step, is what
-- makes a line's values immutable from SENT onward. Editing
-- commercial_products later therefore cannot alter any line on any
-- quote that has already left DRAFT, whether or not that line has a
-- product_id at all.
--
-- quantity is a whole-number INTEGER, not NUMERIC — deliberately, so
-- lineTotalCents() (lib/commercial/money.ts, unchanged since C2) stays
-- exact integer multiplication with no intermediate fractional-cent
-- rounding step to design or test. No repository evidence (no existing
-- fractional-quantity billing anywhere in this codebase) supports adding
-- that complexity in this phase.
CREATE TABLE IF NOT EXISTS commercial_quote_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        TEXT NOT NULL REFERENCES organisations(id),
  quote_id               UUID NOT NULL,
  product_id             UUID,
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
  CONSTRAINT commercial_quote_lines_quote_org_fkey
    FOREIGN KEY (quote_id, organisation_id)
    REFERENCES commercial_quotes (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_quote_lines_product_org_fkey
    FOREIGN KEY (product_id, organisation_id)
    REFERENCES commercial_products (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_lines_org ON commercial_quote_lines(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_lines_quote ON commercial_quote_lines(quote_id, position);
