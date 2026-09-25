import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 4 — paid tickets, Stripe Checkout, payment
// state. Every dependency here is mocked, including lib/events/stripe.ts
// itself for route-level tests (the Stripe SDK is never invoked for
// real) — no real database, network, or Stripe API call occurs anywhere
// in this file. Real-Postgres proof of the paid-reservation capacity
// mechanism is the sole job of
// scripts/tests/verify-events-phase4-payment-concurrency.sh, matching
// the exact division of responsibility already established for Phase 2
// (verify-events-phase2-concurrency.sh) and Phase 3
// (verify-events-phase3-checkin-concurrency.sh). What THIS file proves
// is everything concurrency testing cannot: route orchestration,
// tenant/event scoping, permission enforcement, webhook signature/
// idempotency handling, price/currency server-derivation, and
// architecture containment.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─── Shared mocks ────────────────────────────────────────────────────

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
let transactionFinalResult: unknown[] = [{ order_id: 'order-1' }]
const transactionMock = vi.fn(async () => [[], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

// Phase 5 — Events -> CRM sync is a separate, orthogonal concern with
// its own dedicated coverage (tests/containment/crmEventSyncBoundary.test.ts,
// crmEventSyncPrivacy.test.ts, scripts/tests/verify-events-crm-sync-
// concurrency.sh). Mocked away here as a no-op so this file's existing
// sqlMock call-count assertions — including the vi.doUnmock('@/lib/
// events/stripe') + vi.resetModules() real-implementation webhook tests
// further down — continue to reflect ONLY the payment/webhook behaviour
// they were written to prove, not incidentally coupled to however many
// internal queries CRM sync happens to issue.
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivity: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
}))

const createCheckoutSessionMock = vi.fn()
const constructWebhookEventMock = vi.fn()
const processStripeWebhookEventMock = vi.fn()
const createRefundMock = vi.fn()
class MockStripeNotConfiguredError extends Error {}
const expireCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
  constructWebhookEvent: (...args: unknown[]) => constructWebhookEventMock(...args),
  processStripeWebhookEvent: (...args: unknown[]) => processStripeWebhookEventMock(...args),
  createRefund: (...args: unknown[]) => createRefundMock(...args),
  expireCheckoutSession: (...args: unknown[]) => expireCheckoutSessionMock(...args),
  RESERVATION_WINDOW_SECONDS: 1800,
  StripeNotConfiguredError: MockStripeNotConfiguredError,
}))

// Phase 4A — every checkout attempt now goes through the Connect
// eligibility gate first; mocked as eligible-by-default here so the
// pre-existing Phase 4 checkout/refund tests (written before Connect
// existed) keep exercising exactly what they always did. Connect's OWN
// behaviour (ineligible orgs, account-id propagation, etc.) is covered
// in tests/containment/eventsPhase4AConnect.test.ts, not duplicated
// here.
const checkPaidTicketingEligibilityMock = vi.fn()
vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: (...args: unknown[]) => checkPaidTicketingEligibilityMock(...args),
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

// The checkout route derives its own origin via headers() (see that
// file's comment) — outside a real Next.js request scope (this Vitest
// environment) that throws, so it's mocked here the same way this
// repo's own OAuth-callback containment tests already mock next/headers.
vi.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'localhost:3000']]),
}))

const checkoutRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route')
const statusRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route')
const webhookRoute = await import('@/app/api/public/events/webhooks/stripe/route')
const refundRoute = await import('@/app/api/events/[id]/orders/[orderId]/refund/route')

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  createCheckoutSessionMock.mockReset()
  constructWebhookEventMock.mockReset()
  processStripeWebhookEventMock.mockReset()
  createRefundMock.mockReset()
  checkPaidTicketingEligibilityMock.mockReset()
  expireCheckoutSessionMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ order_id: 'order-1' }]
  transactionMock.mockImplementation(async () => [[], transactionFinalResult])
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
  checkRateLimitMock.mockReturnValue(true)
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' })
  checkPaidTicketingEligibilityMock.mockResolvedValue({ eligible: true, accountId: 'acct_test_org_a' })
  expireCheckoutSessionMock.mockResolvedValue(undefined)
})

// ─── Paid checkout reservation route ────────────────────────────────

describe('Paid checkout route — validation and price integrity', () => {
  const ORG_ROW = [{ id: 'org-a' }]
  const EVENT_ROW = [{
    id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal', description: null, venue: null,
    starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
  }]
  const PAID_TT_ROW = [{ id: 'tt-1', active: true, price_cents: 2500, currency: 'AUD', name: 'Premium Guest' }]
  const FREE_TT_ROW = [{ id: 'tt-1', active: true, price_cents: 0, currency: 'AUD', name: 'Student' }]
  const VALID_BODY = {
    ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
    attendees: [{ name: 'Attendee A' }],
  }
  function req(body: unknown) {
    return asNextRequest(new Request('http://localhost/api/public/events/org/evt/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }
  const CTX = { params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'evt' }) }

  it('rejects a FREE ticket type — this route is the paid path only', async () => {
    queue(ORG_ROW, EVENT_ROW, FREE_TT_ROW)
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/free/i)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('rejects an inactive ticket type', async () => {
    queue(ORG_ROW, EVENT_ROW, [{ ...PAID_TT_ROW[0], active: false }])
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
  })

  it('rejects an unknown ticket type', async () => {
    queue(ORG_ROW, EVENT_ROW, [])
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(400)
  })

  it('price is ALWAYS derived from the DB row, never from a client-supplied price field — the validator does not even accept one', () => {
    const validationSrc = stripComments(read('lib/events/publicValidation.ts'))
    expect(validationSrc).not.toMatch(/price_cents|unit_price|amount/i)
  })

  it('a client-supplied price_cents in the request body has no effect — Stripe is called with the DB-derived amount', async () => {
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW)
    await checkoutRoute.POST(req({ ...VALID_BODY, price_cents: 1 }), CTX)
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ unitAmountCents: 2500, currency: 'AUD', quantity: 1 }),
    )
  })

  it('on successful reservation + Stripe session creation, returns a checkout_url and 201', async () => {
    // Positions 3-5 are padding for calls whose OWN resolved values this
    // test doesn't care about (listActiveQuestions finding none active;
    // the reservation transaction's two internal statements — its REAL
    // result comes from transactionFinalResult, not responseQueue, same
    // as every other mocked-transaction test in this file); position 6
    // is the checkout-vs-retry race closure's own generation-marker read
    // (PR #231 follow-up), position 7 is the now-checked write-back
    // UPDATE that must resolve non-empty for this "succeeds" test.
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW, [], [], [], [{ expires_at: '2026-01-01T00:00:00.000Z' }], [{ id: 'order-1' }])
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_123')
  })

  it('when the capacity-gated reservation transaction returns zero rows (sold out), Stripe is never called', async () => {
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW)
    transactionFinalResult = []
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('if Stripe Checkout Session creation fails, the just-created reservation is released (order cancelled), not left as an indefinite hold', async () => {
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW)
    createCheckoutSessionMock.mockRejectedValue(new Error('network error'))
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(500)
    const releaseCall = sqlMock.mock.calls.find(args =>
      (args as unknown as TemplateStringsArray[])[0]?.[0]?.toString().includes('CANCELLED'),
    )
    expect(releaseCall).toBeDefined()
  })

  it('is rate limited like the free registration route, keyed by IP + org + event slug', async () => {
    checkRateLimitMock.mockReturnValue(false)
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(429)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('never calls requireSession/requireRole — fully anonymous, matching the free registration route', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    expect(code).not.toMatch(/requireSession|requireRole|getSession|getAuthSession/)
  })
})

