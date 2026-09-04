import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Phase D.4.5D — GET /api/organiser/activity + lib/organiser/activityRead.ts.
// Covers: authorization boundary (session/capability/role, no super_admin
// bypass, no organisation_id override), tenant isolation (own vs. foreign-
// tenant itemId), deletion-safe reads (no organiser_items existence check
// of any kind), per-event-type response shape, ordering, pagination
// (cursor round-trip, limit enforcement, malformed cursor), and safe
// pass-through of an unrecognised event_type. Every DB call is mocked —
// no production connection, no real Postgres.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let sqlResult: unknown[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join('§'), values })
  return Promise.resolve(sqlResult)
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability')
const { GET } = await import('@/app/api/organiser/activity/route')
const { listItemActivity } = await import('@/lib/organiser/activityRead')

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Test User' }
const ITEM_A = '11111111-1111-1111-1111-111111111111'
const ITEM_B = '22222222-2222-2222-2222-222222222222'

function activityRow(overrides: Partial<{
  id: string; event_type: string; entity_type: string; entity_id: string;
  actor_user_id: string | null; actor_name: string;
  before_json: Record<string, unknown> | null; after_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown>; created_at: Date;
}> = {}) {
  return {
    id: 'act-1',
    event_type: 'item.created',
    entity_type: 'item',
    entity_id: ITEM_A,
    actor_user_id: 'u1',
    actor_name: 'Admin',
    before_json: null,
    after_json: { name: 'Widget', status: 'Not Started', group_id: 'g1', parent_item_id: null },
    metadata_json: {},
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  }
}

function req(query: string): NextRequest {
  return asNextRequest(new Request(`http://localhost/api/organiser/activity${query}`))
}

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockReset()
  sqlCalls = []
  sqlResult = []
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
})

// ── A. Authorization boundary ───────────────────────────────────────────────

describe('A. Authorization boundary', () => {
  it('unauthenticated -> 401, never reaches SQL', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await GET(req(`?itemId=${ITEM_A}`))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('unentitled organisation -> 403, never reaches SQL', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const res = await GET(req(`?itemId=${ITEM_A}`))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('no super_admin bypass — an unentitled organisation is denied even for a super_admin session', async () => {
    requireSessionMock.mockResolvedValue({ ...SESSION, role: 'super_admin' })
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const res = await GET(req(`?itemId=${ITEM_A}`))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('no organisation_id request override — a query string organisation_id/organisationId is never read; organisationId always comes from the resolved session', async () => {
    sqlResult = []
    requireSessionMock.mockResolvedValue({ ...SESSION, organisationId: 'org-real' })
    await GET(req(`?itemId=${ITEM_A}&organisationId=org-attacker&organisation_id=org-attacker2`))
    expect(sqlCalls.length).toBeGreaterThan(0)
    for (const call of sqlCalls) {
      expect(call.values).not.toContain('org-attacker')
      expect(call.values).not.toContain('org-attacker2')
      expect(call.values).toContain('org-real')
    }
  })

  it('route source never reads req.nextUrl.searchParams for organisation_id/organisationId at all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/activity/route.ts'), 'utf8')
    expect(source).not.toMatch(/searchParams\.get\(['"]organisation_?[Ii]d['"]\)/)
  })
})

// ── B. Tenant isolation / deletion-safe design ──────────────────────────────

describe('B. Tenant isolation and deletion-safe reads', () => {
  it('the service query scopes by organisation_id + item_id + entity_type — never by item_id alone', async () => {
    sqlResult = [activityRow()]
    await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A })
    expect(sqlCalls).toHaveLength(1)
    expect(sqlCalls[0].text).toMatch(/organisation_id = /)
    expect(sqlCalls[0].text).toMatch(/item_id = /)
    expect(sqlCalls[0].text).toMatch(/entity_type = 'item'/)
    expect(sqlCalls[0].values).toContain('org-a')
    expect(sqlCalls[0].values).toContain(ITEM_A)
  })

  it("tenant A cannot read tenant B's history — a foreign-tenant itemId with no matching organisation_id row returns an empty, non-error result (mocked as an empty DB result, proving the route never distinguishes 'wrong tenant' from 'no history')", async () => {
    sqlResult = []
    const result = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_B })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.activity).toEqual([])
      expect(result.next_cursor).toBeNull()
    }
  })

  it('the route never performs a lookup against organiser_items — deletion-safe by construction, not by a special-cased fallback', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const readSource = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/activityRead.ts'), 'utf8')
    expect(readSource).not.toMatch(/FROM organiser_items/)
    expect(readSource).not.toMatch(/JOIN organiser_items/)
  })

  it('deleted-entity history remains readable through the same tenant-scoped query — a row whose event_type is item.deleted is returned like any other', async () => {
    sqlResult = [activityRow({ id: 'act-deleted', event_type: 'item.deleted', after_json: null, before_json: { name: 'Widget', status: 'Done', group_id: 'g1', parent_item_id: null } })]
    const result = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.activity[0].event_type).toBe('item.deleted')
      expect(result.activity[0].after).toBeNull()
    }
  })
})

