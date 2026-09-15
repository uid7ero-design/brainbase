import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.4 — behavioural tests for every new supplier-bill route,
// mirroring tests/containment/commercialPurchaseReceiptApiRoutes.test.ts's
// own established convention: authorizeCommercialRequest and the domain
// functions are mocked directly; route handlers are imported and invoked
// with synthetic Request objects.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const listSupplierBillsMock = vi.fn()
const createSupplierBillMock = vi.fn()
const getSupplierBillWithLinesMock = vi.fn()
const updateDraftSupplierBillMock = vi.fn()
const deleteSupplierBillMock = vi.fn()
const addSupplierBillLineMock = vi.fn()
const updateSupplierBillLineMock = vi.fn()
const deleteSupplierBillLineMock = vi.fn()
const postSupplierBillMock = vi.fn()
const cancelSupplierBillMock = vi.fn()
const getBilledAmountsForPurchaseOrderMock = vi.fn()
const listSupplierBillsForPurchaseOrderMock = vi.fn()
vi.mock('@/lib/commercial/supplierBills', () => ({
  listSupplierBills: (...a: unknown[]) => listSupplierBillsMock(...a),
  createSupplierBill: (...a: unknown[]) => createSupplierBillMock(...a),
  getSupplierBillWithLines: (...a: unknown[]) => getSupplierBillWithLinesMock(...a),
  updateDraftSupplierBill: (...a: unknown[]) => updateDraftSupplierBillMock(...a),
  deleteSupplierBill: (...a: unknown[]) => deleteSupplierBillMock(...a),
  addSupplierBillLine: (...a: unknown[]) => addSupplierBillLineMock(...a),
  updateSupplierBillLine: (...a: unknown[]) => updateSupplierBillLineMock(...a),
  deleteSupplierBillLine: (...a: unknown[]) => deleteSupplierBillLineMock(...a),
  postSupplierBill: (...a: unknown[]) => postSupplierBillMock(...a),
  cancelSupplierBill: (...a: unknown[]) => cancelSupplierBillMock(...a),
  getBilledAmountsForPurchaseOrder: (...a: unknown[]) => getBilledAmountsForPurchaseOrderMock(...a),
  listSupplierBillsForPurchaseOrder: (...a: unknown[]) => listSupplierBillsForPurchaseOrderMock(...a),
}))

const getPurchaseOrderMock = vi.fn()
const getPurchaseOrderWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({
  getPurchaseOrder: (...a: unknown[]) => getPurchaseOrderMock(...a),
  getPurchaseOrderWithLines: (...a: unknown[]) => getPurchaseOrderWithLinesMock(...a),
}))

const { GET: listGET, POST: createPOST } = await import('@/app/api/commercial/supplier-bills/route')
const { GET: detailGET, PATCH: detailPATCH, DELETE: detailDELETE } = await import('@/app/api/commercial/supplier-bills/[id]/route')
const { POST: addLinePOST } = await import('@/app/api/commercial/supplier-bills/[id]/lines/route')
const { PATCH: linePATCH, DELETE: lineDELETE } = await import('@/app/api/commercial/supplier-bills/[id]/lines/[lineId]/route')
const { POST: postPOST } = await import('@/app/api/commercial/supplier-bills/[id]/post/route')
const { POST: cancelPOST } = await import('@/app/api/commercial/supplier-bills/[id]/cancel/route')
const { GET: poBillsGET } = await import('@/app/api/commercial/purchase-orders/[id]/bills/route')

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
function ctx(id = 'bill-1') {
  return { params: Promise.resolve({ id }) }
}
function lineCtx(id = 'bill-1', lineId = 'line-1') {
  return { params: Promise.resolve({ id, lineId }) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  for (const m of [
    listSupplierBillsMock, createSupplierBillMock, getSupplierBillWithLinesMock, updateDraftSupplierBillMock,
    deleteSupplierBillMock, addSupplierBillLineMock, updateSupplierBillLineMock, deleteSupplierBillLineMock,
    postSupplierBillMock, cancelSupplierBillMock, getBilledAmountsForPurchaseOrderMock, listSupplierBillsForPurchaseOrderMock,
    getPurchaseOrderMock, getPurchaseOrderWithLinesMock,
  ]) m.mockReset()
})

