import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Events Phase 5A — commercial fee + GST/invoice FOUNDATION (BrainBase
// default remains zero-fee). Mocked-SQL suite: proves the migration's
// shape, the integer-cents fee arithmetic in both modes, the immutable
// order snapshot, the Stripe application-fee wiring (sent only from the
// snapshot and only when positive), Retry's reuse of the snapshot, the
// full-refund fee reversal, the quote/public-detail contracts, the
// neutral payment summary, and — above all — that an organisation with
// NO fee policy row produces exactly the pre-Phase-5A checkout, Stripe
// session, retry and refund. Real behaviour that needs constraints
// (snapshot coherence CHECK, one-policy-per-scope indexes, FK scoping,
// byte-identical existing rows, rollback order) is proven against real
// PostgreSQL by scripts/tests/verify-events-ticketing-fees.sh.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function stripSqlLineComments(sql: string): string {
  return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')
}
function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }))
}

type Resolver = (text: string, args: unknown[]) => unknown[] | undefined
let resolver: Resolver = () => undefined
const sqlMock = vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => Promise.resolve(resolver(strings.join(' '), args) ?? []))
let transactionFinalResult: unknown[] = []
const transactionMock = vi.fn(async (queries: unknown[]) => [...queries.slice(1).map(() => []), transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})
const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
vi.mock('@/lib/events/publicResolve', () => ({
  resolvePublicEvent: vi.fn(async () => ({ ok: true, organisationId: 'org-a', organisationName: 'Org A', event: EVENT, branding: { accentColor: null } })),
}))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => true }))
vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: vi.fn(async () => ({ eligible: true, accountId: 'acct_org_a' })),
}))
vi.mock('@/lib/events/registrationQuestions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/registrationQuestions')>()
  return { ...actual, listActiveQuestions: vi.fn(async () => []), writeRegistrationResponses: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivity: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/events/ticketEmailDelivery', () => ({ attemptAutomaticTicketEmail: vi.fn().mockResolvedValue({ outcome: 'not_claimed' }) }))
const createCheckoutSessionMock = vi.fn()
const createRefundMock = vi.fn()
const retrieveExistingCheckoutAttemptMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
    createRefund: (...args: unknown[]) => createRefundMock(...args),
    retrieveExistingCheckoutAttempt: (...args: unknown[]) => retrieveExistingCheckoutAttemptMock(...args),
    expireCheckoutSession: vi.fn().mockResolvedValue(undefined),
    RESERVATION_WINDOW_SECONDS: 1860,
  }
})
// The real Stripe SDK is never reached: the `stripe` package is replaced
// by a recording stub so lib/events/stripe.ts's REAL createCheckoutSession
// / createRefund can be exercised below (via vi.importActual).
const stripeSessionsCreateMock = vi.fn(async () => ({ id: 'cs_test_real', url: 'https://checkout.stripe.test/real' }))
const stripeRefundsCreateMock = vi.fn(async () => ({ id: 're_test', amount: 20325 }))
vi.mock('stripe', () => ({
  default: class StripeStub {
    checkout = { sessions: { create: (...args: unknown[]) => stripeSessionsCreateMock(...(args as [])) } }
    refunds = { create: (...args: unknown[]) => stripeRefundsCreateMock(...(args as [])) }
  },
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }))

function callText(index: number): string {
  return ((sqlMock.mock.calls[index] as unknown as unknown[])[0] as TemplateStringsArray).join(' ')
}
function callArgs(index: number): unknown[] {
  return (sqlMock.mock.calls[index] as unknown as unknown[]).slice(1)
}
function allTexts(): string[] {
  return sqlMock.mock.calls.map((_, i) => callText(i))
}
function findCall(pattern: RegExp): number {
  return sqlMock.mock.calls.findIndex((_, i) => pattern.test(callText(i)))
}
function sessionAs(role: string, organisationId = 'org-a', userId = 'staff-1') { return { userId, organisationId, role } }

const fees = await import('@/lib/events/feeCalculation')
const { computePlatformFeeCents, computeOrderFinancials, feeSnapshotReconciles, assertFeePolicyInputs, PLATFORM_DEFAULT_FEE_POLICY, FEE_MODES, FEE_TAX_TREATMENTS } = fees
const feeService = await import('@/lib/events/services/fees')
const { normaliseFeePolicyRow, publicFeeDisclosure, buildFeeLineItem, FEE_POLICY_RESOLUTION_SQL } = feeService
const { buildCheckoutLineItems, assertCheckoutLineItemsTotal, computeDiscount } = await import('@/lib/events/services/promotions')
const { loadCartTicketTypes } = await import('@/lib/events/services/cart')
const { startPaidCheckout } = await import('@/lib/events/services/paidCheckout')
const { registerFreeOrder } = await import('@/lib/events/services/freeRegistration')
const { retryPendingOrderCheckout } = await import('@/lib/events/services/retryCheckout')
const { refundPaidOrder } = await import('@/lib/events/services/orderTransitions')
const { getPublicEventDetail } = await import('@/lib/events/publicEventDetail')
const receipt = await import('@/lib/events/receipt')
const { buildPaymentReceipt, renderPaymentReceiptHtml, receiptFromOrderRow, RECEIPT_FORBIDDEN_TERMS } = receipt
const { buildTicketEmail } = await import('@/lib/events/ticketEmail')
const realStripe = await vi.importActual<typeof import('@/lib/events/stripe')>('@/lib/events/stripe')
const quoteRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route')
const statusRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route')

const SLUG_CTX = { params: Promise.resolve({ organisationSlug: 'org-a', eventSlug: 'gala' }) }
const QUOTE_URL = 'http://localhost/api/public/events/org-a/gala/quote'

// The brief's own cart: 2 × Adult $40 + 2 × Child $20 + 1 × VIP $100 =
// $220 gross, −$22 (10%) = $198 net. Synthetic fee: 2.5 % + $0.30 per
// order -> 495 + 30 = 525 cents.
const POLICY_ROW = {
  id: 'fee-1', organisation_id: 'org-a', event_id: null, enabled: true, fee_mode: 'PASS_THROUGH',
  percent_bps: 250, fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null,
  currency: 'AUD', label: 'Booking fee', tax_treatment: 'UNSPECIFIED', version: 3,
}
const ABSORB_ROW = { ...POLICY_ROW, id: 'fee-2', fee_mode: 'ABSORB', event_id: 'event-1', version: 1 }
const tt = (id: string, name: string, price: number, extra: Record<string, unknown> = {}) =>
  ({ id, active: true, price_cents: price, currency: 'AUD', name, sale_started: true, sale_ended: false, requires_access_code: false, ...extra })
const ADULT = tt('tt-adult', 'Adult', 4000)
const CHILD = tt('tt-child', 'Child', 2000)
const VIP = tt('tt-vip', 'VIP', 10000)
const FREE_TT = tt('tt-free', 'Free', 0)
const withPolicy = (rows: Record<string, unknown>[], policy: unknown) => rows.map(r => ({ ...r, fee_policy: policy }))
const ITEMS = [{ ticket_type_id: 'tt-adult', quantity: 2 }, { ticket_type_id: 'tt-child', quantity: 2 }, { ticket_type_id: 'tt-vip', quantity: 1 }]
const PROMO_ROW = { id: 'promo-1', code: 'EARLY20', discount_type: 'PERCENT', discount_value: 10, min_cart_cents: null, max_redemptions: 50, ticket_type_ids: null }
function attendeesFor(items: { ticket_type_id: string; quantity: number }[]) {
  return items.flatMap(it => Array.from({ length: it.quantity }, (_, i) => ({ name: `${it.ticket_type_id}-${i}`, email: null, responses: [], ticket_type_id: it.ticket_type_id })))
}
function validatedFor(items: { ticket_type_id: string; quantity: number }[], extra: Partial<{ promotion_code: string | null; access_code: string | null; event_session_id: string | null }> = {}) {
  return {
    items, event_session_id: null, quantity: items.reduce((s, it) => s + it.quantity, 0),
    purchaser_name: 'Pat', purchaser_email: 'pat@example.com', purchaser_phone: null,
    attendees: attendeesFor(items), order_responses: [], promotion_code: null, access_code: null, ...extra,
  }
}
function ttRowsResolver(rows: unknown[]): Resolver {
  return text => (/FROM event_ticket_types\s*\n\s*WHERE organisation_id = .* AND event_id = .* AND id = ANY/.test(text) ? rows : undefined)
}
function combine(...rs: Resolver[]): Resolver {
  return (text, args) => { for (const r of rs) { const out = r(text, args); if (out !== undefined) return out }; return undefined }
}
const promoResolver: Resolver = text => (/FROM event_promotion_codes pc\s*\n\s*WHERE pc\.organisation_id = .* AND pc\.event_id = .* AND pc\.code = /.test(text) ? [PROMO_ROW] : undefined)
const stampResolver: Resolver = text => (/AS expires_at_stamp FROM event_orders WHERE id = /.test(text) ? [{ expires_at_stamp: '1760000000000000' }] : undefined)
const writeBackResolver: Resolver = text => (/UPDATE event_orders SET stripe_checkout_session_id = /.test(text) ? [{ id: 'order-1' }] : undefined)
const URLS = async () => ({ successUrl: 'https://x/success', cancelUrl: 'https://x/cancel' })
type SessionInput = { lineItems: { name: string; unitAmountCents: number; quantity: number; description?: string }[]; applicationFeeCents?: number; connectedAccountId: string }
function sessionInput(): SessionInput { return createCheckoutSessionMock.mock.calls[0][0] as SessionInput }
function orderInsertArgs(): unknown[] { return callArgs(findCall(/INSERT INTO event_orders/)) }

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  createCheckoutSessionMock.mockReset()
  createRefundMock.mockReset()
  retrieveExistingCheckoutAttemptMock.mockReset()
  stripeSessionsCreateMock.mockClear()
  stripeRefundsCreateMock.mockClear()
  requireSessionMock.mockReset()
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  resolver = () => undefined
  transactionFinalResult = []
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.test/1' })
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_for_unit_tests'
})

