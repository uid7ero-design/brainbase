import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 2 / Phase 2-R1 — proves the public
// free-registration route
// (app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts):
// no authenticated session helper is called; org/event are resolved
// only from the URL slug pair; capability, published-status, ownership,
// active, and free-price checks are all enforced server-side before any
// write; rate limiting is applied before any DB call; and (R1) capacity
// is enforced via a real Postgres transaction (sql.transaction([...]))
// that acquires FOR UPDATE locks on the capacity-bearing rows BEFORE a
// separate, later capacity-gated insert statement runs — never a single
// compound statement, and never independent non-transactional calls.
//
// Every dependency here is mocked — no real database or network call
// occurs anywhere in this file, so nothing in this file can prove or
// disprove genuine Postgres concurrency behaviour. That is the explicit
// job of the real-Postgres harness at
// scripts/tests/verify-events-phase2-concurrency.sh, which is the sole
// authority for concurrency correctness (see its header comment and the
// Phase 2-R1 review). What THIS file protects is everything concurrency
// testing cannot: route orchestration, tenant/event scoping, capability
// enforcement, price authority, input validation, and the STRUCTURE of
// the transaction (statement count, statement order, which statement
// carries the lock vs. the capacity gate) — i.e. that the code shape
// required by the R1 remediation is actually present, not just that it
// happens to behave correctly under the specific interleavings a mock
// can produce.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))

// sql.transaction([...]) is a SEPARATE entry point from sql`...` itself
// (see lib/db.ts / @neondatabase/serverless) — the route calls
// sql`...` once per statement to BUILD each array element (each of
// those calls still lands in sqlMock, in call order, so callText()/
// callArgs() below can inspect the exact text of every statement,
// transactional or not), then passes the whole array to
// sql.transaction(), which is what this second mock stands in for. Its
// resolved value becomes the route's `transactionResults` directly —
// only the LAST element is ever read by the route (the capacity-gated
// insert's RETURNING rows), so tests only need to control that element.
let transactionFinalResult: unknown[] = [{ order_id: 'order-1' }]
const transactionMock = vi.fn(async () => [[], [], [], [], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock

vi.mock('@/lib/db', () => ({
  default: sqlMock,
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

// Sets what sql.transaction([...]) resolves to (only the last element
// is ever read by route code — see comment above).
function resolveTransaction(finalResult: unknown[]) {
  transactionFinalResult = finalResult
  transactionMock.mockImplementationOnce(async () => [[], [], [], [], finalResult])
}

function rejectTransaction(err: Error) {
  transactionMock.mockRejectedValueOnce(err)
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
const SESSION_ROW = [{ id: 'sess-1' }]

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
  sqlMock.mockClear()
  transactionMock.mockClear()
  checkCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ order_id: 'order-1' }]
  transactionMock.mockImplementation(async () => [[], [], [], [], transactionFinalResult])
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
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
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
    expect(transactionMock).not.toHaveBeenCalled()
  })
})

describe('Public registration — capability enforcement', () => {
  it('disabled Events capability makes registration unavailable (404), no DB write', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'NO_ENTITLEMENT' })
    queue(ORG_ROW)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(404)
    // Only the org lookup ran — no event/ticket-type/transaction.
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('a capability DB failure fails closed — 404, not a 500, no internal detail leaked', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'DATABASE_ERROR' })
    queue(ORG_ROW)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_ERROR|stack|sql/i)
  })

  it('mutation proof — capability check must actually gate: disabled capability never reaches the insert', async () => {
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

  it('mutation proof — org/event slug scoping: the org lookup query binds the URL slug, and the event lookup binds both the resolved org id and the URL event slug', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    expect(callArgs(0)).toContain('ld-tennis')
    expect(callText(1)).toMatch(/organisation_id/i)
    expect(callArgs(1)).toContain('org-a')
    expect(callArgs(1)).toContain('graduation')
  })

  it('mutation proof — the event lookup query requires status = PUBLISHED', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
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
  it('mutation proof — ticket-type lookup is scoped to the resolved organisation AND event, not id alone', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const text = callText(2)
    expect(text).toMatch(/organisation_id/i)
    expect(text).toMatch(/event_id/i)
    const args = callArgs(2)
    expect(args).toContain('org-a')
    expect(args).toContain('event-1')
    expect(args).toContain('tt-1')
  })

  it('unknown/cross-event/cross-org ticket type -> 400, transaction never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(3)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('inactive ticket type rejected -> 400, transaction never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [{ id: 'tt-1', active: false, price_cents: 0 }])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(3)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('mutation proof — a non-zero DB price is enforced; the route trusts EventTicketType.price_cents, never a client value (which the accepted body shape cannot even carry)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [{ id: 'tt-1', active: true, price_cents: 500 }])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(3) // never reaches the transaction
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("a client-supplied price/total/organisation_id field in the body is silently ignored (validator's accepted shape has no such keys)", async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req({
      ...VALID_BODY,
      price_cents: 999999, total_cents: 999999, organisation_id: 'org-b', organisationId: 'org-b', role: 'super_admin',
    }), CTX)
    // Non-session path: 0=org, 1=event, 2=ticket-type, 3=active-questions lookup, 4=lock, 5=diagnostic count, 6=capacity-gated insert.
    const insertArgs = callArgs(6)
    expect(insertArgs).not.toContain(999999)
    expect(insertArgs).not.toContain('org-b')
  })

  it('cross-org/cross-event session id rejected -> 400, transaction never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [])
    const res = await registerRoute.POST(req({ ...VALID_BODY, event_session_id: 'sess-from-other-org' }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(4) // org, event, ticket-type, session lookup — never the transaction
    expect(transactionMock).not.toHaveBeenCalled()
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
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ order_id: 'order-1' }])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.confirmation_reference).toBe('order-1')
    expect(body.quantity).toBe(2)
  })
})

