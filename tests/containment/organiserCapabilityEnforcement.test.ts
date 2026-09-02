import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Phase D.4.4C — proves every exported Organiser API handler now requires
// an enabled 'organiser' entitlement for the effective organisation,
// layered ADDITIVELY on top of requireSession()-based authentication and
// the pre-existing 'viewer' role-minimum check — never replacing either.
// Mirrors tests/containment/eventsCapabilityEnforcement.test.ts, the
// established template for this kind of suite. No production connection
// or data mutation occurs anywhere in this file — every dependency is
// mocked.
//
// Context (D.4.4A/B audits): Organiser is a registered capability
// (`modules.key = 'organiser'`) that previously had zero enforcement —
// app/organiser/layout.tsx and all 12 app/api/organiser/** route files
// were role-gated only. A D.4.4B production pre-flight confirmed
// BrainBase HQ was the only organisation with real Organiser data and
// had it manually granted the entitlement before this enforcement change
// shipped.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

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

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const { CapabilityAccessError, CapabilityDatabaseError } =
  await import('@/lib/capabilities/requireCapability')

const boardsRoute = await import('@/app/api/organiser/boards/route')
const boardIdRoute = await import('@/app/api/organiser/boards/[boardId]/route')
const boardGroupsRoute = await import('@/app/api/organiser/boards/[boardId]/groups/route')
const boardColumnsRoute = await import('@/app/api/organiser/boards/[boardId]/columns/route')
const boardImportRoute = await import('@/app/api/organiser/boards/[boardId]/import/route')
const boardItemsRoute = await import('@/app/api/organiser/boards/[boardId]/items/route')
const columnIdRoute = await import('@/app/api/organiser/columns/[columnId]/route')
const groupIdRoute = await import('@/app/api/organiser/groups/[groupId]/route')
const itemIdRoute = await import('@/app/api/organiser/items/[itemId]/route')
const itemFilesRoute = await import('@/app/api/organiser/items/[itemId]/files/route')
const itemFileIdRoute = await import('@/app/api/organiser/items/[itemId]/files/[fileId]/route')
const itemUpdatesRoute = await import('@/app/api/organiser/items/[itemId]/updates/route')

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Test User' }
const BOARD_CTX = { params: Promise.resolve({ boardId: 'board-1' }) }
const COLUMN_CTX = { params: Promise.resolve({ columnId: 'col-1' }) }
const GROUP_CTX = { params: Promise.resolve({ groupId: 'group-1' }) }
const ITEM_CTX = { params: Promise.resolve({ itemId: 'item-1' }) }
const ITEM_FILE_CTX = { params: Promise.resolve({ itemId: 'item-1', fileId: 'file-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  requireCapabilityMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(SESSION)
})

const handlers: { name: string; call: () => Promise<Response> }[] = [
  { name: 'organiser/boards GET', call: () => boardsRoute.GET() },
  { name: 'organiser/boards POST', call: () => boardsRoute.POST(jsonReq('http://localhost/api/organiser/boards', 'POST', {})) },
  { name: 'organiser/boards/[boardId] GET', call: () => boardIdRoute.GET(asNextRequest(new Request('http://localhost/x')), BOARD_CTX) },
  { name: 'organiser/boards/[boardId] PATCH', call: () => boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), BOARD_CTX) },
  { name: 'organiser/boards/[boardId] DELETE', call: () => boardIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), BOARD_CTX) },
  { name: 'organiser/boards/[boardId]/groups POST', call: () => boardGroupsRoute.POST(jsonReq('http://localhost/x', 'POST', {}), BOARD_CTX) },
  { name: 'organiser/boards/[boardId]/columns POST', call: () => boardColumnsRoute.POST(jsonReq('http://localhost/x', 'POST', {}), BOARD_CTX) },
  { name: 'organiser/boards/[boardId]/import POST', call: () => boardImportRoute.POST(asNextRequest(new Request('http://localhost/x', { method: 'POST' })), BOARD_CTX) },
  { name: 'organiser/boards/[boardId]/items POST', call: () => boardItemsRoute.POST(jsonReq('http://localhost/x', 'POST', {}), BOARD_CTX) },
  { name: 'organiser/columns/[columnId] PATCH', call: () => columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), COLUMN_CTX) },
  { name: 'organiser/columns/[columnId] DELETE', call: () => columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX) },
  { name: 'organiser/groups/[groupId] PATCH', call: () => groupIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), GROUP_CTX) },
  { name: 'organiser/groups/[groupId] DELETE', call: () => groupIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), GROUP_CTX) },
  { name: 'organiser/items/[itemId] PATCH', call: () => itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), ITEM_CTX) },
  { name: 'organiser/items/[itemId] DELETE', call: () => itemIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_CTX) },
  { name: 'organiser/items/[itemId]/files GET', call: () => itemFilesRoute.GET(asNextRequest(new Request('http://localhost/x')), ITEM_CTX) },
  { name: 'organiser/items/[itemId]/files POST', call: () => itemFilesRoute.POST(asNextRequest(new Request('http://localhost/x', { method: 'POST' })), ITEM_CTX) },
  { name: 'organiser/items/[itemId]/files/[fileId] DELETE', call: () => itemFileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX) },
  { name: 'organiser/items/[itemId]/updates GET', call: () => itemUpdatesRoute.GET(asNextRequest(new Request('http://localhost/x')), ITEM_CTX) },
  { name: 'organiser/items/[itemId]/updates POST', call: () => itemUpdatesRoute.POST(jsonReq('http://localhost/x', 'POST', {}), ITEM_CTX) },
]