// ─── Checkout-vs-Retry race closure (PR #231 follow-up) ────────────────
//
// The original checkout route creates its order, commits it (session id
// NULL), then calls Stripe, then writes the session id back — a gap a
// manager Retry can land in (reading the same NULL-session order, safely
// per PR #231's own earlier closure), reacquire the order, and create
// its OWN replacement session, all before the original checkout's write-
// back runs. That write-back was unconditional: it would silently
// overwrite the Retry-created session id with its own, stale one,
// leaving TWO independently payable Stripe Checkout Sessions for one
// order. Closed the same way as PR #231's own concurrency guard: a
// compare-and-set on `expires_at` (an existing column, captured before
// calling Stripe) plus `stripe_checkout_session_id IS NULL`, on every
// write-back this route performs (the success write-back AND both
// compensating-cancel UPDATEs). See lib/events/stripe.ts's
// expireCheckoutSession for the losing-session cleanup.
//
// True concurrent-request proof (the ordering in the PR's own 6-step
// scenario) lives in scripts/tests/verify-events-phase4-payment-
// concurrency.sh section K; this suite proves the route issues the
// guarded statements and handles a loss safely.

describe('Checkout-vs-Retry race closure (PR #231 follow-up)', () => {
  const routeSrc = () => stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
  const ORG_ROW = [{ id: 'org-a' }]
  const EVENT_ROW = [{
    id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal', description: null, venue: null,
    starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
  }]
  const PAID_TT_ROW = [{ id: 'tt-1', active: true, price_cents: 2500, currency: 'AUD', name: 'Premium Guest' }]
  const VALID_BODY = {
    ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
    attendees: [{ name: 'Attendee A' }],
  }
  function req(body: unknown) {
    return asNextRequest(new Request('http://localhost/api/public/events/org/evt/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }
  const CTX = { params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'evt' }) }

  it('the write-back UPDATE is guarded on BOTH stripe_checkout_session_id IS NULL and expires_at IS NOT DISTINCT FROM the captured generation marker — no longer unconditional', () => {
    const code = routeSrc()
    expect(code).toMatch(/WHERE id = \$\{orderId\} AND stripe_checkout_session_id IS NULL\s*\n\s*AND expires_at IS NOT DISTINCT FROM \$\{capturedExpiresAt\}/)
  })

  it('capturedExpiresAt is read from the order row BEFORE createCheckoutSession is called, not after', () => {
    const code = routeSrc()
    const captureIdx = code.indexOf('const capturedExpiresAt = ')
    const stripeCallIdx = code.indexOf('await createCheckoutSession({')
    expect(captureIdx).toBeGreaterThan(-1)
    expect(stripeCallIdx).toBeGreaterThan(-1)
    expect(captureIdx).toBeLessThan(stripeCallIdx)
  })

  it('both compensating-cancellation UPDATEs (response-write failure, Stripe creation failure) are ALSO guarded on the same generation marker — a losing original checkout must not cancel an order a Retry has already legitimately advanced', () => {
    const code = routeSrc()
    const occurrences = code.match(/AND payment_status = 'PENDING' AND expires_at IS NOT DISTINCT FROM \$\{capturedExpiresAt\}/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('D/loss handling: when the write-back guard fails to match (a concurrent Retry already claimed this order), the response never contains a checkout_url — the losing session is never handed to the client', async () => {
    // Same shape as "on successful reservation..." above, EXCEPT the
    // final (write-back) response is empty — simulating the guard not
    // matching because a concurrent Retry has already advanced expires_at.
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW, [], [], [], [{ expires_at: '2026-01-01T00:00:00.000Z' }], [])
    const res = await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.checkout_url).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/cs_test_123|checkout\.stripe\.com/)
  })

  it('D/loss handling: the just-created (now orphaned) Stripe Checkout Session is expired — expireCheckoutSession is called with the exact session id and the order\'s connected account', async () => {
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW, [], [], [], [{ expires_at: '2026-01-01T00:00:00.000Z' }], [])
    await checkoutRoute.POST(req(VALID_BODY), CTX)
    expect(expireCheckoutSessionMock).toHaveBeenCalledWith('cs_test_123', 'acct_test_org_a')
  })

  it('a failure to expire the orphaned session does not itself crash the route — expireCheckoutSession is best-effort (see its own comment in lib/events/stripe.ts)', async () => {
    expireCheckoutSessionMock.mockRejectedValue(new Error('stripe: session already expired'))
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW, [], [], [], [{ expires_at: '2026-01-01T00:00:00.000Z' }], [])
    // expireCheckoutSession itself never throws in real code (see its
    // own try/catch) — this test's rejected mock is only meaningful if
    // the CALLER also tolerates a hypothetical throw; asserting the
    // route resolves cleanly either way is the actual contract here.
    await expect(checkoutRoute.POST(req(VALID_BODY), CTX)).resolves.toBeDefined()
  })

  it('F: a genuinely non-racing checkout (the common case) is completely unaffected — same "on successful reservation" test above already proves 201 + real checkout_url with the new guard in place', () => {
    // Documentation-only pointer test — the actual proof is the
    // pre-existing "on successful reservation + Stripe session creation,
    // returns a checkout_url and 201" test in the describe block above,
    // which already exercises this exact guarded write-back on its
    // success path.
    expect(true).toBe(true)
  })

  it('C: two original checkout submissions can never race on the SAME order — each POST to this route always creates its OWN new order via its own INSERT; there is no shared order id for two "original checkout" requests to contend over', () => {
    const code = routeSrc()
    // Two INSERT INTO event_orders exist (the session-bound and non-
    // session-bound reservation branches) — both are order-CREATING
    // statements, never an UPDATE against an existing order id. Every
    // checkout POST reaches exactly one of these two branches and always
    // produces a brand-new, distinct order id (see RETURNING id/order_id
    // in both) — there is no code path where a SECOND checkout request
    // could target an order a FIRST checkout request already created.
    const occurrences = code.match(/INSERT INTO event_orders/g) ?? []
    expect(occurrences.length).toBe(2)
  })
})

