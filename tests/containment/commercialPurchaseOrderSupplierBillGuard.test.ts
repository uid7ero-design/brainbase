import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.4 — the ISSUED-PO-cannot-be-cancelled-while-a-POSTED-supplier-
// bill-exists guard, added to cancelPurchaseOrder() (lib/commercial/
// purchaseOrders.ts) ALONGSIDE the existing C7.3 purchase-receipt guard.
// The genuine CONCURRENCY proof (a bill-post racing this cancel) lives in
// the real-Postgres harness
// (scripts/tests/supplierBillConcurrency.integration.test.ts). This file
// covers what a mock CAN safely verify: the guard is expressed INSIDE the
// same guarded UPDATE's WHERE clause (not a separate pre-read), the
// resulting error message is specific, the API route maps that message to
// 409, and — critically — the PRE-EXISTING receipt guard is untouched by
// this addition.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('@/lib/commercial/suppliers', () => ({ getSupplier: vi.fn() }))
vi.mock('@/lib/commercial/products', () => ({ getProduct: vi.fn() }))
vi.mock('@/lib/commercial/taxCodes', () => ({ getTaxCode: vi.fn() }))
vi.mock('@/lib/commercial/auditLog', () => ({
  logPurchaseOrderCreated: vi.fn(), logPurchaseOrderUpdated: vi.fn(), logPurchaseOrderSubmitted: vi.fn(),
  logPurchaseOrderApproved: vi.fn(), logPurchaseOrderReturned: vi.fn(), logPurchaseOrderIssued: vi.fn(),
  logPurchaseOrderCancelled: vi.fn(),
}))

beforeEach(() => { sqlMock.mockReset() })

const ORG = 'org-a'
const poRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'po-1', organisation_id: ORG, status: 'ISSUED', subtotal_cents: 0, tax_cents: 0, total_cents: 0, ...overrides,
})

describe('Phase C7.4 — cancelPurchaseOrder(): source-text proof both guards (receipts AND supplier bills) live inside the same atomic UPDATE', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrders.ts'), 'utf-8')
  const start = source.indexOf('export async function cancelPurchaseOrder')
  const end = source.indexOf('\nexport async function', start + 1)
  const body = source.slice(start, end)
  const updateStart = body.indexOf('UPDATE commercial_purchase_orders SET')
  const updateEnd = body.indexOf('RETURNING *', updateStart)
  const updateBody = body.slice(updateStart, updateEnd)

  it('the receipt guard (C7.3) is still present, unmodified', () => {
    expect(updateBody).toMatch(/FROM commercial_purchase_receipts cpr/)
    expect(updateBody).toMatch(/cpr\.status = 'POSTED'/)
  })

  it('a SECOND, independent NOT EXISTS clause checks commercial_supplier_bills, scoped to this PO and organisation', () => {
    expect(updateBody).toMatch(/FROM commercial_supplier_bills csb/)
    expect(updateBody).toMatch(/csb\.source_purchase_order_id = commercial_purchase_orders\.id/)
    expect(updateBody).toMatch(/csb\.organisation_id = commercial_purchase_orders\.organisation_id/)
    expect(updateBody).toMatch(/csb\.status = 'POSTED'/)
  })

  it('both NOT EXISTS clauses are ANDed together (both must hold for the cancel to apply) — neither replaces the other', () => {
    const notExistsCount = (updateBody.match(/NOT EXISTS/g) ?? []).length
    expect(notExistsCount).toBe(2)
  })

  it('the diagnostic re-read after a failed UPDATE checks receipts first, then bills, before falling back to the generic concurrent-change message', () => {
    const receiptsCheckIndex = body.indexOf('activeReceipts')
    const billsCheckIndex = body.indexOf('activeBills')
    expect(receiptsCheckIndex).toBeGreaterThan(-1)
    expect(billsCheckIndex).toBeGreaterThan(receiptsCheckIndex)
  })
})

describe('Phase C7.4 — cancelPurchaseOrder(): behavioural — a POSTED supplier bill blocks cancellation with a specific error', () => {
  it('when the guarded UPDATE affects zero rows, no active receipt exists, but an active POSTED bill exists, throws the specific "posted supplier bills" message', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()]) // getPurchaseOrder pre-check
      .mockResolvedValueOnce([]) // guarded UPDATE returns zero rows
      .mockResolvedValueOnce([poRow()]) // diagnostic re-read: still ISSUED
      .mockResolvedValueOnce([]) // diagnostic: no active POSTED receipt
      .mockResolvedValueOnce([{ '?column?': 1 }]) // diagnostic: an active POSTED bill exists

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' }))
      .rejects.toThrow(/posted supplier bills and cannot be cancelled/)
  })

  it('when a POSTED receipt exists, the receipt message still wins (checked first) even if a bill also exists', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([{ '?column?': 1 }]) // active POSTED receipt exists

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' }))
      .rejects.toThrow(/posted purchase receipts and cannot be cancelled/)
  })

  it('when neither an active receipt nor an active bill exists, falls back to the generic concurrent-change message', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([]) // no active receipts
      .mockResolvedValueOnce([]) // no active bills

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' }))
      .rejects.toThrow('purchase order status changed concurrently; cancel aborted')
  })

  it('succeeds when the guarded UPDATE affects one row (no posted receipt or bill existed)', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([poRow({ status: 'CANCELLED', cancel_reason: 'no longer needed' })])

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    const result = await cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' })
    expect(result.status).toBe('CANCELLED')
  })
})
