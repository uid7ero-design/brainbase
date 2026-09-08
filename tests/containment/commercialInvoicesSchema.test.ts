import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C4.1 — schema-level containment tests for
// scripts/create-commercial-invoices.sql, mirroring the exact idiom
// tests/containment/commercialTenantIsolationRemediation.test.ts already
// established (source-text containment, comments stripped, block-scoped
// to the relevant CREATE TABLE before asserting, to avoid a whole-file
// false-positive match).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-invoices.sql'))

function tableBody(tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`
  const start = source.indexOf(marker)
  expect(start, `expected to find ${marker}`).toBeGreaterThanOrEqual(0)
  // Find the matching closing paren + semicolon for this CREATE TABLE
  // statement by scanning for the first ");" after the opening — every
  // table in this file is a single statement with no nested ");" inside
  // (no function bodies), matching create-commercial-quotes.sql's own
  // structure.
  const end = source.indexOf(');', start)
  return source.slice(start, end)
}

describe('Phase C4.1 — commercial_quote_lines tenant-anchor retrofit', () => {
  it('adds UNIQUE(id, organisation_id) via an idempotent, existence-checked DO block (not a bare ADD CONSTRAINT)', () => {
    expect(source).toMatch(/DO \$\$/)
    expect(source).toMatch(/commercial_quote_lines_id_organisation_id_key/)
    expect(source).toMatch(/ALTER TABLE commercial_quote_lines\s*\n?\s*ADD CONSTRAINT commercial_quote_lines_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
  })

  it('checks pg_constraint for existence before altering, matching the C3 precedent exactly', () => {
    const start = source.indexOf('commercial_quote_lines_id_organisation_id_key')
    const block = source.slice(Math.max(0, start - 300), start + 300)
    expect(block).toMatch(/SELECT 1 FROM pg_constraint WHERE conname = 'commercial_quote_lines_id_organisation_id_key'/)
  })
})

describe('Phase C4.1 — commercial_invoices table shape', () => {
  const body = tableBody('commercial_invoices')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('status is CHECK-constrained to exactly DRAFT/ISSUED/VOID, defaulting to DRAFT', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL DEFAULT 'DRAFT' CHECK \(status IN \('DRAFT', 'ISSUED', 'VOID'\)\)/)
  })

  it('does not have SENT or PAID as a possible status value', () => {
    const statusLine = body.match(/status\s+TEXT[^\n]*/)?.[0] ?? ''
    expect(statusLine).not.toMatch(/'SENT'/)
    expect(statusLine).not.toMatch(/'PAID'/)
    expect(statusLine).not.toMatch(/'OVERDUE'/)
  })

  it('money columns are non-negative-checked integers', () => {
    for (const col of ['subtotal_cents', 'tax_cents', 'total_cents']) {
      const line = body.match(new RegExp(`${col}\\s+INTEGER[^\\n]*`))?.[0] ?? ''
      expect(line, col).toMatch(/NOT NULL DEFAULT 0 CHECK \(/)
      expect(line, col).toMatch(new RegExp(`${col} >= 0`))
    }
  })

  it('invoice_number is nullable (not NOT NULL) — never allocated at creation', () => {
    const line = body.match(/invoice_number\s+TEXT[^\n]*/)?.[0] ?? ''
    expect(line).not.toMatch(/NOT NULL/)
  })

  it('UNIQUE(organisation_id, invoice_number) — invoice numbers are unique per tenant, not globally', () => {
    expect(body).toMatch(/UNIQUE \(organisation_id, invoice_number\)/)
  })

  it('carries its own UNIQUE(id, organisation_id) tenant-integrity anchor', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('customer_id composite-FKs onto commercial_customers(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(customer_id, organisation_id\)\s*\n?\s*REFERENCES commercial_customers \(id, organisation_id\)/)
  })

  it('source_quote_id composite-FKs onto commercial_quotes(id, organisation_id) and is nullable', () => {
    const line = body.match(/source_quote_id\s+UUID[^\n,]*/)?.[0] ?? ''
    expect(line).not.toMatch(/NOT NULL/)
    expect(body).toMatch(/FOREIGN KEY \(source_quote_id, organisation_id\)\s*\n?\s*REFERENCES commercial_quotes \(id, organisation_id\)/)
  })

  it('does NOT carry a UNIQUE constraint on source_quote_id alone — one quote may produce multiple invoices', () => {
    expect(body).not.toMatch(/UNIQUE\s*\(\s*source_quote_id\s*\)/)
    expect(body).not.toMatch(/source_quote_id[^,\n]*UNIQUE/)
  })

  it('due_date and payment_terms_days are both nullable', () => {
    expect(body.match(/due_date\s+DATE[^\n]*/)?.[0] ?? '').not.toMatch(/NOT NULL/)
    expect(body.match(/payment_terms_days\s+INTEGER[^\n]*/)?.[0] ?? '').not.toMatch(/NOT NULL/)
  })

  it('has void_reason, voided_by, voided_at for the VOID terminal state', () => {
    expect(body).toMatch(/void_reason\s+TEXT/)
    expect(body).toMatch(/voided_by\s+TEXT REFERENCES users\(id\)/)
    expect(body).toMatch(/voided_at\s+TIMESTAMPTZ/)
  })

  it('has all six customer snapshot columns, all nullable (frozen only at issue)', () => {
    for (const col of ['customer_name_snapshot', 'billing_name_snapshot', 'billing_address_snapshot', 'email_snapshot', 'phone_snapshot', 'tax_identifier_snapshot']) {
      const line = body.match(new RegExp(`${col}\\s+TEXT[^\\n]*`))?.[0] ?? ''
      expect(line, col).not.toMatch(/NOT NULL/)
    }
  })
})

describe('Phase C4.1 — commercial_invoice_lines table shape', () => {
  const body = tableBody('commercial_invoice_lines')

  it('invoice_id composite-FKs onto commercial_invoices(id, organisation_id) with ON DELETE CASCADE', () => {
    expect(body).toMatch(/FOREIGN KEY \(invoice_id, organisation_id\)\s*\n?\s*REFERENCES commercial_invoices \(id, organisation_id\) ON DELETE CASCADE/)
  })

  it('product_id composite-FKs onto commercial_products(id, organisation_id) and is nullable', () => {
    const line = body.match(/product_id\s+UUID[^\n,]*/)?.[0] ?? ''
    expect(line).not.toMatch(/NOT NULL/)
    expect(body).toMatch(/FOREIGN KEY \(product_id, organisation_id\)\s*\n?\s*REFERENCES commercial_products \(id, organisation_id\)/)
  })

  it('source_quote_line_id composite-FKs onto commercial_quote_lines(id, organisation_id) and is nullable', () => {
    const line = body.match(/source_quote_line_id\s+UUID[^\n,]*/)?.[0] ?? ''
    expect(line).not.toMatch(/NOT NULL/)
    expect(body).toMatch(/FOREIGN KEY \(source_quote_line_id, organisation_id\)\s*\n?\s*REFERENCES commercial_quote_lines \(id, organisation_id\)/)
  })

  it('quantity is CHECK > 0 and money columns are CHECK >= 0', () => {
    expect(body).toMatch(/quantity\s+INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0\)/)
    for (const col of ['unit_price_cents', 'line_subtotal_cents', 'line_tax_cents', 'line_total_cents']) {
      expect(body, col).toMatch(new RegExp(`${col}\\s+INTEGER NOT NULL DEFAULT 0 CHECK \\(${col} >= 0\\)`))
    }
  })

  it('tax_rate_snapshot is bounded 0..100', () => {
    expect(body).toMatch(/tax_rate_snapshot\s+NUMERIC\(5,2\) NOT NULL DEFAULT 0 CHECK \(tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100\)/)
  })

  it('description_snapshot is required (NOT NULL)', () => {
    expect(body).toMatch(/description_snapshot\s+TEXT NOT NULL/)
  })
})

describe('Phase C4.1 — migration hygiene', () => {
  it('every CREATE TABLE/INDEX statement is idempotent (IF NOT EXISTS)', () => {
    const ddlLines = source.split('\n').filter(l => /CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(l))
    expect(ddlLines.length).toBeGreaterThan(0)
    for (const line of ddlLines) expect(line, line).toMatch(/IF NOT EXISTS/)
  })

  it('contains no destructive DDL or data-loss statements', () => {
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
    expect(source).not.toMatch(/ALTER TABLE[^;]*DROP/i)
  })

  it('does not touch commercial_document_deliveries at all', () => {
    expect(source).not.toMatch(/commercial_document_deliveries/)
  })

  it('declares the required indexes on commercial_invoices', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_invoices_org ON commercial_invoices\(organisation_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_invoices_org_status ON commercial_invoices\(organisation_id, status\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_invoices_customer ON commercial_invoices\(customer_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_invoices_source_quote ON commercial_invoices\(source_quote_id\)/)
  })

  it('declares the required indexes on commercial_invoice_lines', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_invoice_lines_org ON commercial_invoice_lines\(organisation_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_invoice_lines_invoice ON commercial_invoice_lines\(invoice_id, position\)/)
  })
})
