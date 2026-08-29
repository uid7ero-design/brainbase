import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Events & Ticketing Phase 1 — proves every exported Events API handler
// requires an enabled 'events' entitlement for the effective
// organisation, layered ADDITIVELY on top of requireSession()-based
// authentication and the role-minimum check — never replacing either.
// Mirrors tests/containment/crmCapabilityEnforcement.test.ts, the
// established template for this kind of suite. No Production connection
// or data mutation occurs anywhere in this file — every dependency is
// mocked.

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
const eventsRoute = await import('@/app/api/events/route')
const eventIdRoute = await import('@/app/api/events/[id]/route')
const sessionsRoute = await import('@/app/api/events/[id]/sessions/route')
const sessionIdRoute = await import('@/app/api/events/[id]/sessions/[sessionId]/route')
const ticketTypesRoute = await import('@/app/api/events/[id]/ticket-types/route')
const ticketTypeIdRoute = await import('@/app/api/events/[id]/ticket-types/[ticketTypeId]/route')

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager' }
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
  requireCapabilityMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(SESSION)
})

const handlers: { name: string; call: () => Promise<Response> }[] = [
  { name: 'events GET (list)', call: () => eventsRoute.GET() },
  { name: 'events POST', call: () => eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {})) },
  { name: 'events/[id] GET', call: () => eventIdRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX) },
  { name: 'events/[id] PATCH', call: () => eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), EVENT_CTX) },
  { name: 'events/[id]/sessions GET', call: () => sessionsRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX) },
  { name: 'events/[id]/sessions POST', call: () => sessionsRoute.POST(jsonReq('http://localhost/x', 'POST', {}), EVENT_CTX) },
  { name: 'events/[id]/sessions/[sessionId] PATCH', call: () => sessionIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), SESSION_CTX) },
  { name: 'events/[id]/sessions/[sessionId] DELETE', call: () => sessionIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), SESSION_CTX) },
  { name: 'events/[id]/ticket-types GET', call: () => ticketTypesRoute.GET(asNextRequest(new Request('http://localhost/x')), EVENT_CTX) },
  { name: 'events/[id]/ticket-types POST', call: () => ticketTypesRoute.POST(jsonReq('http://localhost/x', 'POST', {}), EVENT_CTX) },
  { name: 'events/[id]/ticket-types/[ticketTypeId] PATCH', call: () => ticketTypeIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {}), TICKET_TYPE_CTX) },
  { name: 'events/[id]/ticket-types/[ticketTypeId] DELETE', call: () => ticketTypeIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), TICKET_TYPE_CTX) },
]

describe('Events capability enforcement — full handler coverage', () => {
  it(`exactly ${handlers.length} exported Events handlers are covered by this parameterized suite`, () => {
    expect(handlers).toHaveLength(12)
  })

  for (const { name, call } of handlers) {
    it(`${name} is gated — denies with 403 and never reaches SQL when not entitled`, async () => {
      requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
      const res = await call()
      expect(res.status).toBe(403)
      expect(sqlMock).not.toHaveBeenCalled()
      expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'events')
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
  }
})

describe('Events capability enforcement — organisation binding', () => {
  it('the capability check is always bound to the resolved effective organisationId, not a fixed/cached value', async () => {
    requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
    queue([{ id: 'e1' }])
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager' })
    await eventsRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'events')

    requireCapabilityMock.mockReset()
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    requireSessionMock.mockResolvedValue({ userId: 'u2', organisationId: 'org-b', role: 'manager' })
    const res = await eventsRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-b', 'events')
    expect(res.status).toBe(403)
  })

  it('an Organiser/CRM-only entitlement never satisfies the Events requirement — the route always requests the literal key "events"', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    await eventsRoute.GET()
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'events')
    expect(requireCapabilityMock).not.toHaveBeenCalledWith('org-a', 'crm')
    expect(requireCapabilityMock).not.toHaveBeenCalledWith('org-a', 'organiser')
  })
})
