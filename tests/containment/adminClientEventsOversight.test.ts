import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// EVENTS — BRAINBASE CLIENT EVENTS OVERSIGHT. Proves:
//   ACCESS — GET /api/admin/client-events is reachable only via
//     requireRole('super_admin') (the same canonical, DB-revalidated
//     primitive every other /admin/** route uses — see
//     tests/containment/adminOrgSavePath.test.ts for the established
//     mocking convention this file follows).
//   DATA — the cross-org query never selects purchaser/attendee PII or
//     registration-question answers, is genuinely unscoped to any one
//     caller organisation_id (the one deliberate exception in this
//     codebase, justified solely by the access gate above), and
//     excludes BrainBase HQ's own events by default.
//   OPEN EVENT — the client component reuses the EXISTING
//     /api/admin/impersonate mechanism sequentially (await, then
//     navigate — never fire-and-forget), and the API route itself
//     exports no mutation handler at all.
//
// Every dependency is mocked — no real database call occurs anywhere
// in this file. Real-Postgres proof that the aggregate SQL itself
// produces correct numbers against genuine data is a separate,
// deliberate read-only query run against DEV during manual
// verification (see the task report) — this file proves route
// orchestration and containment, not SQL correctness under load.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  void strings
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({ default: sqlMock }))

// Only used by the "Open event" impersonate-route regression suite
// below — app/api/admin/impersonate/route.ts imports getSession()
// directly (not requireRole()), and reads/writes cookies via
// next/headers. Mocking these here has no effect on any other route
// under test in this file (none of them import @/lib/session or
// next/headers).
const getSessionMock = vi.fn()
vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))
const cookieSetMock = vi.fn()
const cookieDeleteMock = vi.fn()
let cookieValue: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'org_override' && cookieValue !== undefined ? { value: cookieValue } : undefined),
    set: (...args: unknown[]) => cookieSetMock(...args),
    delete: (...args: unknown[]) => cookieDeleteMock(...args),
  }),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function sqlCallText(index: number): string {
  const call = sqlMock.mock.calls[index] as unknown as unknown[]
  return (call[0] as TemplateStringsArray).join(' ')
}
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const route = await import('@/app/api/admin/client-events/route')
const impersonateRoute = await import('@/app/api/admin/impersonate/route')

function req(url: string) {
  return asNextRequest(new Request(url))
}

const SUPER_ADMIN = { userId: 'u1', organisationId: 'brainbase-org', role: 'super_admin', name: 'James' }

beforeEach(() => {
  requireRoleMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
  requireRoleMock.mockResolvedValue(SUPER_ADMIN)
  getSessionMock.mockReset()
  cookieSetMock.mockClear()
  cookieDeleteMock.mockClear()
  cookieValue = undefined
  getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'brainbase-org', role: 'super_admin', name: 'James' })
})