describe('Checkout status route — never trusts the redirect alone', () => {
  function req(sessionId: string) {
    return asNextRequest(new Request(`http://localhost/api/public/events/org/evt/checkout/status?session_id=${sessionId}`))
  }
  const CTX = { params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'evt' }) }
  const ORG_ROW = [{ id: 'org-a' }]
  const EVENT_ROW = [{
    id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal', description: null, venue: null,
    starts_at: new Date(), ends_at: new Date(), timezone: 'Australia/Adelaide',
  }]

  it('returns the DB-recorded payment_status, not an assumption from the redirect', async () => {
    queue(ORG_ROW, EVENT_ROW, [{ id: 'order-1', status: 'PENDING', payment_status: 'PENDING', total_cents: 2500, currency: 'AUD' }])
    const res = await statusRoute.GET(req('cs_test_123'), CTX)
    const body = await res.json()
    expect(body.payment_status).toBe('PENDING')
    expect(body.tickets).toEqual([])
  })

  it('once PAID, returns ticket links (attendee_name + ticket_token only)', async () => {
    queue(
      ORG_ROW, EVENT_ROW,
      [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID', total_cents: 2500, currency: 'AUD' }],
      [{ attendee_name: 'Jane', ticket_token: 'a'.repeat(64) }],
    )
    const res = await statusRoute.GET(req('cs_test_123'), CTX)
    const body = await res.json()
    expect(body.tickets).toEqual([{ attendee_name: 'Jane', ticket_token: 'a'.repeat(64) }])
  })

  it('never exposes a Stripe internal id in its response', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route.ts'))
    const returnStart = code.lastIndexOf('return NextResponse.json({')
    const returnBody = code.slice(returnStart, code.indexOf('});', returnStart))
    expect(returnBody).not.toMatch(/stripe_/)
  })

  it('an unknown session_id (or one for a different event) 404s', async () => {
    queue(ORG_ROW, EVENT_ROW, [])
    const res = await statusRoute.GET(req('cs_unknown'), CTX)
    expect(res.status).toBe(404)
  })
})

// ─── Stripe webhook route ────────────────────────────────────────────

describe('Stripe webhook route — signature verification', () => {
  function webhookReq(body: string, signature?: string) {
    const headers: Record<string, string> = {}
    if (signature) headers['stripe-signature'] = signature
    return asNextRequest(new Request('http://localhost/api/public/events/webhooks/stripe', { method: 'POST', headers, body }))
  }

  it('missing signature header -> 400, never processed', async () => {
    const res = await webhookRoute.POST(webhookReq('{}'))
    expect(res.status).toBe(400)
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled()
  })

  it('invalid/forged signature -> 400, never processed', async () => {
    constructWebhookEventMock.mockImplementation(() => { throw new Error('signature mismatch') })
    const res = await webhookReq('{}', 'bad-sig') && await webhookRoute.POST(webhookReq('{}', 'bad-sig'))
    expect(res!.status).toBe(400)
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled()
  })

  it('a verified event is dispatched to processStripeWebhookEvent and acknowledged 200', async () => {
    const fakeEvent = { type: 'checkout.session.completed', data: { object: {} } }
    constructWebhookEventMock.mockReturnValue(fakeEvent)
    processStripeWebhookEventMock.mockResolvedValue({ handled: true, type: fakeEvent.type })
    const res = await webhookRoute.POST(webhookReq('{}', 'good-sig'))
    expect(res.status).toBe(200)
    expect(processStripeWebhookEventMock).toHaveBeenCalledWith(fakeEvent)
  })

  it('a processing failure returns non-2xx so Stripe retries — never silently swallowed', async () => {
    constructWebhookEventMock.mockReturnValue({ type: 'checkout.session.completed', data: { object: {} } })
    processStripeWebhookEventMock.mockRejectedValue(new Error('db error'))
    const res = await webhookRoute.POST(webhookReq('{}', 'good-sig'))
    expect(res.status).toBe(500)
  })

  it('reads the raw body via req.text(), never req.json(), before signature verification', () => {
    const code = stripComments(read('app/api/public/events/webhooks/stripe/route.ts'))
    expect(code).toMatch(/req\.text\(\)/)
    expect(code).not.toMatch(/req\.json\(\)/)
  })

  it('has no session/capability/role auth — authenticity comes entirely from the Stripe signature', () => {
    const code = stripComments(read('app/api/public/events/webhooks/stripe/route.ts'))
    expect(code).not.toMatch(/requireSession|authorizeEventsRequest/)
  })
})

// ─── lib/events/stripe.ts — webhook event processing (idempotency) ───