// ─── MIGRATION ─────────────────────────────────────────────────────────

describe('scripts/create-events-ticketing-fees-foundation.sql — additive, idempotent, organisation-scoped', () => {
  const raw = read('scripts/create-events-ticketing-fees-foundation.sql')
  const live = stripSqlLineComments(raw)

  it('creates exactly one new table (ticketing_fee_policies), idempotently, with both scope indexes partial-unique', () => {
    expect(live.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(1)
    expect(live).toMatch(/CREATE TABLE IF NOT EXISTS ticketing_fee_policies/)
    expect(live).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ticketing_fee_policies_org_default\s*\n\s*ON ticketing_fee_policies\(organisation_id\) WHERE event_id IS NULL/)
    expect(live).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ticketing_fee_policies_org_event\s*\n\s*ON ticketing_fee_policies\(organisation_id, event_id\) WHERE event_id IS NOT NULL/)
    expect(live).toMatch(/CONSTRAINT ticketing_fee_policies_event_org_fkey FOREIGN KEY \(event_id, organisation_id\)\s*\n\s*REFERENCES events \(id, organisation_id\) ON DELETE CASCADE/)
  })

  it('the policy row is database-constrained: mode vocabulary, 0..10000 bps, non-negative fixed/min/max, max >= min, tax-treatment vocabulary, version >= 1, enabled DEFAULT false', () => {
    expect(live).toMatch(/enabled\s+BOOLEAN\s+NOT NULL DEFAULT false/)
    expect(live).toMatch(/CHECK \(fee_mode IN \('PASS_THROUGH', 'ABSORB'\)\)/)
    expect(live).toMatch(/CHECK \(percent_bps BETWEEN 0 AND 10000\)/)
    expect(live).toMatch(/CHECK \(fixed_per_order_cents >= 0\)/)
    expect(live).toMatch(/CHECK \(fixed_per_ticket_cents >= 0\)/)
    expect(live).toMatch(/CHECK \(min_fee_cents IS NULL OR max_fee_cents IS NULL OR max_fee_cents >= min_fee_cents\)/)
    expect(live).toMatch(/CHECK \(tax_treatment IN \('UNSPECIFIED', 'GST_INCLUSIVE', 'GST_EXCLUSIVE', 'GST_FREE'\)\)/)
    expect(live).toMatch(/CHECK \(version >= 1\)/)
  })

  it('event_orders gains the fee snapshot with IF NOT EXISTS and defaults that keep every existing row valid (fee 0, everything else NULL); total_cents is never altered', () => {
    expect(live).toMatch(/ADD COLUMN IF NOT EXISTS platform_fee_cents\s+INTEGER NOT NULL DEFAULT 0/)
    for (const col of ['fee_mode', 'payment_total_cents', 'fee_policy_id', 'fee_policy_version', 'fee_percent_bps', 'fee_fixed_per_order_cents', 'fee_fixed_per_ticket_cents', 'fee_min_cents', 'fee_max_cents', 'fee_tax_treatment', 'fee_label', 'refunded_cents', 'platform_fee_refunded_cents']) {
      expect(live).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\s+(INTEGER|TEXT),?`))
    }
    expect(live).not.toMatch(/ALTER COLUMN|DROP COLUMN|UPDATE event_orders|DELETE FROM|INSERT INTO|::uuid/)
    expect(live).not.toMatch(/(?<![_a-z])total_cents\s+INTEGER/)
  })

  it('event_orders_fee_snapshot_check enforces the by-mode arithmetic (no fee: 0 and NULLs; PASS_THROUGH: payment = ticket + fee; ABSORB: payment = ticket and fee <= ticket) and the policy FK is the organisation-scoped composite, NO ACTION', () => {
    expect(live).toMatch(/\(fee_mode IS NULL AND platform_fee_cents = 0 AND fee_policy_id IS NULL\s*\n\s*AND \(payment_total_cents IS NULL OR payment_total_cents = total_cents\)\)/)
    expect(live).toMatch(/\(fee_mode = 'PASS_THROUGH' AND fee_policy_id IS NOT NULL AND fee_policy_version IS NOT NULL\s*\n\s*AND payment_total_cents = total_cents \+ platform_fee_cents\)/)
    expect(live).toMatch(/\(fee_mode = 'ABSORB' AND fee_policy_id IS NOT NULL AND fee_policy_version IS NOT NULL\s*\n\s*AND payment_total_cents = total_cents AND platform_fee_cents <= total_cents\)/)
    expect(live).toMatch(/FOREIGN KEY \(fee_policy_id, organisation_id\)\s*\n\s*REFERENCES ticketing_fee_policies \(id, organisation_id\);/)
    expect(live).not.toMatch(/fee_policy_fkey[\s\S]*ON DELETE (CASCADE|SET NULL|RESTRICT)/)
    expect(live).toMatch(/platform_fee_refunded_cents <= platform_fee_cents/)
  })

  it('every ADD CONSTRAINT is inside a pg_constraint-guarded DO block (idempotent re-run); documents manual-only, not-Production, and a dependents-first rollback', () => {
    const adds = live.match(/ADD CONSTRAINT event_orders_\w+/g) ?? []
    expect(adds.length).toBe(7)
    for (const add of adds) {
      const name = add.replace('ADD CONSTRAINT ', '')
      expect(live).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${name}'\\)`))
    }
    expect(raw).toMatch(/Run once, manually/)
    expect(raw).toMatch(/NOT executed against Production by this phase/)
    expect(raw).toMatch(/Rollback \(manual; dependents first\)/)
    expect(raw).toMatch(/DROP CONSTRAINT IF EXISTS event_orders_fee_policy_fkey[\s\S]*DROP TABLE IF EXISTS ticketing_fee_policies/)
  })

  it('prisma/schema.prisma mirrors the table, the organisation/event relations and every order column', () => {
    const prisma = read('prisma/schema.prisma')
    expect(prisma).toMatch(/model TicketingFeePolicy \{[\s\S]*@@map\("ticketing_fee_policies"\)/)
    expect(prisma).toMatch(/fee_policy\s+TicketingFeePolicy\? @relation\(fields: \[fee_policy_id, organisation_id\], references: \[id, organisation_id\], onDelete: NoAction\)/)
    expect(prisma).toMatch(/ticketing_fee_policies TicketingFeePolicy\[\]/)
    expect(prisma).toMatch(/fee_policies\s+TicketingFeePolicy\[\]/)
    for (const col of ['platform_fee_cents', 'fee_mode', 'payment_total_cents', 'fee_policy_id', 'fee_policy_version', 'fee_percent_bps', 'fee_fixed_per_order_cents', 'fee_fixed_per_ticket_cents', 'fee_min_cents', 'fee_max_cents', 'fee_tax_treatment', 'fee_label', 'refunded_cents', 'platform_fee_refunded_cents']) {
      expect(prisma).toMatch(new RegExp(`\\n\\s+${col}\\s+(Int|String)`))
    }
  })

  it('every real-Postgres harness that runs the live services applies the new migration (the cart query now reads ticketing_fee_policies)', () => {
    expect(read('scripts/tests/verify-events-ticketing-fees.sh')).toMatch(/create-events-ticketing-fees-foundation\.sql/)
    expect(read('tests/containment/eventsExpiryCasPrecisionRealPostgres.test.ts')).toMatch(/'scripts\/create-events-ticketing-fees-foundation\.sql'/)
  })
})

