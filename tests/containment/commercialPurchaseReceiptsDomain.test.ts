import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.3 — behavioural + source-text tests for
// lib/commercial/purchaseReceipts.ts, mirroring
// tests/containment/commercialPurchaseOrdersDomain.test.ts's own mocking
// discipline exactly: sibling modules (getPurchaseOrder,
// listPurchaseOrderLines) are mocked directly, and '@/lib/db' is mocked
// at the sql-call level. The genuine concurrency PROOF for
// postPurchaseReceiptAtomically() lives in the real-Postgres harness
// (scripts/tests/purchaseReceiptConcurrency.integration.test.ts) — this
// file covers the surrounding validation/error-classification logic a
// mock CAN safely verify, plus source-text assertions confirming the
// atomic statement's shape (FOR UPDATE locks, deterministic lock order,
// the tolerance check, and the seed INSERT being a separate statement
// rather than an unreferenced CTE).

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

const logPurchaseReceiptCreatedMock = vi.fn()
const logPurchaseReceiptUpdatedMock = vi.fn()
const logPurchaseReceiptDeletedMock = vi.fn()
const logPurchaseReceiptPostedMock = vi.fn()
const logPurchaseReceiptCancelledMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logPurchaseReceiptCreated: (...a: unknown[]) => logPurchaseReceiptCreatedMock(...a),
  logPurchaseReceiptUpdated: (...a: unknown[]) => logPurchaseReceiptUpdatedMock(...a),
  logPurchaseReceiptDeleted: (...a: unknown[]) => logPurchaseReceiptDeletedMock(...a),
  logPurchaseReceiptPosted: (...a: unknown[]) => logPurchaseReceiptPostedMock(...a),
  logPurchaseReceiptCancelled: (...a: unknown[]) => logPurchaseReceiptCancelledMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  getPurchaseOrderMock.mockReset()
  listPurchaseOrderLinesMock.mockReset()
  logPurchaseReceiptCreatedMock.mockReset()
  logPurchaseReceiptUpdatedMock.mockReset()
  logPurchaseReceiptDeletedMock.mockReset()
  logPurchaseReceiptPostedMock.mockReset()
  logPurchaseReceiptCancelledMock.mockReset()
})

const ORG = 'org-a'
const poRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'po-1', organisation_id: ORG, status: 'ISSUED', ...overrides,
})
const poLineRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'line-1', organisation_id: ORG, purchase_order_id: 'po-1',
  description_snapshot: 'Widget', sku_snapshot: 'SKU-1', unit_snapshot: 'ea', quantity: 10,
  ...overrides,
})
const receiptRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'receipt-1', organisation_id: ORG, purchase_order_id: 'po-1', receipt_number: null, status: 'DRAFT',
  received_date: null, delivery_reference: null, notes: null, cancel_reason: null,
  created_by: 'user-1', posted_by: null, cancelled_by: null,
  created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z',
  posted_at: null, cancelled_at: null, ...overrides,
})