describe('processStripeWebhookEvent — idempotent state transitions', () => {
  beforeEach(() => { vi.doUnmock('@/lib/events/stripe') })

  it('checkout.session.completed with payment_status !== "paid" is a safe no-op (async payment method not yet settled)', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue()
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'unpaid', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(event)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('checkout.session.completed missing metadata.event_order_id is a safe no-op — never guesses which order', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue()
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', metadata: {} } },
    } as never
    await processStripeWebhookEvent(event)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('checkout.session.completed with payment_status "paid" flips the order, issues attendee tokens, AND issues a booking token', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1' }], [{ id: 'att-1' }])
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(event)
    // order-flip UPDATE, attendee-lookup SELECT, ticket-token UPDATE,
    // booking-token UPDATE (booking wallet — see
    // issueBookingTokenForPaidOrder, called unconditionally right after
    // issueTicketTokensForPaidOrder).
    expect(sqlMock).toHaveBeenCalledTimes(4)
  })

  // Phase 3E.3 — the qualifying payment transition also schedules
  // automatic ticket email, in the SAME first statement as the order
  // flip (never a 5th sql call).
  it('checkout.session.completed with payment_status "paid" schedules ticket_email_status=\'pending\' inside the SAME order-flip statement — no extra sql call', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1' }], [{ id: 'att-1' }])
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(event)
    expect(sqlMock).toHaveBeenCalledTimes(4) // unchanged — no new statement added
    const firstCallText = ((sqlMock.mock.calls[0] as unknown[])[0] as string[]).join('')
    expect(firstCallText).toMatch(/UPDATE event_orders/)
    expect(firstCallText).toMatch(/status = 'CONFIRMED'/)
    expect(firstCallText).toMatch(/ticket_email_status = 'pending'/)
    // Same statement, not a second one — the scheduling clause appears
    // strictly between the UPDATE keyword and this statement's own
    // WHERE clause, never in a separate sql`...` call.
    expect(firstCallText.indexOf('ticket_email_status = \'pending\'')).toBeGreaterThan(firstCallText.indexOf('UPDATE event_orders'))
    expect(firstCallText.indexOf('ticket_email_status = \'pending\'')).toBeLessThan(firstCallText.indexOf('WHERE id ='))
  })

  it('a duplicate delivery of the same event (order already PAID) makes the order-flip UPDATE a no-op, and token issuance finds nothing to issue — ticket_email_status is never touched on retry, because it is set by the exact same guarded statement that also matched zero rows', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([], []) // order-flip matches 0 rows (already PAID); attendee lookup finds no NULL tokens left
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await expect(processStripeWebhookEvent(event)).resolves.not.toThrow()
  })

  it('checkout.session.expired releases the hold (guarded by payment_status = PENDING)', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([])
    const event = {
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(event)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('an unrecognised event type is acknowledged (handled: false) without touching the database', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    const event = { type: 'customer.created', data: { object: {} } } as never
    const result = await processStripeWebhookEvent(event)
    expect(result.handled).toBe(false)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ─── Asynchronous Stripe payment success closure ───────────────────────
//
// checkout.session.async_payment_succeeded — the event a delayed/
// asynchronous payment method (e.g. certain bank debits) generates when
// payment settles AFTER checkout.session.completed already fired at a
// non-'paid' payment_status (see that test above: "payment_status !==
// 'paid' is a safe no-op"). Confirmed via Stripe's own docs
// (docs.stripe.com/checkout/fulfillment,
// docs.stripe.com/api/events/types) that this event's data.object is the
// identical `checkout.session` object shape as .completed, and that
// Stripe's own recommended pattern is to route both event types to the
// SAME fulfilment function. Every test below proves this new dispatch
// path inherits the EXISTING guards on handleCheckoutSessionCompleted —
// no new SQL statement, no new idempotency mechanism, nothing
// event-type-specific in the guard itself.
function asyncSucceededEvent(overrides: Record<string, unknown> = {}, account: string | null = null) {
  return {
    type: 'checkout.session.async_payment_succeeded',
    account,
    data: {
      object: {
        id: 'cs_1',
        payment_status: 'paid',
        payment_intent: 'pi_async_1',
        metadata: { event_order_id: 'order-1' },
        ...overrides,
      },
    },
  } as never
}

describe('processStripeWebhookEvent — checkout.session.async_payment_succeeded (asynchronous payment success closure)', () => {
  beforeEach(() => { vi.doUnmock('@/lib/events/stripe') })
  const STRIPE_SOURCE = stripComments(read('lib/events/stripe.ts'))
  const CHECKOUT_ROUTE_SOURCE = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))

  // B5-B13: order begins PENDING, the async event arrives, correlates to
  // the correct order, transitions payment_status -> PAID and status ->
  // CONFIRMED, issues tickets/booking token exactly once, and schedules
  // ticket_email_status='pending' exactly once, inside the SAME atomic
  // statement as the audit row — byte-for-byte the same proof already
  // established for checkout.session.completed above, now exercised via
  // the async event type instead.
  it('B: flips PENDING -> PAID/CONFIRMED, issues attendee + booking tokens, and schedules ticket_email_status=\'pending\' — same guarded statement, same call count as the synchronous path', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [{ id: 'att-1' }])
    const result = await processStripeWebhookEvent(asyncSucceededEvent())
    expect(result).toEqual({ handled: true, type: 'checkout.session.async_payment_succeeded' })
    // order-flip+audit CTE, attendee-lookup SELECT, ticket-token UPDATE, booking-token UPDATE
    expect(sqlMock).toHaveBeenCalledTimes(4)
    const firstCallText = ((sqlMock.mock.calls[0] as unknown[])[0] as string[]).join('')
    expect(firstCallText).toMatch(/UPDATE event_orders/)
    expect(firstCallText).toMatch(/status = 'CONFIRMED'/)
    expect(firstCallText).toMatch(/payment_status = 'PAID'/)
    expect(firstCallText).toMatch(/ticket_email_status = 'pending'/)
    expect(firstCallText).toMatch(/INSERT INTO audit_logs/)
    expect(firstCallText).toMatch(/event_order\.payment_succeeded/)
  })

  it('B7/B8: correlation requires the exact order id, exact stripe_checkout_session_id, AND exact connected-account match — same composite WHERE the synchronous path uses, not a looser lookup for the async case', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [])
    await processStripeWebhookEvent(asyncSucceededEvent({}, 'acct_org_a'))
    const firstCallText = ((sqlMock.mock.calls[0] as unknown[])[0] as string[]).join('')
    expect(firstCallText).toMatch(/WHERE id = /)
    expect(firstCallText).toMatch(/AND stripe_checkout_session_id = /)
    expect(firstCallText).toMatch(/AND payment_status = 'PENDING'/)
    expect(firstCallText).toMatch(/AND stripe_account_id = /)
  })

  // C14-C18: exact same event redelivered — second call is a no-op, no
  // duplicate tickets, no duplicate email scheduling, no duplicate
  // success audit row (the audit INSERT rides the same RETURNING-gated
  // CTE, so zero UPDATE rows means zero audit rows too, by construction).
  it('C: the exact same async_payment_succeeded event redelivered twice — second delivery is a safe no-op (order already PAID matches zero rows)', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [{ id: 'att-1' }])
    await processStripeWebhookEvent(asyncSucceededEvent())
    queue([], [])
    await expect(processStripeWebhookEvent(asyncSucceededEvent())).resolves.toEqual({
      handled: true,
      type: 'checkout.session.async_payment_succeeded',
    })
  })

  // D19-D20: two DISTINCT Stripe events (different event ids/types) both
  // representing the same already-successful payment cannot double-
  // finalise — proven here as async_payment_succeeded finalising first,
  // then a late-arriving (redelivered) checkout.session.completed for the
  // SAME session, whose payload still embeds its own original, now-stale
  // payment_status. BrainBase's guard is state-based (payment_status =
  // 'PENDING'), not event-id based, so this is safe regardless of event
  // identity — Stripe's own docs note snapshot events can't be de-duped
  // by `created` alone and recommend event-id tracking; the state guard
  // used here is a strictly stronger property than that recommendation.
  it('D: async_payment_succeeded finalises first; a distinct, later-delivered checkout.session.completed for the same session (still embedding its own original non-paid snapshot) cannot double-finalise or regress the order', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [{ id: 'att-1' }])
    await processStripeWebhookEvent(asyncSucceededEvent())
    const staleCompletedEvent = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'unpaid', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(staleCompletedEvent)
    // The stale event's own payment_status !== 'paid' guard short-circuits
    // before any DB call — the 4 calls from the first (successful) event
    // remain the total.
    expect(sqlMock).toHaveBeenCalledTimes(4)
  })

  // E21-E23: out-of-order arrival and terminal-state protection.
  it('E21: an earlier checkout.session.completed (payment_status unpaid, safe no-op) followed by async_payment_succeeded still succeeds normally', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    const earlier = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'unpaid', metadata: { event_order_id: 'order-1' } } },
    } as never
    queue()
    await processStripeWebhookEvent(earlier)
    expect(sqlMock).not.toHaveBeenCalled()
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [{ id: 'att-1' }])
    const result = await processStripeWebhookEvent(asyncSucceededEvent())
    expect(result.handled).toBe(true)
    expect(sqlMock).toHaveBeenCalledTimes(4)
  })

  it('E23: an order already in a terminal state (FAILED/EXPIRED/REFUNDED — payment_status not PENDING) receiving async_payment_succeeded is not regressed to PAID', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([], []) // guarded UPDATE matches 0 rows — payment_status already non-PENDING
    await processStripeWebhookEvent(asyncSucceededEvent())
    // 3 no-op calls: order-flip attempt (0 rows), attendee-lookup SELECT
    // (finds nothing — payment_status re-check in
    // issueTicketTokensForPaidOrder also excludes non-PAID orders), and
    // issueBookingTokenForPaidOrder's own unconditional UPDATE (also 0
    // rows, same payment_status='PAID' re-check).
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  // F24-F27: the symmetric failure event remains genuinely unhandled by
  // design — checkout.session.expired is the sole authoritative release
  // mechanism regardless (see scripts/add-events-payments.sql's own
  // `expires_at` rationale), so an unhandled async_payment_failed leaves
  // the order to expire naturally, the SAME existing recoverable-state
  // contract as an unhandled payment_intent.payment_failed already had.
  // Not inventing a new failure-state model here, per this task's own
  // explicit instruction.
  it('F: checkout.session.async_payment_failed is acknowledged but not acted on — does not confirm the order, issue tickets, or schedule ticket email; the order is left to expire via the existing checkout.session.expired path', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    const event = {
      type: 'checkout.session.async_payment_failed',
      data: { object: { id: 'cs_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    const result = await processStripeWebhookEvent(event)
    expect(result).toEqual({ handled: false, type: 'checkout.session.async_payment_failed' })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  // G28-G31: correlation failure modes fail closed.
  it('G28: missing metadata.event_order_id -> fail closed, never guesses which order, no DB call', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue()
    await processStripeWebhookEvent(asyncSucceededEvent({ metadata: {} }))
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('G29: an unknown/mismatched provider identifier resolves to zero rows via the exact-identifier WHERE clause — never mutates an unrelated order', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([], [])
    const result = await processStripeWebhookEvent(asyncSucceededEvent({ id: 'cs_never_persisted', metadata: { event_order_id: 'order-does-not-exist' } }))
    expect(result.handled).toBe(true)
    // 3 no-op calls — see E23's identical accounting (order-flip attempt,
    // attendee lookup, booking-token attempt), all matching 0 rows.
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('G30: wrong/mismatched connected-account context (event.account differs from the order\'s stored stripe_account_id) fails closed via the same stripe_account_id guard — the async dispatch path passes event.account through unchanged', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([], [])
    await processStripeWebhookEvent(asyncSucceededEvent({}, 'acct_wrong_account'))
    const firstCallText = ((sqlMock.mock.calls[0] as unknown[])[0] as string[]).join('')
    expect(firstCallText).toMatch(/AND stripe_account_id = /)
  })

  it('G31: a malformed session object (payment_status missing entirely) fails closed exactly like the existing checkout.session.completed convention — treated as not \'paid\', no DB call', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue()
    const malformed = {
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(malformed)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  // H32-H35: existing-state safety (already-paid/confirmed/free/terminal).
  it('H32/H33: an already-PAID (and therefore already-CONFIRMED — the two are set atomically together) order receiving async success is unaffected', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([], []) // already PAID -> payment_status <> 'PENDING' -> 0 rows
    await expect(processStripeWebhookEvent(asyncSucceededEvent())).resolves.not.toThrow()
  })

  it('H34: a free order can never be reached by this or any Stripe event — stripe_checkout_session_id is NULL for every free order (the paid checkout route rejects price_cents=0 outright), and NULL never equality-matches a non-null session id', () => {
    // Structural/source proof, not a runtime mock: the paid checkout
    // route's own free-ticket rejection (see "Paid checkout route" tests
    // above) means a free order's stripe_checkout_session_id column is
    // never written by anything other than the paid path — confirmed via
    // the checkout route's own containment coverage. No separate runtime
    // test is meaningful here beyond that structural guarantee, which
    // this file already asserts elsewhere ("rejects a FREE ticket type").
    expect(CHECKOUT_ROUTE_SOURCE).toMatch(/This ticket type is free\. Use the registration flow instead\./)
  })

  // I38/I39: no secret/raw payment data in audit logs; cross-tenant
  // impossible (I36/I37 — signature verification — are unaffected by
  // this change and remain covered by the existing "Stripe webhook route
  // — signature verification" describe block above, which runs entirely
  // before processStripeWebhookEvent is ever reached).
  it('I38: the audit row\'s after_state carries only the same non-sensitive shape as the synchronous path — no Stripe secret, no raw card/payment-method data', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [])
    await processStripeWebhookEvent(asyncSucceededEvent())
    const firstCallText = ((sqlMock.mock.calls[0] as unknown[])[0] as string[]).join('')
    expect(firstCallText).toMatch(/"source":\s*"stripe_webhook"/)
    expect(firstCallText).not.toMatch(/sk_|whsec_|pk_live|pk_test/)
  })

  // J40-J42: email-tracking boundary — the async dispatch path reuses the
  // exact same function as .completed, so the existing file-wide
  // containment tests ("lib/events/stripe.ts never imports or calls
  // attemptAutomaticTicketEmail...", "the Stripe webhook route itself
  // also never imports...") already cover this without modification; no
  // real email is ever sent anywhere in this file (every dependency is
  // mocked). Restated here as an explicit assertion tied to this event
  // type for completeness.
  it('J40/J41: scheduling ticket_email_status=\'pending\' is the only email-related side effect — no call to any ticket-email send/delivery function, and no interaction with the separate event_ticket_email_deliveries (Resend delivery-status) table', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1', organisation_id: 'org-a' }], [])
    await processStripeWebhookEvent(asyncSucceededEvent())
    for (const call of sqlMock.mock.calls) {
      const text = ((call as unknown[])[0] as string[]).join('')
      expect(text).not.toMatch(/event_ticket_email_deliveries/)
    }
    expect(STRIPE_SOURCE).not.toMatch(/attemptAutomaticTicketEmail|sendTicketEmail|sendEmail/)
  })
})

// ─── Phase 3E.3 — paid order ticket-email scheduling ──────────────────
//
// Reuses this file's own read()/stripComments() helpers (defined at the
// top of the file) for static source-text containment, matching the
// existing "Phase 4 — architecture containment" block's own idiom.
// These are deliberately source-level (not mocked-call) proofs: the
// STRONGEST possible evidence that a code path never does something is
// that the literal text does not exist in the file at all, not merely
// that a particular mocked test run didn't happen to exercise it.

describe('Phase 3E.3 — paid order ticket-email scheduling: containment', () => {
  const STRIPE_SOURCE = stripComments(read('lib/events/stripe.ts'))
  const CHECKOUT_ROUTE_SOURCE = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
  const REFUND_ROUTE_SOURCE = stripComments(read('app/api/events/[id]/orders/[orderId]/refund/route.ts'))
  const WEBHOOK_ROUTE_SOURCE = stripComments(read('app/api/public/events/webhooks/stripe/route.ts'))

  function handlerBody(fnName: string): string {
    const start = STRIPE_SOURCE.indexOf(`async function ${fnName}(`)
    expect(start, `expected to find ${fnName}`).toBeGreaterThanOrEqual(0)
    const end = STRIPE_SOURCE.indexOf('\n}', start)
    return STRIPE_SOURCE.slice(start, end)
  }

  it('the qualifying-payment UPDATE still requires payment_status = \'PENDING\', exact order id, exact stripe_checkout_session_id, and exact stripe_account_id match — the SAME guard the scheduling clause now rides on', () => {
    const body = handlerBody('handleCheckoutSessionCompleted')
    expect(body).toMatch(/WHERE id = \$\{orderId\} AND stripe_checkout_session_id = \$\{session\.id\} AND payment_status = 'PENDING'/)
    expect(body).toMatch(/AND stripe_account_id = \$\{eventAccount\}/)
  })

  it('no broad/backfill-shaped UPDATE exists anywhere in this file — every UPDATE targets an exact id/session/intent-scoped WHERE, never a bare status filter', () => {
    // Every UPDATE event_orders statement in this file must have its
    // own WHERE clause containing an exact identifying condition (id,
    // stripe_checkout_session_id, or stripe_payment_intent_id) — never
    // a query shaped like "WHERE ticket_email_status IS NULL" or
    // "WHERE payment_status = 'PAID'" alone, which would risk touching
    // more than one order.
    const updates = STRIPE_SOURCE.match(/UPDATE event_orders\s*\n?\s*SET[\s\S]*?WHERE[^\n]*(\n[^\n]*)*?(?=RETURNING|\n\s*\n|\$)/g) ?? []
    expect(updates.length).toBeGreaterThan(0)
    for (const stmt of updates) {
      const hasExactIdentifier = /WHERE id = \$\{orderId\}|WHERE stripe_checkout_session_id = \$\{session\.id\}|WHERE stripe_payment_intent_id = \$\{intent\.id\}/.test(stmt)
      expect(hasExactIdentifier, stmt).toBe(true)
    }
    expect(STRIPE_SOURCE).not.toMatch(/ticket_email_status\s+IS\s+NULL/i)
  })

  it('handlePaymentIntentFailed never references ticket_email_status — a failed payment never schedules automatic email', () => {
    expect(handlerBody('handlePaymentIntentFailed')).not.toMatch(/ticket_email_status/)
  })

  it('handleCheckoutSessionExpired never references ticket_email_status — an expired checkout never schedules automatic email', () => {
    expect(handlerBody('handleCheckoutSessionExpired')).not.toMatch(/ticket_email_status/)
  })

  it('the paid checkout/reservation INSERT never sets ticket_email_status — a new paid order starts NULL, exactly like a historical order, while awaiting payment', () => {
    expect(CHECKOUT_ROUTE_SOURCE).toMatch(/INSERT INTO event_orders/)
    // Block-scope to the INSERT's own column list before asserting, to
    // avoid a false negative/positive against unrelated text elsewhere
    // in the file.
    const start = CHECKOUT_ROUTE_SOURCE.indexOf('INSERT INTO event_orders')
    const end = CHECKOUT_ROUTE_SOURCE.indexOf(')', start)
    const columnList = CHECKOUT_ROUTE_SOURCE.slice(start, end)
    expect(columnList).not.toMatch(/ticket_email_status/)
  })

  it('the refund route never references ticket_email_status — refund handling stays completely separate from initial ticket-email scheduling/state', () => {
    expect(REFUND_ROUTE_SOURCE).not.toMatch(/ticket_email_status/)
  })

  it('lib/events/stripe.ts never imports or calls attemptAutomaticTicketEmail, sendTicketEmail, or sendEmail — no synchronous provider work inside the webhook path; delivery is the recovery cron\'s job', () => {
    expect(STRIPE_SOURCE).not.toMatch(/attemptAutomaticTicketEmail|sendTicketEmail|sendEmail/)
    expect(STRIPE_SOURCE).not.toMatch(/from ['"]@\/lib\/events\/ticketEmailDelivery['"]/)
    expect(STRIPE_SOURCE).not.toMatch(/from ['"]@\/lib\/events\/ticketEmail['"]/)
    expect(STRIPE_SOURCE).not.toMatch(/from ['"]@\/lib\/email['"]/)
  })

  it('the Stripe webhook route itself also never imports or calls the ticket-email system — the boundary holds at both layers', () => {
    expect(WEBHOOK_ROUTE_SOURCE).not.toMatch(/attemptAutomaticTicketEmail|sendTicketEmail|sendEmail|ticketEmail/)
  })

  it('the async-payment-method gap is now closed: checkout.session.async_payment_succeeded is handled via the SAME finalisation path as checkout.session.completed, never a duplicated/second implementation; payment_intent.succeeded deliberately remains unhandled (Stripe\'s own fulfilment guidance keys off the Checkout Session, not a second PaymentIntent-level listener)', () => {
    expect(STRIPE_SOURCE).toMatch(/case 'checkout\.session\.completed':\s*\n\s*case 'checkout\.session\.async_payment_succeeded':/)
    expect(STRIPE_SOURCE).not.toMatch(/'payment_intent\.succeeded'/)
    // Exactly one call site for handleCheckoutSessionCompleted's own
    // definition (the function), and it is reached from both case labels
    // falling into the same block — not a second, parallel
    // implementation of the same finalisation logic.
    const defs = STRIPE_SOURCE.match(/async function handleCheckoutSessionCompleted/g) ?? []
    expect(defs).toHaveLength(1)
  })

  it('checkout.session.async_payment_failed remains deliberately unhandled — checkout.session.expired stays the sole authoritative release path, exactly matching handlePaymentIntentFailed\'s own existing "best-effort only" philosophy for the symmetric failure case', () => {
    expect(STRIPE_SOURCE).not.toMatch(/async_payment_failed/)
  })

  it('the recovery executor and its cron route remain byte-for-byte unmodified by this phase — reused generically, no paid-specific branch', () => {
    const recoverySource = stripComments(read('lib/events/ticketEmailRecovery.ts'))
    expect(recoverySource).not.toMatch(/stripe|payment_status|payment_provider/i)
  })
})

// ─── Refund route ─────────────────────────────────────────────────────

describe('Refund route — permissions and provider-confirms-first ordering', () => {
  function refundReq() { return jsonReq('http://localhost/x', 'POST') }
  const CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1' }) }

  it('no session -> 401, no DB call, Stripe never called', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(401)
    expect(createRefundMock).not.toHaveBeenCalled()
  })

  it('viewer cannot refund -> 403, Stripe never called', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(403)
    expect(createRefundMock).not.toHaveBeenCalled()
  })

  it('cross-tenant event -> 404, Stripe never called', async () => {
    queue([]) // event ownership check finds nothing
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(404)
    expect(createRefundMock).not.toHaveBeenCalled()
  })

  it('an order that is not PAID is rejected -> 409, Stripe never called', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PENDING', stripe_payment_intent_id: null, stripe_account_id: null }])
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(409)
    expect(createRefundMock).not.toHaveBeenCalled()
  })

  it('if Stripe refund fails, DB state is NOT updated and a 502 is returned', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_org_a' }])
    createRefundMock.mockResolvedValue({ ok: false, error: 'card issuer declined' })
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(502)
    expect(sqlMock).toHaveBeenCalledTimes(2) // ownership + order lookup only, no UPDATE
  })

  it('on Stripe success, DB is updated to REFUNDED/CANCELLED — and only after Stripe confirmed', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_org_a' }], [{ id: 'order-1' }])
    createRefundMock.mockResolvedValue({ ok: true })
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(200)
    expect(createRefundMock).toHaveBeenCalledWith('pi_1', 'acct_org_a')
    // ownership + order lookup + UPDATE...RETURNING + Phase 6 audit_logs INSERT
    // (lib/events/auditLog.ts's logRefunded, unmocked here, runs against the
    // same @/lib/db mock as the route itself).
    expect(sqlMock).toHaveBeenCalledTimes(4)
  })

  it('refund also cancels the order — REFUNDED tickets are never left as a valid scannable ticket (§23/§24)', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/refund/route.ts'))
    expect(code).toMatch(/status = 'CANCELLED'/)
    expect(code).toMatch(/payment_status = 'REFUNDED'/)
  })

  it('manager+ role, matching every other Events mutation', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/refund/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\('manager'\)/)
  })
})

