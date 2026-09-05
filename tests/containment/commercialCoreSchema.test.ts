import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C2 — Commercial Core schema (scripts/create-commercial-core.sql).
// Static containment on the migration artifact itself — this repo's
// established convention for hand-written SQL migrations (matching
// tests/containment/debtorChargeLineColumns.test.ts /
// debtorAccountRollup.test.ts's own pattern for the C1 Debtors schema).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-core.sql'))

describe('Phase C2 — commercial core schema is idempotent and non-destructive', () => {
  it('every table/index creation uses IF NOT EXISTS', () => {
    const ddlLines = source.split('\n').filter(l => /CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(l))
    expect(ddlLines.length).toBeGreaterThan (10)
    for (const line of ddlLines) expect(line, line).toMatch(/IF NOT EXISTS/)
  })

  it('contains no destructive DDL/DML (no DROP, DELETE, TRUNCATE, ALTER ... DROP)', () => {
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
  })

  it('never INSERTs a row for any existing organisation — schema only, no data seeding for any real tenant', () => {
    expect(source).not.toMatch(/INSERT INTO commercial_/i)
  })
})

describe('Phase C2 — every commercial_ table is tenant-scoped', () => {
  const tables = [
    'commercial_customers', 'commercial_tax_codes', 'commercial_products',
    'commercial_document_sequences', 'commercial_financial_years',
    'commercial_financial_periods', 'commercial_cost_centres',
  ]

  it.each(tables)('%s declares organisation_id TEXT NOT NULL REFERENCES organisations(id)', (table) => {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
    expect(start, `${table} not found`).toBeGreaterThan(-1)
    const end = source.indexOf(');', start)
    const body = source.slice(start, end)
    expect(body).toMatch(/organisation_id\s+TEXT\s+NOT NULL\s+REFERENCES organisations\(id\)/)
  })

  it.each(tables)('%s never declares organisation_id as UUID (the exact C1 regression class)', (table) => {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
    const end = source.indexOf(');', start)
    const body = source.slice(start, end)
    expect(body).not.toMatch(/organisation_id\s+UUID/)
  })
})

describe('Phase C2 — money/currency columns follow ADR-0002', () => {
  it('commercial_products stores price as INTEGER *_cents, non-negative, with a paired currency column', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_products (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/default_unit_price_cents\s+INTEGER NOT NULL DEFAULT 0 CHECK \(default_unit_price_cents >= 0\)/)
    expect(body).toMatch(/currency\s+TEXT NOT NULL DEFAULT 'AUD'/)
  })

  it('commercial_tax_codes stores rate as NUMERIC(5,2), bounded 0-100 — never Float/*_cents for a rate', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_tax_codes (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/rate\s+NUMERIC\(5,2\) NOT NULL DEFAULT 0 CHECK \(rate >= 0 AND rate <= 100\)/)
  })

  it('no commercial_ table anywhere uses a bare FLOAT/REAL/DOUBLE money column', () => {
    expect(source).not.toMatch(/\b(FLOAT|REAL|DOUBLE PRECISION)\b/i)
  })
})

describe('Phase C2 — product catalogue supports PRODUCT vs SERVICE and tax treatment', () => {
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_products (')
  const body = source.slice(start, source.indexOf(');', start))

  it("type is constrained to exactly ('PRODUCT', 'SERVICE')", () => {
    expect(body).toMatch(/type\s+TEXT NOT NULL CHECK \(type IN \('PRODUCT', 'SERVICE'\)\)/)
  })

  it('default_tax_code_id is an optional (nullable) UUID column — a product can exist before tax codes are configured', () => {
    expect(body).toMatch(/default_tax_code_id\s+UUID,/)
    expect(body).not.toMatch(/default_tax_code_id\s+UUID NOT NULL/)
  })

  it('Phase C2-TIR — default_tax_code_id is a COMPOSITE FK onto commercial_tax_codes(id, organisation_id), not a plain single-column FK (the exact cross-tenant gap confirmed in Phase C2-PMC §H)', () => {
    expect(body).toMatch(/FOREIGN KEY \(default_tax_code_id, organisation_id\)\s*\n\s*REFERENCES commercial_tax_codes \(id, organisation_id\)/)
    // No plain single-column FK to commercial_tax_codes(id) remains anywhere in this table.
    expect(body).not.toMatch(/default_tax_code_id\s+UUID REFERENCES commercial_tax_codes\(id\)/)
  })

  it('SKU uniqueness is per-organisation, and only enforced when a SKU is actually present (partial index)', () => {
    expect(source).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_products_org_sku ON commercial_products\(organisation_id, sku\) WHERE sku IS NOT NULL/)
  })
})

