import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-POLISH-R §4/§12 — POST/DELETE /api/commercial/tax-codes[/[id]],
// POST /api/commercial/tax-codes/bootstrap, GET/PUT
// /api/commercial/settings/business-profile. Mocks the authorize module
// and the underlying lib/commercial/* data-access functions directly,
// matching this test suite's established route-testing convention (see
// tests/containment/commercialQuoteSendEmailRoute.test.ts).

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const createTaxCodeMock = vi.fn()
const listTaxCodesMock = vi.fn()
const deactivateTaxCodeMock = vi.fn()
vi.mock('@/lib/commercial/taxCodes', () => ({
  createTaxCode: (...a: unknown[]) => createTaxCodeMock(...a),
  listTaxCodes: (...a: unknown[]) => listTaxCodesMock(...a),
  deactivateTaxCode: (...a: unknown[]) => deactivateTaxCodeMock(...a),
}))

const seedStandardMock = vi.fn()
vi.mock('@/lib/commercial/taxCodeBootstrap', () => ({ seedStandardAustralianTaxCodes: (...a: unknown[]) => seedStandardMock(...a) }))

const getBusinessProfileMock = vi.fn()
const setBusinessProfileMock = vi.fn()
vi.mock('@/lib/commercial/businessProfile', () => ({
  getBusinessProfile: (...a: unknown[]) => getBusinessProfileMock(...a),
  setBusinessProfile: (...a: unknown[]) => setBusinessProfileMock(...a),
}))

const { POST: taxCodesPOST } = await import('@/app/api/commercial/tax-codes/route')
const { DELETE: taxCodeDELETE } = await import('@/app/api/commercial/tax-codes/[id]/route')
const { POST: bootstrapPOST } = await import('@/app/api/commercial/tax-codes/bootstrap/route')
const { GET: profileGET, PUT: profilePUT } = await import('@/app/api/commercial/settings/business-profile/route')

const ADMIN_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'admin' }
const VIEWER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'viewer' }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function jsonReq(body: unknown) {
  return new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authorizeMock.mockReset()
  createTaxCodeMock.mockReset()
  listTaxCodesMock.mockReset()
  deactivateTaxCodeMock.mockReset()
  seedStandardMock.mockReset()
  getBusinessProfileMock.mockReset()
  setBusinessProfileMock.mockReset()
})

describe('Phase C3-POLISH-R — POST /api/commercial/tax-codes requires administer role', () => {
  it('rejects a viewer/manager attempt (authorizeCommercialRequest itself enforces the floor)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await taxCodesPOST(jsonReq({ code: 'X', name: 'X', rate: 5 }))
    expect(res.status).toBe(403)
    expect(createTaxCodeMock).not.toHaveBeenCalled()
  })

  it('creates a tax code for an administer-role session, scoped to their organisation', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    createTaxCodeMock.mockResolvedValue({ id: 't1', code: 'GST', name: 'GST 10%', rate: '10.00' })
    const res = await taxCodesPOST(jsonReq({ code: 'GST', name: 'GST 10%', rate: 10 }))
    expect(res.status).toBe(201)
    expect(createTaxCodeMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a', code: 'GST' }))
  })

  it('rejects a request missing required fields before calling createTaxCode', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    const res = await taxCodesPOST(jsonReq({ code: '', name: '', rate: 'not-a-number' }))
    expect(res.status).toBe(400)
    expect(createTaxCodeMock).not.toHaveBeenCalled()
  })
})

describe('Phase C3-POLISH-R — DELETE /api/commercial/tax-codes/[id] deactivates, never hard-deletes', () => {
  it('calls deactivateTaxCode (not a raw DELETE FROM) and returns 404 if nothing matched', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    deactivateTaxCodeMock.mockResolvedValue(false)
    const res = await taxCodeDELETE(new Request('http://localhost/x') as unknown as import('next/server').NextRequest, { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
    expect(deactivateTaxCodeMock).toHaveBeenCalledWith({ organisationId: 'org-a', taxCodeId: 't1' })
  })
})

describe('Phase C3-POLISH-R §4 — POST /api/commercial/tax-codes/bootstrap', () => {
  it('is idempotent end-to-end through the route: calling twice never errors, second call reports everything skipped', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    seedStandardMock.mockResolvedValueOnce({ created: [{ code: 'GST' }, { code: 'GST_FREE' }, { code: 'NO_TAX' }], skipped: [] })
    const first = await bootstrapPOST()
    expect(first.status).toBe(200)

    seedStandardMock.mockResolvedValueOnce({ created: [], skipped: ['GST', 'GST_FREE', 'NO_TAX'] })
    const second = await bootstrapPOST()
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body.skipped).toEqual(['GST', 'GST_FREE', 'NO_TAX'])
  })
})

describe('Phase C3-POLISH-R §1 — business-profile settings: GET is view-role, PUT is administer-role', () => {
  it('GET succeeds for a viewer session (reading is not an org-config change)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
    const res = await profileGET()
    expect(res.status).toBe(200)
  })

  it('PUT is rejected for a non-administer session', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await profilePUT(jsonReq({ tradingName: 'New Name' }))
    expect(res.status).toBe(403)
    expect(setBusinessProfileMock).not.toHaveBeenCalled()
  })

  it('PUT for an administer session saves and echoes back the updated profile', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    setBusinessProfileMock.mockResolvedValue(undefined)
    getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: 'New Name', address: null, email: null, phone: null, abn: null } })
    const res = await profilePUT(jsonReq({ tradingName: 'New Name' }))
    expect(res.status).toBe(200)
    expect(setBusinessProfileMock).toHaveBeenCalledWith('org-a', expect.objectContaining({ tradingName: 'New Name' }))
  })
})
