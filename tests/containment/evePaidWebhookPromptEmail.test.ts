import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// A paid order's ticket email used to wait for the hourly recovery cron. The Stripe
// webhook route now makes ONE prompt attempt after its response, through the same
// idempotent delivery machinery (claim lease + deterministic idempotency key). The
// hourly cron stays as the fallback. Covered: the route (after-response scheduling,
// no attempt on failure/unrelated events), replay safety, send failure recoverability
// and the Eve From / Reply-To on the real delivery path. No network or database.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

// ── next/server `after`: capture callbacks so the test controls "after the response" ──
const afterCallbacks: Array<() => Promise<void> | void> = []
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => Promise<void> | void) => { afterCallbacks.push(cb) } }
})

// ── Stripe module (route tests) ──
const constructWebhookEventMock = vi.fn()
const processStripeWebhookEventMock = vi.fn()
class MockStripeNotConfiguredError extends Error {}
vi.mock('@/lib/events/stripe', () => ({
  constructWebhookEvent: (...a: unknown[]) => constructWebhookEventMock(...a),
  processStripeWebhookEvent: (...a: unknown[]) => processStripeWebhookEventMock(...a),
  StripeNotConfiguredError: MockStripeNotConfiguredError,
}))

// ── Delivery machinery: real in the second half, mocked database ──
let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((..._a: unknown[]) => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: (...a: unknown[]) => sqlMock(...a) }))
const queue = (...r: unknown[][]) => { responseQueue = r; callCount = 0 }
const sqlText = (i: number) => ((sqlMock.mock.calls[i] as unknown[])[0] as TemplateStringsArray).join('')

vi.mock('@/lib/events/auditLog', () => ({
  logAutomaticTicketEmailSent: vi.fn().mockResolvedValue(undefined),
  logAutomaticTicketEmailFailed: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/crm/eventSync', () => ({ recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined) }))

const resendBodies: Record<string, unknown>[] = []
let resendStatus = 200
function stubResend() {
  resendBodies.length = 0
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    resendBodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ id: 'msg_prompt_1' }), { status: resendStatus })
  }))
}

const attemptSpy = vi.fn()

