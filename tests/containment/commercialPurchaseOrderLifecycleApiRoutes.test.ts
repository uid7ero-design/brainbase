import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C6.4 — behavioural tests for the five PO lifecycle routes,
// mirroring tests/containment/commercialPurchasingApiRoutes.test.ts's and
// commercialInvoiceApiRoutes.test.ts's own established convention:
// authorizeCommercialRequest and the five C6.2 domain lifecycle functions
// are mocked directly; route handlers are imported and invoked with
// synthetic Request objects. This isolates the ROUTE layer's own
// contract (capability/role floor per route, domain-error → HTTP status
// mapping) from the already-separately-tested domain layer itself
// (tests/containment/commercialPurchaseOrdersDomain.test.ts,
// tests/containment/commercialPurchaseOrderLifecycle.test.ts).

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const submitPurchaseOrderMock = vi.fn()
const approvePurchaseOrderMock = vi.fn()
const returnPurchaseOrderToDraftMock = vi.fn()
const issuePurchaseOrderMock = vi.fn()
const cancelPurchaseOrderMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({
  submitPurchaseOrder: (...a: unknown[]) => submitPurchaseOrderMock(...a),
  approvePurchaseOrder: (...a: unknown[]) => approvePurchaseOrderMock(...a),
  returnPurchaseOrderToDraft: (...a: unknown[]) => returnPurchaseOrderToDraftMock(...a),
  issuePurchaseOrder: (...a: unknown[]) => issuePurchaseOrderMock(...a),
  cancelPurchaseOrder: (...a: unknown[]) => cancelPurchaseOrderMock(...a),
}))

const { POST: submitPOST } = await import('@/app/api/commercial/purchase-orders/[id]/submit/route')
const { POST: approvePOST } = await import('@/app/api/commercial/purchase-orders/[id]/approve/route')
const { POST: returnPOST } = await import('@/app/api/commercial/purchase-orders/[id]/return/route')
const { POST: issuePOST } = await import('@/app/api/commercial/purchase-orders/[id]/issue/route')
const { POST: cancelPOST } = await import('@/app/api/commercial/purchase-orders/[id]/cancel/route')

const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }
const ADMIN_SESSION = { userId: 'user-3', organisationId: 'org-a', role: 'admin' }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }
const UNAUTHENTICATED = { ok: false as const, response: new Response(null, { status: 401 }) }

function jsonReq(body: unknown, url = 'http://localhost/x') {
  const req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function plainReq(url = 'http://localhost/x') {
  const req = new Request(url, { method: 'POST' })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function ctx(id = 'po-1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  submitPurchaseOrderMock.mockReset()
  approvePurchaseOrderMock.mockReset()
  returnPurchaseOrderToDraftMock.mockReset()
  issuePurchaseOrderMock.mockReset()
  cancelPurchaseOrderMock.mockReset()
})

// ── AUTH: capability/role floor per route ───────────────────────────────

describe('Phase C6.4 — every lifecycle route requests the documented capability/role floor', () => {
  it('submit requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await submitPOST(plainReq(), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('approve requests purchasing/admin (approve)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await approvePOST(plainReq(), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('return requests purchasing/admin (approve)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await returnPOST(jsonReq({ reason: 'x' }), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('issue requests purchasing/admin (approve)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await issuePOST(plainReq(), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('cancel requests purchasing/admin (approve)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('an unauthenticated (401) denial is returned as-is, and no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(UNAUTHENTICATED)
    const res = await submitPOST(plainReq(), ctx())
    expect(res.status).toBe(401)
    expect(submitPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('a capability/role (403) denial is returned as-is for every route, and no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    for (const [action, call] of [
      ['submit', () => submitPOST(plainReq(), ctx())],
      ['approve', () => approvePOST(plainReq(), ctx())],
      ['return', () => returnPOST(jsonReq({ reason: 'x' }), ctx())],
      ['issue', () => issuePOST(plainReq(), ctx())],
      ['cancel', () => cancelPOST(jsonReq({ reason: 'x' }), ctx())],
    ] as const) {
      const res = await call()
      expect(res.status, `${action} should 403`).toBe(403)
    }
    expect(submitPurchaseOrderMock).not.toHaveBeenCalled()
    expect(approvePurchaseOrderMock).not.toHaveBeenCalled()
    expect(returnPurchaseOrderToDraftMock).not.toHaveBeenCalled()
    expect(issuePurchaseOrderMock).not.toHaveBeenCalled()
    expect(cancelPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('a manager session is accepted by submit but denied by approve/return/issue/cancel at the authorize call site (the mock proves each route requests the admin floor, not that a manager session itself is rejected — that enforcement lives in authorizeCommercialRequest, covered by commercialAuthorize.test.ts)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    submitPurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'PENDING_APPROVAL' })
    const res = await submitPOST(plainReq(), ctx())
    expect(res.status).toBe(200)
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('an admin session can perform every approval-level action', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    approvePurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'APPROVED' })
    returnPurchaseOrderToDraftMock.mockResolvedValue({ id: 'po-1', status: 'DRAFT' })
    issuePurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'ISSUED', purchase_order_number: 'PO-000001' })
    cancelPurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'CANCELLED' })

    expect((await approvePOST(plainReq(), ctx())).status).toBe(200)
    expect((await returnPOST(jsonReq({ reason: 'needs changes' }), ctx())).status).toBe(200)
    expect((await issuePOST(plainReq(), ctx())).status).toBe(200)
    expect((await cancelPOST(jsonReq({ reason: 'no longer needed' }), ctx())).status).toBe(200)
  })
})

// ── TENANT: cross-org ID collapses to 404 for every route ──────────────

describe('Phase C6.4 — a cross-org (or missing) purchase order id 404s on every lifecycle route', () => {
  it('submit/approve/return/issue/cancel all map "purchase order not found for this organisation" to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    const notFound = new Error('purchase order not found for this organisation')
    submitPurchaseOrderMock.mockRejectedValue(notFound)
    approvePurchaseOrderMock.mockRejectedValue(notFound)
    returnPurchaseOrderToDraftMock.mockRejectedValue(notFound)
    issuePurchaseOrderMock.mockRejectedValue(notFound)
    cancelPurchaseOrderMock.mockRejectedValue(notFound)

    expect((await submitPOST(plainReq(), ctx('po-owned-by-org-b'))).status).toBe(404)
    expect((await approvePOST(plainReq(), ctx('po-owned-by-org-b'))).status).toBe(404)
    expect((await returnPOST(jsonReq({ reason: 'x' }), ctx('po-owned-by-org-b'))).status).toBe(404)
    expect((await issuePOST(plainReq(), ctx('po-owned-by-org-b'))).status).toBe(404)
    expect((await cancelPOST(jsonReq({ reason: 'x' }), ctx('po-owned-by-org-b'))).status).toBe(404)
  })
})

