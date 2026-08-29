import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 2 — proves the public free-registration route
// (app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts):
// no authenticated session helper is called; org/event are resolved
// only from the URL slug pair; capability, published-status, ownership,
// active, and free-price checks are all enforced server-side before any
// write; capacity is enforced via a single atomic statement (never a
// separate check-then-insert); rate limiting is applied before any DB
// call. Every dependency is mocked — no real database or network call
// occurs anywhere in this file.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

function callText(index: number): string {
  const call = sqlMock.mock.calls[index] as unknown as unknown[]
  return (call[0] as TemplateStringsArray).join(' ')
}
function callArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const registerRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route')

const ORG_ROW = [{ id: 'org-a' }]
const PUBLISHED_EVENT_ROW = [{
  id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation',
  description: null, venue: 'Hall', starts_at: new Date('2026-12-01T10:00:00Z'),
  ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
}]
const FREE_ACTIVE_TICKET_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 0 }]

const VALID_BODY = {
  ticket_type_id: 'tt-1',
  quantity: 2,
  purchaser_name: 'Jane Purchaser',
  purchaser_email: 'jane@example.com',
  attendees: [{ name: 'Attendee One' }, { name: 'Attendee Two' }],
}

function req(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/public/events/ld-tennis/graduation/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const CTX = { params: Promise.resolve({ organisationSlug: 'ld-tennis', eventSlug: 'graduation' }) }

beforeEach(() => {
  sqlMock.mockReset()
  checkCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  responseQueue = []
  callCount = 0
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } })
  checkRateLimitMock.mockReturnValue(true)
})

function stripLineComments(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('Public registration — no authentication surface', () => {
  it('never imports/calls an authenticated session helper', () => {
    const src = stripLineComments(fs.readFileSync(
      path.join(process.cwd(), 'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'),
      'utf8',
    ))
    expect(src).not.toMatch(/requireSession|requireRole|getSession|getAuthSession|cookies\(\)/)
  })
})

describe('Public registration — rate limiting', () => {
  it('invokes the rate limiter before any DB call', async () => {
    checkRateLimitMock.mockReturnValue(true)
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    expect(checkRateLimitMock).toHaveBeenCalled()
    const key = checkRateLimitMock.mock.calls[0][0] as string
    expect(key).toContain('ld-tennis')
    expect(key).toContain('graduation')
  })

  it('over-limit returns 429 and no DB write occurs', async () => {
    checkRateLimitMock.mockReturnValue(false)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(429)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('Public registration — capability enforcement', () => {
  it('disabled Events capability makes registration unavailable (404), no DB write', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'NO_ENTITLEMENT' })
    queue(ORG_ROW)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(404)
    // Only the org lookup ran — no event/ticket-type/insert query.
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a capability DB failure fails closed — 404, not a 500, no internal detail leaked', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'DATABASE_ERROR' })
    queue(ORG_ROW)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_ERROR|stack|sql/i)
  })

  // Mutation F: capability check removed -> this test fails if the
  // route stops calling checkCapability at all (checkCapabilityMock
  // would never be invoked, but more importantly a disabled-capability
  // org would incorrectly proceed to 201 instead of 404).
  it('mutation proof F — capability check must actually gate: disabled capability never reaches the insert', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'NO_ENTITLEMENT' })
    queue(ORG_ROW)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).not.toBe(201)
    expect(checkCapabilityMock).toHaveBeenCalledWith('org-a', 'events')
  })
})

describe('Public registration — organisation/event resolution (no unpublished/cross-org access)', () => {
  it('unknown organisation slug -> 404, no further queries', async () => {
    queue([])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('mutation proof G — org/event slug scoping: the org lookup query binds the URL slug, and the event lookup binds both the resolved org id and the URL event slug', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    expect(callArgs(0)).toContain('ld-tennis')
    expect(callText(1)).toMatch(/organisation_id/i)
    expect(callArgs(1)).toContain('org-a')
    expect(callArgs(1)).toContain('graduation')
  })

  // Mutation E: published-status check removed.
  it('mutation proof E — the event lookup query requires status = PUBLISHED', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    expect(callText(1)).toMatch(/status\s*=\s*'PUBLISHED'|status = \$?\d|PUBLISHED/i)
  })

  it('event not found in the resolved organisation -> 404', async () => {
    queue(ORG_ROW, [])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(404)
  })
})

