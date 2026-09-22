import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.4 — behavioural + source-text tests for
// lib/commercial/supplierBills.ts, mirroring tests/containment/
// commercialPurchaseReceiptsDomain.test.ts's own mocking discipline
// exactly. The genuine concurrency PROOF for postSupplierBillAtomically()
// lives in the real-Postgres harness
// (scripts/tests/supplierBillConcurrency.integration.test.ts) — this file
// covers the surrounding validation/error-classification logic a mock CAN
// safely verify, plus source-text assertions confirming the atomic
// statement's shape.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const getPurchaseOrderMock = vi.fn()
const listPurchaseOrderLinesMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({
  getPurchaseOrder: (...a: unknown[]) => getPurchaseOrderMock(...a),
  listPurchaseOrderLines: (...a: unknown[]) => listPurchaseOrderLinesMock(...a),
}))

const getSupplierMock = vi.fn()
vi.mock('@/lib/commercial/suppliers', () => ({ getSupplier: (...a: unknown[]) => getSupplierMock(...a) }))

const getProductMock = vi.fn()
vi.mock('@/lib/commercial/products', () => ({ getProduct: (...a: unknown[]) => getProductMock(...a) }))

const getTaxCodeMock = vi.fn()
vi.mock('@/lib/commercial/taxCodes', () => ({ getTaxCode: (...a: unknown[]) => getTaxCodeMock(...a) }))

const logSupplierBillCreatedMock = vi.fn()
const logSupplierBillUpdatedMock = vi.fn()
const logSupplierBillDeletedMock = vi.fn()
const logSupplierBillPostedMock = vi.fn()
const logSupplierBillCancelledMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logSupplierBillCreated: (...a: unknown[]) => logSupplierBillCreatedMock(...a),
  logSupplierBillUpdated: (...a: unknown[]) => logSupplierBillUpdatedMock(...a),
  logSupplierBillDeleted: (...a: unknown[]) => logSupplierBillDeletedMock(...a),
  logSupplierBillPosted: (...a: unknown[]) => logSupplierBillPostedMock(...a),
  logSupplierBillCancelled: (...a: unknown[]) => logSupplierBillCancelledMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  getPurchaseOrderMock.mockReset()
  listPurchaseOrderLinesMock.mockReset()
  getSupplierMock.mockReset()
  getProductMock.mockReset()
  getTaxCodeMock.mockReset()
  logSupplierBillCreatedMock.mockReset()
  logSupplierBillUpdatedMock.mockReset()
  logSupplierBillDeletedMock.mockReset()
  logSupplierBillPostedMock.mockReset()
  logSupplierBillCancelledMock.mockReset()
})

const ORG = 'org-a'
const poRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'po-1', organisation_id: ORG, status: 'ISSUED', supplier_id: 'sup-1', currency: 'AUD', ...overrides,
})
const poLineRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'line-1', organisation_id: ORG, purchase_order_id: 'po-1', product_id: null,
  description_snapshot: 'Widget', sku_snapshot: 'SKU-1', unit_snapshot: 'ea', quantity: 10,
  unit_price_cents: 1000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 11000,
  ...overrides,
})
const billRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'bill-1', organisation_id: ORG, supplier_id: 'sup-1', source_purchase_order_id: 'po-1',
  supplier_invoice_number: 'INV-001', supplier_invoice_number_canonical: 'inv-001', bill_number: null, status: 'DRAFT',
  currency: 'AUD', bill_date: null, due_date: null, subtotal_cents: 0, tax_cents: 0, total_cents: 0,
  supplier_name_snapshot: null, cancel_reason: null, created_by: 'user-1', posted_by: null, cancelled_by: null,
  created_at: '2026-09-15T00:00:00.000Z', updated_at: '2026-09-15T00:00:00.000Z', posted_at: null, cancelled_at: null,
  ...overrides,
})

