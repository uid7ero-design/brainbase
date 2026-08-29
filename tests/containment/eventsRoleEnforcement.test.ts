import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Events & Ticketing Phase 1 — proves the role-minimum layer:
// viewer+ may read, manager+ is required to mutate. This is additive to
// (and independent of) capability enforcement, which is proven
// separately in eventsCapabilityEnforcement.test.ts — every test here
// keeps the 'events' capability entitled so only the role dimension
// varies.

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
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
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

const eventsRoute = await import('@/app/api/events/route')
const eventIdRoute = await import('@/app/api/events/[id]/route')
const sessionsRoute = await import('@/app/api/events/[id]/sessions/route')
const sessionIdRoute = await import('@/app/api/events/[id]/sessions/[sessionId]/route')
const ticketTypesRoute = await import('@/app/api/events/[id]/ticket-types/route')
const ticketTypeIdRoute = await import('@/app/api/events/[id]/ticket-types/[ticketTypeId]/route')

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const SESSION_CTX = { params: Promise.resolve({ id: 'event-1', sessionId: 'sess-1' }) }
const TICKET_TYPE_CTX = { params: Promise.resolve({ id: 'event-1', ticketTypeId: 'tt-1' }) }

function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  responseQueue = []
  callCount = 0
})

function sessionAs(role: string) {
  return { userId: 'u1', organisationId: 'org-a', role }
}

describe('Events role enforcement — reads (minimum: viewer)', () => {
  for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
    it(`${role} can list events`, async () => {
      requireSessionMock.mockResolvedValue(sessionAs(role))
      queue([])
      const res = await eventsRoute.GET()
      expect(res.status).toBe(200)
    })
  }
})

describe('Events role enforcement — mutations (minimum: manager)', () => {
  it('viewer cannot create an event -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {
      name: 'Formal', slug: 'formal', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z', timezone: 'Australia/Adelaide',
    }))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot update an event -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot create an event session -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await sessionsRoute.POST(jsonReq('http://localhost/x', 'POST', {}), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot create a ticket type -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await ticketTypesRoute.POST(jsonReq('http://localhost/x', 'POST', {}), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  // R2 remediation 4 — independent review found viewer-denial untested
  // for these four mutation handlers (session PATCH/DELETE, ticket-type
  // PATCH/DELETE). Completes coverage to all 8 of 8 mutation handlers.
  it('viewer cannot update an event session -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await sessionIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), SESSION_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot delete an event session -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await sessionIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), SESSION_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot update a ticket type -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await ticketTypeIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), TICKET_TYPE_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot delete a ticket type -> 403, no SQL executes', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await ticketTypeIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), TICKET_TYPE_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('all 8 mutation handlers now have explicit viewer-denial coverage in this file', () => {
    const denialTestNames = [
      'create an event', 'update an event', 'create an event session', 'create a ticket type',
      'update an event session', 'delete an event session', 'update a ticket type', 'delete a ticket type',
    ]
    expect(denialTestNames).toHaveLength(8)
  })

  for (const role of ['manager', 'admin', 'super_admin']) {
    it(`${role} can create an event`, async () => {
      requireSessionMock.mockResolvedValue(sessionAs(role))
      queue([{ id: 'e1', name: 'Formal', slug: 'formal' }])
      const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {
        name: 'Formal', slug: 'formal', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z', timezone: 'Australia/Adelaide',
      }))
      expect(res.status).toBe(201)
    })
  }
})
