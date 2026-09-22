import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Resend delivery-status webhook receiver —
// app/api/public/events/webhooks/resend/route.ts. Mirrors this repo's
// established public-webhook-route testing shape (no dedicated Stripe
// route test exists, but the mocking discipline matches
// tests/containment/eventsTicketEmailResendRoute.test.ts: every real
// side-effecting dependency mocked, no real network/DB call).

class FakeResendWebhookSignatureError extends Error {}

const isResendWebhookConfiguredMock = vi.fn()
const verifyResendWebhookEventMock = vi.fn()
vi.mock('@/lib/events/resendWebhook', () => ({
  isResendWebhookConfigured: (...args: unknown[]) => isResendWebhookConfiguredMock(...args),
  verifyResendWebhookEvent: (...args: unknown[]) => verifyResendWebhookEventMock(...args),
  ResendWebhookSignatureError: FakeResendWebhookSignatureError,
}))

const applyResendDeliveryWebhookEventMock = vi.fn()
vi.mock('@/lib/events/ticketEmailDeliveryTracking', () => ({
  applyResendDeliveryWebhookEvent: (...args: unknown[]) => applyResendDeliveryWebhookEventMock(...args),
}))

const route = await import('@/app/api/public/events/webhooks/resend/route')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const RAW_SOURCE = readSource('app/api/public/events/webhooks/resend/route.ts')
const SOURCE = stripComments(RAW_SOURCE)

function req(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/public/events/webhooks/resend', {
    method: 'POST',
    headers: { 'svix-id': 'evt-1', 'svix-timestamp': '1700000000', 'svix-signature': 'v1,fake', ...headers },
    body,
  })
}

const DELIVERED_PAYLOAD = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-09-16T00:00:00.000Z',
  data: { email_id: 'resend-msg-1', created_at: '2026-09-16T00:00:00.000Z', from: 'a@b.com', to: ['c@d.com'], subject: 'x' },
})

beforeEach(() => {
  isResendWebhookConfiguredMock.mockReset().mockReturnValue(true)
  verifyResendWebhookEventMock.mockReset()
  applyResendDeliveryWebhookEventMock.mockReset().mockResolvedValue({ applied: true })
})

// ─── CONFIGURATION ───────────────────────────────────────────────────

describe('CONFIGURATION', () => {
  it('not configured (RESEND_API_KEY / RESEND_WEBHOOK_SECRET absent) -> 503, never attempts verification', async () => {
    isResendWebhookConfiguredMock.mockReturnValue(false)
    const res = await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(res.status).toBe(503)
    expect(verifyResendWebhookEventMock).not.toHaveBeenCalled()
  })
})

// ─── SIGNATURE ───────────────────────────────────────────────────────

describe('SIGNATURE', () => {
  it('missing svix-id header -> 400, verification never attempted', async () => {
    const res = await route.POST(req(DELIVERED_PAYLOAD, { 'svix-id': '' }) as never)
    expect(res.status).toBe(400)
    expect(verifyResendWebhookEventMock).not.toHaveBeenCalled()
  })

  it('missing svix-signature header -> 400', async () => {
    const res = await route.POST(req(DELIVERED_PAYLOAD, { 'svix-signature': '' }) as never)
    expect(res.status).toBe(400)
  })

  it('invalid signature -> 400, applyResendDeliveryWebhookEvent never called (fail closed)', async () => {
    verifyResendWebhookEventMock.mockImplementation(() => { throw new FakeResendWebhookSignatureError('bad sig') })
    const res = await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(res.status).toBe(400)
    expect(applyResendDeliveryWebhookEventMock).not.toHaveBeenCalled()
  })

  it('verification is called with the RAW request body text, not a re-serialized parse of it', async () => {
    verifyResendWebhookEventMock.mockReturnValue(JSON.parse(DELIVERED_PAYLOAD))
    await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(verifyResendWebhookEventMock).toHaveBeenCalledWith(
      DELIVERED_PAYLOAD,
      { id: 'evt-1', timestamp: '1700000000', signature: 'v1,fake' },
    )
  })

  it('reads the raw body via req.text() before any JSON parsing, matching the Stripe webhook route\'s own discipline', () => {
    expect(SOURCE).toMatch(/await req\.text\(\)/)
    expect(SOURCE).not.toMatch(/req\.json\(\)/)
  })
})

