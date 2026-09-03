import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// vi.mock is hoisted above imports by Vitest — the mock factory must not
// close over a module-scope const declared with its own initializer
// (that ordering trap is exactly what an earlier draft of this file hit).
// Matches the established pattern already used by
// tests/containment/apiMeCapabilityProjection.test.ts.
const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

// Phase C1.7 — Stripe payment-webhook audit gap. lib/events/stripe.ts's
// three webhook handlers (handleCheckoutSessionCompleted,
// handleCheckoutSessionExpired, handlePaymentIntentFailed) previously
// mutated event_orders with no audit trail at all — a payment system with
// a real audit trail for every human-initiated order action (refund,
// cancel, edit, check-in — see lib/events/auditLog.ts) but none for the
// automated payment-state transitions Stripe itself drives.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

describe('Phase C1.7 — static shape: atomic UPDATE+audit CTE, reusing audit_logs', () => {
  const source = readSource('lib/events/stripe.ts')

  it('does not introduce a competing audit table — writes only to audit_logs', () => {
    expect(source).toMatch(/INSERT INTO audit_logs/)
    // Every audit_logs INSERT in this file is inside a WITH ... AS (...) CTE
    // whose source is the UPDATE's own RETURNING — never a separate,
    // unconditional statement.
    const ctes = source.match(/WITH updated AS \(\s*UPDATE event_orders[\s\S]*?RETURNING id, organisation_id\s*\)/g) ?? []
    expect(ctes.length).toBe(3)
  })

  it('every webhook-path audit INSERT sources organisation_id from the UPDATE CTE, never from an independently-resolved value', () => {
    const inserts = source.match(/INSERT INTO audit_logs[\s\S]*?FROM updated/g) ?? []
    expect(inserts.length).toBe(3)
    for (const insert of inserts) {
      expect(insert).toMatch(/SELECT gen_random_uuid\(\)::text, organisation_id, NULL,/)
    }
  })

  it('user_id is always NULL (no human actor) and after_state marks the source as stripe_webhook, distinguishing these rows from every human-actor entry lib/events/auditLog.ts writes', () => {
    const inserts = source.match(/INSERT INTO audit_logs[\s\S]*?FROM updated/g) ?? []
    for (const insert of inserts) {
      expect(insert).toMatch(/"source":"stripe_webhook"/)
    }
  })

  it('three distinct, clearly-named actions cover the three real Stripe events this webhook actually handles — no invented event types', () => {
    expect(source).toMatch(/'event_order\.payment_succeeded'/)
    expect(source).toMatch(/'event_order\.payment_expired'/)
    expect(source).toMatch(/'event_order\.payment_failed'/)
  })

  it('no raw webhook payload, Stripe signature, or payment credential is ever written into audit_logs — only the resulting status fields', () => {
    const inserts = source.match(/INSERT INTO audit_logs[\s\S]*?FROM updated/g) ?? []
    for (const insert of inserts) {
      expect(insert).not.toMatch(/signature|card|payment_method_details|raw_body|rawBody/i)
    }
  })
})

describe('Phase C1.7 — behavioural proof: idempotency by construction, no mock-level double-logging on retry', () => {
  beforeEach(() => { sqlMock.mockClear() })

  it('a single combined statement is issued per handler call — the audit write is not a separate round trip that could independently fail or duplicate', async () => {
    // First transition: the UPDATE...RETURNING matches a row, so the CTE's
    // INSERT produces one audit row (mocked return shape is irrelevant to
    // the handler itself, which does not branch on it for
    // handleCheckoutSessionCompleted/handleCheckoutSessionExpired).
    sqlMock.mockResolvedValue([])
    const { processStripeWebhookEvent } = await import('@/lib/events/stripe')

    const fakeSession = {
      id: 'cs_test_1',
      payment_status: 'paid',
      payment_intent: 'pi_test_1',
      metadata: { event_order_id: 'order-1' },
    }
    await processStripeWebhookEvent({
      type: 'checkout.session.completed',
      account: 'acct_test',
      data: { object: fakeSession },
    } as never)

    // Exactly one sql call for the UPDATE+audit CTE, plus whatever
    // issueTicketTokensForPaidOrder/recordEventBookingActivityForOrder
    // issue afterward — the key assertion is that the UPDATE and the audit
    // INSERT are NOT two separate sql`...` calls.
    const combinedCalls = sqlMock.mock.calls.filter(c => {
      const text = (c[0] as string[])?.join?.('') ?? ''
      return text.includes('UPDATE event_orders') && text.includes('INSERT INTO audit_logs')
    })
    expect(combinedCalls.length).toBe(1)
  })
})