// ─── FEE ARITHMETIC ────────────────────────────────────────────────────

const PASS = { fee_mode: 'PASS_THROUGH' as const, percent_bps: 250, fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null }
const ABSORB = { ...PASS, fee_mode: 'ABSORB' as const }

describe('computePlatformFeeCents / computeOrderFinancials — integer cents, one half-up rounding, both modes, clamps', () => {
  it("the brief's cart: $220 gross − $22 promotion = $198 net; 2.5% + $0.30 -> fee 525; PASS_THROUGH customer pays 20325, ABSORB customer pays 19800; platform receives 525 either way", () => {
    expect(computePlatformFeeCents(19800, 5, PASS)).toBe(525)
    expect(computeOrderFinancials(19800, 5, PASS)).toEqual({ ok: true, result: { fee_mode: 'PASS_THROUGH', net_ticket_cents: 19800, platform_fee_cents: 525, payment_total_cents: 20325, application_fee_cents: 525 } })
    expect(computeOrderFinancials(19800, 5, ABSORB)).toEqual({ ok: true, result: { fee_mode: 'ABSORB', net_ticket_cents: 19800, platform_fee_cents: 525, payment_total_cents: 19800, application_fee_cents: 525 } })
  })

  it('the platform default (no policy) is zero fee: payment total = net, application fee 0, mode null — BrainBase today', () => {
    expect(PLATFORM_DEFAULT_FEE_POLICY).toEqual({ enabled: false })
    expect(Object.isFrozen(PLATFORM_DEFAULT_FEE_POLICY)).toBe(true)
    expect(computeOrderFinancials(19800, 5, null)).toEqual({ ok: true, result: { fee_mode: null, net_ticket_cents: 19800, platform_fee_cents: 0, payment_total_cents: 19800, application_fee_cents: 0 } })
  })

  it('percentage component rounds half-up exactly once; fixed components are exact; per-ticket multiplies by the ticket count', () => {
    expect(computePlatformFeeCents(19801, 1, { ...PASS, fixed_per_order_cents: 0 })).toBe(495) // 495.025 -> 495
    expect(computePlatformFeeCents(19900, 1, { ...PASS, percent_bps: 125, fixed_per_order_cents: 0 })).toBe(249) // 248.75 -> 249
    expect(computePlatformFeeCents(10000, 1, { ...PASS, percent_bps: 5, fixed_per_order_cents: 0 })).toBe(5) // 5.0
    expect(computePlatformFeeCents(10001, 1, { ...PASS, percent_bps: 5, fixed_per_order_cents: 0 })).toBe(5) // 5.0005 -> 5
    expect(computePlatformFeeCents(5000, 3, { ...PASS, percent_bps: 0, fixed_per_order_cents: 100, fixed_per_ticket_cents: 50 })).toBe(250)
  })

  it('min/max clamp after the sum; max below min is rejected; a very small order still gets its fixed fee; a zero-percent zero-fixed policy yields 0', () => {
    expect(computePlatformFeeCents(100, 1, { ...PASS, min_fee_cents: 200 })).toBe(200)
    expect(computePlatformFeeCents(100000, 1, { ...PASS, max_fee_cents: 1000 })).toBe(1000)
    expect(computePlatformFeeCents(50, 1, { ...PASS, percent_bps: 0 })).toBe(30)
    expect(computePlatformFeeCents(50, 1, { ...PASS, percent_bps: 0, fixed_per_order_cents: 0 })).toBe(0)
    expect(() => assertFeePolicyInputs({ ...PASS, min_fee_cents: 500, max_fee_cents: 100 })).toThrow(/max_fee_cents/)
    expect(() => assertFeePolicyInputs({ ...PASS, percent_bps: 10001 })).toThrow(/percent_bps/)
    expect(() => assertFeePolicyInputs({ ...PASS, fixed_per_order_cents: -1 })).toThrow(/fixed_per_order_cents/)
    expect(() => assertFeePolicyInputs({ ...PASS, fee_mode: 'SPLIT' as unknown as 'ABSORB' })).toThrow(/fee_mode/)
  })

  it('ABSORB fails closed (never caps) when the fee would exceed the amount charged; PASS_THROUGH never can', () => {
    expect(computeOrderFinancials(100, 1, { ...ABSORB, fixed_per_order_cents: 150 })).toEqual({ ok: false, code: 'FEE_EXCEEDS_TOTAL' })
    expect(computeOrderFinancials(100, 1, { ...PASS, fixed_per_order_cents: 150 })).toMatchObject({ ok: true, result: { payment_total_cents: 253, application_fee_cents: 153 } }) // 150 + 2.5% of 100 (2.5 -> 3)
    expect(computeOrderFinancials(100, 1, { ...ABSORB, percent_bps: 10000, fixed_per_order_cents: 0 })).toMatchObject({ ok: true, result: { platform_fee_cents: 100, payment_total_cents: 100 } })
  })

  it('discount then fee: the fee is computed on the NET subtotal (percentage discount + percentage fee; fixed discount + fixed fee); a 100% discount never reaches the fee because the promotion itself is rejected', () => {
    const lines = [{ ticket_type_id: 'tt-adult', unit_price_cents: 4000, quantity: 2 }, { ticket_type_id: 'tt-child', unit_price_cents: 2000, quantity: 2 }, { ticket_type_id: 'tt-vip', unit_price_cents: 10000, quantity: 1 }]
    const pct = computeDiscount(lines, { id: 'p', code: 'EARLY20', discount_type: 'PERCENT', discount_value: 10, min_cart_cents: null, max_redemptions: null, ticket_type_ids: [] }, 'AUD')
    expect(pct.ok && computePlatformFeeCents(pct.totalCents, 5, { ...PASS, fixed_per_order_cents: 0 })).toBe(495) // 2.5% of 19800, not of 22000 (550)
    const fixed = computeDiscount(lines, { id: 'p', code: 'TENOFF', discount_type: 'FIXED', discount_value: 1000, min_cart_cents: null, max_redemptions: null, ticket_type_ids: [] }, 'AUD')
    expect(fixed.ok && computeOrderFinancials(fixed.totalCents, 5, { ...PASS, percent_bps: 0, fixed_per_order_cents: 200 })).toMatchObject({ ok: true, result: { net_ticket_cents: 21000, platform_fee_cents: 200, payment_total_cents: 21200 } })
    const full = computeDiscount(lines, { id: 'p', code: 'FREE', discount_type: 'PERCENT', discount_value: 100, min_cart_cents: null, max_redemptions: null, ticket_type_ids: [] }, 'AUD')
    expect(full).toEqual({ ok: false, code: 'PROMOTION_TOTAL_TOO_LOW' })
  })

  it('1,000 random policies/carts: integers only, PASS_THROUGH payment = net + fee, ABSORB payment = net, application fee = fee, fee within [min, max]', () => {
    let seed = 20261017
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 1000; i++) {
      const net = 50 + rnd(500000)
      const count = 1 + rnd(20)
      const min = rnd(3) === 0 ? rnd(500) : null
      const max = rnd(3) === 0 ? (min ?? 0) + rnd(5000) : null
      const policy = { fee_mode: (rnd(2) ? 'PASS_THROUGH' : 'ABSORB') as 'PASS_THROUGH' | 'ABSORB', percent_bps: rnd(1001), fixed_per_order_cents: rnd(300), fixed_per_ticket_cents: rnd(100), min_fee_cents: min, max_fee_cents: max }
      const fee = computePlatformFeeCents(net, count, policy)
      expect(Number.isSafeInteger(fee) && fee >= 0).toBe(true)
      if (min !== null) expect(fee).toBeGreaterThanOrEqual(min)
      if (max !== null) expect(fee).toBeLessThanOrEqual(max)
      const r = computeOrderFinancials(net, count, policy)
      if (policy.fee_mode === 'PASS_THROUGH') expect(r).toMatchObject({ ok: true, result: { payment_total_cents: net + fee, application_fee_cents: fee } })
      else if (fee <= net) expect(r).toMatchObject({ ok: true, result: { payment_total_cents: net, application_fee_cents: fee } })
      else expect(r).toEqual({ ok: false, code: 'FEE_EXCEEDS_TOTAL' })
    }
  })

  it('feeSnapshotReconciles is the JS twin of event_orders_fee_snapshot_check', () => {
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 0, fee_mode: null, payment_total_cents: null })).toBe(true)
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 19800 })).toBe(true)
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 5, fee_mode: null, payment_total_cents: 19800 })).toBe(false)
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: 20325 })).toBe(true)
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: 19800 })).toBe(false)
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 525, fee_mode: 'ABSORB', payment_total_cents: 19800 })).toBe(true)
    expect(feeSnapshotReconciles({ total_cents: 100, platform_fee_cents: 525, fee_mode: 'ABSORB', payment_total_cents: 100 })).toBe(false)
    expect(feeSnapshotReconciles({ total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: null })).toBe(false)
  })

  it('lib/events/feeCalculation.ts is pure and client-safe (no imports at all — never lib/db, never server-only); no floating-point money (no toFixed/parseFloat/division into a stored value)', () => {
    const src = stripComments(read('lib/events/feeCalculation.ts'))
    expect(src).not.toMatch(/^\s*import /m)
    expect(src).not.toMatch(/toFixed|parseFloat|Number\.parseFloat|\* 1\.|\/ 100\b/)
    expect(FEE_MODES).toEqual(['PASS_THROUGH', 'ABSORB'])
    expect(FEE_TAX_TREATMENTS).toEqual(['UNSPECIFIED', 'GST_INCLUSIVE', 'GST_EXCLUSIVE', 'GST_FREE'])
  })
})

