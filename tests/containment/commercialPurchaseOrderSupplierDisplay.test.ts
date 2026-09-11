import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 remediation 2 — regression for the pre-issue "Supplier: —"
// display bug found in C6.8's Production smoke: the PO detail route
// only ever returned purchase_order.supplier_id plus the
// supplier_*_snapshot columns (null until ISSUE), never a live supplier
// value the page could show pre-issue.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const getPurchaseOrderWithLinesMock = vi.fn()
const updateDraftPurchaseOrderMock = vi.fn()
const deleteDraftPurchaseOrderMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({
  getPurchaseOrderWithLines: (...a: unknown[]) => getPurchaseOrderWithLinesMock(...a),
  updateDraftPurchaseOrder: (...a: unknown[]) => updateDraftPurchaseOrderMock(...a),
  deleteDraftPurchaseOrder: (...a: unknown[]) => deleteDraftPurchaseOrderMock(...a),
}))

const listDeliveriesForDocumentMock = vi.fn()
vi.mock('@/lib/commercial/documentDeliveries', () => ({
  listDeliveriesForDocument: (...a: unknown[]) => listDeliveriesForDocumentMock(...a),
}))

const getSupplierMock = vi.fn()
vi.mock('@/lib/commercial/suppliers', () => ({
  getSupplier: (...a: unknown[]) => getSupplierMock(...a),
}))

const { GET } = await import('@/app/api/commercial/purchase-orders/[id]/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager' }
const ALLOWED = { ok: true as const, session: SESSION }

function ctx(id = 'po-1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  authorizeMock.mockReset().mockResolvedValue(ALLOWED)
  listDeliveriesForDocumentMock.mockReset().mockResolvedValue([])
  getSupplierMock.mockReset()
})

describe('GET /api/commercial/purchase-orders/[id] — live supplier (C6.9 remediation 2)', () => {
  it('fetches the live supplier via the tenant-scoped supplier_id and includes it in the response, for a DRAFT PO', async () => {
    const po = { id: 'po-1', organisation_id: 'org-a', supplier_id: 'sup-1', status: 'DRAFT', supplier_name_snapshot: null }
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: po, lines: [] })
    getSupplierMock.mockResolvedValue({ id: 'sup-1', name: 'Live Supplier Co', contact_name: 'Jane', email: 'jane@x.test', phone: null })

    const res = await GET({} as unknown as import('next/server').NextRequest, ctx())
    const data = await res.json()

    expect(getSupplierMock).toHaveBeenCalledWith('org-a', 'sup-1')
    expect(data.supplier).toEqual({ id: 'sup-1', name: 'Live Supplier Co', contact_name: 'Jane', email: 'jane@x.test', phone: null })
  })

  it('still includes the live supplier for ISSUED/CANCELLED POs (the route does not special-case status — the CLIENT decides not to use it there)', async () => {
    const po = { id: 'po-1', organisation_id: 'org-a', supplier_id: 'sup-1', status: 'ISSUED', supplier_name_snapshot: 'Frozen Supplier Name' }
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: po, lines: [] })
    getSupplierMock.mockResolvedValue({ id: 'sup-1', name: 'Currently-Renamed Supplier Co' })

    const res = await GET({} as unknown as import('next/server').NextRequest, ctx())
    const data = await res.json()

    expect(data.supplier.name).toBe('Currently-Renamed Supplier Co')
    expect(data.purchaseOrder.supplier_name_snapshot).toBe('Frozen Supplier Name')
  })

  it('resolves supplier: null (not an error) if the linked supplier no longer exists', async () => {
    const po = { id: 'po-1', organisation_id: 'org-a', supplier_id: 'sup-deleted', status: 'DRAFT' }
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: po, lines: [] })
    getSupplierMock.mockResolvedValue(null)

    const res = await GET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.supplier).toBeNull()
  })

  it('404s before ever calling getSupplier for a missing/wrong-tenant PO', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue(null)
    const res = await GET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(404)
    expect(getSupplierMock).not.toHaveBeenCalled()
  })
})

describe('PO detail page — status-gated supplier rendering (C6.9 remediation 2, source containment)', () => {
  const SRC = fs.readFileSync(
    path.join(process.cwd(), 'app/commercial/purchasing/purchase-orders/[id]/page.tsx'),
    'utf8',
  )

  it('branches the read-only Supplier block on ISSUED/CANCELLED vs. everything else', () => {
    const blockStart = SRC.indexOf('C6.9 remediation — DRAFT/PENDING_APPROVAL/APPROVED render')
    expect(blockStart).toBeGreaterThan(-1)
    const region = SRC.slice(blockStart, blockStart + 2400)
    expect(region).toContain("po.status === 'ISSUED' || po.status === 'CANCELLED'")
    // ISSUED/CANCELLED branch still reads the frozen snapshot fields.
    expect(region).toContain('po.supplier_name_snapshot')
    // The other branch reads the live linkedSupplier state, not the snapshot.
    expect(region).toContain('linkedSupplier?.name')
  })

  it('never uses linkedSupplier as a fallback inside the ISSUED/CANCELLED branch (critical: must not blend live data into a frozen document)', () => {
    const blockStart = SRC.indexOf('C6.9 remediation — DRAFT/PENDING_APPROVAL/APPROVED render')
    const ternaryStart = SRC.indexOf('ISSUED', blockStart)
    const issuedBranchEnd = SRC.indexOf(') : (', ternaryStart)
    const issuedBranch = SRC.slice(ternaryStart, issuedBranchEnd)
    expect(issuedBranch).not.toContain('linkedSupplier')
  })
})