describe('Public registration — ticket type / session ownership and business rules', () => {
  it('mutation proof H — ticket-type lookup is scoped to the resolved organisation AND event, not id alone', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    const text = callText(2)
    expect(text).toMatch(/organisation_id/i)
    expect(text).toMatch(/event_id/i)
    const args = callArgs(2)
    expect(args).toContain('org-a')
    expect(args).toContain('event-1')
    expect(args).toContain('tt-1')
  })

  it('unknown/cross-event/cross-org ticket type -> 400, insert never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('inactive ticket type rejected -> 400, insert never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [{ id: 'tt-1', active: false, price_cents: 0 }])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('mutation proof D — a non-zero DB price is enforced; the route trusts EventTicketType.price_cents, never a client value (which the accepted body shape cannot even carry)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [{ id: 'tt-1', active: true, price_cents: 500 }])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(3) // never reaches the atomic insert
  })

  it("a client-supplied price/total/organisation_id field in the body is silently ignored (validator's accepted shape has no such keys)", async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req({
      ...VALID_BODY,
      price_cents: 999999, total_cents: 999999, organisation_id: 'org-b', organisationId: 'org-b', role: 'super_admin',
    }), CTX)
    const insertArgs = callArgs(3)
    expect(insertArgs).not.toContain(999999)
    expect(insertArgs).not.toContain('org-b')
  })

  it('cross-org/cross-event session id rejected -> 400, insert never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [])
    const res = await registerRoute.POST(req({ ...VALID_BODY, event_session_id: 'sess-from-other-org' }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(4) // org, event, ticket-type, session lookup — never the insert
  })
})

describe('Public registration — input validation', () => {
  it('invalid quantity (0) rejected before any DB call', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, quantity: 0 }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('invalid quantity (negative) rejected before any DB call', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, quantity: -3 }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('excessive quantity rejected before any DB call', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, quantity: 10000 }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('attendee count not matching quantity rejected before any DB call', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, quantity: 3, attendees: [{ name: 'Only One' }] }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('blank attendee name rejected before any DB call', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, attendees: [{ name: '' }, { name: 'Valid' }] }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('invalid purchaser email rejected before any DB call', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, purchaser_email: 'not-an-email' }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('malformed JSON body rejected with 400', async () => {
    const malformed = asNextRequest(new Request('http://localhost/x', { method: 'POST', body: '{not json' }))
    const res = await registerRoute.POST(malformed, CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('Public registration — successful free registration', () => {
  it('a valid free registration succeeds with 201 and a confirmation reference', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }, { order_id: 'order-1' }])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.confirmation_reference).toBe('order-1')
    expect(body.quantity).toBe(2)
  })
})

describe('Public registration — capacity enforcement (concurrency-safe, single atomic statement)', () => {
  it('capacity-exceeded (empty RETURNING, no SQL error) -> 409, not 500, not 201', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, []) // the atomic insert returns zero rows
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(409)
  })

  // Mutation A: ticket-type capacity check removed from the atomic
  // statement's WHERE clause.
  it('mutation proof A — the atomic statement\'s WHERE clause actually gates on ticket-type capacity (FOR UPDATE + sold/capacity comparison)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    const text = callText(3)
    expect(text).toMatch(/FOR UPDATE/i)
    expect(text).toMatch(/sold_tt\.qty \+ .* <= locked_tt\.capacity/i)
  })

  // Mutation B: session capacity check removed when session-bound.
  it('mutation proof B — when a session is selected, the atomic statement ALSO gates on session capacity', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ id: 'sess-1' }], [{ order_id: 'order-1' }])
    await registerRoute.POST(req({ ...VALID_BODY, event_session_id: 'sess-1' }), CTX)
    const text = callText(4)
    expect(text).toMatch(/sold_sess\.qty \+ .* <= locked_sess\.capacity/i)
    expect(text).toMatch(/FOR UPDATE/i)
  })

  // Mutation C: the atomic write is split into multiple non-transactional
  // round trips instead of one statement.
  it('mutation proof C — order + item + attendee creation happens as exactly ONE sql call, not several separate round trips', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    // 4 total: org, event, ticket-type, ONE atomic write.
    expect(sqlMock).toHaveBeenCalledTimes(4)
    const text = callText(3)
    expect(text).toMatch(/INSERT INTO event_orders/i)
    expect(text).toMatch(/INSERT INTO event_order_items/i)
    expect(text).toMatch(/INSERT INTO event_attendees/i)
  })

  it('the atomic statement never runs a separate, unguarded order INSERT before the capacity check — the order insert itself is gated by the same WHERE clause', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [{ order_id: 'order-1' }])
    await registerRoute.POST(req(VALID_BODY), CTX)
    const text = callText(3)
    // The order insert's own SELECT source must include the capacity CTEs.
    const orderInsertIndex = text.search(/INSERT INTO event_orders/i)
    const afterOrderInsert = text.slice(orderInsertIndex)
    expect(afterOrderInsert.slice(0, 400)).toMatch(/FROM locked_tt, sold_tt/i)
  })
})

describe('Public registration — architecture containment', () => {
  it('the route file never imports lib/tennisSchedule or any tennis env var', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/LD_TENNIS_ORG_ID|lib\/tennisSchedule/)
    expect(src).not.toMatch(/::uuid/i)
  })
})
