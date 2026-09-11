import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B2 — POST /api/agents/route-test was gated on raw getSession() +
// `session.role !== 'super_admin'`, a JWT-only claim never revalidated
// against the DB, with organisationId/userId for the agent run taken
// straight from that same stale claim. This route can invoke four
// privileged agents (insight/action/briefing/dataIntake), at least two of
// which (insight, briefing) run org-scoped DB reads keyed off that
// organisationId. Now gated on requireRole('super_admin') (lib/org.ts),
// which re-reads the caller's current role/organisation/status from the
// database on every call.
//
// Mocking follows the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts, plus mocks for the
// agent modules and agentRouter so no real Anthropic call or DB agent
// query is ever made.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function routeTestRequest(body: unknown = { query: 'test query' }): NextRequest {
  return asNextRequest(new Request('http://localhost/api/agents/route-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
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
  return { ...actual, logAgentRunExecuted: (...args: unknown[]) => auditMock(...args) }
})

const routeToAgentMock = vi.fn()
vi.mock('@/lib/agents/agentRouter', () => ({ route: (...args: unknown[]) => routeToAgentMock(...args) }))

const insightRunMock = vi.fn()
const actionRunMock = vi.fn()
const briefingRunMock = vi.fn()
const dataIntakeRunMock = vi.fn()
vi.mock('@/lib/agents/insightAgent', () => ({ run: (...args: unknown[]) => insightRunMock(...args) }))
vi.mock('@/lib/agents/actionAgent', () => ({ run: (...args: unknown[]) => actionRunMock(...args) }))
vi.mock('@/lib/agents/briefingAgent', () => ({ run: (...args: unknown[]) => briefingRunMock(...args) }))
vi.mock('@/lib/agents/dataIntakeAgent', () => ({ run: (...args: unknown[]) => dataIntakeRunMock(...args) }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_SUPER_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'super_admin' }

const { POST } = await import('@/app/api/agents/route-test/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  routeToAgentMock.mockReset()
  insightRunMock.mockReset()
  actionRunMock.mockReset()
  briefingRunMock.mockReset()
  dataIntakeRunMock.mockReset()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
})

describe('POST /api/agents/route-test — authorization', () => {
  it('rejects with 403 when there is no session, before routing or running any agent', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await POST(routeTestRequest())
    expect(res.status).toBe(403)
    expect(routeToAgentMock).not.toHaveBeenCalled()
    expect(insightRunMock).not.toHaveBeenCalled()
    expect(actionRunMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the DB-current role is below super_admin, before routing or running any agent (stale JWT / since-demoted user)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    const res = await POST(routeTestRequest())
    expect(res.status).toBe(403)
    expect(routeToAgentMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the user has been deleted since the JWT was issued (no matching DB row)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'super_admin', name: 'Deleted User' })
    queue([])
    const res = await POST(routeTestRequest())
    expect(res.status).toBe(403)
    expect(routeToAgentMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Reassigned User' })
    queue([{ id: 'u1', organisation_id: 'org-b', role: 'super_admin' }])
    const res = await POST(routeTestRequest())
    expect(res.status).toBe(403)
    expect(routeToAgentMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Deactivated User' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'super_admin', status: 'INACTIVE' }])
    const res = await POST(routeTestRequest())
    expect(res.status).toBe(403)
    expect(routeToAgentMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/agents/route-test — existing behaviour preserved for an authorized super_admin', () => {
  it('routes using the DB-confirmed organisationId/userId, not a stale JWT claim, and invokes the routed agent', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    routeToAgentMock.mockResolvedValue({ agent: 'insight', confidence: 0.9 })
    insightRunMock.mockResolvedValue({ agentName: 'InsightAgent', summary: 'ok', findings: [], confidence: 0.9, recommendedActions: [], sourceRows: [], warnings: [] })

    const res = await POST(routeTestRequest({ query: 'how is contamination trending' }))
    expect(res.status).toBe(200)
    expect(routeToAgentMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a', userId: 'admin1' }))
    expect(insightRunMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a', userId: 'admin1' }))

    const body = await res.json()
    expect(body.fallbackUsed).toBe(false)
    expect(body.agentOutput).toMatchObject({ agentName: 'InsightAgent' })
  })

  it('rejects with 400 when query is missing/blank, before any routing or agent invocation', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const res = await POST(routeTestRequest({ query: '   ' }))
    expect(res.status).toBe(400)
    expect(routeToAgentMock).not.toHaveBeenCalled()
  })

  it('the chat fallback path never invokes any of the four agents', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    routeToAgentMock.mockResolvedValue({ agent: 'chat' })
    const res = await POST(routeTestRequest())
    const body = await res.json()
    expect(body.fallbackUsed).toBe(true)
    expect(body.agentOutput).toBeNull()
    expect(insightRunMock).not.toHaveBeenCalled()
    expect(actionRunMock).not.toHaveBeenCalled()
    expect(briefingRunMock).not.toHaveBeenCalled()
    expect(dataIntakeRunMock).not.toHaveBeenCalled()
  })

  it('an agent error is caught into agentError, not thrown to the client', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    routeToAgentMock.mockResolvedValue({ agent: 'action' })
    actionRunMock.mockRejectedValue(new Error('anthropic call failed'))
    const res = await POST(routeTestRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentError).toBe('anthropic call failed')
  })
})

describe('POST /api/agents/route-test — audit', () => {
  it('a successful run writes exactly one audit event, attributing the actor/org and which agent ran — never the query text itself', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    routeToAgentMock.mockResolvedValue({ agent: 'briefing' })
    briefingRunMock.mockResolvedValue({ agentName: 'BriefingAgent', summary: 'ok', findings: [], confidence: 0.8, recommendedActions: [], sourceRows: [], warnings: [] })

    await POST(routeTestRequest({ query: 'a sensitive query mentioning a real customer name' }))

    expect(auditMock).toHaveBeenCalledTimes(1)
    const payload = auditMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({ actorUserId: 'admin1', actorOrganisationId: 'org-a', agent: 'briefing', fallbackUsed: false, hadError: false })
    expect(JSON.stringify(payload)).not.toContain('sensitive query')
    expect(JSON.stringify(payload)).not.toContain('customer name')
  })

  it('no audit event is written when authorization fails', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    await POST(routeTestRequest())
    expect(auditMock).not.toHaveBeenCalled()
  })
})