describe('Public registration — transaction structure (R1: split lock / post-lock capacity statements)', () => {
  it('the whole capacity-gated write goes through exactly one sql.transaction([...]) call, never independent non-transactional round trips', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('non-session registration submits exactly 3 statements to the transaction: lock, diagnostic count, capacity-gated insert', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const queries = (transactionMock.mock.calls[0] as unknown as unknown[])[0] as unknown[]
    expect(queries).toHaveLength(3)
  })

  it('session-bound registration submits exactly 5 statements: ticket-type lock, session lock, 2 diagnostic counts, capacity-gated insert', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, SESSION_ROW)
    await registerRoute.POST(req({ ...VALID_BODY, event_session_id: 'sess-1' }), CTX)
    const queries = (transactionMock.mock.calls[0] as unknown as unknown[])[0] as unknown[]
    expect(queries).toHaveLength(5)
  })

  it('mutation proof — the ticket-type lock statement acquires FOR UPDATE and is NOT itself an aggregate/count statement (lock and count are genuinely separate statements, not merged)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    // 0=org, 1=event, 2=ticket-type, 3=active-questions lookup (Phase 4B,
    // §5 — runs once, before the transaction, to validate any submitted
    // responses), 4=lock ticket type, 5=diagnostic count, 6=insert.
    const lockText = callText(4)
    expect(lockText).toMatch(/FOR UPDATE/i)
    expect(lockText).toMatch(/event_ticket_types/i)
    expect(lockText).not.toMatch(/SUM\(/i)
    expect(lockText).not.toMatch(/INSERT INTO/i)
  })

  it('mutation proof — the diagnostic sold-quantity count is a standalone statement, submitted AFTER the lock statement, containing no FOR UPDATE and no INSERT', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const countText = callText(5)
    expect(countText).toMatch(/SUM\(/i)
    expect(countText).not.toMatch(/FOR UPDATE/i)
    expect(countText).not.toMatch(/INSERT INTO/i)
  })

  it('mutation proof A — the capacity-gated insert statement gates on ticket-type capacity via a fresh (post-lock) sold-quantity comparison', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const insertText = callText(6)
    expect(insertText).toMatch(/INSERT INTO event_orders/i)
    expect(insertText).toMatch(/sold_tt\.qty \+ .* <= \(SELECT capacity FROM event_ticket_types/i)
  })

  it('mutation proof B — when a session is selected, the ticket-type lock is acquired BEFORE the session lock (deterministic lock order), and the insert ALSO gates on session capacity', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, SESSION_ROW)
    await registerRoute.POST(req({ ...VALID_BODY, event_session_id: 'sess-1' }), CTX)
    // 0=org, 1=event, 2=ticket-type, 3=session, 4=active-questions lookup, 5=lock tt, 6=lock session, 7=diag tt, 8=diag sess, 9=insert.
    expect(callText(5)).toMatch(/FOR UPDATE/i)
    expect(callText(5)).toMatch(/event_ticket_types/i)
    expect(callText(6)).toMatch(/FOR UPDATE/i)
    expect(callText(6)).toMatch(/event_sessions/i)
    const insertText = callText(9)
    expect(insertText).toMatch(/sold_sess\.qty \+ .* <= \(SELECT capacity FROM event_sessions/i)
  })

  it('mutation proof C — order, item, and attendee creation all happen inside the SAME capacity-gated insert statement (never split across separate writes)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const text = callText(6)
    expect(text).toMatch(/INSERT INTO event_orders/i)
    expect(text).toMatch(/INSERT INTO event_order_items/i)
    expect(text).toMatch(/INSERT INTO event_attendees/i)
  })

  it('the capacity-gated insert never runs unconditionally — the order insert itself SELECTs FROM the sold-quantity CTE that carries the WHERE gate', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const text = callText(6)
    const orderInsertIndex = text.search(/INSERT INTO event_orders/i)
    const afterOrderInsert = text.slice(orderInsertIndex)
    expect(afterOrderInsert.slice(0, 400)).toMatch(/FROM sold_tt/i)
  })
})

describe('Public registration — capacity enforcement outcome', () => {
  it('capacity-exceeded (empty RETURNING from the transaction, no SQL error) -> 409, not 500, not 201', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([])
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(409)
  })
})

describe('Public registration — transaction failure handling (R1 section 17)', () => {
  it('a transaction rejection (lock timeout, connection error, or a genuine constraint violation on order/item/attendee insert) fails safely: 500, generic message, no SQL/lock/internal detail leaked', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    rejectTransaction(new Error('deadlock detected while waiting for ShareLock on transaction 12345; relation "event_ticket_types"'))
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(500)
    const body = await res.json()
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/deadlock|ShareLock|relation|event_ticket_types|stack/i)
  })

  it('a rejection whose error carries a raw SQL detail string is still never echoed back to the anonymous caller', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    const err = new Error('insert or update on table "event_attendees" violates foreign key constraint') as Error & { detail?: string }
    err.detail = 'Key (order_item_id)=(item-999) is not present in table "event_order_items".'
    rejectTransaction(err)
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/event_attendees|event_order_items|foreign key|item-999/i)
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

  it('capacity-bearing rows are locked via sql.transaction, never via a standalone non-transactional FOR UPDATE call', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'),
      'utf8',
    )
    expect(src).toMatch(/sql\.transaction\(/)
    expect(src).toMatch(/FOR UPDATE/)
  })
})
