import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B2 — companion to founderReadRoutesAuthoritativeSession.test.ts.
// These three routes read process.env.NEXT_PUBLIC_API_URL into a
// module-level const at import time, so exercising the "backend
// configured and reachable" path requires setting it BEFORE the dynamic
// import — hence its own file/module graph, separate from the
// no-backend-configured fallback coverage in the companion file.

process.env.NEXT_PUBLIC_API_URL = 'https://founder-backend.example.com'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const getSessionMock = vi.fn()
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  }),
}))

const auditMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('@/lib/admin/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auditLog')>()
  return { ...actual, logFounderReadAccessed: (...args: unknown[]) => auditMock(...args) }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_SUPER_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'super_admin' }

const { GET: getFounderClients } = await import('@/app/api/admin/founder-clients/route')
const { GET: getFounderIntelligence } = await import('@/app/api/admin/founder-intelligence/route')
const { GET: getFounderState } = await import('@/app/api/admin/founder-state/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  fetchMock.mockReset()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

describe('GET /api/admin/founder-intelligence — live backend path preserved exactly', () => {
  it('when the backend responds ok, returns its data tagged source: "live" (unchanged response shape) and audits source: "live"', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ summary: 'live summary', opportunities: [], risks: [], recommended_actions: [], attention_queue: [], system_alerts: [], confidence: 0.9, generated_at: '2026-01-01T00:00:00.000Z' }) })

    const res = await getFounderIntelligence(asNextRequest(new Request('http://localhost/api/admin/founder-intelligence')))
    const body = await res.json()
    expect(body.source).toBe('live')
    expect(body.summary).toBe('live summary')
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ resource: 'founder_intelligence', source: 'live' })
  })

  it('when the backend responds non-ok, falls back to mock tagged source: "demo" (unchanged existing behaviour)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    const res = await getFounderIntelligence(asNextRequest(new Request('http://localhost/api/admin/founder-intelligence')))
    const body = await res.json()
    expect(body.source).toBe('demo')
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ resource: 'founder_intelligence', source: 'demo' })
  })

  it('when the backend is unreachable, falls back to mock tagged source: "demo" (unchanged existing behaviour)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    fetchMock.mockRejectedValue(new Error('connection refused'))

    const res = await getFounderIntelligence(asNextRequest(new Request('http://localhost/api/admin/founder-intelligence')))
    const body = await res.json()
    expect(body.source).toBe('demo')
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ resource: 'founder_intelligence', source: 'demo' })
  })
})

describe('GET /api/admin/founder-clients — no caller identity is forwarded to the backend (unchanged)', () => {
  it('the outbound fetch carries no session/user/org identifying header or query param', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ clients: [] }) })

    await getFounderClients(asNextRequest(new Request('http://localhost/api/admin/founder-clients')))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://founder-backend.example.com/founder-clients')
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/admin1|org-a/)
  })

  it('live backend data is returned unmodified, and audited as source: "live"', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ clients: [{ id: 1, name: 'Port Adelaide' }] }) })

    const res = await getFounderClients(asNextRequest(new Request('http://localhost/api/admin/founder-clients')))
    const body = await res.json()
    expect(body).toEqual({ clients: [{ id: 1, name: 'Port Adelaide' }] })
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ resource: 'founder_clients', source: 'live' })
  })
})

describe('GET /api/admin/founder-state — live backend path preserved exactly', () => {
  it('the outbound fetch carries no session/user/org identifying header, and live data is returned unmodified', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const liveState = { attention_items: ['x'], recommendations: [], activity_events: [], notes: [], revenue_snapshot: { mrr: 1000 } }
    fetchMock.mockResolvedValue({ ok: true, json: async () => liveState })

    const res = await getFounderState(asNextRequest(new Request('http://localhost/api/admin/founder-state')))
    const body = await res.json()
    expect(body).toEqual(liveState)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://founder-backend.example.com/founder-state')
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/admin1|org-a/)
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ resource: 'founder_state', source: 'live' })
  })
})
