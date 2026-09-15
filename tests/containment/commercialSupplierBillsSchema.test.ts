import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.4 — schema-level containment tests for
// scripts/create-commercial-supplier-bills.sql, mirroring
// tests/containment/commercialPurchaseReceiptsSchema.test.ts's exact
// idiom (source-text containment, comments stripped, block-scoped to
// the relevant CREATE TABLE before asserting).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-supplier-bills.sql'))
const purchasingSource = stripComments(readSource('scripts/create-commercial-purchasing.sql'))

function tableBody(src: string, tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`
  const start = src.indexOf(marker)
  expect(start, `expected to find ${marker}`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf(');', start)
  return src.slice(start, end)
}

describe('Phase C7.4 — Section 0 retrofit: commercial_purchase_orders gains a UNIQUE(id, supplier_id) anchor', () => {
  it('is guarded by an IF NOT EXISTS pg_constraint check', () => {
    expect(source).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'commercial_purchase_orders_id_supplier_id_key'/)
    expect(source).toMatch(/ALTER TABLE commercial_purchase_orders\s*\n?\s*ADD CONSTRAINT commercial_purchase_orders_id_supplier_id_key UNIQUE \(id, supplier_id\)/)
  })

  it('does not DROP, DELETE, or TRUNCATE anywhere in the file', () => {
    expect(source).not.toMatch(/\bDROP\s+(TABLE|CONSTRAINT|INDEX)\b/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/\bTRUNCATE\b/i)
  })
})

describe('Phase C7.4 — commercial_supplier_bills table shape', () => {
  const body = tableBody(source, 'commercial_supplier_bills')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('supplier_id and source_purchase_order_id are both NOT NULL — strictly PO-backed', () => {
    expect(body).toMatch(/supplier_id\s+UUID NOT NULL/)
    expect(body).toMatch(/source_purchase_order_id\s+UUID NOT NULL/)
  })

  it('supplier_invoice_number is NOT NULL, distinct from the nullable bill_number', () => {
    expect(body).toMatch(/supplier_invoice_number\s+TEXT NOT NULL,/)
    expect(body).toMatch(/bill_number\s+TEXT,/)
    expect(body).not.toMatch(/bill_number\s+TEXT NOT NULL/)
  })

  it('supplier_invoice_number_canonical is a STORED generated column computed as lower(btrim(...))', () => {
    expect(body).toMatch(/supplier_invoice_number_canonical\s+TEXT GENERATED ALWAYS AS \(lower\(btrim\(supplier_invoice_number\)\)\) STORED/)
  })

  it('status is CHECK-constrained to exactly DRAFT, POSTED, CANCELLED — no approval state', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL DEFAULT 'DRAFT' CHECK \(status IN \('DRAFT', 'POSTED', 'CANCELLED'\)\)/)
  })

  it('does not have a PENDING_APPROVAL status value anywhere in this table', () => {
    expect(body).not.toMatch(/PENDING_APPROVAL/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id) and UNIQUE(organisation_id, bill_number)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
    expect(body).toMatch(/UNIQUE \(organisation_id, bill_number\)/)
  })

  it('has an explicitly-named duplicate-supplier-invoice-number constraint scoped to organisation + supplier + canonical value', () => {
    expect(body).toMatch(/CONSTRAINT commercial_supplier_bills_supplier_invoice_unique\s*\n?\s*UNIQUE \(organisation_id, supplier_id, supplier_invoice_number_canonical\)/)
  })

  it('enforces total_cents = subtotal_cents + tax_cents at the database level', () => {
    expect(body).toMatch(/CHECK \(total_cents = subtotal_cents \+ tax_cents\)/)
  })

  it('composite-FKs source_purchase_order_id onto commercial_purchase_orders(id, organisation_id) for tenant scoping', () => {
    expect(body).toMatch(/CONSTRAINT commercial_supplier_bills_po_org_fkey\s*\n?\s*FOREIGN KEY \(source_purchase_order_id, organisation_id\)\s*\n?\s*REFERENCES commercial_purchase_orders \(id, organisation_id\)/)
  })

  it('ALSO composite-FKs (source_purchase_order_id, supplier_id) onto commercial_purchase_orders(id, supplier_id) — structural supplier-consistency guarantee', () => {
    expect(body).toMatch(/CONSTRAINT commercial_supplier_bills_po_supplier_fkey\s*\n?\s*FOREIGN KEY \(source_purchase_order_id, supplier_id\)\s*\n?\s*REFERENCES commercial_purchase_orders \(id, supplier_id\)/)
  })

  it('composite-FKs supplier_id onto commercial_suppliers(id, organisation_id)', () => {
    expect(body).toMatch(/CONSTRAINT commercial_supplier_bills_supplier_org_fkey\s*\n?\s*FOREIGN KEY \(supplier_id, organisation_id\)\s*\n?\s*REFERENCES commercial_suppliers \(id, organisation_id\)/)
  })

  it('has the full actor-attribution chain: created/posted/cancelled _by', () => {
    for (const col of ['created_by', 'posted_by', 'cancelled_by']) {
      expect(body).toMatch(new RegExp(`${col}\\s+TEXT REFERENCES users\\(id\\)`))
    }
  })

  it('does NOT have paid_cents, payment_id, or any payment-status column — no supplier payments in this phase', () => {
    expect(body).not.toMatch(/paid_cents|payment_id|payment_status/i)
  })

  it('does NOT have a bill-line <-> receipt-line match/allocation column or table reference — no 3-way matching in this phase', () => {
    expect(body).not.toMatch(/receipt_line_id|matched_receipt/i)
  })
})

describe('Phase C7.4 — commercial_supplier_bill_lines table shape', () => {
  const body = tableBody(source, 'commercial_supplier_bill_lines')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('source_purchase_order_line_id is NOT NULL — deliberately not a nullable lineage-only pointer', () => {
    expect(body).toMatch(/source_purchase_order_line_id\s+UUID NOT NULL/)
  })

  it('product_id is nullable — ad-hoc lines are supported, matching every other Commercial line table', () => {
    expect(body).toMatch(/product_id\s+UUID,/)
  })

  it('quantity matches commercial_purchase_order_lines exactly: INTEGER, default 1, CHECK > 0', () => {
    expect(body).toMatch(/quantity\s+INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0\)/)
  })

  it('carries its own unit_price_cents/tax_code_snapshot/tax_rate_snapshot/line_total_cents — a bill line is a MONEY fact, unlike a receipt line', () => {
    expect(body).toMatch(/unit_price_cents\s+INTEGER NOT NULL DEFAULT 0 CHECK \(unit_price_cents >= 0\)/)
    expect(body).toMatch(/tax_code_snapshot\s+TEXT/)
    expect(body).toMatch(/tax_rate_snapshot\s+NUMERIC\(5,2\) NOT NULL DEFAULT 0 CHECK \(tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100\)/)
    expect(body).toMatch(/line_total_cents\s+INTEGER NOT NULL DEFAULT 0 CHECK \(line_total_cents >= 0\)/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('composite-FKs supplier_bill_id onto commercial_supplier_bills(id, organisation_id) with ON DELETE CASCADE', () => {
    expect(body).toMatch(/FOREIGN KEY \(supplier_bill_id, organisation_id\)\s*\n?\s*REFERENCES commercial_supplier_bills \(id, organisation_id\) ON DELETE CASCADE/)
  })

  it('composite-FKs source_purchase_order_line_id onto commercial_purchase_order_lines(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(source_purchase_order_line_id, organisation_id\)\s*\n?\s*REFERENCES commercial_purchase_order_lines \(id, organisation_id\)/)
  })

  it('composite-FKs product_id onto commercial_products(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(product_id, organisation_id\)\s*\n?\s*REFERENCES commercial_products \(id, organisation_id\)/)
  })
})

describe('Phase C7.4 — required indexes exist, including the load-bearing over-billing-guard index', () => {
  it('has organisation-scoped indexes on both new tables', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org ON commercial_supplier_bills\(organisation_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bill_lines_org ON commercial_supplier_bill_lines\(organisation_id\)/)
  })

  it('has organisation+status and organisation+supplier indexes for list filtering', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org_status ON commercial_supplier_bills\(organisation_id, status\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bills_org_supplier ON commercial_supplier_bills\(organisation_id, supplier_id\)/)
  })

  it('has the organisation+source_purchase_order_line_id index the over-billing guard and billed-to-date read both depend on', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bill_lines_org_po_line ON commercial_supplier_bill_lines\(organisation_id, source_purchase_order_line_id\)/)
  })
})

describe('Phase C7.4 — every CREATE statement in this file is idempotent and non-destructive', () => {
  it('every CREATE TABLE uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE TABLE(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })

  it('every CREATE INDEX uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })
})

// Regression guard, per the explicit C7.4 schema-contract-preservation
// requirement: adding this migration must NOT have required touching
// commercial_purchase_orders/commercial_purchase_order_lines with any of
// the forbidden columns — re-asserted directly against the ORIGINAL C6.2
// file here (not just relying on commercialPurchasingSchema.test.ts
// continuing to pass unmodified) so a future edit to that file is caught
// by this file too. The ONE permitted addition (Section 0's UNIQUE(id,
// supplier_id) retrofit) is a constraint, not a column, and is asserted
// separately above.
describe('Phase C7.4 — no billed_quantity/matched_quantity/paid_cents/payment_id/committed/encumbrance/actual column was added to the PO/PO-line tables', () => {
  it('commercial_purchase_orders still has none of the forbidden columns', () => {
    const body = tableBody(purchasingSource, 'commercial_purchase_orders')
    expect(body).not.toMatch(/billed_quantity|matched_quantity|paid_cents|payment_id|committed|encumbrance|\bactual\b/i)
  })

  it('commercial_purchase_order_lines still has none of the forbidden columns', () => {
    const body = tableBody(purchasingSource, 'commercial_purchase_order_lines')
    expect(body).not.toMatch(/billed_quantity|matched_quantity|paid_cents|committed|encumbrance|\bactual\b/i)
  })

  it('commercial_purchase_order_lines.quantity is still INTEGER — unmodified by this migration', () => {
    const body = tableBody(purchasingSource, 'commercial_purchase_order_lines')
    expect(body).toMatch(/quantity\s+INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0\)/)
  })
})
