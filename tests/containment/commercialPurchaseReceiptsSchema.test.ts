import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.3 — schema-level containment tests for
// scripts/create-commercial-purchase-receipts.sql, mirroring the exact
// idiom tests/containment/commercialPurchasingSchema.test.ts already
// established (source-text containment, comments stripped, block-scoped
// to the relevant CREATE TABLE before asserting).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-purchase-receipts.sql'))
const purchasingSource = stripComments(readSource('scripts/create-commercial-purchasing.sql'))

function tableBody(src: string, tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`
  const start = src.indexOf(marker)
  expect(start, `expected to find ${marker}`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf(');', start)
  return src.slice(start, end)
}

describe('Phase C7.3 — commercial_purchase_receipts table shape', () => {
  const body = tableBody(source, 'commercial_purchase_receipts')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('purchase_order_id is NOT NULL — strictly PO-backed, no standalone receipts', () => {
    expect(body).toMatch(/purchase_order_id\s+UUID NOT NULL/)
  })

  it('status is CHECK-constrained to exactly DRAFT, POSTED, CANCELLED — no approval state', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL DEFAULT 'DRAFT' CHECK \(status IN \('DRAFT', 'POSTED', 'CANCELLED'\)\)/)
  })

  it('does not have a PENDING_APPROVAL status value anywhere in this table', () => {
    expect(body).not.toMatch(/PENDING_APPROVAL/)
  })

  it('receipt_number is nullable and unique per organisation only when set', () => {
    expect(body).toMatch(/receipt_number\s+TEXT,/)
    expect(body).not.toMatch(/receipt_number\s+TEXT NOT NULL/)
    expect(body).toMatch(/UNIQUE \(organisation_id, receipt_number\)/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id) from its very first creation', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('composite-FKs purchase_order_id onto commercial_purchase_orders(id, organisation_id) — never a plain id FK', () => {
    expect(body).toMatch(/FOREIGN KEY \(purchase_order_id, organisation_id\)\s*\n?\s*REFERENCES commercial_purchase_orders \(id, organisation_id\)/)
  })

  it('has cancel_reason (nullable — enforced non-empty in TypeScript, not a CHECK) and the full actor-attribution chain', () => {
    expect(body).toMatch(/cancel_reason\s+TEXT/)
    for (const col of ['created_by', 'posted_by', 'cancelled_by']) {
      expect(body).toMatch(new RegExp(`${col}\\s+TEXT REFERENCES users\\(id\\)`))
    }
  })

  it('does NOT have received_quantity, billed_quantity, matched_quantity, paid_cents, payment_id, committed, or encumbrance columns', () => {
    expect(body).not.toMatch(/received_quantity|billed_quantity|matched_quantity|paid_cents|payment_id|committed|encumbrance/i)
  })
})

describe('Phase C7.3 — commercial_purchase_receipt_lines table shape', () => {
  const body = tableBody(source, 'commercial_purchase_receipt_lines')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('source_purchase_order_line_id is NOT NULL — deliberately NOT nullable/lineage-only, per the C7.3 correction', () => {
    expect(body).toMatch(/source_purchase_order_line_id\s+UUID NOT NULL/)
  })

  it('quantity_received is NUMERIC(14,4), NOT INTEGER — a deliberate divergence from PO line quantity for fractional service receiving', () => {
    expect(body).toMatch(/quantity_received\s+NUMERIC\(14,4\) NOT NULL CHECK \(quantity_received > 0\)/)
  })

  it('preserves description/sku/unit snapshot columns, matching every other Commercial line table', () => {
    expect(body).toMatch(/description_snapshot\s+TEXT NOT NULL/)
    expect(body).toMatch(/sku_snapshot\s+TEXT/)
    expect(body).toMatch(/unit_snapshot\s+TEXT/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('composite-FKs purchase_receipt_id onto commercial_purchase_receipts(id, organisation_id) with ON DELETE CASCADE', () => {
    expect(body).toMatch(/FOREIGN KEY \(purchase_receipt_id, organisation_id\)\s*\n?\s*REFERENCES commercial_purchase_receipts \(id, organisation_id\) ON DELETE CASCADE/)
  })

  it('composite-FKs source_purchase_order_line_id onto commercial_purchase_order_lines(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(source_purchase_order_line_id, organisation_id\)\s*\n?\s*REFERENCES commercial_purchase_order_lines \(id, organisation_id\)/)
  })

  it('does NOT have a unit_price_cents, tax_code_snapshot, tax_rate_snapshot, or line_total_cents column — a receipt line is a quantity fact only', () => {
    expect(body).not.toMatch(/unit_price_cents|tax_code_snapshot|tax_rate_snapshot|line_total_cents/i)
  })
})

describe('Phase C7.3 — required indexes exist, including the load-bearing over-receipt-guard index', () => {
  it('has organisation-scoped indexes on both new tables', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipts_org ON commercial_purchase_receipts\(organisation_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipt_lines_org ON commercial_purchase_receipt_lines\(organisation_id\)/)
  })

  it('has the organisation+source_purchase_order_line_id index the over-receipt guard and received-to-date read both depend on', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_purchase_receipt_lines_org_po_line ON commercial_purchase_receipt_lines\(organisation_id, source_purchase_order_line_id\)/)
  })
})

describe('Phase C7.3 — every CREATE statement in this file is idempotent and non-destructive', () => {
  it('every CREATE TABLE uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE TABLE(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })

  it('every CREATE INDEX uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })

  it('does not DROP, DELETE, or TRUNCATE anywhere in the file', () => {
    expect(source).not.toMatch(/\bDROP\s+(TABLE|CONSTRAINT|INDEX)\b/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/\bTRUNCATE\b/i)
  })
})

// Regression guard, per the explicit C7.3 schema-contract-preservation
// requirement: adding this migration must NOT have required touching
// commercial_purchase_orders/commercial_purchase_order_lines at all —
// re-asserted directly against the ORIGINAL C6.2 file here (not just
// relying on commercialPurchasingSchema.test.ts continuing to pass
// unmodified) so a future edit to that file is caught by this file too.
describe('Phase C7.3 — no cached received/committed/encumbrance column was added to the PO/PO-line tables', () => {
  it('commercial_purchase_orders still has no received_quantity/billed_quantity/matched_quantity/paid_cents/payment_id/committed/encumbrance column', () => {
    const body = tableBody(purchasingSource, 'commercial_purchase_orders')
    expect(body).not.toMatch(/received_quantity|billed_quantity|matched_quantity|paid_cents|payment_id|committed|encumbrance/i)
  })

  it('commercial_purchase_order_lines still has no received_quantity/billed_quantity/matched_quantity/paid_cents/committed/encumbrance column', () => {
    const body = tableBody(purchasingSource, 'commercial_purchase_order_lines')
    expect(body).not.toMatch(/received_quantity|billed_quantity|matched_quantity|paid_cents|committed|encumbrance/i)
  })

  it('commercial_purchase_order_lines.quantity is still INTEGER — the NUMERIC divergence lives only on the new receipt-line table', () => {
    const body = tableBody(purchasingSource, 'commercial_purchase_order_lines')
    expect(body).toMatch(/quantity\s+INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0\)/)
  })
})