// ── LIFECYCLE: valid/invalid transitions ────────────────────────────────

describe('Phase C6.4 — lifecycle transition success and invalid-transition rejection', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION }) })

  it('DRAFT submit succeeds → 200 with the updated purchase order', async () => {
    submitPurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'PENDING_APPROVAL', purchase_order_number: null })
    const res = await submitPOST(plainReq(), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purchaseOrder.status).toBe('PENDING_APPROVAL')
  })

  it('submit from a non-DRAFT status fails 409 (assertPurchaseOrderTransition rejection)', async () => {
    submitPurchaseOrderMock.mockRejectedValue(new Error('Cannot transition purchase order from ISSUED to PENDING_APPROVAL'))
    const res = await submitPOST(plainReq(), ctx())
    expect(res.status).toBe(409)
  })

  it('PENDING_APPROVAL approve succeeds → 200', async () => {
    approvePurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'APPROVED' })
    const res = await approvePOST(plainReq(), ctx())
    expect(res.status).toBe(200)
  })

  it('approve from the wrong state fails 409', async () => {
    approvePurchaseOrderMock.mockRejectedValue(new Error('Cannot transition purchase order from DRAFT to APPROVED'))
    const res = await approvePOST(plainReq(), ctx())
    expect(res.status).toBe(409)
  })

  it('PENDING_APPROVAL return succeeds with a reason → 200', async () => {
    returnPurchaseOrderToDraftMock.mockResolvedValue({ id: 'po-1', status: 'DRAFT', return_reason: 'needs changes' })
    const res = await returnPOST(jsonReq({ reason: 'needs changes' }), ctx())
    expect(res.status).toBe(200)
    expect(returnPurchaseOrderToDraftMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'needs changes' }))
  })

  it('return with a missing/empty reason fails 400 and never calls the domain', async () => {
    const res = await returnPOST(jsonReq({ reason: '   ' }), ctx())
    expect(res.status).toBe(400)
    expect(returnPurchaseOrderToDraftMock).not.toHaveBeenCalled()
  })

  it('APPROVED issue succeeds → 200', async () => {
    issuePurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'ISSUED', purchase_order_number: 'PO-000042' })
    const res = await issuePOST(plainReq(), ctx())
    expect(res.status).toBe(200)
  })

  it('issue from the wrong state fails 409', async () => {
    issuePurchaseOrderMock.mockRejectedValue(new Error('Cannot transition purchase order from DRAFT to ISSUED'))
    const res = await issuePOST(plainReq(), ctx())
    expect(res.status).toBe(409)
  })

  it('ISSUED cancel succeeds with a reason → 200', async () => {
    cancelPurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'CANCELLED', cancel_reason: 'no longer needed' })
    const res = await cancelPOST(jsonReq({ reason: 'no longer needed' }), ctx())
    expect(res.status).toBe(200)
    expect(cancelPurchaseOrderMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no longer needed' }))
  })

  it('cancel with a missing/empty reason fails 400 and never calls the domain', async () => {
    const res = await cancelPOST(jsonReq({ reason: '' }), ctx())
    expect(res.status).toBe(400)
    expect(cancelPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('cancel from the wrong state fails 409', async () => {
    cancelPurchaseOrderMock.mockRejectedValue(new Error('Cannot transition purchase order from APPROVED to CANCELLED'))
    const res = await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(res.status).toBe(409)
  })

  it('CANCELLED is terminal — a second cancel attempt fails 409, not 200', async () => {
    cancelPurchaseOrderMock.mockRejectedValue(new Error('Cannot transition purchase order from CANCELLED to CANCELLED'))
    const res = await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(res.status).toBe(409)
  })
})

// ── NUMBERING ────────────────────────────────────────────────────────────

describe('Phase C6.4 — numbering: no number before issue, PO- number only from issue, retained after cancel', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION }) })

  it('submit result carries no purchase_order_number', async () => {
    submitPurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'PENDING_APPROVAL', purchase_order_number: null })
    const res = await submitPOST(plainReq(), ctx())
    const body = await res.json()
    expect(body.purchaseOrder.purchase_order_number).toBeNull()
  })

  it('approve result carries no purchase_order_number', async () => {
    approvePurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'APPROVED', purchase_order_number: null })
    const res = await approvePOST(plainReq(), ctx())
    const body = await res.json()
    expect(body.purchaseOrder.purchase_order_number).toBeNull()
  })

  it('issue returns a PO- prefixed number verbatim from the domain layer — the route allocates nothing itself', async () => {
    issuePurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'ISSUED', purchase_order_number: 'PO-000042' })
    const res = await issuePOST(plainReq(), ctx())
    const body = await res.json()
    expect(body.purchaseOrder.purchase_order_number).toBe('PO-000042')
  })

  it('the number survives cancellation — cancel result still carries the same purchase_order_number', async () => {
    cancelPurchaseOrderMock.mockResolvedValue({ id: 'po-1', status: 'CANCELLED', purchase_order_number: 'PO-000042', cancel_reason: 'x' })
    const res = await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    const body = await res.json()
    expect(body.purchaseOrder.purchase_order_number).toBe('PO-000042')
  })

  it('a second issue attempt on an already-ISSUED PO fails 409, never allocating a second number — the route never retries or synthesizes its own number on failure', async () => {
    issuePurchaseOrderMock.mockRejectedValue(new Error('purchase order status changed concurrently; issue aborted (the atomic guard prevented any number from being consumed)'))
    const res = await issuePOST(plainReq(), ctx())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.purchaseOrder).toBeUndefined()
  })
})

