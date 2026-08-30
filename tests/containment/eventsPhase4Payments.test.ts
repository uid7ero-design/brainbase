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

const createCheckoutSessionMock = vi.fn()
const constructWebhookEventMock = vi.fn()
const processStripeWebhookEventMock = vi.fn()
const createRefundMock = vi.fn()
class MockStripeNotConfiguredError extends Error {}
vi.mock('@/lib/events/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
  constructWebhookEvent: (...args: unknown[]) => constructWebhookEventMock(...args),
  processStripeWebhookEvent: (...args: unknown[]) => processStripeWebhookEventMock(...args),
  createRefund: (...args: unknown[]) => createRefundMock(...args),
  RESERVATION_WINDOW_SECONDS: 1800,
  StripeNotConfiguredError: MockStripeNotConfiguredError,
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
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ order_id: 'order-1' }]
  transactionMock.mockImplementation(async () => [[], transactionFinalResult])
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
  checkRateLimitMock.mockReturnValue(true)
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' })
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
    queue(ORG_ROW, EVENT_ROW, PAID_TT_ROW)
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

  it('checkout.session.completed with payment_status "paid" flips the order AND issues tokens (two calls)', async () => {
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    queue([{ id: 'order-1' }], [{ id: 'att-1' }])
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(event)
    expect(sqlMock).toHaveBeenCalledTimes(3) // order-flip UPDATE, attendee-lookup SELECT, token UPDATE
  })

  it('a duplicate delivery of the same event (order already PAID) makes the order-flip UPDATE a no-op, and token issuance finds nothing to issue', async () => {
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
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PENDING', stripe_payment_intent_id: null }])
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(409)
    expect(createRefundMock).not.toHaveBeenCalled()
  })

  it('if Stripe refund fails, DB state is NOT updated and a 502 is returned', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1' }])
    createRefundMock.mockResolvedValue({ ok: false, error: 'card issuer declined' })
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(502)
    expect(sqlMock).toHaveBeenCalledTimes(2) // ownership + order lookup only, no UPDATE
  })

  it('on Stripe success, DB is updated to REFUNDED/CANCELLED — and only after Stripe confirmed', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1' }], [{ id: 'order-1' }])
    createRefundMock.mockResolvedValue({ ok: true })
    const res = await refundRoute.POST(refundReq(), CTX)
    expect(res.status).toBe(200)
    expect(createRefundMock).toHaveBeenCalledWith('pi_1')
    expect(sqlMock).toHaveBeenCalledTimes(3)
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
      expect(code).not.toMatch(/audit_logs|AuditLog/)
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

  it('the free registration route is completely unmodified in its capacity-gate SQL shape (Phase 2/3 behaviour preserved)', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))
    expect(code).toMatch(/FOR UPDATE/)
    expect(code).toMatch(/sold_tt\.qty \+ \$\{validated\.quantity\} <=/)
    expect(code).not.toMatch(/stripe|payment_status|expires_at/i)
  })

  it('no Production migration was applied by this test suite (schema file exists but is not auto-executed)', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/add-events-payments.sql'))).toBe(true)
    const migrationSrc = read('scripts/add-events-payments.sql')
    expect(migrationSrc).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i)
  })
})
