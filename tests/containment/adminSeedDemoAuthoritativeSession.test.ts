import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B1 — POST /api/admin/seed-demo was gated on raw getSession() +
// `['super_admin','admin'].includes(session.role)`, a JWT-only claim
// never revalidated against the DB, with `orgId` taken straight from the
// JWT's own organisationId claim. Now gated on requireRole('admin')
// (lib/org.ts) — the exact existing-helper equivalent of that same
// two-role threshold (lib/session.ts's ROLE_ORDER places 'admin' below
// 'super_admin'; roleGte()-based requireRole('admin') accepts both) — and
// orgId comes from requireSession()'s DB-authoritative resolution, whose
// own cross-org-switch protection rejects a since-reassigned caller's
// stale JWT outright rather than silently reseeding data into their old
// organisation. This route has NO try/catch anywhere: an uncaught
// exception at any point aborts the whole function, so containment here
// means an auth rejection produces zero writes to any table this route
// touches (uploaded_files, waste_records, fleet_metrics,
// service_requests, kpi_rules, modules, organisation_modules) and no
// audit event.
//
// Mocking follows the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts (which tests
// lib/org.ts's requireSession() directly): @/lib/session's getSession,
// @/lib/db's sql (queue-based — requireSession's own DB lookup is now the
// FIRST sql call every request makes), and next/headers' cookies() (read
// by requireSession for a super_admin's org_override).

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function seedDemoRequest(): NextRequest {
  return asNextRequest(new Request('http://localhost/api/admin/seed-demo', { method: 'POST' }))
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
  return { ...actual, logDemoSeedExecuted: (...args: unknown[]) => auditMock(...args) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'admin' }
const ACTIVE_SUPER_ADMIN_ROW = { id: 'sa1', organisation_id: 'org-a', role: 'super_admin' }

// Queues a fresh-org run: requireSession's user lookup, then the
// existingFile lookup (empty — no prior demo file for this org), then the
// INSERT INTO uploaded_files RETURNING id.
function queueFreshOrgRun(userRow: Record<string, unknown>, fileId = 'file-1') {
  queue([userRow], [], [{ id: fileId }])
}

const { POST } = await import('@/app/api/admin/seed-demo/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
})

describe('POST /api/admin/seed-demo — authorization', () => {
  it('rejects with 403 when there is no session, before running any SQL', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the DB-current role is below admin, before touching any table (stale JWT / since-demoted user)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(403)
    // requireRole's own requireSession() lookup is the only sql call made.
    expect(calls.length).toBe(1)
    expect(calls.some(c => c.text.includes('uploaded_files'))).toBe(false)
    expect(calls.some(c => /waste_records|fleet_metrics|service_requests/i.test(c.text))).toBe(false)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the user has been deleted since the JWT was issued (no matching DB row)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'admin', name: 'Deleted User' })
    queue([])
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('uploaded_files'))).toBe(false)
  })

  it('rejects with 403 when the user has been reassigned to a different organisation since the JWT was issued — no seeding of either the old or new org', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'admin', name: 'Reassigned User' })
    queue([{ id: 'u1', organisation_id: 'org-b', role: 'admin' }])
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('uploaded_files'))).toBe(false)
  })

  it('rejects with 403 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'admin', name: 'Deactivated User' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'admin', status: 'INACTIVE' }])
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('uploaded_files'))).toBe(false)
  })

  it('accepts a currently-active DB-confirmed admin (the lower half of the original two-role threshold)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'admin', name: 'Admin One' })
    queueFreshOrgRun(ACTIVE_ADMIN_ROW)
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(200)
  })

  it('accepts a currently-active DB-confirmed super_admin (the upper half of the original two-role threshold)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'sa1', organisationId: 'org-a', role: 'super_admin', name: 'Super Admin' })
    queueFreshOrgRun(ACTIVE_SUPER_ADMIN_ROW)
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(200)
  })

  it('rejects a DB-confirmed manager (excluded from the original threshold, same as before)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'm1', organisationId: 'org-a', role: 'manager', name: 'Manager' })
    queue([{ id: 'm1', organisation_id: 'org-a', role: 'manager' }])
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('uploaded_files'))).toBe(false)
  })
})

