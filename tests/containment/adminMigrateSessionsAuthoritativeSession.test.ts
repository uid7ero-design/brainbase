import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B1 — POST /api/admin/migrate-sessions was gated on raw getSession()
// + `session.role !== 'super_admin'`, a JWT-only claim never revalidated
// against the DB. Now gated on requireRole('super_admin') (lib/org.ts),
// which re-reads the caller's current role/organisation assignment from
// the database on every call. This route has NO overall failure path —
// every migration step catches its own error into `results` and the
// route always responds 200 — so containment here means: on auth
// rejection, none of the five per-step try blocks below ever runs.
//
// Mocking follows the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts (which tests
// lib/org.ts's requireSession() directly): @/lib/session's getSession,
// @/lib/db's sql (queue-based — requireSession's own DB lookup is now the
// FIRST sql call every request makes), and next/headers' cookies()
// (read by requireSession for a super_admin's org_override).

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function migrateSessionsRequest(): NextRequest {
  return asNextRequest(new Request('http://localhost/api/admin/migrate-sessions', { method: 'POST' }))
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

// The route's own trailing audit call is mocked to a no-op — its shape is
// covered separately below and in adminAuditLog.test.ts's SEC-1B1
// extension.
const auditMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('@/lib/admin/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auditLog')>()
  return { ...actual, logSessionMigrationExecuted: (...args: unknown[]) => auditMock(...args) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_SUPER_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'super_admin' }

const { POST } = await import('@/app/api/admin/migrate-sessions/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
})

describe('POST /api/admin/migrate-sessions — behavioural', () => {
  it('rejects with 403 when there is no session, before running any SQL', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the DB-current role is below super_admin, before running any migration step (stale JWT / since-demoted user)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(403)
    // requireRole's own requireSession() lookup is the only sql call made.
    expect(calls.length).toBe(1)
    expect(calls.some(c => /CREATE TABLE\s+IF NOT EXISTS\s+sessions/i.test(c.text))).toBe(false)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the user has been deleted since the JWT was issued (no matching DB row)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'super_admin', name: 'Deleted User' })
    queue([])
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => /CREATE TABLE/i.test(c.text))).toBe(false)
  })

  it('rejects with 403 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Reassigned User' })
    queue([{ id: 'u1', organisation_id: 'org-b', role: 'super_admin' }])
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => /CREATE TABLE/i.test(c.text))).toBe(false)
  })

  it('rejects with 403 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Deactivated User' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'super_admin', status: 'INACTIVE' }])
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => /CREATE TABLE/i.test(c.text))).toBe(false)
  })

  it('as a currently-active DB-confirmed super_admin, runs every migration step and always responds 200 with { ok: true, results } — unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBe(5) // sessions table, sessions indexes, session_instances table, session_instances indexes, bookings column

    expect(calls.some(c => /CREATE TABLE\s+IF NOT EXISTS\s+sessions/i.test(c.text))).toBe(true)
    expect(calls.some(c => /CREATE TABLE\s+IF NOT EXISTS\s+session_instances/i.test(c.text))).toBe(true)
    expect(calls.some(c => c.text.includes('idx_sessions_org'))).toBe(true)
    expect(calls.some(c => c.text.includes('idx_session_instances_session_id'))).toBe(true)
    expect(calls.some(c => c.text.includes('bookings') && c.text.includes('session_instance_id'))).toBe(true)
  })

  it('a per-step failure is caught into results as "✗ ..." and does not abort the remaining steps or the 200 response — unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    // Call 0: requireSession's own lookup. Call 1: the "sessions" CREATE
    // TABLE step — made to throw. Every later call succeeds (default []).
    sqlMock.mockImplementationOnce(() => Promise.resolve([ACTIVE_SUPER_ADMIN_ROW]))
    sqlMock.mockImplementationOnce(() => { throw new Error('simulated failure') })
    const res = await POST(migrateSessionsRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results[0]).toMatch(/^✗ sessions:/)
    expect(body.results.length).toBe(5)
  })

  it('a partial-failure run is audited with the SAME failing per-step results the client received — session_migration.executed must not imply every step succeeded', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    sqlMock.mockImplementationOnce(() => Promise.resolve([ACTIVE_SUPER_ADMIN_ROW]))
    sqlMock.mockImplementationOnce(() => { throw new Error('simulated failure') })
    const res = await POST(migrateSessionsRequest())
    const body = await res.json()

    expect(body.results.some((r: string) => r.startsWith('✗'))).toBe(true) // the response itself is honest about the failure
    expect(auditMock).toHaveBeenCalledTimes(1)
    const auditedResults = (auditMock.mock.calls[0]?.[0] as { results: string[] }).results
    // The audit's after_state.results is not a sanitized "all good" summary
    // — it is the identical array, failure markers included, that the
    // response returned. logSessionMigrationExecuted / action
    // 'session_migration.executed' means "the operation ran, here are its
    // per-step results" — never "every step succeeded".
    expect(auditedResults).toEqual(body.results)
    expect(auditedResults.some(r => r.startsWith('✗'))).toBe(true)
  })

  it('the audit event is written unconditionally on completion (this route has no overall failure path), carrying the actor and the same results summary the response returns', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin One' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const res = await POST(migrateSessionsRequest())
    const body = await res.json()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: 'admin1',
      actorOrganisationId: 'org-a',
      results: body.results,
    })
  })
})