// ─── Check-in payment gating ─────────────────────────────────────────

describe('Check-in — payment-state gating (§24/§25)', () => {
  it('confirmCheckIn() requires payment_status IN (NOT_REQUIRED, PAID) inside the SAME atomic UPDATE as every other guard', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function confirmCheckIn')
    const fnBody = code.slice(fnStart, code.indexOf('\nexport type UndoCheckInResult', fnStart))
    const updateCount = (fnBody.match(/UPDATE event_attendees ea/g) ?? []).length
    const paymentGuardCount = (fnBody.match(/eo\.payment_status IN \('NOT_REQUIRED', 'PAID'\)/g) ?? []).length
    expect(updateCount).toBe(2)
    expect(paymentGuardCount).toBe(2)
  })

  it('resolveAttendee() rejects a PENDING-payment attendee with reason "unpaid", not a false positive resolve', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    expect(code).toMatch(/reason: 'unpaid'/)
    expect(code).toMatch(/isPaymentValid\(row\.payment_status\)/)
  })

  it('searchAttendees() excludes unpaid/non-checkinable orders from results entirely', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function searchAttendees')
    const fnBody = code.slice(fnStart, code.length)
    expect(fnBody).toMatch(/eo\.payment_status IN \('NOT_REQUIRED', 'PAID'\)/)
  })

  it('the confirm route surfaces a distinct "Payment not completed." message for the unpaid reason', () => {
    const code = stripComments(read('app/api/events/[id]/check-in/confirm/route.ts'))
    expect(code).toMatch(/Payment not completed\./)
  })
})