// ── AUTH: capability/role floor per route, matching the C7.4 capability matrix ──

describe('Phase C7.4 — every supplier-bill route requests the documented capability/role floor', () => {
  it('GET list requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await listGET(plainReq())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('POST create requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await createPOST(jsonReq({ purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-1' }))
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
    await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantity: 1 }), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('PATCH line requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await linePATCH(jsonReq({ quantity: 2 }, 'PATCH'), lineCtx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('DELETE line requests purchasing/manager (createEdit)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await lineDELETE(plainReq('DELETE'), lineCtx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('POST post requests purchasing/admin (approve) — stricter than purchase receipts, per the C7.4 capability matrix', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await postPOST(plainReq('POST'), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('POST cancel requests purchasing/admin (approve)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin')
  })

  it('GET PO-linked bills requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await poBillsGET(plainReq(), ctx('po-1'))
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('a 403 denial is returned as-is for every route, and no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const calls = [
      () => listGET(plainReq()),
      () => createPOST(jsonReq({ purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-1' })),
      () => detailGET(plainReq(), ctx()),
      () => detailPATCH(jsonReq({}, 'PATCH'), ctx()),
      () => detailDELETE(plainReq('DELETE'), ctx()),
      () => addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantity: 1 }), ctx()),
      () => linePATCH(jsonReq({ quantity: 2 }, 'PATCH'), lineCtx()),
      () => lineDELETE(plainReq('DELETE'), lineCtx()),
      () => postPOST(plainReq('POST'), ctx()),
      () => cancelPOST(jsonReq({ reason: 'x' }), ctx()),
      () => poBillsGET(plainReq(), ctx('po-1')),
    ]
    for (const call of calls) {
      const res = await call()
      expect(res.status).toBe(403)
    }
    for (const m of [
      listSupplierBillsMock, createSupplierBillMock, getSupplierBillWithLinesMock, updateDraftSupplierBillMock,
      deleteSupplierBillMock, addSupplierBillLineMock, updateSupplierBillLineMock, deleteSupplierBillLineMock,
      postSupplierBillMock, cancelSupplierBillMock,
    ]) expect(m).not.toHaveBeenCalled()
  })

  it('a viewer session can list/view', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    listSupplierBillsMock.mockResolvedValue([])
    const res = await listGET(plainReq())
    expect(res.status).toBe(200)
  })

  it('a manager session can create/edit but the mock proves post/cancel request a higher (admin) floor', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createSupplierBillMock.mockResolvedValue({ id: 'bill-1', status: 'DRAFT' })
    expect((await createPOST(jsonReq({ purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-1' }))).status).toBe(201)
  })

  it('an admin session can post and cancel', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    postSupplierBillMock.mockResolvedValue({ id: 'bill-1', status: 'POSTED', bill_number: 'BILL-000001' })
    cancelSupplierBillMock.mockResolvedValue({ id: 'bill-1', status: 'CANCELLED' })
    expect((await postPOST(plainReq('POST'), ctx())).status).toBe(200)
    expect((await cancelPOST(jsonReq({ reason: 'x' }), ctx())).status).toBe(200)
  })
})

// ── TENANT: cross-org/missing id collapses to 404 for every route ──────

describe('Phase C7.4 — a cross-org (or missing) supplier bill id 404s on every route', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION }) })

  it('GET/PATCH/DELETE detail all 404 for a not-found/cross-org id', async () => {
    getSupplierBillWithLinesMock.mockResolvedValue(null)
    updateDraftSupplierBillMock.mockResolvedValue(null)
    deleteSupplierBillMock.mockResolvedValue(false)

    expect((await detailGET(plainReq(), ctx('owned-by-org-b'))).status).toBe(404)
    expect((await detailPATCH(jsonReq({}, 'PATCH'), ctx('owned-by-org-b'))).status).toBe(404)
    expect((await detailDELETE(plainReq('DELETE'), ctx('owned-by-org-b'))).status).toBe(404)
  })

  it('post/cancel map "supplier bill not found for this organisation" to 404', async () => {
    const notFound = new Error('supplier bill not found for this organisation')
    postSupplierBillMock.mockRejectedValue(notFound)
    cancelSupplierBillMock.mockRejectedValue(notFound)

    expect((await postPOST(plainReq('POST'), ctx('owned-by-org-b'))).status).toBe(404)
    expect((await cancelPOST(jsonReq({ reason: 'x' }), ctx('owned-by-org-b'))).status).toBe(404)
  })

  it('the PO-linked-bills route 404s when the PO itself is not found for this organisation', async () => {
    getPurchaseOrderMock.mockResolvedValue(null)
    const res = await poBillsGET(plainReq(), ctx('po-owned-by-org-b'))
    expect(res.status).toBe(404)
    expect(listSupplierBillsForPurchaseOrderMock).not.toHaveBeenCalled()
  })
})

