import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Manager cancellation of a PENDING paid order must make the order's own Checkout
// Session unpayable first, so money can never be taken for an order that is already
// CANCELLED. Three layers are covered here:
//   1. expireCheckoutSessionForCancellation (the Stripe helper) against a mocked SDK
//   2. cancelOrder (the service) against a queued sql mock + a mocked helper
//   3. source containment (ordering, tenant/account scoping, route mapping)
// No real database, network or Stripe call is made anywhere in this file.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── Mocks ─────────────────────────────────────────────────────────────

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((..._args: unknown[]) => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sqlMock(...args) }))
const queue = (...responses: unknown[][]) => { responseQueue = responses; callCount = 0 }
const text = (i: number) => ((sqlMock.mock.calls[i] as unknown[])[0] as TemplateStringsArray).join('')
const args = (i: number) => (sqlMock.mock.calls[i] as unknown[]).slice(1)

vi.mock('@/lib/crm/eventSync', () => ({ recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined) }))

const retrieveMock = vi.fn()
const expireMock = vi.fn()
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { retrieve: (...a: unknown[]) => retrieveMock(...a), expire: (...a: unknown[]) => expireMock(...a) } }
  },
}))

const expireHelperMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    expireCheckoutSessionForCancellation: (...a: unknown[]) => expireHelperMock(...a),
    createRefund: vi.fn(),
  }
})

beforeEach(() => {
  sqlMock.mockClear()
  queue()
  retrieveMock.mockReset()
  expireMock.mockReset()
  expireHelperMock.mockReset()
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
})

// ── 1. The Stripe helper ──────────────────────────────────────────────

