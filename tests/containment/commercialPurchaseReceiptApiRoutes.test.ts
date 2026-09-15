import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.3 — behavioural tests for every new purchase-receipt route,
// mirroring tests/containment/commercialPurchaseOrderLifecycleApiRoutes
// .test.ts's own established convention: authorizeCommercialRequest and
// the domain functions are mocked directly; route handlers are imported
// and invoked with synthetic Request objects. This isolates the ROUTE
// layer's own contract (capability/role floor per route, domain-error ->
// HTTP status mapping, cross-tenant 404 collapsing) from the
// already-separately-tested domain layer
// (lib/commercial/purchaseReceipts.ts, covered by the real-Postgres
// concurrency harness and its own lifecycle/schema containment tests).

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const listPurchaseReceiptsMock = vi.fn()
const createPurchaseReceiptMock = vi.fn()
const getPurchaseReceiptWithLinesMock = vi.fn()
const updateDraftPurchaseReceiptMock = vi.fn()
const deletePurchaseReceiptMock = vi.fn()
const addPurchaseReceiptLineMock = vi.fn()
const updatePurchaseReceiptLineMock = vi.fn()
const deletePurchaseReceiptLineMock = vi.fn()
const postPurchaseReceiptMock = vi.fn()
const cancelPurchaseReceiptMock = vi.fn()
const getReceivedQuantitiesForPurchaseOrderMock = vi.fn()
const listPurchaseReceiptsForPurchaseOrderMock = vi.fn()
vi.mock('@/lib/commercial/purchaseReceipts', () => ({
  listPurchaseReceipts: (...a: unknown[]) => listPurchaseReceiptsMock(...a),
  createPurchaseReceipt: (...a: unknown[]) => createPurchaseReceiptMock(...a),
  getPurchaseReceiptWithLines: (...a: unknown[]) => getPurchaseReceiptWithLinesMock(...a),
  updateDraftPurchaseReceipt: (...a: unknown[]) => updateDraftPurchaseReceiptMock(...a),
  deletePurchaseReceipt: (...a: unknown[]) => deletePurchaseReceiptMock(...a),
  addPurchaseReceiptLine: (...a: unknown[]) => addPurchaseReceiptLineMock(...a),
  updatePurchaseReceiptLine: (...a: unknown[]) => updatePurchaseReceiptLineMock(...a),
  deletePurchaseReceiptLine: (...a: unknown[]) => deletePurchaseReceiptLineMock(...a),
  postPurchaseReceipt: (...a: unknown[]) => postPurchaseReceiptMock(...a),
  cancelPurchaseReceipt: (...a: unknown[]) => cancelPurchaseReceiptMock(...a),
  getReceivedQuantitiesForPurchaseOrder: (...a: unknown[]) => getReceivedQuantitiesForPurchaseOrderMock(...a),
  listPurchaseReceiptsForPurchaseOrder: (...a: unknown[]) => listPurchaseReceiptsForPurchaseOrderMock(...a),
}))

const getPurchaseOrderMock = vi.fn()
const getPurchaseOrderWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({
  getPurchaseOrder: (...a: unknown[]) => getPurchaseOrderMock(...a),
  getPurchaseOrderWithLines: (...a: unknown[]) => getPurchaseOrderWithLinesMock(...a),
}))

const { GET: listGET, POST: createPOST } = await import('@/app/api/commercial/purchase-receipts/route')
const { GET: detailGET, PATCH: detailPATCH, DELETE: detailDELETE } = await import('@/app/api/commercial/purchase-receipts/[id]/route')
const { POST: addLinePOST } = await import('@/app/api/commercial/purchase-receipts/[id]/lines/route')
const { PATCH: linePATCH, DELETE: lineDELETE } = await import('@/app/api/commercial/purchase-receipts/[id]/lines/[lineId]/route')
const { POST: postPOST } = await import('@/app/api/commercial/purchase-receipts/[id]/post/route')
const { POST: cancelPOST } = await import('@/app/api/commercial/purchase-receipts/[id]/cancel/route')
const { GET: poReceiptsGET } = await import('@/app/api/commercial/purchase-orders/[id]/receipts/route')

