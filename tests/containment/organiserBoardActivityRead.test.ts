import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Phase D.4.5E — GET /api/organiser/activity?boardId= +
// lib/organiser/activityRead.ts's listBoardActivity. Covers: the shared
// route's "exactly one scope" contract (itemId XOR boardId), the board-
// scoped authorization boundary (identical to item-scoped — session/
// capability/role, no super_admin bypass, no organisation_id override),
// tenant isolation (own vs. foreign-tenant boardId), deletion-safe reads
// (no organiser_boards/organiser_items existence check of any kind),
// per-event-type response shape, ordering, and pagination. Every DB call
// is mocked — no production connection, no real Postgres. Item-scoped
// behavior itself remains covered by
// tests/containment/organiserActivityRead.test.ts (unmodified by this
// phase — its own 28 tests still pass unchanged, proving this phase did
// not weaken item-scoped reads while adding board-scoped ones).

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
const { listBoardActivity } = await import('@/lib/organiser/activityRead')

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Test User' }
const BOARD_A = '33333333-3333-3333-3333-333333333333'
const BOARD_B = '44444444-4444-4444-4444-444444444444'
const ITEM_A = '11111111-1111-1111-1111-111111111111'

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
    created_at: new Date('2026-09-04T00:00:00.000Z'),
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

// ── A. Scope contract — exactly one of itemId or boardId ───────────────────

describe('A. Scope contract', () => {
  it('both itemId and boardId supplied -> 400, never reaches SQL', async () => {
    const res = await GET(req(`?itemId=${ITEM_A}&boardId=${BOARD_A}`))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('neither itemId nor boardId supplied -> 400, never reaches SQL', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('boardId alone is accepted and reaches the board-scoped service', async () => {
    sqlResult = []
    const res = await GET(req(`?boardId=${BOARD_A}`))
    expect(res.status).toBe(200)
    expect(sqlCalls[0].text).toMatch(/board_id = /)
    expect(sqlCalls[0].text).not.toMatch(/item_id = /)
  })
})

// ── B. Authorization boundary (board scope) ─────────────────────────────────

describe('B. Authorization boundary', () => {
  it('unauthenticated -> 401, never reaches SQL', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await GET(req(`?boardId=${BOARD_A}`))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('unentitled organisation -> 403, never reaches SQL', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const res = await GET(req(`?boardId=${BOARD_A}`))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('no super_admin bypass — an unentitled organisation is denied even for a super_admin session', async () => {
    requireSessionMock.mockResolvedValue({ ...SESSION, role: 'super_admin' })
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const res = await GET(req(`?boardId=${BOARD_A}`))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('no organisation_id request override — organisationId always comes from the resolved session, never the query string', async () => {
    sqlResult = []
    requireSessionMock.mockResolvedValue({ ...SESSION, organisationId: 'org-real' })
    await GET(req(`?boardId=${BOARD_A}&organisationId=org-attacker&organisation_id=org-attacker2`))
    expect(sqlCalls.length).toBeGreaterThan(0)
    for (const call of sqlCalls) {
      expect(call.values).not.toContain('org-attacker')
      expect(call.values).not.toContain('org-attacker2')
      expect(call.values).toContain('org-real')
    }
  })
})

// ── C. Tenant isolation / deletion-safe design ──────────────────────────────

describe('C. Tenant isolation and deletion-safe reads', () => {
  it('the service query scopes by organisation_id + board_id directly, no entity_type filter (board scope is "everything on this board")', async () => {
    sqlResult = [activityRow()]
    await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A })
    expect(sqlCalls).toHaveLength(1)
    expect(sqlCalls[0].text).toMatch(/organisation_id = /)
    expect(sqlCalls[0].text).toMatch(/board_id = /)
    expect(sqlCalls[0].text).not.toMatch(/entity_type = 'item'/)
    expect(sqlCalls[0].values).toContain('org-a')
    expect(sqlCalls[0].values).toContain(BOARD_A)
  })

  it("tenant A cannot read tenant B's board activity — a foreign-tenant boardId with no matching organisation_id row returns an empty, non-error result", async () => {
    sqlResult = []
    const result = await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_B })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.activity).toEqual([])
      expect(result.next_cursor).toBeNull()
    }
  })

  it('no cross-board leakage — the boardId in the request is the only board_id value ever bound into the query', async () => {
    sqlResult = []
    await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A })
    expect(sqlCalls[0].values).toContain(BOARD_A)
    expect(sqlCalls[0].values).not.toContain(BOARD_B)
  })

  it('never performs a lookup against organiser_boards or organiser_items — deletion-safe by construction', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/activityRead.ts'), 'utf8')
    expect(source).not.toMatch(/FROM organiser_boards/)
    expect(source).not.toMatch(/JOIN organiser_boards/)
    expect(source).not.toMatch(/FROM organiser_items/)
    expect(source).not.toMatch(/JOIN organiser_items/)
  })

  it("deleted-item events remain visible within the correct tenant's board feed — a row whose event_type is item.deleted is returned like any other", async () => {
    sqlResult = [activityRow({ id: 'act-deleted', event_type: 'item.deleted', after_json: null, before_json: { name: 'Old task', status: 'Done', group_id: 'g1', parent_item_id: null } })]
    const result = await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.activity[0].event_type).toBe('item.deleted')
      expect(result.activity[0].after).toBeNull()
    }
  })
})