describe('Phase C7.4 — createSupplierBill', () => {
  it('rejects a purchaseOrderId that does not resolve for this organisation, without writing anything', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(null)
    const { createSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(createSupplierBill({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-x', supplierInvoiceNumber: 'INV-1' }))
      .rejects.toThrow('purchase_order_id not found for this organisation')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'])('rejects a %s (non-ISSUED) purchase order', async (status) => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow({ status }))
    const { createSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(createSupplierBill({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-1' }))
      .rejects.toThrow(/can only be created against an ISSUED purchase order/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a blank/whitespace-only supplierInvoiceNumber, without writing anything', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow())
    const { createSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(createSupplierBill({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', supplierInvoiceNumber: '   ' }))
      .rejects.toThrow('supplierInvoiceNumber is required')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('never accepts a supplierId or currency parameter — both are always copied from the PO (structural mismatch prevention)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/supplierBills.ts'), 'utf-8')
    const start = source.indexOf('export async function createSupplierBill(params: {')
    const end = source.indexOf('}): Promise<CommercialSupplierBill> {', start)
    const signature = source.slice(start, end)
    expect(signature).not.toMatch(/supplierId/)
    expect(signature).not.toMatch(/currency/)
  })

  it('creates a DRAFT against an ISSUED PO, copying supplier_id/currency from the PO, and logs commercial_supplier_bill.created', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow({ supplier_id: 'sup-1', currency: 'AUD' }))
    sqlMock.mockResolvedValueOnce([billRow()])
    const { createSupplierBill } = await import('@/lib/commercial/supplierBills')

    const result = await createSupplierBill({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-001' })
    expect(result.status).toBe('DRAFT')
    expect(logSupplierBillCreatedMock).toHaveBeenCalledOnce()

    const insertCall = sqlMock.mock.calls[0]
    const insertText = (insertCall[0] as string[]).join('')
    expect(insertText).toMatch(/INSERT INTO commercial_supplier_bills/)
    // The values array (interpolated params) must include the PO's own
    // supplier_id and currency, proving they were copied, not independently
    // chosen.
    expect(insertCall).toContain('sup-1')
    expect(insertCall).toContain('AUD')
  })

  it('translates a 23505 unique-violation on the named duplicate-invoice constraint into a friendly, specific error', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow())
    const { NeonDbError } = await import('@neondatabase/serverless')
    const dupError = Object.assign(new NeonDbError('duplicate key value violates unique constraint'), {
      code: '23505', constraint: 'commercial_supplier_bills_supplier_invoice_unique',
    })
    sqlMock.mockRejectedValueOnce(dupError)
    const { createSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(createSupplierBill({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-001' }))
      .rejects.toThrow('This supplier invoice number has already been recorded for this supplier.')
  })

  it('an UNRELATED 23505 (different constraint) is NOT swallowed — it propagates as-is', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow())
    const { NeonDbError } = await import('@neondatabase/serverless')
    const otherError = Object.assign(new NeonDbError('duplicate key value violates unique constraint'), {
      code: '23505', constraint: 'some_other_constraint',
    })
    sqlMock.mockRejectedValueOnce(otherError)
    const { createSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(createSupplierBill({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-001' }))
      .rejects.toBe(otherError)
  })
})

describe('Phase C7.4 — addSupplierBillLine: PO-line lineage and money fields', () => {
  it('rejects a sourcePurchaseOrderLineId that does not belong to the bill\'s own purchase order', async () => {
    sqlMock.mockResolvedValueOnce([billRow({ source_purchase_order_id: 'po-1' })]) // getSupplierBill
    listPurchaseOrderLinesMock.mockResolvedValueOnce([poLineRow({ id: 'line-on-po-1', purchase_order_id: 'po-1' })])
    const { addSupplierBillLine } = await import('@/lib/commercial/supplierBills')

    await expect(addSupplierBillLine({
      organisationId: ORG, supplierBillId: 'bill-1', sourcePurchaseOrderLineId: 'line-on-a-different-po', quantity: 1,
    })).rejects.toThrow('source_purchase_order_line_id not found on this purchase order for this organisation')
  })

  it('rejects a non-positive or non-integer quantity', async () => {
    sqlMock.mockResolvedValueOnce([billRow()])
    const { addSupplierBillLine } = await import('@/lib/commercial/supplierBills')
    await expect(addSupplierBillLine({
      organisationId: ORG, supplierBillId: 'bill-1', sourcePurchaseOrderLineId: 'line-1', quantity: 0,
    })).rejects.toThrow('quantity must be a positive integer')
  })

  it('defaults unitPriceCents/tax snapshot from the source PO line when not explicitly provided', async () => {
    sqlMock
      .mockResolvedValueOnce([billRow()]) // getSupplierBill
      .mockResolvedValueOnce([{ next_position: 1 }])
      .mockResolvedValueOnce([{ id: 'bl-1', unit_price_cents: 1000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 11000 }])
      .mockResolvedValueOnce([{ line_subtotal_cents: 10000, line_tax_cents: 1000, line_total_cents: 11000 }]) // recalculateSupplierBillTotals's listSupplierBillLines
      .mockResolvedValueOnce([]) // recalculateSupplierBillTotals's UPDATE
    listPurchaseOrderLinesMock.mockResolvedValueOnce([poLineRow()])
    const { addSupplierBillLine } = await import('@/lib/commercial/supplierBills')

    const line = await addSupplierBillLine({ organisationId: ORG, supplierBillId: 'bill-1', sourcePurchaseOrderLineId: 'line-1', quantity: 10 })
    expect(line.unit_price_cents).toBe(1000)
    expect(line.tax_code_snapshot).toBe('GST')
  })

  it('rejects adding a line to a non-DRAFT (e.g. POSTED) bill', async () => {
    sqlMock.mockResolvedValueOnce([billRow({ status: 'POSTED' })])
    const { addSupplierBillLine } = await import('@/lib/commercial/supplierBills')
    await expect(addSupplierBillLine({
      organisationId: ORG, supplierBillId: 'bill-1', sourcePurchaseOrderLineId: 'line-1', quantity: 1,
    })).rejects.toThrow('Supplier bill is POSTED and can no longer be edited')
  })
})

describe('Phase C7.4 — deleteSupplierBill: DRAFT + never-numbered only', () => {
  it('the eligibility gate is expressed in the WHERE clause itself, not a separate pre-check', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/supplierBills.ts'), 'utf-8')
    const start = source.indexOf('export async function deleteSupplierBill')
    const returningIndex = source.indexOf('RETURNING id', start)
    const end = source.indexOf('\n}', returningIndex)
    const body = source.slice(start, end)
    expect(body).toMatch(/WHERE id = \$\{params\.supplierBillId\} AND organisation_id = \$\{params\.organisationId\}\s*\n?\s*AND status = 'DRAFT' AND bill_number IS NULL/)
  })

  it('returns false (not an error) when the bill is not an eligible never-posted draft', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { deleteSupplierBill } = await import('@/lib/commercial/supplierBills')
    const result = await deleteSupplierBill({ organisationId: ORG, userId: 'user-1', supplierBillId: 'bill-1' })
    expect(result).toBe(false)
    expect(logSupplierBillDeletedMock).not.toHaveBeenCalled()
  })
})

describe('Phase C7.4 — cancelSupplierBill', () => {
  it('rejects an empty/whitespace-only reason without writing anything', async () => {
    const { cancelSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(cancelSupplierBill({ organisationId: ORG, userId: 'user-1', supplierBillId: 'bill-1', reason: '   ' }))
      .rejects.toThrow('cancel_reason is required')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('only a POSTED bill is affected by the guarded UPDATE', async () => {
    sqlMock.mockResolvedValueOnce([billRow({ status: 'DRAFT' })])
    const { cancelSupplierBill } = await import('@/lib/commercial/supplierBills')
    await expect(cancelSupplierBill({ organisationId: ORG, userId: 'user-1', supplierBillId: 'bill-1', reason: 'error' }))
      .rejects.toThrow('Cannot transition supplier bill from DRAFT to CANCELLED')
  })
})

describe('Phase C7.4 — getBilledAmountsForPurchaseOrder: derived, POSTED-only, VALUE-based aggregate', () => {
  it('filters strictly on POSTED status and sums line_total_cents (a value), never quantity', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/supplierBills.ts'), 'utf-8')
    const start = source.indexOf('export async function getBilledAmountsForPurchaseOrder')
    const end = source.indexOf('\n}', start)
    const body = source.slice(start, end)
    expect(body).toMatch(/csb\.status = 'POSTED'/)
    expect(body).toMatch(/SUM\(csbl\.line_total_cents\)/)
    expect(body).not.toMatch(/SUM\(csbl\.quantity\)/)
  })

  it('returns a plain Record keyed by PO line id, coerced to number', async () => {
    sqlMock.mockResolvedValueOnce([{ line_id: 'line-1', cents: '11000' }])
    const { getBilledAmountsForPurchaseOrder } = await import('@/lib/commercial/supplierBills')
    const result = await getBilledAmountsForPurchaseOrder(ORG, 'po-1')
    expect(result).toEqual({ 'line-1': 11000 })
  })
})

describe('Phase C7.4 — postSupplierBillAtomically: source-text proof of the concurrency-safety shape', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/supplierBills.ts'), 'utf-8')
  const fnStart = source.indexOf('async function postSupplierBillAtomically')
  const fnEnd = source.indexOf('\nexport async function postSupplierBill(', fnStart)
  const body = source.slice(fnStart, fnEnd)

  it('the bill-number sequence seed is a SEPARATE statement, not an unreferenced CTE inside the atomic WITH-chain', () => {
    const seedIndex = body.indexOf('INSERT INTO commercial_document_sequences')
    const withIndex = body.indexOf('WITH bill_guard AS')
    expect(seedIndex).toBeGreaterThanOrEqual(0)
    expect(withIndex).toBeGreaterThan(seedIndex)
    const betweenSeedAndWith = body.slice(seedIndex, withIndex)
    expect(betweenSeedAndWith).toMatch(/ON CONFLICT \(organisation_id, document_type\) DO NOTHING/)
    expect(betweenSeedAndWith).toMatch(/`;/)
  })

  function cteBody(name: string): string {
    const marker = `${name} AS (`
    const start = body.indexOf(marker)
    expect(start, `expected to find CTE ${name}`).toBeGreaterThanOrEqual(0)
    const end = body.indexOf('\n    ),', start)
    return body.slice(start, end)
  }

  it('locks the bill row, the parent PO row, and every affected PO line row, all with FOR UPDATE', () => {
    const forUpdateCount = (body.match(/FOR UPDATE/g) ?? []).length
    expect(forUpdateCount).toBeGreaterThanOrEqual(3)
    expect(cteBody('bill_guard')).toMatch(/FOR UPDATE/)
    expect(cteBody('po_guard')).toMatch(/FOR UPDATE/)
    expect(cteBody('locked_lines')).toMatch(/FOR UPDATE/)
  })

  it('locks the affected PO line rows in deterministic id order', () => {
    expect(body).toMatch(/locked_lines AS \([\s\S]*?ORDER BY cpol\.id[\s\S]*?FOR UPDATE/)
  })

  it('the bill row lock requires status = DRAFT, and the PO row lock requires status = ISSUED', () => {
    expect(body).toMatch(/bill_guard AS \([\s\S]*?status = 'DRAFT'/)
    expect(body).toMatch(/po_guard AS \([\s\S]*?status = 'ISSUED'/)
  })

  it('locked_lines compares against the PO LINE\'S line_total_cents (ordered VALUE), not its quantity', () => {
    expect(body).toMatch(/SELECT cpol\.id, cpol\.line_total_cents AS ordered_value_cents/)
  })

  it('recomputes already-posted VALUE after locks are held, excluding this bill itself and excluding cancelled bills', () => {
    expect(body).toMatch(/already_posted AS \([\s\S]*?csb\.status = 'POSTED'/)
    expect(body).toMatch(/csbl\.supplier_bill_id <> \$\{params\.supplierBillId\}/)
  })

  it('the over-billing check compares total_after_cents (already-posted + this bill) against the locked ordered_value_cents — no configurable tolerance', () => {
    expect(body).toMatch(/total_after_cents\s*<=\s*ordered_value_cents/)
    expect(body).not.toMatch(/tolerance_percent|tolerancePercent/i)
  })

  it('numbering allocation and the DRAFT -> POSTED flip both gate on the validation CTE passing, in the SAME statement as the locks', () => {
    expect(body).toMatch(/alloc AS \(\s*UPDATE commercial_document_sequences[\s\S]*?EXISTS \(SELECT 1 FROM validation WHERE line_count > 0 AND all_within_value = true\)/)
    expect(body).toMatch(/UPDATE commercial_supplier_bills SET\s*\n\s*status = 'POSTED'/)
  })

  it('freezes the supplier snapshot in the SAME atomic UPDATE that flips status to POSTED', () => {
    expect(body).toMatch(/supplier_name_snapshot = \$\{params\.supplier\.name\}/)
    expect(body).toMatch(/supplier_tax_business_number_snapshot = \$\{params\.supplier\.tax_business_number\}/)
  })
})

describe('Phase C7.4 — numbering: SUPPLIER_BILL document type registered, BILL- prefix', () => {
  it('documentNumbering.ts registers SUPPLIER_BILL with the BILL- default prefix', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentNumbering.ts'), 'utf-8')
    expect(source).toMatch(/SUPPLIER_BILL/)
    expect(source).toMatch(/SUPPLIER_BILL:\s*'BILL-'/)
  })
})

describe('Phase C7.4 — attachments: supplier_bill document type widening reuses the existing infrastructure', () => {
  it('documentAttachments.ts widens CommercialAttachmentDocumentType to include supplier_bill', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentAttachments.ts'), 'utf-8')
    expect(source).toMatch(/'purchase_order'\s*\|\s*'purchase_receipt'\s*\|\s*'supplier_bill'/)
  })

  it('exposes a full set of supplier-bill attachment functions mirroring the purchase-receipt ones', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentAttachments.ts'), 'utf-8')
    for (const fn of [
      'listAttachmentsForSupplierBill', 'getSupplierBillAttachment', 'uploadSupplierBillAttachment',
      'downloadSupplierBillAttachmentBytes', 'removeSupplierBillAttachment',
    ]) {
      expect(source, `expected ${fn} to exist`).toMatch(new RegExp(`export async function ${fn}`))
    }
  })

  it('the widened CHECK constraint migration adds supplier_bill without dropping the other two document types', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/widen-commercial-document-attachments-for-supplier-bills.sql'), 'utf-8')
    expect(source).toMatch(/CHECK \(document_type IN \('purchase_order', 'purchase_receipt', 'supplier_bill'\)\)/)
  })
})
