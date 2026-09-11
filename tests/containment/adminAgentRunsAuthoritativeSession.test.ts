import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B2 — GET /api/admin/agent-runs was gated on raw getSession() +
// `session.role !== 'super_admin'`, a JWT-only claim never revalidated
// against the DB. This route is a deliberately cross-organisation admin
// report (orgId is an OPTIONAL filter — omitting it returns every org's
// agent-run stats plus the full org list), so a stale JWT here is a
// cross-tenant data-exposure risk, not just a privilege one. Now gated on
// requireRole('super_admin') (lib/org.ts), which re-reads the caller's
// current role/organisation/status from the database on every call.
//
// Mocking follows the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts (which tests
// lib/org.ts's requireSession() directly).

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function agentRunsRequest(qs = ''): NextRequest {
  return asNextRequest(new Request(`http://localhost/api/admin/agent-runs${qs}`, { method: 'GET' }))
}

const getSessionMock = vi.fn()
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

let calls: { text: string; values: unknown[] }[] = []
let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  }),
}))

const auditMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('@/lib/admin/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auditLog')>()
  return { ...actual, logAdminCrossOrgReadAccessed: (...args: unknown[]) => auditMock(...args) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_SUPER_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'super_admin' }

// After requireSession()'s own lookup (call 0), the route fires 5
// parallel queries (stats, byAgent, byRoute, recent, orgs) — default []
// for each is fine for every assertion below except where a test queues
// specific rows.
function queueForSuccessfulRun(userRow: Record<string, unknown>) {
  queue([userRow])
}

const { GET } = await import('@/app/api/admin/agent-runs/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
})

describe('GET /api/admin/agent-runs — authorization', () => {
  it('rejects with 403 when there is no session, before running any SQL', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await GET(agentRunsRequest())
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the DB-current role is below super_admin, before running any report query (stale JWT / since-demoted user)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    const res = await GET(agentRunsRequest())
    expect(res.status).toBe(403)
    // requireRole's own requireSession() lookup is the only sql call made.
    expect(calls.length).toBe(1)
    expect(calls.some(c => c.text.includes('agent_runs'))).toBe(false)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the user has been deleted since the JWT was issued (no matching DB row)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'super_admin', name: 'Deleted User' })
    queue([])
    const res = await GET(agentRunsRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('agent_runs'))).toBe(false)
  })

  it('rejects with 403 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Reassigned User' })
    queue([{ id: 'u1', organisation_id: 'org-b', role: 'super_admin' }])
    const res = await GET(agentRunsRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('agent_runs'))).toBe(false)
  })

  it('rejects with 403 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Deactivated User' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'super_admin', status: 'INACTIVE' }])
    const res = await GET(agentRunsRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('agent_runs'))).toBe(false)
  })

  it('as a currently-active DB-confirmed super_admin, the cross-org report runs and returns 200', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queueForSuccessfulRun(ACTIVE_SUPER_ADMIN_ROW)
    const res = await GET(agentRunsRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('stats')
    expect(body).toHaveProperty('byAgent')
    expect(body).toHaveProperty('byRoute')
    expect(body).toHaveProperty('recent')
    expect(body).toHaveProperty('orgs')
  })
})

describe('GET /api/admin/agent-runs — cross-org behaviour preserved', () => {
  it('omitting orgId still queries across every organisation (unchanged existing behaviour — this route is an intentional cross-org admin report)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queueForSuccessfulRun(ACTIVE_SUPER_ADMIN_ROW)
    await GET(agentRunsRequest())
    const statsCall = calls.find(c => c.text.includes('FROM agent_runs') && c.text.includes('total_runs'))
    expect(statsCall).toBeDefined()
    expect(statsCall!.values).toContain(null) // orgId param is null — no org filter applied
  })

  it('an explicit orgId query param is forwarded as the filter value, unchanged', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queueForSuccessfulRun(ACTIVE_SUPER_ADMIN_ROW)
    await GET(agentRunsRequest('?orgId=org-xyz'))
    const statsCall = calls.find(c => c.text.includes('FROM agent_runs') && c.text.includes('total_runs'))
    expect(statsCall!.values).toContain('org-xyz')
  })
})

describe('GET /api/admin/agent-runs — audit', () => {
  it('a successful cross-org read writes exactly one audit event, attributing the actor and the filters applied — never the actual row data', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queueForSuccessfulRun(ACTIVE_SUPER_ADMIN_ROW)
    await GET(agentRunsRequest('?orgId=org-xyz&agentName=insight'))

    expect(auditMock).toHaveBeenCalledTimes(1)
    const payload = auditMock.mock.calls[0]?.[0] as { actorUserId: string; actorOrganisationId: string; filters: Record<string, unknown> }
    expect(payload.actorUserId).toBe('admin1')
    expect(payload.actorOrganisationId).toBe('org-a')
    expect(payload.filters).toMatchObject({ orgId: 'org-xyz', agentName: 'insight' })
    // Never the raw row-level input_query text or any agent output.
    expect(JSON.stringify(payload)).not.toMatch(/input_query/)
  })

  it('no audit event is written when authorization fails', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    await GET(agentRunsRequest())
    expect(auditMock).not.toHaveBeenCalled()
  })
})