// ── C. Response shape / per-event-type correctness ──────────────────────────

describe('C. Response shape and per-event-type rows', () => {
  it('item.created row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.created', before_json: null, after_json: { name: 'Widget', status: 'Not Started', group_id: 'g1', parent_item_id: null } })]
    const res = await GET(req(`?itemId=${ITEM_A}`))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.activity).toHaveLength(1)
    const ev = json.activity[0]
    expect(ev.event_type).toBe('item.created')
    expect(ev.entity_type).toBe('item')
    expect(ev.actor).toEqual({ user_id: 'u1', name: 'Admin' })
    expect(ev.before).toBeNull()
    expect(ev.after).toMatchObject({ name: 'Widget', status: 'Not Started' })
    expect(typeof ev.created_at).toBe('string')
  })

  it('item.updated row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.updated', before_json: { status: 'Not Started' }, after_json: { status: 'Working on it' } })]
    const res = await GET(req(`?itemId=${ITEM_A}`))
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('item.updated')
    expect(json.activity[0].before).toEqual({ status: 'Not Started' })
    expect(json.activity[0].after).toEqual({ status: 'Working on it' })
  })

  it('item.moved row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.moved', before_json: { group_id: 'g1' }, after_json: { group_id: 'g2' } })]
    const res = await GET(req(`?itemId=${ITEM_A}`))
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('item.moved')
    expect(json.activity[0].before).toEqual({ group_id: 'g1' })
    expect(json.activity[0].after).toEqual({ group_id: 'g2' })
  })

  it('item.deleted row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.deleted', before_json: { name: 'Widget', status: 'Done', group_id: 'g1', parent_item_id: null }, after_json: null })]
    const res = await GET(req(`?itemId=${ITEM_A}`))
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('item.deleted')
    expect(json.activity[0].after).toBeNull()
  })

  it('unknown/future event type passes through safely — not filtered, not crashing, returned as-is', async () => {
    sqlResult = [activityRow({ event_type: 'board.updated', entity_type: 'board' })]
    const res = await GET(req(`?itemId=${ITEM_A}`))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('board.updated')
  })

  it('does not expose organisation_id or board_id in the response', async () => {
    sqlResult = [activityRow()]
    const res = await GET(req(`?itemId=${ITEM_A}`))
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/organisation_id|"board_id"/)
  })

  it('empty result — no rows, activity is an empty array, next_cursor is null', async () => {
    sqlResult = []
    const res = await GET(req(`?itemId=${ITEM_A}`))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.activity).toEqual([])
    expect(json.next_cursor).toBeNull()
  })
})

// ── D. Ordering and pagination ──────────────────────────────────────────────