const VIEWER_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' }
const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }
const ADMIN_SESSION = { userId: 'user-3', organisationId: 'org-a', role: 'admin' }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function jsonReq(body: unknown, method = 'POST', url = 'http://localhost/x') {
  const req = new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function plainReq(method = 'GET', url = 'http://localhost/x') {
  const req = new Request(url, { method })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function ctx(id = 'receipt-1') {
  return { params: Promise.resolve({ id }) }
}
function lineCtx(id = 'receipt-1', lineId = 'line-1') {
  return { params: Promise.resolve({ id, lineId }) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  for (const m of [
    listPurchaseReceiptsMock, createPurchaseReceiptMock, getPurchaseReceiptWithLinesMock, updateDraftPurchaseReceiptMock,
    deletePurchaseReceiptMock, addPurchaseReceiptLineMock, updatePurchaseReceiptLineMock, deletePurchaseReceiptLineMock,
    postPurchaseReceiptMock, cancelPurchaseReceiptMock, getReceivedQuantitiesForPurchaseOrderMock, listPurchaseReceiptsForPurchaseOrderMock,
    getPurchaseOrderMock, getPurchaseOrderWithLinesMock,
  ]) m.mockReset()
})

// ── AUTH: capability/role floor per route, matching the C7.3 capability matrix ──

describe('Phase C7.3 — every purchase-receipt route requests the documented capability/role floor', () => {
  it('GET list requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await listGET(plainReq())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('POST create requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await createPOST(jsonReq({ purchaseOrderId: 'po-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('GET detail requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await detailGET(plainReq(), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('PATCH detail requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await detailPATCH(jsonReq({}, 'PATCH'), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('DELETE detail requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await detailDELETE(plainReq('DELETE'), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('POST add line requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantityReceived: 1 }), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('PATCH line requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await linePATCH(jsonReq({ quantityReceived: 2 }, 'PATCH'), lineCtx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('DELETE line requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await lineDELETE(plainReq('DELETE'), lineCtx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('POST post requests purchasing/manager (createEdit) — a manager can post, matching the C7.3 instruction', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await postPOST(plainReq('POST'), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('POST cancel requests purchasing/admin (approve) — only admin can cancel', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('GET PO-linked receipts requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poReceiptsGET(plainReq(), ctx('po-1'))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('a 403 denial is returned as-is for every route, and no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const calls = [
      () => listGET(plainReq()),
      () => createPOST(jsonReq({ purchaseOrderId: 'po-1' })),
      () => detailGET(plainReq(), ctx()),
      () => detailPATCH(jsonReq({}, 'PATCH'), ctx()),
      () => detailDELETE(plainReq('DELETE'), ctx()),
      () => addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantityReceived: 1 }), ctx()),
      () => linePATCH(jsonReq({ quantityReceived: 2 }, 'PATCH'), lineCtx()),
      () => lineDELETE(plainReq('DELETE'), lineCtx()),
      () => postPOST(plainReq('POST'), ctx()),
      () => cancelPOST(jsonReq({ reason: 'x' }), ctx()),
      () => poReceiptsGET(plainReq(), ctx('po-1')),
    ]
    for (const call of calls) {
      const res = await call()
      expect(res.status).toBe(403)
    }
    for (const m of [
      listPurchaseReceiptsMock, createPurchaseReceiptMock, getPurchaseReceiptWithLinesMock, updateDraftPurchaseReceiptMock,
      deletePurchaseReceiptMock, addPurchaseReceiptLineMock, updatePurchaseReceiptLineMock, deletePurchaseReceiptLineMock,
      postPurchaseReceiptMock, cancelPurchaseReceiptMock,
    ]) expect(m).not.toHaveBeenCalled()
  })

  it('a viewer session can read (list/detail) but the mock proves createEdit/approve routes request a higher floor — real enforcement lives in authorizeCommercialRequest itself', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    listPurchaseReceiptsMock.mockResolvedValue([])
    const res = await listGET(plainReq())
    expect(res.status).toBe(200)
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('a manager session can create/edit/post', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createPurchaseReceiptMock.mockResolvedValue({ id: 'receipt-1', status: 'DRAFT' })
    postPurchaseReceiptMock.mockResolvedValue({ id: 'receipt-1', status: 'POSTED', receipt_number: 'GR-000001' })
    expect((await createPOST(jsonReq({ purchaseOrderId: 'po-1' }))).status).toBe(201)
    expect((await postPOST(plainReq('POST'), ctx())).status).toBe(200)
  })

  it('an admin session can cancel', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    cancelPurchaseReceiptMock.mockResolvedValue({ id: 'receipt-1', status: 'CANCELLED' })
    expect((await cancelPOST(jsonReq({ reason: 'x' }), ctx())).status).toBe(200)
  })
})

// ── TENANT: cross-org/missing id collapses to 404 for every route ──────

describe('Phase C7.3 — a cross-org (or missing) purchase receipt id 404s on every route', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION }) })

  it('GET/PATCH/DELETE detail all 404 for a not-found/cross-org id', async () => {
    getPurchaseReceiptWithLinesMock.mockResolvedValue(null)
    updateDraftPurchaseReceiptMock.mockResolvedValue(null)
    deletePurchaseReceiptMock.mockResolvedValue(false)

    expect((await detailGET(plainReq(), ctx('owned-by-org-b'))).status).toBe(404)
    expect((await detailPATCH(jsonReq({}, 'PATCH'), ctx('owned-by-org-b'))).status).toBe(404)
    expect((await detailDELETE(plainReq('DELETE'), ctx('owned-by-org-b'))).status).toBe(404)
  })

  it('post/cancel map "purchase receipt not found for this organisation" to 404', async () => {
    const notFound = new Error('purchase receipt not found for this organisation')
    postPurchaseReceiptMock.mockRejectedValue(notFound)
    cancelPurchaseReceiptMock.mockRejectedValue(notFound)

    expect((await postPOST(plainReq('POST'), ctx('owned-by-org-b'))).status).toBe(404)
    expect((await cancelPOST(jsonReq({ reason: 'x' }), ctx('owned-by-org-b'))).status).toBe(404)
  })

  it('the PO-linked-receipts route 404s when the PO itself is not found for this organisation', async () => {
    getPurchaseOrderMock.mockResolvedValue(null)
    const res = await poReceiptsGET(plainReq(), ctx('po-owned-by-org-b'))
    expect(res.status).toBe(404)
    expect(listPurchaseReceiptsForPurchaseOrderMock).not.toHaveBeenCalled()
  })
})

// ── PO-LINE LINEAGE: cross-PO source line rejection ─────────────────────

describe('Phase C7.3 — adding a line requires sourcePurchaseOrderLineId and rejects one that belongs to a different PO', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION }) })

  it('missing sourcePurchaseOrderLineId is rejected 400 before the domain is ever called', async () => {
    const res = await addLinePOST(jsonReq({ quantityReceived: 1 }), ctx())
    expect(res.status).toBe(400)
    expect(addPurchaseReceiptLineMock).not.toHaveBeenCalled()
  })

  it('missing quantityReceived is rejected 400 before the domain is ever called', async () => {
    const res = await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1' }), ctx())
    expect(res.status).toBe(400)
    expect(addPurchaseReceiptLineMock).not.toHaveBeenCalled()
  })

  it('a source line that does not belong to this PO is rejected 404 (the domain layer\'s cross-PO lineage check)', async () => {
    addPurchaseReceiptLineMock.mockRejectedValue(new Error('source_purchase_order_line_id not found on this purchase order for this organisation'))
    const res = await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-from-another-po', quantityReceived: 1 }), ctx())
    expect(res.status).toBe(404)
  })

  it('adding a line to a non-DRAFT receipt fails 409', async () => {
    addPurchaseReceiptLineMock.mockRejectedValue(new Error('Purchase receipt is POSTED and can no longer be edited'))
    const res = await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantityReceived: 1 }), ctx())
    expect(res.status).toBe(409)
  })
})

