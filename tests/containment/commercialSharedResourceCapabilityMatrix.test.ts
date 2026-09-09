import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C4.4A — Finding 3 remediation. Integration-style coverage:
// unlike tests/containment/commercialSettingsRoutes.test.ts (which mocks
// authorizeCommercialRequest() itself, so it can't distinguish which
// underlying capability an organisation actually has), this file mocks
// only the LOWER-level primitives — requireSession() and
// requireCapability() — and runs the REAL authorizeCommercialRequest()
// (lib/commercial/authorize.ts, unmodified from tests/containment/
// commercialAuthorize.test.ts's own unit coverage) underneath the REAL
// route handlers. This is what actually proves the capability MATRIX:
// a mock requireCapability that resolves for 'quotes' and rejects for
// 'invoicing' (or vice versa) genuinely exercises the OR-gate the same
// way a real quotes-only or invoicing-only organisation would.

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

const listCustomersMock = vi.fn()
const createCustomerMock = vi.fn()
vi.mock('@/lib/commercial/customers', () => ({
  listCustomers: (...a: unknown[]) => listCustomersMock(...a),
  createCustomer: (...a: unknown[]) => createCustomerMock(...a),
}))

const listProductsMock = vi.fn()
const createProductMock = vi.fn()
vi.mock('@/lib/commercial/products', () => ({
  listProducts: (...a: unknown[]) => listProductsMock(...a),
  createProduct: (...a: unknown[]) => createProductMock(...a),
}))

const listTaxCodesMock = vi.fn()
const createTaxCodeMock = vi.fn()
vi.mock('@/lib/commercial/taxCodes', () => ({
  listTaxCodes: (...a: unknown[]) => listTaxCodesMock(...a),
  createTaxCode: (...a: unknown[]) => createTaxCodeMock(...a),
  deactivateTaxCode: vi.fn(),
}))

const getBusinessProfileMock = vi.fn()
const setBusinessProfileMock = vi.fn()
vi.mock('@/lib/commercial/businessProfile', () => ({
  getBusinessProfile: (...a: unknown[]) => getBusinessProfileMock(...a),
  setBusinessProfile: (...a: unknown[]) => setBusinessProfileMock(...a),
}))

const listQuotesMock = vi.fn()
vi.mock('@/lib/commercial/quotes', () => ({ listQuotes: (...a: unknown[]) => listQuotesMock(...a), createDraftQuote: vi.fn() }))

const listInvoicesMock = vi.fn()
vi.mock('@/lib/commercial/invoices', () => ({ listInvoices: (...a: unknown[]) => listInvoicesMock(...a), createDraftInvoice: vi.fn() }))

const { GET: customersGET, POST: customersPOST } = await import('@/app/api/commercial/customers/route')
const { GET: productsGET, POST: productsPOST } = await import('@/app/api/commercial/products/route')
const { GET: taxCodesGET } = await import('@/app/api/commercial/tax-codes/route')
const { GET: profileGET } = await import('@/app/api/commercial/settings/business-profile/route')
const { GET: quotesGET } = await import('@/app/api/commercial/quotes/route')
const { GET: invoicesGET } = await import('@/app/api/commercial/invoices/route')

const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability')

function sessionFor(role: string, organisationId = 'org-a') {
  return { userId: 'user-1', organisationId, role, homeOrganisationId: organisationId, name: 'Test User' }
}

// Drives requireCapability's mock to behave like a real organisation
// with EXACTLY the given set of enabled capability keys.
function mockCapabilities(enabled: string[]) {
  requireCapabilityMock.mockImplementation((_orgId: string, key: string) => {
    if (enabled.includes(key)) return Promise.resolve({ key, config: {} })
    return Promise.reject(new CapabilityAccessError('NO_ENTITLEMENT'))
  })
}

function jsonReq(body: unknown, url = 'http://localhost/x') {
  const req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function plainReq(url = 'http://localhost/x') {
  const req = new Request(url)
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  listCustomersMock.mockReset(); createCustomerMock.mockReset()
  listProductsMock.mockReset(); createProductMock.mockReset()
  listTaxCodesMock.mockReset(); createTaxCodeMock.mockReset()
  getBusinessProfileMock.mockReset(); setBusinessProfileMock.mockReset()
  listQuotesMock.mockReset()
  listInvoicesMock.mockReset()
  listCustomersMock.mockResolvedValue([])
  listProductsMock.mockResolvedValue([])
  listTaxCodesMock.mockResolvedValue([])
  getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
  listQuotesMock.mockResolvedValue([])
  listInvoicesMock.mockResolvedValue([])
})

describe('Phase C4.4A (Finding 3) — 1. quotes-only organisation can still use every shared resource', () => {
  beforeEach(() => { requireSessionMock.mockResolvedValue(sessionFor('manager')); mockCapabilities(['quotes']) })

  it('customers GET/POST succeed', async () => {
    expect((await customersGET()).status).toBe(200)
    expect((await customersPOST(jsonReq({ name: 'Acme' }))).status).not.toBe(403)
  })
  it('products GET/POST succeed', async () => {
    expect((await productsGET()).status).toBe(200)
    expect((await productsPOST(jsonReq({ type: 'PRODUCT', name: 'Widget' }))).status).not.toBe(403)
  })
  it('tax-codes GET succeeds', async () => {
    expect((await taxCodesGET()).status).toBe(200)
  })
  it('business-profile GET succeeds', async () => {
    expect((await profileGET()).status).toBe(200)
  })
})