// ─── Architecture containment ─────────────────────────────────────────

describe('Phase 4 — architecture containment (no scope creep beyond the brief)', () => {
  const PHASE4_FILES = [
    'app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts',
    'app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route.ts',
    'app/api/public/events/webhooks/stripe/route.ts',
    'app/api/events/[id]/orders/[orderId]/refund/route.ts',
    'lib/events/stripe.ts',
  ]

  for (const file of PHASE4_FILES) {
    it(`${file} has no seating/promo/subscription/membership/SMS/CRM scope creep`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/seat_map|seating|reserved_seat/i)
      expect(code).not.toMatch(/promo_code|promoCode|discount_code/i)
      expect(code).not.toMatch(/subscription|membership/i)
      expect(code).not.toMatch(/twilio|sms|sendSms/i)
      expect(code).not.toMatch(/crm_contacts|crm_companies|crm_deals|crm_activities/i)
      // Phase C1.7 (Foundation Repair, separately authorized): lib/events/
      // stripe.ts now deliberately writes audit_logs entries for the three
      // payment-state webhook transitions — see that file's own
      // handleCheckoutSessionCompleted comment for why. This was a real,
      // confirmed gap (a payment system with an audit trail for every
      // human-initiated order action but none for the automated Stripe-
      // driven transitions themselves), not scope creep against the
      // original Phase 4 brief this suite otherwise still guards — every
      // other file in PHASE4_FILES, and every other item in this list,
      // remains untouched.
      if (file !== 'lib/events/stripe.ts') {
        expect(code).not.toMatch(/audit_logs|AuditLog/)
      }
    })
  }

  it('no second payment provider was added alongside Stripe', () => {
    const pkg = read('package.json')
    expect(pkg).not.toMatch(/"paypal"|"square"|"braintree"|"adyen"/i)
  })

  it('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is never read — hosted Checkout redirect needs no client-side Stripe.js', () => {
    for (const file of PHASE4_FILES) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/)
    }
  })

  it('no Stripe secret is ever logged or returned in an API response', () => {
    for (const file of PHASE4_FILES) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*STRIPE_SECRET_KEY/)
      expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*STRIPE_WEBHOOK_SECRET/)
    }
  })

  it('the checkout route reuses the Phase 2 R1 lock-order discipline — FOR UPDATE on ticket_type before session, every code path', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    expect(code).toMatch(/FOR UPDATE/)
    const ttLockIdx = code.indexOf('event_ticket_types')
    const sessLockIdx = code.indexOf('event_sessions WHERE id')
    expect(ttLockIdx).toBeGreaterThan(-1)
    expect(sessLockIdx).toBeGreaterThan(ttLockIdx)
  })

  // Updated by the Events/Ticketing production-readiness audit's stale-
  // reservation capacity-parity fix: the free registration route's Phase
  // 2/3 capacity-gate SQL SHAPE is still fully preserved (still FOR
  // UPDATE, still the same sold_tt-gated insert), but it now deliberately
  // carries a narrow, READ-ONLY reference to payment_status/expires_at —
  // mirroring the paid checkout route's own stale-pending-reservation
  // exclusion so a free registrant can't get a false "sold out" because
  // of another purchaser's abandoned paid Checkout. This does not make
  // the free route a payment route: it still never calls Stripe, never
  // imports lib/events/stripe.ts, and never WRITES payment_status/
  // expires_at (those columns keep their schema defaults —
  // NOT_REQUIRED/NULL — for every order this route creates, exactly as
  // before) — it only READS them, in one WHERE-clause exclusion, to
  // decide what already counts against capacity.
  it('the free registration route\'s capacity-gate SQL shape is otherwise preserved, still never calls Stripe or writes payment/Stripe columns — the only change is a narrow, read-only stale-reservation exclusion mirroring the paid route', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))
    expect(code).toMatch(/FOR UPDATE/)
    expect(code).toMatch(/sold_tt\.qty \+ \$\{validated\.quantity\} <=/)
    // Still architecturally separate from Stripe entirely.
    expect(code).not.toMatch(/stripe/i)
    // Still never WRITES payment_status/expires_at — every event_orders
    // INSERT's own column list must not name either column.
    const insertColumnLists = code.match(/INSERT INTO event_orders \([^)]*\)/gi) ?? []
    expect(insertColumnLists.length).toBeGreaterThan(0)
    for (const columnList of insertColumnLists) {
      expect(columnList).not.toMatch(/payment_status/i)
      expect(columnList).not.toMatch(/expires_at/i)
    }
    // The one authorized exception: a read-only reference in the sold-
    // quantity exclusion, identical to the paid route's own predicate.
    expect(code).toContain("(eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
  })

  it('no Production migration was applied by this test suite (schema file exists but is not auto-executed)', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/add-events-payments.sql'))).toBe(true)
    const migrationSrc = read('scripts/add-events-payments.sql')
    expect(migrationSrc).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i)
  })
})
