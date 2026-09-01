import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Bug fix: /clients (app/clients/page.tsx) excludes "the caller's own
// organisation" using WHERE o.id != ${session.organisationId} — but for
// a super_admin actively impersonating another org via the org_override
// cookie, session.organisationId IS the impersonated org, not the
// founder's own workspace. That silently excluded whichever org was
// currently being impersonated (e.g. School Test Organisation) from the
// /clients list, regardless of its own status/capabilities/plan.
//
// Fix: lib/org.ts's requireSession() now also returns
// homeOrganisationId — the caller's real, un-overridden organisation_id
// from `users`, resolved BEFORE any org_override substitution. This
// file tests requireSession() itself directly (mocked getSession/sql/
// cookies), proving the two fields diverge exactly when they should and
// never otherwise.

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

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const { requireSession } = await import('@/lib/org')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

describe('requireSession — homeOrganisationId vs. organisationId', () => {
  it('for a non-super_admin session, homeOrganisationId always equals organisationId (no override path exists for them)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'Manager One' })
    queue([{ id: 'user-1', organisation_id: 'org-a', role: 'manager' }])
    const session = await requireSession()
    expect(session.organisationId).toBe('org-a')
    expect(session.homeOrganisationId).toBe('org-a')
  })

  it('for a super_admin with NO org_override cookie set, homeOrganisationId equals organisationId equals their own DB org', async () => {
    getSessionMock.mockResolvedValue({ userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' })
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin' }])
    const session = await requireSession()
    expect(session.organisationId).toBe('brainbase-org')
    expect(session.homeOrganisationId).toBe('brainbase-org')
  })

  it('for a super_admin WITH an org_override cookie, organisationId becomes the impersonated org, but homeOrganisationId stays their own real org — the core fix', async () => {
    getSessionMock.mockResolvedValue({ userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' })
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin' }])
    cookieStore.set('org_override', 'school-test-org')

    const session = await requireSession()
    expect(session.organisationId).toBe('school-test-org') // every existing tenant-scoped query keeps working while impersonating
    expect(session.homeOrganisationId).toBe('brainbase-org') // but "my own workspace" is still correctly identifiable
    expect(session.organisationId).not.toBe(session.homeOrganisationId)
  })

  it('the override cookie has no effect for a non-super_admin session, even if somehow present', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'Manager One' })
    queue([{ id: 'user-1', organisation_id: 'org-a', role: 'manager' }])
    cookieStore.set('org_override', 'org-b')

    const session = await requireSession()
    expect(session.organisationId).toBe('org-a')
    expect(session.homeOrganisationId).toBe('org-a')
  })

  it('cross-org switch protection (JWT org no longer matches the DB row) still throws — unaffected by this change', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-1', organisationId: 'stale-org', role: 'manager', name: 'Manager One' })
    queue([{ id: 'user-1', organisation_id: 'org-a', role: 'manager' }]) // DB says org-a now, JWT says stale-org
    await expect(requireSession()).rejects.toThrow('Session invalid')
  })

  it('homeOrganisationId is always derived from the DB row (users.organisation_id), never from the JWT/session cookie payload directly', () => {
    const code = fs.readFileSync(path.join(process.cwd(), 'lib/org.ts'), 'utf8')
    const fnStart = code.indexOf('export async function requireSession')
    const fnBody = code.slice(fnStart)
    const homeIdx = fnBody.indexOf('const homeOrganisationId =')
    expect(homeIdx).toBeGreaterThan(-1)
    expect(fnBody.slice(homeIdx, homeIdx + 60)).toContain('user.organisation_id')
  })
})
