import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C6.2 — schema-level containment tests for
// scripts/create-commercial-purchasing.sql, mirroring the exact idiom
// tests/containment/commercialPaymentsSchema.test.ts already established
// (source-text containment, comments stripped, block-scoped to the
// relevant CREATE TABLE before asserting, to avoid a whole-file
// false-positive match).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-purchasing.sql'))

function tableBody(tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`
  const start = source.indexOf(marker)
  expect(start, `expected to find ${marker}`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(');', start)
  return source.slice(start, end)
}

describe('Phase C6.2 — commercial_cost_centres retrofit (Section 0)', () => {
  it('adds the UNIQUE(id, organisation_id) anchor guarded by an IF NOT EXISTS check', () => {
    expect(source).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'commercial_cost_centres_id_organisation_id_key'/)
    expect(source).toMatch(/ALTER TABLE commercial_cost_centres\s*\n?\s*ADD CONSTRAINT commercial_cost_centres_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
  })

  it('does not DROP, DELETE, or TRUNCATE anywhere in the file', () => {
    expect(source).not.toMatch(/\bDROP\s+(TABLE|CONSTRAINT|INDEX)\b(?!.*IF EXISTS.*commercial_cost_centres)/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/\bTRUNCATE\b/i)
  })
})

describe('Phase C6.2 — commercial_suppliers table shape', () => {
  const body = tableBody('commercial_suppliers')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('name is required, no other column is', () => {
    expect(body).toMatch(/name\s+TEXT NOT NULL/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id) from its very first creation', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('crm_company_id/crm_contact_id are plain (non-composite) FKs, matching commercial_customers exactly', () => {
    expect(body).toMatch(/crm_company_id\s+UUID REFERENCES crm_companies\(id\) ON DELETE SET NULL/)
    expect(body).toMatch(/crm_contact_id\s+UUID REFERENCES crm_contacts\(id\) ON DELETE SET NULL/)
  })

  it('payment_terms_days allows NULL but rejects negative values', () => {
    expect(body).toMatch(/payment_terms_days\s+INTEGER CHECK \(payment_terms_days IS NULL OR payment_terms_days >= 0\)/)
  })

  it('active defaults to true', () => {
    expect(body).toMatch(/active\s+BOOLEAN NOT NULL DEFAULT true/)
  })

  it('does NOT have a supplier balance, AP status, payable, or bank/payment-detail column', () => {
    expect(body).not.toMatch(/balance|payable|bank_account|account_number|routing/i)
  })
})

describe('Phase C6.2 — commercial_purchase_orders table shape', () => {
  const body = tableBody('commercial_purchase_orders')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('status is CHECK-constrained to exactly the five approved lifecycle states', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL DEFAULT 'DRAFT'\s*\n?\s*CHECK \(status IN \('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED'\)\)/)
  })

  it('does not have a PAID or RECEIVED status value anywhere in this table', () => {
    const statusLine = body.match(/status\s+TEXT[^\n]*\n?[^\n]*/)?.[0] ?? ''
    expect(statusLine).not.toMatch(/'PAID'|'RECEIVED'/)
  })

  it('purchase_order_number is nullable and unique per organisation only when set', () => {
    expect(body).toMatch(/purchase_order_number\s+TEXT/)
    expect(body).not.toMatch(/purchase_order_number\s+TEXT NOT NULL/)
    expect(body).toMatch(/UNIQUE \(organisation_id, purchase_order_number\)/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('composite-FKs supplier_id onto commercial_suppliers(id, organisation_id) — never a plain id FK', () => {
    expect(body).toMatch(/FOREIGN KEY \(supplier_id, organisation_id\)\s*\n?\s*REFERENCES commercial_suppliers \(id, organisation_id\)/)
  })

  it('composite-FKs cost_centre_id onto commercial_cost_centres(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(cost_centre_id, organisation_id\)\s*\n?\s*REFERENCES commercial_cost_centres \(id, organisation_id\)/)
  })

  it('enforces total_cents = subtotal_cents + tax_cents at the database level', () => {
    expect(body).toMatch(/CHECK \(total_cents = subtotal_cents \+ tax_cents\)/)
  })

  it('cents columns are all non-negative CHECK-constrained integers', () => {
    expect(body).toMatch(/subtotal_cents\s+INTEGER NOT NULL DEFAULT 0 CHECK \(subtotal_cents >= 0\)/)
    expect(body).toMatch(/tax_cents\s+INTEGER NOT NULL DEFAULT 0 CHECK \(tax_cents >= 0\)/)
    expect(body).toMatch(/total_cents\s+INTEGER NOT NULL DEFAULT 0 CHECK \(total_cents >= 0\)/)
  })

  it('payment_terms_days allows NULL but rejects negative values', () => {
    expect(body).toMatch(/payment_terms_days\s+INTEGER CHECK \(payment_terms_days IS NULL OR payment_terms_days >= 0\)/)
  })

  it('carries all eleven supplier snapshot columns for the ISSUED state', () => {
    for (const col of [
      'supplier_name_snapshot', 'supplier_legal_name_snapshot', 'supplier_contact_name_snapshot',
      'supplier_email_snapshot', 'supplier_phone_snapshot', 'supplier_address_snapshot',
      'supplier_tax_business_number_snapshot', 'supplier_reference_snapshot', 'payment_terms_days_snapshot',
    ]) {
      expect(body).toMatch(new RegExp(`${col}\\s`))
    }
  })

  it('has return_reason and cancel_reason columns, both nullable', () => {
    expect(body).toMatch(/return_reason\s+TEXT/)
    expect(body).toMatch(/cancel_reason\s+TEXT/)
  })

  it('has the full actor-attribution chain: created/submitted/approved/issued/cancelled _by', () => {
    for (const col of ['created_by', 'submitted_by', 'approved_by', 'issued_by', 'cancelled_by']) {
      expect(body).toMatch(new RegExp(`${col}\\s+TEXT REFERENCES users\\(id\\)`))
    }
  })

  it('does NOT have a received_quantity, billed_quantity, matched_quantity, or payment column', () => {
    expect(body).not.toMatch(/received_quantity|billed_quantity|matched_quantity|paid_cents|payment_id/i)
  })

  it('does NOT have a financial_period_id, committed, or encumbrance column (deferred to a later Budgeting phase)', () => {
    expect(body).not.toMatch(/financial_period_id|committed|encumbrance/i)
  })
})

describe('Phase C6.2 — commercial_purchase_order_lines table shape', () => {
  const body = tableBody('commercial_purchase_order_lines')

  it('has organisation_id NOT NULL referencing organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('product_id is nullable — ad-hoc lines are supported', () => {
    expect(body).toMatch(/product_id\s+UUID,/)
  })

  it('quantity matches commercial_invoice_lines exactly: INTEGER, default 1, CHECK > 0', () => {
    expect(body).toMatch(/quantity\s+INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0\)/)
  })

  it('uses "position" (not "sort_order"), matching commercial_invoice_lines exactly', () => {
    expect(body).toMatch(/position\s+INTEGER NOT NULL DEFAULT 0/)
    expect(body).not.toMatch(/sort_order/)
  })

  it('has no persisted tax_code_id column — only snapshot columns, matching commercial_invoice_lines exactly', () => {
    expect(body).not.toMatch(/\btax_code_id\b/)
    expect(body).toMatch(/tax_code_snapshot\s+TEXT/)
    expect(body).toMatch(/tax_rate_snapshot\s+NUMERIC\(5,2\) NOT NULL DEFAULT 0 CHECK \(tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100\)/)
  })

  it('carries the tenant-integrity anchor UNIQUE (id, organisation_id)', () => {
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('composite-FKs purchase_order_id onto commercial_purchase_orders(id, organisation_id) with ON DELETE CASCADE', () => {
    expect(body).toMatch(/FOREIGN KEY \(purchase_order_id, organisation_id\)\s*\n?\s*REFERENCES commercial_purchase_orders \(id, organisation_id\) ON DELETE CASCADE/)
  })

  it('composite-FKs product_id onto commercial_products(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(product_id, organisation_id\)\s*\n?\s*REFERENCES commercial_products \(id, organisation_id\)/)
  })

  it('composite-FKs cost_centre_id onto commercial_cost_centres(id, organisation_id)', () => {
    expect(body).toMatch(/FOREIGN KEY \(cost_centre_id, organisation_id\)\s*\n?\s*REFERENCES commercial_cost_centres \(id, organisation_id\)/)
  })

  it('does NOT have received_quantity, billed_quantity, matched_quantity, or a payment field', () => {
    expect(body).not.toMatch(/received_quantity|billed_quantity|matched_quantity|paid_cents/i)
  })
})

describe('Phase C6.2 — required indexes exist', () => {
  it('has organisation-scoped indexes on every new table', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_suppliers_org ON commercial_suppliers\(organisation_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_purchase_orders_org ON commercial_purchase_orders\(organisation_id\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_po_lines_org ON commercial_purchase_order_lines\(organisation_id\)/)
  })

  it('has an organisation+status index for purchase order list filtering', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_commercial_purchase_orders_org_status ON commercial_purchase_orders\(organisation_id, status\)/)
  })
})

describe('Phase C6.2 — every CREATE statement in this file is idempotent', () => {
  it('every CREATE TABLE uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE TABLE(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })

  it('every CREATE INDEX uses IF NOT EXISTS', () => {
    const creates = source.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) ?? []
    expect(creates).toHaveLength(0)
  })
})

describe('Phase C6.2 — no Purchase Request table is created (deferred, per the frozen C6.2 scope)', () => {
  it('contains no commercial_purchase_request table anywhere', () => {
    expect(source).not.toMatch(/commercial_purchase_requests?/i)
  })
})