// ─── POLICY RESOLUTION ─────────────────────────────────────────────────

describe('fee policy resolution — event row > organisation row > platform default; disabled rows win their scope; malformed rows fail closed', () => {
  it('normaliseFeePolicyRow: null -> platform default (no fee); a disabled row -> no fee but names its scope; an enabled row -> coerced, validated policy', () => {
    expect(normaliseFeePolicyRow(null)).toEqual({ policy: null, source: 'PLATFORM_DEFAULT' })
    expect(normaliseFeePolicyRow({ ...POLICY_ROW, enabled: false })).toEqual({ policy: null, source: 'ORGANISATION' })
    expect(normaliseFeePolicyRow({ ...ABSORB_ROW, enabled: false })).toEqual({ policy: null, source: 'EVENT' })
    expect(normaliseFeePolicyRow(POLICY_ROW)).toEqual({
      policy: { id: 'fee-1', version: 3, fee_mode: 'PASS_THROUGH', percent_bps: 250, fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null, currency: 'AUD', label: 'Booking fee', tax_treatment: 'UNSPECIFIED' },
      source: 'ORGANISATION',
    })
    expect(() => normaliseFeePolicyRow({ ...POLICY_ROW, fee_mode: 'SPLIT' })).toThrow(/fee_mode/)
    expect(() => normaliseFeePolicyRow({ ...POLICY_ROW, percent_bps: 12.5 })).toThrow(/percent_bps/)
    expect(() => normaliseFeePolicyRow({ ...POLICY_ROW, tax_treatment: 'VAT' })).toThrow(/tax_treatment/)
    expect(() => normaliseFeePolicyRow('nonsense')).toThrow()
  })

  it('the resolution subquery prefers the event row (ORDER BY event_id IS NOT NULL DESC LIMIT 1) and is byte-identical in the cart load and the standalone resolver', () => {
    expect(FEE_POLICY_RESOLUTION_SQL).toContain("(p.event_id = ${eventId} OR p.event_id IS NULL) ORDER BY (p.event_id IS NOT NULL) DESC LIMIT 1")
    const cart = read('lib/events/services/cart.ts')
    const svc = read('lib/events/services/fees.ts')
    expect(cart).toContain(`${FEE_POLICY_RESOLUTION_SQL} AS fee_policy`)
    expect(svc).toContain(`${FEE_POLICY_RESOLUTION_SQL} AS fee_policy`)
    expect(svc.split(FEE_POLICY_RESOLUTION_SQL).length - 1).toBe(2) // the constant + the live query
  })

  it('no environment variable, product flag or default row can enable a fee: the only sources are ticketing_fee_policies rows; BrainBase organiser routes never write that table', () => {
    for (const file of ['lib/events/services/fees.ts', 'lib/events/feeCalculation.ts', 'lib/events/services/paidCheckout.ts', 'lib/events/services/cart.ts']) {
      const src = stripComments(read(file))
      expect(src).not.toMatch(/process\.env/)
      expect(src).not.toMatch(/Eve\b/i)
    }
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])
    const writers = walk(path.join(process.cwd(), 'app/api')).filter(f => /\.ts$/.test(f) && /INSERT INTO ticketing_fee_policies|UPDATE ticketing_fee_policies/.test(fs.readFileSync(f, 'utf8')))
    expect(writers).toEqual([])
  })

  it('publicFeeDisclosure exposes only a PASS_THROUGH fee (label + inputs) — never ABSORB, never id/version/tax metadata', () => {
    const pass = normaliseFeePolicyRow(POLICY_ROW).policy
    expect(publicFeeDisclosure(pass)).toEqual({ label: 'Booking fee', percent_bps: 250, fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null })
    expect(publicFeeDisclosure(normaliseFeePolicyRow(ABSORB_ROW).policy)).toBeNull()
    expect(publicFeeDisclosure(null)).toBeNull()
  })

  it('buildFeeLineItem: one labelled line, quantity 1; nothing for a zero fee; rejects negatives', () => {
    expect(buildFeeLineItem('Booking fee', 525)).toEqual({ name: 'Booking fee', unitAmountCents: 525, quantity: 1 })
    expect(buildFeeLineItem('Booking fee', 0)).toBeNull()
    expect(() => buildFeeLineItem('Booking fee', -1)).toThrow()
  })

  it('loadCartTicketTypes passes the resolved row through uninterpreted (feePolicyRow), null when the row carries none', async () => {
    resolver = ttRowsResolver(withPolicy([ADULT], POLICY_ROW))
    const r = await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }])
    expect(r.ok && r.feePolicyRow).toEqual(POLICY_ROW)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

// ─── ZERO-FEE BACKWARD COMPATIBILITY ───────────────────────────────────

