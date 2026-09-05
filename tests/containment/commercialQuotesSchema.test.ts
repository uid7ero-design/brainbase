import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C3 — static containment on scripts/create-commercial-quotes.sql,
// matching the established convention from
// tests/containment/commercialCoreSchema.test.ts (C2) /
// tests/containment/commercialTenantIsolationRemediation.test.ts (C2-TIR).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-quotes.sql'))

describe('Phase C3 — quotes schema is idempotent and non-destructive', () => {
  it('every table/index creation uses IF NOT EXISTS', () => {
    const ddlLines = source.split('\n').filter(l => /CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(l))
    expect(ddlLines.length).toBeGreaterThan(4)
    for (const line of ddlLines) expect(line, line).toMatch(/IF NOT EXISTS/)
  })

  it('the two ALTER TABLE ... ADD CONSTRAINT statements are each guarded by an existence check (pg_constraint), the idempotent equivalent since ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL', () => {
    const doBlocks = source.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? []
    expect(doBlocks.length).toBe(2)
    for (const block of doBlocks) {
      expect(block).toMatch(/SELECT 1 FROM pg_constraint WHERE conname = /)
      expect(block).toMatch(/ALTER TABLE[\s\S]+?ADD CONSTRAINT/)
    }
  })

  it('contains no destructive DDL/DML (no DROP, DELETE, TRUNCATE)', () => {
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
  })

  it('never INSERTs a row for any existing organisation — schema only', () => {
    expect(source).not.toMatch(/INSERT INTO commercial_/i)
  })
})

describe('Phase C3 — tenant-integrity retrofit onto the two C2 tables Quotes composite-FKs onto', () => {
  it('commercial_customers gains UNIQUE(id, organisation_id)', () => {
    expect(source).toMatch(/ADD CONSTRAINT commercial_customers_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
  })

  it('commercial_products gains UNIQUE(id, organisation_id)', () => {
    expect(source).toMatch(/ADD CONSTRAINT commercial_products_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
  })
})

describe('Phase C3 — commercial_quotes: tenant scoping, composite FK, lifecycle columns', () => {
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_quotes (')
  const body = source.slice(start, source.indexOf(');', start))

  it('is tenant-scoped by organisation_id TEXT NOT NULL REFERENCES organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('customer_id is a COMPOSITE FK onto commercial_customers(id, organisation_id) — never a plain single-column FK (the exact C2-PMC cross-tenant gap class)', () => {
    expect(body).toMatch(/FOREIGN KEY \(customer_id, organisation_id\)\s*\n\s*REFERENCES commercial_customers \(id, organisation_id\)/)
    expect(body).not.toMatch(/customer_id\s+UUID NOT NULL REFERENCES commercial_customers\(id\)/)
  })

  it('carries its own UNIQUE(id, organisation_id) tenant-integrity anchor for quote_lines to composite-FK onto', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('status is constrained to exactly the five-value lifecycle', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL DEFAULT 'DRAFT' CHECK \(status IN \('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'\)\)/)
  })

  it('quote_number is nullable (allocated at issue time, not creation) with a per-organisation UNIQUE constraint', () => {
    expect(body).toMatch(/quote_number\s+TEXT,/)
    expect(body).not.toMatch(/quote_number\s+TEXT NOT NULL/)
    expect(body).toMatch(/UNIQUE \(organisation_id, quote_number\)/)
  })

  it('has a timestamp column for every terminal/transition state (issued_at, accepted_at, rejected_at, expired_at)', () => {
    for (const col of ['issued_at', 'accepted_at', 'rejected_at', 'expired_at']) {
      expect(body, col).toMatch(new RegExp(`${col}\\s+TIMESTAMPTZ`))
    }
  })

  it('money columns are INTEGER *_cents with a CHECK >= 0, never Float/*_cents for a rate', () => {
    for (const col of ['subtotal_cents', 'tax_cents', 'total_cents']) {
      expect(body, col).toMatch(new RegExp(`${col}\\s+INTEGER NOT NULL DEFAULT 0 CHECK \\(${col} >= 0\\)`))
    }
    expect(body).not.toMatch(/\b(FLOAT|REAL|DOUBLE PRECISION)\b/i)
  })

  it('carries all six quote-level customer snapshot columns, all nullable (populated only at issue time)', () => {
    for (const col of [
      'customer_name_snapshot', 'billing_name_snapshot', 'billing_address_snapshot',
      'email_snapshot', 'phone_snapshot', 'tax_identifier_snapshot',
    ]) {
      expect(body, col).toMatch(new RegExp(`${col}\\s+TEXT,`))
    }
  })
})

describe('Phase C3 — commercial_quote_lines: tenant scoping, dual composite FKs, integer quantity', () => {
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_quote_lines (')
  const body = source.slice(start, source.indexOf(');', start))

  it('is tenant-scoped by organisation_id TEXT NOT NULL REFERENCES organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('quote_id is a COMPOSITE FK onto commercial_quotes(id, organisation_id) with ON DELETE CASCADE', () => {
    expect(body).toMatch(/FOREIGN KEY \(quote_id, organisation_id\)\s*\n\s*REFERENCES commercial_quotes \(id, organisation_id\) ON DELETE CASCADE/)
  })

  it('product_id is a COMPOSITE FK onto commercial_products(id, organisation_id), nullable (freeform lines allowed)', () => {
    expect(body).toMatch(/product_id\s+UUID,/)
    expect(body).toMatch(/FOREIGN KEY \(product_id, organisation_id\)\s*\n\s*REFERENCES commercial_products \(id, organisation_id\)/)
  })

  it('quantity is a whole-number INTEGER with CHECK > 0 — never NUMERIC/fractional', () => {
    expect(body).toMatch(/quantity\s+INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0\)/)
  })

  it('tax_rate_snapshot is NUMERIC(5,2) bounded 0-100, matching commercial_tax_codes.rate exactly', () => {
    expect(body).toMatch(/tax_rate_snapshot\s+NUMERIC\(5,2\) NOT NULL DEFAULT 0 CHECK \(tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100\)/)
  })

  it('carries its own three line-level money columns, all INTEGER *_cents with CHECK >= 0', () => {
    for (const col of ['line_subtotal_cents', 'line_tax_cents', 'line_total_cents']) {
      expect(body, col).toMatch(new RegExp(`${col}\\s+INTEGER NOT NULL DEFAULT 0 CHECK \\(${col} >= 0\\)`))
    }
  })

  it('carries all snapshot columns a line needs to remain self-contained (no live join required)', () => {
    for (const col of ['description_snapshot', 'sku_snapshot', 'unit_snapshot', 'tax_code_snapshot']) {
      expect(body, col).toMatch(new RegExp(col))
    }
  })
})