describe('Phase C2 — cost centres: unique code per tenant, no hierarchy without evidence', () => {
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_cost_centres (')
  const body = source.slice(start, source.indexOf(');', start))

  it('code is UNIQUE per (organisation_id, code)', () => {
    expect(body).toMatch(/UNIQUE \(organisation_id, code\)/)
  })

  it('has an active flag for deactivation, not deletion', () => {
    expect(body).toMatch(/active\s+BOOLEAN NOT NULL DEFAULT true/)
  })

  it('has no parent_id / hierarchy column (no repository evidence supports one yet)', () => {
    expect(body).not.toMatch(/parent_id/)
  })
})

describe('Phase C2 — financial years/periods: valid date ranges, tenant-structural integrity', () => {
  it('commercial_financial_years enforces ends_on > starts_on and carries a UNIQUE(id, organisation_id) tenant-integrity anchor', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_financial_years (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/CHECK \(ends_on > starts_on\)/)
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('commercial_financial_periods composite-FKs onto commercial_financial_years(id, organisation_id) — a period cannot reference a different organisation year even under an application bug', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_financial_periods (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/FOREIGN KEY \(financial_year_id, organisation_id\)\s*\n\s*REFERENCES commercial_financial_years \(id, organisation_id\)/)
  })

  it('commercial_financial_periods also enforces its own valid date range', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_financial_periods (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/CHECK \(ends_on > starts_on\)/)
  })
})

describe('Phase C2 — document numbering table shape', () => {
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_document_sequences (')
  const body = source.slice(start, source.indexOf(');', start))

  it('is keyed by (organisation_id, document_type) — no duplicate row possible per type per tenant', () => {
    expect(body).toMatch(/PRIMARY KEY \(organisation_id, document_type\)/)
  })

  it('next_number and padding are bounded to sane positive integers', () => {
    expect(body).toMatch(/next_number\s+INTEGER NOT NULL DEFAULT 1 CHECK \(next_number >= 1\)/)
    expect(body).toMatch(/padding\s+INTEGER NOT NULL DEFAULT 6 CHECK \(padding >= 1\)/)
  })
})

describe('Phase C2 — customer/counterparty anchor: no hard CRM dependency', () => {
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_customers (')
  const body = source.slice(start, source.indexOf(');', start))

  it('crm_company_id and crm_contact_id are both nullable (optional linkage, never required)', () => {
    expect(body).toMatch(/crm_company_id\s+UUID REFERENCES crm_companies\(id\)/)
    expect(body).not.toMatch(/crm_company_id\s+UUID NOT NULL/)
    expect(body).toMatch(/crm_contact_id\s+UUID REFERENCES crm_contacts\(id\)/)
    expect(body).not.toMatch(/crm_contact_id\s+UUID NOT NULL/)
  })

  it('name is the only NOT NULL business field beyond organisation_id — nothing about this table requires CRM to exist or be enabled', () => {
    const notNullFields = body.match(/^\s*(\w+)\s+\w+.*NOT NULL/gm) ?? []
    const fieldNames = notNullFields.map(l => l.trim().split(/\s+/)[0])
    expect(fieldNames).toEqual(expect.arrayContaining(['organisation_id', 'name', 'active']))
  })
})
