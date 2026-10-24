import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 5B — lifecycle communications (order cancelled / order refunded /
// event cancelled / event reminder). Mocking strategy mirrors
// tests/containment/eventsTicketEmailDelivery.test.ts exactly: a queued
// `sql` mock for behavioural assertions (does the orchestration claim ->
// read -> send -> mark -> audit in order, does a duplicate transition
// dispatch nothing), static source-text containment for the exact SQL
// shape (idempotency key spelling, ON CONFLICT, NULL-free claim
// branches, reminder eligibility), and pure template assertions for the
// four emails. No real DB, no real email, no real provider is ever
// touched by this file; the real-Postgres half lives in
// scripts/tests/verify-events-lifecycle-notifications.sh and
// tests/containment/eventsResendWebhookDeliveryRealPostgres.test.ts.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((..._args: unknown[]) => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sqlMock(...args) }))
function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function callText(i: number): string { return ((sqlMock.mock.calls[i] as unknown[])[0] as TemplateStringsArray).join('') }
function callArgs(i: number): unknown[] { return (sqlMock.mock.calls[i] as unknown[]).slice(1) }
function allTexts(): string[] { return (sqlMock.mock.calls as unknown[][]).map(c => (c[0] as TemplateStringsArray).join('')) }

const sendEmailMock = vi.fn()
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmailMock(...args) }
})

const createRefundMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return { ...actual, createRefund: (...args: unknown[]) => createRefundMock(...args) }
})

beforeEach(() => {
  sqlMock.mockClear()
  queue()
  sendEmailMock.mockReset()
  createRefundMock.mockReset()
})

const notifications = await import('@/lib/events/notifications')
const delivery = await import('@/lib/events/notificationDelivery')
const recovery = await import('@/lib/events/notificationRecovery')
const lifecycle = await import('@/lib/events/lifecycleEmail')
const transitions = await import('@/lib/events/services/orderTransitions')
const branding = await import('@/lib/organisations/branding')
const validation = await import('@/lib/events/validation')

const NOTIFICATIONS_SRC = stripComments(readSource('lib/events/notifications.ts'))
const DELIVERY_SRC = stripComments(readSource('lib/events/notificationDelivery.ts'))
const RECOVERY_SRC = stripComments(readSource('lib/events/notificationRecovery.ts'))
const TRANSITIONS_SRC = stripComments(readSource('lib/events/services/orderTransitions.ts'))
const TEMPLATE_SRC = stripComments(readSource('lib/events/lifecycleEmail.ts'))
const TRACKING_SRC = stripComments(readSource('lib/events/ticketEmailDeliveryTracking.ts'))
const ROUTE_SRC = stripComments(readSource('app/api/events/[id]/route.ts'))
const CRON_SRC = stripComments(readSource('app/api/cron/ticket-email-recovery/route.ts'))
const TICKET_DELIVERY_SRC = stripComments(readSource('lib/events/ticketEmailDelivery.ts'))
const TICKET_RECOVERY_SRC = stripComments(readSource('lib/events/ticketEmailRecovery.ts'))
const AUDIT_SRC = stripComments(readSource('lib/events/auditLog.ts'))
const MIGRATION_SRC = readSource('scripts/create-events-notifications.sql')
const PRISMA_SRC = readSource('prisma/schema.prisma')
const EMAIL_SRC = stripComments(readSource('lib/email.ts'))

const BRANDING = {
  name: 'Riverside School', logoUrl: null, accentColor: '#123456', website: 'https://riverside.example',
  emailFooter: 'Thanks for supporting the school', supportEmail: 'office@riverside.example', supportPhone: '08 1234 5678',
}

function data(overrides: Partial<import('@/lib/events/lifecycleEmail').LifecycleEmailData> = {}): import('@/lib/events/lifecycleEmail').LifecycleEmailData {
  return {
    type: 'ORDER_CANCELLED',
    orderReference: 'order-1',
    purchaserName: 'Jane <Smith>',
    eventName: 'Spring Formal & Dinner',
    eventStartsAt: '2026-11-06T09:30:00.000Z',
    eventEndsAt: '2026-11-06T13:00:00.000Z',
    eventTimezone: 'Australia/Adelaide',
    venue: 'Riverside Hall',
    description: null,
    orderStatus: 'CANCELLED',
    paymentStatus: 'NOT_REQUIRED',
    currency: 'AUD',
    totalCents: 0,
    paymentTotalCents: 0,
    platformFeeCents: 0,
    feeMode: null,
    feeLabel: null,
    refundedCents: null,
    platformFeeRefundedCents: null,
    paidAt: null,
    refundedAt: null,
    attendees: [{ name: 'Jane Smith', ticketToken: 'tok-a', sessionName: null }, { name: 'Sam Smith', ticketToken: 'tok-b', sessionName: 'Evening' }],
    bookingToken: 'book-1',
    branding: BRANDING,
    organisationName: 'Riverside School Org',
    ...overrides,
  }
}

// ─── 1. Templates ────────────────────────────────────────────────────

