import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Resend delivery-status visibility — lib/events/ticketEmailDeliveryTracking.ts.
// Mocking strategy mirrors tests/containment/stripeWebhookAudit.test.ts (a
// single `sql` mock whose calls are inspected both behaviourally — what the
// function returns given a queued DB response — and via raw SQL text, since
// the guarded UPDATE+audit CTE's exact shape (terminal lock, replay guard,
// ordering guard) is the entire correctness property this module provides).

let queued: unknown[] = []
const sqlMock = vi.fn((..._args: [TemplateStringsArray, ...unknown[]]) => Promise.resolve(queued))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const tracking = await import('@/lib/events/ticketEmailDeliveryTracking')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const RAW_SOURCE = readSource('lib/events/ticketEmailDeliveryTracking.ts')
const SOURCE = stripComments(RAW_SOURCE)

function lastCallText(): string {
  const call = sqlMock.mock.calls[sqlMock.mock.calls.length - 1]
  return (call[0] as TemplateStringsArray).join('')
}

beforeEach(() => {
  sqlMock.mockClear()
  queued = []
})

// ─── recordTicketEmailDeliveryAccepted ──────────────────────────────

describe('recordTicketEmailDeliveryAccepted', () => {
  it('inserts one row with delivery_status accepted, ON CONFLICT DO NOTHING on provider_message_id', async () => {
    await tracking.recordTicketEmailDeliveryAccepted({
      organisationId: 'org-1', orderId: 'order-1', sendSource: 'automatic', providerMessageId: 'msg-abc',
    })
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const text = lastCallText()
    expect(text).toMatch(/INSERT INTO event_ticket_email_deliveries/)
    expect(text).toMatch(/ON CONFLICT \(provider_message_id\) DO NOTHING/)
    const call = sqlMock.mock.calls[0]
    expect(call.slice(1)).toEqual(expect.arrayContaining(['org-1', 'order-1', 'automatic', 'msg-abc']))
  })

  it('is best-effort: a DB failure is swallowed, never thrown, never breaks the caller', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection reset'))
    await expect(
      tracking.recordTicketEmailDeliveryAccepted({
        organisationId: 'org-1', orderId: 'order-1', sendSource: 'manual', providerMessageId: 'msg-abc',
      }),
    ).resolves.toBeUndefined()
  })
})

// ─── applyResendDeliveryWebhookEvent — SQL shape ────────────────────

describe('applyResendDeliveryWebhookEvent — static SQL shape', () => {
  it('the guarded UPDATE locks out further transitions once delivery_status is one of the four terminal outcomes (not "delivered")', () => {
    expect(SOURCE).toMatch(/AND delivery_status NOT IN \('bounced', 'suppressed', 'complained', 'failed'\)/)
  })

  it('exact-replay guard compares the incoming svix event id via IS DISTINCT FROM', () => {
    expect(SOURCE).toMatch(/latest_event_id IS DISTINCT FROM \$\{eventId\}/)
  })

  it('ordering guard rejects an out-of-order older event', () => {
    expect(SOURCE).toMatch(/latest_event_at IS NULL OR \$\{eventCreatedAt\}::timestamptz >= latest_event_at/)
  })

  it('the audit INSERT is chained from the UPDATE\'s own RETURNING inside one CTE — never a separate statement (ADR-0003 §3, matching lib/events/stripe.ts\'s webhook-handler pattern)', () => {
    const cte = SOURCE.match(/WITH updated AS \(\s*UPDATE event_ticket_email_deliveries[\s\S]*?RETURNING organisation_id, order_id, send_source\s*\)\s*INSERT INTO audit_logs[\s\S]*?FROM updated/)
    expect(cte).not.toBeNull()
  })

  it('five distinct, clearly-named audit actions — one per outcome, and the failed one is deliberately NOT the same string as the existing send-failure action', () => {
    expect(SOURCE).toMatch(/'event_order\.ticket_email_delivered'/)
    expect(SOURCE).toMatch(/'event_order\.ticket_email_bounced'/)
    expect(SOURCE).toMatch(/'event_order\.ticket_email_suppressed'/)
    expect(SOURCE).toMatch(/'event_order\.ticket_email_complained'/)
    expect(SOURCE).toMatch(/'event_order\.ticket_email_delivery_failed'/)
    expect(SOURCE).not.toMatch(/'event_order\.ticket_email_failed'/)
  })

  it('never touches event_orders, never calls a send/claim/retry primitive, never schedules another attempt', () => {
    expect(SOURCE).not.toMatch(/UPDATE event_orders/)
    expect(SOURCE).not.toMatch(/attemptAutomaticTicketEmail|claimTicketEmailDelivery|markTicketEmailFailed|sendTicketEmail/)
  })

  it('after_state metadata never includes recipient email, webhook secret, API key, or a raw signature', () => {
    const insert = SOURCE.match(/INSERT INTO audit_logs[\s\S]*?FROM updated/)?.[0] ?? ''
    expect(insert).not.toMatch(/purchaser_email|recipient|secret|signature|api_?key/i)
  })
})

// ─── applyResendDeliveryWebhookEvent — behaviour ────────────────────

describe('applyResendDeliveryWebhookEvent — behaviour', () => {
  const base = { providerMessageId: 'msg-1', eventId: 'evt-1', eventType: 'email.delivered', eventCreatedAt: '2026-09-16T00:00:00.000Z' } as const

  it('delivered: applied true when the guarded UPDATE returns a row', async () => {
    queued = [{ resource_id: 'order-1' }]
    const result = await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'delivered' })
    expect(result).toEqual({ applied: true })
  })

  it('bounced: applied true, does not requeue or resend — single sql call only', async () => {
    queued = [{ resource_id: 'order-1' }]
    const result = await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'bounced', eventType: 'email.bounced' })
    expect(result).toEqual({ applied: true })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('suppressed: applied true', async () => {
    queued = [{ resource_id: 'order-1' }]
    const result = await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'suppressed', eventType: 'email.suppressed' })
    expect(result).toEqual({ applied: true })
  })

  it('complained: applied true', async () => {
    queued = [{ resource_id: 'order-1' }]
    const result = await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'complained', eventType: 'email.complained' })
    expect(result).toEqual({ applied: true })
  })

  it('failed: applied true', async () => {
    queued = [{ resource_id: 'order-1' }]
    const result = await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'failed', eventType: 'email.failed' })
    expect(result).toEqual({ applied: true })
  })

  it('unknown provider_message_id (the WHERE clause matches no row): applied false, not an error', async () => {
    queued = []
    const result = await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'delivered' })
    expect(result).toEqual({ applied: false })
  })

  it('replayed/guarded-out event (the WHERE clause excludes the row): applied false, still exactly one sql call — no duplicate write path', async () => {
    queued = []
    await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'delivered' })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('passes the outcome, event id, event type, and event timestamp through to the guarded UPDATE call', async () => {
    queued = [{ resource_id: 'order-1' }]
    await tracking.applyResendDeliveryWebhookEvent({ ...base, outcome: 'delivered' })
    const call = sqlMock.mock.calls[0]
    expect(call).toEqual(expect.arrayContaining(['msg-1', 'evt-1', 'email.delivered', '2026-09-16T00:00:00.000Z']))
  })
})