beforeEach(() => {
  afterCallbacks.length = 0
  sqlMock.mockClear()
  queue()
  constructWebhookEventMock.mockReset()
  processStripeWebhookEventMock.mockReset()
  attemptSpy.mockReset()
  resendStatus = 200
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit'
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function webhookRequest(): import('next/server').NextRequest {
  const req = new Request('https://example.test/api/public/events/webhooks/stripe', {
    method: 'POST', headers: { 'stripe-signature': 't=1,v1=ok' }, body: '{}',
  })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}

// ── The route ─────────────────────────────────────────────────────────

describe('Stripe webhook route — prompt ticket email after a paid finalisation', () => {
  async function loadRoute(attempt: (id: string) => unknown = attemptSpy) {
    vi.resetModules()
    vi.doMock('@/lib/events/ticketEmailDelivery', () => ({ attemptAutomaticTicketEmail: (id: string) => attempt(id) }))
    return await import('@/app/api/public/events/webhooks/stripe/route')
  }

  it('a paid event: responds 200 first, schedules ONE attempt for that order after the response, and nothing is sent inline', async () => {
    constructWebhookEventMock.mockReturnValue({ type: 'checkout.session.completed' })
    processStripeWebhookEventMock.mockResolvedValue({ handled: true, type: 'checkout.session.completed', paidOrderId: 'order-1' })
    attemptSpy.mockResolvedValue({ outcome: 'sent', providerMessageId: 'm1' })
    const { POST } = await loadRoute()
    const res = await POST(webhookRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(attemptSpy).not.toHaveBeenCalled() // not before the response
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()
    expect(attemptSpy).toHaveBeenCalledTimes(1)
    expect(attemptSpy).toHaveBeenCalledWith('order-1')
  })

  it('REPLAY: a re-delivered event schedules another attempt, but the idempotent delivery machinery finds nothing to claim (see the replay test below)', async () => {
    constructWebhookEventMock.mockReturnValue({ type: 'checkout.session.completed' })
    processStripeWebhookEventMock.mockResolvedValue({ handled: true, type: 'checkout.session.completed', paidOrderId: 'order-1' })
    attemptSpy.mockResolvedValue({ outcome: 'not_claimed' })
    const { POST } = await loadRoute()
    await POST(webhookRequest())
    await POST(webhookRequest())
    for (const cb of afterCallbacks) await cb()
    expect(attemptSpy).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['an unrelated or unpaid event (no paidOrderId)', { handled: true, type: 'checkout.session.expired' }],
    ['an unhandled event type', { handled: false, type: 'customer.created' }],
    ['no result at all', undefined],
  ])('%s: no email attempt is scheduled', async (_l, result) => {
    constructWebhookEventMock.mockReturnValue({ type: 'x' })
    processStripeWebhookEventMock.mockResolvedValue(result)
    const { POST } = await loadRoute()
    expect((await POST(webhookRequest())).status).toBe(200)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('processing failure: 500 so Stripe retries, and NO email attempt is made for the failed delivery', async () => {
    constructWebhookEventMock.mockReturnValue({ type: 'checkout.session.completed' })
    processStripeWebhookEventMock.mockRejectedValue(new Error('db down'))
    const { POST } = await loadRoute()
    expect((await POST(webhookRequest())).status).toBe(500)
    expect(afterCallbacks).toHaveLength(0)
    expect(attemptSpy).not.toHaveBeenCalled()
  })

  it('invalid signature: 400, nothing processed, nothing scheduled', async () => {
    constructWebhookEventMock.mockImplementation(() => { throw new Error('bad sig') })
    const { POST } = await loadRoute()
    expect((await POST(webhookRequest())).status).toBe(400)
    expect(processStripeWebhookEventMock).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(0)
  })

  it('SEND FAILURE stays recoverable: an attempt that throws never fails the already-sent response, and is swallowed', async () => {
    constructWebhookEventMock.mockReturnValue({ type: 'checkout.session.completed' })
    processStripeWebhookEventMock.mockResolvedValue({ handled: true, type: 'checkout.session.completed', paidOrderId: 'order-1' })
    attemptSpy.mockRejectedValue(new Error('boom'))
    const { POST } = await loadRoute()
    expect((await POST(webhookRequest())).status).toBe(200)
    await expect(afterCallbacks[0]()).resolves.toBeUndefined()
  })
})

// ── The delivery machinery the route calls (real code, mocked database + Resend) ──

describe('attemptAutomaticTicketEmail for a freshly PAID order', () => {
  const CLAIM = [{ id: 'order-1', ticket_email_claim_id: 'claim-1', ticket_email_attempt_count: 1 }]
  const ORDER_ROW = (surface: string) => [{
    id: 'order-1', organisation_id: 'org-a', purchaser_name: 'Pat Buyer', purchaser_email: 'buyer@example.org', booking_token: 'b'.repeat(48),
    product_surface: surface, payment_status: 'PAID', currency: 'AUD', total_cents: 100, discount_cents: 0, promotion_code_snapshot: null,
    platform_fee_cents: 0, fee_mode: null, fee_label: null, payment_total_cents: 100, paid_at: '2026-10-22T00:00:00Z', refunded_cents: null, refunded_at: null,
    event_name: 'Rehearsal', organisation_name: 'Riverside Events', organisation_settings: {},
    attendees: [{ name: 'Pat Buyer', ticket_token: 'a'.repeat(48) }], receipt_lines: [{ description: 'Rehearsal – Paid', quantity: 1, unit_price_cents: 100, discount_cents: 0 }],
  }]
  async function attempt() {
    vi.resetModules()
    vi.doUnmock('@/lib/events/ticketEmailDelivery')
    const mod = await vi.importActual<typeof import('@/lib/events/ticketEmailDelivery')>('@/lib/events/ticketEmailDelivery')
    return mod.attemptAutomaticTicketEmail('order-1')
  }

  it('claims the PAID order, sends the Eve email (From + Reply-To) with the deterministic idempotency key, and records the sent state', async () => {
    stubResend()
    vi.stubEnv('EVE_PUBLIC_BASE_URL', 'https://eveevents.com.au')
    vi.stubEnv('EVE_EMAIL_FROM', 'Eve <tickets@mail.eveevents.com.au>')
    vi.stubEnv('EVE_SUPPORT_EMAIL', 'support@eveevents.com.au')
    queue(CLAIM, ORDER_ROW('EVE'), [{ id: 'order-1' }], [], [])
    const out = await attempt()
    expect(out).toEqual({ outcome: 'sent', providerMessageId: 'msg_prompt_1' })
    expect(resendBodies).toHaveLength(1)
    expect(resendBodies[0].from).toBe('Eve <tickets@mail.eveevents.com.au>')
    expect(resendBodies[0].reply_to).toBe('support@eveevents.com.au')
    // The paid receipt names the ORGANISATION (the organiser), never the BrainBase product.
    expect(JSON.stringify(resendBodies[0])).toMatch(/Riverside Events/)
    expect(JSON.stringify(resendBodies[0])).not.toMatch(/brainbase/i)
    expect(sqlText(0)).toMatch(/payment_status IN \('NOT_REQUIRED', 'PAID'\)/)
    expect(sqlText(0)).toMatch(/ticket_email_status = 'pending'/)
    expect(sqlText(2)).toMatch(/ticket_email_status = 'sent'/)
  })

  it('REPLAY: the second attempt for the same order finds nothing to claim and sends nothing', async () => {
    stubResend()
    queue([]) // the claim UPDATE matches no row (already sending/sent)
    const out = await attempt()
    expect(out).toEqual({ outcome: 'not_claimed' })
    expect(resendBodies).toHaveLength(0)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('SEND FAILURE: the order is left FAILED with a scheduled retry (not terminal), so the existing recovery cron picks it up', async () => {
    stubResend()
    resendStatus = 500
    vi.stubEnv('EVE_PUBLIC_BASE_URL', 'https://eveevents.com.au')
    vi.stubEnv('EVE_EMAIL_FROM', 'Eve <tickets@mail.eveevents.com.au>')
    vi.stubEnv('EVE_SUPPORT_EMAIL', 'support@eveevents.com.au')
    queue(CLAIM, ORDER_ROW('EVE'), [{ id: 'order-1' }], [])
    const out = await attempt()
    expect(out).toMatchObject({ outcome: 'failed', terminal: false })
    const failedUpdate = (sqlMock.mock.calls as unknown[][]).map(c => (c[0] as TemplateStringsArray).join('')).find(t => /SET\s+ticket_email_status = 'failed'/.test(t))
    expect(failedUpdate).toMatch(/ticket_email_next_attempt_at = CASE/)
    expect(failedUpdate).toMatch(/WHEN ticket_email_attempt_count = 1 THEN NOW\(\) \+ make_interval/)
  })

  it('an Eve order with no valid sender configured sends nothing (no BrainBase fallback) and stays retryable', async () => {
    stubResend()
    vi.stubEnv('EVE_PUBLIC_BASE_URL', 'https://eveevents.com.au')
    vi.stubEnv('EVE_EMAIL_FROM', '')
    queue(CLAIM, ORDER_ROW('EVE'), [{ id: 'order-1' }], [])
    const out = await attempt()
    expect(out).toMatchObject({ outcome: 'failed', reason: 'not_configured', terminal: false })
    expect(resendBodies).toHaveLength(0)
  })

  it('a BrainBase-surface paid order keeps the default sender and gets no Reply-To', async () => {
    stubResend()
    vi.stubEnv('EVE_SUPPORT_EMAIL', 'support@eveevents.com.au')
    queue(CLAIM, ORDER_ROW('BRAINBASE'), [{ id: 'order-1' }], [], [])
    await attempt()
    expect(resendBodies).toHaveLength(1)
    expect(resendBodies[0].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
    expect(resendBodies[0]).not.toHaveProperty('reply_to')
  })
})

// ── Containment ───────────────────────────────────────────────────────

describe('containment', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  it('the webhook HANDLER stays send-free; the ROUTE is the only caller and does so inside after()', () => {
    const stripeSrc = strip(read('lib/events/stripe.ts'))
    expect(stripeSrc).not.toMatch(/attemptAutomaticTicketEmail|sendTicketEmail|sendEmail|from '@\/lib\/email'/)
    const route = strip(read('app/api/public/events/webhooks/stripe/route.ts'))
    expect(route.match(/attemptAutomaticTicketEmail\(/g) ?? []).toHaveLength(1)
    expect(route).toMatch(/after\(async \(\) => \{[\s\S]*?attemptAutomaticTicketEmail\(orderId\)/)
  })
  it('the hourly recovery cron is unchanged and still wired (fallback)', () => {
    expect(read('vercel.json')).toMatch(/"path": "\/api\/cron\/ticket-email-recovery",\s*"schedule": "0 \* \* \* \*"/)
    expect(read('lib/events/ticketEmailRecovery.ts')).toMatch(/attemptAutomaticTicketEmail\(orderId\)/)
  })
  it('the delivery is only scheduled by the same guarded flip statement (unchanged)', () => {
    expect(read('lib/events/stripe.ts')).toMatch(/ticket_email_status = 'pending'/)
  })
})