describe('B. Organiser capability enforcement — full handler coverage', () => {
  it(`exactly ${handlers.length} exported Organiser handlers are covered by this parameterized suite (matches the 12-file, 20-handler inventory from the D.4.4A/C audits)`, () => {
    expect(handlers).toHaveLength(20)
  })

  for (const { name, call } of handlers) {
    it(`${name} is gated — denies with 403 and never reaches SQL when not entitled`, async () => {
      requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
      const res = await call()
      expect(res.status).toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
      expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'organiser')
    })

    it(`${name} — entitlement enabled=false (ENTITLEMENT_DISABLED) -> 403`, async () => {
      requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'))
      const res = await call()
      expect(res.status).toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
    })

    it(`${name} — capability globally inactive (CAPABILITY_INACTIVE) -> 403`, async () => {
      requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('CAPABILITY_INACTIVE'))
      const res = await call()
      expect(res.status).toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
    })

    it(`${name} — unauthenticated -> 401, capability check never runs`, async () => {
      requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
      const res = await call()
      expect(res.status).toBe(401)
      expect(requireCapabilityMock).not.toHaveBeenCalled()
      expect(sqlMock).not.toHaveBeenCalled()
    })

    it(`${name} — capability DB failure fails closed -> 503, never a 403, never SQL execution`, async () => {
      requireCapabilityMock.mockRejectedValue(new CapabilityDatabaseError())
      const res = await call()
      expect(res.status).toBe(503)
      expect(res.status).not.toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
      const body = await res.json()
      expect(JSON.stringify(body)).not.toMatch(/CapabilityDatabaseError|stack|sql/i)
    })

    it(`${name} — F. no super_admin bypass: an unentitled organisation is still denied even when the caller's role is super_admin`, async () => {
      requireSessionMock.mockResolvedValue({ ...SESSION, role: 'super_admin' })
      requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
      const res = await call()
      expect(res.status).toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
    })
  }
})

describe('Organiser capability enforcement — organisation binding', () => {
  it('the capability check is always bound to the resolved effective organisationId, not a fixed/cached value', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
    queue([{ id: 'b1', name: 'Board', color: null, icon: null, position: 0, created_at: null, updated_at: null, item_count: 0 }])
    requireSessionMock.mockResolvedValue({ ...SESSION, organisationId: 'org-a' })
    await boardsRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'organiser')

    requireCapabilityMock.mockReset()
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    requireSessionMock.mockResolvedValue({ ...SESSION, organisationId: 'org-b' })
    const res = await boardsRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-b', 'organiser')
    expect(res.status).toBe(403)
  })

  it('C. exact canonical capability key — a CRM/Events-only entitlement never satisfies the Organiser requirement; the route always requests the literal key "organiser", never a new/duplicate key', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    await boardsRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'organiser')
    expect(requireCapabilityMock).not.toHaveBeenCalledWith('org-a', 'crm')
    expect(requireCapabilityMock).not.toHaveBeenCalledWith('org-a', 'events')
  })
})