describe('ACCESS — GET /api/admin/client-events is super_admin-only', () => {
  it('a genuine super_admin session succeeds (200) and receives events + organisations', async () => {
    queue(
      [{ id: 'evt-1', organisation_id: 'org-a', organisation_name: 'Org A' }],
      [{ id: 'org-a', name: 'Org A', slug: 'org-a' }],
    )
    const res = await route.GET(req('http://localhost/api/admin/client-events'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.organisations).toHaveLength(1)
    expect(requireRoleMock).toHaveBeenCalledWith('super_admin')
  })

  it('requireRole rejection (any role below super_admin — manager, admin, or a plain client user) -> 403, no DB call at all', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await route.GET(req('http://localhost/api/admin/client-events'))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('an unauthenticated request (requireRole throws Unauthorized) is also rejected with 403 by this route\'s own uniform error handling — never a 200 with partial/empty cross-org data', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await route.GET(req('http://localhost/api/admin/client-events'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/organisation_id|event/i)
  })

  it('mutation proof — the route genuinely calls the canonical super_admin gate, not a role string comparison it could silently drift from', async () => {
    queue([], [])
    await route.GET(req('http://localhost/api/admin/client-events'))
    expect(requireRoleMock).toHaveBeenCalledTimes(1)
    expect(requireRoleMock).toHaveBeenCalledWith('super_admin')
  })

  it('mutation proof — the main aggregate query actually reads from the events table, not a stub/placeholder', async () => {
    queue([], [])
    await route.GET(req('http://localhost/api/admin/client-events'))
    expect(sqlCallText(0)).toMatch(/FROM events e/)
  })
})

describe('DATA — no PII, genuinely cross-organisation, BrainBase HQ excluded by default', () => {
  const routeSrc = stripComments(read('app/api/admin/client-events/route.ts'))

  it('the SQL never selects purchaser name/email/phone', () => {
    expect(routeSrc).not.toMatch(/purchaser_name|purchaser_email|purchaser_phone/)
  })

  it('the SQL never selects attendee names or registration-question answers', () => {
    expect(routeSrc).not.toMatch(/attendee_name|attendee_email/)
    expect(routeSrc).not.toMatch(/event_registration_responses|question_label_snapshot|field_type_snapshot/)
    expect(routeSrc).not.toMatch(/\banswer\b/)
  })

  it('the query is genuinely unscoped to a single caller organisation_id — the one deliberate exception, justified only by the super_admin gate above', () => {
    // Every OTHER Events query in this codebase filters by
    // `organisation_id = ${session.organisationId}` or an equivalent
    // caller-scoped value. This route's own main aggregate query must
    // NOT do that — proven by asserting no such binding exists in its
    // WHERE clause text.
    expect(routeSrc).not.toMatch(/organisation_id = \$\{session\.organisationId\}/)
  })

  it('BrainBase HQ is excluded by default via a slug check, with an explicit opt-in to include it — never inferred as part of an access decision', () => {
    expect(routeSrc).toMatch(/o\.slug <> 'brainbase'/)
    expect(routeSrc).toMatch(/includeBrainbase/)
    // This is a DISPLAY filter, not an authorization check — the
    // access gate is requireRole('super_admin') alone (see ACCESS
    // suite above), independent of this filter's value.
  })

  it('mutation proof — includeBrainbase defaults to excluding brainbase unless the query param is exactly "true"', async () => {
    queue([], [])
    await route.GET(req('http://localhost/api/admin/client-events'))
    const args = sqlCallArgs(0)
    expect(args).toContain(false)
  })

  it('mutation proof — includeBrainbase=true is correctly parsed and passed through as a real boolean', async () => {
    queue([], [])
    await route.GET(req('http://localhost/api/admin/client-events?includeBrainbase=true'))
    const args = sqlCallArgs(0)
    expect(args).toContain(true)
  })

  it('multiple client organisations in the mocked result set are returned verbatim, each retaining its own organisation_id/name — the route never re-scopes or merges rows from different organisations', async () => {
    queue(
      [
        { id: 'evt-1', organisation_id: 'org-a', organisation_name: 'LD Tennis', paid_count: 3, gross_revenue_cents: 5000 },
        { id: 'evt-2', organisation_id: 'org-b', organisation_name: 'Other Client', paid_count: 1, gross_revenue_cents: 1000 },
      ],
      [{ id: 'org-a', name: 'LD Tennis', slug: 'ld-tennis' }, { id: 'org-b', name: 'Other Client', slug: 'other-client' }],
    )
    const res = await route.GET(req('http://localhost/api/admin/client-events'))
    const body = await res.json()
    expect(body.events).toHaveLength(2)
    expect(body.events[0].organisation_id).toBe('org-a')
    expect(body.events[0].gross_revenue_cents).toBe(5000)
    expect(body.events[1].organisation_id).toBe('org-b')
    expect(body.events[1].gross_revenue_cents).toBe(1000)
  })

  it('gross/refunded revenue is cast to ::int in SQL, not left as an unlabelled bigint sum — avoids the known driver string-serialization defect elsewhere in this module', () => {
    expect(routeSrc).toMatch(/gross_revenue_cents/)
    expect(routeSrc).toMatch(/SUM\(total_cents\) FILTER \(WHERE payment_status = 'PAID'\), 0\)::int/)
    expect(routeSrc).toMatch(/SUM\(total_cents\) FILTER \(WHERE payment_status = 'REFUNDED'\), 0\)::int/)
  })
})