describe('ZERO-FEE BACKWARD COMPATIBILITY — an organisation with no policy row produces the pre-Phase-5A checkout exactly', () => {
  it("paid checkout of the brief's cart without a fee: fee 0, mode NULL, payment total = ticket total (19800 with EARLY20), no policy snapshot, three Phase-4 line items only, applicationFeeCents 0, one ticket-type query and no fee query", async () => {
    resolver = combine(ttRowsResolver([ADULT, CHILD, VIP]), promoResolver, stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor(ITEMS, { promotion_code: 'early20' }), buildReturnUrls: URLS })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/1' })
    const args = orderInsertArgs()
    expect(args).toContain(19800)
    // The fee snapshot arguments, in INSERT order: fee, mode, payment total, policy id, version, bps, fixed/order, fixed/ticket, min, max, tax, label.
    const feeArgs = args.slice(args.indexOf(19800) + 4, args.indexOf(19800) + 4 + 12)
    expect(feeArgs).toEqual([0, null, 19800, null, null, null, null, null, null, null, null, null])
    const input = sessionInput()
    expect(input.lineItems).toHaveLength(3)
    expect(input.lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(19800)
    expect(input.applicationFeeCents).toBe(0)
    expect(allTexts().filter(t => /ticketing_fee_policies/.test(t))).toHaveLength(1) // only the cart's own single query
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('a fixture row with NO fee_policy column at all (every pre-Phase-5A test/caller) behaves identically to an explicit null', async () => {
    resolver = combine(ttRowsResolver([ADULT, CHILD, VIP]), stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor(ITEMS), buildReturnUrls: URLS })
    expect(res.ok).toBe(true)
    expect(sessionInput().lineItems).toEqual([
      { name: 'Adult', unitAmountCents: 4000, quantity: 2 },
      { name: 'Child', unitAmountCents: 2000, quantity: 2 },
      { name: 'VIP', unitAmountCents: 10000, quantity: 1 },
    ])
    expect(sessionInput().applicationFeeCents).toBe(0)
    expect(orderInsertArgs()).toContain(22000)
  })

  it('an explicitly DISABLED policy row is treated exactly like no row', async () => {
    resolver = combine(ttRowsResolver(withPolicy([ADULT], { ...POLICY_ROW, enabled: false })), stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-adult', quantity: 1 }]), buildReturnUrls: URLS })
    expect(res.ok).toBe(true)
    expect(sessionInput().lineItems).toEqual([{ name: 'Adult', unitAmountCents: 4000, quantity: 1 }])
    expect(sessionInput().applicationFeeCents).toBe(0)
    expect(orderInsertArgs()).toContain(null)
    expect(orderInsertArgs()).not.toContain('fee-1')
  })

  it('the REAL createCheckoutSession sends no payment_intent_data key when applicationFeeCents is 0 or absent (byte-identical pre-Phase-5A parameters)', async () => {
    const base = { organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', lineItems: [{ name: 'Adult', unitAmountCents: 4000, quantity: 2 }], currency: 'AUD', purchaserEmail: 'p@example.com', successUrl: 'https://x/s', cancelUrl: 'https://x/c', connectedAccountId: 'acct_org_a' }
    await realStripe.createCheckoutSession(base)
    await realStripe.createCheckoutSession({ ...base, applicationFeeCents: 0 })
    expect(stripeSessionsCreateMock).toHaveBeenCalledTimes(2)
    for (const call of stripeSessionsCreateMock.mock.calls as unknown as [Record<string, unknown>, Record<string, unknown>][]) {
      expect(Object.keys(call[0]).sort()).toEqual(['cancel_url', 'customer_email', 'expires_at', 'line_items', 'metadata', 'mode', 'success_url'])
      expect(call[1]).toEqual({ stripeAccount: 'acct_org_a' })
    }
  })

  it('a zero-fee refund calls createRefund with exactly the two historical arguments (no options) and records refunded_cents / platform_fee_refunded_cents in the same UPDATE', async () => {
    resolver = combine(
      text => (/SELECT id FROM events WHERE id = /.test(text) ? [{ id: 'event-1' }] : undefined),
      text => (/stripe_account_id, platform_fee_cents\s*\n\s*FROM event_orders/.test(text) ? [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_org_a', platform_fee_cents: 0 }] : undefined),
      text => (/SET payment_status = 'REFUNDED'/.test(text) ? [{ id: 'order-1' }] : undefined),
    )
    createRefundMock.mockResolvedValue({ ok: true, refundedCents: 19800 })
    const res = await refundPaidOrder({ organisationId: 'org-a', userId: 'staff-1', eventId: 'event-1', orderId: 'order-1' })
    expect(res).toEqual({ ok: true, alreadyResolved: false })
    expect(createRefundMock.mock.calls[0]).toEqual(['pi_1', 'acct_org_a'])
    const upd = findCall(/SET payment_status = 'REFUNDED'/)
    expect(callText(upd)).toMatch(/refunded_cents = COALESCE\(.*::int, payment_total_cents, total_cents\),\s*\n\s*platform_fee_refunded_cents = platform_fee_cents/)
    expect(callArgs(upd)).toContain(19800)
  })

  it('free registration is untouched: no fee column in its INSERT, no fee statement, never a Stripe call', async () => {
    resolver = combine(ttRowsResolver(withPolicy([FREE_TT], POLICY_ROW)))
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await registerFreeOrder({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-free', quantity: 2 }]) } as never)
    expect(res.ok).toBe(true)
    const texts = allTexts()
    expect(texts.some(t => /INSERT INTO event_orders/.test(t) && /platform_fee_cents|fee_mode|payment_total_cents/.test(t))).toBe(false)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    expect(stripComments(read('lib/events/services/freeRegistration.ts'))).not.toMatch(/fee|Fee/)
  })

  it('a paid cart that includes a free type still fails before any fee logic (MIXED_FREE_AND_PAID), and a free-only cart is TICKET_TYPE_FREE — free orders never invoke Stripe or a fee', async () => {
    resolver = ttRowsResolver(withPolicy([ADULT, FREE_TT], POLICY_ROW))
    expect(await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-adult', quantity: 1 }, { ticket_type_id: 'tt-free', quantity: 1 }]), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'MIXED_FREE_AND_PAID' })
    resolver = ttRowsResolver(withPolicy([FREE_TT], POLICY_ROW))
    expect(await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-free', quantity: 1 }]), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'TICKET_TYPE_FREE' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })
})

// ─── FEE ORDERS: SNAPSHOT, STRIPE, RETRY, REFUND ───────────────────────

describe('PASS_THROUGH fee order — snapshot, Stripe line item, application fee', () => {
  it("the brief's cart + EARLY20 + 2.5% + $0.30: ticket 19800, fee 525, customer pays 20325; INSERT snapshots the policy inputs; Stripe gets 3 ticket lines + 1 'Booking fee' line summing to 20325 and applicationFeeCents 525", async () => {
    resolver = combine(ttRowsResolver(withPolicy([ADULT, CHILD, VIP], POLICY_ROW)), promoResolver, stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor(ITEMS, { promotion_code: 'early20' }), buildReturnUrls: URLS })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/1' })
    const gate = callText(findCall(/INSERT INTO event_orders/))
    expect(gate).toMatch(/platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version,\s*\n\s*fee_percent_bps, fee_fixed_per_order_cents, fee_fixed_per_ticket_cents, fee_min_cents, fee_max_cents, fee_tax_treatment, fee_label,\s*\n\s*discount_cents, promotion_code_id, promotion_code_snapshot, access_code_id, access_code_snapshot\s*\n\s*\)/)
    const args = orderInsertArgs()
    const feeArgs = args.slice(args.indexOf(19800) + 4, args.indexOf(19800) + 4 + 12)
    expect(feeArgs).toEqual([525, 'PASS_THROUGH', 20325, 'fee-1', 3, 250, 30, 0, null, null, 'UNSPECIFIED', 'Booking fee'])
    const input = sessionInput()
    expect(input.lineItems).toHaveLength(4)
    expect(input.lineItems[3]).toEqual({ name: 'Booking fee', unitAmountCents: 525, quantity: 1 })
    expect(input.lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(20325)
    expect(input.applicationFeeCents).toBe(525)
    expect(input.connectedAccountId).toBe('acct_org_a')
  })

  it('the event-level row wins over the organisation row inside the SAME subquery; the snapshot names the event policy', async () => {
    resolver = combine(ttRowsResolver(withPolicy([ADULT], ABSORB_ROW)), stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-adult', quantity: 1 }]), buildReturnUrls: URLS })
    expect(orderInsertArgs()).toContain('fee-2')
    expect(callText(findCall(/FROM event_ticket_types/))).toContain('ORDER BY (p.event_id IS NOT NULL) DESC LIMIT 1')
  })

  it('line items are built and reconciled to the PAYMENT total before the reservation; a mismatch leaves no hold behind', () => {
    const src = stripComments(read('lib/events/services/paidCheckout.ts'))
    const assertIdx = src.indexOf('assertCheckoutLineItemsTotal(stripeLineItems, financials.payment_total_cents)')
    const txIdx = src.indexOf('await sql.transaction([')
    expect(assertIdx).toBeGreaterThan(0)
    expect(assertIdx).toBeLessThan(txIdx)
    expect(() => assertCheckoutLineItemsTotal([...buildCheckoutLineItems([{ name: 'A', unit_price_cents: 4000, quantity: 1, discount_cents: 0 }], null, 'AUD'), { name: 'Booking fee', unitAmountCents: 100, quantity: 1 }], 4000)).toThrow(/4100 does not equal the order total 4000/)
  })

  it('configuration faults fail closed BEFORE any reservation: malformed row -> FEE_POLICY_INVALID, other currency -> FEE_CURRENCY_MISMATCH, absorbed fee > total -> FEE_EXCEEDS_TOTAL; the route maps each to a generic 503', async () => {
    resolver = ttRowsResolver(withPolicy([ADULT], { ...POLICY_ROW, fee_mode: 'SPLIT' }))
    expect(await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-adult', quantity: 1 }]), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'FEE_POLICY_INVALID' })
    resolver = ttRowsResolver(withPolicy([ADULT], { ...POLICY_ROW, currency: 'USD' }))
    expect(await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-adult', quantity: 1 }]), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'FEE_CURRENCY_MISMATCH' })
    resolver = ttRowsResolver(withPolicy([ADULT], { ...ABSORB_ROW, fixed_per_order_cents: 5000, percent_bps: 0 }))
    expect(await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-adult', quantity: 1 }]), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'FEE_EXCEEDS_TOTAL' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    const route = stripComments((read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts') + read('lib/events/paidCheckoutResponse.ts')))
    expect(route).toMatch(/case 'FEE_POLICY_INVALID':\s*\n\s*case 'FEE_CURRENCY_MISMATCH':\s*\n\s*case 'FEE_EXCEEDS_TOTAL':\s*\n\s*return NextResponse\.json\(\{ error: 'Paid checkout is not currently available\.' \}, \{ status: 503 \}\)/)
  })

  it('the REAL createCheckoutSession sends payment_intent_data.application_fee_amount exactly once, only when positive, and refuses a fee above the session total before contacting Stripe', async () => {
    const base = { organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', lineItems: [{ name: 'Adult', unitAmountCents: 4000, quantity: 2 }, { name: 'Booking fee', unitAmountCents: 230, quantity: 1 }], currency: 'AUD', purchaserEmail: 'p@example.com', successUrl: 'https://x/s', cancelUrl: 'https://x/c', connectedAccountId: 'acct_org_a' }
    await realStripe.createCheckoutSession({ ...base, applicationFeeCents: 230 })
    const params = (stripeSessionsCreateMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(params.payment_intent_data).toEqual({ application_fee_amount: 230 })
    expect(params.mode).toBe('payment')
    await expect(realStripe.createCheckoutSession({ ...base, applicationFeeCents: 8231 })).rejects.toThrow(/exceeds the Checkout Session total 8230/)
    await expect(realStripe.createCheckoutSession({ ...base, applicationFeeCents: -1 })).rejects.toThrow(/non-negative/)
    await expect(realStripe.createCheckoutSession({ ...base, applicationFeeCents: 1.5 })).rejects.toThrow(/non-negative safe integer/)
    expect(stripeSessionsCreateMock).toHaveBeenCalledTimes(1)
  })
})

describe('ABSORB fee order — customer total unchanged, fee only as application fee', () => {
  it("the brief's cart + EARLY20 under ABSORB: ticket 19800 = payment 19800, fee 525 deducted via application fee, no fee line item", async () => {
    resolver = combine(ttRowsResolver(withPolicy([ADULT, CHILD, VIP], ABSORB_ROW)), promoResolver, stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor(ITEMS, { promotion_code: 'early20' }), buildReturnUrls: URLS })
    expect(res.ok).toBe(true)
    const args = orderInsertArgs()
    const feeArgs = args.slice(args.indexOf(19800) + 4, args.indexOf(19800) + 4 + 12)
    expect(feeArgs).toEqual([525, 'ABSORB', 19800, 'fee-2', 1, 250, 30, 0, null, null, 'UNSPECIFIED', 'Booking fee'])
    const input = sessionInput()
    expect(input.lineItems).toHaveLength(3)
    expect(input.lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(19800)
    expect(input.applicationFeeCents).toBe(525)
  })
})

describe('Retry — reuses the COMMITTED fee snapshot; never re-reads a policy', () => {
  const EVENT_ROW = [{ id: 'event-1', status: 'PUBLISHED', event_slug: 'gala', org_slug: 'org-a' }]
  const ORDER = { id: 'order-1', payment_status: 'PENDING', purchaser_email: 'p@example.com', total_cents: 19800, currency: 'AUD', stripe_account_id: 'acct_org_a', stripe_checkout_session_id: null, expires_at: null, expires_at_stamp: '1', discount_cents: 2200, promotion_code_id: null, promotion_code_snapshot: 'EARLY20', platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: 20325, fee_label: 'Booking fee' }
  const ITEM_ROWS = [
    { ticket_type_id: 'tt-adult', event_session_id: null, quantity: 2, unit_price_cents: 4000, discount_cents: 800 },
    { ticket_type_id: 'tt-child', event_session_id: null, quantity: 2, unit_price_cents: 2000, discount_cents: 400 },
    { ticket_type_id: 'tt-vip', event_session_id: null, quantity: 1, unit_price_cents: 10000, discount_cents: 1000 },
  ]
  const TT_ROWS = [{ id: 'tt-adult', name: 'Adult', active: true, price_cents: 9999, currency: 'AUD' }, { id: 'tt-child', name: 'Child', active: true, price_cents: 1, currency: 'AUD' }, { id: 'tt-vip', name: 'VIP', active: true, price_cents: 5, currency: 'AUD' }]
  function retryResolver(order: Record<string, unknown> = ORDER): Resolver {
    return combine(
      text => (/FROM events e JOIN organisations o/.test(text) ? EVENT_ROW : undefined),
      text => (/platform_fee_cents, fee_mode, payment_total_cents, fee_label,\s*\n\s*discount_cents, promotion_code_id, promotion_code_snapshot\s*\n\s*FROM event_orders WHERE id = /.test(text) ? [order] : undefined),
      text => (/SELECT ticket_type_id, event_session_id, quantity, unit_price_cents, discount_cents FROM event_order_items/.test(text) ? ITEM_ROWS : undefined),
      text => (/SELECT id, name, active, price_cents, currency FROM event_ticket_types/.test(text) ? TT_ROWS : undefined),
      writeBackResolver,
    )
  }

  it('a PASS_THROUGH order retries with the stored fee line (label + amount) and the stored application fee, charging exactly payment_total_cents 20325 — no ticketing_fee_policies statement anywhere', async () => {
    resolver = retryResolver()
    transactionFinalResult = [{ id: 'order-1', expires_at: 'x', expires_at_stamp: '2' }]
    const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: async () => ({ successUrl: 'https://x/s', cancelUrl: 'https://x/c' }) })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/1' })
    const input = sessionInput()
    expect(input.lineItems).toHaveLength(4)
    expect(input.lineItems[3]).toEqual({ name: 'Booking fee', unitAmountCents: 525, quantity: 1 })
    expect(input.lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(20325)
    expect(input.applicationFeeCents).toBe(525)
    expect(allTexts().some(t => /ticketing_fee_policies/.test(t))).toBe(false)
    expect(stripComments(read('lib/events/services/retryCheckout.ts'))).not.toMatch(/ticketing_fee_policies|resolveFeePolicy|normaliseFeePolicyRow|computeOrderFinancials|computePlatformFeeCents/)
  })

  it('an ABSORB order retries with three lines (19800) and application fee 525; a pre-Phase-5A order (no fee columns) retries exactly as before with application fee 0', async () => {
    resolver = retryResolver({ ...ORDER, fee_mode: 'ABSORB', payment_total_cents: 19800 })
    transactionFinalResult = [{ id: 'order-1', expires_at: 'x', expires_at_stamp: '2' }]
    await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: async () => ({ successUrl: 'https://x/s', cancelUrl: 'https://x/c' }) })
    expect(sessionInput().lineItems).toHaveLength(3)
    expect(sessionInput().applicationFeeCents).toBe(525)
    createCheckoutSessionMock.mockClear(); sqlMock.mockClear(); transactionMock.mockClear()
    const legacy = { ...ORDER } as Record<string, unknown>
    delete legacy.platform_fee_cents; delete legacy.fee_mode; delete legacy.payment_total_cents; delete legacy.fee_label
    resolver = retryResolver(legacy)
    await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: async () => ({ successUrl: 'https://x/s', cancelUrl: 'https://x/c' }) })
    expect(sessionInput().lineItems).toHaveLength(3)
    expect(sessionInput().lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(19800)
    expect(sessionInput().applicationFeeCents).toBe(0)
  })

  it('a snapshot that does not reconcile (payment total ≠ ticket + fee; fee without mode) fails closed with ORDER_TOTAL_MISMATCH before any mutation or Stripe call', async () => {
    for (const bad of [{ ...ORDER, payment_total_cents: 20000 }, { ...ORDER, fee_mode: null }, { ...ORDER, fee_mode: 'ABSORB', payment_total_cents: 20325 }]) {
      sqlMock.mockClear(); transactionMock.mockClear(); createCheckoutSessionMock.mockClear()
      resolver = retryResolver(bad)
      const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: async () => ({ successUrl: 'https://x/s', cancelUrl: 'https://x/c' }) })
      expect(res).toEqual({ ok: false, code: 'ORDER_TOTAL_MISMATCH' })
      expect(transactionMock).not.toHaveBeenCalled()
      expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    }
  })

  it('changing the policy after checkout cannot alter an order: no UPDATE of event_orders fee columns exists anywhere outside the refund transition, and the refund never touches the fee amount', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])
    const files = [...walk(path.join(process.cwd(), 'lib/events')), ...walk(path.join(process.cwd(), 'app/api/events')), ...walk(path.join(process.cwd(), 'app/api/public/events'))].filter(f => /\.ts$/.test(f))
    for (const f of files) {
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      expect(src, f).not.toMatch(/SET[^;]*\bplatform_fee_cents\s*=\s*(?!platform_fee_cents)/)
      expect(src, f).not.toMatch(/SET[^;]*\b(fee_mode|payment_total_cents|fee_policy_id|fee_policy_version)\s*=/)
    }
  })
})

describe('Refund — full refund reverses the application fee from the ORDER snapshot', () => {
  const refundResolver = (fee: number) => combine(
    text => (/SELECT id FROM events WHERE id = /.test(text) ? [{ id: 'event-1' }] : undefined),
    text => (/stripe_account_id, platform_fee_cents\s*\n\s*FROM event_orders/.test(text) ? [{ id: 'order-1', payment_status: 'PAID', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_org_a', platform_fee_cents: fee }] : undefined),
    text => (/SET payment_status = 'REFUNDED'/.test(text) ? [{ id: 'order-1' }] : undefined),
  )

  it('a fee order refunds with refundApplicationFee: true on the historical connected account; DB records the Stripe-reported amount and the whole fee reversed, only after Stripe confirmed', async () => {
    resolver = refundResolver(525)
    createRefundMock.mockResolvedValue({ ok: true, refundedCents: 20325 })
    const res = await refundPaidOrder({ organisationId: 'org-a', userId: 'staff-1', eventId: 'event-1', orderId: 'order-1' })
    expect(res).toEqual({ ok: true, alreadyResolved: false })
    expect(createRefundMock.mock.calls[0]).toEqual(['pi_1', 'acct_org_a', { refundApplicationFee: true }])
    expect(callArgs(findCall(/SET payment_status = 'REFUNDED'/))).toContain(20325)
  })

  it('if Stripe refuses, nothing is written (order stays PAID); a second refund of the same order never reaches Stripe twice through this route', async () => {
    resolver = refundResolver(525)
    createRefundMock.mockResolvedValue({ ok: false, error: 'declined' })
    const res = await refundPaidOrder({ organisationId: 'org-a', userId: 'staff-1', eventId: 'event-1', orderId: 'order-1' })
    expect(res).toEqual({ ok: false, code: 'STRIPE_REFUND_FAILED', error: 'declined' })
    expect(allTexts().some(t => /SET payment_status = 'REFUNDED'/.test(t))).toBe(false)
    const src = stripComments(read('lib/events/services/orderTransitions.ts'))
    expect(src).toMatch(/if \(order\.payment_status !== 'PAID' \|\| !order\.stripe_payment_intent_id \|\| !order\.stripe_account_id\)/)
  })

  it('the REAL createRefund passes refund_application_fee only when asked and returns the Refund amount', async () => {
    const r1 = await realStripe.createRefund('pi_1', 'acct_org_a')
    const r2 = await realStripe.createRefund('pi_1', 'acct_org_a', { refundApplicationFee: true })
    expect(stripeRefundsCreateMock.mock.calls[0]).toEqual([{ payment_intent: 'pi_1' }, { stripeAccount: 'acct_org_a' }])
    expect(stripeRefundsCreateMock.mock.calls[1]).toEqual([{ payment_intent: 'pi_1', refund_application_fee: true }, { stripeAccount: 'acct_org_a' }])
    expect(r1).toEqual({ ok: true, refundedCents: 20325 })
    expect(r2).toEqual({ ok: true, refundedCents: 20325 })
    // Full refunds only: the refund call never carries an `amount`.
    expect(stripComments(read('lib/events/stripe.ts'))).not.toMatch(/refunds\.create\(\s*\{[^}]*\bamount\b/)
  })
})

// ─── PUBLIC CONTRACTS ──────────────────────────────────────────────────

describe('public quote / detail / status — fee facts for the purchaser', () => {
  it("POST .../quote prices the brief's cart with EARLY20 under a PASS_THROUGH fee: total_cents 19800 (tickets), platform_fee_cents 525, payment_total_cents 20325, fee { label }", async () => {
    resolver = combine(ttRowsResolver(withPolicy([ADULT, CHILD, VIP], POLICY_ROW)), promoResolver, text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [{ ok: 1 }] : undefined))
    const res = await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: ITEMS, promotion_code: 'EARLY20' }), SLUG_CTX)
    const body = await res.json()
    expect(body).toMatchObject({ subtotal_cents: 22000, discount_cents: 2200, total_cents: 19800, platform_fee_cents: 525, payment_total_cents: 20325, fee: { label: 'Booking fee' }, cart_error: null })
    expect(JSON.stringify(body)).not.toMatch(/fee-1|version|tax_treatment|percent_bps/)
  })

  it('an ABSORB fee is invisible on the quote (fee null, payment total = ticket total) and the public detail discloses no booking_fee; a PASS_THROUGH fee is disclosed with its inputs', async () => {
    resolver = ttRowsResolver(withPolicy([ADULT], ABSORB_ROW))
    const res = await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }] }), SLUG_CTX)
    expect(await res.json()).toMatchObject({ total_cents: 4000, platform_fee_cents: 130, payment_total_cents: 4000, fee: null })
    resolver = text => (/FROM ticketing_fee_policies p/.test(text) ? [{ fee_policy: ABSORB_ROW }] : undefined)
    const absorbDetail = await getPublicEventDetail('org-a', 'gala')
    expect(absorbDetail.ok && absorbDetail.detail.booking_fee).toBeNull()
    resolver = text => (/FROM ticketing_fee_policies p/.test(text) ? [{ fee_policy: POLICY_ROW }] : undefined)
    const passDetail = await getPublicEventDetail('org-a', 'gala')
    expect(passDetail.ok && passDetail.detail.booking_fee).toEqual({ label: 'Booking fee', percent_bps: 250, fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null })
    expect(JSON.stringify(passDetail)).not.toMatch(/fee-1|tax_treatment/)
  })

  it('no policy: the quote carries fee 0 / payment total = total and fee null; a free cart never carries a fee even with a policy', async () => {
    resolver = ttRowsResolver([ADULT])
    expect(await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }] }), SLUG_CTX)).json()).toMatchObject({ total_cents: 4000, platform_fee_cents: 0, payment_total_cents: 4000, fee: null })
    resolver = ttRowsResolver(withPolicy([FREE_TT], POLICY_ROW))
    expect(await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-free', quantity: 1 }] }), SLUG_CTX)).json()).toMatchObject({ pricing: 'FREE', total_cents: 0, platform_fee_cents: 0, payment_total_cents: 0, fee: null })
  })

  it('the checkout status route reports amount_total_cents = what was paid (payment_total_cents), with the ticket/fee split for a pass-through order; a pre-Phase-5A row (payment_total NULL) reads total_cents', async () => {
    resolver = text => (/WHERE eo\.stripe_checkout_session_id = /.test(text) ? [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID', total_cents: 19800, currency: 'AUD', payment_total_cents: 20325, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', fee_label: 'Booking fee' }] : undefined)
    const res = await statusRoute.GET(asNextRequest(new Request('http://localhost/api/public/events/org-a/gala/checkout/status?session_id=cs_1')), SLUG_CTX)
    expect(await res.json()).toMatchObject({ amount_total_cents: 20325, ticket_total_cents: 19800, fee_cents: 525, fee_label: 'Booking fee' })
    resolver = text => (/WHERE eo\.stripe_checkout_session_id = /.test(text) ? [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID', total_cents: 19800, currency: 'AUD', payment_total_cents: null, platform_fee_cents: 0, fee_mode: null, fee_label: null }] : undefined)
    const legacy = await statusRoute.GET(asNextRequest(new Request('http://localhost/api/public/events/org-a/gala/checkout/status?session_id=cs_1')), SLUG_CTX)
    expect(await legacy.json()).toMatchObject({ amount_total_cents: 19800, ticket_total_cents: 19800, fee_cents: 0, fee_label: null })
    expect(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route.ts')).toContain('COALESCE(eo.payment_total_cents, eo.total_cents) AS payment_total_cents')
  })

  it('the public page shows the pass-through fee from the shared pure rule and pays the payable total; the organiser list/CSV/KPI distinguish ticket revenue, fees and customer paid', () => {
    const client = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
    expect(client).toMatch(/import \{ computePlatformFeeCents \} from '@\/lib\/events\/feeCalculation'/)
    expect(client).toMatch(/computePlatformFeeCents\(totalCents, quantity, \{ fee_mode: 'PASS_THROUGH', \.\.\.bookingFee \}\)/)
    expect(client).toMatch(/`Pay \$\{formatPrice\(payableCents\)\}`/)
    expect((read('app/api/events/[id]/orders/route.ts') + read('lib/events/organiserReads.ts'))).toMatch(/COALESCE\(eo\.payment_total_cents, eo\.total_cents\) AS payment_total_cents, eo\.platform_fee_cents, eo\.fee_mode,\s*\n\s*eo\.refunded_cents, eo\.platform_fee_refunded_cents,/)
    const panel = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))
    expect(panel).toMatch(/formatAmount\(o\.payment_total_cents \?\? o\.total_cents, o\.currency\)/)
    expect(panel).toMatch(/Booking fee paid by customer/)
    expect(panel).toMatch(/Platform fee deducted from proceeds/)
    const kpi = stripComments(read('app/events/[id]/EventDetailClient.tsx'))
    expect(kpi).toMatch(/platformFeesCents = paidOrders\.reduce\(\(sum, o\) => sum \+ \(o\.platform_fee_cents \?\? 0\), 0\)/)
    expect(kpi).toMatch(/\{platformFeesCents > 0 && \(/)
    expect(read('app/api/events/[id]/orders/export/route.ts')).toMatch(/'Discount',\s*\n\s*'Platform fee',\s*\n\s*'Fee mode',\s*\n\s*'Customer paid',/)
  })
})