describe('expireCheckoutSessionForCancellation', () => {
  const ORDER = 'order-1'
  const input = { sessionId: 'cs_1', connectedAccountId: 'acct_org_a', orderId: ORDER }
  async function helper() {
    const mod = await vi.importActual<typeof import('@/lib/events/stripe')>('@/lib/events/stripe')
    return mod.expireCheckoutSessionForCancellation
  }

  it('an OPEN session of this order is retrieved and expired on the order\'s own connected account', async () => {
    retrieveMock.mockResolvedValue({ id: 'cs_1', status: 'open', payment_status: 'unpaid', metadata: { event_order_id: ORDER } })
    expireMock.mockResolvedValue({})
    expect(await (await helper())(input)).toEqual({ outcome: 'expired' })
    expect(retrieveMock).toHaveBeenCalledWith('cs_1', {}, { stripeAccount: 'acct_org_a' })
    expect(expireMock).toHaveBeenCalledWith('cs_1', {}, { stripeAccount: 'acct_org_a' })
  })

  it('an already EXPIRED session is reported as such and never expired again', async () => {
    retrieveMock.mockResolvedValue({ status: 'expired', payment_status: 'unpaid', metadata: { event_order_id: ORDER } })
    expect(await (await helper())(input)).toEqual({ outcome: 'already_expired' })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it.each([['paid'], ['unpaid'], ['no_payment_required']])('a COMPLETED session (payment_status %s) is reported complete and never expired', async (paymentStatus) => {
    retrieveMock.mockResolvedValue({ status: 'complete', payment_status: paymentStatus, metadata: { event_order_id: ORDER } })
    expect(await (await helper())(input)).toEqual({ outcome: 'complete', paymentStatus })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it('a session Stripe does not have on that account is "not_found" (nothing payable exists)', async () => {
    retrieveMock.mockRejectedValue(Object.assign(new Error('No such checkout.session'), { code: 'resource_missing' }))
    expect(await (await helper())(input)).toEqual({ outcome: 'not_found' })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it('WRONG ORDER: a session whose metadata names a different order is never expired', async () => {
    retrieveMock.mockResolvedValue({ status: 'open', payment_status: 'unpaid', metadata: { event_order_id: 'order-OTHER' } })
    const r = await (await helper())(input)
    expect(r).toMatchObject({ outcome: 'failed' })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it('a session with no order identity in its metadata is never expired', async () => {
    retrieveMock.mockResolvedValue({ status: 'open', payment_status: 'unpaid', metadata: {} })
    expect(await (await helper())(input)).toMatchObject({ outcome: 'failed' })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it('STRIPE EXPIRY FAILURE: an open session that cannot be expired is "failed" (never "expired")', async () => {
    retrieveMock.mockResolvedValue({ status: 'open', payment_status: 'unpaid', metadata: { event_order_id: ORDER } })
    expireMock.mockRejectedValue(new Error('Stripe is unavailable'))
    expect(await (await helper())(input)).toEqual({ outcome: 'failed', error: 'Stripe is unavailable' })
  })

  it('a retrieve failure other than "no such session" is "failed"', async () => {
    retrieveMock.mockRejectedValue(new Error('network down'))
    expect(await (await helper())(input)).toEqual({ outcome: 'failed', error: 'network down' })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it('an unrecognised session status fails closed', async () => {
    retrieveMock.mockResolvedValue({ status: 'something_new', payment_status: 'unpaid', metadata: { event_order_id: ORDER } })
    expect(await (await helper())(input)).toMatchObject({ outcome: 'failed' })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it('Stripe not configured (no STRIPE_SECRET_KEY) is "failed", never a silent success', async () => {
    vi.resetModules()
    delete process.env.STRIPE_SECRET_KEY
    const fresh = await vi.importActual<typeof import('@/lib/events/stripe')>('@/lib/events/stripe')
    expect(await fresh.expireCheckoutSessionForCancellation(input)).toMatchObject({ outcome: 'failed' })
  })
})

// ── 2. cancelOrder ────────────────────────────────────────────────────

const transitions = await import('@/lib/events/services/orderTransitions')
const actor = { organisationId: 'org-a', userId: 'staff-1', eventId: 'event-1', orderId: 'order-1' }
const EVENT = [{ id: 'event-1' }]
const pending = (over: Record<string, unknown> = {}) => [{
  id: 'order-1', status: 'PENDING', payment_status: 'PENDING',
  stripe_checkout_session_id: 'cs_1', stripe_account_id: 'acct_org_a', ...over,
}]
const UPDATED = [{ id: 'order-1', notification_id: null }]

describe('cancelOrder — PENDING paid order with a Checkout Session', () => {
  it('OPEN session: the order\'s own session + account + id are expired BEFORE the order is cancelled, and the cancel is tied to that session id', async () => {
    expireHelperMock.mockResolvedValue({ outcome: 'expired' })
    queue(EVENT, pending(), UPDATED, [], [])
    const res = await transitions.cancelOrder(actor)
    expect(res).toEqual({ ok: true, alreadyResolved: false })
    expect(expireHelperMock).toHaveBeenCalledTimes(1)
    expect(expireHelperMock).toHaveBeenCalledWith({ sessionId: 'cs_1', connectedAccountId: 'acct_org_a', orderId: 'order-1' })
    // calls: 0 event, 1 order, 2 cancel UPDATE (...) — Stripe was called between 1 and 2
    expect(text(2)).toMatch(/SET status = 'CANCELLED', payment_status = 'EXPIRED'/)
    expect(text(2)).toMatch(/stripe_checkout_session_id IS NOT DISTINCT FROM/)
    expect(args(2)).toContain('cs_1')
    expect(expireHelperMock.mock.invocationCallOrder[0]).toBeLessThan(sqlMock.mock.invocationCallOrder[2])
  })

  it.each([['already_expired'], ['not_found']])('%s: nothing payable remains, so the order is cancelled', async (outcome) => {
    expireHelperMock.mockResolvedValue({ outcome })
    queue(EVENT, pending(), UPDATED, [], [])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: true, alreadyResolved: false })
  })

  it('COMPLETED session: refused (PAYMENT_IN_PROGRESS) and the order is NOT changed', async () => {
    expireHelperMock.mockResolvedValue({ outcome: 'complete', paymentStatus: 'paid' })
    queue(EVENT, pending())
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS' })
    expect(allUpdates()).toHaveLength(0)
  })

  it('STRIPE EXPIRY FAILURE: refused (STRIPE_EXPIRE_FAILED) and the order is NOT cancelled — no "cancelled while still payable" state', async () => {
    expireHelperMock.mockResolvedValue({ outcome: 'failed', error: 'Stripe is unavailable' })
    queue(EVENT, pending())
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: false, code: 'STRIPE_EXPIRE_FAILED', error: 'Stripe is unavailable' })
    expect(allUpdates()).toHaveLength(0)
  })

  it('a session id with no recorded Stripe account fails closed without calling Stripe', async () => {
    queue(EVENT, pending({ stripe_account_id: null }))
    const res = await transitions.cancelOrder(actor)
    expect(res).toMatchObject({ ok: false, code: 'STRIPE_EXPIRE_FAILED' })
    expect(expireHelperMock).not.toHaveBeenCalled()
    expect(allUpdates()).toHaveLength(0)
  })

  it('MISSING session id (reservation made, session not created yet): nothing to expire, order is cancelled', async () => {
    queue(EVENT, pending({ stripe_checkout_session_id: null }), UPDATED, [], [])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: true, alreadyResolved: false })
    expect(expireHelperMock).not.toHaveBeenCalled()
    expect(args(2)).toContain(null)
  })

  it('the session changed under us (a Retry replaced it): the guarded UPDATE matches nothing and the still-PENDING order is reported, not "already resolved"', async () => {
    expireHelperMock.mockResolvedValue({ outcome: 'expired' })
    queue(EVENT, pending(), [], [{ payment_status: 'PENDING' }])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: false, code: 'CHANGED_CONCURRENTLY' })
  })

  it('a concurrent webhook already resolved it (UPDATE matches nothing, order no longer PENDING): still a benign "already resolved"', async () => {
    expireHelperMock.mockResolvedValue({ outcome: 'expired' })
    queue(EVENT, pending(), [], [{ payment_status: 'EXPIRED' }])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: true, alreadyResolved: true })
  })
})

describe('cancelOrder — isolation and unchanged behaviour', () => {
  it('ORDER FROM ANOTHER ORGANISATION/EVENT: not found, Stripe never called, nothing updated', async () => {
    queue(EVENT, [])
    expect(await transitions.cancelOrder({ ...actor, organisationId: 'org-b' })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(expireHelperMock).not.toHaveBeenCalled()
    expect(allUpdates()).toHaveLength(0)
    // both lookups are scoped to the caller's own organisation
    expect(args(0)).toContain('org-b')
    expect(args(1)).toContain('org-b')
  })

  it('the account used is the ORDER\'s stored account, whatever the organisation\'s current settings say', async () => {
    expireHelperMock.mockResolvedValue({ outcome: 'expired' })
    queue(EVENT, pending({ stripe_account_id: 'acct_HISTORICAL' }), UPDATED, [], [])
    await transitions.cancelOrder(actor)
    expect(expireHelperMock).toHaveBeenCalledWith(expect.objectContaining({ connectedAccountId: 'acct_HISTORICAL' }))
  })

  it('FREE order: never touches Stripe, and the statement sequence is exactly what it was (event, order, update)', async () => {
    queue(EVENT, [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'NOT_REQUIRED' }], UPDATED, [], [])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: true, alreadyResolved: false })
    expect(expireHelperMock).not.toHaveBeenCalled()
    expect(text(2)).toMatch(/status = 'CONFIRMED' AND payment_status = 'NOT_REQUIRED'/)
    expect(text(2)).not.toMatch(/stripe_checkout_session_id/)
  })

  it('a free order cancel that matches nothing is still an idempotent success, with no extra lookup', async () => {
    queue(EVENT, [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'NOT_REQUIRED' }], [])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: true, alreadyResolved: true })
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('a PAID order is still not cancellable here (reversal means refund), and Stripe is not called', async () => {
    queue(EVENT, [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID', stripe_checkout_session_id: 'cs_1', stripe_account_id: 'acct_org_a' }])
    expect(await transitions.cancelOrder(actor)).toEqual({ ok: false, code: 'NOT_CANCELLABLE' })
    expect(expireHelperMock).not.toHaveBeenCalled()
  })
})

function allUpdates(): string[] {
  return (sqlMock.mock.calls as unknown[][]).map(c => (c[0] as TemplateStringsArray).join('')).filter(t => /UPDATE event_orders/.test(t))
}

// ── 3. Source containment ─────────────────────────────────────────────

describe('source containment', () => {
  const svc = stripComments(read('lib/events/services/orderTransitions.ts'))
  const cancelFn = svc.slice(svc.indexOf('export async function cancelOrder('))
  const route = stripComments(read('app/api/events/[id]/orders/[orderId]/cancel/route.ts'))

  it('cancelOrder expires the session before its first UPDATE, using the order\'s own stored account', () => {
    expect(cancelFn.indexOf('expireCheckoutSessionForCancellation(')).toBeGreaterThan(-1)
    expect(cancelFn.indexOf('expireCheckoutSessionForCancellation(')).toBeLessThan(cancelFn.indexOf('UPDATE event_orders'))
    expect(cancelFn).toMatch(/connectedAccountId: order\.stripe_account_id/)
    expect(cancelFn).not.toMatch(/getConnectAccountState|stripeConnect/)
  })
  it('only the free-order branch is untouched by Stripe: the expiry runs only for a PENDING paid reservation', () => {
    expect(cancelFn).toMatch(/const sessionIdAtRead = isPendingPaidReservation \?/)
  })
  it('cancelOrder never calls createRefund, createCheckoutSession or constructWebhookEvent', () => {
    expect(cancelFn).not.toMatch(/createRefund|createCheckoutSession|constructWebhookEvent/)
  })
  it('the helper identity-checks the session against the order before expiring', () => {
    const stripeSrc = stripComments(read('lib/events/stripe.ts'))
    const helper = stripeSrc.slice(stripeSrc.indexOf('export async function expireCheckoutSessionForCancellation'))
    expect(helper.indexOf('event_order_id !== orderId')).toBeGreaterThan(-1)
    expect(helper.indexOf('event_order_id !== orderId')).toBeLessThan(helper.indexOf('sessions.expire('))
  })
  it('the cancel route maps every new outcome and still imports nothing from the Stripe module', () => {
    for (const code of ['PAYMENT_IN_PROGRESS', 'CHANGED_CONCURRENTLY', 'STRIPE_EXPIRE_FAILED']) expect(route).toContain(`case '${code}'`)
    expect(route).not.toMatch(/from '@\/lib\/events\/stripe'/)
  })
  it('a session can never be written back to an order that is no longer PENDING (checkout and retry)', () => {
    expect(read('lib/events/services/paidCheckout.ts')).toMatch(/stripe_checkout_session_id IS NULL AND payment_status = 'PENDING'/)
    expect(read('lib/events/services/retryCheckout.ts')).toMatch(/stripe_checkout_session_id IS NULL AND payment_status = 'PENDING'/)
  })
})
