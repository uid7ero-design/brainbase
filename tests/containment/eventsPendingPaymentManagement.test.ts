import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 4 remediation — pending payment management
// (§A). Every dependency here is mocked, including lib/events/stripe.ts
// itself for route-level tests — no real database, network, or Stripe
// API call occurs anywhere in this file. Real-Postgres proof of the
// retry route's capacity-reacquisition mechanism (cancel releases
// capacity, retry cannot oversell, an expired retry safely reacquires,
// a concurrent retry-vs-new-reservation race resolves to exactly one
// winner) is sections F/G of
// scripts/tests/verify-events-phase4-payment-concurrency.sh — not
// duplicated here. What THIS file proves: route orchestration,
// permission/tenant enforcement, and that a PAID order can never be
// reached by either of these pending-only actions.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
let transactionFinalResult: unknown[] = [{ id: 'order-1' }]
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

// Only needed for the "old-webhook vs new-retry race" behavioral test
// below, which temporarily unmocks the REAL lib/events/stripe.ts (via
// vi.doUnmock + vi.resetModules) to exercise its real webhook handler —
// that handler unconditionally calls recordEventBookingActivityForOrder,
// which would otherwise reach the real lib/crm/eventSync.ts and its own
// DB calls. Matches tests/containment/eventsPhase4Payments.test.ts's own
// identical mock for the same reason.
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivity: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
}))

const createCheckoutSessionMock = vi.fn()
const retrieveExistingCheckoutAttemptMock = vi.fn()
class MockStripeNotConfiguredError extends Error {}
// classifyRetrySafety is a pure, I/O-free function (see lib/events/
// stripe.ts's own comment) — passed through REAL via importOriginal,
// matching this repo's established pattern (see the @/lib/org and
// @/lib/capabilities/requireCapability mocks above) rather than
// re-implementing/mocking decision logic this suite needs to actually
// exercise. Only the two Stripe-network-calling functions
// (createCheckoutSession, retrieveExistingCheckoutAttempt) are mocked.
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
    retrieveExistingCheckoutAttempt: (...args: unknown[]) => retrieveExistingCheckoutAttemptMock(...args),
    RESERVATION_WINDOW_SECONDS: 1860,
    StripeNotConfiguredError: MockStripeNotConfiguredError,
  }
})

vi.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'localhost:3000']]),
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }
function req(body?: unknown) {
  return new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const cancelRoute = await import('@/app/api/events/[id]/orders/[orderId]/cancel/route')
const retryRoute = await import('@/app/api/events/[id]/orders/[orderId]/retry/route')
const { classifyRetrySafety } = await import('@/lib/events/stripe')

const CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1' }) }

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  createCheckoutSessionMock.mockReset()
  retrieveExistingCheckoutAttemptMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ id: 'order-1' }]
  transactionMock.mockImplementation(async () => [[], transactionFinalResult])
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_retry', url: 'https://checkout.stripe.com/pay/cs_test_retry' })
})


// ─── Cancel pending order ──────────────────────────────────────────────

describe('Cancel pending order route — permissions and idempotency', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot cancel -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('cross-tenant event -> 404', async () => {
    queue([])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(404)
  })

  it('cross-tenant/unknown order -> 404', async () => {
    queue([{ id: 'event-1' }], [])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(404)
  })

  it('a PAID order cannot be cancelled through this route -> 409, no UPDATE attempted (§A.3: "PAID orders must not expose delete/remove")', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(sqlMock).toHaveBeenCalledTimes(2) // ownership + order lookup only
  })

  it('a REFUNDED order cannot be cancelled through this route -> 409', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'REFUNDED' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
  })

  it('a genuinely PENDING order is cancelled — status CANCELLED, payment_status EXPIRED, releasing capacity via the existing predicate', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PENDING' }], [{ id: 'order-1' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[2] as unknown as TemplateStringsArray[]
    const sql = updateCall[0].join('')
    expect(sql).toMatch(/status = 'CANCELLED'/)
    expect(sql).toMatch(/payment_status = 'EXPIRED'/)
    expect(sql).toMatch(/payment_status = 'PENDING'/) // the idempotency guard
  })

  it('cancelling an order already resolved by a concurrent request (0 rows) is reported as ok, not an error — idempotent (§A.3)', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PENDING' }], [])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('never hard-deletes the order row — no DELETE statement anywhere in this route', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/cancel/route.ts'))
    expect(code).not.toMatch(/DELETE FROM/i)
  })

  it('manager+ role, matching every other Events mutation', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/cancel/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\('manager'\)/)
  })
})

