import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Modular Platform Foundation Phase F.6T — the first real server-side
// consumer of lib/capabilities/requireCapability.ts. This suite proves
// the CRM API boundary (9 route files, 19 exported handlers) requires
// an enabled 'crm' entitlement for the effective organisation, layered
// ADDITIVELY on top of the existing requireSession()-based
// authentication and tenant isolation — never replacing either. No
// Production connection or data mutation occurs anywhere in this file
// — every dependency is mocked.

function asNextRequest(req: Request): NextRequest {
  // NextRequest augments Request with a `.nextUrl` property some CRM
  // routes read directly (e.g. req.nextUrl.searchParams). A plain
  // Request cast alone doesn't have it — attach a real URL so any
  // handler that reaches past the capability check still works.
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

const getValidAccessTokenMock = vi.fn()
vi.mock('@/lib/gmail/tokens', () => ({
  getValidAccessToken: (...args: unknown[]) => getValidAccessTokenMock(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const { CapabilityAccessError, CapabilityDatabaseError } =
  await import('@/lib/capabilities/requireCapability')
const companiesRoute = await import('@/app/api/crm/companies/route')
const companiesIdRoute = await import('@/app/api/crm/companies/[id]/route')
const contactsRoute = await import('@/app/api/crm/contacts/route')
const contactsIdRoute = await import('@/app/api/crm/contacts/[id]/route')
const dealsRoute = await import('@/app/api/crm/deals/route')
const dealsIdRoute = await import('@/app/api/crm/deals/[id]/route')
const activitiesRoute = await import('@/app/api/crm/activities/route')
const activitiesIdRoute = await import('@/app/api/crm/activities/[id]/route')
const gmailSearchRoute = await import('@/app/api/crm/gmail-search/route')

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager' }
const CTX = { params: Promise.resolve({ id: 'row-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  requireCapabilityMock.mockReset()
  getValidAccessTokenMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(SESSION)
})

describe('CRM capability enforcement — representative deep coverage (companies)', () => {
  it('1. authenticated + CRM entitled -> existing GET list operation allowed, CRM SQL executes', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([{ id: 'c1' }])
    const res = await companiesRoute.GET()
    expect(res.status).toBe(200)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('1b. authenticated + CRM entitled -> existing POST create operation allowed', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([{ id: 'c1', name: 'Acme' }])
    const req = asNextRequest(new Request('http://localhost/api/crm/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Acme' }),
    }))
    const res = await companiesRoute.POST(req)
    expect(res.status).toBe(201)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('2. no CRM entitlement -> 403, no CRM SQL executes', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const res = await companiesRoute.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('3. CRM entitlement enabled=false (ENTITLEMENT_DISABLED) -> 403', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'))
    const res = await companiesRoute.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('4. CRM globally inactive (CAPABILITY_INACTIVE) -> 403', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('CAPABILITY_INACTIVE'))
    const res = await companiesRoute.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('unknown capability key (UNKNOWN_CAPABILITY, defensive case) -> 403', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('UNKNOWN_CAPABILITY'))
    const res = await companiesRoute.GET()
    expect(res.status).toBe(403)
  })

  it('5. another organisation is never authorized — the check is always bound to the resolved effective organisationId, not a fixed/cached value', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([])
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager' })
    await companiesRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'crm')

    requireCapabilityMock.mockReset()
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    requireSessionMock.mockResolvedValue({ userId: 'u2', organisationId: 'org-b', role: 'manager' })
    const res = await companiesRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-b', 'crm')
    expect(res.status).toBe(403)
  })

  it('6. existing authentication remains independently required — unauthenticated -> 401, capability check never runs', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await companiesRoute.GET()
    expect(res.status).toBe(401)
    expect(requireCapabilityMock).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('7. capability DB failure fails closed -> generic 5xx, never CRM SQL execution, never a 403', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityDatabaseError())
    const res = await companiesRoute.GET()
    expect(res.status).toBe(503)
    expect(res.status).not.toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/CapabilityDatabaseError|stack|sql/i)
  })

  it('8. TEXT/cuid-shaped organisation id is passed unchanged, no UUID conversion introduced', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([])
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'clx8f9a2b0000abc123def456', role: 'manager' })
    await companiesRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('clx8f9a2b0000abc123def456', 'crm')
  })

  it('9. an Organiser-only entitlement (requireCapability itself rejecting for the crm key) never satisfies the CRM requirement — the route always requests the literal key "crm"', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    await companiesRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'crm')
    expect(requireCapabilityMock).not.toHaveBeenCalledWith('org-a', 'organiser')
  })

  it('10. enforcement itself performs no entitlement mutation — only requireCapability (a read-only check) is called, never any organisation_modules write', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([])
    await companiesRoute.GET()
    for (const call of sqlMock.mock.calls as unknown as unknown[][]) {
      const text = (call[0] as TemplateStringsArray)?.join?.(' ') ?? ''
      expect(text).not.toMatch(/organisation_modules/i)
    }
  })

  it('11. existing CRM tenant isolation remains intact — the underlying query still filters by organisation_id', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([])
    await companiesRoute.GET()
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).toMatch(/organisation_id/i)
    expect(call).toContain('org-a')
  })

  it('12. super_admin/org_override semantics — the capability check uses whatever effective organisationId requireSession() resolves, not a separately-cached "home" organisation', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    queue([])
    // requireSession() is the sole source of organisationId; simulating
    // an org_override-resolved session (a different org than the
    // caller's own) proves the route has no separate/cached org source.
    requireSessionMock.mockResolvedValue({ userId: 'super-admin-1', organisationId: 'overridden-org-id', role: 'super_admin' })
    await companiesRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('overridden-org-id', 'crm')
  })

  it('13. capability denial occurs before CRM database mutation (POST)', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const req = asNextRequest(new Request('http://localhost/api/crm/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Acme' }),
    }))
    const res = await companiesRoute.POST(req)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('companies/[id] GET/PUT/DELETE are each individually gated', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const getRes = await companiesIdRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    expect(getRes.status).toBe(403)
    const putRes = await companiesIdRoute.PUT(
      asNextRequest(new Request('http://localhost/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' }) })),
      CTX,
    )
    expect(putRes.status).toBe(403)
    const delRes = await companiesIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), CTX)
    expect(delRes.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('CRM capability enforcement — Gmail search (requirement 14)', () => {
  it('14. capability denial occurs before Gmail-search external/token-backed work proceeds', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const req = asNextRequest(new Request('http://localhost/api/crm/gmail-search?email=a@b.com'))
    const res = await gmailSearchRoute.GET(req)
    expect(res.status).toBe(403)
    expect(getValidAccessTokenMock).not.toHaveBeenCalled()
  })

  it('entitled caller reaches the Gmail token lookup', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
    getValidAccessTokenMock.mockResolvedValue(null) // not connected — short-circuits before any real Gmail fetch
    const req = asNextRequest(new Request('http://localhost/api/crm/gmail-search?email=a@b.com'))
    const res = await gmailSearchRoute.GET(req)
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401) // existing "Gmail not connected" behaviour, unchanged
  })
})

