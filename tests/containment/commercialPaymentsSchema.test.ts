import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C5.2 — schema-level containment tests for
// scripts/create-commercial-payments.sql, mirroring the exact idiom
// tests/containment/commercialInvoicesSchema.test.ts already established
// (source-text containment, comments stripped, block-scoped to the
// relevant CREATE TABLE before asserting, to avoid a whole-file
// false-positive match).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-payments.sql'))

function tableBody(tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`
  const start = source.indexOf(marker)
  expect(start, `expected to find ${marker}`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(');', start)
  return source.slice(start, end)
}

describe('Phase C5.2 — commercial_payments table shape', () => {
  const body = tableBody('commercial_payments')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('amount_cents is INTEGER NOT NULL with a positive-value CHECK', () => {
    expect(body).toMatch(/amount_cents\s+INTEGER NOT NULL CHECK \(amount_cents > 0\)/)
  })

  it('method is CHECK-constrained to exactly the approved vocabulary', () => {
    expect(body).toMatch(/method\s+TEXT NOT NULL CHECK \(method IN \('BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'\)\)/)
  })

  it('status is CHECK-constrained to exactly RECORDED/REVERSED, defaulting to RECORDED', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL DEFAULT 'RECORDED' CHECK \(status IN \('RECORDED', 'REVERSED'\)\)/)
  })

  it('does not have a PAID status value anywhere in this table', () => {
    const statusLine = body.match(/status\s+TEXT[^\n]*/)?.[0] ?? ''
    expect(statusLine).not.toMatch(/'PAID'/)
  })

  it('provider_reference requires provider via an explicit CHECK, not application logic alone', () => {
    expect(body).toMatch(/CHECK\s*\(provider_reference IS NULL OR \(provider IS NOT NULL AND provider <> ''\)\)/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('reversed_at/reversed_by/reversal_reason columns exist for append-only correction', () => {
    expect(body).toMatch(/reversed_at\s+TIMESTAMPTZ/)
    expect(body).toMatch(/reversed_by\s+TEXT REFERENCES users\(id\)/)
    expect(body).toMatch(/reversal_reason\s+TEXT/)
  })

  it('does not have a DELETE, UPDATE, or backfill statement anywhere in the whole file (additive-only migration)', () => {
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/\bUPDATE\s+commercial_payments\b/i)
    expect(source).not.toMatch(/\bTRUNCATE\b/i)
  })
})

describe('Phase C5.2 — provider/reference external idempotency index', () => {
  it('is a partial UNIQUE index scoped to organisation_id + provider + provider_reference, only when provider_reference is set', () => {
    const idx = source.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_payments_provider_reference[\s\S]*?;/)?.[0] ?? ''
    expect(idx).toMatch(/ON commercial_payments\(organisation_id, provider, provider_reference\)/)
    expect(idx).toMatch(/WHERE provider_reference IS NOT NULL/)
  })
})

describe('Phase C5.2 — commercial_payment_allocations table shape', () => {
  const body = tableBody('commercial_payment_allocations')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('allocated_amount_cents is INTEGER NOT NULL with a positive-value CHECK', () => {
    expect(body).toMatch(/allocated_amount_cents\s+INTEGER NOT NULL CHECK \(allocated_amount_cents > 0\)/)
  })

  it('composite-FKs payment_id onto commercial_payments(id, organisation_id) — never a plain id FK', () => {
    expect(body).toMatch(/FOREIGN KEY \(payment_id, organisation_id\)\s*\n?\s*REFERENCES commercial_payments \(id, organisation_id\)/)
  })

  it('composite-FKs invoice_id onto commercial_invoices(id, organisation_id) — never a plain id FK', () => {
    expect(body).toMatch(/FOREIGN KEY \(invoice_id, organisation_id\)\s*\n?\s*REFERENCES commercial_invoices \(id, organisation_id\)/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('enforces exactly one allocation per payment via UNIQUE (organisation_id, payment_id) — the C5.2 one-invoice-per-payment rule', () => {
    expect(body).toMatch(/UNIQUE \(organisation_id, payment_id\)/)
  })

  it('does NOT add invoice_id directly to commercial_payments (the two-table model is intentional)', () => {
    const paymentsBody = tableBody('commercial_payments')
    expect(paymentsBody).not.toMatch(/\binvoice_id\b/)
  })
})

describe('Phase C5.2 — commercial_invoices is untouched by this migration', () => {
  it('contains no ALTER TABLE commercial_invoices statement anywhere', () => {
    expect(source).not.toMatch(/ALTER TABLE commercial_invoices/)
  })

  it('never introduces a PAID value into any status vocabulary in this file', () => {
    expect(source).not.toMatch(/'PAID'/)
  })
})

describe('Phase C5.2 — required indexes exist and are not excessive', () => {
  it('has an organisation-scoped, received_at-ordered index for payment history', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_payments_org_received ON commercial_payments\(organisation_id, received_at DESC\)/)
  })

  it('has organisation+invoice and organisation+payment indexes on the allocations table', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_payment_allocations_org_invoice ON commercial_payment_allocations\(organisation_id, invoice_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_payment_allocations_org_payment ON commercial_payment_allocations\(organisation_id, payment_id\)/)
  })

  it('does not define an excessive number of indexes (kept minimal, per the brief)', () => {
    const indexCount = (source.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length
    expect(indexCount).toBeLessThanOrEqual(5)
  })
})

describe('Phase C5.2 — every statement in this file is idempotent (IF NOT EXISTS throughout)', () => {
  it('every CREATE TABLE uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE TABLE(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })

  it('every CREATE INDEX uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })
})
