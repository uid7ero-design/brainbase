import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function jsonReq(body?: unknown) {
  return asNextRequest(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})
const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let sqlResults: unknown[][] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join('SQL'), values })
  return Promise.resolve(sqlResults.shift() ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const resequenceMock = vi.fn()
vi.mock('@/lib/organiser/reorderTransactions', () => ({
  resequenceOrganiserItemScope: (...args: unknown[]) => resequenceMock(...args),
}))

const route = await import('@/app/api/organiser/boards/[boardId]/items/reorder/route')

const BOARD = '11111111-1111-1111-1111-111111111111'
const GROUP = '22222222-2222-2222-2222-222222222222'
const ITEM_A = '33333333-3333-3333-3333-333333333333'
const ITEM_B = '44444444-4444-4444-4444-444444444444'
const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'James' }
const CTX = { params: Promise.resolve({ boardId: BOARD }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockReset()
  resequenceMock.mockReset()
  sqlCalls = []
  sqlResults = [[{ id: BOARD }], [{ id: GROUP }]]
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
})

describe('POST /api/organiser/boards/[boardId]/items/reorder', () => {
  it('board not found -> 404 and primitive is never called', async () => {
    sqlResults = [[]]
    const res = await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_A] }), CTX)
    expect(res.status).toBe(404)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('requires group_id to be explicitly present, while allowing null for the No group scope', async () => {
    const missing = await route.POST(jsonReq({ ordered_item_ids: [ITEM_A] }), CTX)
    expect(missing.status).toBe(400)

    sqlResults = [[{ id: BOARD }]]
    resequenceMock.mockResolvedValue({ ok: true, order: [{ id: ITEM_A, position: 0 }] })
    const noGroup = await route.POST(jsonReq({ group_id: null, ordered_item_ids: [ITEM_A] }), CTX)
    expect(noGroup.status).toBe(200)
    expect(resequenceMock).toHaveBeenCalledWith(
      { type: 'top_level_group', organisationId: 'org-a', boardId: BOARD, groupId: null },
      [ITEM_A],
    )
  })

  it('rejects malformed/non-string group_id before the primitive', async () => {
    const malformed = await route.POST(jsonReq({ group_id: 'not-a-uuid', ordered_item_ids: [ITEM_A] }), CTX)
    expect(malformed.status).toBe(400)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('rejects missing or non-string ordered_item_ids before the primitive', async () => {
    const missing = await route.POST(jsonReq({ group_id: GROUP }), CTX)
    expect(missing.status).toBe(400)
    expect(resequenceMock).not.toHaveBeenCalled()

    sqlResults = [[{ id: BOARD }], [{ id: GROUP }]]
    const mixed = await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_A, 42] }), CTX)
    expect(mixed.status).toBe(400)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('validates a non-null group inside the same organisation and board', async () => {
    sqlResults = [[{ id: BOARD }], []]
    const res = await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_A] }), CTX)
    expect(res.status).toBe(404)
    expect(resequenceMock).not.toHaveBeenCalled()
    expect(sqlCalls[1].text).toMatch(/organiser_groups/)
    expect(sqlCalls[1].text).toMatch(/board_id/)
    expect(sqlCalls[1].text).toMatch(/organisation_id/)
    expect(sqlCalls[1].values).toContain('org-a')
    expect(sqlCalls[1].values).toContain(BOARD)
    expect(sqlCalls[1].values).toContain(GROUP)
  })

  it('passes only session-derived organisation, board, group and complete order to the E1 primitive', async () => {
    resequenceMock.mockResolvedValue({ ok: true, order: [] })
    await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_B, ITEM_A], organisation_id: 'evil' }), CTX)
    expect(resequenceMock).toHaveBeenCalledWith(
      { type: 'top_level_group', organisationId: 'org-a', boardId: BOARD, groupId: GROUP },
      [ITEM_B, ITEM_A],
    )
  })

  it('success -> 200 with authoritative order', async () => {
    resequenceMock.mockResolvedValue({ ok: true, order: [{ id: ITEM_B, position: 0 }, { id: ITEM_A, position: 1 }] })
    const res = await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_B, ITEM_A] }), CTX)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ order: [{ id: ITEM_B, position: 0 }, { id: ITEM_A, position: 1 }] })
  })

  it('malformed primitive result -> 400', async () => {
    resequenceMock.mockResolvedValue({ ok: false, reason: 'malformed' })
    const res = await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_A] }), CTX)
    expect(res.status).toBe(400)
  })

  it.each(['duplicate', 'extra', 'missing', 'count_mismatch'] as const)(
    '%s -> 409 generic stale-order response',
    async (reason) => {
      resequenceMock.mockResolvedValue({ ok: false, reason })
      const res = await route.POST(jsonReq({ group_id: GROUP, ordered_item_ids: [ITEM_A] }), CTX)
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/refresh and try again/i)
    },
  )

  it('never writes an activity row itself', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/reorder/route.ts'), 'utf8')
    expect(src).not.toMatch(/INSERT INTO organiser_activity/)
  })
})
