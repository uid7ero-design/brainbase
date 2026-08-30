import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 4B (§5/§6/§8/§9) — proves response
// persistence end-to-end through both public routes: server-side
// required-field enforcement gates the capacity-reserving transaction
// entirely (a rejected submission never reserves capacity); a
// successful submission writes order-scoped and attendee-scoped
// answers via lib/events/registrationQuestions.ts's
// writeRegistrationResponses(); the paid route persists responses
// BEFORE creating the Stripe Checkout Session and compensates
// (releases the reservation) if that write fails; and neither
// ticket/QR/Stripe-metadata code paths, nor the retry route, ever
// reference response data. Every dependency is mocked — no real
// database, network, or Stripe call occurs anywhere in this file.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

let responseQueue: unknown[][] = []
let callCount = 0
let failResponsesInsert = false
const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  const text = strings.join(' ')
  if (failResponsesInsert && text.includes('event_registration_responses') && text.includes('INSERT')) {
    return Promise.reject(new Error('simulated response-write failure'))
  }
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
let transactionFinalResult: unknown[] = [{ id: 'att-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'tok-1' }]
const transactionMock = vi.fn(async () => [[], [], [], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

const checkPaidTicketingEligibilityMock = vi.fn()
vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: (...args: unknown[]) => checkPaidTicketingEligibilityMock(...args),
}))

const createCheckoutSessionMock = vi.fn()
class MockStripeNotConfiguredError extends Error {}
vi.mock('@/lib/events/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
  RESERVATION_WINDOW_SECONDS: 1860,
  StripeNotConfiguredError: MockStripeNotConfiguredError,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'localhost:3000']]),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function responsesInsertCall(): unknown[] | undefined {
  return sqlMock.mock.calls.find(c => (c[0] as TemplateStringsArray).join(' ').includes('event_registration_responses')) as unknown[] | undefined
}
function cancelUpdateCall(): unknown[] | undefined {
  return sqlMock.mock.calls.find(c => {
    const text = (c[0] as TemplateStringsArray).join(' ')
    return text.includes('UPDATE event_orders') && text.includes("'CANCELLED'")
  }) as unknown[] | undefined
}

const registerRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route')
const checkoutRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route')

const ORG_ROW = [{ id: 'org-a' }]
const PUBLISHED_EVENT_ROW = [{
  id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation',
  description: null, venue: 'Hall', starts_at: new Date('2026-12-01T10:00:00Z'),
  ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
}]
const FREE_ACTIVE_TICKET_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 0 }]
const PAID_ACTIVE_TICKET_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 2500, currency: 'AUD', name: 'General Admission' }]

const ORDER_QUESTION = { id: 'oq-1', label: 'Special requests', help_text: null, field_type: 'LONG_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 0, active: true }
const ATTENDEE_QUESTION = { id: 'aq-1', label: 'Dietary requirements', help_text: null, field_type: 'LONG_TEXT', required: true, scope: 'ATTENDEE', options: null, sort_order: 0, active: true }

function req(url: string, body: unknown) {
  return asNextRequest(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
const REG_URL = 'http://localhost/api/public/events/ld-tennis/graduation/register'
const CHECKOUT_URL = 'http://localhost/api/public/events/ld-tennis/graduation/checkout'
const CTX = { params: Promise.resolve({ organisationSlug: 'ld-tennis', eventSlug: 'graduation' }) }

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  checkCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  checkPaidTicketingEligibilityMock.mockReset()
  createCheckoutSessionMock.mockReset()
  responseQueue = []
  callCount = 0
  failResponsesInsert = false
  transactionFinalResult = [{ id: 'att-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'tok-1' }]
  transactionMock.mockImplementation(async () => [[], [], [], transactionFinalResult])
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } })
  checkRateLimitMock.mockReturnValue(true)
  checkPaidTicketingEligibilityMock.mockResolvedValue({ eligible: true, accountId: 'acct_connected' })
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' })
})