// ─── Static source-text checks (page/layout, role preservation, isolation,
// shared-wrapper coverage, Sidebar boundary) — this repo's established
// containment convention for non-handler-invocable surfaces (see
// AGENTS.md/CLAUDE.md and every other *.test.ts file in this suite). ───

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('A. Organiser page/layout enforcement', () => {
  const layoutSource = read('app/organiser/layout.tsx')
  const layoutCode = stripComments(layoutSource)

  it('the capability check exists and uses the exact canonical key "organiser"', () => {
    expect(layoutCode).toMatch(/import \{ checkCapability \} from '@\/lib\/capabilities\/requireCapability'/)
    expect(layoutCode).toMatch(/checkCapability\(session\.organisationId,\s*'organiser'\)/)
  })

  it('the pre-existing manager+ role gate still exists, unchanged, and runs BEFORE the new capability check (cumulative, not a replacement)', () => {
    expect(layoutCode).toMatch(/const ORGANISER_MIN_ROLE = 'manager';/)
    expect(layoutCode).toMatch(/roleGte\(session\.role, ORGANISER_MIN_ROLE\)/)
    const roleCheckIdx = layoutCode.indexOf('roleGte(session.role, ORGANISER_MIN_ROLE)')
    const capabilityCheckIdx = layoutCode.indexOf("checkCapability(session.organisationId, 'organiser')")
    expect(roleCheckIdx).toBeGreaterThan(-1)
    expect(capabilityCheckIdx).toBeGreaterThan(-1)
    expect(roleCheckIdx).toBeLessThan(capabilityCheckIdx)
  })

  it('the capability check does not replace the role gate — both a role-insufficient redirect and a capability-denied render path exist independently', () => {
    expect(layoutCode).toMatch(/redirect\('\/dashboard'\)/)
    expect(layoutCode).toMatch(/if \(!capability\.allowed\)/)
  })

  it('the existing session/login redirect is untouched', () => {
    expect(layoutCode).toMatch(/redirect\('\/login'\)/)
  })

  it('no super_admin bypass exists in the layout — the capability check is unconditional, not gated behind a role comparison', () => {
    expect(layoutCode).not.toMatch(/super_admin[\s\S]{0,80}(allowed|capability)/i)
    expect(layoutCode).not.toMatch(/role === 'super_admin'/)
  })
})

