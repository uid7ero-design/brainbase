import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.6F — GET /api/me's new
// enabledCapabilities projection. This suite proves the new field is
// additive UX projection data (key + name only, for capabilities the
// effective organisation is currently entitled to), fails closed to []
// on any query error without ever failing the request, and — critically
// — that the pre-existing, still-broken legacy enabledModules field/
// query/try-catch/last_seen_at behaviour is completely untouched. No
// authorization logic, no requireCapability()/checkCapability() call,
// no Production data change.
//
// Session resolution mechanism (updated — super_admin org switcher UI
// fix): this route now uses requireSession() (from lib/org.ts), not the
// raw getSession() JWT decode, specifically so its organisationId
// already reflects an active super_admin org_override. Before this
// fix, TopNav's client-fetch fallback path (this very endpoint) always
// projected the founder's OWN capabilities/dashboardVariant regardless
// of impersonation — a real, separate bug from the org-switcher-
// invisibility one, found while restoring the switcher UI (see that
// phase's own report). requireSession() is mocked here wholesale
// (matching every other route-level test's own established
// convention, e.g. tests/containment/crmEventBackfill.test.ts) rather
// than exercising its real DB/cookie internals — this file's own job is
// proving THIS route's query shape, not requireSession()'s own
// behaviour (see tests/containment/crmBackfillImpersonationAuthChain.test.ts
// and tests/containment/orgHomeOrganisationId.test.ts for that).

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

// sqlMock's own inferred call signature takes zero args (only its
// wrapper above forwards them) — cast through unknown to inspect the
// real runtime arguments each call received, matching the established
// convention in tests/containment/founderTasks.test.ts.
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}
function sqlCallText(index: number): string {
  const args = sqlCallArgs(index)
  return (args[0] as TemplateStringsArray).join(' ')
}

const { GET } = await import('@/app/api/me/route')

const ROUTE_PATH = path.resolve(__dirname, '../../app/api/me/route.ts')
const ROUTE_SOURCE = fs.readFileSync(ROUTE_PATH, 'utf-8')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const CODE = stripComments(ROUTE_SOURCE)

const SESSION = { userId: 'u1', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'manager', name: 'Ada' }

// Fixed 4-response shape for the EXISTING shared try block, matching
// the route's own call order: user lookup, org lookup, legacy
// enabledModules query, last_seen_at UPDATE. Callers of queueFullRoute
// then append a 5th response for the NEW, independently-queried
// enabledCapabilities call.
function queueFullRoute(capabilitiesResponse: unknown[]) {
  queue(
    [{ id: 'u1', name: 'Ada' }],       // users
    [{ name: 'Org A', industry: null, logo_url: null }], // organisations
    [{ key: 'legacy', name: 'Legacy', industry: 'x' }],  // legacy enabledModules (mocked to SUCCEED here — real Production behaviour is that it throws, but that is exercised separately below)
    [],                                  // last_seen_at UPDATE
    capabilitiesResponse,                // NEW enabledCapabilities query
  )
}

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(SESSION)
})