describe('Free registration — required-field enforcement blocks the reservation entirely', () => {
  it('a required ORDER question with no answer -> 400, capacity transaction never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION])
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }],
    }), CTX)
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('a required ATTENDEE question answered for only one of two attendees -> 400, transaction never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ATTENDEE_QUESTION])
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 2, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A', responses: [{ question_id: 'aq-1', answer: 'Vegan' }] }, { name: 'B' }],
    }), CTX)
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('a question_id not on this event\'s active list is rejected (structurally impossible to be cross-event/cross-tenant) -> 400, transaction never reached', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, []) // no active questions
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }], order_responses: [{ question_id: 'some-other-events-question', answer: 'x' }],
    }), CTX)
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('an optional question left blank does not block submission', async () => {
    const optional = { ...ORDER_QUESTION, required: false }
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [optional])
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }],
    }), CTX)
    expect(res.status).toBe(201)
  })
})

// Phase 4B correctness remediation — free registration's response
// writes are now folded into the SAME atomic statement as the
// capacity-gated order/item/attendee insert (see that route's own
// extensive comment). That statement is always the LAST call the route
// issues to sql`...` before handing the built array to
// sql.transaction() — see this file's own mock setup comment on why
// each array-building sql`...` call still lands in sqlMock in order.
function lastSqlCall(): unknown[] {
  const calls = sqlMock.mock.calls
  return calls[calls.length - 1] as unknown as unknown[]
}
function lastSqlCallText(): string {
  return (lastSqlCall()[0] as TemplateStringsArray).join(' ')
}