// ─── RECEIPT / PAYMENT SUMMARY ─────────────────────────────────────────

describe('neutral payment summary (lib/events/receipt.ts) — factual values only, never a tax document', () => {
  const ORDER = {
    order_reference: 'order-1', event_name: 'Gala', organiser_name: 'Org A', currency: 'AUD',
    total_cents: 19800, discount_cents: 2200, promotion_code_snapshot: 'EARLY20',
    platform_fee_cents: 525, fee_mode: 'PASS_THROUGH' as const, fee_label: 'Booking fee', payment_total_cents: 20325,
    paid_at: '2026-10-17T01:00:00.000Z', payment_status: 'PAID', refunded_cents: null, refunded_at: null,
    lines: [
      { description: 'Adult', quantity: 2, unit_price_cents: 4000, discount_cents: 800 },
      { description: 'Child', quantity: 2, unit_price_cents: 2000, discount_cents: 400 },
      { description: 'VIP', quantity: 1, unit_price_cents: 10000, discount_cents: 1000 },
    ],
  }

  it("builds the brief's figures: gross 22000, discount 2200, net 19800, booking fee 525, total paid 20325; ABSORB shows no fee; refund recorded as a fact", () => {
    const r = buildPaymentReceipt(ORDER)
    expect(r).toMatchObject({ gross_ticket_cents: 22000, discount_cents: 2200, promotion_code: 'EARLY20', net_ticket_cents: 19800, booking_fee_cents: 525, booking_fee_label: 'Booking fee', total_paid_cents: 20325, paid_at: '2026-10-17T01:00:00.000Z', refunded_cents: null })
    expect(buildPaymentReceipt({ ...ORDER, fee_mode: 'ABSORB', payment_total_cents: 19800 })).toMatchObject({ booking_fee_cents: 0, booking_fee_label: null, total_paid_cents: 19800 })
    expect(buildPaymentReceipt({ ...ORDER, payment_status: 'REFUNDED', refunded_cents: 20325, refunded_at: '2026-10-17T02:00:00.000Z' })).toMatchObject({ refunded_cents: 20325, refunded_at: '2026-10-17T02:00:00.000Z' })
  })

  it('refuses a snapshot that does not reconcile (payment ≠ ticket + fee; lines ≠ totals) rather than presenting it', () => {
    expect(() => buildPaymentReceipt({ ...ORDER, payment_total_cents: 20000 })).toThrow(/does not equal/)
    expect(() => buildPaymentReceipt({ ...ORDER, lines: [{ description: 'Adult', quantity: 1, unit_price_cents: 100, discount_cents: 0 }] })).toThrow(/lines do not reconcile/)
  })

  it('the rendered HTML names the figures and never any tax wording (no "Tax Invoice", "GST", "ABN"); the heading is "Payment summary"', () => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = renderPaymentReceiptHtml(buildPaymentReceipt({ ...ORDER, event_name: '<Gala & Co>' }), esc)
    expect(html).toContain('Payment summary')
    expect(html).toContain('&lt;Gala &amp; Co&gt;')
    expect(html).toContain('$203.25')
    expect(html).toContain('Booking fee')
    expect(html).toContain('less $8.00 discount')
    for (const term of RECEIPT_FORBIDDEN_TERMS) expect(html).not.toContain(term)
    // The renderer's only string literals that name tax concepts are the
    // forbidden-terms list itself.
    const rendererSrc = stripComments(read('lib/events/receipt.ts')).replace(/RECEIPT_FORBIDDEN_TERMS[^\n]*\n/, '')
    expect(rendererSrc).not.toMatch(/Tax Invoice|'GST'|ABN/)
    expect(rendererSrc).not.toMatch(/^\s*import /m)
  })

  it('receiptFromOrderRow: null for a free / pending / legacy row (no payment to summarise), a receipt for PAID; the ticket email renders the summary ONLY when supplied and is byte-identical otherwise', () => {
    expect(receiptFromOrderRow({ id: 'o', payment_status: 'NOT_REQUIRED', event_name: 'Gala' })).toBeNull()
    expect(receiptFromOrderRow({ id: 'o', payment_status: 'PENDING', event_name: 'Gala', total_cents: 100 })).toBeNull()
    expect(receiptFromOrderRow({ id: 'o', payment_status: 'PAID', event_name: 'Gala' })).toBeNull()
    const paid = receiptFromOrderRow({ id: 'o', payment_status: 'PAID', event_name: 'Gala', organisation_name: 'Org A', currency: 'AUD', total_cents: 4000, discount_cents: 0, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 4000, paid_at: '2026-10-17T01:00:00.000Z', receipt_lines: [{ description: 'Adult', quantity: 1, unit_price_cents: 4000, discount_cents: 0 }] })
    expect(paid).toMatchObject({ total_paid_cents: 4000, booking_fee_cents: 0 })
    const data = { eventName: 'Gala', purchaserName: 'Pat', attendees: [{ name: 'Pat', ticketToken: 'a'.repeat(64) }], bookingToken: null }
    const before = buildTicketEmail(data).html
    expect(buildTicketEmail({ ...data, receipt: null }).html).toBe(before)
    expect(before).not.toContain('Payment summary')
    const withReceipt = buildTicketEmail({ ...data, receipt: paid }).html
    expect(withReceipt).toContain('Payment summary')
    expect(withReceipt).toContain('$40.00')
    expect((withReceipt.match(new RegExp('a'.repeat(64), 'g')) ?? []).length).toBe(1)
  })

  it('both ticket-email callers read the snapshot and lines in their existing single statement and pass the receipt through', () => {
    for (const file of ['lib/events/ticketEmailDelivery.ts', 'app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts']) {
      const src = read(file)
      expect(src).toMatch(/eo\.platform_fee_cents, eo\.fee_mode, eo\.fee_label, eo\.payment_total_cents, eo\.paid_at, eo\.refunded_cents, eo\.refunded_at,/)
      expect(src).toMatch(/\) AS receipt_lines/)
      expect(src).toMatch(/receipt: /)
      expect(src).toMatch(/receiptFromOrderRow\(/)
    }
  })
})

