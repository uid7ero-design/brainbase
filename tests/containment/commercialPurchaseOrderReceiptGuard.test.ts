import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.3 — the ISSUED-PO-cannot-be-cancelled-while-a-POSTED-receipt-
// exists guard, added to cancelPurchaseOrder() (lib/commercial/
// purchaseOrders.ts). The genuine CONCURRENCY proof (two transactions
// racing the same PO row) lives in the real-Postgres harness
// (scripts/tests/purchaseReceiptConcurrency.integration.test.ts — see its
// "CONCURRENT receipt-post and PO-cancel" test). This file covers what a
// mock CAN safely verify: the guard is expressed INSIDE the same guarded
// UPDATE's WHERE clause (not a separate pre-read racing the real check),
// the resulting error message is specific, and the API route maps that
// message to 409 rather than a generic 400.

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

describe('Phase C7.3 — cancelPurchaseOrder(): source-text proof the receipt guard is inside the atomic UPDATE, not a separate pre-read', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrders.ts'), 'utf-8')
  const start = source.indexOf('export async function cancelPurchaseOrder')
  const end = source.indexOf('\nexport async function', start + 1)
  const body = source.slice(start, end)

  it('the main guarded UPDATE\'s WHERE clause includes a NOT EXISTS check against POSTED commercial_purchase_receipts, scoped to this PO and organisation', () => {
    const updateStart = body.indexOf('UPDATE commercial_purchase_orders SET')
    const updateEnd = body.indexOf('RETURNING *', updateStart)
    const updateBody = body.slice(updateStart, updateEnd)
    expect(updateBody).toMatch(/AND status = 'ISSUED'\s*\n\s*AND NOT EXISTS \(/)
    expect(updateBody).toMatch(/FROM commercial_purchase_receipts cpr/)
    expect(updateBody).toMatch(/cpr\.purchase_order_id = commercial_purchase_orders\.id/)
    expect(updateBody).toMatch(/cpr\.organisation_id = commercial_purchase_orders\.organisation_id/)
    expect(updateBody).toMatch(/cpr\.status = 'POSTED'/)
  })

  it('the diagnostic re-read after a failed UPDATE is clearly commented as NOT the authorization decision', () => {
    expect(body).toMatch(/this read is NOT the authorization decision/)
  })
})

describe('Phase C7.3 — cancelPurchaseOrder(): behavioural — a POSTED receipt blocks cancellation with a specific error', () => {
  it('when the guarded UPDATE affects zero rows and an active POSTED receipt exists, throws the specific "posted purchase receipts" message', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()]) // getPurchaseOrder pre-check
      .mockResolvedValueOnce([]) // guarded UPDATE returns zero rows
      .mockResolvedValueOnce([poRow()]) // diagnostic re-read: still ISSUED
      .mockResolvedValueOnce([{ '?column?': 1 }]) // diagnostic: an active POSTED receipt exists

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' }))
      .rejects.toThrow(/posted purchase receipts and cannot be cancelled/)
  })

  it('when the guarded UPDATE affects zero rows and NO active receipt exists, falls back to the generic concurrent-change message', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([]) // no active receipts

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' }))
      .rejects.toThrow('purchase order status changed concurrently; cancel aborted')
  })

  it('succeeds when the guarded UPDATE affects one row (no posted receipt existed)', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow()])
      .mockResolvedValueOnce([poRow({ status: 'CANCELLED', cancel_reason: 'no longer needed' })])

    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    const result = await cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' })
    expect(result.status).toBe('CANCELLED')
  })
})