describe('Free registration — response persistence is atomic with the reservation (Phase 4B remediation)', () => {
  it('structural proof: the order/attendee insert and BOTH response inserts are clauses of the exact same SQL statement, not separate round trips', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION, ATTENDEE_QUESTION])
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1', attendee_name: 'A', ticket_token: 'tok-1' }]
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A', responses: [{ question_id: 'aq-1', answer: 'Vegan' }] }],
      order_responses: [{ question_id: 'oq-1', answer: 'Window seat please' }],
    }), CTX)
    expect(res.status).toBe(201)
    const text = lastSqlCallText()
    expect(text).toMatch(/INSERT INTO event_orders/)
    expect(text).toMatch(/INSERT INTO event_order_items/)
    expect(text).toMatch(/INSERT INTO event_attendees/)
    // Two response-writing CTEs (order-scoped, attendee-scoped), both
    // textually part of this same statement.
    const responseInsertOccurrences = (text.match(/INSERT INTO event_registration_responses/g) ?? []).length
    expect(responseInsertOccurrences).toBe(2)
    // Only ONE call reaches sql.transaction() — the whole thing is
    // submitted as a single non-interactive batch, exactly like every
    // other Events capacity-gated write in this codebase.
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('an order-scoped answer\'s question_id/label/field_type/answer are all present as bound parameters of the atomic statement', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION])
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1', attendee_name: 'A', ticket_token: 'tok-1' }]
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }], order_responses: [{ question_id: 'oq-1', answer: 'Window seat please' }],
    }), CTX)
    expect(res.status).toBe(201)
    const serialised = JSON.stringify(lastSqlCall())
    expect(serialised).toContain('oq-1')
    expect(serialised).toContain('Special requests') // label snapshot
    expect(serialised).toContain('LONG_TEXT') // field_type snapshot
    expect(serialised).toContain('Window seat please')
  })

  it('attendee-scoped answers are correlated by ticket_token (a value known before any row exists), not by attendee id or RETURNING row order', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ATTENDEE_QUESTION])
    transactionFinalResult = [
      { id: 'att-1', order_id: 'order-1', attendee_name: 'A', ticket_token: 'tok-1' },
      { id: 'att-2', order_id: 'order-1', attendee_name: 'B', ticket_token: 'tok-2' },
    ]
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 2, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [
        { name: 'A', responses: [{ question_id: 'aq-1', answer: 'Vegan' }] },
        { name: 'B', responses: [{ question_id: 'aq-1', answer: 'None' }] },
      ],
    }), CTX)
    expect(res.status).toBe(201)
    const text = lastSqlCallText()
    // The attendee-response CTE must join on ticket_token, never on id.
    expect(text).toMatch(/ins_attendee_responses[\s\S]*ON r\.ticket_token = ia\.ticket_token/)
    const serialised = JSON.stringify(lastSqlCall())
    expect(serialised).toContain('Vegan')
    expect(serialised).toContain('None')
  })

  it('an event with no active questions still submits one atomic statement, with empty response arrays (no extra round trip, no separate follow-up write)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [])
    const callsBefore = sqlMock.mock.calls.length
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }],
    }), CTX)
    expect(res.status).toBe(201)
    // org, event, ticket-type, active-questions, lock, diagnostic count,
    // atomic statement — exactly 7 calls, no 8th "write responses" call.
    expect(sqlMock.mock.calls.length - callsBefore).toBe(7)
    const text = lastSqlCallText()
    expect(text).toMatch(/INSERT INTO event_registration_responses/)
  })

  it('quantity changes: 3 attendees each answering the same required attendee question all succeed, one answer set per attendee, in the same atomic statement', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ATTENDEE_QUESTION])
    transactionFinalResult = [
      { id: 'att-1', order_id: 'order-1', attendee_name: 'A', ticket_token: 't1' },
      { id: 'att-2', order_id: 'order-1', attendee_name: 'B', ticket_token: 't2' },
      { id: 'att-3', order_id: 'order-1', attendee_name: 'C', ticket_token: 't3' },
    ]
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 3, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [
        { name: 'A', responses: [{ question_id: 'aq-1', answer: 'A-answer' }] },
        { name: 'B', responses: [{ question_id: 'aq-1', answer: 'B-answer' }] },
        { name: 'C', responses: [{ question_id: 'aq-1', answer: 'C-answer' }] },
      ],
    }), CTX)
    expect(res.status).toBe(201)
    const serialised = JSON.stringify(lastSqlCall())
    expect(serialised).toContain('A-answer')
    expect(serialised).toContain('B-answer')
    expect(serialised).toContain('C-answer')
  })

  it('a failure anywhere within the atomic statement (order/attendee insert OR either response insert) rejects the WHOLE registration — 500, no fabricated success, no ticket exposed', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION])
    // Because the response writes are now clauses of the SAME statement
    // as the reservation, there is no longer any way, even at the mock
    // level, to fail "only the response insert" while the reservation
    // still succeeds — the entire sql.transaction([...]) call is one
    // unit that either resolves or rejects as a whole. This IS the
    // atomicity guarantee: proven here by simulating a genuine
    // statement-level failure (e.g. what a real FK violation on
    // question_id would cause) and confirming nothing is fabricated.
    transactionMock.mockRejectedValueOnce(new Error(
      'insert or update on table "event_registration_responses" violates foreign key constraint "event_registration_responses_question_org_fkey"',
    ))
    const res = await registerRoute.POST(req(REG_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }], order_responses: [{ question_id: 'oq-1', answer: 'note' }],
    }), CTX)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/ticket_token|confirmation_reference/i)
    expect(JSON.stringify(body)).not.toMatch(/foreign key|event_registration_responses/i)
  })
})

// Real transactional rollback (capacity/order/attendees/responses all
// disappearing together on failure) cannot be proven against a mock —
// a mock has no genuine transaction, snapshot, or rollback semantics,
// by construction. That proof is the job of the real-Postgres harness
// at scripts/tests/verify-events-phase4b-response-atomicity.sh (same
// "disposable postgres:16-alpine container, replay the actual
// statement" pattern as every other Events concurrency harness in this
// repo) — see that file for: a successful atomic write (order + item +
// attendees + order-scoped + attendee-scoped responses all present),
// and a forced FK-violation on the response insert leaving ZERO trace
// of the order/attendees/responses and UNCONSUMED capacity.