// ─── EVENT DISPATCH ──────────────────────────────────────────────────

describe('EVENT DISPATCH', () => {
  function payload(type: string, data: Record<string, unknown> = {}) {
    return { type, created_at: '2026-09-16T00:00:00.000Z', data: { email_id: 'resend-msg-1', ...data } }
  }

  it('email.delivered -> applyResendDeliveryWebhookEvent called with outcome delivered', async () => {
    verifyResendWebhookEventMock.mockReturnValue(payload('email.delivered'))
    const res = await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(res.status).toBe(200)
    expect(applyResendDeliveryWebhookEventMock).toHaveBeenCalledWith({
      providerMessageId: 'resend-msg-1', outcome: 'delivered', eventId: 'evt-1', eventType: 'email.delivered', eventCreatedAt: '2026-09-16T00:00:00.000Z',
    })
  })

  it('email.bounced -> outcome bounced, does not requeue/resend (no other side effect than the tracking call)', async () => {
    verifyResendWebhookEventMock.mockReturnValue(payload('email.bounced', { bounce: { message: 'x', subType: 'y', type: 'z' } }))
    await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(applyResendDeliveryWebhookEventMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'bounced' }))
  })

  it('email.suppressed -> outcome suppressed', async () => {
    verifyResendWebhookEventMock.mockReturnValue(payload('email.suppressed', { suppressed: { message: 'x', type: 'y' } }))
    await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(applyResendDeliveryWebhookEventMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'suppressed' }))
  })

  it('email.complained -> outcome complained', async () => {
    verifyResendWebhookEventMock.mockReturnValue(payload('email.complained'))
    await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(applyResendDeliveryWebhookEventMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'complained' }))
  })

  it('email.failed -> outcome failed', async () => {
    verifyResendWebhookEventMock.mockReturnValue(payload('email.failed', { failed: { reason: 'x' } }))
    await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(applyResendDeliveryWebhookEventMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })

  it.each(['email.sent', 'email.scheduled', 'email.delivery_delayed', 'email.opened', 'email.clicked', 'email.received', 'contact.created', 'domain.updated'])(
    'unsupported event type %s -> 200, safely ignored, never calls applyResendDeliveryWebhookEvent',
    async (type) => {
      verifyResendWebhookEventMock.mockReturnValue(payload(type))
      const res = await route.POST(req(DELIVERED_PAYLOAD) as never)
      expect(res.status).toBe(200)
      expect(applyResendDeliveryWebhookEventMock).not.toHaveBeenCalled()
    },
  )

  it('malformed payload (email_id missing) -> 200, no mutation, never mistaken for a real event', async () => {
    verifyResendWebhookEventMock.mockReturnValue({ type: 'email.delivered', created_at: '2026-09-16T00:00:00.000Z', data: {} })
    const res = await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(res.status).toBe(200)
    expect(applyResendDeliveryWebhookEventMock).not.toHaveBeenCalled()
  })

  it('processing failure (DB hiccup) -> 500, surfaced as non-2xx so Svix retries', async () => {
    verifyResendWebhookEventMock.mockReturnValue(payload('email.delivered'))
    applyResendDeliveryWebhookEventMock.mockRejectedValue(new Error('db down'))
    const res = await route.POST(req(DELIVERED_PAYLOAD) as never)
    expect(res.status).toBe(500)
  })

  it('this route never triggers a send — no import of sendTicketEmail/sendEmail/attemptAutomaticTicketEmail anywhere in its source', () => {
    expect(SOURCE).not.toMatch(/sendTicketEmail|sendEmail|attemptAutomaticTicketEmail/)
  })
})

// ─── TENANCY ─────────────────────────────────────────────────────────

describe('TENANCY', () => {
  it('the route never reads an organisation id from the request — correlation is resolved entirely inside applyResendDeliveryWebhookEvent from stored linkage, never trusted from the webhook body', () => {
    expect(SOURCE).not.toMatch(/organisation_?[Ii]d/)
  })
})