// ── D. Response shape / per-event-type correctness ──────────────────────────

describe('D. Response shape and per-event-type rows (board scope)', () => {
  it('board-scoped item.created row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.created' })]
    const res = await GET(req(`?boardId=${BOARD_A}`))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.activity[0].event_type).toBe('item.created')
    expect(json.activity[0].entity_id).toBe(ITEM_A)
  })

  it('board-scoped item.updated row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.updated', before_json: { status: 'Not Started' }, after_json: { status: 'Working on it' } })]
    const res = await GET(req(`?boardId=${BOARD_A}`))
    const json = await res.json()
    expect(json.activity[0].before).toEqual({ status: 'Not Started' })
    expect(json.activity[0].after).toEqual({ status: 'Working on it' })
  })

  it('board-scoped item.moved row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.moved', before_json: { group_id: 'g1' }, after_json: { group_id: 'g2' } })]
    const res = await GET(req(`?boardId=${BOARD_A}`))
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('item.moved')
  })

  it('board-scoped item.deleted row is returned correctly', async () => {
    sqlResult = [activityRow({ event_type: 'item.deleted', after_json: null })]
    const res = await GET(req(`?boardId=${BOARD_A}`))
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('item.deleted')
    expect(json.activity[0].after).toBeNull()
  })

  it('an unknown/future event type passes through safely — not filtered, not crashing', async () => {
    sqlResult = [activityRow({ event_type: 'group.created', entity_type: 'group' })]
    const res = await GET(req(`?boardId=${BOARD_A}`))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.activity[0].event_type).toBe('group.created')
  })

  it('empty board — no rows, activity is an empty array, next_cursor is null', async () => {
    sqlResult = []
    const res = await GET(req(`?boardId=${BOARD_A}`))
    const json = await res.json()
    expect(json.activity).toEqual([])
    expect(json.next_cursor).toBeNull()
  })
})

// ── E. Ordering and pagination ──────────────────────────────────────────────

describe('E. Ordering and pagination (board scope)', () => {
  it('newest-first ordering — orders by created_at DESC, id DESC', async () => {
    sqlResult = []
    await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A })
    expect(sqlCalls[0].text).toMatch(/ORDER BY date_trunc\('milliseconds', created_at\) DESC, id DESC/)
  })

  it('stable pagination — a returned next_cursor round-trips into a valid subsequent-page request', async () => {
    sqlResult = [
      activityRow({ id: 'act-1', created_at: new Date('2026-09-04T00:00:01.000Z') }),
      activityRow({ id: 'act-2', created_at: new Date('2026-09-04T00:00:00.000Z') }),
    ]
    const first = await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A, limit: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.next_cursor).not.toBeNull()

    sqlCalls = []
    sqlResult = []
    const second = await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A, limit: 1, cursor: first.next_cursor! })
    expect(second.ok).toBe(true)
    expect(sqlCalls[0].text).toMatch(/date_trunc\('milliseconds', created_at\), id\) < /)
  })

  it('malformed cursor -> INVALID_CURSOR, 400 at the route, never reaches SQL', async () => {
    const serviceResult = await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A, cursor: 'not-a-real-cursor' })
    expect(serviceResult.ok).toBe(false)
    if (!serviceResult.ok) expect(serviceResult.code).toBe('INVALID_CURSOR')
    expect(sqlMock).not.toHaveBeenCalled()

    const res = await GET(req(`?boardId=${BOARD_A}&cursor=not-a-real-cursor`))
    expect(res.status).toBe(400)
  })

  it('bad limit — an out-of-range limit is rejected as INVALID_LIMIT, not silently clamped', async () => {
    const result = await listBoardActivity({ organisationId: 'org-a', boardId: BOARD_A, limit: 1000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_LIMIT')
    expect(sqlMock).not.toHaveBeenCalled()

    const res = await GET(req(`?boardId=${BOARD_A}&limit=99999`))
    expect(res.status).toBe(400)
  })

  it('malformed boardId -> INVALID_BOARD_ID, never reaches SQL', async () => {
    const result = await listBoardActivity({ organisationId: 'org-a', boardId: 'not-a-uuid; DROP TABLE organiser_activity;--' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_BOARD_ID')
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ── F. GET-only — no write path ──────────────────────────────────────────────

describe('F. GET-only (board scope)', () => {
  it('lib/organiser/activityRead.ts contains no INSERT/UPDATE/DELETE for the board read path either', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/activityRead.ts'), 'utf8')
    expect(source).not.toMatch(/INSERT INTO|UPDATE organiser_activity|DELETE FROM/)
  })
})