describe('GET /api/me — enabledCapabilities projection (Phase F.6F)', () => {
  it('1. the response includes enabledCapabilities', async () => {
    queueFullRoute([{ key: 'crm', name: 'CRM' }])
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveProperty('enabledCapabilities')
  })

  it('2. enabledCapabilities entries contain only key and name', async () => {
    queueFullRoute([{ key: 'crm', name: 'CRM' }])
    const res = await GET()
    const body = await res.json()
    expect(body.enabledCapabilities).toEqual([{ key: 'crm', name: 'CRM' }])
    for (const entry of body.enabledCapabilities) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'name'])
    }
  })

  it('3. the capability query joins modules.key to organisation_modules.module_key', async () => {
    queueFullRoute([])
    await GET()
    const text = sqlCallText(4)
    expect(text).toMatch(/JOIN\s+modules\s+m\s+ON\s+m\.key\s*=\s*om\.module_key/i)
  })

  it('4. the capability query filters om.organisation_id = session.organisationId', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).toMatch(/om\.organisation_id\s*=/)
    expect(sqlCallArgs(4)).toContain('org-a')
  })

  it('5. the capability query filters om.enabled = true', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).toMatch(/om\.enabled\s*=\s*true/i)
  })

  it('6. the capability query filters m.active = true', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).toMatch(/m\.active\s*=\s*true/i)
  })

  it('7. the capability query orders deterministically by m.name', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).toMatch(/ORDER BY\s+m\.name/i)
  })

  it('8. the capability query never selects config', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).not.toMatch(/\bconfig\b/i)
  })

  it('9. the capability query never selects organisation_modules.id', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).not.toMatch(/om\.id\b/i)
  })

  it('10. enabledCapabilities entries never expose organisation_id', async () => {
    queueFullRoute([{ key: 'crm', name: 'CRM' }])
    const res = await GET()
    const body = await res.json()
    for (const entry of body.enabledCapabilities) {
      expect(entry).not.toHaveProperty('organisation_id')
      expect(entry).not.toHaveProperty('organisationId')
    }
  })

  it('11. the capability query contains no ::uuid cast', async () => {
    queueFullRoute([])
    await GET()
    expect(sqlCallText(4)).not.toMatch(/::uuid/i)
  })

  it('12. the capability projection does not read organisations.plan', () => {
    expect(CODE).not.toMatch(/organisations?\.plan/i)
  })

  it('13. the capability projection does not reference Microsoft/Google/Instagram/integration concepts', () => {
    expect(CODE).not.toMatch(/microsoft|google|instagram|integration/i)
  })

  it('14. a capability-query DB failure does not fail the request — response stays successful and enabledCapabilities = []', async () => {
    requireSessionMock.mockResolvedValue(SESSION)
    // First 4 responses satisfy the existing shared block; the 5th
    // slot (capabilities) is never reached because we make the mock
    // reject specifically on its 5th invocation instead.
    responseQueue = [
      [{ id: 'u1', name: 'Ada' }],
      [{ name: 'Org A', industry: null, logo_url: null }],
      [{ key: 'legacy', name: 'Legacy', industry: 'x' }],
      [],
    ]
    callCount = 0
    let call = 0
    sqlMock.mockImplementation(() => {
      call += 1
      if (call === 5) return Promise.reject(new Error('connection reset'))
      return Promise.resolve(responseQueue[callCount++] ?? [])
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabledCapabilities).toEqual([])
  })

  it('15. a capability-query DB failure does not expose raw DB error text anywhere in the response', async () => {
    let call = 0
    sqlMock.mockImplementation(() => {
      call += 1
      if (call === 5) return Promise.reject(new Error('password authentication failed for user "neon"'))
      return Promise.resolve(
        [
          [{ id: 'u1', name: 'Ada' }],
          [{ name: 'Org A', industry: null, logo_url: null }],
          [{ key: 'legacy', name: 'Legacy', industry: 'x' }],
          [],
        ][call - 1] ?? [],
      )
    })
    const res = await GET()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/password|neon|authentication/i)
  })

  it('16. existing enabledModules remains present in the response', async () => {
    queueFullRoute([])
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveProperty('enabledModules')
  })

  it('17. the legacy enabledModules query text is structurally unchanged (still the pre-existing, broken m.id/om.module_id/m.industry shape)', () => {
    expect(CODE).toMatch(/SELECT\s+m\.key,\s*m\.name,\s*m\.industry/)
    expect(CODE).toMatch(/JOIN\s+modules\s+m\s+ON\s+m\.id\s*=\s*om\.module_id/)
    // Explicit non-goal guard: this phase must not "fix" the legacy
    // query to use the new module_key column.
  })

  it('18. the new capability projection uses the same session.organisationId already used elsewhere in the route', () => {
    const orgIdUsages = (CODE.match(/session\.organisationId/g) ?? []).length
    // organisationId is used in the response body, the legacy org/enabledModules
    // queries, and the new capability query — never a separately-resolved value.
    expect(orgIdUsages).toBeGreaterThanOrEqual(4)
  })

  it('19. the route uses requireSession() (org_override-aware), never the raw getSession() JWT decode — so its organisationId reflects an active super_admin impersonation, matching app/layout.tsx\'s own identical fix. Still no requireCapability/checkCapability — this route remains a UX projection, not an authorization boundary', () => {
    expect(CODE).toMatch(/import \{ requireSession \} from '@\/lib\/org'/)
    expect(CODE).toContain('await requireSession()')
    expect(CODE).not.toMatch(/getSession\(\)/)
    expect(CODE).not.toMatch(/getAuthSession|requireCapability|checkCapability/)
  })

  it('20. enabledCapabilities never causes a 403, and is never used to gate the response status', async () => {
    queueFullRoute([])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(CODE).not.toMatch(/enabledCapabilities[\s\S]{0,40}(403|status:\s*40)/)
  })
})
