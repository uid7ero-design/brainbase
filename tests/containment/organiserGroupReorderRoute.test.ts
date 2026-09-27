import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Phase D.4.7E (Slice E2) — POST /api/organiser/boards/[boardId]/groups/reorder.
// Mocks resequenceOrganiserGroupScope itself (not `sql`) — the primitive's
// own correctness (locking, exact-permutation validation, contiguous
// resequencing, zero activity writes) is proven separately and rigorously
// against a real database in organiserReorderTransaction.integration.test.ts.
// This file's only job is the ROUTE's own logic: auth gate, board lookup,
// request-body shape validation, and mapping the primitive's result onto
// an HTTP response — never re-proving the transaction itself.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function jsonReq(url: string, body?: unknown) {
  return asNextRequest(new Request(url, {
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
let boardLookupResult: unknown[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join('§'), values })
  return Promise.resolve(boardLookupResult)
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const resequenceMock = vi.fn()
vi.mock('@/lib/organiser/reorderTransactions', () => ({
  resequenceOrganiserGroupScope: (...args: unknown[]) => resequenceMock(...args),
}))

const route = await import('@/app/api/organiser/boards/[boardId]/groups/reorder/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'James' }
const CTX = { params: Promise.resolve({ boardId: 'board-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockReset()
  resequenceMock.mockReset()
  sqlCalls = []
  boardLookupResult = [{ id: 'board-1' }]
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
})

describe('POST /api/organiser/boards/[boardId]/groups/reorder', () => {
  it('board not found -> 404, resequence primitive never called', async () => {
    boardLookupResult = []
    const res = await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: ['g1'] }), CTX)
    expect(res.status).toBe(404)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('the board lookup is scoped by organisation_id, matching every other Organiser route', async () => {
    resequenceMock.mockResolvedValue({ ok: true, order: [] })
    await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: [] }), CTX)
    expect(sqlCalls[0].text).toMatch(/organisation_id/)
    expect(sqlCalls[0].values).toContain('org-a')
  })

  it('missing ordered_group_ids -> 400, resequence primitive never called', async () => {
    const res = await route.POST(jsonReq('http://localhost/x', {}), CTX)
    expect(res.status).toBe(400)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('ordered_group_ids containing a non-string -> 400, resequence primitive never called', async () => {
    const res = await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: ['g1', 42] }), CTX)
    expect(res.status).toBe(400)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('invalid JSON body -> 400, resequence primitive never called', async () => {
    const req = asNextRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' }))
    const res = await route.POST(req, CTX)
    expect(res.status).toBe(400)
    expect(resequenceMock).not.toHaveBeenCalled()
  })

  it('calls resequenceOrganiserGroupScope with the session-derived organisationId and the resolved boardId — never a client-supplied organisationId', async () => {
    resequenceMock.mockResolvedValue({ ok: true, order: [] })
    await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: ['g1', 'g2'] }), CTX)
    expect(resequenceMock).toHaveBeenCalledWith(
      { organisationId: 'org-a', boardId: 'board-1' },
      ['g1', 'g2'],
    )
  })

  it('primitive success -> 200 with { order } echoed verbatim', async () => {
    resequenceMock.mockResolvedValue({ ok: true, order: [{ id: 'g2', position: 0 }, { id: 'g1', position: 1 }] })
    const res = await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: ['g2', 'g1'] }), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ order: [{ id: 'g2', position: 0 }, { id: 'g1', position: 1 }] })
  })

  it('primitive reason "malformed" -> 400', async () => {
    resequenceMock.mockResolvedValue({ ok: false, reason: 'malformed' })
    const res = await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: ['not-a-uuid'] }), CTX)
    expect(res.status).toBe(400)
  })

  it.each(['duplicate', 'extra', 'missing', 'count_mismatch'] as const)(
    'primitive reason "%s" -> 409 with a generic, non-distinguishing message',
    async (reason) => {
      resequenceMock.mockResolvedValue({ ok: false, reason })
      const res = await route.POST(jsonReq('http://localhost/x', { ordered_group_ids: ['g1'] }), CTX)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toMatch(/refresh and try again/i)
    },
  )

  it('never inserts into organiser_activity from this route (comments referencing it are fine; a write is not)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/groups/reorder/route.ts'), 'utf-8')
    expect(src).not.toMatch(/INSERT INTO organiser_activity/)
  })
})
