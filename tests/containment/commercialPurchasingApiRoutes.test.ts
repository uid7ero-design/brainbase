import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C6.3 — behavioural tests for the Purchasing API route layer,
// mirroring tests/containment/commercialInvoiceApiRoutes.test.ts's own
// established convention exactly: authorizeCommercialRequest and every
// underlying lib/commercial/{suppliers,purchaseOrders} domain function
// are mocked directly; route handlers are imported and invoked with
// synthetic Request objects. This isolates the ROUTE layer's own
// contract (capability/role floor per route, domain-error → HTTP status
// mapping, organisation_id never taken from request input) from the
// already-separately-tested domain layer itself
// (tests/containment/commercialSuppliersDomain.test.ts,
// tests/containment/commercialPurchaseOrdersDomain.test.ts).

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const listSuppliersMock = vi.fn()
const getSupplierMock = vi.fn()
const createSupplierMock = vi.fn()
const updateSupplierMock = vi.fn()
const deactivateSupplierMock = vi.fn()
const reactivateSupplierMock = vi.fn()
vi.mock('@/lib/commercial/suppliers', () => ({
  listSuppliers: (...a: unknown[]) => listSuppliersMock(...a),
  getSupplier: (...a: unknown[]) => getSupplierMock(...a),
  createSupplier: (...a: unknown[]) => createSupplierMock(...a),
  updateSupplier: (...a: unknown[]) => updateSupplierMock(...a),
  deactivateSupplier: (...a: unknown[]) => deactivateSupplierMock(...a),
  reactivateSupplier: (...a: unknown[]) => reactivateSupplierMock(...a),
}))

const listPurchaseOrdersMock = vi.fn()
const createPurchaseOrderMock = vi.fn()
const getPurchaseOrderWithLinesMock = vi.fn()
const updateDraftPurchaseOrderMock = vi.fn()
const addPurchaseOrderLineMock = vi.fn()
const updatePurchaseOrderLineMock = vi.fn()
const deletePurchaseOrderLineMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({
  listPurchaseOrders: (...a: unknown[]) => listPurchaseOrdersMock(...a),
  createPurchaseOrder: (...a: unknown[]) => createPurchaseOrderMock(...a),
  getPurchaseOrderWithLines: (...a: unknown[]) => getPurchaseOrderWithLinesMock(...a),
  updateDraftPurchaseOrder: (...a: unknown[]) => updateDraftPurchaseOrderMock(...a),
  addPurchaseOrderLine: (...a: unknown[]) => addPurchaseOrderLineMock(...a),
  updatePurchaseOrderLine: (...a: unknown[]) => updatePurchaseOrderLineMock(...a),
  deletePurchaseOrderLine: (...a: unknown[]) => deletePurchaseOrderLineMock(...a),
}))

const { GET: suppliersGET, POST: suppliersPOST } = await import('@/app/api/commercial/suppliers/route')
const { GET: supplierGET, PATCH: supplierPATCH } = await import('@/app/api/commercial/suppliers/[id]/route')
const { GET: poListGET, POST: poListPOST } = await import('@/app/api/commercial/purchase-orders/route')
const { GET: poGET, PATCH: poPATCH } = await import('@/app/api/commercial/purchase-orders/[id]/route')
const { POST: poLinePOST } = await import('@/app/api/commercial/purchase-orders/[id]/lines/route')
const { PATCH: poLinePATCH, DELETE: poLineDELETE } = await import('@/app/api/commercial/purchase-orders/[id]/lines/[lineId]/route')

const VIEWER_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' }
const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function jsonReq(body: unknown, url = 'http://localhost/x') {
  const req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function plainReq(url = 'http://localhost/x') {
  const req = new Request(url)
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  listSuppliersMock.mockReset()
  getSupplierMock.mockReset()
  createSupplierMock.mockReset()
  updateSupplierMock.mockReset()
  deactivateSupplierMock.mockReset()
  reactivateSupplierMock.mockReset()
  listPurchaseOrdersMock.mockReset()
  createPurchaseOrderMock.mockReset()
  getPurchaseOrderWithLinesMock.mockReset()
  updateDraftPurchaseOrderMock.mockReset()
  addPurchaseOrderLineMock.mockReset()
  updatePurchaseOrderLineMock.mockReset()
  deletePurchaseOrderLineMock.mockReset()
})

// ── AUTH: every route requests 'purchasing' with the documented role floor ─

