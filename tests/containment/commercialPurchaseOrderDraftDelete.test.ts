import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 remediation 3 — safe discard/delete for a never-issued,
// never-submitted DRAFT purchase order. Two layers tested:
//  (1) the domain function's SQL eligibility gate (source containment —
//      this repo's `sql` client executes real parameterized queries;
//      asserting the exact WHERE-clause conditions is the established
//      idiom for proving a gate exists without a live DB — see
//      tests/containment/commercialPurchaseOrdersDomain.test.ts for the
//      identical convention already used elsewhere in this suite).
//  (2) the route layer's auth/eligibility-translation contract (mocked
//      domain function, real route handler invoked).

describe('deleteDraftPurchaseOrder — eligibility gate (source containment)', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'lib/commercial/purchaseOrders.ts'), 'utf8')

  it('exists and DELETEs commercial_purchase_orders gated on status=DRAFT AND purchase_order_number IS NULL AND submitted_at IS NULL, in one atomic WHERE clause', () => {
    const start = SRC.indexOf('export async function deleteDraftPurchaseOrder')
    expect(start).toBeGreaterThan(-1)
    const end = SRC.indexOf('// ── Lines', start)
    const fn = SRC.slice(start, end)
    expect(fn).toContain('DELETE FROM commercial_purchase_orders')
    expect(fn).toContain("status = 'DRAFT'")
    expect(fn).toContain('purchase_order_number IS NULL')
    expect(fn).toContain('submitted_at IS NULL')
    expect(fn).toContain('organisation_id = ${params.organisationId}')
    expect(fn).toContain('logPurchaseOrderDeleted')
  })

  it('the three eligibility conditions are combined with AND, not OR (a single malformed WHERE could otherwise widen eligibility)', () => {
    const start = SRC.indexOf('export async function deleteDraftPurchaseOrder')
    const end = SRC.indexOf('RETURNING id', start)
    const whereClause = SRC.slice(start, end)
    expect(whereClause).not.toContain(' OR ')
    expect((whereClause.match(/AND/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

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
vi.mock('@/lib/commercial/documentDeliveries', () => ({ listDeliveriesForDocument: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/commercial/suppliers', () => ({ getSupplier: vi.fn().mockResolvedValue(null) }))

const { DELETE } = await import('@/app/api/commercial/purchase-orders/[id]/route')

const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }
const VIEWER_SESSION = { userId: 'user-4', organisationId: 'org-a', role: 'viewer' }
const ALLOWED = { ok: true as const, session: MANAGER_SESSION }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function ctx(id = 'po-1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  deleteDraftPurchaseOrderMock.mockReset()
})

describe('DELETE /api/commercial/purchase-orders/[id] — route contract (C6.9 remediation 3)', () => {
  it('authorizes at the createEdit (manager+) floor — matches every other PO mutation route', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    deleteDraftPurchaseOrderMock.mockResolvedValue(true)
    await DELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('viewer is rejected before the domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await DELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(403)
    expect(deleteDraftPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('returns 200/success when the domain function reports success', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    deleteDraftPurchaseOrderMock.mockResolvedValue(true)
    const res = await DELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 404 (never distinguishing the reason) when the domain function reports ineligible/not-found — covers PENDING_APPROVAL, APPROVED, ISSUED, CANCELLED, numbered, and wrong-tenant all identically', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    deleteDraftPurchaseOrderMock.mockResolvedValue(false)
    const res = await DELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(404)
  })

  it('passes organisationId/userId/purchaseOrderId through to the domain function unmodified — no client-supplied organisationId is ever used', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    deleteDraftPurchaseOrderMock.mockResolvedValue(true)
    await DELETE({} as unknown as import('next/server').NextRequest, ctx('po-xyz'))
    expect(deleteDraftPurchaseOrderMock).toHaveBeenCalledWith({
      organisationId: 'org-a', userId: 'user-2', purchaseOrderId: 'po-xyz',
    })
  })
})

describe('PO detail page — Delete Draft UI (C6.9 remediation 3, source containment)', () => {
  const SRC = fs.readFileSync(
    path.join(process.cwd(), 'app/commercial/purchasing/purchase-orders/[id]/page.tsx'),
    'utf8',
  )

  it('the Delete Draft button is gated on isDraft, canEdit, purchase_order_number == null, and submitted_at == null', () => {
    const start = SRC.indexOf('C6.9 remediation — only ever offered for a DRAFT that was')
    expect(start).toBeGreaterThan(-1)
    const region = SRC.slice(start, start + 600)
    expect(region).toContain('isDraft && canEdit')
    expect(region).toContain('po.purchase_order_number == null')
    expect(region).toContain('po.submitted_at == null')
    expect(region).toContain('Delete Draft')
  })

  it('requires an explicit confirmation panel before calling deleteAction (never a bare onClick)', () => {
    expect(SRC).toContain('confirmingDelete')
    expect(SRC).toContain('Yes, Delete Draft')
    expect(SRC).toContain('Keep Draft')
  })

  it('calls the real DELETE route and redirects away on success', () => {
    const start = SRC.indexOf('async function deleteAction')
    const end = SRC.indexOf('\n  }', start)
    const fn = SRC.slice(start, end)
    expect(fn).toContain("method: 'DELETE'")
    expect(fn).toContain('router.push')
  })
})