describe('Paid checkout — responses persisted before the Stripe redirect (§8)', () => {
  it('a required ORDER question with no answer -> 400, no reservation, no Stripe session created', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, PAID_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION])
    const res = await checkoutRoute.POST(req(CHECKOUT_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }],
    }), CTX)
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('a valid submission writes responses BEFORE createCheckoutSession is invoked', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, PAID_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION])
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await checkoutRoute.POST(req(CHECKOUT_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }], order_responses: [{ question_id: 'oq-1', answer: 'Aisle seat' }],
    }), CTX)
    expect(res.status).toBe(201)
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
    const insertCall = sqlMock.mock.calls.findIndex(c => (c[0] as TemplateStringsArray).join(' ').includes('event_registration_responses'))
    expect(insertCall).toBeGreaterThanOrEqual(0)
    // sqlMock is invoked (to build the responses INSERT) strictly before
    // the Stripe call — proven via each mock's own invocation order,
    // not a hardcoded call index, so this survives statement-shape
    // changes elsewhere in the route.
    const responsesInvocationOrder = sqlMock.mock.invocationCallOrder[insertCall]
    const stripeInvocationOrder = createCheckoutSessionMock.mock.invocationCallOrder[0]
    expect(responsesInvocationOrder).toBeLessThan(stripeInvocationOrder)
  })

  it('a response-write failure releases the reservation (compensating cancellation) and never calls Stripe — fatal here, unlike the free route', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, PAID_ACTIVE_TICKET_TYPE_ROW, [ORDER_QUESTION])
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    failResponsesInsert = true
    const res = await checkoutRoute.POST(req(CHECKOUT_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }], order_responses: [{ question_id: 'oq-1', answer: 'note' }],
    }), CTX)
    expect(res.status).toBe(500)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    expect(cancelUpdateCall()).toBeDefined()
  })

  it('no active questions and no submitted responses -> checkout proceeds to Stripe exactly as before Phase 4B, no responses write attempted', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, PAID_ACTIVE_TICKET_TYPE_ROW, [])
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await checkoutRoute.POST(req(CHECKOUT_URL, {
      ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
      attendees: [{ name: 'A' }],
    }), CTX)
    expect(res.status).toBe(201)
    expect(responsesInsertCall()).toBeUndefined()
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
  })
})

describe('Retry payment — never touches responses (§8: "retry does not duplicate responses")', () => {
  it('the retry route never imports registrationQuestions and never references event_registration_responses — satisfied by construction, since retry only extends the existing order/expiry, never re-creates orders/items/attendees', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/events/[id]/orders/[orderId]/retry/route.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/registrationQuestions/)
    expect(src).not.toMatch(/event_registration_responses/)
    expect(src).not.toMatch(/INSERT INTO event_orders|INSERT INTO event_order_items|INSERT INTO event_attendees/)
  })
})

describe('Privacy (§6) — response data never reaches ticket URLs, QR payloads, or Stripe metadata', () => {
  const filesThatMustNeverReferenceResponses = [
    'lib/events/publicTicket.ts',
    'lib/events/qr.ts',
    'lib/events/stripe.ts',
  ]

  for (const relPath of filesThatMustNeverReferenceResponses) {
    it(`${relPath} never references event_registration_responses or registrationQuestions`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
      expect(src).not.toMatch(/event_registration_responses/)
      expect(src).not.toMatch(/registrationQuestions/)
    })
  }

  it('the paid checkout route never passes order_responses/attendee responses into createCheckoutSession\'s Stripe metadata call', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'),
      'utf8',
    )
    const callIndex = src.indexOf('createCheckoutSession({')
    expect(callIndex).toBeGreaterThan(-1)
    const callSite = src.slice(callIndex, callIndex + 700)
    expect(callSite).not.toMatch(/order_responses|attendeeAnswers|orderAnswers|responses:/)
  })

  it('the public event detail fetch (what an anonymous visitor\'s browser receives) exposes question DEFINITIONS but never a response/answer shape', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/events/publicEventDetail.ts'), 'utf8')
    expect(src).toMatch(/PublicQuestion/)
    expect(src).not.toMatch(/event_registration_responses/)
  })
})

describe('Manager view (§7) — orders route includes snapshot-based responses, tenant-scoped', () => {
  it('the orders query reads question_label_snapshot/field_type_snapshot (never the live question row) for both order- and attendee-scoped answers, each still organisation_id-scoped', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/events/[id]/orders/route.ts'), 'utf8')
    expect(src).toMatch(/question_label_snapshot/)
    expect(src).toMatch(/field_type_snapshot/)
    expect(src).toMatch(/r\.organisation_id = ea\.organisation_id/)
    expect(src).toMatch(/r\.organisation_id = eo\.organisation_id/)
  })
})