// ─── CONTAINMENT ───────────────────────────────────────────────────────

describe('Phase 5A containment', () => {
  it('Events never imports the Commercial module (tax codes, invoices, business profile), and Commercial never imports Events fees', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])
    for (const f of walk(path.join(process.cwd(), 'lib/events')).filter(f => /\.ts$/.test(f))) {
      expect(stripComments(fs.readFileSync(f, 'utf8')), f).not.toMatch(/@\/lib\/commercial/)
    }
    for (const f of walk(path.join(process.cwd(), 'lib/commercial')).filter(f => /\.ts$/.test(f))) {
      expect(stripComments(fs.readFileSync(f, 'utf8')), f).not.toMatch(/feeCalculation|services\/fees|ticketing_fee_policies/)
    }
  })

  it('no product branding, no GST arithmetic, no merchant-of-record claim, no invoice issuance in the fee/receipt code', () => {
    for (const file of ['lib/events/feeCalculation.ts', 'lib/events/services/fees.ts', 'lib/events/receipt.ts', 'scripts/create-events-ticketing-fees-foundation.sql']) {
      const src = read(file)
      expect(src, file).not.toMatch(/\bEve\b/)
      expect(stripComments(src), file).not.toMatch(/\* 0\.1\b|\/ 11\b|gst_cents|tax_cents|merchant of record|issueInvoice|invoice_number/i)
    }
  })

  it('the webhook finalisation is unchanged by this phase (no fee read, no amount re-write)', () => {
    const src = stripComments(read('lib/events/stripe.ts'))
    const fn = src.slice(src.indexOf('async function handleCheckoutSessionCompleted('), src.indexOf('async function handleCheckoutSessionExpired('))
    expect(fn).not.toMatch(/platform_fee|payment_total|amount_total|application_fee/)
  })

  it('the 20-ticket cart ceiling, Connect direct-charge architecture and lock order are untouched', () => {
    expect(read('lib/events/publicValidation.ts')).toMatch(/MAX_QUANTITY = 20/)
    expect(stripComments(read('lib/events/stripe.ts'))).not.toMatch(/transfer_data|on_behalf_of|destination/)
    expect(stripComments(read('lib/events/services/cart.ts'))).not.toMatch(/ticketing_fee_policies[^;]*FOR UPDATE/)
  })
})