describe('lifecycle templates — four neutral, factual emails with HTML + plain-text', () => {
  it('every type renders a subject, HTML and a non-empty plain-text alternative that carries the same facts', () => {
    for (const type of notifications.NOTIFICATION_TYPES) {
      const email = lifecycle.buildLifecycleEmail(data({ type, paymentStatus: type === 'ORDER_REFUNDED' ? 'REFUNDED' : 'NOT_REQUIRED', paymentTotalCents: 5000, refundedCents: 5000 }))
      expect(email.subject.length).toBeGreaterThan(0)
      expect(email.html).toMatch(/<!DOCTYPE html>/)
      expect(email.text.length).toBeGreaterThan(50)
      expect(email.text).toContain('Spring Formal & Dinner')
      expect(email.text).toContain('Order reference order-1')
      expect(email.html).toContain('Order reference order-1')
    }
  })

  it('escapes every purchaser/event/organiser string in the HTML (never raw <, >, &), while the text part keeps them verbatim', () => {
    const email = lifecycle.buildLifecycleEmail(data())
    expect(email.html).toContain('Jane &lt;Smith&gt;')
    expect(email.html).not.toContain('Jane <Smith>')
    expect(email.html).toContain('Spring Formal &amp; Dinner')
    expect(email.text).toContain('Jane <Smith>')
  })

  it('ORDER_CANCELLED for a free registration: says cancelled by the organiser, no payment taken, tickets no longer valid — never a refund word', () => {
    const email = lifecycle.buildLifecycleEmail(data({ paymentStatus: 'NOT_REQUIRED' }))
    expect(email.subject).toBe('Your order for Spring Formal & Dinner has been cancelled')
    expect(email.text).toMatch(/cancelled by the organiser/)
    expect(email.text).toMatch(/free registration, so no payment was taken/)
    expect(email.text).toMatch(/no longer valid and cannot be used for entry/)
    expect(email.text).not.toMatch(/refund/i)
    expect(email.text).toContain('2 tickets cancelled')
    expect(email.text).toContain('- Jane Smith')
    expect(email.text).toContain('- Sam Smith (Evening)')
  })

  it('ORDER_CANCELLED for a pending unpaid reservation (cancel -> EXPIRED): no payment/refund language, "nothing is owed"', () => {
    const email = lifecycle.buildLifecycleEmail(data({ paymentStatus: 'EXPIRED', orderStatus: 'CANCELLED', paymentTotalCents: 19800 }))
    expect(email.text).toMatch(/cancelled before payment was completed/)
    expect(email.text).toMatch(/No payment has been taken and nothing is owed/)
    expect(email.text).not.toMatch(/refund/i)
    expect(email.text).not.toMatch(/\$198\.00/)
  })

  it('ORDER_REFUNDED uses the committed snapshot only: amount paid, the pass-through booking fee refunded, total refunded with currency and dates — no settlement timing, never a tax invoice / credit note', () => {
    const email = lifecycle.buildLifecycleEmail(data({
      type: 'ORDER_REFUNDED', paymentStatus: 'REFUNDED', totalCents: 19800, paymentTotalCents: 20325, platformFeeCents: 525,
      feeMode: 'PASS_THROUGH', feeLabel: 'Booking fee', refundedCents: 20325, platformFeeRefundedCents: 525,
      paidAt: '2026-10-16T15:06:39.996Z', refundedAt: '2026-10-16T23:06:47.955Z',
    }))
    expect(email.subject).toBe('Your refund for Spring Formal & Dinner')
    expect(email.text).toMatch(/Amount paid: \$203\.25 on 1[67] October 2026/)
    expect(email.text).toMatch(/Booking fee: \$5\.25 refunded/)
    expect(email.text).toMatch(/Total refunded: \$203\.25 AUD on 1[67] October 2026/)
    expect(email.text).toMatch(/sent to the payment method you used/)
    expect(email.text).toMatch(/no longer valid/)
    expect(email.text).not.toMatch(/business days|within \d+ days|\d+–\d+ days/i)
    for (const term of lifecycle.LIFECYCLE_EMAIL_FORBIDDEN_TERMS) {
      expect(email.html).not.toContain(term)
      expect(email.text).not.toContain(term)
    }
  })

  it('ORDER_REFUNDED for a zero-fee order shows no booking-fee line and refunds exactly what was paid', () => {
    const email = lifecycle.buildLifecycleEmail(data({
      type: 'ORDER_REFUNDED', paymentStatus: 'REFUNDED', totalCents: 19800, paymentTotalCents: 19800, platformFeeCents: 0,
      feeMode: null, refundedCents: 19800, platformFeeRefundedCents: 0,
    }))
    expect(email.text).not.toMatch(/Booking fee/)
    expect(email.text).toMatch(/Total refunded: \$198\.00 AUD/)
    expect(email.text).toMatch(/Amount paid: \$198\.00/)
  })

  it('EVENT_CANCELLED states the ACTUAL refund state of the order and never promises a refund', () => {
    const base = { type: 'EVENT_CANCELLED' as const, totalCents: 19800, paymentTotalCents: 19800 }
    const paid = lifecycle.buildLifecycleEmail(data({ ...base, orderStatus: 'CONFIRMED', paymentStatus: 'PAID' }))
    expect(paid.subject).toBe('Spring Formal & Dinner has been cancelled')
    expect(paid.text).toMatch(/Riverside School has cancelled Spring Formal & Dinner/)
    expect(paid.text).toMatch(/You paid \$198\.00 for this order\. No refund has been processed for it yet — please contact the organiser/)
    expect(paid.text).not.toMatch(/will be refunded|you will receive a refund|refund is on its way/i)
    const refunded = lifecycle.buildLifecycleEmail(data({ ...base, orderStatus: 'CANCELLED', paymentStatus: 'REFUNDED', refundedCents: 19800, refundedAt: '2026-10-16T23:06:47.955Z' }))
    expect(refunded.text).toMatch(/Your payment of \$198\.00 was refunded on 1[67] October 2026/)
    const free = lifecycle.buildLifecycleEmail(data({ ...base, paymentStatus: 'NOT_REQUIRED', totalCents: 0, paymentTotalCents: 0 }))
    expect(free.text).toMatch(/free registration, so no payment was taken/)
    const pending = lifecycle.buildLifecycleEmail(data({ ...base, orderStatus: 'PENDING', paymentStatus: 'PENDING' }))
    expect(pending.text).toMatch(/still awaiting payment\. No payment has been taken/)
    expect(pending.text).toContain('Session: Evening')
  })

  it('EVENT_REMINDER: event name, date/time in the event timezone, venue, ticket count, wallet link, organiser contact, stored description (truncated); per-ticket links only when there is no booking token', () => {
    const email = lifecycle.buildLifecycleEmail(data({ type: 'EVENT_REMINDER', orderStatus: 'CONFIRMED', description: 'Doors open 6pm. '.repeat(100) }))
    expect(email.subject).toMatch(/^Reminder: Spring Formal & Dinner — Friday,? 6 November 2026/)
    expect(email.text).toMatch(/When: Friday,? 6 November 2026,? (at )?8:00 pm – Friday,? 6 November 2026,? (at )?11:30 pm/)
    expect(email.text).toContain('Where: Riverside Hall')
    expect(email.text).toContain('Tickets: 2 tickets')
    expect(email.text).toMatch(/View all tickets: .*\/b\/book-1\/tickets/)
    expect(email.text).not.toMatch(/\/t\/tok-a/)
    expect(email.text).toMatch(/Contact Riverside School — office@riverside\.example · 08 1234 5678 · https:\/\/riverside\.example/)
    expect(email.text).toMatch(/Doors open 6pm\. .*…/)
    expect(email.text.length).toBeLessThan(1600)
    const noWallet = lifecycle.buildLifecycleEmail(data({ type: 'EVENT_REMINDER', bookingToken: null }))
    expect(noWallet.text).toMatch(/View ticket — Jane Smith: .*\/t\/tok-a/)
    expect(noWallet.text).toMatch(/View ticket — Sam Smith: .*\/t\/tok-b/)
  })

  it('organiser contact falls back to the organisation record name when no branding name is configured, and renders no contact line details when nothing is configured', () => {
    const email = lifecycle.buildLifecycleEmail(data({ branding: { name: null, logoUrl: null, accentColor: null, website: null, emailFooter: null, supportEmail: null, supportPhone: null } }))
    expect(email.text).toMatch(/Contact Riverside School Org\.\n/)
    expect(email.html).not.toMatch(/mailto:|noreply@/)
  })

  it('the templates hardcode no product name — BrainBase/Eve appear nowhere in lifecycleEmail.ts (the shared emailLayout shell is inherited unchanged, as the ticket email inherits it)', () => {
    expect(TEMPLATE_SRC).not.toMatch(/BrainBase|Brainbase|\bEve\b/)
    expect(TEMPLATE_SRC).not.toMatch(/process\.env/)
  })
})

