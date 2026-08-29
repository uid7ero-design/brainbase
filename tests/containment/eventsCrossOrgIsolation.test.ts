import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Events & Ticketing Phase 1 — proves tenant isolation: an organisation
// can never read, patch, or attach a child row to another
// organisation's event, and list endpoints only ever return the
// caller's own rows. Every DB call is mocked — a "different
// organisation" is simulated by having the mock respond as if the
// WHERE organisation_id = ... clause excluded the row (empty result),
// exactly like the real database would for a genuinely cross-tenant id.

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

const SESSION_ORG_A = { userId: 'u1', organisationId: 'org-a', role: 'manager' }
// The id of an event that genuinely belongs to org-b — org-a must never
// be able to touch it, no matter what it's called in the URL.
const OTHER_ORG_EVENT_CTX = { params: Promise.resolve({ id: 'event-owned-by-org-b' }) }
const OTHER_ORG_SESSION_CTX = { params: Promise.resolve({ id: 'event-owned-by-org-b', sessionId: 'sess-1' }) }
const OTHER_ORG_TICKET_TYPE_CTX = { params: Promise.resolve({ id: 'event-owned-by-org-b', ticketTypeId: 'tt-1' }) }

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
  requireSessionMock.mockResolvedValue(SESSION_ORG_A)
})

describe('Cross-tenant isolation — events', () => {
  it('org A cannot GET org B\'s event — 404, not 200 with data, not 403 (existence not leaked)', async () => {
    queue([]) // WHERE id = ... AND organisation_id = 'org-a' matches nothing
    const res = await eventIdRoute.GET(asNextRequest(new Request('http://localhost/x')), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    expect(call).toContain('org-a')
    expect(call).not.toContain('org-b')
  })

  it('org A cannot PATCH org B\'s event — 404, and no UPDATE statement is ever issued', async () => {
    queue([]) // the ownership SELECT finds nothing
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Hijacked' }), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the ownership check — no UPDATE
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).not.toMatch(/UPDATE/i)
  })

  it('list endpoints only return active-org rows — the query is always scoped to the caller\'s own organisationId', async () => {
    queue([])
    await eventsRoute.GET()
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).toMatch(/organisation_id/i)
    expect(call).toContain('org-a')
  })

  it('a client-supplied organisation_id in the POST body is ignored — the inserted row always uses the session\'s organisationId', async () => {
    queue([{ id: 'e1' }])
    await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {
      name: 'Formal', slug: 'formal', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
      timezone: 'Australia/Adelaide',
      organisation_id: 'org-b', // attempted spoof — must never reach the query
      organisationId: 'org-b',
    }))
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    expect(call).toContain('org-a')
    expect(call).not.toContain('org-b')
  })
})

describe('Cross-tenant isolation — event sessions (child of event)', () => {
  it('org A cannot list sessions under org B\'s event — 404, no session query executes', async () => {
    queue([]) // loadOwnedEvent finds nothing
    const res = await sessionsRoute.GET(asNextRequest(new Request('http://localhost/x')), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('org A cannot attach a session to org B\'s event — 404, no INSERT is ever issued', async () => {
    queue([]) // loadOwnedEvent finds nothing
    const res = await sessionsRoute.POST(jsonReq('http://localhost/x', 'POST', {
      name: 'Rehearsal', starts_at: '2026-12-01T09:00:00Z', ends_at: '2026-12-01T10:00:00Z', capacity: 50,
    }), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).not.toMatch(/INSERT/i)
  })

  it('org A cannot PATCH a session scoped under org B\'s event id — 404, no UPDATE is ever issued', async () => {
    queue([]) // the ownership SELECT (id + event_id + organisation_id) matches nothing
    const res = await sessionIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), OTHER_ORG_SESSION_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('org A cannot DELETE a session scoped under org B\'s event id — 404', async () => {
    queue([]) // DELETE ... RETURNING id matches nothing
    const res = await sessionIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), OTHER_ORG_SESSION_CTX)
    expect(res.status).toBe(404)
  })
})

describe('Cross-tenant isolation — event ticket types (child of event)', () => {
  it('org A cannot list ticket types under org B\'s event — 404, no ticket-type query executes', async () => {
    queue([])
    const res = await ticketTypesRoute.GET(asNextRequest(new Request('http://localhost/x')), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('org A cannot attach a ticket type to org B\'s event — 404, no INSERT is ever issued', async () => {
    queue([])
    const res = await ticketTypesRoute.POST(jsonReq('http://localhost/x', 'POST', {
      name: 'GA', price_cents: 0, capacity: 100,
    }), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).not.toMatch(/INSERT/i)
  })

  it('org A cannot PATCH a ticket type scoped under org B\'s event id — 404', async () => {
    queue([])
    const res = await ticketTypeIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), OTHER_ORG_TICKET_TYPE_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('org A cannot DELETE a ticket type scoped under org B\'s event id — 404', async () => {
    queue([])
    const res = await ticketTypeIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), OTHER_ORG_TICKET_TYPE_CTX)
    expect(res.status).toBe(404)
  })
})