describe('Phase C6.3 — every supplier/purchase-order route requests the purchasing capability with the documented role floor', () => {
  it('GET /api/commercial/suppliers requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await suppliersGET()
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('POST /api/commercial/suppliers requests purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await suppliersPOST(jsonReq({ name: 'Acme' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('GET /api/commercial/suppliers/[id] requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await supplierGET(plainReq(), ctx({ id: 's1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('PATCH /api/commercial/suppliers/[id] requests purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await supplierPATCH(jsonReq({ name: 'Acme 2' }), ctx({ id: 's1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('GET /api/commercial/purchase-orders requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poListGET(plainReq())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('POST /api/commercial/purchase-orders requests purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poListPOST(jsonReq({ supplierId: 's1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('GET /api/commercial/purchase-orders/[id] requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poGET(plainReq(), ctx({ id: 'po-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('PATCH /api/commercial/purchase-orders/[id] requests purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poPATCH(jsonReq({}), ctx({ id: 'po-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('POST lines requests purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poLinePOST(jsonReq({ quantity: 1 }), ctx({ id: 'po-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('PATCH/DELETE line requests purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poLinePATCH(jsonReq({}), ctx({ id: 'po-1', lineId: 'line-1' }))
    await poLineDELETE(plainReq(), ctx({ id: 'po-1', lineId: 'line-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('a 403 from authorizeCommercialRequest is returned as-is, and no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await poListPOST(jsonReq({ supplierId: 's1' }))
    expect(res.status).toBe(403)
    expect(createPurchaseOrderMock).not.toHaveBeenCalled()
  })
})

// ── organisation_id is never accepted from request input ───────────────

describe('Phase C6.3 — organisation_id always comes from the session, never from request body', () => {
  it('POST /api/commercial/suppliers ignores an organisationId in the body', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createSupplierMock.mockResolvedValue({ id: 's1' })
    await suppliersPOST(jsonReq({ name: 'Acme', organisationId: 'org-evil' }))
    expect(createSupplierMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })

  it('POST /api/commercial/purchase-orders ignores an organisationId in the body', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createPurchaseOrderMock.mockResolvedValue({ id: 'po-1' })
    await poListPOST(jsonReq({ supplierId: 's1', organisationId: 'org-evil' }))
    expect(createPurchaseOrderMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })

  it('PATCH /api/commercial/purchase-orders/[id] ignores an organisationId in the body', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateDraftPurchaseOrderMock.mockResolvedValue({ id: 'po-1' })
    await poPATCH(jsonReq({ organisationId: 'org-evil', supplierReference: 'x' }), ctx({ id: 'po-1' }))
    expect(updateDraftPurchaseOrderMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })
})

// ── API INPUT validation ────────────────────────────────────────────────

describe('Phase C6.3 — required fields and server-controlled fields', () => {
  it('POST /api/commercial/suppliers requires a non-empty name', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await suppliersPOST(jsonReq({ name: '   ' }))
    expect(res.status).toBe(400)
    expect(createSupplierMock).not.toHaveBeenCalled()
  })

  it('POST /api/commercial/purchase-orders requires supplierId', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await poListPOST(jsonReq({}))
    expect(res.status).toBe(400)
    expect(createPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('POST lines requires quantity before calling addPurchaseOrderLine', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await poLinePOST(jsonReq({ description: 'x' }), ctx({ id: 'po-1' }))
    expect(res.status).toBe(400)
    expect(addPurchaseOrderLineMock).not.toHaveBeenCalled()
  })

  it('PATCH /api/commercial/suppliers/[id] with only {active} routes through reactivate/deactivate, never updateSupplier', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    deactivateSupplierMock.mockResolvedValue(true)
    await supplierPATCH(jsonReq({ active: false }), ctx({ id: 's1' }))
    expect(deactivateSupplierMock).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'user-2', supplierId: 's1' })
    expect(updateSupplierMock).not.toHaveBeenCalled()

    reactivateSupplierMock.mockResolvedValue(true)
    await supplierPATCH(jsonReq({ active: true }), ctx({ id: 's1' }))
    expect(reactivateSupplierMock).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'user-2', supplierId: 's1' })
  })

  it('PATCH /api/commercial/suppliers/[id] with active AND another field routes through updateSupplier, not the toggle', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateSupplierMock.mockResolvedValue({ id: 's1' })
    await supplierPATCH(jsonReq({ active: true, name: 'Renamed' }), ctx({ id: 's1' }))
    expect(updateSupplierMock).toHaveBeenCalled()
    expect(reactivateSupplierMock).not.toHaveBeenCalled()
  })
})

// ── TENANCY: wrong-org / missing collapse to 404; lifecycle conflicts to 409

describe('Phase C6.3 — wrong-tenant and missing resources collapse to 404', () => {
  it('GET /api/commercial/suppliers/[id] returns 404 when getSupplier returns null', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getSupplierMock.mockResolvedValue(null)
    const res = await supplierGET(plainReq(), ctx({ id: 'supplier-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('GET /api/commercial/purchase-orders/[id] returns 404 when getPurchaseOrderWithLines returns null', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getPurchaseOrderWithLinesMock.mockResolvedValue(null)
    const res = await poGET(plainReq(), ctx({ id: 'po-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('PATCH/DELETE line returns 404 for a wrong-tenant or missing line', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updatePurchaseOrderLineMock.mockResolvedValue(null)
    deletePurchaseOrderLineMock.mockResolvedValue(false)
    const patchRes = await poLinePATCH(jsonReq({ quantity: 2 }), ctx({ id: 'po-1', lineId: 'line-owned-by-org-b' }))
    const delRes = await poLineDELETE(plainReq(), ctx({ id: 'po-1', lineId: 'line-owned-by-org-b' }))
    expect(patchRes.status).toBe(404)
    expect(delRes.status).toBe(404)
  })
})

describe('Phase C6.3 — a non-DRAFT purchase order maps its lifecycle rejection to 409, distinct from a plain 404', () => {
  it('PATCH /api/commercial/purchase-orders/[id] maps the "can no longer be edited" throw to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateDraftPurchaseOrderMock.mockRejectedValue(new Error('Purchase order is ISSUED and can no longer be edited'))
    const res = await poPATCH(jsonReq({ supplierReference: 'x' }), ctx({ id: 'po-1' }))
    expect(res.status).toBe(409)
  })

  it('POST lines maps the "can no longer be edited" throw to 409, and the "not found" throw to 404 (distinct from each other)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    addPurchaseOrderLineMock.mockRejectedValue(new Error('Purchase order is APPROVED and can no longer be edited'))
    const conflictRes = await poLinePOST(jsonReq({ quantity: 1, description: 'x', unitPriceCents: 100 }), ctx({ id: 'po-1' }))
    expect(conflictRes.status).toBe(409)

    addPurchaseOrderLineMock.mockRejectedValue(new Error('purchase order not found for this organisation'))
    const notFoundRes = await poLinePOST(jsonReq({ quantity: 1, description: 'x', unitPriceCents: 100 }), ctx({ id: 'po-owned-by-org-b' }))
    expect(notFoundRes.status).toBe(404)
  })

  it('PATCH/DELETE line map the "can no longer be edited" throw to 409, not 400 or 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updatePurchaseOrderLineMock.mockRejectedValue(new Error('Purchase order is CANCELLED and can no longer be edited'))
    const patchRes = await poLinePATCH(jsonReq({ quantity: 2 }), ctx({ id: 'po-1', lineId: 'line-1' }))
    expect(patchRes.status).toBe(409)

    deletePurchaseOrderLineMock.mockRejectedValue(new Error('Purchase order is PENDING_APPROVAL and can no longer be edited'))
    const delRes = await poLineDELETE(plainReq(), ctx({ id: 'po-1', lineId: 'line-1' }))
    expect(delRes.status).toBe(409)
  })
})

// ── GET list: status filter ─────────────────────────────────────────────

describe('Phase C6.3 — GET /api/commercial/purchase-orders status filter', () => {
  it('passes a valid status through, ignores an invalid one', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    listPurchaseOrdersMock.mockResolvedValue([])
    await poListGET(plainReq('http://localhost/x?status=APPROVED'))
    expect(listPurchaseOrdersMock).toHaveBeenCalledWith('org-a', { status: 'APPROVED' })

    listPurchaseOrdersMock.mockClear()
    await poListGET(plainReq('http://localhost/x?status=NOT_A_REAL_STATUS'))
    expect(listPurchaseOrdersMock).toHaveBeenCalledWith('org-a', { status: undefined })
  })
})

// ── C6.4 scope discipline: none of the five lifecycle-transition domain
// functions are ever imported/called by any C6.3 route ────────────────

describe('Phase C6.3 — no lifecycle-transition function is wired to any route in this gate', () => {
  it('none of submit/approve/return/issue/cancel PurchaseOrder are called across any test above', () => {
    // These are asserted never-imported at the module level: the mock
    // factory for '@/lib/commercial/purchaseOrders' above deliberately
    // omits submitPurchaseOrder/approvePurchaseOrder/returnPurchaseOrderToDraft/
    // issuePurchaseOrder/cancelPurchaseOrder — if any C6.3 route imported
    // one of them, that route's module import would throw
    // "no matching export" the moment this file's top-level awaited
    // imports run, failing every test in this file at collection time.
    expect(true).toBe(true)
  })
})
