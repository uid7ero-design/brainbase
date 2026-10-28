import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Buyer emails must date payments and refunds in the EVENT's timezone, not
// the server's (UTC on Vercel). Found by the live $1 proof (2026-10-22): a
// payment at 8:07 am ACDT on 23 Oct was emailed as "Paid 22 Oct 2026".
// Every case below names an explicit zone, so the result is the same on a
// UTC CI runner and an Adelaide laptop.

vi.mock('@/lib/db', () => ({ default: vi.fn(async () => []) }))

const receipt = await import('@ticketing/core/receipt')
const lifecycle = await import('@/lib/events/lifecycleEmail')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

// The live proof's own instants.
const PAID_AT = '2026-10-22T21:37:43.326Z'      // 23 Oct 08:07 ACDT
const REFUNDED_AT = '2026-10-22T21:43:48.783Z'  // 23 Oct 08:13 ACDT

describe('formatReceiptDate: UTC-to-next-day rollover and DST', () => {
  it('the live proof instant is 23 Oct in Adelaide and 22 Oct in UTC', () => {
    expect(receipt.formatReceiptDate(PAID_AT, 'Australia/Adelaide')).toBe('23 Oct 2026')
    expect(receipt.formatReceiptDate(PAID_AT, 'UTC')).toBe('22 Oct 2026')
  })

  it('other Australian zones roll over at their own offset', () => {
    // 2026-10-22T14:30Z: Sydney (AEDT +11) 23 Oct 01:30; Brisbane (AEST +10, no DST) 23 Oct 00:30;
    // Perth (AWST +8) 22 Oct 22:30.
    const t = '2026-10-22T14:30:00Z'
    expect(receipt.formatReceiptDate(t, 'Australia/Sydney')).toBe('23 Oct 2026')
    expect(receipt.formatReceiptDate(t, 'Australia/Brisbane')).toBe('23 Oct 2026')
    expect(receipt.formatReceiptDate(t, 'Australia/Perth')).toBe('22 Oct 2026')
  })

  it('Adelaide DST: the same 14:15Z is the same day before DST (+9:30) and the next day after it (+10:30)', () => {
    // DST starts Sun 4 Oct 2026. 30 Sep 14:15Z = 23:45 ACST (30 Sep); 22 Oct 14:15Z = 00:45 ACDT (23 Oct).
    // en-AU abbreviates September as "Sept" in current ICU; accept either.
    expect(receipt.formatReceiptDate('2026-09-30T14:15:00Z', 'Australia/Adelaide')).toMatch(/^30 Sept? 2026$/)
    expect(receipt.formatReceiptDate('2026-10-22T14:15:00Z', 'Australia/Adelaide')).toBe('23 Oct 2026')
    // DST ends Sun 5 Apr 2026: 13:45Z on 5 Apr = 23:15 ACST, same day.
    expect(receipt.formatReceiptDate('2026-04-05T13:45:00Z', 'Australia/Adelaide')).toBe('5 Apr 2026')
  })

  it('no zone or an unknown zone keeps the previous (runtime-default) behaviour instead of dropping the date', () => {
    const legacy = new Date(PAID_AT).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })
    expect(receipt.formatReceiptDate(PAID_AT, null)).toBe(legacy)
    expect(receipt.formatReceiptDate(PAID_AT, undefined)).toBe(legacy)
    expect(receipt.formatReceiptDate(PAID_AT, 'Not/AZone')).toBe(legacy)
  })
})

describe('payment summary (ticket email) uses the event timezone', () => {
  const row = {
    id: 'order-1', payment_status: 'PAID', event_name: 'Eve Live Payment Proof', organisation_name: 'Brainbase', currency: 'AUD',
    total_cents: 100, discount_cents: 0, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 100,
    paid_at: PAID_AT, receipt_lines: [{ description: 'Proof - $1.00', quantity: 1, unit_price_cents: 100, discount_cents: 0 }],
  }

  it('paid in Adelaide at 08:07 on 23 Oct -> "Paid 23 Oct 2026", never 22 Oct', () => {
    const r = receipt.receiptFromOrderRow({ ...row, event_timezone: 'Australia/Adelaide' })!
    expect(r.time_zone).toBe('Australia/Adelaide')
    const html = receipt.renderPaymentReceiptHtml(r, esc)
    expect(html).toContain('Paid 23 Oct 2026')
    expect(html).not.toContain('22 Oct')
  })

  it('refund line uses the same zone', () => {
    const r = receipt.receiptFromOrderRow({ ...row, payment_status: 'REFUNDED', refunded_cents: 100, refunded_at: REFUNDED_AT, event_timezone: 'Australia/Adelaide' })!
    const html = receipt.renderPaymentReceiptHtml(r, esc)
    expect(html).toContain('Paid 23 Oct 2026')
    expect(html).toContain('Refunded 23 Oct 2026')
    expect(html).not.toContain('22 Oct')
  })

  it('still makes no tax claim', () => {
    const html = receipt.renderPaymentReceiptHtml(receipt.receiptFromOrderRow({ ...row, event_timezone: 'Australia/Adelaide' })!, esc)
    for (const term of receipt.RECEIPT_FORBIDDEN_TERMS) expect(html).not.toContain(term)
  })

  it('both ticket-email readers select the event timezone into the receipt row', () => {
    for (const f of ['lib/events/ticketEmailDelivery.ts', 'app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts']) {
      const src = read(f)
      expect(src, f).toContain('e.timezone AS event_timezone')
      expect(src, f).toMatch(/GROUP BY eo\.id, e\.name, e\.timezone, e\.starts_at, e\.ends_at, e\.venue, o\.name, o\.settings/)
    }
  })
})

