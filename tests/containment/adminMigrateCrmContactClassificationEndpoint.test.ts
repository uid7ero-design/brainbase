import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

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
  it('uses the exact same auth check as /api/admin/migrate — session + super_admin, nothing else', () => {
    expect(endpointSource).toContain("import { getSession } from '@/lib/session'")
    expect(endpointSource).toMatch(/const session = await getSession\(\)/)
    expect(endpointSource).toMatch(/if \(!session \|\| session\.role !== 'super_admin'\)/)
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

const getSessionMock = vi.fn()
vi.mock('@/lib/session', () => ({ getSession: () => getSessionMock() }))

let calls: { text: string; values: unknown[] }[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const { POST } = await import('@/app/api/admin/migrate/crm-contact-classification/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  calls = []
})

describe('POST /api/admin/migrate/crm-contact-classification — behavioural', () => {
  it('unauthenticated (no session) is rejected with 403, no SQL runs', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Forbidden' })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('authenticated but not super_admin is rejected with 403, no SQL runs', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'M', expiresAt: '2099-01-01' })
    const res = await POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('super_admin executes exactly the three classification statements, in order, and only those', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin', expiresAt: '2099-01-01' })
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, migration: 'crm_contacts.classification' })

    expect(sqlMock).toHaveBeenCalledTimes(3)
    expect(calls[0].text).toContain('ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT')
    expect(calls[1].text).toContain('crm_contacts_classification_check')
    expect(calls[1].text).toContain('EVENT_CONTACT')
    expect(calls[2].text).toContain('idx_crm_contacts_classification')
    expect(calls[2].text).toContain('ON crm_contacts(organisation_id, classification)')
  })

  it('runs no legacy migration SQL — no call references any table other than crm_contacts', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin', expiresAt: '2099-01-01' })
    await POST()
    for (const call of calls) {
      expect(call.text).toContain('crm_contacts')
      for (const otherTable of ['waste_records', 'fleet_metrics', 'organisations', 'organiser_activity', 'tennis_leads', 'uploaded_files']) {
        expect(call.text).not.toContain(otherTable)
      }
    }
  })

  it('no call is an UPDATE/DELETE/INSERT against crm_contacts', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin', expiresAt: '2099-01-01' })
    await POST()
    const writes = calls.filter(c =>
      /UPDATE|DELETE|INSERT/i.test(c.text) && !c.text.includes('ADD COLUMN') && !c.text.includes('ADD CONSTRAINT'),
    )
    expect(writes).toEqual([])
  })

  it('returns 500 with a generic message (no stack, no error detail) if the database call throws', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'org-a', role: 'super_admin', name: 'Admin', expiresAt: '2099-01-01' })
    sqlMock.mockImplementationOnce(() => { throw new Error('simulated DB failure with sensitive internal detail') })
    const res = await POST()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Migration failed.' })
    expect(JSON.stringify(body)).not.toContain('simulated DB failure')
  })
})