// ── AUDIT: no route-level duplicate logging ─────────────────────────────

describe('Phase C6.4 — no lifecycle route performs its own duplicate audit logging', () => {
  const ROUTE_FILES = [
    'app/api/commercial/purchase-orders/[id]/submit/route.ts',
    'app/api/commercial/purchase-orders/[id]/approve/route.ts',
    'app/api/commercial/purchase-orders/[id]/return/route.ts',
    'app/api/commercial/purchase-orders/[id]/issue/route.ts',
    'app/api/commercial/purchase-orders/[id]/cancel/route.ts',
  ]

  it('none of the five route files import lib/commercial/auditLog or call insertAuditLog/logPurchaseOrder* directly — every audit event is emitted exclusively by the domain layer', () => {
    for (const relPath of ROUTE_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
      expect(source, `${relPath} must not import auditLog`).not.toMatch(/from ['"]@\/lib\/commercial\/auditLog['"]/)
      expect(source, `${relPath} must not call insertAuditLog`).not.toMatch(/insertAuditLog/)
      expect(source, `${relPath} must not call a logPurchaseOrder* helper directly`).not.toMatch(/logPurchaseOrder\w+\(/)
    }
  })
})

// ── C6.4 scope discipline: routes call only the five lifecycle domain
// functions, never raw SQL, never a second lifecycle engine ────────────

describe('Phase C6.4 — routes call the domain functions only, never raw SQL', () => {
  const ROUTE_FILES = [
    'app/api/commercial/purchase-orders/[id]/submit/route.ts',
    'app/api/commercial/purchase-orders/[id]/approve/route.ts',
    'app/api/commercial/purchase-orders/[id]/return/route.ts',
    'app/api/commercial/purchase-orders/[id]/issue/route.ts',
    'app/api/commercial/purchase-orders/[id]/cancel/route.ts',
  ]

  it('none of the five route files import @/lib/db or reference a `sql` tagged template', () => {
    for (const relPath of ROUTE_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
      expect(source, `${relPath} must not import lib/db`).not.toMatch(/from ['"]@\/lib\/db['"]/)
      expect(source, `${relPath} must not use a raw sql\`...\` template`).not.toMatch(/\bsql`/)
    }
  })
})

// ── CLIENT/SERVER: the PO detail page (now importing lifecycle action
// handlers) still never imports a server-only Purchasing module ───────

describe('Phase C6.4 — the PO detail page remains free of server-only Purchasing imports', () => {
  it('app/commercial/purchasing/purchase-orders/[id]/page.tsx does not import lib/db, suppliers.ts, or purchaseOrders.ts', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/commercial/purchasing/purchase-orders/[id]/page.tsx'),
      'utf-8',
    )
    expect(source).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(source).not.toMatch(/from ['"]@\/lib\/commercial\/suppliers['"]/)
    expect(source).not.toMatch(/from ['"]@\/lib\/commercial\/purchaseOrders['"]/)
  })
})