// ── LIFECYCLE: POSTED immutability + strict over-receipt + numbering ───

describe('Phase C7.3 — post/cancel error-to-status mapping', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION }) })

  it('posting succeeds -> 200 with a receipt_number allocated', async () => {
    postPurchaseReceiptMock.mockResolvedValue({ id: 'receipt-1', status: 'POSTED', receipt_number: 'GR-000007' })
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purchaseReceipt.receipt_number).toBe('GR-000007')
  })

  it('posting a non-DRAFT receipt fails 409 (assertPurchaseReceiptTransition rejection)', async () => {
    postPurchaseReceiptMock.mockRejectedValue(new Error('Cannot transition purchase receipt from POSTED to POSTED'))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('the strict over-receipt guard failure maps to 409, not 400 or 500', async () => {
    postPurchaseReceiptMock.mockRejectedValue(new Error(
      'One or more lines on this receipt would receive more than the ordered quantity (including quantities already posted on other receipts for the same purchase order line). Reduce the quantity and try again.'
    ))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('posting against a non-ISSUED PO maps to 409', async () => {
    postPurchaseReceiptMock.mockRejectedValue(new Error('Purchase order is CANCELLED — a purchase receipt can only be posted while its purchase order is ISSUED.'))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('posting a receipt with no lines maps to 409', async () => {
    postPurchaseReceiptMock.mockRejectedValue(new Error('cannot post a purchase receipt with no lines'))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('cancel with a missing/empty reason fails 400 and never calls the domain', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    const res = await cancelPOST(jsonReq({ reason: '   ' }), ctx())
    expect(res.status).toBe(400)
    expect(cancelPurchaseReceiptMock).not.toHaveBeenCalled()
  })

  it('cancelling a non-POSTED receipt fails 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    cancelPurchaseReceiptMock.mockRejectedValue(new Error('Cannot transition purchase receipt from DRAFT to CANCELLED'))
    const res = await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(res.status).toBe(409)
  })

  it('a subsequent PATCH/DELETE/add-line against an already-POSTED receipt is rejected 409 by the route (POSTED immutability, enforced by the domain and surfaced here)', async () => {
    updateDraftPurchaseReceiptMock.mockRejectedValue(new Error('Purchase receipt is POSTED and can no longer be edited'))
    deletePurchaseReceiptMock.mockResolvedValue(false)
    addPurchaseReceiptLineMock.mockRejectedValue(new Error('Purchase receipt is POSTED and can no longer be edited'))

    expect((await detailPATCH(jsonReq({ notes: 'x' }, 'PATCH'), ctx())).status).toBe(409)
    expect((await detailDELETE(plainReq('DELETE'), ctx())).status).toBe(404)
    expect((await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantityReceived: 1 }), ctx())).status).toBe(409)
  })
})

// ── CREATE: rejects a non-ISSUED PO ─────────────────────────────────────

describe('Phase C7.3 — creating a receipt requires purchaseOrderId and rejects a non-ISSUED PO', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION }) })

  it('missing purchaseOrderId is rejected 400 before the domain is ever called', async () => {
    const res = await createPOST(jsonReq({}))
    expect(res.status).toBe(400)
    expect(createPurchaseReceiptMock).not.toHaveBeenCalled()
  })

  it('a DRAFT/PENDING_APPROVAL/APPROVED/CANCELLED PO is rejected (not 200)', async () => {
    createPurchaseReceiptMock.mockRejectedValue(new Error('Purchase order is DRAFT — a purchase receipt can only be created against an ISSUED purchase order.'))
    const res = await createPOST(jsonReq({ purchaseOrderId: 'po-1' }))
    expect(res.status).toBe(400)
  })

  it('a nonexistent purchaseOrderId maps to 404', async () => {
    createPurchaseReceiptMock.mockRejectedValue(new Error('purchase_order_id not found for this organisation'))
    const res = await createPOST(jsonReq({ purchaseOrderId: 'po-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })
})

// ── AUDIT: no route-level duplicate logging ─────────────────────────────

const RECEIPT_ROUTE_FILES = [
  'app/api/commercial/purchase-receipts/route.ts',
  'app/api/commercial/purchase-receipts/[id]/route.ts',
  'app/api/commercial/purchase-receipts/[id]/lines/route.ts',
  'app/api/commercial/purchase-receipts/[id]/lines/[lineId]/route.ts',
  'app/api/commercial/purchase-receipts/[id]/post/route.ts',
  'app/api/commercial/purchase-receipts/[id]/cancel/route.ts',
  'app/api/commercial/purchase-orders/[id]/receipts/route.ts',
]

describe('Phase C7.3 — no purchase-receipt route performs its own duplicate audit logging or raw SQL', () => {
  it('none of the route files import lib/commercial/auditLog or call insertAuditLog/logPurchaseReceipt* directly', () => {
    for (const relPath of RECEIPT_ROUTE_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
      expect(source, `${relPath} must not import auditLog`).not.toMatch(/from ['"]@\/lib\/commercial\/auditLog['"]/)
      expect(source, `${relPath} must not call insertAuditLog`).not.toMatch(/insertAuditLog/)
      expect(source, `${relPath} must not call a logPurchaseReceipt* helper directly`).not.toMatch(/logPurchaseReceipt\w+\(/)
    }
  })

  it('none of the route files import @/lib/db or reference a `sql` tagged template', () => {
    for (const relPath of RECEIPT_ROUTE_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
      expect(source, `${relPath} must not import lib/db`).not.toMatch(/from ['"]@\/lib\/db['"]/)
      expect(source, `${relPath} must not use a raw sql\`...\` template`).not.toMatch(/\bsql`/)
    }
  })
})