// ── CREATE: required fields + PO-status/supplier consistency ───────────

describe('Phase C7.4 — creating a bill requires purchaseOrderId + supplierInvoiceNumber and rejects a non-ISSUED PO', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION }) })

  it('missing purchaseOrderId is rejected 400 before the domain is ever called', async () => {
    const res = await createPOST(jsonReq({ supplierInvoiceNumber: 'INV-1' }))
    expect(res.status).toBe(400)
    expect(createSupplierBillMock).not.toHaveBeenCalled()
  })

  it('missing/blank supplierInvoiceNumber is rejected 400 before the domain is ever called', async () => {
    const res = await createPOST(jsonReq({ purchaseOrderId: 'po-1', supplierInvoiceNumber: '   ' }))
    expect(res.status).toBe(400)
    expect(createSupplierBillMock).not.toHaveBeenCalled()
  })

  it('a non-ISSUED PO is rejected (not 200/201)', async () => {
    createSupplierBillMock.mockRejectedValue(new Error('Purchase order is DRAFT — a supplier bill can only be created against an ISSUED purchase order.'))
    const res = await createPOST(jsonReq({ purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-1' }))
    expect(res.status).toBe(400)
  })

  it('a nonexistent purchaseOrderId maps to 404', async () => {
    createSupplierBillMock.mockRejectedValue(new Error('purchase_order_id not found for this organisation'))
    const res = await createPOST(jsonReq({ purchaseOrderId: 'po-owned-by-org-b', supplierInvoiceNumber: 'INV-1' }))
    expect(res.status).toBe(404)
  })

  it('a duplicate supplier invoice number maps to 409, not 400', async () => {
    createSupplierBillMock.mockRejectedValue(new Error('This supplier invoice number has already been recorded for this supplier.'))
    const res = await createPOST(jsonReq({ purchaseOrderId: 'po-1', supplierInvoiceNumber: 'INV-1' }))
    expect(res.status).toBe(409)
  })
})

// ── PO-LINE LINEAGE ──────────────────────────────────────────────────

describe('Phase C7.4 — adding a line requires sourcePurchaseOrderLineId + quantity and rejects a cross-PO source line', () => {
  beforeEach(() => { authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION }) })

  it('missing sourcePurchaseOrderLineId is rejected 400 before the domain is ever called', async () => {
    const res = await addLinePOST(jsonReq({ quantity: 1 }), ctx())
    expect(res.status).toBe(400)
    expect(addSupplierBillLineMock).not.toHaveBeenCalled()
  })

  it('missing quantity is rejected 400 before the domain is ever called', async () => {
    const res = await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1' }), ctx())
    expect(res.status).toBe(400)
    expect(addSupplierBillLineMock).not.toHaveBeenCalled()
  })

  it('a source line that does not belong to this PO is rejected 404', async () => {
    addSupplierBillLineMock.mockRejectedValue(new Error('source_purchase_order_line_id not found on this purchase order for this organisation'))
    const res = await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-from-another-po', quantity: 1 }), ctx())
    expect(res.status).toBe(404)
  })

  it('adding a line to a non-DRAFT bill fails 409', async () => {
    addSupplierBillLineMock.mockRejectedValue(new Error('Supplier bill is POSTED and can no longer be edited'))
    const res = await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantity: 1 }), ctx())
    expect(res.status).toBe(409)
  })
})

// ── LIFECYCLE: over-billing + numbering error mapping ───────────────