describe('refund / cancellation emails use the event timezone for paid and refunded dates', () => {
  const base: import('@/lib/events/lifecycleEmail').LifecycleEmailData = {
    type: 'ORDER_REFUNDED',
    orderReference: 'order-1',
    purchaserName: 'Sam',
    eventName: 'Eve Live Payment Proof',
    eventStartsAt: '2026-11-05T07:30:00.000Z',
    eventEndsAt: '2026-11-05T08:30:00.000Z',
    eventTimezone: 'Australia/Adelaide',
    venue: 'Online',
    description: null,
    orderStatus: 'CANCELLED',
    paymentStatus: 'REFUNDED',
    currency: 'AUD',
    totalCents: 100,
    paymentTotalCents: 100,
    platformFeeCents: 0,
    feeMode: null,
    feeLabel: null,
    refundedCents: 100,
    platformFeeRefundedCents: 0,
    paidAt: PAID_AT,
    refundedAt: REFUNDED_AT,
    attendees: [{ name: 'Sam', ticketToken: 'tok-a', sessionName: null }],
    bookingToken: 'book-1',
    branding: { name: 'Brainbase', logoUrl: null, accentColor: null, website: null, emailFooter: null, supportEmail: null, supportPhone: null },
    organisationName: 'Brainbase',
  }

  it('ORDER_REFUNDED: "$1.00 on 23 October 2026" for both paid and refunded, never 22 October', () => {
    const email = lifecycle.buildLifecycleEmail(base)
    for (const body of [email.html, email.text]) {
      expect(body).toContain('$1.00 on 23 October 2026')
      expect(body).toContain('$1.00 AUD on 23 October 2026')
      expect(body).not.toContain('22 October')
    }
  })

  it('EVENT_CANCELLED refund sentence uses the event timezone too', () => {
    const email = lifecycle.buildLifecycleEmail({ ...base, type: 'EVENT_CANCELLED' })
    expect(email.text).toContain('refunded on 23 October 2026')
    expect(email.text).not.toContain('22 October')
  })

  it('a Perth event dates the same instant 23 Oct only when it is 23 Oct in Perth', () => {
    // 21:37Z is 05:37 AWST on 23 Oct.
    expect(lifecycle.buildLifecycleEmail({ ...base, eventTimezone: 'Australia/Perth' }).text).toContain('on 23 October 2026')
    // 15:30Z is 23:30 AWST on 22 Oct but 02:00 ACDT on 23 Oct.
    const late = { ...base, paidAt: '2026-10-22T15:30:00Z', refundedAt: '2026-10-22T15:30:00Z' }
    expect(lifecycle.buildLifecycleEmail({ ...late, eventTimezone: 'Australia/Perth' }).text).toContain('on 22 October 2026')
    expect(lifecycle.buildLifecycleEmail({ ...late, eventTimezone: 'Australia/Adelaide' }).text).toContain('on 23 October 2026')
  })

  it('event "When" rendering is unchanged (already zone-aware)', () => {
    expect(lifecycle.buildLifecycleEmail(base).text).toContain('Thursday 5 November 2026 at 6:00 pm – Thursday 5 November 2026 at 7:00 pm')
  })

  it('no lifecycle template gains forbidden tax wording', () => {
    for (const type of ['ORDER_REFUNDED', 'EVENT_CANCELLED', 'ORDER_CANCELLED'] as const) {
      const email = lifecycle.buildLifecycleEmail({ ...base, type })
      for (const term of lifecycle.LIFECYCLE_EMAIL_FORBIDDEN_TERMS) expect(email.html + email.text, `${type}: ${term}`).not.toContain(term)
    }
  })
})