describe('Phase C4.4A (Finding 3) — 2. invoicing-only organisation can use the shared resources required to create/manage invoices', () => {
  beforeEach(() => { requireSessionMock.mockResolvedValue(sessionFor('manager')); mockCapabilities(['invoicing']) })

  it('customers GET/POST succeed (this is the exact gap Finding 3 identified — previously a hard 403)', async () => {
    expect((await customersGET()).status).toBe(200)
    expect((await customersPOST(jsonReq({ name: 'Acme' }))).status).not.toBe(403)
  })
  it('products GET/POST succeed', async () => {
    expect((await productsGET()).status).toBe(200)
    expect((await productsPOST(jsonReq({ type: 'SERVICE', name: 'Consulting' }))).status).not.toBe(403)
  })
  it('tax-codes GET succeeds', async () => {
    expect((await taxCodesGET()).status).toBe(200)
  })
  it('business-profile GET succeeds (an invoicing-only org must be able to configure its own invoice letterhead)', async () => {
    expect((await profileGET()).status).toBe(200)
  })
})

describe('Phase C4.4A (Finding 3) — 3. an organisation with NEITHER quotes nor invoicing cannot use the shared resources', () => {
  beforeEach(() => { requireSessionMock.mockResolvedValue(sessionFor('manager')); mockCapabilities([]) })

  it('customers GET -> 403, never reaches listCustomers', async () => {
    const res = await customersGET()
    expect(res.status).toBe(403)
    expect(listCustomersMock).not.toHaveBeenCalled()
  })
  it('products GET -> 403', async () => {
    expect((await productsGET()).status).toBe(403)
  })
  it('tax-codes GET -> 403', async () => {
    expect((await taxCodesGET()).status).toBe(403)
  })
  it('business-profile GET -> 403', async () => {
    expect((await profileGET()).status).toBe(403)
  })
})

describe('Phase C4.4A (Finding 3) — 4. an invoicing-only organisation still cannot browse/use quote-specific endpoints', () => {
  it('GET /api/commercial/quotes -> 403 for an invoicing-only organisation — this route is untouched, still a bare single-key gate', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('manager'))
    mockCapabilities(['invoicing'])
    const res = await quotesGET(plainReq())
    expect(res.status).toBe(403)
    expect(listQuotesMock).not.toHaveBeenCalled()
  })

  it('conversely, a quotes-only organisation cannot use GET /api/commercial/invoices — invoice-specific operations remain invoicing-gated', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('manager'))
    mockCapabilities(['quotes'])
    const res = await invoicesGET(plainReq())
    expect(res.status).toBe(403)
    expect(listInvoicesMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.4A (Finding 3) — 5. lower roles remain blocked on shared resources, even with the right capability', () => {
  it('a viewer cannot POST a new customer for an invoicing-only organisation (createEdit floor still enforced)', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('viewer'))
    mockCapabilities(['invoicing'])
    const res = await customersPOST(jsonReq({ name: 'Acme' }))
    expect(res.status).toBe(403)
    expect(createCustomerMock).not.toHaveBeenCalled()
  })

  it('a manager cannot POST a new tax code for a quotes-only organisation (administer floor still enforced)', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('manager'))
    mockCapabilities(['quotes'])
    const { POST: taxCodesPOST } = await import('@/app/api/commercial/tax-codes/route')
    const res = await taxCodesPOST(jsonReq({ code: 'GST', name: 'GST 10%', rate: 10 }))
    expect(res.status).toBe(403)
    expect(createTaxCodeMock).not.toHaveBeenCalled()
  })

  it('a viewer CAN read customers for a quotes-only organisation (view floor)', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('viewer'))
    mockCapabilities(['quotes'])
    expect((await customersGET()).status).toBe(200)
  })
})

describe('Phase C4.4A (Finding 3) — 6. hostile organisation IDs in request input cannot affect scoping', () => {
  it('a spoofed organisationId in a customer-create body is ignored — the domain call always uses the SESSION organisationId', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('manager', 'org-a'))
    mockCapabilities(['invoicing'])
    createCustomerMock.mockResolvedValue({ id: 'c1', name: 'Acme' })
    await customersPOST(jsonReq({ name: 'Acme', organisationId: 'org-HOSTILE' }))
    expect(createCustomerMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })

  it('a spoofed organisationId in a product-create body is ignored', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('manager', 'org-a'))
    mockCapabilities(['quotes'])
    createProductMock.mockResolvedValue({ id: 'p1', name: 'Widget' })
    await productsPOST(jsonReq({ type: 'PRODUCT', name: 'Widget', organisationId: 'org-HOSTILE' }))
    expect(createProductMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })

  it('requireCapability is always called with the SESSION organisationId, never anything from request input, for a shared-resource route', async () => {
    requireSessionMock.mockResolvedValue(sessionFor('manager', 'org-a'))
    mockCapabilities(['invoicing'])
    await customersGET()
    for (const call of requireCapabilityMock.mock.calls) {
      expect(call[0]).toBe('org-a')
    }
  })
})