describe('D. Organiser API role preservation — every route keeps its pre-existing "viewer" floor', () => {
  const routeFiles = [
    'app/api/organiser/boards/route.ts',
    'app/api/organiser/boards/[boardId]/route.ts',
    'app/api/organiser/boards/[boardId]/groups/route.ts',
    'app/api/organiser/boards/[boardId]/columns/route.ts',
    'app/api/organiser/boards/[boardId]/import/route.ts',
    'app/api/organiser/boards/[boardId]/items/route.ts',
    'app/api/organiser/columns/[columnId]/route.ts',
    'app/api/organiser/groups/[groupId]/route.ts',
    'app/api/organiser/items/[itemId]/route.ts',
    'app/api/organiser/items/[itemId]/files/route.ts',
    'app/api/organiser/items/[itemId]/files/[fileId]/route.ts',
    'app/api/organiser/items/[itemId]/updates/route.ts',
  ]

  it('exactly 12 route files exist — the inventory has not silently grown or shrunk since the D.4.4A/B audits', () => {
    expect(routeFiles).toHaveLength(12)
  })

  it('every route file imports the shared authorizeOrganiserRequest wrapper, and none still imports the old bare requireRole', () => {
    for (const file of routeFiles) {
      const code = stripComments(read(file))
      expect(code).toMatch(/import \{ authorizeOrganiserRequest \} from '@\/lib\/organiser\/authorize'/)
      expect(code).not.toMatch(/requireRole/)
    }
  })

  it("every handler calls authorizeOrganiserRequest('viewer') — the exact pre-existing role floor, never silently tightened to 'manager' or higher", () => {
    for (const file of routeFiles) {
      const code = stripComments(read(file))
      const callCountInFile = (code.match(/authorizeOrganiserRequest\('viewer'\)/g) ?? []).length
      const handlerCount = (code.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length
      expect(callCountInFile).toBe(handlerCount)
      // No other role string is ever passed to this wrapper in this phase.
      expect(code).not.toMatch(/authorizeOrganiserRequest\('(manager|admin|super_admin)'\)/)
    }
  })

  it('the shared wrapper itself requests the canonical capability key "organiser" exactly once, via requireCapability (the same throwing primitive Events/CRM use)', () => {
    const code = stripComments(read('lib/organiser/authorize.ts'))
    expect(code).toMatch(/requireCapability\(session\.organisationId,\s*'organiser'\)/)
    expect((code.match(/'organiser'/g) ?? []).length).toBe(1)
    expect(code).not.toMatch(/'crm'|'events'/)
  })
})

describe('E. Tenant isolation — representative organiser routes still scope every query by session.organisationId', () => {
  it('boards/[boardId]/route.ts (GET/PATCH/DELETE) still filters by organisation_id in every query', () => {
    const code = stripComments(read('app/api/organiser/boards/[boardId]/route.ts'))
    const orgIdRefs = (code.match(/organisation_id = \$\{session\.organisationId\}/g) ?? []).length
    expect(orgIdRefs).toBeGreaterThanOrEqual(4) // GET (board/groups/items/columns), PATCH, DELETE
  })

  it('items/[itemId]/route.ts (PATCH/DELETE) still filters by organisation_id', () => {
    const code = stripComments(read('app/api/organiser/items/[itemId]/route.ts'))
    expect(code).toMatch(/organisation_id = \$\{session\.organisationId\}/)
  })

  it('boards/route.ts (GET/POST) still scopes by organisation_id — capability enforcement did not replace tenant ownership filtering', () => {
    const code = stripComments(read('app/api/organiser/boards/route.ts'))
    expect(code).toMatch(/WHERE b\.organisation_id = \$\{session\.organisationId\}/)
    expect(code).toMatch(/organisation_id = \$\{session\.organisationId\}/)
  })
})

// Phase D.4.4E — supersedes the D.4.4C placeholder above (which explicitly
// documented an ACCEPTED TEMPORARY discrepancy — a role-qualified but
// unentitled user could still see the nav item and hit the denial screen
// on click — and said "to be addressed in D.4.4D"). Organiser is now a
// first-class TopNav capability item with its own dedicated OrganiserShell/
// OrganiserRail workspace; it no longer appears in the generic ops
// Sidebar at all. See tests/containment/opsSidebarOrganiserRemoval.test.ts
// and organiserShellBoundary.test.ts for the dedicated suites covering
// this new architecture in full; this block only re-confirms, in this
// security-focused file, that the removal does not weaken the
// server-side enforcement proven above (sections A/D/E) — navigation
// visibility remains UX-only regardless of where the nav entry lives.
describe('G. ops Sidebar no longer contains Organiser — the capability enforcement above remains authoritative regardless', () => {
  it('components/ops/Sidebar.tsx contains no reference to Organiser at all', () => {
    const sidebarSource = read('components/ops/Sidebar.tsx')
    expect(sidebarSource).not.toContain('Organiser')
    expect(sidebarSource).not.toContain('/organiser')
  })

  it('TopNav carries the new capability-gated Organiser entry instead, using the canonical key — never a substitute for the server-side enforcement proven in sections A/D/E above', () => {
    const topNavSource = read('components/nav/TopNav.tsx')
    expect(topNavSource).toMatch(/const hasOrganiser =\s*\n?\s*enabledCapabilities\.includes\(\s*\n?\s*'organiser',?\s*\n?\s*\);/)
  })
})