// ─── Retry payment ──────────────────────────────────────────────────────

describe('Retry payment route — revalidation, capacity, and permissions', () => {
  const ORDER_ROW = { id: 'order-1', payment_status: 'PENDING', purchaser_email: 'p@example.com', total_cents: 2500, currency: 'AUD', stripe_account_id: 'acct_org_a' }
  const ITEM_ROW = { ticket_type_id: 'tt-1', event_session_id: null, quantity: 1 }
  const TT_ROW = { id: 'tt-1', name: 'Premium Guest', active: true, price_cents: 2500, currency: 'AUD' }

  it('unauthenticated -> 401, no Stripe call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(401)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('viewer cannot retry -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(403)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('cross-tenant event -> 404', async () => {
    queue([])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(404)
  })

  it('a cancelled event cannot have its orders retried -> 409', async () => {
    queue([{ id: 'event-1', status: 'CANCELLED' }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
  })

  it('a PAID order cannot be retried through this route -> 409, no capacity/Stripe call attempted (§A.3)', async () => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [{ ...ORDER_ROW, payment_status: 'PAID' }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('a genuinely PENDING order with capacity available succeeds — fresh Stripe session, order stripe_checkout_session_id updated', async () => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [ORDER_ROW], [ITEM_ROW], [TT_ROW])
    // sql.transaction(...) is separately mocked (transactionMock) and
    // does not consume from responseQueue — the reacquisition result
    // comes from transactionFinalResult; the final push below is the
    // follow-up UPDATE that stores the new stripe_checkout_session_id.
    responseQueue.push([{ id: 'order-1' }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_retry')
  })

  it('preserves the connected Stripe account attribution — createCheckoutSession is called with the ORDER\'s own stored stripe_account_id', async () => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [ORDER_ROW], [ITEM_ROW], [TT_ROW])
    responseQueue.push([{ id: 'order-1' }])
    await retryRoute.POST(req(), CTX)
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(expect.objectContaining({ connectedAccountId: 'acct_org_a' }))
  })

  it('when capacity can no longer be reacquired (0 rows from the atomic UPDATE), Stripe is never called and no session is created — cannot oversell', async () => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [ORDER_ROW], [ITEM_ROW], [TT_ROW])
    transactionFinalResult = [] // reacquisition UPDATE matches 0 rows (capacity gone)
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('an inactive ticket type blocks retry — revalidates ticket state, not just capacity', async () => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [ORDER_ROW], [ITEM_ROW], [{ ...TT_ROW, active: false }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('creates no new order, order item, or attendee row anywhere — reuses the existing order exclusively (no duplicate attendee/entitlement records)', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))
    expect(code).not.toMatch(/INSERT INTO event_orders/)
    expect(code).not.toMatch(/INSERT INTO event_order_items/)
    expect(code).not.toMatch(/INSERT INTO event_attendees/)
  })

  it('the capacity-reacquisition UPDATE excludes the order\'s own existing quantity from the "sold" aggregate — the mechanism that makes retry safe for both a still-valid and an already-expired hold', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))
    expect(code).toMatch(/eo\.id <> \$\{orderId\}/)
  })

  it('manager+ role', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\('manager'\)/)
  })
})

// ─── Retry double-charge guard ─────────────────────────────────────────
//
// Events/Ticketing production-readiness audit: the retry route
// previously created a brand-new Checkout Session for a locally-PENDING
// order with NO check of whether the order's PRIOR Checkout Session/
// PaymentIntent had already succeeded on Stripe's side. This suite
// proves the fix's route-level integration (retrieveExistingCheckoutAttempt
// is mocked — Stripe network calls stay out of this file, per its own
// header — but classifyRetrySafety runs FOR REAL via importOriginal, so
// these tests prove genuine end-to-end decision-making, not a second,
// independently-asserted expectation of what the route "should" do).
// The full state-matrix truth table is proven separately, directly
// against classifyRetrySafety, in the "decision matrix" suite below.