describe('POST /api/admin/seed-demo — existing behaviour preserved for an authorized admin', () => {
  it('creates a new demo uploaded_files row when none exists yet, using the org resolved from the DB session (not a raw JWT claim)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'admin', name: 'Admin One' })
    queueFreshOrgRun(ACTIVE_ADMIN_ROW, 'new-file-1')
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(200)

    const insertFileCall = calls.find(c => c.text.includes('INSERT INTO uploaded_files'))
    expect(insertFileCall).toBeDefined()
    expect(insertFileCall!.text).toContain("'demo-seed.csv'")
    expect(insertFileCall!.values).toContain('org-a')

    // No DELETE clearing statements on the fresh-file path.
    expect(calls.some(c => c.text.includes('DELETE FROM waste_records'))).toBe(false)
  })

  it('clears prior demo data for an existing demo file, scoped to this org and file, before reseeding — unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'admin', name: 'Admin One' })
    queue([ACTIVE_ADMIN_ROW], [{ id: 'existing-file-1' }])
    const res = await POST(seedDemoRequest())
    expect(res.status).toBe(200)

    expect(calls.some(c => c.text.includes('DELETE FROM waste_records') && c.values.includes('org-a') && c.values.includes('existing-file-1'))).toBe(true)
    expect(calls.some(c => c.text.includes('DELETE FROM fleet_metrics'))).toBe(true)
    expect(calls.some(c => c.text.includes('DELETE FROM service_requests'))).toBe(true)
    // No fresh-file INSERT on the existing-file path.
    expect(calls.some(c => c.text.includes('INSERT INTO uploaded_files'))).toBe(false)
  })

  it('seeds the exact same fixed-size demo dataset (8 suburbs × 12 months × 4 service types of waste records; 8 vehicles × 12 months of fleet metrics) and enables the same three default modules', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'admin', name: 'Admin One' })
    queueFreshOrgRun(ACTIVE_ADMIN_ROW)
    const res = await POST(seedDemoRequest())
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.counts.wasteRecords).toBe(8 * 12 * 4)
    expect(body.counts.fleetMetrics).toBe(8 * 12)
    expect(typeof body.counts.serviceRequests).toBe('number')
    expect(body.counts.serviceRequests).toBeGreaterThan(0)
    expect(body.message).toContain('Modules enabled: waste_recycling, fleet_management, service_requests')

    const wasteInserts = calls.filter(c => c.text.includes('INSERT INTO waste_records'))
    expect(wasteInserts.length).toBe(body.counts.wasteRecords)
    const fleetInserts = calls.filter(c => c.text.includes('INSERT INTO fleet_metrics'))
    expect(fleetInserts.length).toBe(body.counts.fleetMetrics)
    const srInserts = calls.filter(c => c.text.includes('INSERT INTO service_requests'))
    expect(srInserts.length).toBe(body.counts.serviceRequests)
  })
})

describe('POST /api/admin/seed-demo — audit', () => {
  it('a successful seed run writes exactly one audit event, attributing the actor, the org actually seeded, the file, counts, and enabled modules', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'admin', name: 'Admin One' })
    queueFreshOrgRun(ACTIVE_ADMIN_ROW, 'file-xyz')
    const res = await POST(seedDemoRequest())
    const body = await res.json()

    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: 'admin1',
      organisationId: 'org-a',
      fileId: 'file-xyz',
      counts: body.counts,
      enabledModules: ['waste_recycling', 'fleet_management', 'service_requests'],
    })
  })

  it('no audit event is written when authorization fails', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    await POST(seedDemoRequest())
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('no audit event is written if a write fails partway through (this route has no try/catch — an uncaught exception aborts before the audit call is reached)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'admin', name: 'Admin One' })
    queue([ACTIVE_ADMIN_ROW], [])
    sqlMock.mockImplementationOnce(() => Promise.resolve([ACTIVE_ADMIN_ROW]))
    sqlMock.mockImplementationOnce(() => Promise.resolve([]))
    sqlMock.mockImplementationOnce(() => { throw new Error('simulated DB failure partway through seeding') })
    await expect(POST(seedDemoRequest())).rejects.toThrow('simulated DB failure partway through seeding')
    expect(auditMock).not.toHaveBeenCalled()
  })
})