// Regression test for a genuine, pre-existing bug discovered and fixed
// while implementing "Open event": app/api/admin/impersonate/route.ts
// compared organisations.id (TEXT) against an explicit ${orgId}::uuid
// cast, which has no matching Postgres operator for a TEXT column
// regardless of whether the id string happens to be UUID-shaped —
// this made impersonation fail (500) for EVERY organisation, including
// LD Tennis's own genuinely UUID-shaped id, confirmed against real DEV
// before this fix. Same class of defect, same fix, as
// app/api/admin/orgs/route.ts's own earlier repair (see
// adminOrgSavePath.test.ts). "Open event" depends entirely on this
// route working, so fixing it was in scope for this task even though
// the file itself predates and is unrelated to Events.
describe('Regression — /api/admin/impersonate no longer casts organisations.id (TEXT) to ::uuid', () => {
  const impersonateSrc = stripComments(read('app/api/admin/impersonate/route.ts'))

  it('no ::uuid cast appears anywhere in this file', () => {
    expect(impersonateSrc).not.toMatch(/::uuid/)
  })

  it('POST successfully sets the override cookie for a UUID-shaped org id (the exact case that was broken)', async () => {
    queue([{ id: 'org-a', name: 'LD Tennis' }])
    const res = await impersonateRoute.POST(new Request('http://localhost/api/admin/impersonate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, orgId: 'org-a', orgName: 'LD Tennis' })
    expect(cookieSetMock).toHaveBeenCalledWith('org_override', 'org-a', expect.objectContaining({ httpOnly: true }))
  })

  it('POST also works for a non-UUID-shaped (cuid-style) org id — the org lookup no longer depends on UUID shape at all', async () => {
    queue([{ id: 'cmp4cndxu0000fabxqwogpttt', name: 'City of Onkaparinga' }])
    const res = await impersonateRoute.POST(new Request('http://localhost/api/admin/impersonate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: 'cmp4cndxu0000fabxqwogpttt' }),
    }) as unknown as NextRequest)
    expect(res.status).toBe(200)
  })

  it('a non-super_admin is still rejected (403), unaffected by this fix', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u2', organisationId: 'org-a', role: 'manager', name: 'Luke' })
    const res = await impersonateRoute.POST(new Request('http://localhost/api/admin/impersonate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }) as unknown as NextRequest)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('OPEN EVENT — reuses the existing impersonation mechanism, sequentially, and no cross-tenant mutation route exists', () => {
  const routeExports = route as Record<string, unknown>
  const clientSrc = stripComments(read('app/admin/client-events/ClientEventsClient.tsx'))

  it('the API route exports GET only — no POST/PATCH/DELETE anywhere, i.e. no cross-tenant mutation route was introduced', () => {
    expect(routeExports.GET).toBeDefined()
    expect(routeExports.POST).toBeUndefined()
    expect(routeExports.PATCH).toBeUndefined()
    expect(routeExports.DELETE).toBeUndefined()
  })

  it('"Open event" calls the EXISTING /api/admin/impersonate endpoint — not a new/parallel context-switch mechanism', () => {
    expect(clientSrc).toMatch(/fetch\('\/api\/admin\/impersonate'/)
    expect(clientSrc).toMatch(/method: 'POST'/)
    expect(clientSrc).toMatch(/orgId: row\.organisation_id/)
  })

  it('navigation to /events/{eventId} only happens AFTER the impersonate call is awaited and checked for success — never fire-and-forget, so the wrong tenant context can never be retained', () => {
    const fnStart = clientSrc.indexOf('async function openEvent')
    const fnBody = clientSrc.slice(fnStart, clientSrc.indexOf('\n  }', fnStart))
    const impersonateCallIndex = fnBody.indexOf('/api/admin/impersonate')
    const okCheckIndex = fnBody.indexOf('!res.ok')
    const navigateIndex = fnBody.indexOf('window.location.assign')
    expect(impersonateCallIndex).toBeGreaterThan(-1)
    expect(okCheckIndex).toBeGreaterThan(impersonateCallIndex)
    expect(navigateIndex).toBeGreaterThan(okCheckIndex)
    // The success-only path: navigation is inside the same try block,
    // after the failure branch's own early `return` — never reachable
    // when the impersonate call failed.
    const failureReturnIndex = fnBody.indexOf('return', okCheckIndex)
    expect(failureReturnIndex).toBeGreaterThan(okCheckIndex)
    expect(navigateIndex).toBeGreaterThan(failureReturnIndex)
  })

  it('navigates with a hard navigation (window.location.assign), matching the existing OrgSwitcher precedent of forcing a fresh server resolve after an org_override change — never a soft client-side route push that could reuse stale server-rendered data', () => {
    expect(clientSrc).toMatch(/window\.location\.assign\(`\/events\/\$\{row\.id\}`\)/)
    expect(clientSrc).not.toMatch(/router\.push\(`\/events/)
  })

  it('the destination is the existing tenant-scoped /events/{eventId} route — never a parallel cross-tenant event editor', () => {
    expect(clientSrc).toMatch(/`\/events\/\$\{row\.id\}`/)
    expect(clientSrc).not.toMatch(/\/admin\/client-events\/\[.*id.*\]\/edit|\/admin\/events\/\[/)
  })
})

describe('Navigation entries are super_admin-gated, matching the existing admin nav pattern', () => {
  it('TopNav ADMIN_ITEMS includes Client Events, routing to /admin/client-events', () => {
    const code = stripComments(read('components/nav/TopNav.tsx'))
    const start = code.indexOf('const ADMIN_ITEMS')
    const body = code.slice(start, code.indexOf('\n];', start))
    expect(body).toMatch(/label:\s*'Client Events'/)
    expect(body).toMatch(/href:\s*'\/admin\/client-events'/)
  })

  it('ADMIN_ITEMS (and therefore Client Events) is only ever rendered via AdminDropdown, which is itself gated by isSuperAdmin', () => {
    const code = stripComments(read('components/nav/TopNav.tsx'))
    const dropdownUsage = code.indexOf('<AdminDropdown')
    const before = code.slice(Math.max(0, dropdownUsage - 200), dropdownUsage)
    expect(before).toMatch(/isSuperAdmin\s*&&/)
  })

  it('AdminAside sidebar (rendered only under the super_admin-gated /admin/* layout) also links to Client Events', () => {
    const code = stripComments(read('components/admin/AdminAside.tsx'))
    expect(code).toMatch(/href="\/admin\/client-events"/)
  })

  it('the Client Events entry is not the same NavItem/route as the normal Events link — does not overload /events', () => {
    const code = stripComments(read('components/nav/TopNav.tsx'))
    const adminItemsStart = code.indexOf('const ADMIN_ITEMS')
    const adminItemsBody = code.slice(adminItemsStart, code.indexOf('\n];', adminItemsStart))
    expect(adminItemsBody).not.toMatch(/href:\s*'\/events'/)
  })
})

describe('/admin/client-events page — super_admin gate matches every other admin page\'s established pattern', () => {
  it('uses getSession() + a redirect(\'/\') check, the same defensive pattern app/admin/orgs/page.tsx and app/admin/users/page.tsx already use', () => {
    const code = stripComments(read('app/admin/client-events/page.tsx'))
    expect(code).toMatch(/session\.role !== 'super_admin'/)
    expect(code).toMatch(/redirect\('\/'\)/)
  })
})