describe('Phase C7.3 — createPurchaseReceipt', () => {
  it('rejects a purchaseOrderId that does not resolve for this organisation, without writing anything', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(null)
    const { createPurchaseReceipt } = await import('@/lib/commercial/purchaseReceipts')
    await expect(createPurchaseReceipt({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-x' }))
      .rejects.toThrow('purchase_order_id not found for this organisation')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'])('rejects a %s (non-ISSUED) purchase order', async (status) => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow({ status }))
    const { createPurchaseReceipt } = await import('@/lib/commercial/purchaseReceipts')
    await expect(createPurchaseReceipt({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow(/can only be created against an ISSUED purchase order/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('creates a DRAFT against an ISSUED PO and logs commercial_purchase_receipt.created', async () => {
    getPurchaseOrderMock.mockResolvedValueOnce(poRow())
    sqlMock.mockResolvedValueOnce([receiptRow()])
    const { createPurchaseReceipt } = await import('@/lib/commercial/purchaseReceipts')

    const result = await createPurchaseReceipt({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' })
    expect(result.status).toBe('DRAFT')
    expect(logPurchaseReceiptCreatedMock).toHaveBeenCalledOnce()
  })
})

describe('Phase C7.3 — addPurchaseReceiptLine: PO-line lineage', () => {
  it('rejects a sourcePurchaseOrderLineId that does not belong to the receipt\'s own purchase order', async () => {
    sqlMock.mockResolvedValueOnce([receiptRow({ purchase_order_id: 'po-1' })]) // getPurchaseReceipt
    listPurchaseOrderLinesMock.mockResolvedValueOnce([poLineRow({ id: 'line-on-po-1', purchase_order_id: 'po-1' })])
    const { addPurchaseReceiptLine } = await import('@/lib/commercial/purchaseReceipts')

    await expect(addPurchaseReceiptLine({
      organisationId: ORG, purchaseReceiptId: 'receipt-1', sourcePurchaseOrderLineId: 'line-on-a-different-po', quantityReceived: 1,
    })).rejects.toThrow('source_purchase_order_line_id not found on this purchase order for this organisation')
  })

  it('rejects a non-positive or non-numeric quantityReceived', async () => {
    sqlMock.mockResolvedValueOnce([receiptRow()])
    const { addPurchaseReceiptLine } = await import('@/lib/commercial/purchaseReceipts')
    await expect(addPurchaseReceiptLine({
      organisationId: ORG, purchaseReceiptId: 'receipt-1', sourcePurchaseOrderLineId: 'line-1', quantityReceived: 0,
    })).rejects.toThrow('quantityReceived must be a positive number')
  })

  it('accepts a fractional quantityReceived — receipts support services, not just integer goods', async () => {
    sqlMock
      .mockResolvedValueOnce([receiptRow()]) // getPurchaseReceipt
      .mockResolvedValueOnce([{ next_position: 1 }])
      .mockResolvedValueOnce([{ id: 'rline-1', quantity_received: '6.5000' }])
    listPurchaseOrderLinesMock.mockResolvedValueOnce([poLineRow()])
    const { addPurchaseReceiptLine } = await import('@/lib/commercial/purchaseReceipts')

    const line = await addPurchaseReceiptLine({
      organisationId: ORG, purchaseReceiptId: 'receipt-1', sourcePurchaseOrderLineId: 'line-1', quantityReceived: 6.5,
    })
    expect(line.quantity_received).toBe('6.5000')
  })

  it('rejects adding a line to a non-DRAFT (e.g. POSTED) receipt', async () => {
    sqlMock.mockResolvedValueOnce([receiptRow({ status: 'POSTED' })])
    const { addPurchaseReceiptLine } = await import('@/lib/commercial/purchaseReceipts')
    await expect(addPurchaseReceiptLine({
      organisationId: ORG, purchaseReceiptId: 'receipt-1', sourcePurchaseOrderLineId: 'line-1', quantityReceived: 1,
    })).rejects.toThrow('Purchase receipt is POSTED and can no longer be edited')
  })
})

describe('Phase C7.3 — deletePurchaseReceipt: DRAFT + never-numbered only', () => {
  it('the eligibility gate is expressed in the WHERE clause itself, not a separate pre-check', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseReceipts.ts'), 'utf-8')
    const start = source.indexOf('export async function deletePurchaseReceipt')
    const returningIndex = source.indexOf('RETURNING id', start)
    const end = source.indexOf('\n}', returningIndex)
    const body = source.slice(start, end)
    expect(body).toMatch(/WHERE id = \$\{params\.purchaseReceiptId\} AND organisation_id = \$\{params\.organisationId\}\s*\n?\s*AND status = 'DRAFT' AND receipt_number IS NULL/)
  })

  it('returns false (not an error) when the receipt is not an eligible never-posted draft', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { deletePurchaseReceipt } = await import('@/lib/commercial/purchaseReceipts')
    const result = await deletePurchaseReceipt({ organisationId: ORG, userId: 'user-1', purchaseReceiptId: 'receipt-1' })
    expect(result).toBe(false)
    expect(logPurchaseReceiptDeletedMock).not.toHaveBeenCalled()
  })
})

describe('Phase C7.3 — cancelPurchaseReceipt', () => {
  it('rejects an empty/whitespace-only reason without writing anything', async () => {
    const { cancelPurchaseReceipt } = await import('@/lib/commercial/purchaseReceipts')
    await expect(cancelPurchaseReceipt({ organisationId: ORG, userId: 'user-1', purchaseReceiptId: 'receipt-1', reason: '   ' }))
      .rejects.toThrow('cancel_reason is required')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('only a POSTED receipt is affected by the guarded UPDATE — a concurrent-status-change race surfaces as a clear error, not a silent no-op', async () => {
    sqlMock
      .mockResolvedValueOnce([receiptRow({ status: 'DRAFT' })]) // getPurchaseReceipt
    const { cancelPurchaseReceipt } = await import('@/lib/commercial/purchaseReceipts')
    await expect(cancelPurchaseReceipt({ organisationId: ORG, userId: 'user-1', purchaseReceiptId: 'receipt-1', reason: 'damaged' }))
      .rejects.toThrow('Cannot transition purchase receipt from DRAFT to CANCELLED')
  })
})

describe('Phase C7.3 — getReceivedQuantitiesForPurchaseOrder: derived, POSTED-only aggregate', () => {
  it('filters strictly on POSTED status and groups by source_purchase_order_line_id', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseReceipts.ts'), 'utf-8')
    const start = source.indexOf('export async function getReceivedQuantitiesForPurchaseOrder')
    const end = source.indexOf('\n}', start)
    const body = source.slice(start, end)
    expect(body).toMatch(/cpr\.status = 'POSTED'/)
    expect(body).toMatch(/GROUP BY crl\.source_purchase_order_line_id/)
  })

  it('returns a plain Record keyed by PO line id, coerced to number (never a string, despite the NUMERIC column)', async () => {
    sqlMock.mockResolvedValueOnce([{ line_id: 'line-1', qty: '6.5000' }])
    const { getReceivedQuantitiesForPurchaseOrder } = await import('@/lib/commercial/purchaseReceipts')
    const result = await getReceivedQuantitiesForPurchaseOrder(ORG, 'po-1')
    expect(result).toEqual({ 'line-1': 6.5 })
  })
})

describe('Phase C7.3 — postPurchaseReceiptAtomically: source-text proof of the concurrency-safety shape', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseReceipts.ts'), 'utf-8')
  const fnStart = source.indexOf('async function postPurchaseReceiptAtomically')
  const fnEnd = source.indexOf('\nexport async function postPurchaseReceipt(', fnStart)
  const body = source.slice(fnStart, fnEnd)

  it('the receipt-number sequence seed is a SEPARATE statement, not an unreferenced CTE inside the atomic WITH-chain (unreferenced data-modifying CTEs are not guaranteed to execute in Postgres)', () => {
    const seedIndex = body.indexOf('INSERT INTO commercial_document_sequences')
    const withIndex = body.indexOf('WITH receipt_guard AS')
    expect(seedIndex).toBeGreaterThanOrEqual(0)
    expect(withIndex).toBeGreaterThan(seedIndex)
    // The seed INSERT must terminate its own statement (a `` ` `` closing
    // the sql tagged-template) before the WITH-chain begins — i.e. it is
    // not nested inside the same template literal as a CTE.
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

  it('locks the receipt row, the parent PO row, and every affected PO line row, all with FOR UPDATE', () => {
    const forUpdateCount = (body.match(/FOR UPDATE/g) ?? []).length
    expect(forUpdateCount).toBeGreaterThanOrEqual(3)
    expect(cteBody('receipt_guard')).toMatch(/FOR UPDATE/)
    expect(cteBody('po_guard')).toMatch(/FOR UPDATE/)
    expect(cteBody('locked_lines')).toMatch(/FOR UPDATE/)
  })

  it('locks the affected PO line rows in deterministic id order — the standard deadlock-avoidance idiom for two transactions locking overlapping row sets', () => {
    expect(body).toMatch(/locked_lines AS \([\s\S]*?ORDER BY cpol\.id[\s\S]*?FOR UPDATE/)
  })

  it('the receipt row lock requires status = DRAFT, and the PO row lock requires status = ISSUED, before anything can post', () => {
    expect(body).toMatch(/receipt_guard AS \([\s\S]*?status = 'DRAFT'/)
    expect(body).toMatch(/po_guard AS \([\s\S]*?status = 'ISSUED'/)
  })

  it('recomputes already-posted quantity AFTER the locks are acquired, excluding this receipt itself and excluding cancelled receipts', () => {
    expect(body).toMatch(/already_posted AS \([\s\S]*?cpr\.status = 'POSTED'/)
    expect(body).toMatch(/crl\.purchase_receipt_id <> \$\{params\.purchaseReceiptId\}/)
  })

  it('the over-receipt check compares total_after (already-posted + this receipt) against the locked ordered_quantity, rejecting anything over — no configurable tolerance percentage/settings lookup exists', () => {
    expect(body).toMatch(/total_after\s*<=\s*ordered_quantity/)
    expect(body).not.toMatch(/tolerance_percent|tolerancePercent|organisation_settings|toleranceSettings/i)
  })

  it('numbering allocation and the DRAFT -> POSTED flip both gate on the validation CTE passing, in the SAME statement as the locks', () => {
    expect(body).toMatch(/alloc AS \(\s*UPDATE commercial_document_sequences[\s\S]*?EXISTS \(SELECT 1 FROM validation WHERE line_count > 0 AND all_within_tolerance = true\)/)
    expect(body).toMatch(/UPDATE commercial_purchase_receipts SET\s*\n\s*status = 'POSTED'/)
  })
})

describe('Phase C7.3 — numbering: PURCHASE_RECEIPT document type registered, GR- prefix', () => {
  it('documentNumbering.ts registers PURCHASE_RECEIPT with the GR- default prefix', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentNumbering.ts'), 'utf-8')
    expect(source).toMatch(/PURCHASE_RECEIPT/)
    expect(source).toMatch(/PURCHASE_RECEIPT:\s*'GR-'/)
  })
})

describe('Phase C7.3 — attachments: purchase_receipt document type widening reuses the existing infrastructure', () => {
  it('documentAttachments.ts widens CommercialAttachmentDocumentType to include purchase_receipt alongside purchase_order', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentAttachments.ts'), 'utf-8')
    expect(source).toMatch(/'purchase_order'\s*\|\s*'purchase_receipt'/)
  })

  it('exposes a full set of purchase-receipt attachment functions mirroring the purchase-order ones', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentAttachments.ts'), 'utf-8')
    for (const fn of [
      'listAttachmentsForPurchaseReceipt', 'getPurchaseReceiptAttachment', 'uploadPurchaseReceiptAttachment',
      'downloadPurchaseReceiptAttachmentBytes', 'removePurchaseReceiptAttachment',
    ]) {
      expect(source, `expected ${fn} to exist`).toMatch(new RegExp(`export async function ${fn}`))
    }
  })

  it('the widened CHECK constraint migration adds purchase_receipt without dropping purchase_order support', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/widen-commercial-document-attachments-for-purchase-receipts.sql'), 'utf-8')
    expect(source).toMatch(/CHECK \(document_type IN \('purchase_order', 'purchase_receipt'\)\)/)
  })
})
