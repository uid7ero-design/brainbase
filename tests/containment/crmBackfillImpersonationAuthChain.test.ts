import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Production observation: a super_admin impersonating School Test
// Organisation (CRM + Events both enabled) saw the "This action
// requires an admin role and both the Events and CRM capabilities
// enabled for your organisation." denial on /crm/events-backfill.
//
// Every other test covering this route
// (tests/containment/crmEventBackfill.test.ts) mocks @/lib/org's
// requireSession() wholesale — proving the ROUTE's own logic is
// correct given whatever session shape the mock hands it, but never
// exercising the REAL interaction between requireSession()'s
// org_override substitution and requireCapability()'s own DB lookup.
// That gap is exactly where a session/capability-scoping mismatch
// would hide. This file closes it: it uses the REAL requireSession()
// (from lib/org.ts, unmocked) and the REAL requireCapability() (from
// lib/capabilities/requireCapability.ts, unmocked) — only their own
// dependencies (getSession, sql, cookies) are mocked — and chains them
// exactly as app/api/crm/events-backfill/route.ts's own authorize()
// function does, under the exact reported scenario: super_admin,
// org_override active, target organisation entitled to both
// capabilities.
//
// Conclusion of this investigation (see the accompanying report): no
// code-level bug was found. This test proves the real, non-mocked
// requireSession() -> requireCapability() chain succeeds under the
// exact conditions described in the Production report — the two
// capability checks are correctly scoped to session.organisationId
// (the impersonated org), never session.homeOrganisationId. It is kept
// as a permanent regression guard against this specific interaction
// ever silently breaking again — not proof the reported symptom's
// live root cause has been found (see the final report's own
// "still requires manual verification" section for that).

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

const { requireSession, roleGte } = await import('@/lib/org')
const { requireCapability, CapabilityAccessError } = await import('@/lib/capabilities/requireCapability')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

describe('Real requireSession() + real requireCapability() chained — the exact app/api/crm/events-backfill/route.ts authorize() sequence', () => {
  it('a super_admin impersonating an entitled org: role check passes, both capability checks resolve against the IMPERSONATED org and succeed', async () => {
    getSessionMock.mockResolvedValue({ userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' })
    cookieStore.set('org_override', 'school-test-org')

    queue(
      [{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin' }], // requireSession's own users lookup
      [{ active: true }],                    // events: modules lookup
      [{ enabled: true, config: {} }],       // events: organisation_modules lookup
      [{ active: true }],                    // crm: modules lookup
      [{ enabled: true, config: {} }],       // crm: organisation_modules lookup
    )

    const session = await requireSession()
    expect(session.organisationId).toBe('school-test-org')
    expect(session.homeOrganisationId).toBe('brainbase-org')
    expect(session.role).toBe('super_admin')
    expect(roleGte(session.role, 'admin')).toBe(true)

    await expect(requireCapability(session.organisationId, 'events')).resolves.toEqual({ key: 'events', config: {} })
    await expect(requireCapability(session.organisationId, 'crm')).resolves.toEqual({ key: 'crm', config: {} })

    // Confirm the capability lookups were scoped to the IMPERSONATED
    // org (school-test-org), never the founder's home org.
    const sqlText = (i: number) => (sqlMock.mock.calls[i] as unknown as [string[]])[0].join('')
    const sqlArgs = (i: number) => (sqlMock.mock.calls[i] as unknown as [string[], ...unknown[]]).slice(1)
    expect(sqlText(2)).toContain('organisation_modules') // events entitlement lookup
    expect(sqlArgs(2)).toContain('school-test-org')
    expect(sqlArgs(2)).not.toContain('brainbase-org')
    expect(sqlText(4)).toContain('organisation_modules') // crm entitlement lookup
    expect(sqlArgs(4)).toContain('school-test-org')
    expect(sqlArgs(4)).not.toContain('brainbase-org')
  })

  it('the same super_admin, NOT impersonating (no org_override), resolves capability checks against their own home org', async () => {
    getSessionMock.mockResolvedValue({ userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' })
    // no cookie set

    queue(
      [{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin' }],
      [{ active: true }],
      [{ enabled: true, config: {} }],
    )

    const session = await requireSession()
    expect(session.organisationId).toBe('brainbase-org')
    expect(session.homeOrganisationId).toBe('brainbase-org')

    await expect(requireCapability(session.organisationId, 'events')).resolves.toEqual({ key: 'events', config: {} })
    const sqlArgs = (i: number) => (sqlMock.mock.calls[i] as unknown as [string[], ...unknown[]]).slice(1)
    expect(sqlArgs(2)).toContain('brainbase-org')
  })

  it('an impersonated org that is genuinely NOT entitled to crm correctly throws CapabilityAccessError (fail-closed, not a false allow)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' })
    cookieStore.set('org_override', 'school-test-org')

    queue(
      [{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin' }],
      [{ active: true }],
      [], // no organisation_modules row -> NO_ENTITLEMENT
    )

    const session = await requireSession()
    await expect(requireCapability(session.organisationId, 'crm')).rejects.toThrow(CapabilityAccessError)
  })

  it('a manager (below admin) impersonating nothing fails the role check before any capability lookup runs', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'Manager One' })
    queue([{ id: 'user-1', organisation_id: 'org-a', role: 'manager' }])

    const session = await requireSession()
    expect(roleGte(session.role, 'admin')).toBe(false)
    // Only 1 sql call so far (requireSession's own lookup) — no capability query was ever issued.
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe('app/crm/events-backfill/page.tsx has no independent role/capability logic of its own', () => {
  function read(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
  }

  it('the page never imports or calls requireSession/requireRole/roleGte/requireCapability — it is a pure client component reflecting the API\'s own HTTP status', () => {
    const src = read('app/crm/events-backfill/page.tsx')
    expect(src).toContain("'use client'")
    expect(src).not.toMatch(/requireSession|requireRole|roleGte|requireCapability|checkCapability/)
    expect(src).not.toMatch(/session\.role|session\.organisationId|session\.homeOrganisationId/)
  })

  it('the only condition gating the Preview/Execute UI is the local `forbidden` state, set exclusively from a 401/403 HTTP response — never from a client-computed role/org check', () => {
    const src = read('app/crm/events-backfill/page.tsx')
    expect(src).toContain("if (res.status === 401 || res.status === 403) { setForbidden(true); return; }")
    // that exact line appears for both runPreview() and runExecute()
    expect((src.match(/if \(res\.status === 401 \|\| res\.status === 403\) \{ setForbidden\(true\); return; \}/g) ?? []).length).toBe(2)
  })

  it('app/api/crm/events-backfill/route.ts is the sole authority: uses roleGte(session.role, \'admin\') (admits super_admin via role hierarchy) and requireCapability(session.organisationId, ...) — never session.homeOrganisationId', () => {
    const src = read('app/api/crm/events-backfill/route.ts')
    expect(src).toContain("roleGte(session.role, 'admin')")
    expect(src).toContain("requireCapability(session.organisationId, 'events')")
    expect(src).toContain("requireCapability(session.organisationId, 'crm')")
    expect(src).not.toMatch(/homeOrganisationId/)
    expect(src).not.toMatch(/role\s*===\s*'admin'/) // strict equality would wrongly exclude super_admin
  })
})
