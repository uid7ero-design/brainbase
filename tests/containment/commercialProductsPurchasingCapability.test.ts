import { describe, it, expect, vi, beforeEach } from 'vitest'

// C6.9 remediation 1 — behavioural regression for the products capability
// gap found in C6.7: a purchasing-only-entitled organisation could
// read the shared catalogue (GET already included 'purchasing') but was
// incorrectly Forbidden from POST/GET-one/PUT/PATCH. Mirrors
// tests/containment/commercialPurchaseOrderLifecycleApiRoutes.test.ts's
// own established convention: authorizeCommercialRequest is mocked
// directly and asserted on its actual call arguments, real route
// handlers are imported and invoked.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const listProductsMock = vi.fn()
const createProductMock = vi.fn()
const getProductMock = vi.fn()
const updateProductMock = vi.fn()
const deactivateProductMock = vi.fn()
const reactivateProductMock = vi.fn()
vi.mock('@/lib/commercial/products', () => ({
  listProducts: (...a: unknown[]) => listProductsMock(...a),
  createProduct: (...a: unknown[]) => createProductMock(...a),
  getProduct: (...a: unknown[]) => getProductMock(...a),
  updateProduct: (...a: unknown[]) => updateProductMock(...a),
  deactivateProduct: (...a: unknown[]) => deactivateProductMock(...a),
  reactivateProduct: (...a: unknown[]) => reactivateProductMock(...a),
}))

const { GET: listGET, POST: createPOST } = await import('@/app/api/commercial/products/route')
const { GET: oneGET, PUT: onePUT, PATCH: onePATCH } = await import('@/app/api/commercial/products/[id]/route')

const PURCHASING_ONLY_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager' }
const ALLOWED = { ok: true as const, session: PURCHASING_ONLY_SESSION }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function jsonReq(body: unknown = {}) {
  const req = new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return req as unknown as import('next/server').NextRequest
}
function ctx(id = 'prod-1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  listProductsMock.mockReset().mockResolvedValue([])
  createProductMock.mockReset().mockResolvedValue({ id: 'prod-1', name: 'x' })
  getProductMock.mockReset().mockResolvedValue({ id: 'prod-1', name: 'x' })
  updateProductMock.mockReset().mockResolvedValue({ id: 'prod-1', name: 'x' })
  deactivateProductMock.mockReset().mockResolvedValue(true)
  reactivateProductMock.mockReset().mockResolvedValue(true)
})

describe('commercial products routes — purchasing capability (C6.9 remediation 1)', () => {
  it('GET (list) authorizes against a capability array including purchasing', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    await listGET()
    expect(authorizeMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['purchasing', 'quotes', 'invoicing']))
  })

  it('POST (create) authorizes against a capability array including purchasing — the C6.7-found gap', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    const res = await createPOST(jsonReq({ type: 'PRODUCT', name: 'Widget', defaultUnitPriceCents: 100 }))
    expect(authorizeMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['purchasing']))
    expect(res.status).toBe(201)
  })

  it('POST is genuinely Forbidden (not silently allowed) when authorizeCommercialRequest denies', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await createPOST(jsonReq({ type: 'PRODUCT', name: 'Widget', defaultUnitPriceCents: 100 }))
    expect(res.status).toBe(403)
    expect(createProductMock).not.toHaveBeenCalled()
  })

  it('GET (one) authorizes against a capability array including purchasing', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    await oneGET({} as unknown as import('next/server').NextRequest, ctx())
    expect(authorizeMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['purchasing']))
  })

  it('PUT (update) authorizes against a capability array including purchasing', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    await onePUT(jsonReq({ name: 'y' }), ctx())
    expect(authorizeMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['purchasing']))
  })

  it('PATCH (activate/deactivate) authorizes against a capability array including purchasing', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    await onePATCH(jsonReq({ active: false }), ctx())
    expect(authorizeMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['purchasing']))
  })

  it('every existing Sales/Quotes/Invoicing capability remains in every array (no narrowing regression)', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    await listGET()
    await createPOST(jsonReq({ type: 'PRODUCT', name: 'Widget', defaultUnitPriceCents: 100 }))
    await oneGET({} as unknown as import('next/server').NextRequest, ctx())
    await onePUT(jsonReq({ name: 'y' }), ctx())
    await onePATCH(jsonReq({ active: false }), ctx())
    for (const call of authorizeMock.mock.calls) {
      expect(call[0]).toEqual(expect.arrayContaining(['quotes', 'invoicing']))
    }
  })
})
