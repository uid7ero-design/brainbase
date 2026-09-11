import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B2 — the five founder-action mutation routes (add-lead,
// advance-client-stage, follow-up-client, log-demo,
// mark-analysis-reviewed) were each gated on raw getSession() +
// `session.role !== 'super_admin'`, a JWT-only claim never revalidated
// against the DB, forwarding `triggered_by: session.userId` (also from
// that same stale claim) to BrainBase's own internal Founder OS backend
// as a state-changing proxy mutation. Now gated on
// requireRole('super_admin') (lib/org.ts), which re-reads the caller's
// current role/organisation/status from the database on every call —
// `triggered_by` still carries session.userId (same value), just
// DB-confirmed current before the call is made, so the backend payload
// contract is unchanged.
//
// process.env.NEXT_PUBLIC_API_URL is set BEFORE the dynamic import (same
// module-level-const constraint documented in
// founderReadRoutesLiveBackend.test.ts) so both the "backend configured"
// and "backend not configured" paths can be exercised — the latter via
// deleting the env var per-test AFTER import has no effect on the
// already-captured module constant, so backend-unreachable/non-ok
// coverage is done via fetchMock rejection/non-ok response instead of
// unsetting the var.

process.env.NEXT_PUBLIC_API_URL = 'https://founder-backend.example.com'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function postRequest(url: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, {
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
  return { ...actual, logFounderActionExecuted: (...args: unknown[]) => auditMock(...args) }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_SUPER_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'super_admin' }

const { POST: postAddLead } = await import('@/app/api/admin/founder-action/add-lead/route')
const { POST: postAdvanceStage } = await import('@/app/api/admin/founder-action/advance-client-stage/route')
const { POST: postFollowUp } = await import('@/app/api/admin/founder-action/follow-up-client/route')
const { POST: postLogDemo } = await import('@/app/api/admin/founder-action/log-demo/route')
const { POST: postMarkReviewed } = await import('@/app/api/admin/founder-action/mark-analysis-reviewed/route')

const ROUTES = [
  {
    label: 'add-lead',
    POST: postAddLead,
    url: 'http://localhost/api/admin/founder-action/add-lead',
    backendPath: '/founder-action/add-lead',
    validBody: { org: 'Port Adelaide', contact_name: 'Jane', stage: 'lead' },
    action: 'add-lead',
    fallbackAction: 'lead_added',
  },
  {
    label: 'advance-client-stage',
    POST: postAdvanceStage,
    url: 'http://localhost/api/admin/founder-action/advance-client-stage',
    backendPath: '/founder-action/advance-client-stage',
    validBody: { client_id: 1, org: 'Port Adelaide', stage: 'proposal' },
    action: 'advance-client-stage',
    fallbackAction: 'stage_advanced',
  },
  {
    label: 'follow-up-client',
    POST: postFollowUp,
    url: 'http://localhost/api/admin/founder-action/follow-up-client',
    backendPath: '/founder-action/follow-up-client',
    validBody: { client_id: 1, org: 'Port Adelaide', note: 'called' },
    action: 'follow-up-client',
    fallbackAction: 'follow_up_logged',
  },
  {
    label: 'log-demo',
    POST: postLogDemo,
    url: 'http://localhost/api/admin/founder-action/log-demo',
    backendPath: '/founder-action/log-demo',
    validBody: { org: 'Port Adelaide', date: '2026-01-01' },
    action: 'log-demo',
    fallbackAction: 'demo_logged',
  },
  {
    label: 'mark-analysis-reviewed',
    POST: postMarkReviewed,
    url: 'http://localhost/api/admin/founder-action/mark-analysis-reviewed',
    backendPath: '/founder-action/mark-analysis-reviewed',
    validBody: { analysis_id: 'a1', org: 'Port Adelaide' },
    action: 'mark-analysis-reviewed',
    fallbackAction: 'analysis_reviewed',
  },
]

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  fetchMock.mockReset()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

for (const route of ROUTES) {
  describe(`POST /api/admin/founder-action/${route.label} — authorization`, () => {
    it('rejects with 403 when there is no session, before any backend fetch', async () => {
      getSessionMock.mockResolvedValue(null)
      const res = await route.POST(postRequest(route.url, route.validBody))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the DB-current role is below super_admin (stale JWT / since-demoted user), before any backend fetch', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
      queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
      const res = await route.POST(postRequest(route.url, route.validBody))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the user has been deleted since the JWT was issued', async () => {
      getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'super_admin', name: 'Deleted User' })
      queue([])
      const res = await route.POST(postRequest(route.url, route.validBody))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Reassigned User' })
      queue([{ id: 'u1', organisation_id: 'org-b', role: 'super_admin' }])
      const res = await route.POST(postRequest(route.url, route.validBody))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects with 403 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Deactivated User' })
      queue([{ id: 'u1', organisation_id: 'org-a', role: 'super_admin', status: 'INACTIVE' }])
      const res = await route.POST(postRequest(route.url, route.validBody))
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe(`POST /api/admin/founder-action/${route.label} — existing behaviour preserved`, () => {
    it('forwards triggered_by as the DB-confirmed userId (same value the stale JWT would have carried), plus the original body, unchanged payload shape', async () => {
      getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
      queue([ACTIVE_SUPER_ADMIN_ROW])
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

      await route.POST(postRequest(route.url, route.validBody))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://founder-backend.example.com${route.backendPath}`)
      const sentBody = JSON.parse(init.body as string)
      expect(sentBody).toMatchObject({ ...route.validBody, triggered_by: 'admin1' })
    })

    it('when the backend call succeeds, returns its response unmodified', async () => {
      getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
      queue([ACTIVE_SUPER_ADMIN_ROW])
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, id: 'server-assigned-id' }) })

      const res = await route.POST(postRequest(route.url, route.validBody))
      const body = await res.json()
      expect(body).toEqual({ ok: true, id: 'server-assigned-id' })
    })

    it('when the backend is unreachable, still returns the same local ok:true fallback shape as before (pre-existing behaviour, unchanged)', async () => {
      getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
      queue([ACTIVE_SUPER_ADMIN_ROW])
      fetchMock.mockRejectedValue(new Error('connection refused'))

      const res = await route.POST(postRequest(route.url, route.validBody))
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean; action: string }
      expect(body.ok).toBe(true)
      expect(body.action).toBe(route.fallbackAction)
    })
  })

  describe(`POST /api/admin/founder-action/${route.label} — audit`, () => {
    it('a successful proxied mutation writes exactly one audit event, honestly recording backendInvoked/backendOk', async () => {
      getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
      queue([ACTIVE_SUPER_ADMIN_ROW])
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

      await route.POST(postRequest(route.url, route.validBody))
      expect(auditMock).toHaveBeenCalledTimes(1)
      expect(auditMock.mock.calls[0]?.[0]).toMatchObject({
        actorUserId: 'admin1',
        actorOrganisationId: 'org-a',
        action: route.action,
        backendInvoked: true,
        backendOk: true,
      })
    })

    it('when the backend is unreachable, the audit event still fires but is honest that the external mutation did NOT succeed (backendOk: false) — even though the client-facing response still says ok:true', async () => {
      getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
      queue([ACTIVE_SUPER_ADMIN_ROW])
      fetchMock.mockRejectedValue(new Error('connection refused'))

      const res = await route.POST(postRequest(route.url, route.validBody))
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(true) // the client-facing fallback response (pre-existing behaviour)
      expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ action: route.action, backendInvoked: true, backendOk: false })
    })

    it('no audit event is written when authorization fails', async () => {
      getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
      queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
      await route.POST(postRequest(route.url, route.validBody))
      expect(auditMock).not.toHaveBeenCalled()
    })
  })
}

describe('POST /api/admin/founder-action/add-lead — validation preserved', () => {
  it('still rejects with 400 when org is missing/blank, before any backend fetch or audit', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const res = await postAddLead(postRequest('http://localhost/api/admin/founder-action/add-lead', { org: '  ' }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/founder-action/log-demo — validation preserved', () => {
  it('still rejects with 400 when org or date is missing, before any backend fetch or audit', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const res = await postLogDemo(postRequest('http://localhost/api/admin/founder-action/log-demo', { org: 'Port Adelaide', date: '' }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
