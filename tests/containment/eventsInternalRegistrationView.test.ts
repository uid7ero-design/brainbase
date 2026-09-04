import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 2 — proves the staff-authenticated
// registrations view (app/api/events/[id]/orders/route.ts): viewer+ can
// read, gated by the same authorizeEventsRequest() as every other
// Events route (session + 'events' capability + role), and every query
// is tenant-scoped to the caller's own organisation — a cross-org event
// id resolves to 404, not another organisation's registrations.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
// Registration operations phase — typed as a tagged-template function
// (not the previous zero-arg signature) so sqlMock.mock.calls[i][0] is
// typed as TemplateStringsArray, needed for the query-content .find()
// below. Behavior is unchanged — it still just returns the next queued
// response regardless of the query text/params passed in. The
// implementation is passed directly to vi.fn() (not attached afterward
// via .mockImplementation()) so it survives this file's own
// beforeEach's sqlMock.mockReset() call, which clears an implementation
// set the other way.
const sqlMock = vi.fn((...args: [TemplateStringsArray, ...unknown[]]) => {
  void args
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const ordersRoute = await import('@/app/api/events/[id]/orders/route')

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }

function sessionAs(role: string) {
  return { userId: 'u1', organisationId: 'org-a', role }
}

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('viewer'))
})

describe('Internal registrations view — role/capability gating', () => {
  it('viewer can read registrations', async () => {
    queue([{ id: 'event-1' }], [])
    const res = await ordersRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('unauthenticated -> 401, no SQL executes', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await ordersRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('Internal registrations view — tenant isolation', () => {
  it('an event belonging to another organisation -> 404, no orders query executes', async () => {
    queue([]) // the ownership SELECT (id + organisation_id) matches nothing
    const res = await ordersRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('the ownership check binds the caller\'s own organisationId, never a client-supplied value', async () => {
    queue([{ id: 'event-1' }], [])
    await ordersRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX)
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    expect(call).toContain('org-a')
  })

  it('the orders query itself is scoped to the caller\'s own organisationId', async () => {
    // Registration operations phase — buildRegistrationFilterSql()
    // (lib/events/registrationFilters.ts) always makes one additional,
    // harmless sql`` call up front (its own unconditional empty base
    // fragment, embedded as a nested fragment — never a real, separate
    // Postgres round trip in production, only an extra entry in this
    // mock's own call log) before the main orders query — so a bare
    // positional index into sqlMock.mock.calls is no longer reliable.
    // Found by query CONTENT instead (the one call whose own text
    // selects FROM event_orders), immune to how many filter fragments
    // happen to run before it.
    queue([{ id: 'event-1' }], [], [])
    await ordersRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX)
    const call = sqlMock.mock.calls.find(c => (c[0] as TemplateStringsArray).join(' ').includes('FROM event_orders')) as unknown as unknown[]
    expect(call, 'expected to find the main orders query among sqlMock\'s calls').toBeDefined()
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).toMatch(/organisation_id/i)
    expect(call).toContain('org-a')
  })
})

describe('Internal registrations view — architecture containment', () => {
  it('the route file never trusts a client-supplied organisation id', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/events/[id]/orders/route.ts'), 'utf8')
    expect(src).not.toMatch(/body\.organisation_id/)
    expect(src).not.toMatch(/body\.organisationId/)
  })
})
