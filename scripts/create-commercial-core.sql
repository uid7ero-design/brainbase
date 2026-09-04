-- Phase C2 — Commercial Core Foundation. Shared primitives for the future
-- Commercial Suite (Sales/Quotes/Invoicing/Purchasing/Expenses/Budgeting/
-- Finance Intelligence). This migration creates SCHEMA ONLY — no Quote,
-- Invoice, Purchase Order, Expense, or Budget table exists yet, and no
-- row is inserted into any organisation-scoped table for any existing
-- tenant (see scripts/seed-commercial-capabilities.sql for the one
-- platform-registry seed this phase does perform).
--
-- Convention: raw SQL, not a Prisma model — matches this repository's
-- dominant pattern for organisation-scoped business tables (crm_*,
-- client_pipeline, event_*; see CLAUDE.md's own documented "Prisma
-- Client is used only in one narrow vertical" note). No prisma migrate,
-- no prisma db push.
--
-- Money: every *_cents column is INTEGER, paired with a row-scoped
-- currency TEXT column, per docs/architecture/decisions/
-- 0002-money-and-currency-standard.md. Tax rates are NUMERIC(5,2),
-- per the same ADR's Section 5/6.
--
-- Tenant scoping: every table carries organisation_id TEXT NOT NULL
-- REFERENCES organisations(id) (organisations.id is TEXT/cuid, never
-- ::uuid — see prisma/schema.prisma's Organisation model). Where a
-- genuine parent/child relationship exists within this migration
-- (commercial_financial_periods -> commercial_financial_years), the
-- child composite-FKs onto (parent_id, organisation_id), structurally
-- preventing cross-organisation linkage even if application code has a
-- bug — the same pattern scripts/create-events-phase2.sql established
-- for events(id, organisation_id) -> event_sessions/event_ticket_types
-- -> event_orders -> event_order_items -> event_attendees.
--
-- Idempotent: every statement uses IF NOT EXISTS. No DROP, no DELETE,
-- no TRUNCATE, no ALTER ... DROP anywhere in this file. Safe to re-run.
--
-- NOT run automatically — a prepared migration artifact, rehearsed
-- separately before any production execution, following this
-- repository's existing hand-written-SQL-migration convention.

-- ── 1. Commercial customer / counterparty anchor ────────────────────────
--
-- Deliberately NOT organisations.id (that is the BrainBase TENANT) and
-- deliberately NOT a hard dependency on crm_companies/crm_contacts
-- existing or the 'crm' capability being enabled for this organisation —
-- a Commercial module must be usable by a tenant with Commercial enabled
-- but CRM disabled. crm_company_id/crm_contact_id are OPTIONAL,
-- unenforced (plain, not composite-FK'd) links for tenants that do have
-- both — matching crm_deals' own existing company_id/contact_id
-- convention (plain FK, no composite tenant enforcement), not a new,
-- stricter pattern for these two specific optional columns.
CREATE TABLE IF NOT EXISTS commercial_customers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT NOT NULL REFERENCES organisations(id),
  name                 TEXT NOT NULL,
  crm_company_id       UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  crm_contact_id       UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  billing_email        TEXT,
  billing_phone        TEXT,
  billing_address      TEXT,
  tax_business_number  TEXT,
  active               BOOLEAN NOT NULL DEFAULT true,
  created_by           TEXT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commercial_customers_org ON commercial_customers(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_customers_active ON commercial_customers(organisation_id, active);

-- ── 2. Tax codes (data-driven, tenant-configurable — Option A from the
--       phase brief's Section 7 choice) ─────────────────────────────────
--
-- A small, explicit, per-tenant list (GST 10%, GST-free, Export, ...)
-- rather than a hardcoded enum — avoids baking one jurisdiction's rules
-- into the schema while still giving Australia-first tenants a real,
-- selectable GST rate. No row is seeded for any existing organisation by
-- this migration — an org configures its own tax codes later, through a
-- future admin surface this phase does not build.
CREATE TABLE IF NOT EXISTS commercial_tax_codes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  rate             NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
  is_default       BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code)
);
CREATE INDEX IF NOT EXISTS idx_commercial_tax_codes_org ON commercial_tax_codes(organisation_id);

-- ── 3. Product / service catalogue ───────────────────────────────────────
--
-- No inventory/stock management, no price books — a flat, tenant-scoped
-- list of sellable things with one default price. default_tax_code_id is
-- OPTIONAL (nullable) — a product can exist before the org has configured
-- any tax code.
CREATE TABLE IF NOT EXISTS commercial_products (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT NOT NULL REFERENCES organisations(id),
  type                      TEXT NOT NULL CHECK (type IN ('PRODUCT', 'SERVICE')),
  name                      TEXT NOT NULL,
  description               TEXT,
  sku                       TEXT,
  active                    BOOLEAN NOT NULL DEFAULT true,
  unit_label                TEXT,
  default_unit_price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (default_unit_price_cents >= 0),
  currency                  TEXT NOT NULL DEFAULT 'AUD',
  default_tax_code_id       UUID REFERENCES commercial_tax_codes(id) ON DELETE SET NULL,
  created_by                TEXT REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commercial_products_org ON commercial_products(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_products_active ON commercial_products(organisation_id, active);
-- SKU uniqueness is a genuine data-quality rule (two products with the
-- same SKU inside one tenant is a real bug), not speculative — partial
-- index so a blank/NULL SKU is never compared against another blank one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_products_org_sku ON commercial_products(organisation_id, sku) WHERE sku IS NOT NULL;

-- ── 4. Document numbering ────────────────────────────────────────────────
--
-- One row per (organisation_id, document_type) — e.g. ('org_123',
-- 'INVOICE'). Allocation is a single atomic UPDATE (see
-- lib/commercial/documentNumbering.ts), never a SELECT-then-INSERT
-- pattern that could race. next_number is "the next number that will be
-- allocated" (starts at 1) — the allocator increments it and returns the
-- PRE-increment value, so the persisted value always represents unused
-- future capacity, never a duplicate of what was just handed out.
CREATE TABLE IF NOT EXISTS commercial_document_sequences (
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  document_type    TEXT NOT NULL,
  prefix           TEXT NOT NULL DEFAULT '',
  next_number      INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  padding          INTEGER NOT NULL DEFAULT 6 CHECK (padding >= 1),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, document_type)
);

-- ── 5. Financial years / periods ─────────────────────────────────────────
--
-- Independent of Debtors' own imported, source-specific
-- debtor_accounts.financial_year TEXT field (a raw ingestion artifact,
-- e.g. "2023-24" derived from a source bookname) — that column is NOT
-- FK'd into this table by this migration, per the phase brief's explicit
-- instruction. This is a genuinely new, structured period concept for
-- future budgets/invoicing-reporting/purchasing-reporting/finance
-- intelligence, unrelated in origin to the Debtors ingestion pipeline.
CREATE TABLE IF NOT EXISTS commercial_financial_years (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  name             TEXT NOT NULL,
  starts_on        DATE NOT NULL,
  ends_on          DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on),
  UNIQUE (organisation_id, name),
  -- Composite tenant-integrity anchor for commercial_financial_periods
  -- below — same (id, organisation_id) UNIQUE-then-composite-FK shape
  -- scripts/create-events-phase2.sql established for events(id,
  -- organisation_id).
  UNIQUE (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_financial_years_org ON commercial_financial_years(organisation_id);

-- Overlap prevention between periods in the same financial year is
-- deliberately NOT enforced at the database level in this phase (no
-- EXCLUDE constraint) — no create/edit route exists yet for this table
-- (out of scope: this phase is schema + helpers only), so there is
-- nothing yet to enforce it against. A future phase that adds the actual
-- period-management route is the right place to decide the exact overlap
-- rule and enforce it (application-level check, or a real EXCLUDE
-- constraint with btree_gist) — noted here so that decision is not
-- silently skipped, only deferred with a reason.
CREATE TABLE IF NOT EXISTS commercial_financial_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_id   UUID NOT NULL,
  organisation_id     TEXT NOT NULL REFERENCES organisations(id),
  name                TEXT NOT NULL,
  starts_on           DATE NOT NULL,
  ends_on             DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on),
  UNIQUE (organisation_id, financial_year_id, name),
  CONSTRAINT commercial_financial_periods_year_org_fkey
    FOREIGN KEY (financial_year_id, organisation_id)
    REFERENCES commercial_financial_years (id, organisation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commercial_financial_periods_org ON commercial_financial_periods(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_financial_periods_year ON commercial_financial_periods(financial_year_id);

-- ── 6. Cost centres ───────────────────────────────────────────────────────
--
-- Flat list only — no parent_id/hierarchy. No repository evidence (no
-- existing cost-centre, category-tree, or chart-of-accounts concept
-- anywhere in this codebase — Metric.dimension/dimension_value is a
-- free-text, unstructured pair, not a genuine hierarchy) supports adding
-- one now.
CREATE TABLE IF NOT EXISTS commercial_cost_centres (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code)
);
CREATE INDEX IF NOT EXISTS idx_commercial_cost_centres_org ON commercial_cost_centres(organisation_id);