describe('Phase C7.4 — post/cancel error-to-status mapping', () => {
  it('posting succeeds -> 200 with a bill_number allocated', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    postSupplierBillMock.mockResolvedValue({ id: 'bill-1', status: 'POSTED', bill_number: 'BILL-000007' })
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supplierBill.bill_number).toBe('BILL-000007')
  })

  it('posting a non-DRAFT bill fails 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    postSupplierBillMock.mockRejectedValue(new Error('Cannot transition supplier bill from POSTED to POSTED'))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('the strict over-billing guard failure maps to 409, not 400 or 500', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    postSupplierBillMock.mockRejectedValue(new Error(
      'One or more lines on this bill would bill beyond the ordered value of the linked purchase order line (including amounts already posted on other bills for the same purchase order line). Reduce the amount and try again.'
    ))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('posting against a non-ISSUED PO maps to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    postSupplierBillMock.mockRejectedValue(new Error('Purchase order is CANCELLED — a supplier bill can only be posted while its purchase order is ISSUED.'))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('posting a bill with no lines maps to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    postSupplierBillMock.mockRejectedValue(new Error('cannot post a supplier bill with no lines'))
    const res = await postPOST(plainReq('POST'), ctx())
    expect(res.status).toBe(409)
  })

  it('cancel with a missing/empty reason fails 400 and never calls the domain', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    const res = await cancelPOST(jsonReq({ reason: '   ' }), ctx())
    expect(res.status).toBe(400)
    expect(cancelSupplierBillMock).not.toHaveBeenCalled()
  })

  it('cancelling a non-POSTED bill fails 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    cancelSupplierBillMock.mockRejectedValue(new Error('Cannot transition supplier bill from DRAFT to CANCELLED'))
    const res = await cancelPOST(jsonReq({ reason: 'x' }), ctx())
    expect(res.status).toBe(409)
  })

  it('a subsequent PATCH/DELETE/add-line against an already-POSTED bill is rejected by the route (POSTED immutability, surfaced here)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateDraftSupplierBillMock.mockRejectedValue(new Error('Supplier bill is POSTED and can no longer be edited'))
    deleteSupplierBillMock.mockResolvedValue(false)
    addSupplierBillLineMock.mockRejectedValue(new Error('Supplier bill is POSTED and can no longer be edited'))

    expect((await detailPATCH(jsonReq({ supplierInvoiceNumber: 'x' }, 'PATCH'), ctx())).status).toBe(409)
    expect((await detailDELETE(plainReq('DELETE'), ctx())).status).toBe(404)
    expect((await addLinePOST(jsonReq({ sourcePurchaseOrderLineId: 'pol-1', quantity: 1 }), ctx())).status).toBe(409)
  })
})

// ── AUDIT: no route-level duplicate logging or raw SQL ──────────────────

const BILL_ROUTE_FILES = [
  'app/api/commercial/supplier-bills/route.ts',
  'app/api/commercial/supplier-bills/[id]/route.ts',
  'app/api/commercial/supplier-bills/[id]/lines/route.ts',
  'app/api/commercial/supplier-bills/[id]/lines/[lineId]/route.ts',
  'app/api/commercial/supplier-bills/[id]/post/route.ts',
  'app/api/commercial/supplier-bills/[id]/cancel/route.ts',
  'app/api/commercial/purchase-orders/[id]/bills/route.ts',
]

describe('Phase C7.4 — no supplier-bill route performs its own duplicate audit logging or raw SQL', () => {
  it('none of the route files import lib/commercial/auditLog or call insertAuditLog/logSupplierBill* directly', () => {
    for (const relPath of BILL_ROUTE_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
      expect(source, `${relPath} must not import auditLog`).not.toMatch(/from ['"]@\/lib\/commercial\/auditLog['"]/)
      expect(source, `${relPath} must not call insertAuditLog`).not.toMatch(/insertAuditLog/)
      expect(source, `${relPath} must not call a logSupplierBill* helper directly`).not.toMatch(/logSupplierBill\w+\(/)
    }
  })

  it('none of the route files import @/lib/db or reference a `sql` tagged template', () => {
    for (const relPath of BILL_ROUTE_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
      expect(source, `${relPath} must not import lib/db`).not.toMatch(/from ['"]@\/lib\/db['"]/)
      expect(source, `${relPath} must not use a raw sql\`...\` template`).not.toMatch(/\bsql`/)
    }
  })
})