describe('D. Ordering and pagination', () => {
  it('query orders by created_at DESC, id DESC — newest-first with a deterministic tie-breaker', async () => {
    sqlResult = []
    await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A })
    expect(sqlCalls[0].text).toMatch(/ORDER BY date_trunc\('milliseconds', created_at\) DESC, id DESC/)
  })

  it('requesting one more row than the limit produces a next_cursor; the extra row is never included in the page', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      activityRow({ id: `act-${i}`, created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, i)) }))
    sqlResult = rows
    const result = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A, limit: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.activity).toHaveLength(2)
      expect(result.next_cursor).not.toBeNull()
    }
  })

  it('no next_cursor when the result fits within the limit', async () => {
    sqlResult = [activityRow()]
    const result = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A, limit: 25 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.next_cursor).toBeNull()
  })

  it('a returned next_cursor round-trips into a valid subsequent-page request', async () => {
    sqlResult = [
      activityRow({ id: 'act-1', created_at: new Date('2026-09-01T00:00:01.000Z') }),
      activityRow({ id: 'act-2', created_at: new Date('2026-09-01T00:00:00.000Z') }),
    ]
    const first = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A, limit: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.next_cursor).not.toBeNull()

    sqlCalls = []
    sqlResult = []
    const second = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A, limit: 1, cursor: first.next_cursor! })
    expect(second.ok).toBe(true)
    expect(sqlCalls[0].text).toMatch(/date_trunc\('milliseconds', created_at\), id\) < /)
  })

  it('default limit is applied when omitted', async () => {
    sqlResult = []
    await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A })
    expect(sqlCalls[0].values).toContain(26) // DEFAULT_LIMIT (25) + 1
  })

  it('limit enforcement — a limit above the maximum is rejected as INVALID_LIMIT, not silently clamped', async () => {
    const result = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A, limit: 1000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_LIMIT')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('limit enforcement via the route — an out-of-range limit query param produces 400', async () => {
    const res = await GET(req(`?itemId=${ITEM_A}&limit=99999`))
    expect(res.status).toBe(400)
  })

  it('malformed cursor -> INVALID_CURSOR, 400 at the route, never reaches SQL', async () => {
    const serviceResult = await listItemActivity({ organisationId: 'org-a', itemId: ITEM_A, cursor: 'not-a-real-cursor' })
    expect(serviceResult.ok).toBe(false)
    if (!serviceResult.ok) expect(serviceResult.code).toBe('INVALID_CURSOR')
    expect(sqlMock).not.toHaveBeenCalled()

    const res = await GET(req(`?itemId=${ITEM_A}&cursor=not-a-real-cursor`))
    expect(res.status).toBe(400)
  })
})

// ── E. Input validation ─────────────────────────────────────────────────────

describe('E. Input validation', () => {
  it('missing itemId -> 400, never reaches SQL', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('malformed itemId (not a valid identifier shape) -> INVALID_ITEM_ID, never reaches SQL', async () => {
    const result = await listItemActivity({ organisationId: 'org-a', itemId: 'not-a-uuid; DROP TABLE organiser_activity;--' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_ITEM_ID')
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ── F. GET-only / no write path ──────────────────────────────────────────────

describe('F. GET-only — no write path exists on this route', () => {
  it('the route module exports GET only — no POST/PATCH/PUT/DELETE', async () => {
    const mod = await import('@/app/api/organiser/activity/route')
    expect(typeof mod.GET).toBe('function')
    expect((mod as Record<string, unknown>).POST).toBeUndefined()
    expect((mod as Record<string, unknown>).PATCH).toBeUndefined()
    expect((mod as Record<string, unknown>).PUT).toBeUndefined()
    expect((mod as Record<string, unknown>).DELETE).toBeUndefined()
  })

  it('lib/organiser/activityRead.ts contains no INSERT/UPDATE/DELETE statement', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/activityRead.ts'), 'utf8')
    expect(source).not.toMatch(/INSERT INTO|UPDATE organiser_activity|DELETE FROM/)
  })
})