// ─── 2. Branding projection ──────────────────────────────────────────

describe('normaliseLifecycleEmailBranding — ticket-email fields plus the configured support contact, never address/abn/sender name', () => {
  it('projects email/phone as supportEmail/supportPhone and keeps the ticket-email allow-list', () => {
    const b = branding.normaliseLifecycleEmailBranding({ branding: { name: 'X', email: 'help@x.example', phone: '123', address: '1 Road', abn: '11', emailSenderName: 'Sender', website: 'https://x.example', emailFooter: 'bye' } }, 'Org X')
    expect(b).toEqual({ name: 'X', logoUrl: null, accentColor: null, website: 'https://x.example', emailFooter: 'bye', supportEmail: 'help@x.example', supportPhone: '123' })
    expect(Object.keys(b)).not.toContain('address')
    expect(Object.keys(b)).not.toContain('abn')
    expect(Object.keys(b)).not.toContain('emailSenderName')
  })
  it('an organisation with no branding yields an all-null projection, never a platform fallback address', () => {
    const b = branding.normaliseLifecycleEmailBranding(null, 'Org X')
    expect(b).toEqual({ name: null, logoUrl: null, accentColor: null, website: null, emailFooter: null, supportEmail: null, supportPhone: null })
  })
  it('the ticket-email projection is unchanged (still five fields, no contact)', () => {
    expect(Object.keys(branding.normaliseTicketEmailBranding(null, 'Org X')).sort()).toEqual(['accentColor', 'emailFooter', 'logoUrl', 'name', 'website'])
  })
})

// ─── 3. sendEmail plain-text support ─────────────────────────────────

describe('lib/email.ts — optional plain-text alternative (additive)', () => {
  it('forwards `text` to Resend only when supplied; the HTML-only call shape is byte-identical to before', async () => {
    // The real sendEmail (vi.importActual bypasses this file's mock) with a
    // stubbed fetch — no network, no module reset, so every other test
    // keeps the single mocked @/lib/email instance.
    const { sendEmail: realSendEmail } = await vi.importActual<typeof import('@/lib/email')>('@/lib/email')
    const previous = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await realSendEmail({ to: 'a@example.com', subject: 'S', html: '<p>H</p>', text: 'H' })
      await realSendEmail({ to: 'a@example.com', subject: 'S', html: '<p>H</p>' })
    } finally {
      vi.unstubAllGlobals()
      if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous
    }
    const first = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    const second = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)
    expect(first.text).toBe('H')
    expect(Object.keys(second).sort()).toEqual(['from', 'html', 'subject', 'to'])
    expect(EMAIL_SRC).toMatch(/\.\.\.\(text \? \{ text \} : \{\}\)/)
  })
})

// ─── 4. Idempotency key + scheduling SQL (static) ─────────────────────

describe('idempotency key — one deterministic spelling, pinned everywhere it is inlined in SQL', () => {
  it('buildNotificationIdempotencyKey is event-notification:<TYPE>:<orderId>, from ids only', () => {
    expect(notifications.buildNotificationIdempotencyKey('ORDER_CANCELLED', 'order-1')).toBe('event-notification:ORDER_CANCELLED:order-1')
    expect(notifications.NOTIFICATION_IDEMPOTENCY_PREFIX).toBe('event-notification:')
    expect(NOTIFICATIONS_SRC).not.toMatch(/Date\.now|randomUUID|claim_id|attempt_count\s*\|\|/)
  })

  it('every inline SQL spelling matches the function: ORDER_CANCELLED ×2 and ORDER_REFUNDED ×1 in orderTransitions, EVENT_CANCELLED and EVENT_REMINDER ×2 (insert + NOT EXISTS guard) in notifications.ts', () => {
    const cancelled = TRANSITIONS_SRC.match(/'event-notification:ORDER_CANCELLED:' \|\| id/g) ?? []
    const refunded = TRANSITIONS_SRC.match(/'event-notification:ORDER_REFUNDED:' \|\| id/g) ?? []
    expect(cancelled).toHaveLength(2)
    expect(refunded).toHaveLength(1)
    expect(NOTIFICATIONS_SRC.match(/'event-notification:EVENT_CANCELLED:' \|\| eo\.id/g) ?? []).toHaveLength(1)
    expect(NOTIFICATIONS_SRC.match(/'event-notification:EVENT_REMINDER:' \|\| eo\.id/g) ?? []).toHaveLength(2)
    // EVENT_UPDATED appends the committed change version: <orderId>:<version>.
    expect(NOTIFICATIONS_SRC.match(/'event-notification:EVENT_UPDATED:' \|\| eo\.id \|\| ':' \|\| \$\{version\}::text/g) ?? []).toHaveLength(1)
    expect(notifications.buildEventUpdatedIdempotencyKey('o1', '123')).toBe('event-notification:EVENT_UPDATED:o1:123')
    // No other prefix spelling exists anywhere these keys are built.
    for (const src of [TRANSITIONS_SRC, NOTIFICATIONS_SRC, DELIVERY_SRC, RECOVERY_SRC]) {
      const spellings = src.match(/'event-notification[^']*'/g) ?? []
      for (const s of spellings) expect(s).toMatch(/^'event-notification:(ORDER_CANCELLED|ORDER_REFUNDED|EVENT_CANCELLED|EVENT_REMINDER|EVENT_UPDATED):'$|^'event-notification:'$/)
    }
  })

  it('every scheduling INSERT is ON CONFLICT (idempotency_key) DO NOTHING — never ON CONFLICT DO UPDATE, never a plain INSERT', () => {
    const inserts = [TRANSITIONS_SRC, NOTIFICATIONS_SRC].join('\n').match(/INSERT INTO event_notifications[\s\S]*?RETURNING/g) ?? []
    expect(inserts).toHaveLength(6)
    for (const ins of inserts) {
      expect(ins).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/)
      expect(ins).not.toMatch(/DO UPDATE/)
      expect(ins).toMatch(/purchaser_email IS NOT NULL AND btrim\(.*purchaser_email\) <> ''/)
    }
  })
})