describe('CRM capability enforcement — full handler coverage across all 9 routes (requirement 15)', () => {
  // Parameterized coverage proving every exported handler in the
  // approved nine-route boundary requires CRM entitlement before any
  // CRM work proceeds — not just the representative routes above.
  const handlers: { name: string; call: () => Promise<Response> }[] = [
    { name: 'companies GET (list)', call: () => companiesRoute.GET() },
    { name: 'companies POST', call: () => companiesRoute.POST(asNextRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))) },
    { name: 'companies/[id] GET', call: () => companiesIdRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX) },
    { name: 'companies/[id] PUT', call: () => companiesIdRoute.PUT(asNextRequest(new Request('http://localhost/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })), CTX) },
    { name: 'companies/[id] DELETE', call: () => companiesIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), CTX) },
    { name: 'contacts GET (list)', call: () => contactsRoute.GET(asNextRequest(new Request('http://localhost/x'))) },
    { name: 'contacts POST', call: () => contactsRoute.POST(asNextRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))) },
    { name: 'contacts/[id] GET', call: () => contactsIdRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX) },
    { name: 'contacts/[id] PUT', call: () => contactsIdRoute.PUT(asNextRequest(new Request('http://localhost/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })), CTX) },
    { name: 'contacts/[id] DELETE', call: () => contactsIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), CTX) },
    { name: 'deals GET (list)', call: () => dealsRoute.GET(asNextRequest(new Request('http://localhost/x'))) },
    { name: 'deals POST', call: () => dealsRoute.POST(asNextRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))) },
    { name: 'deals/[id] GET', call: () => dealsIdRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX) },
    { name: 'deals/[id] PUT', call: () => dealsIdRoute.PUT(asNextRequest(new Request('http://localhost/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })), CTX) },
    { name: 'deals/[id] DELETE', call: () => dealsIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), CTX) },
    { name: 'activities GET (list)', call: () => activitiesRoute.GET(asNextRequest(new Request('http://localhost/x'))) },
    { name: 'activities POST', call: () => activitiesRoute.POST(asNextRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))) },
    { name: 'activities/[id] DELETE', call: () => activitiesIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), CTX) },
    { name: 'gmail-search GET', call: () => gmailSearchRoute.GET(asNextRequest(new Request('http://localhost/x?email=a@b.com'))) },
  ]

  it(`exactly ${handlers.length} exported CRM handlers are covered by this parameterized suite (19 expected — 2+3+2+3+2+3+2+1+1 across the nine approved route files)`, () => {
    expect(handlers).toHaveLength(19)
  })

  for (const { name, call } of handlers) {
    it(`15. ${name} is gated — denies with 403 and never reaches CRM SQL/Gmail work when not entitled`, async () => {
      requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
      const res = await call()
      expect(res.status).toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
      expect(getValidAccessTokenMock).not.toHaveBeenCalled()
      expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'crm')
    })
  }
})
