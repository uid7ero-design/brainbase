import { describe, it, expect, vi } from 'vitest'

// Phase C7.3 — the PO cancel route (app/api/commercial/purchase-orders/
// [id]/cancel/route.ts) must map cancelPurchaseOrder()'s new "posted
// purchase receipts" rejection to 409 (a real conflict), not fall through
// to the route's generic 400 default. Split into its own file (rather
// than living alongside commercialPurchaseOrderReceiptGuard.test.ts)
// because vi.mock('@/lib/commercial/purchaseOrders') is hoisted to the
// top of the module and would otherwise replace the REAL
// cancelPurchaseOrder that file's other, domain-level tests depend on.

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

describe('Phase C7.3 — the PO cancel route maps the "posted purchase receipts" error to 409, not a generic 400', () => {
  it('maps the posted-receipts rejection to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: { userId: 'u1', organisationId: 'org-a', role: 'admin' } })
    cancelPurchaseOrderMock.mockRejectedValue(new Error('This purchase order has one or more posted purchase receipts and cannot be cancelled. Cancel the receipt(s) first.'))

    const res = await POST(jsonReq({ reason: 'no longer needed' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/posted purchase receipts/)
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
