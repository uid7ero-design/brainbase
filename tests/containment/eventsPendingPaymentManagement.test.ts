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

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }
function req(body?: unknown) {
  return new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const cancelRoute = await import('@/app/api/events/[id]/orders/[orderId]/cancel/route')
const retryRoute = await import('@/app/api/events/[id]/orders/[orderId]/retry/route')

const CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1' }) }

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  createCheckoutSessionMock.mockReset()
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