describe('order transitions — scheduling is derived from the transition UPDATE\'s own RETURNING, in the same statement', () => {
  it('cancelOrder: both conditional UPDATEs are wrapped as `updated` CTEs feeding an ORDER_CANCELLED INSERT, and the final SELECT keeps the order row visible with a nullable notification_id', () => {
    const cancelFn = TRANSITIONS_SRC.slice(TRANSITIONS_SRC.indexOf('export async function cancelOrder('))
    const ctes = cancelFn.match(/WITH updated AS \(\s*UPDATE event_orders[\s\S]*?RETURNING id, organisation_id, event_id, purchaser_email\s*\),\s*scheduled AS \(\s*INSERT INTO event_notifications[\s\S]*?FROM updated[\s\S]*?\)\s*SELECT updated\.id, scheduled\.id AS notification_id FROM updated LEFT JOIN scheduled ON TRUE/g) ?? []
    expect(ctes).toHaveLength(2)
    expect(ctes[0]).toMatch(/payment_status = 'EXPIRED'/)
    expect(ctes[1]).not.toMatch(/EXPIRED/)
    expect(ctes[1]).toMatch(/status = 'CONFIRMED' AND payment_status = 'NOT_REQUIRED'/)
  })
  it('refundPaidOrder: the REFUNDED UPDATE feeds an ORDER_REFUNDED INSERT the same way, still gated on payment_status = \'PAID\' and still written only after Stripe confirmed', () => {
    const refundFn = TRANSITIONS_SRC.slice(TRANSITIONS_SRC.indexOf('export async function refundPaidOrder('), TRANSITIONS_SRC.indexOf('export async function cancelOrder('))
    expect(refundFn).toMatch(/WITH updated AS \(\s*UPDATE event_orders\s*SET payment_status = 'REFUNDED'[\s\S]*?AND payment_status = 'PAID'\s*RETURNING id, organisation_id, event_id, purchaser_email\s*\),\s*scheduled AS \(\s*INSERT INTO event_notifications[\s\S]*?'ORDER_REFUNDED'/)
    expect(refundFn.indexOf('createRefund(')).toBeLessThan(refundFn.indexOf('WITH updated AS'))
  })
  it('the inline dispatch happens only for a notification_id the statement itself returned, after the existing audit entry', () => {
    const cancelFn = TRANSITIONS_SRC.slice(TRANSITIONS_SRC.indexOf('export async function cancelOrder('))
    expect(cancelFn).toMatch(/await logCancelled\([\s\S]*?const cancelNotificationId = \(updated\[0\] as \{ notification_id\?: string \| null \}\)\.notification_id \?\? null;\s*if \(cancelNotificationId\) \{\s*await dispatchScheduledOrderNotification\(/)
    const refundFn = TRANSITIONS_SRC.slice(TRANSITIONS_SRC.indexOf('export async function refundPaidOrder('), TRANSITIONS_SRC.indexOf('export async function cancelOrder('))
    expect(refundFn).toMatch(/await logRefunded\([\s\S]*?const refundNotificationId = [\s\S]*?if \(refundNotificationId\) \{\s*await dispatchScheduledOrderNotification\(/)
  })
})

describe('order transitions — behaviour (queued sql mock; the dispatch helper is observed through its own sql calls)', () => {
  const FREE = { id: 'order-1', status: 'CONFIRMED', payment_status: 'NOT_REQUIRED' }
  const actor = { organisationId: 'org-a', userId: 'staff-1', eventId: 'event-1', orderId: 'order-1' }

  it('a free-order cancel whose statement scheduled a row: exactly one notification_scheduled audit entry and one claim attempt follow the existing cancelled audit entry', async () => {
    queue([{ id: 'event-1' }], [FREE], [{ id: 'order-1', notification_id: 'notif-1' }], [], [], [])
    const res = await transitions.cancelOrder(actor)
    expect(res).toEqual({ ok: true, alreadyResolved: false })
    const texts = allTexts()
    expect(texts[2]).toMatch(/INSERT INTO event_notifications/)
    expect(texts[3]).toMatch(/INSERT INTO audit_logs/)
    expect(callArgs(3)).toContain('event_order.cancelled')
    expect(texts[4]).toMatch(/INSERT INTO audit_logs/)
    expect(callArgs(4)).toContain('event_order.notification_scheduled')
    expect(JSON.parse(callArgs(4)[7] as string)).toEqual({ source: 'order_cancelled', notification_type: 'ORDER_CANCELLED', notification_id: 'notif-1' })
    expect(texts[5]).toMatch(/UPDATE event_notifications\s*SET\s*status = 'sending'/)
    expect(sendEmailMock).not.toHaveBeenCalled() // claim returned no row (queue exhausted) -> not_claimed, nothing sent
  })

  it('a repeat cancel (UPDATE matches zero rows) schedules nothing, dispatches nothing, sends nothing', async () => {
    queue([{ id: 'event-1' }], [FREE], [])
    const res = await transitions.cancelOrder(actor)
    expect(res).toEqual({ ok: true, alreadyResolved: true })
    expect(sqlMock).toHaveBeenCalledTimes(3)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('a cancel whose INSERT hit ON CONFLICT (notification_id null) still cancels and audits, but never re-dispatches the existing notification', async () => {
    queue([{ id: 'event-1' }], [FREE], [{ id: 'order-1', notification_id: null }])
    const res = await transitions.cancelOrder(actor)
    expect(res).toEqual({ ok: true, alreadyResolved: false })
    expect(allTexts().filter(t => /INSERT INTO audit_logs/.test(t))).toHaveLength(1)
    expect(allTexts().some(t => /UPDATE event_notifications/.test(t))).toBe(false)
  })

  it('a refund whose statement scheduled a row dispatches exactly once; Stripe is still called first and the DB written only after it confirmed', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_1', platform_fee_cents: 0 }], [{ id: 'order-1', notification_id: 'notif-2' }], [], [], [])
    createRefundMock.mockResolvedValue({ ok: true, refundedCents: 19800 })
    const res = await transitions.refundPaidOrder(actor)
    expect(res).toEqual({ ok: true, alreadyResolved: false })
    expect(createRefundMock).toHaveBeenCalledTimes(1)
    expect(callArgs(4)).toContain('event_order.notification_scheduled')
    expect(JSON.stringify(callArgs(4))).toContain('ORDER_REFUNDED')
    expect(callText(5)).toMatch(/UPDATE event_notifications/)
  })

  it('a refused Stripe refund writes nothing — no UPDATE, no notification, no dispatch', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_1', platform_fee_cents: 0 }])
    createRefundMock.mockResolvedValue({ ok: false, error: 'declined' })
    const res = await transitions.refundPaidOrder(actor)
    expect(res).toEqual({ ok: false, code: 'STRIPE_REFUND_FAILED', error: 'declined' })
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })
})

// ─── 5. Event cancellation + reminders scheduling (static + behaviour) ──

describe('scheduleEventCancelledNotifications — bulk, idempotent, audited in the same statement', () => {
  it('selects only affected orders (confirmed free/paid, pending payment, already refunded), re-checks e.status = CANCELLED in SQL, and chains the audit INSERT from RETURNING', () => {
    const fn = NOTIFICATIONS_SRC.slice(NOTIFICATIONS_SRC.indexOf('export async function scheduleEventCancelledNotifications'), NOTIFICATIONS_SRC.indexOf('export async function scheduleEventReminderNotifications'))
    expect(fn).toMatch(/AND e\.status = 'CANCELLED'/)
    expect(fn).toMatch(/\(eo\.status = 'CONFIRMED' AND eo\.payment_status IN \('NOT_REQUIRED', 'PAID'\)\)\s*OR eo\.payment_status = 'PENDING'\s*OR eo\.payment_status = 'REFUNDED'/)
    expect(fn).toMatch(/audited AS \(\s*INSERT INTO audit_logs[\s\S]*?'event_order\.notification_scheduled'[\s\S]*?FROM scheduled/)
    expect(fn).toMatch(/'source', 'event_cancelled'/)
    expect(fn).toMatch(/left\(recipient_email, 1\) \|\| '\*\*\*' \|\| substring\(recipient_email from '@\.\*\$'\)/)
    expect(fn).not.toMatch(/'recipient_email', recipient_email|'recipient', recipient_email/)
    expect(fn).not.toMatch(/UPDATE event_orders|refund|createRefund/)
  })
  it('returns only the ids this call inserted', async () => {
    queue([{ id: 'n1' }, { id: 'n2' }])
    const ids = await notifications.scheduleEventCancelledNotifications({ organisationId: 'org-a', eventId: 'event-1', actorUserId: 'staff-1' })
    expect(ids).toEqual(['n1', 'n2'])
    expect(callArgs(0)).toEqual(expect.arrayContaining(['event-1', 'org-a', 'staff-1']))
  })
})

describe('reminders — opt-in, windowed, one per confirmed order, closed out when no longer applicable', () => {
  it('REMINDER_LEAD_HOURS is 24 and the scheduling query requires reminder_enabled = true, PUBLISHED, starts_at in (now, now+24h], CONFIRMED free/paid orders, and a NOT EXISTS guard on the same key', () => {
    expect(notifications.REMINDER_LEAD_HOURS).toBe(24)
    const fn = NOTIFICATIONS_SRC.slice(NOTIFICATIONS_SRC.indexOf('export async function scheduleEventReminderNotifications'), NOTIFICATIONS_SRC.indexOf('export async function expireIneligibleReminderNotifications'))
    expect(fn).toMatch(/e\.reminder_enabled = true/)
    expect(fn).toMatch(/e\.status = 'PUBLISHED'/)
    expect(fn).toMatch(/e\.starts_at > NOW\(\)\s*AND e\.starts_at <= NOW\(\) \+ make_interval\(hours => \$\{REMINDER_LEAD_HOURS\}\)/)
    expect(fn).toMatch(/eo\.status = 'CONFIRMED' AND eo\.payment_status IN \('NOT_REQUIRED', 'PAID'\)/)
    expect(fn).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM event_notifications n\s*WHERE n\.idempotency_key = 'event-notification:EVENT_REMINDER:' \|\| eo\.id/)
    expect(fn).toMatch(/LIMIT \$\{limit\}/)
    expect(fn).toMatch(/'source', 'scheduled_job:event_reminder'/)
  })
  it('no organisation-level, platform-level or environment switch exists for reminders — only events.reminder_enabled', () => {
    for (const src of [NOTIFICATIONS_SRC, DELIVERY_SRC, RECOVERY_SRC, ROUTE_SRC]) {
      expect(src).not.toMatch(/process\.env\.[A-Z_]*REMIND/)
      expect(src).not.toMatch(/REMINDERS?_ENABLED|reminders_enabled/)
    }
    expect(MIGRATION_SRC).toMatch(/ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false/)
    expect(PRISMA_SRC).toMatch(/reminder_enabled Boolean\s+@default\(false\)/)
  })
  it('expireIneligibleReminderNotifications only ever closes EVENT_REMINDER rows that are pending or retryable-failed — never a live lease, never another type, never an already-terminal row', () => {
    const fn = NOTIFICATIONS_SRC.slice(NOTIFICATIONS_SRC.indexOf('export async function expireIneligibleReminderNotifications'))
    expect(fn).toMatch(/n\.notification_type = 'EVENT_REMINDER'/)
    expect(fn).toMatch(/\(n\.status = 'pending' OR \(n\.status = 'failed' AND n\.next_attempt_at IS NOT NULL\)\)/)
    expect(fn).not.toMatch(/'sending'/)
    expect(fn).toMatch(/SET status = 'failed', next_attempt_at = NULL, failed_at = NOW\(\)/)
  })
  it('the claim re-checks a reminder\'s live eligibility (event PUBLISHED + reminder_enabled + not started, order CONFIRMED free/paid) while the three historical-fact types are claimable regardless', () => {
    const claim = DELIVERY_SRC.slice(DELIVERY_SRC.indexOf('export async function claimNotificationDelivery'), DELIVERY_SRC.indexOf('export type ClaimedNotificationForDelivery'))
    expect(claim).toMatch(/notification_type <> 'EVENT_REMINDER'\s*OR EXISTS \([\s\S]*?e\.status = 'PUBLISHED' AND e\.reminder_enabled = true AND e\.starts_at > NOW\(\)/)
  })
})

// ─── 6. Delivery state machine (static + behaviour) ───────────────────

describe('notification delivery — the ticket-email lease machine, one retry policy, never touching ticket_email_*', () => {
  it('imports LEASE_TIMEOUT_MINUTES / MAX_ATTEMPTS / RETRY_BACKOFF_MINUTES from ticketEmailDelivery.ts rather than redefining them', () => {
    expect(DELIVERY_SRC).toMatch(/import \{ LEASE_TIMEOUT_MINUTES, MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES, type TicketEmailFailureReason \} from '\.\/ticketEmailDelivery'/)
    expect(DELIVERY_SRC).not.toMatch(/const (LEASE_TIMEOUT_MINUTES|MAX_ATTEMPTS|RETRY_BACKOFF_MINUTES)\s*=/)
    expect(DELIVERY_SRC).not.toMatch(/ticket_email_/)
    expect(RECOVERY_SRC).not.toMatch(/ticket_email_/)
  })
  it('the claim is one conditional UPDATE ... RETURNING with NULL-free branches, gated on scheduled_for <= NOW(); completion writes are guarded on status = sending AND the exact claim id', () => {
    const claim = DELIVERY_SRC.slice(DELIVERY_SRC.indexOf('export async function claimNotificationDelivery'), DELIVERY_SRC.indexOf('export type ClaimedNotificationForDelivery'))
    expect(claim).toMatch(/AND scheduled_for <= NOW\(\)/)
    expect(claim).toMatch(/status = 'pending'\s*OR \(\s*status = 'failed'\s*AND attempt_count < \$\{MAX_ATTEMPTS\}\s*AND next_attempt_at <= NOW\(\)\s*\)\s*OR \(\s*status = 'sending'\s*AND claimed_at < NOW\(\) - make_interval\(mins => \$\{LEASE_TIMEOUT_MINUTES\}\)\s*AND attempt_count < \$\{MAX_ATTEMPTS\}\s*\)/)
    expect(claim).not.toMatch(/status IS NULL|IS NULL OR next_attempt_at/)
    expect(claim).toMatch(/SELECT 1|RETURNING id, claim_id, attempt_count, notification_type/)
    for (const fn of ['markNotificationSent', 'markNotificationFailed']) {
      const body = DELIVERY_SRC.slice(DELIVERY_SRC.indexOf(`export async function ${fn}`))
      expect(body.slice(0, body.indexOf('RETURNING id'))).toMatch(/AND status = 'sending'\s*AND claim_id = \$\{claimId\}/)
    }
    const failed = DELIVERY_SRC.slice(DELIVERY_SRC.indexOf('export async function markNotificationFailed'), DELIVERY_SRC.indexOf('export async function sweepStaleExhaustedNotificationLeases'))
    expect(failed).toMatch(/WHEN \$\{forceTerminal\} THEN NULL\s*WHEN attempt_count >= \$\{MAX_ATTEMPTS\} THEN NULL\s*WHEN attempt_count = 1 THEN NOW\(\) \+ make_interval\(mins => \$\{RETRY_BACKOFF_MINUTES\[1\]\}\)\s*WHEN attempt_count = 2 THEN NOW\(\) \+ make_interval\(mins => \$\{RETRY_BACKOFF_MINUTES\[2\]\}\)/)
  })
  it('the trusted read re-asserts status = sending AND the claim id, and is the only place purchaser data is read', () => {
    const read = DELIVERY_SRC.slice(DELIVERY_SRC.indexOf('export async function readClaimedNotificationForDelivery'), DELIVERY_SRC.indexOf('export async function markNotificationSent'))
    expect(read).toMatch(/WHERE n\.id = \$\{notificationId\} AND n\.status = 'sending' AND n\.claim_id = \$\{claimId\}/)
    expect(read).toMatch(/JOIN organisations o ON o\.id = n\.organisation_id/)
  })

  const CLAIM = { id: 'notif-1', claim_id: 'claim-1', attempt_count: 1, notification_type: 'ORDER_CANCELLED' }
  const READ = {
    id: 'notif-1', organisation_id: 'org-a', notification_type: 'ORDER_CANCELLED', recipient_email: 'jane@example.com', idempotency_key: 'event-notification:ORDER_CANCELLED:order-1',
    order_id: 'order-1', purchaser_name: 'Jane', order_status: 'CANCELLED', payment_status: 'NOT_REQUIRED', currency: 'AUD', total_cents: 0, platform_fee_cents: 0, fee_mode: null, fee_label: null,
    payment_total_cents: null, paid_at: null, refunded_cents: null, platform_fee_refunded_cents: null, refunded_at: null, booking_token: null,
    event_name: 'Spring Formal', starts_at: '2026-11-06T09:30:00.000Z', ends_at: '2026-11-06T13:00:00.000Z', timezone: 'Australia/Adelaide', venue: null, description: null,
    organisation_name: 'Riverside', organisation_settings: { branding: { email: 'office@riverside.example' } },
    attendees: [{ name: 'Jane', ticket_token: 'tok-a', session_name: null }],
  }

  it('happy path: claim -> read -> sendEmail(html + text, Idempotency-Key = the row\'s own key) -> markSent(provider id) -> notification_sent audit', async () => {
    queue([CLAIM], [READ], [{ id: 'notif-1' }], [])
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'msg-1' })
    const outcome = await delivery.attemptNotificationDelivery('notif-1')
    expect(outcome).toEqual({ outcome: 'sent', providerMessageId: 'msg-1' })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0] as { to: string; subject: string; html: string; text: string; idempotencyKey: string }
    expect(call.to).toBe('jane@example.com')
    expect(call.idempotencyKey).toBe('event-notification:ORDER_CANCELLED:order-1')
    expect(call.text).toContain('Registration cancelled')
    expect(call.html).toContain('office@riverside.example')
    // callText joins the template strings only (bound values vanish), so
    // the placeholders read as empty here.
    expect(callText(2)).toMatch(/status = 'sent'[\s\S]*provider_message_id = COALESCE\(::text, provider_message_id\)[\s\S]*delivery_status = CASE WHEN ::text IS NOT NULL THEN 'accepted'/)
    expect(DELIVERY_SRC).toMatch(/provider_message_id = COALESCE\(\$\{providerMessageId\}::text, provider_message_id\)/)
    expect(callArgs(2)).toContain('msg-1')
    expect(callArgs(3)).toContain('event_order.notification_sent')
    const after = JSON.parse(callArgs(3)[7] as string)
    expect(after).toEqual({ source: 'automatic', notification_type: 'ORDER_CANCELLED', notification_id: 'notif-1', attempt_count: 1, provider_message_id: 'msg-1', recipient_masked: 'j***@example.com' })
  })

  it('not claimable (zero rows): not_claimed, nothing read, nothing sent', async () => {
    queue([])
    expect(await delivery.attemptNotificationDelivery('notif-1')).toEqual({ outcome: 'not_claimed' })
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('provider rejection -> retryable failed; not_configured -> retryable failed; payload mismatch -> terminal; ambiguous network outcome -> retryable; MAX_ATTEMPTS -> terminal', async () => {
    const { EmailSendError } = await import('@/lib/email')
    queue([CLAIM], [READ], [{ id: 'notif-1' }], [])
    sendEmailMock.mockRejectedValue(new EmailSendError(422, 'validation_error'))
    expect(await delivery.attemptNotificationDelivery('notif-1')).toEqual({ outcome: 'failed', reason: 'provider_rejected', terminal: false })
    expect(callArgs(3)).toContain('event_order.notification_failed')

    queue([CLAIM], [READ], [{ id: 'notif-1' }], [])
    sendEmailMock.mockResolvedValue({ status: 'not_configured', id: null })
    expect(await delivery.attemptNotificationDelivery('notif-1')).toEqual({ outcome: 'failed', reason: 'not_configured', terminal: false })

    queue([CLAIM], [READ], [{ id: 'notif-1' }], [])
    sendEmailMock.mockRejectedValue(new EmailSendError(400, 'invalid_idempotent_request'))
    expect(await delivery.attemptNotificationDelivery('notif-1')).toEqual({ outcome: 'failed', reason: 'idempotency_payload_mismatch', terminal: true })

    queue([CLAIM], [READ], [{ id: 'notif-1' }], [])
    sendEmailMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await delivery.attemptNotificationDelivery('notif-1')).toEqual({ outcome: 'failed', reason: 'ambiguous_outcome', terminal: false })

    queue([{ ...CLAIM, attempt_count: 3 }], [READ], [{ id: 'notif-1' }], [])
    sendEmailMock.mockRejectedValue(new EmailSendError(500, null))
    expect(await delivery.attemptNotificationDelivery('notif-1')).toEqual({ outcome: 'failed', reason: 'provider_rejected', terminal: true })
  })

  it('never throws: an unexpected error after the claim releases the lease as a retryable ambiguous failure', async () => {
    queue([CLAIM])
    sqlMock.mockImplementationOnce(() => Promise.resolve([CLAIM])).mockImplementationOnce(() => Promise.reject(new Error('db down')))
    const outcome = await delivery.attemptNotificationDelivery('notif-1')
    expect(outcome).toEqual({ outcome: 'failed', reason: 'ambiguous_outcome', terminal: false })
  })

  it('a replayed delivery attempt presents the SAME idempotency key to the provider — the key is read from the row, never rebuilt from anything attempt-specific', async () => {
    for (let i = 0; i < 2; i++) {
      queue([{ ...CLAIM, claim_id: `claim-${i}`, attempt_count: i + 1 }], [READ], [{ id: 'notif-1' }], [])
      sendEmailMock.mockResolvedValue({ status: 'sent', id: 'msg-same' })
      await delivery.attemptNotificationDelivery('notif-1')
    }
    const keys = sendEmailMock.mock.calls.map(c => (c[0] as { idempotencyKey: string }).idempotencyKey)
    expect(keys).toEqual(['event-notification:ORDER_CANCELLED:order-1', 'event-notification:ORDER_CANCELLED:order-1'])
    expect(DELIVERY_SRC).not.toMatch(/buildNotificationIdempotencyKey|idempotencyKey: `/)
  })
})

// ─── 7. Recovery run ──────────────────────────────────────────────────

describe('notification recovery — same cron, bounded, time-budgeted, reminder scheduling inside the run', () => {
  it('candidate discovery is id-only, NULL-free and gated on scheduled_for', () => {
    const fn = RECOVERY_SRC.slice(RECOVERY_SRC.indexOf('export async function findNotificationRecoveryCandidateIds'), RECOVERY_SRC.indexOf('export type NotificationRecoverySummary'))
    expect(fn).toMatch(/SELECT id FROM event_notifications\s*WHERE scheduled_for <= NOW\(\)/)
    expect(fn).not.toMatch(/IS NULL(?! OR)|recipient_email|purchaser|claim_id,/)
    expect(fn).toMatch(/LIMIT \$\{limit\}/)
  })
  it('runs sweep -> expire reminders -> schedule reminders -> candidates -> sequential attempts, tallies outcomes, and defers the rest once the time budget is spent', async () => {
    vi.resetModules()
    const attempt = vi.fn()
    vi.doMock('@/lib/events/notificationDelivery', () => ({ attemptNotificationDelivery: (id: string) => attempt(id), sweepStaleExhaustedNotificationLeases: vi.fn().mockResolvedValue(2) }))
    vi.doMock('@/lib/events/notifications', () => ({ scheduleEventReminderNotifications: vi.fn().mockResolvedValue(['r1', 'r2', 'r3']), expireIneligibleReminderNotifications: vi.fn().mockResolvedValue(1), expireIneligibleEventUpdatedNotifications: vi.fn().mockResolvedValue(0) }))
    const mod = await import('@/lib/events/notificationRecovery')
    queue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    attempt
      .mockResolvedValueOnce({ outcome: 'sent', providerMessageId: 'm' })
      .mockResolvedValueOnce({ outcome: 'failed', reason: 'provider_rejected', terminal: false })
      .mockResolvedValueOnce({ outcome: 'not_claimed' })
    // now() advances 20s per call: start=20k, checks at 40k/60k/80k elapsed
    // 20k/40k/60k (allowed), then 100k -> 80k elapsed exceeds the 60s budget
    // before the 4th candidate, which is deferred to the next run.
    let t = 0
    const now = () => { t += 20_000; return t }
    const summary = await mod.runNotificationRecovery(now)
    expect(summary).toMatchObject({ considered: 4, claimed: 2, sent: 1, retryable_failed: 1, terminal_failed: 0, not_claimed: 1, stale_exhausted_swept: 2, reminders_scheduled: 3, reminders_expired: 1, deferred_time_budget: 1 })
    expect(attempt).toHaveBeenCalledTimes(3)
    vi.doUnmock('@/lib/events/notificationDelivery')
    vi.doUnmock('@/lib/events/notifications')
    vi.resetModules()
  })
  it('constants: batch 50, time budget 60s; the cron route calls runNotificationRecovery after runTicketEmailRecovery and nests its summary', () => {
    expect(recovery.NOTIFICATION_RECOVERY_BATCH_SIZE).toBe(50)
    expect(recovery.NOTIFICATION_RECOVERY_TIME_BUDGET_MS).toBe(60_000)
    expect(CRON_SRC.indexOf('await runTicketEmailRecovery()')).toBeLessThan(CRON_SRC.indexOf('await runNotificationRecovery()'))
    expect(CRON_SRC).toMatch(/NextResponse\.json\(\{ \.\.\.summary, notifications \}\)/)
    // Notifications share the ticket-email-recovery cron (no second cron for them). The exact
    // cron set is pinned; registration-answer-retention is its own daily job (ADR 0013 §4b).
    const crons = (JSON.parse(readSource('vercel.json')) as { crons: { path: string }[] }).crons.map(c => c.path).sort()
    expect(crons).toEqual(['/api/cron/hr-employee-document-reminders', '/api/cron/registration-answer-retention', '/api/cron/sync', '/api/cron/ticket-email-recovery'])
  })
})

// ─── 8. Event PATCH route ─────────────────────────────────────────────

describe('event PATCH route — cancellation transition, reminder opt-in', () => {
  it('schedules EVENT_CANCELLED only on a non-cancelled -> CANCELLED transition, after the event.cancelled audit, inline-sends at most EVENT_CANCELLED_INLINE_SEND_LIMIT, and never touches orders/refunds', () => {
    expect(notifications.EVENT_CANCELLED_INLINE_SEND_LIMIT).toBe(10)
    expect(ROUTE_SRC).toMatch(/const becameCancelled = existing\.status !== 'CANCELLED' && updated\.status === 'CANCELLED';/)
    expect(ROUTE_SRC).toMatch(/else if \(becameCancelled\) await logEventCancelled\(auditParams\);/)
    expect(ROUTE_SRC.indexOf('logEventCancelled(auditParams)')).toBeLessThan(ROUTE_SRC.indexOf('scheduleEventCancelledNotifications({'))
    expect(ROUTE_SRC).toMatch(/if \(becameCancelled\) \{\s*try \{\s*const scheduledIds = await scheduleEventCancelledNotifications\(\{\s*organisationId: session\.organisationId, eventId: id, actorUserId: session\.userId,/)
    expect(ROUTE_SRC).toMatch(/scheduledIds\.slice\(0, EVENT_CANCELLED_INLINE_SEND_LIMIT\)/)
    expect(ROUTE_SRC).not.toMatch(/UPDATE event_orders|createRefund|refundPaidOrder|cancelOrder/)
  })
  it('reminder_enabled is merged by presence, validated as a boolean, and written as a real boolean', () => {
    expect(ROUTE_SRC).toMatch(/reminder_enabled: mergeField\(body, 'reminder_enabled', existing\.reminder_enabled === true\)/)
    expect(ROUTE_SRC).toMatch(/const reminderEnabled = merged\.reminder_enabled === true;/)
    expect(ROUTE_SRC).toMatch(/reminder_enabled = \$\{reminderEnabled\}/)
    const { validateEventInput } = validation
    const base = { name: 'X', slug: 'x', timezone: 'Australia/Adelaide', starts_at: '2026-11-06T09:30:00.000Z', ends_at: '2026-11-06T13:00:00.000Z' }
    expect(validateEventInput({ ...base })).toBeNull()
    expect(validateEventInput({ ...base, reminder_enabled: true })).toBeNull()
    expect(validateEventInput({ ...base, reminder_enabled: 'yes' })).toBe('reminder_enabled must be true or false.')
  })
})

// ─── 9. Audit + migration + schema containment ────────────────────────

describe('audit — namespaced actions, system actor, no bodies/tokens', () => {
  it('declares the new actions and logEventCancelled', () => {
    for (const a of ['event_order.notification_scheduled', 'event_order.notification_sent', 'event_order.notification_failed', 'event.cancelled']) {
      expect(AUDIT_SRC).toContain(`'${a}'`)
    }
    for (const a of ['notification_delivered', 'notification_bounced', 'notification_suppressed', 'notification_complained', 'notification_delivery_failed']) {
      expect(TRACKING_SRC).toContain(`'event_order.${a}'`)
    }
  })
  it('notification audit after_state never carries html/text/subject/tokens/raw recipient', () => {
    const block = AUDIT_SRC.slice(AUDIT_SRC.indexOf('export async function logNotificationScheduled'), AUDIT_SRC.indexOf('export async function logEventCreated'))
    expect(block).not.toMatch(/html|subject|text:|ticket_token|booking_token|recipient_email|recipientEmail/)
    expect(block).toMatch(/recipient_masked: params\.recipientMasked/)
  })
})

describe('migration + Prisma mirror', () => {
  it('scripts/create-events-notifications.sql: one new table with the 4-type CHECK, UNIQUE idempotency_key, two organisation-scoped composite FKs, partial unique provider index, reminder_enabled default false, documented rollback, no DROP/DELETE/UPDATE of existing objects', () => {
    const body = MIGRATION_SRC.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
    expect(body).toMatch(/CREATE TABLE IF NOT EXISTS event_notifications/)
    expect(body).toMatch(/CHECK \(notification_type IN \('ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER'\)\)/)
    expect(body).toMatch(/CONSTRAINT event_notifications_idempotency_key_key UNIQUE \(idempotency_key\)/)
    expect(body).toMatch(/FOREIGN KEY \(event_id, organisation_id\)\s*REFERENCES events \(id, organisation_id\) ON DELETE CASCADE/)
    expect(body).toMatch(/FOREIGN KEY \(order_id, organisation_id\)\s*REFERENCES event_orders \(id, organisation_id\) ON DELETE CASCADE/)
    expect(body).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_event_notifications_provider_message_id\s*ON event_notifications \(provider_message_id\) WHERE provider_message_id IS NOT NULL/)
    expect(body).toMatch(/ALTER TABLE events\s*ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false/)
    // Statement-initial keywords only — the FK clauses legitimately say
    // ON DELETE CASCADE.
    expect(body).not.toMatch(/^\s*(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/m)
    expect(MIGRATION_SRC).toMatch(/ROLLBACK[\s\S]*DROP TABLE IF EXISTS event_notifications[\s\S]*ALTER TABLE events DROP COLUMN IF EXISTS reminder_enabled/)
    expect((body.match(/;\s*$/gm) ?? []).length).toBe(6) // table + 4 indexes + ALTER events
  })
  it('prisma/schema.prisma mirrors the table and the column', () => {
    expect(PRISMA_SRC).toMatch(/model EventNotification \{[\s\S]*@@map\("event_notifications"\)/)
    expect(PRISMA_SRC).toMatch(/idempotency_key\s+String\s+@unique/)
    expect(PRISMA_SRC).toMatch(/notifications\s+EventNotification\[\]/)
  })
})

// ─── 10. Regression containment for the existing ticket-email path ────

describe('existing ticket-email delivery is untouched', () => {
  it('ticketEmailDelivery.ts and ticketEmailRecovery.ts reference nothing from this phase', () => {
    for (const src of [TICKET_DELIVERY_SRC, TICKET_RECOVERY_SRC]) {
      expect(src).not.toMatch(/event_notifications|notification|lifecycleEmail|reminder/i)
    }
  })
  it('the Resend webhook route itself is unchanged — the widening lives entirely inside applyResendDeliveryWebhookEvent\'s single statement', () => {
    const route = stripComments(readSource('app/api/public/events/webhooks/resend/route.ts'))
    expect(route).not.toMatch(/notification/i)
    expect((TRACKING_SRC.match(/await sql`/g) ?? []).length).toBe(2) // recordTicketEmailDeliveryAccepted + the one widened statement
  })
  it('no purchaser email is sent from any webhook or from the cancel/refund routes themselves — sends happen only through attemptNotificationDelivery', () => {
    for (const f of ['app/api/public/events/webhooks/stripe/route.ts', 'app/api/public/events/webhooks/resend/route.ts', 'lib/events/stripe.ts', 'app/api/events/[id]/orders/[orderId]/cancel/route.ts', 'app/api/events/[id]/orders/[orderId]/refund/route.ts']) {
      expect(stripComments(readSource(f)), f).not.toMatch(/sendEmail|attemptNotificationDelivery|buildLifecycleEmail/)
    }
  })
  it('checkout.session.expired (purchaser abandoned checkout) deliberately schedules no ORDER_CANCELLED — only a staff cancel does', () => {
    expect(stripComments(readSource('lib/events/stripe.ts'))).not.toMatch(/event_notifications/)
  })
})