describe('Retry payment route — double-charge guard (Stripe-state pre-flight check)', () => {
  const ORDER_ROW = { id: 'order-1', payment_status: 'PENDING', purchaser_email: 'p@example.com', total_cents: 2500, currency: 'AUD', stripe_account_id: 'acct_org_a' }
  const ORDER_ROW_WITH_SESSION = { ...ORDER_ROW, stripe_checkout_session_id: 'cs_old_123' }
  const ITEM_ROW = { ticket_type_id: 'tt-1', event_session_id: null, quantity: 1 }
  const TT_ROW = { id: 'tt-1', name: 'Premium Guest', active: true, price_cents: 2500, currency: 'AUD' }

  function queueSuccessPath(orderRow: typeof ORDER_ROW) {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [orderRow], [ITEM_ROW], [TT_ROW])
    responseQueue.push([{ id: 'order-1' }]) // follow-up UPDATE storing the new session id
  }

  // A. local PENDING + Stripe Checkout paid => blocked, no new Checkout
  it('A. Stripe reports the prior Checkout Session payment_status=paid -> blocked, createCheckoutSession NOT called', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'complete', sessionPaymentStatus: 'paid', paymentIntentStatus: 'succeeded' })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/already succeeded/i)
  })

  // B. local PENDING + PaymentIntent succeeded (session itself not yet
  // reporting paid) => blocked
  it('B. the PaymentIntent alone reports succeeded -> blocked, no new Checkout', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'succeeded' })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  // C. prior Checkout still open/unpaid => blocked
  it('C. the prior Checkout Session is still open and unpaid -> blocked (existing attempt is still usable)', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_payment_method' })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/still active/i)
  })

  // D. PaymentIntent processing => blocked
  it('D. the PaymentIntent is processing -> blocked', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'processing' })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/processing/i)
  })

  // E. PaymentIntent requires_capture => blocked
  it('E. the PaymentIntent requires_capture (funds already authorized) -> blocked', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_capture' })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  // F. Checkout expired + no successful/processing PI => retry allowed
  it('F. the prior Checkout Session is expired with no blocking PaymentIntent state -> retry allowed, exactly one new Checkout created', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
  })

  // G. PaymentIntent canceled => retry allowed
  it('G. the PaymentIntent is canceled -> retry allowed', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'canceled' })
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
  })

  // H. Stripe retrieve API error => fail closed
  it('H. the Stripe retrieval call itself fails (network/API error) -> fail closed, no new Checkout', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockRejectedValue(new Error('stripe: connection reset, request id req_abc123'))
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/could not be verified/i)
  })

  // I. connected-account context passed correctly to retrieve call
  it('I. retrieveExistingCheckoutAttempt is called with the exact prior session id AND the order\'s own historical stripe_account_id', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })
    await retryRoute.POST(req(), CTX)
    expect(retrieveExistingCheckoutAttemptMock).toHaveBeenCalledWith('cs_old_123', 'acct_org_a')
  })

  // J. wrong tenant / wrong event / wrong order remains blocked exactly
  // as before, and never even reaches the Stripe check.
  it('J. cross-tenant event still 404s before any Stripe lookup', async () => {
    queue([])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(404)
    expect(retrieveExistingCheckoutAttemptMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  // K. already-local-PAID order remains non-retriable without any
  // Stripe lookup at all (the pre-existing local check rejects first).
  it('K. a locally-PAID order is rejected by the existing local check alone — no Stripe lookup performed', async () => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [{ ...ORDER_ROW_WITH_SESSION, payment_status: 'PAID' }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(retrieveExistingCheckoutAttemptMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  // L. REFUNDED / CANCELLED remain non-retriable, same existing local check.
  it.each(['REFUNDED', 'FAILED', 'EXPIRED', 'NOT_REQUIRED'])('L. a locally-%s order is rejected by the existing local check alone', async (paymentStatus) => {
    queue([{ id: 'event-1', status: 'PUBLISHED' }], [{ ...ORDER_ROW_WITH_SESSION, payment_status: paymentStatus }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(retrieveExistingCheckoutAttemptMock).not.toHaveBeenCalled()
  })

  // M. duplicate rapid Retry requests — the DB-level concurrency guard
  // (proven against real Postgres in scripts/tests/
  // verify-events-phase4-payment-concurrency.sh section H) is what
  // actually prevents two concurrent requests from both succeeding;
  // this mocked suite can only prove the guard clause exists in the
  // statement text, which it does here.
  it('M. the capacity-reacquisition UPDATE ties itself to the exact prior session id this request verified (the concurrency guard) — real-Postgres proof lives in scripts/tests/verify-events-phase4-payment-concurrency.sh section H', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))
    expect(code).toMatch(/eo\.stripe_checkout_session_id IS NOT DISTINCT FROM \$\{verifiedSessionId\}/)
  })

  // N. no response leaks Stripe secret/object internals
  it('N. the Stripe-retrieval-failure response never echoes the raw Stripe error text/request id', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockRejectedValue(new Error('stripe: connection reset, request id req_abc123, sk_test_LEAK_ME'))
    const res = await retryRoute.POST(req(), CTX)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/req_abc123|sk_test|connection reset/)
  })

  // O. current safe "no prior attempt at all" behaviour still works
  // unchanged, AND makes no unnecessary Stripe call — this is exactly
  // the pre-existing "genuinely PENDING order... succeeds" test's own
  // ORDER_ROW (no stripe_checkout_session_id field at all).
  it('O. an order with no prior Stripe attempt at all skips the Stripe check entirely — no unnecessary Stripe call, retry still succeeds', async () => {
    queueSuccessPath(ORDER_ROW) // no stripe_checkout_session_id
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    expect(retrieveExistingCheckoutAttemptMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
  })

  it('the Stripe safety check runs BEFORE the capacity-reacquisition transaction — sql.transaction is never invoked when Stripe blocks retry', async () => {
    queueSuccessPath(ORDER_ROW_WITH_SESSION)
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'complete', sessionPaymentStatus: 'paid', paymentIntentStatus: 'succeeded' })
    await retryRoute.POST(req(), CTX)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('no Stripe idempotency key is added to the Checkout Session creation call — the DB-level concurrency guard (M above) is the chosen protection, not a Stripe-side key (see this PR\'s own idempotency-conclusion note: a static orderId-keyed idempotency key would incorrectly block legitimate retries after a genuinely expired session)', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    const fnStart = code.indexOf('export async function createCheckoutSession(')
    const fnEnd = code.indexOf('\n}', fnStart)
    const fnBody = code.slice(fnStart, fnEnd)
    expect(fnBody).not.toMatch(/idempotencyKey|idempotency_key/i)
  })
})

// ─── NULL-session concurrency closure (PR #231 follow-up) ──────────────
//
// PR #231's own final review identified a reachable gap the original
// stripe_checkout_session_id guard (test M above) cannot close: an
// order can genuinely have NO prior session id at all (the brief
// in-flight window on the public checkout route between its order-
// creating INSERT committing and its own follow-up UPDATE writing the
// new session id back — or that same window recurring inside a retry,
// or either window never completing at all, e.g. a crashed/timed-out
// request). Two concurrent Retry requests hitting that exact state both
// read stripe_checkout_session_id = NULL and both satisfy
// `IS NOT DISTINCT FROM NULL` even after one has already committed,
// since NULL cannot serve as its own version token. Closed by reusing
// `expires_at` (an existing column, no schema change) as a second,
// independent compare-and-set guard — every successful reacquisition
// sets it to a brand-new value, so it discriminates even when the
// session guard cannot. This suite proves route-level wiring via
// source-text (matching this file's own established convention — see
// test M's own comment); the actual concurrent-request proof against
// real Postgres lives in scripts/tests/verify-events-phase4-payment-
// concurrency.sh sections I (closure), I MUTATION PROOF (sensitivity),
// and J (a later legitimate retry remains possible).

describe('Retry payment route — NULL-session concurrency closure (PR #231 follow-up)', () => {
  const routeSrc = () => stripComments(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))

  it('P. both capacity-reacquisition UPDATE branches (session-bound and non-session-bound) include the new expires_at compare-and-set guard', () => {
    const code = routeSrc()
    const occurrences = code.match(/eo\.expires_at IS NOT DISTINCT FROM \$\{verifiedExpiresAt\}/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('Q. verifiedExpiresAt is captured UNCONDITIONALLY — before the `if (verifiedSessionId)` branch, not inside it — so a NULL-session order still gets a guard value', () => {
    const code = routeSrc()
    const captureIdx = code.indexOf('const verifiedExpiresAt = order.expires_at')
    const branchIdx = code.indexOf('if (verifiedSessionId) {')
    expect(captureIdx).toBeGreaterThan(-1)
    expect(branchIdx).toBeGreaterThan(-1)
    expect(captureIdx).toBeLessThan(branchIdx)
  })

  it('the order SELECT includes expires_at, so verifiedExpiresAt always reflects the exact row this request read (never a separate, potentially-stale query)', () => {
    const code = routeSrc()
    expect(code).toMatch(/SELECT id, payment_status, purchaser_email, total_cents, currency, stripe_account_id, stripe_checkout_session_id, expires_at\s*\n\s*FROM event_orders/)
  })

  it('A/B/C. two concurrent Retry requests with NO prior session id — real-Postgres proof (exactly one reaches the reacquisition UPDATE, the other deterministically fails it, the winner proceeds normally) lives in scripts/tests/verify-events-phase4-payment-concurrency.sh section I; this suite proves the route issues the guarded statement that makes that outcome possible', () => {
    const code = routeSrc()
    expect(code).toMatch(/eo\.expires_at IS NOT DISTINCT FROM \$\{verifiedExpiresAt\}/)
  })

  it('D. a later legitimate retry after the winning attempt eventually becomes dead remains possible — proven at the DB layer in scripts/tests/verify-events-phase4-payment-concurrency.sh section J (a sequential, non-racing retry re-reads expires_at fresh and succeeds); at the route layer, verifiedExpiresAt is read fresh from the order row on EVERY request, never cached or reused across requests', () => {
    const code = routeSrc()
    // Only ONE assignment of verifiedExpiresAt exists in the whole file,
    // and it reads directly off the just-fetched `order` row — there is
    // no alternate/cached code path that could reuse a stale value.
    const assignments = code.match(/const verifiedExpiresAt = /g) ?? []
    expect(assignments.length).toBe(1)
    expect(code).toMatch(/const verifiedExpiresAt = order\.expires_at \?\? null/)
  })

  it('E. mutation proof that the harness is genuinely sensitive to the NULL-session defect lives in scripts/tests/verify-events-phase4-payment-concurrency.sh section "I MUTATION PROOF" (retry_sql_no_expires_guard reproduces both concurrent retries winning)', () => {
    const harness = read('scripts/tests/verify-events-phase4-payment-concurrency.sh')
    expect(harness).toMatch(/retry_sql_no_expires_guard/)
    expect(harness).toMatch(/I MUTATION PROOF/)
  })

  it('F. the pre-existing stripe_checkout_session_id guard (test M) is untouched by this change — both guards coexist in the same WHERE clause, the new one does not replace the old one', () => {
    const code = routeSrc()
    expect(code).toMatch(/eo\.stripe_checkout_session_id IS NOT DISTINCT FROM \$\{verifiedSessionId\}\s*\n\s*AND eo\.expires_at IS NOT DISTINCT FROM \$\{verifiedExpiresAt\}/)
  })

  it('no schema/migration change was needed — expires_at is an existing event_orders column (see scripts/add-events-payments.sql), never newly added here', () => {
    const migrationFiles = ['scripts/add-events-payments.sql']
    for (const f of migrationFiles) {
      expect(fs.existsSync(f)).toBe(true)
    }
    const code = routeSrc()
    // The route itself contains no DDL of any kind.
    expect(code).not.toMatch(/ALTER TABLE|CREATE TABLE|ADD COLUMN/i)
  })
})

// ─── Decision matrix — classifyRetrySafety (pure function, full truth table) ──

describe('classifyRetrySafety — full decision matrix', () => {
  it('session payment_status=paid is unsafe (already paid) regardless of PaymentIntent state', () => {
    expect(classifyRetrySafety({ sessionStatus: 'complete', sessionPaymentStatus: 'paid', paymentIntentStatus: null })).toBe('UNSAFE_ALREADY_PAID')
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'paid', paymentIntentStatus: 'requires_action' })).toBe('UNSAFE_ALREADY_PAID')
  })

  it('PaymentIntent succeeded is unsafe (already paid) even if the session itself has not caught up', () => {
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'succeeded' })).toBe('UNSAFE_ALREADY_PAID')
  })

  it('PaymentIntent processing or requires_capture is unsafe (funds may already be authorized/collected)', () => {
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'processing' })).toBe('UNSAFE_PROCESSING')
    expect(classifyRetrySafety({ sessionStatus: 'complete', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_capture' })).toBe('UNSAFE_PROCESSING')
  })

  it('PaymentIntent requires_action/requires_confirmation with an OPEN session is still active — unsafe', () => {
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_action' })).toBe('UNSAFE_STILL_ACTIVE')
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_confirmation' })).toBe('UNSAFE_STILL_ACTIVE')
  })

  it('PaymentIntent requires_action/requires_confirmation with a NON-open session is an inconsistent state — fails closed as ambiguous, never guessed', () => {
    expect(classifyRetrySafety({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_action' })).toBe('UNSAFE_AMBIGUOUS')
    expect(classifyRetrySafety({ sessionStatus: 'complete', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_confirmation' })).toBe('UNSAFE_AMBIGUOUS')
  })

  it('an open session with no blocking PaymentIntent state is still active — unsafe', () => {
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_payment_method' })).toBe('UNSAFE_STILL_ACTIVE')
    expect(classifyRetrySafety({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })).toBe('UNSAFE_STILL_ACTIVE')
  })

  it('an expired session with a canceled or absent PaymentIntent is conclusively dead — safe to retry', () => {
    expect(classifyRetrySafety({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'canceled' })).toBe('SAFE_PREVIOUS_ATTEMPT_DEAD')
    expect(classifyRetrySafety({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })).toBe('SAFE_PREVIOUS_ATTEMPT_DEAD')
    expect(classifyRetrySafety({ sessionStatus: 'expired', sessionPaymentStatus: 'no_payment_required', paymentIntentStatus: null })).toBe('SAFE_PREVIOUS_ATTEMPT_DEAD')
  })

  it('a "complete" session that never became paid (async payment method may still settle) is treated as still potentially live, not dead', () => {
    expect(classifyRetrySafety({ sessionStatus: 'complete', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })).toBe('UNSAFE_PROCESSING')
    expect(classifyRetrySafety({ sessionStatus: 'complete', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'requires_payment_method' })).toBe('UNSAFE_PROCESSING')
  })

  it('a null (unrecognised) session status fails closed as ambiguous, never assumed safe', () => {
    expect(classifyRetrySafety({ sessionStatus: null, sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })).toBe('UNSAFE_AMBIGUOUS')
  })

  it('an unrecognised/future PaymentIntent status string fails closed as ambiguous rather than falling through', () => {
    expect(classifyRetrySafety({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: 'some_future_status' as never })).toBe('UNSAFE_AMBIGUOUS')
  })
})

// ─── Old-webhook vs new-retry race ──────────────────────────────────────
//
// §19/§20 of the governing task: after a safe replacement Checkout
// Session is created, a delayed webhook for the OLD (dead) session must
// never cancel/corrupt the NEW attempt. Confirms this is ALREADY true by
// construction (not something this PR needed to newly build), and adds
// the regression coverage the task asked for if missing.

describe('Old-webhook vs new-retry race — handleCheckoutSessionExpired matches the EXACT session id, not just order id', () => {
  it('the expired-session handler\'s WHERE clause requires the exact stripe_checkout_session_id, not order id alone — an old dead session\'s delayed webhook cannot match an order that has since moved on to a newer session', () => {
    const stripeSrc = stripComments(read('lib/events/stripe.ts'))
    const start = stripeSrc.indexOf('async function handleCheckoutSessionExpired(')
    const end = stripeSrc.indexOf('\n}', start)
    const body = stripeSrc.slice(start, end)
    expect(body).toMatch(/WHERE id = \$\{orderId\} AND stripe_checkout_session_id = \$\{session\.id\} AND payment_status = 'PENDING'/)
  })

  it('behavioral: a checkout.session.expired webhook for an OLD session id is a safe no-op once the order has moved past PENDING (e.g. a Retry already reacquired it under a new session) — the guarded UPDATE matches zero rows, never touches the order', async () => {
    vi.doUnmock('@/lib/events/stripe')
    vi.resetModules()
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')
    // Mocked sql always resolves whatever is queued — this proves the
    // handler ISSUES the exact-match guarded statement (real-Postgres
    // proof that a mismatched id therefore returns zero rows is
    // scripts/tests/verify-events-phase2-concurrency.sh's and this
    // route's own established convention; not re-proven with a real DB
    // here). queue() resolves the UPDATE...RETURNING to zero rows,
    // simulating the WHERE clause not matching (old session id, order
    // now points elsewhere) — the audit INSERT CTE is driven FROM that
    // same zero-row result, so nothing further happens.
    queue([])
    const event = {
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_old_dead_session', metadata: { event_order_id: 'order-1' } } },
    } as never
    await expect(processStripeWebhookEvent(event)).resolves.not.toThrow()
    expect(sqlMock).toHaveBeenCalledTimes(1)
    // The tagged-template's static text segments (values are opaque at
    // this layer — the strings array never contains the interpolated
    // variable name or value, only the SQL text around each gap) still
    // prove the statement's SHAPE: both an id/order match AND a
    // stripe_checkout_session_id match sit in the same WHERE clause,
    // alongside the payment_status='PENDING' idempotency guard.
    const stmtArgs = sqlMock.mock.calls[0] as unknown as unknown[]
    const stmtText = (stmtArgs[0] as string[]).join('')
    expect(stmtText).toMatch(/WHERE id =.*AND stripe_checkout_session_id =.*AND payment_status = 'PENDING'/)
    // The order id and the (mismatched, dead) session id were both
    // actually passed as bound parameters, not silently dropped.
    expect(stmtArgs).toContain('order-1')
    expect(stmtArgs).toContain('cs_old_dead_session')
  })
})

// ─── Manager UI ─────────────────────────────────────────────────────────

describe('RegistrationsPanel — pending payment actions', () => {
  const code = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))

  it('shows Retry payment and Cancel registration only for PENDING orders, manager+ only', () => {
    expect(code).toMatch(/canManage && o\.payment_status === 'PENDING'/)
    expect(code).toMatch(/Retry payment/)
    expect(code).toMatch(/Cancel registration/)
  })

  it('destructive cancel action requires confirmation', () => {
    const fnStart = code.indexOf('async function cancelPending')
    const fnBody = code.slice(fnStart, code.indexOf('\n  }', fnStart))
    expect(fnBody).toMatch(/confirm\(/)
  })

  it('an expired pending order is labelled distinctly from a still-live pending order', () => {
    expect(code).toMatch(/is_expired_pending/)
    expect(code).toMatch(/Pending payment \(expired\)/)
  })

  it('the Refund button remains gated to PAID orders only — pending actions and refund never overlap on the same order', () => {
    expect(code).toMatch(/o\.payment_status === 'PAID' && o\.refundable/)
  })
})

describe('Orders API — exposes expiry state needed by the manager UI', () => {
  it('the orders route selects expires_at and computes is_expired_pending server-side (never trusting the browser clock)', () => {
    const code = stripComments(read('app/api/events/[id]/orders/route.ts'))
    expect(code).toMatch(/eo\.expires_at/)
    expect(code).toMatch(/is_expired_pending/)
  })
})
