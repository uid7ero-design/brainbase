import { describe, it, expect, vi } from 'vitest'

// Phase C7.4 — the PO cancel route (app/api/commercial/purchase-orders/
// [id]/cancel/route.ts) must map cancelPurchaseOrder()'s new "posted
// supplier bills" rejection to 409, exactly like the existing "posted
// purchase receipts" mapping. Split into its own file — mirroring
// tests/containment/commercialPurchaseOrderCancelRouteReceiptMapping
// .test.ts's own reasoning — because vi.mock('@/lib/commercial/
// purchaseOrders') is hoisted to the top of the module and would
// otherwise replace the REAL cancelPurchaseOrder that the sibling guard
// test file's domain-level tests depend on.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})
const cancelPurchaseOrderMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({ cancelPurchaseOrder: (...a: unknown[]) => cancelPurchaseOrderMock(...a) }))

const { POST } = await import('@/app/api/commercial/purchase-orders/[id]/cancel/route')

function jsonReq(body: unknown) {
  const req = new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}

describe('Phase C7.4 — the PO cancel route maps the "posted supplier bills" error to 409, not a generic 400', () => {
  it('maps the posted-bills rejection to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: { userId: 'u1', organisationId: 'org-a', role: 'admin' } })
    cancelPurchaseOrderMock.mockRejectedValue(new Error('This purchase order has one or more posted supplier bills and cannot be cancelled. Cancel the bill(s) first.'))

    const res = await POST(jsonReq({ reason: 'no longer needed' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/posted supplier bills/)
  })

  it('still maps the pre-existing "posted purchase receipts" rejection to 409 (regression guard: this addition did not weaken the C7.3 mapping)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: { userId: 'u1', organisationId: 'org-a', role: 'admin' } })
    cancelPurchaseOrderMock.mockRejectedValue(new Error('This purchase order has one or more posted purchase receipts and cannot be cancelled. Cancel the receipt(s) first.'))
    const res = await POST(jsonReq({ reason: 'x' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(409)
  })

  it('still maps the ordinary concurrent-change message to 409 (regression guard on the existing mapping)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: { userId: 'u1', organisationId: 'org-a', role: 'admin' } })
    cancelPurchaseOrderMock.mockRejectedValue(new Error('purchase order status changed concurrently; cancel aborted'))
    const res = await POST(jsonReq({ reason: 'x' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(409)
  })

  it('an unrelated validation error still maps to 400', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: { userId: 'u1', organisationId: 'org-a', role: 'admin' } })
    cancelPurchaseOrderMock.mockRejectedValue(new Error('cancel_reason is required'))
    const res = await POST(jsonReq({ reason: 'x' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
  })
})
