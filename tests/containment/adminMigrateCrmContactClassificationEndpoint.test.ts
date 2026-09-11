import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Urgent CRM Production schema repair — POST /api/admin/migrate/crm-
// contact-classification is a narrow, targeted alternative to legacy
// POST /api/admin/migrate, added specifically because that route's own
// unrelated, pre-existing waste_records step was found to fail (a real
// UUID-vs-TEXT organisation_id foreign key type mismatch) before ever
// reaching classification step 42 — see that endpoint's own file header
// for the full incident context. This file proves the new endpoint:
// (1) uses the exact same auth model as /api/admin/migrate (session +
// super_admin, nothing else — no API key, no bypass header); (2) runs
// ONLY the three classification statements, never any other migration
// SQL; (3) is additive/idempotent and never writes to existing
// crm_contacts rows. Semantic equivalence with the standalone SQL file
// and legacy step 42 is covered separately in
// tests/containment/adminMigrateContactClassificationStep.test.ts.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

const endpointSource = read('app/api/admin/migrate/crm-contact-classification/route.ts')

// ─────────────────────────────────────────────────────────────────────
// STATIC
// ─────────────────────────────────────────────────────────────────────

describe('app/api/admin/migrate/crm-contact-classification/route.ts — static shape', () => {
  it('uses the same auth THRESHOLD as /api/admin/migrate — super_admin, nothing else — now via the DB-authoritative requireRole(), not raw getSession()', () => {
    // SEC-1B1 replaced raw getSession()+manual-role-comparison with
    // requireRole('super_admin') (lib/org.ts): same threshold, DB-
    // authoritative mechanism, so a since-disabled/demoted/deleted/
    // reassigned user's still-valid JWT can no longer trigger this route.
    expect(endpointSource).toContain("import { requireRole } from '@/lib/org'")
    expect(endpointSource).toMatch(/requireRole\('super_admin'\)/)
    expect(endpointSource).toContain("status: 403")
    // No alternate auth surface of any kind.
    expect(endpointSource).not.toMatch(/x-api-key|authorization|bearer|apiKey|api_key|secret/i)
  })

  it('never imports or references any secret/connection-string material directly — only the shared @/lib/db sql client', () => {
    expect(endpointSource).toContain("import sql from '@/lib/db'")
    expect(endpointSource).not.toMatch(/DATABASE_URL|process\.env\./)
  })

  it('the success response is small and explicit: { success: true, migration: "crm_contacts.classification" }', () => {
    expect(endpointSource).toMatch(/success:\s*true,\s*migration:\s*'crm_contacts\.classification'/)
  })

  it('the failure response never includes a stack trace or raw error detail', () => {
    const catchBlock = endpointSource.slice(endpointSource.indexOf('} catch'))
    expect(catchBlock).not.toMatch(/\berr\.stack\b/)
    expect(catchBlock).not.toMatch(/\bstack\b\s*:/)
    expect(catchBlock).toMatch(/status:\s*500/)
  })

  it('performs exactly three sql`` statements — column, guarded constraint, index — and nothing else', () => {
    const sqlCalls = [...endpointSource.matchAll(/await sql`/g)]
    expect(sqlCalls.length).toBe(3)
  })

  it('runs no other migration statement — no other CREATE TABLE, no reference to any other table name in the executable code (the file\'s own doc comment legitimately names waste_records in prose, explaining why this endpoint exists — only the function body matters here)', () => {
    const functionBody = endpointSource.slice(endpointSource.indexOf('export async function POST'))
    expect(functionBody).not.toMatch(/CREATE TABLE/)
    for (const otherTable of ['waste_records', 'fleet_metrics', 'organisations', 'users', 'organiser_activity', 'tennis_leads']) {
      expect(functionBody).not.toContain(otherTable)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// BEHAVIOURAL
// ─────────────────────────────────────────────────────────────────────

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function classificationRequest(): NextRequest {
  return asNextRequest(new Request('http://localhost/api/admin/migrate/crm-contact-classification', { method: 'POST' }))
}

// SEC-1B1: requireRole('super_admin') (lib/org.ts) replaces raw getSession()
// as the route's gate — mocked per the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts.
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
// covered separately in tests/containment/adminAuditLog.test.ts's SEC-1B1
// extension — so success-path assertions here only need to reason about
// the three classification sql calls.
const auditMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('@/lib/admin/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/auditLog')>()
  return { ...actual, logCrmClassificationMigrationExecuted: (...args: unknown[]) => auditMock(...args) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

// The DB row a currently-active super_admin resolves to on every
// requireRole() call in this suite.
const ACTIVE_SUPER_ADMIN_ROW = { id: 'admin1', organisation_id: 'org-a', role: 'super_admin' }

const { POST } = await import('@/app/api/admin/migrate/crm-contact-classification/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  auditMock.mockClear()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
})

describe('POST /api/admin/migrate/crm-contact-classification — behavioural', () => {
  it('unauthenticated (no session) is rejected with 403, no SQL runs', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await POST(classificationRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Forbidden' })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('authenticated but the DB-current role is not super_admin is rejected with 403, no migration statement runs (stale JWT / since-demoted user)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    const res = await POST(classificationRequest())
    expect(res.status).toBe(403)
    // requireRole's own requireSession() lookup is the only sql call made.
    expect(calls.length).toBe(1)
    expect(calls[0].text).not.toContain('crm_contacts')
  })

  it('a since-deleted user (no matching DB row) is rejected with 403, no migration statement runs', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'super_admin', name: 'Deleted User' })
    queue([])
    const res = await POST(classificationRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('crm_contacts'))).toBe(false)
  })

  it('a deactivated user (status INACTIVE) is rejected with 403, no migration statement runs', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Deactivated User' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'super_admin', status: 'INACTIVE' }])
    const res = await POST(classificationRequest())
    expect(res.status).toBe(403)
    expect(calls.some(c => c.text.includes('crm_contacts'))).toBe(false)
  })

  it('a currently-active DB-confirmed super_admin executes exactly the three classification statements, in order, and only those', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    const res = await POST(classificationRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, migration: 'crm_contacts.classification' })

    // Call 0 is requireRole's own requireSession() DB lookup; the three
    // classification statements follow it.
    expect(sqlMock).toHaveBeenCalledTimes(4)
    expect(calls[1].text).toContain('ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT')
    expect(calls[2].text).toContain('crm_contacts_classification_check')
    expect(calls[2].text).toContain('EVENT_CONTACT')
    expect(calls[3].text).toContain('idx_crm_contacts_classification')
    expect(calls[3].text).toContain('ON crm_contacts(organisation_id, classification)')

    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ actorUserId: 'admin1', actorOrganisationId: 'org-a' })
  })

  it('runs no legacy migration SQL — no migration-step call references any table other than crm_contacts', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    await POST(classificationRequest())
    for (const call of calls.slice(1)) {
      expect(call.text).toContain('crm_contacts')
      for (const otherTable of ['waste_records', 'fleet_metrics', 'organisations', 'organiser_activity', 'tennis_leads', 'uploaded_files']) {
        expect(call.text).not.toContain(otherTable)
      }
    }
  })

  it('no call is an UPDATE/DELETE/INSERT against crm_contacts', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin' })
    queue([ACTIVE_SUPER_ADMIN_ROW])
    await POST(classificationRequest())
    const writes = calls.filter(c =>
      /UPDATE|DELETE|INSERT/i.test(c.text) && !c.text.includes('ADD COLUMN') && !c.text.includes('ADD CONSTRAINT'),
    )
    expect(writes).toEqual([])
  })

  it('no audit event is written when authorization fails', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'Stale JWT' })
    queue([{ id: 'u1', organisation_id: 'org-a', role: 'manager' }])
    await POST(classificationRequest())
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('returns 500 with a generic message (no stack, no error detail) if a migration statement throws, and does not write an audit event', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin' })
    // First call (requireSession's own lookup) succeeds; the first
    // migration statement then throws.
    sqlMock.mockImplementationOnce(() => Promise.resolve([ACTIVE_SUPER_ADMIN_ROW]))
    sqlMock.mockImplementationOnce(() => { throw new Error('simulated DB failure with sensitive internal detail') })
    const res = await POST(classificationRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Migration failed.' })
    expect(JSON.stringify(body)).not.toContain('simulated DB failure')
    expect(auditMock).not.toHaveBeenCalled()
  })
})
