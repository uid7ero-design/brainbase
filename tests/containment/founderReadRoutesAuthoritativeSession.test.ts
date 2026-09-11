import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B2 — the three founder read routes (founder-clients,
// founder-intelligence, founder-state) were each gated on raw getSession()
// + `session.role !== 'super_admin'`, a JWT-only claim never revalidated
// against the DB. They proxy read-only requests to BrainBase's own
// internal Founder OS backend (NEXT_PUBLIC_API_URL) — no tenant/customer
// data, no caller identity forwarded — falling back to an empty/mock
// response when the backend is unset or unreachable. Now gated on
// requireRole('super_admin') (lib/org.ts), which re-reads the caller's
// current role/organisation/status from the database on every call.
//
// One shared harness parameterized across the three routes, since their
// auth/proxy/fallback shape is identical; only the backend path, fallback
// payload, and audit `resource` differ.

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

const ROUTES = [
  { label: 'founder-clients', GET: getFounderClients, path: 'http://localhost/api/admin/founder-clients', resource: 'founder_clients', backendPath: '/founder-clients', fallbackSource: 'fallback' as const },
  { label: 'founder-intelligence', GET: getFounderIntelligence, path: 'http://localhost/api/admin/founder-intelligence', resource: 'founder_intelligence', backendPath: '/founder-intelligence', fallbackSource: 'demo' as const },
  { label: 'founder-state', GET: getFounderState, path: 'http://localhost/api/admin/founder-state', resource: 'founder_state', backendPath: '/founder-state', fallbackSource: 'fallback' as const },
]

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  fetchMock.mockReset()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
  delete process.env.NEXT_PUBLIC_API_URL
})

for (const route of ROUTES) {
  describe(`GET /api/admin/${route.label} — authorization`, () => {
    it('rejects with 403 when there is no session, before any backend fetch', async () => {
      getSessionMock.mockResolvedValue(null)
      const res = await route.GET(asNextRequest(new Request(route.path)))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the DB-current role is below super_admin (stale JWT / since-demoted user), before any backend fetch', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
      queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
      const res = await route.GET(asNextRequest(new Request(route.path)))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the user has been deleted since the JWT was issued', async () => {
      getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'super_admin', name: 'Deleted User' })
      queue([])
      const res = await route.GET(asNextRequest(new Request(route.path)))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Reassigned User' })
      queue([{ id: 'u1', organisation_id: 'org-b', role: 'super_admin' }])
      const res = await route.GET(asNextRequest(new Request(route.path)))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Deactivated User' })
      queue([{ id: 'u1', organisation_id: 'org-a', role: 'super_admin', status: 'INACTIVE' }])
      const res = await route.GET(asNextRequest(new Request(route.path)))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe(`GET /api/admin/${route.label} — existing behaviour preserved`, () => {
    it('with no backend configured, falls back to the same empty/mock response as before, and audits source as ' + route.fallbackSource, async () => {
      getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
      queue([ACTIVE_SUPER_ADMIN_ROW])
      const res = await route.GET(asNextRequest(new Request(route.path)))
      expect(res.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(auditMock).toHaveBeenCalledTimes(1)
      expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ actorUserId: 'admin1', actorOrganisationId: 'org-a', resource: route.resource, source: route.fallbackSource })
    })

    it('no audit event is written when authorization fails', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
      queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
      await route.GET(asNextRequest(new Request(route.path)))
      expect(auditMock).not.toHaveBeenCalled()
    })
  })
}

// Live-backend-path coverage (BACKEND configured + reachable) lives in
// tests/containment/founderReadRoutesLiveBackend.test.ts — these three
// routes read process.env.NEXT_PUBLIC_API_URL into a module-level const
// at import time, so it must be set BEFORE the dynamic import, in its own
// file/module graph, rather than toggled per-test here.
