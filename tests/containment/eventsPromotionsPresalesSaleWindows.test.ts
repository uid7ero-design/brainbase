import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Events Phase 4 — promotional codes, presale access codes, ticket-type
// sale windows. Mocked-SQL suite: proves the migration's shape, the
// integer-cents discount arithmetic, the Stripe reconciliation, the
// request validators, the statements/arguments each reservation flow
// submits (lock tier, gate predicates, snapshot columns), the organiser
// API's role/tenant gating and audit rows, the public quote/detail
// contracts, and the two clients' source-level contracts. Real behaviour
// that needs constraints, locks and MVCC (cross-event FK rejection,
// redemption oversubscription under concurrency, paid/refunded
// accounting, stale holds, retry self-exclusion, sale-window boundaries
// at the database clock) is proven against real PostgreSQL by
// scripts/tests/verify-events-promotions-presales.sh — mocks cannot
// prove any of those, so this file only guards that the proof script
// stays in step with the live SQL.

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
function jsonReq(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }))
}

// Text-addressed SQL mock: each test installs a resolver that answers by
// statement text (lock statements, gate statements and audit inserts
// simply fall through to []), so a change in how many statements a flow
// submits never silently shifts a fixture onto the wrong call.
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
const retrieveExistingCheckoutAttemptMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
    retrieveExistingCheckoutAttempt: (...args: unknown[]) => retrieveExistingCheckoutAttemptMock(...args),
    expireCheckoutSession: vi.fn().mockResolvedValue(undefined),
    RESERVATION_WINDOW_SECONDS: 1860,
  }
})
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
function auditInserts() {
  return (sqlMock.mock.calls as unknown as unknown[][])
    .filter(c => (c[0] as TemplateStringsArray).join(' ').includes('INSERT INTO audit_logs'))
    .map(c => ({
      organisationId: c[2], userId: c[3], action: c[4], resourceType: c[5], resourceId: c[6],
      before: c[7] ? JSON.parse(c[7] as string) : null,
      after: c[8] ? JSON.parse(c[8] as string) : null,
    }))
}
// The statements handed to sql.transaction([...]) — each was built via the
// mocked tag, so their text/args are the sqlMock calls made between the
// transaction's first and last statement.
function transactionTexts(): string[] {
  const n = (transactionMock.mock.calls[0]?.[0] as unknown[] | undefined)?.length ?? 0
  const texts = allTexts()
  const gateIdx = texts.findIndex(t => /INSERT INTO event_orders|UPDATE event_orders eo/.test(t))
  return texts.slice(gateIdx - (n - 1), gateIdx + 1)
}
function sessionAs(role: string, organisationId = 'org-a', userId = 'staff-1') { return { userId, organisationId, role } }

const promotions = await import('@/lib/events/services/promotions')
const { computeDiscount, buildCheckoutLineItems, assertCheckoutLineItemsTotal, minimumChargeCents, normaliseCode, PROMOTION_CODE_PATTERN, ACCESS_CODE_PATTERN, REDEMPTION_COUNTS_PREDICATE_SQL, MINIMUM_CHARGE_CENTS } = promotions
const { maskAccessCode, grantUnlocks } = await import('@/lib/events/services/accessCodes')
const { computeSaleStatus, isWithinSaleWindow, saleWindowPhase } = await import('@/lib/events/saleWindow')
const { validateEventPromotionCodeInput, validateEventAccessCodeInput, validateEventTicketTypeInput } = await import('@/lib/events/validation')
const { validatePublicRegistrationInput, validatePublicQuoteInput } = await import('@/lib/events/publicValidation')
const { loadCartTicketTypes, buildCartLockStatements } = await import('@/lib/events/services/cart')
const { startPaidCheckout } = await import('@/lib/events/services/paidCheckout')
const { registerFreeOrder } = await import('@/lib/events/services/freeRegistration')
const { retryPendingOrderCheckout } = await import('@/lib/events/services/retryCheckout')
const { getPublicEventDetail } = await import('@/lib/events/publicEventDetail')
const quoteRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route')
const promotionsRoute = await import('@/app/api/events/[id]/promotions/route')
const promotionRoute = await import('@/app/api/events/[id]/promotions/[promotionId]/route')
const accessCodesRoute = await import('@/app/api/events/[id]/access-codes/route')
const accessCodeRoute = await import('@/app/api/events/[id]/access-codes/[accessCodeId]/route')
const ticketTypeRoute = await import('@/app/api/events/[id]/ticket-types/[ticketTypeId]/route')

const SLUG_CTX = { params: Promise.resolve({ organisationSlug: 'org-a', eventSlug: 'gala' }) }
const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const PROMO_CTX = { params: Promise.resolve({ id: 'event-1', promotionId: 'promo-1' }) }
const ACCESS_CTX = { params: Promise.resolve({ id: 'event-1', accessCodeId: 'access-1' }) }
const TT_CTX = { params: Promise.resolve({ id: 'event-1', ticketTypeId: 'tt-adult' }) }
const QUOTE_URL = 'http://localhost/api/public/events/org-a/gala/quote'

// The brief's own cart: 2 × Adult $40 + 2 × Child $20 + 1 × VIP $100.
const ADULT = { id: 'tt-adult', active: true, price_cents: 4000, currency: 'AUD', name: 'Adult', sale_started: true, sale_ended: false, requires_access_code: false }
const CHILD = { id: 'tt-child', active: true, price_cents: 2000, currency: 'AUD', name: 'Child', sale_started: true, sale_ended: false, requires_access_code: false }
const VIP = { id: 'tt-vip', active: true, price_cents: 10000, currency: 'AUD', name: 'VIP', sale_started: true, sale_ended: false, requires_access_code: false }
const FREE_TT = { id: 'tt-free', active: true, price_cents: 0, currency: 'AUD', name: 'Free', sale_started: true, sale_ended: false, requires_access_code: false }
const ITEMS = [{ ticket_type_id: 'tt-adult', quantity: 2 }, { ticket_type_id: 'tt-child', quantity: 2 }, { ticket_type_id: 'tt-vip', quantity: 1 }]
const LINES = [
  { ticket_type_id: 'tt-adult', unit_price_cents: 4000, quantity: 2 },
  { ticket_type_id: 'tt-child', unit_price_cents: 2000, quantity: 2 },
  { ticket_type_id: 'tt-vip', unit_price_cents: 10000, quantity: 1 },
]
const TEN_PERCENT = { id: 'promo-1', code: 'EARLY20', discount_type: 'PERCENT' as const, discount_value: 10, min_cart_cents: null, max_redemptions: 50, ticket_type_ids: [] as string[] }
const PROMO_ROW = { ...TEN_PERCENT, ticket_type_ids: null }
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

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  createCheckoutSessionMock.mockReset()
  retrieveExistingCheckoutAttemptMock.mockReset()
  requireSessionMock.mockReset()
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  resolver = () => undefined
  transactionFinalResult = []
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.test/1' })
})

// ─── MIGRATION ─────────────────────────────────────────────────────────

describe('scripts/create-events-promotions-presales-sale-windows.sql — additive, idempotent, event-scoped integrity', () => {
  const raw = read('scripts/create-events-promotions-presales-sale-windows.sql')
  const live = stripSqlLineComments(raw)

  it('creates exactly four new tables (two code tables + two ticket-type join tables), idempotently', () => {
    expect(live.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(4)
    for (const t of ['event_promotion_codes', 'event_promotion_code_ticket_types', 'event_access_codes', 'event_access_code_ticket_types']) {
      expect(live).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`))
    }
  })

  it('adds the sale window + access flag to ticket types and the discount snapshot to orders/items with IF NOT EXISTS and safe defaults', () => {
    expect(live).toMatch(/ALTER TABLE event_ticket_types\s*\n\s*ADD COLUMN IF NOT EXISTS sale_starts_at\s+TIMESTAMPTZ,\s*\n\s*ADD COLUMN IF NOT EXISTS sale_ends_at\s+TIMESTAMPTZ,\s*\n\s*ADD COLUMN IF NOT EXISTS requires_access_code BOOLEAN NOT NULL DEFAULT false/)
    expect(live).toMatch(/ADD COLUMN IF NOT EXISTS discount_cents\s+INTEGER NOT NULL DEFAULT 0,\s*\n\s*ADD COLUMN IF NOT EXISTS promotion_code_id\s+TEXT,\s*\n\s*ADD COLUMN IF NOT EXISTS promotion_code_snapshot TEXT,\s*\n\s*ADD COLUMN IF NOT EXISTS access_code_id\s+TEXT,\s*\n\s*ADD COLUMN IF NOT EXISTS access_code_snapshot\s+TEXT/)
    expect(live).toMatch(/ALTER TABLE event_order_items\s*\n\s*ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0/)
    // Every new NOT NULL column has a default; no NOT NULL column without one.
    expect(live).not.toMatch(/ADD COLUMN IF NOT EXISTS \w+\s+\w+ NOT NULL(?! DEFAULT)/)
  })

  it('every ADD CONSTRAINT is inside a pg_constraint-guarded DO block (idempotent re-run)', () => {
    const adds = live.match(/ADD CONSTRAINT (\w+)/g)?.filter(a => !/^.*CONSTRAINT event_(promotion|access)_codes_|event_(promo|access)_tt_|event_(promotion_code|access_code)_ticket_types_pkey/.test(a)) ?? []
    // The constraints added via ALTER TABLE (not inline in CREATE TABLE):
    const alterAdds = ['event_ticket_types_sale_window_check', 'event_orders_discount_cents_check', 'event_orders_promotion_snapshot_check', 'event_orders_access_snapshot_check', 'event_orders_promotion_code_fkey', 'event_orders_access_code_fkey', 'event_order_items_discount_cents_check']
    for (const name of alterAdds) {
      expect(live).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${name}'\\) THEN`))
    }
    expect(adds.length).toBeGreaterThanOrEqual(alterAdds.length)
  })

  it('order -> code foreign keys are EVENT-scoped composites (approval §2): (code_id, event_id, organisation_id) -> (id, event_id, organisation_id), default NO ACTION', () => {
    expect(live).toMatch(/ADD CONSTRAINT event_orders_promotion_code_fkey\s*\n\s*FOREIGN KEY \(promotion_code_id, event_id, organisation_id\)\s*\n\s*REFERENCES event_promotion_codes \(id, event_id, organisation_id\);/)
    expect(live).toMatch(/ADD CONSTRAINT event_orders_access_code_fkey\s*\n\s*FOREIGN KEY \(access_code_id, event_id, organisation_id\)\s*\n\s*REFERENCES event_access_codes \(id, event_id, organisation_id\);/)
    // Never the weaker (id, organisation_id) shape, and never RESTRICT.
    expect(live).not.toMatch(/FOREIGN KEY \(promotion_code_id, organisation_id\)/)
    expect(live).not.toMatch(/FOREIGN KEY \(access_code_id, organisation_id\)/)
    expect(live).not.toMatch(/ON DELETE RESTRICT/)
    // The parent UNIQUEs that back them exist.
    expect(live).toMatch(/CONSTRAINT event_promotion_codes_id_event_org_key UNIQUE \(id, event_id, organisation_id\)/)
    expect(live).toMatch(/CONSTRAINT event_access_codes_id_event_org_key UNIQUE \(id, event_id, organisation_id\)/)
  })

  it('join tables composite-FK BOTH parents on (foreign_id, event_id, organisation_id) with CASCADE — a cross-organisation or cross-event assignment is unrepresentable', () => {
    expect(live).toMatch(/CONSTRAINT event_promo_tt_code_fkey FOREIGN KEY \(promotion_code_id, event_id, organisation_id\)\s*\n\s*REFERENCES event_promotion_codes \(id, event_id, organisation_id\) ON DELETE CASCADE/)
    expect(live).toMatch(/CONSTRAINT event_promo_tt_ticket_type_fkey FOREIGN KEY \(ticket_type_id, event_id, organisation_id\)\s*\n\s*REFERENCES event_ticket_types \(id, event_id, organisation_id\) ON DELETE CASCADE/)
    expect(live).toMatch(/CONSTRAINT event_access_tt_code_fkey FOREIGN KEY \(access_code_id, event_id, organisation_id\)\s*\n\s*REFERENCES event_access_codes \(id, event_id, organisation_id\) ON DELETE CASCADE/)
    expect(live).toMatch(/CONSTRAINT event_access_tt_ticket_type_fkey FOREIGN KEY \(ticket_type_id, event_id, organisation_id\)\s*\n\s*REFERENCES event_ticket_types \(id, event_id, organisation_id\) ON DELETE CASCADE/)
    expect(live).not.toMatch(/FOREIGN KEY \(ticket_type_id\)\s*REFERENCES/)
  })

  it('code format is enforced by CHECK: normalised upper/trim, [A-Z0-9_-], 3..32 for promotion codes and 8..32 for access codes (approval §3); one code per (organisation, event)', () => {
    expect(live).toMatch(/CONSTRAINT event_promotion_codes_code_format_check\s*\n\s*CHECK \(code = upper\(btrim\(code\)\) AND code ~ '\^\[A-Z0-9_-\]\{3,32\}\$'\)/)
    expect(live).toMatch(/CONSTRAINT event_access_codes_code_format_check\s*\n\s*CHECK \(code = upper\(btrim\(code\)\) AND code ~ '\^\[A-Z0-9_-\]\{8,32\}\$'\)/)
    expect(live).toMatch(/CONSTRAINT event_promotion_codes_org_event_code_key UNIQUE \(organisation_id, event_id, code\)/)
    expect(live).toMatch(/CONSTRAINT event_access_codes_org_event_code_key UNIQUE \(organisation_id, event_id, code\)/)
  })

  it('discount rules are database-enforced: PERCENT 1..100 or FIXED >= 1, max_redemptions/min_cart >= 1, window ends > starts, per-line discount within gross, order snapshot coherence', () => {
    expect(live).toMatch(/CHECK \(\(discount_type = 'PERCENT' AND discount_value BETWEEN 1 AND 100\)\s*\n\s*OR \(discount_type = 'FIXED'\s+AND discount_value >= 1\)\)/)
    expect(live).toMatch(/CHECK \(discount_type IN \('PERCENT', 'FIXED'\)\)/)
    expect(live).toMatch(/CHECK \(max_redemptions IS NULL OR max_redemptions >= 1\)/)
    expect(live).toMatch(/CHECK \(min_cart_cents IS NULL OR min_cart_cents >= 1\)/)
    expect(live).toMatch(/CHECK \(starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at\)/)
    expect(live).toMatch(/CHECK \(sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at\)/)
    expect(live).toMatch(/CHECK \(discount_cents >= 0 AND discount_cents <= unit_price_cents \* quantity\)/)
    expect(live).toMatch(/CHECK \(\(promotion_code_id IS NULL AND promotion_code_snapshot IS NULL AND discount_cents = 0\)\s*\n\s*OR \(promotion_code_id IS NOT NULL AND promotion_code_snapshot IS NOT NULL\)\)/)
    expect(live).toMatch(/CHECK \(\(access_code_id IS NULL\) = \(access_code_snapshot IS NULL\)\)/)
  })

  it('touches no existing data (no UPDATE/DELETE/INSERT, no DROP, no ALTER COLUMN, no ::uuid) outside the commented rollback block', () => {
    expect(live).not.toMatch(/\bDROP\b/i)
    expect(live).not.toMatch(/ALTER COLUMN|RENAME/i)
    expect(live).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/im)
    expect(live).not.toMatch(/::uuid/i)
    expect(live).not.toMatch(/\bRESTRICT\b/)
  })

  it('documents manual-only, not-Production, and a dependents-first rollback order', () => {
    expect(raw).toMatch(/Run once, manually/)
    expect(raw).toMatch(/NOT executed against Production/)
    const rollbackIdx = raw.indexOf('-- ROLLBACK')
    expect(rollbackIdx).toBeGreaterThan(-1)
    const rollback = raw.slice(rollbackIdx, rollbackIdx + 2200)
    const order = ['DROP CONSTRAINT IF EXISTS event_orders_promotion_code_fkey', 'DROP COLUMN IF EXISTS discount_cents', 'DROP TABLE IF EXISTS event_promotion_code_ticket_types', 'DROP TABLE IF EXISTS event_promotion_codes', 'DROP COLUMN IF EXISTS sale_starts_at']
    for (let i = 1; i < order.length; i++) expect(rollback.indexOf(order[i - 1])).toBeLessThan(rollback.indexOf(order[i]))
  })

  it('documents the D3 redemption accounting (paid/refunded permanently count; expired/failed/cancelled unpaid holds release; webhook never inserts; retry excludes itself)', () => {
    expect(raw).toMatch(/payment_status IN \('PAID','REFUNDED'\)/)
    expect(raw).toMatch(/PERMANENTLY, even\s*\n--\s*if later refunded or cancelled/)
    expect(raw).toMatch(/webhook\s*\n--\s*never inserts anything promotion-related/)
    expect(raw).toMatch(/Retry excludes its own order from the count/)
  })

  it('prisma/schema.prisma mirrors every table, the event-scoped order relations and the new columns', () => {
    const schema = read('prisma/schema.prisma')
    for (const [model, table] of [['EventPromotionCode', 'event_promotion_codes'], ['EventPromotionCodeTicketType', 'event_promotion_code_ticket_types'], ['EventAccessCode', 'event_access_codes'], ['EventAccessCodeTicketType', 'event_access_code_ticket_types']]) {
      const start = schema.indexOf(`model ${model} {`)
      expect(start).toBeGreaterThan(-1)
      expect(schema.slice(start, schema.indexOf('\n}', start))).toMatch(new RegExp(`@@map\\("${table}"\\)`))
    }
    const orderStart = schema.indexOf('model EventOrder {')
    const order = schema.slice(orderStart, schema.indexOf('\n}', orderStart))
    expect(order).toMatch(/discount_cents\s+Int\s+@default\(0\)/)
    expect(order).toMatch(/@relation\(fields: \[promotion_code_id, event_id, organisation_id\], references: \[id, event_id, organisation_id\], onDelete: NoAction\)/)
    expect(order).toMatch(/@relation\(fields: \[access_code_id, event_id, organisation_id\], references: \[id, event_id, organisation_id\], onDelete: NoAction\)/)
    const ttStart = schema.indexOf('model EventTicketType {')
    const tt = schema.slice(ttStart, schema.indexOf('\n}', ttStart))
    expect(tt).toMatch(/sale_starts_at\s+DateTime\?/)
    expect(tt).toMatch(/requires_access_code Boolean\s+@default\(false\)/)
    const itemStart = schema.indexOf('model EventOrderItem {')
    expect(schema.slice(itemStart, schema.indexOf('\n}', itemStart))).toMatch(/discount_cents\s+Int\s+@default\(0\)/)
  })

  it('every real-Postgres harness that runs the live services applies the new migration', () => {
    expect(read('tests/containment/eventsExpiryCasPrecisionRealPostgres.test.ts')).toMatch(/'scripts\/create-events-promotions-presales-sale-windows\.sql'/)
    expect(read('scripts/tests/verify-events-promotions-presales.sh')).toMatch(/create-events-promotions-presales-sale-windows\.sql/)
  })
})

// ─── DISCOUNT ARITHMETIC ───────────────────────────────────────────────

describe('computeDiscount — integer cents, round-half-up once, largest-remainder allocation, currency minimum', () => {
  it("the brief's cart: 2×$40 + 2×$20 + 1×$100 = $220, 10% -> $22 off, $198 payable, allocated 800/400/1000", () => {
    const r = computeDiscount(LINES, TEN_PERCENT, 'AUD')
    expect(r).toEqual({ ok: true, subtotalCents: 22000, eligibleSubtotalCents: 22000, discountCents: 2200, lineDiscountCents: [800, 400, 1000], totalCents: 19800 })
  })

  it('rounds half-up exactly once on the eligible subtotal (never per line, never floating point)', () => {
    // 3 × 333 = 999 at 15% = 149.85 -> 150 (half-up on the total, not 3 × round(49.95) = 150 by coincidence; use an odd case)
    const r = computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 333, quantity: 1 }, { ticket_type_id: 'b', unit_price_cents: 333, quantity: 1 }, { ticket_type_id: 'c', unit_price_cents: 333, quantity: 1 }], { ...TEN_PERCENT, discount_value: 15 }, 'AUD')
    expect(r.ok && r.discountCents).toBe(150)
    expect(r.ok && r.lineDiscountCents.reduce((s, d) => s + d, 0)).toBe(150)
    // 1 × 1 cent at 1% -> 0.01 -> 0 -> not applicable (a code must change the price)
    expect(computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 1, quantity: 1 }], { ...TEN_PERCENT, discount_value: 1 }, 'AUD')).toEqual({ ok: false, code: 'PROMOTION_NOT_APPLICABLE' })
    // 50% of 101 cents -> 50.5 -> 51 (half-up)
    const half = computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 101, quantity: 1 }], { ...TEN_PERCENT, discount_value: 50 }, 'AUD')
    expect(half.ok && half.discountCents).toBe(51)
    expect(half.ok && half.totalCents).toBe(50)
  })

  it('largest-remainder allocation: line discounts always sum to the order discount and never exceed a line gross (1,000 random carts)', () => {
    let seed = 42
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 1000; i++) {
      const lines = Array.from({ length: 1 + rnd(5) }, (_, k) => ({ ticket_type_id: `t${k}`, unit_price_cents: 100 + rnd(20000), quantity: 1 + rnd(6) }))
      const pct = 1 + rnd(99)
      const r = computeDiscount(lines, { ...TEN_PERCENT, discount_value: pct }, 'AUD')
      if (!r.ok) { expect(r.code).toBe('PROMOTION_TOTAL_TOO_LOW'); continue }
      expect(r.lineDiscountCents.reduce((s, d) => s + d, 0)).toBe(r.discountCents)
      r.lineDiscountCents.forEach((d, k) => { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(lines[k].unit_price_cents * lines[k].quantity) })
      expect(r.totalCents).toBe(r.subtotalCents - r.discountCents)
      expect(Number.isInteger(r.discountCents) && Number.isInteger(r.totalCents)).toBe(true)
    }
  })

  it('ties in the remainder go to the earlier cart line (deterministic)', () => {
    // 3 lines of 100 at 1% -> 3 cents total, each line 1.0 -> no remainder; use 10% of 3 × 105 = 31.5 -> 32 (31.5 half-up); 32 × 105 / 315 = 10.67 each -> base 10 ×3 = 30, two extra cents to lines 0 and 1
    const r = computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 105, quantity: 1 }, { ticket_type_id: 'b', unit_price_cents: 105, quantity: 1 }, { ticket_type_id: 'c', unit_price_cents: 105, quantity: 1 }], TEN_PERCENT, 'AUD')
    expect(r.ok && r.discountCents).toBe(32)
    expect(r.ok && r.lineDiscountCents).toEqual([11, 11, 10])
  })

  it('a ticket-type-restricted code discounts only eligible lines; min_cart_cents compares against the GROSS subtotal', () => {
    const vipOnly = computeDiscount(LINES, { ...TEN_PERCENT, ticket_type_ids: ['tt-vip'] }, 'AUD')
    expect(vipOnly).toEqual({ ok: true, subtotalCents: 22000, eligibleSubtotalCents: 10000, discountCents: 1000, lineDiscountCents: [0, 0, 1000], totalCents: 21000 })
    expect(computeDiscount(LINES, { ...TEN_PERCENT, ticket_type_ids: ['tt-nope'] }, 'AUD')).toEqual({ ok: false, code: 'PROMOTION_NOT_APPLICABLE' })
    expect(computeDiscount(LINES, { ...TEN_PERCENT, min_cart_cents: 22001 }, 'AUD')).toEqual({ ok: false, code: 'PROMOTION_MIN_CART' })
    expect(computeDiscount(LINES, { ...TEN_PERCENT, min_cart_cents: 22000 }, 'AUD').ok).toBe(true)
  })

  it('FIXED discounts are integer cents, capped at the eligible subtotal, and allocated across lines', () => {
    const r = computeDiscount(LINES, { ...TEN_PERCENT, discount_type: 'FIXED', discount_value: 1500 }, 'AUD')
    expect(r.ok && r.discountCents).toBe(1500)
    expect(r.ok && r.totalCents).toBe(20500)
    expect(r.ok && r.lineDiscountCents.reduce((s, d) => s + d, 0)).toBe(1500)
    const capped = computeDiscount(LINES, { ...TEN_PERCENT, discount_type: 'FIXED', discount_value: 999999, ticket_type_ids: ['tt-child'] }, 'AUD')
    expect(capped.ok && capped.discountCents).toBe(4000)
    expect(capped.ok && capped.lineDiscountCents).toEqual([0, 4000, 0])
  })

  it('a free cart is never discounted (PROMOTION_NOT_APPLICABLE)', () => {
    expect(computeDiscount([{ ticket_type_id: 'tt-free', unit_price_cents: 0, quantity: 3 }], TEN_PERCENT, 'AUD')).toEqual({ ok: false, code: 'PROMOTION_NOT_APPLICABLE' })
  })

  it('D1: a discount that takes the payable below the currency minimum — including 100% — is rejected; no zero-value paid flow is ever produced', () => {
    expect(computeDiscount(LINES, { ...TEN_PERCENT, discount_value: 100 }, 'AUD')).toEqual({ ok: false, code: 'PROMOTION_TOTAL_TOO_LOW' })
    expect(computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 100, quantity: 1 }], { ...TEN_PERCENT, discount_type: 'FIXED', discount_value: 60 }, 'AUD')).toEqual({ ok: false, code: 'PROMOTION_TOTAL_TOO_LOW' })
    // Exactly the minimum is allowed.
    expect(computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 100, quantity: 1 }], { ...TEN_PERCENT, discount_type: 'FIXED', discount_value: 50 }, 'AUD').ok).toBe(true)
    // GBP has a lower floor (30p).
    expect(computeDiscount([{ ticket_type_id: 'a', unit_price_cents: 100, quantity: 1 }], { ...TEN_PERCENT, discount_type: 'FIXED', discount_value: 60 }, 'GBP').ok).toBe(true)
  })

  it('§4: the minimum is currency-aware and an unknown currency fails closed for a DISCOUNTED cart', () => {
    expect(MINIMUM_CHARGE_CENTS).toMatchObject({ AUD: 50, USD: 50, GBP: 30, EUR: 50, NZD: 50 })
    expect(minimumChargeCents('aud')).toBe(50)
    expect(minimumChargeCents('XYZ')).toBeNull()
    expect(computeDiscount(LINES, TEN_PERCENT, 'XYZ')).toEqual({ ok: false, code: 'PROMOTION_CURRENCY_UNSUPPORTED' })
    // The undiscounted path never consults the table (cart.ts has no minimum check).
    expect(stripComments(read('lib/events/services/cart.ts'))).not.toMatch(/minimumChargeCents|MINIMUM_CHARGE/)
  })

  it('no floating-point money anywhere in the promotions service (no toFixed/parseFloat/division into a stored cent value)', () => {
    const src = stripComments(read('lib/events/services/promotions.ts'))
    const math = src.slice(src.indexOf('export function computeDiscount'), src.indexOf('export type ResolvePromotionResult'))
    expect(math).not.toMatch(/parseFloat|toFixed|\* 0\.|Number\(|\.toString\(\)/)
    expect(math).toMatch(/Math\.floor\(\(eligibleSubtotalCents \* rule\.discount_value \+ 50\) \/ 100\)/)
    expect(math).toMatch(/assertCents\(l\.unit_price_cents/)
    expect(src).toMatch(/function assertCents[\s\S]*Number\.isSafeInteger/)
  })
})

describe('Stripe reconciliation — buildCheckoutLineItems / assertCheckoutLineItemsTotal (approval D2)', () => {
  const NAMED = LINES.map((l, i) => ({ name: ['Adult', 'Child', 'VIP'][i], ...l }))

  it('undiscounted lines are sent exactly as before (unit × quantity, no description); a discounted line becomes ONE net line item, quantity 1, naming the quantity and the discount', () => {
    const items = buildCheckoutLineItems(NAMED.map((l, i) => ({ ...l, discount_cents: [800, 0, 1000][i] })), 'EARLY20', 'AUD')
    expect(items[1]).toEqual({ name: 'Child', unitAmountCents: 2000, quantity: 2 })
    expect(items[0]).toMatchObject({ name: 'Adult × 2', unitAmountCents: 7200, quantity: 1 })
    expect(items[0].description).toMatch(/2 × \$40\.00, less \$8\.00 discount \(EARLY20\)/)
    expect(items[2]).toMatchObject({ name: 'VIP × 1', unitAmountCents: 9000, quantity: 1 })
    expect(items.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(22000 - 800 - 1000)
  })

  it('Σ line amounts must equal the order total exactly — otherwise it throws (fail closed, before Stripe)', () => {
    const items = buildCheckoutLineItems(NAMED.map(l => ({ ...l, discount_cents: 0 })), null, 'AUD')
    expect(() => assertCheckoutLineItemsTotal(items, 22000)).not.toThrow()
    expect(() => assertCheckoutLineItemsTotal(items, 21999)).toThrow(/does not equal the order total/)
    expect(() => buildCheckoutLineItems([{ name: 'A', unit_price_cents: 100, quantity: 1, discount_cents: 101 }], 'X', 'AUD')).toThrow(/exceeded its gross/)
  })

  it('createCheckoutSession sends product_data.description ONLY when a line carries one (an undiscounted order produces the exact pre-Phase-4 session shape)', () => {
    const src = stripComments(read('lib/events/stripe.ts'))
    expect(src).toMatch(/product_data: item\.description \? \{ name: item\.name, description: item\.description \} : \{ name: item\.name \}/)
    expect(src).not.toMatch(/coupon|promotion_code|discounts:/i)
  })
})

// ─── CODES, WINDOWS, VALIDATORS ────────────────────────────────────────

describe('code normalisation, formats, masking, sale-window rule', () => {
  it('normaliseCode trims and upper-cases; the two patterns mirror the database CHECKs', () => {
    expect(normaliseCode('  early20 ')).toBe('EARLY20')
    expect(normaliseCode('')).toBeNull()
    expect(normaliseCode(42)).toBeNull()
    expect(PROMOTION_CODE_PATTERN.test('ABC')).toBe(true)
    expect(PROMOTION_CODE_PATTERN.test('AB')).toBe(false)
    expect(PROMOTION_CODE_PATTERN.test('A'.repeat(33))).toBe(false)
    expect(PROMOTION_CODE_PATTERN.test('NO SPACE')).toBe(false)
    expect(ACCESS_CODE_PATTERN.test('MEMBER25')).toBe(true)
    expect(ACCESS_CODE_PATTERN.test('MEMBER2')).toBe(false)
  })

  it('maskAccessCode never reveals more than two leading characters', () => {
    expect(maskAccessCode('MEMBERS2026')).toMatch(/^ME\*{9}#[0-9a-f]{6}$/)
    expect(maskAccessCode('ABCDEFGH')).toMatch(/^AB\*{6}#[0-9a-f]{6}$/)
    expect(maskAccessCode('MEMBERS2026')).not.toBe(maskAccessCode('MEMBERS2027'))
    expect(maskAccessCode('MEMBERS2026')).toBe(maskAccessCode('MEMBERS2026'))
  })

  it('grantUnlocks: an empty assignment set unlocks every restricted type; otherwise only the assigned ones; no grant unlocks nothing', () => {
    expect(grantUnlocks({ id: 'a', code: 'X', ticket_type_ids: [] }, 'tt-vip')).toBe(true)
    expect(grantUnlocks({ id: 'a', code: 'X', ticket_type_ids: ['tt-vip'] }, 'tt-vip')).toBe(true)
    expect(grantUnlocks({ id: 'a', code: 'X', ticket_type_ids: ['tt-vip'] }, 'tt-adult')).toBe(false)
    expect(grantUnlocks(null, 'tt-vip')).toBe(false)
  })

  it('sale window is half-open: the start instant is on sale, the end instant is not; NULL bounds are unbounded', () => {
    const w = { sale_starts_at: '2026-11-01T00:00:00Z', sale_ends_at: '2026-11-02T00:00:00Z' }
    expect(isWithinSaleWindow(w, new Date('2026-10-31T23:59:59.999Z'))).toBe(false)
    expect(isWithinSaleWindow(w, new Date('2026-11-01T00:00:00Z'))).toBe(true)
    expect(isWithinSaleWindow(w, new Date('2026-11-01T23:59:59.999Z'))).toBe(true)
    expect(isWithinSaleWindow(w, new Date('2026-11-02T00:00:00Z'))).toBe(false)
    expect(saleWindowPhase(w, new Date('2026-10-01T00:00:00Z'))).toBe('COMING_SOON')
    expect(saleWindowPhase(w, new Date('2026-12-01T00:00:00Z'))).toBe('SALES_ENDED')
    expect(isWithinSaleWindow({ sale_starts_at: null, sale_ends_at: null }, new Date(0))).toBe(true)
  })

  it('computeSaleStatus vocabulary: COMING_SOON | ON_SALE | SOLD_OUT | SALES_ENDED | ACCESS_REQUIRED, with access-required taking precedence over sold-out inside the window', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    const base = { sale_starts_at: null, sale_ends_at: null, requires_access_code: false, remaining: 5 }
    expect(computeSaleStatus(base, { now })).toBe('ON_SALE')
    expect(computeSaleStatus({ ...base, remaining: 0 }, { now })).toBe('SOLD_OUT')
    expect(computeSaleStatus({ ...base, requires_access_code: true }, { now })).toBe('ACCESS_REQUIRED')
    expect(computeSaleStatus({ ...base, requires_access_code: true }, { now, unlocked: true })).toBe('ON_SALE')
    expect(computeSaleStatus({ ...base, requires_access_code: true, remaining: 0 }, { now })).toBe('ACCESS_REQUIRED')
    expect(computeSaleStatus({ ...base, sale_starts_at: '2026-12-01T00:00:00Z' }, { now })).toBe('COMING_SOON')
    expect(computeSaleStatus({ ...base, sale_ends_at: '2026-10-01T00:00:00Z', requires_access_code: true }, { now })).toBe('SALES_ENDED')
  })

  it('the database and the server derive on-sale from the SAME half-open rule (SQL text pinned in cart.ts and the public detail)', () => {
    const cart = stripComments(read('lib/events/services/cart.ts'))
    expect(cart).toMatch(/\(sale_starts_at IS NULL OR sale_starts_at <= NOW\(\)\) AS sale_started/)
    expect(cart).toMatch(/\(sale_ends_at IS NOT NULL AND sale_ends_at <= NOW\(\)\) AS sale_ended/)
    const detail = stripComments(read('lib/events/publicEventDetail.ts'))
    expect(detail).toMatch(/WHEN tt\.sale_starts_at IS NOT NULL AND tt\.sale_starts_at > NOW\(\) THEN 'COMING_SOON'/)
    expect(detail).toMatch(/WHEN tt\.sale_ends_at IS NOT NULL AND tt\.sale_ends_at <= NOW\(\) THEN 'SALES_ENDED'/)
  })
})

describe('organiser validators (lib/events/validation.ts)', () => {
  const promo = { code: 'early20', discount_type: 'PERCENT', discount_value: 20 }
  it('promotion code: format 3–32, type, value ranges, optional window/limits, assignments', () => {
    expect(validateEventPromotionCodeInput(promo)).toBeNull()
    expect(validateEventPromotionCodeInput({ ...promo, code: 'ab' })).toMatch(/3–32 characters/)
    expect(validateEventPromotionCodeInput({ ...promo, code: 'has space' })).toMatch(/3–32 characters/)
    expect(validateEventPromotionCodeInput({ ...promo, discount_type: 'BOGO' })).toMatch(/Discount type must be one of/)
    expect(validateEventPromotionCodeInput({ ...promo, discount_value: 0 })).toMatch(/between 1 and 100/)
    expect(validateEventPromotionCodeInput({ ...promo, discount_value: 101 })).toMatch(/between 1 and 100/)
    expect(validateEventPromotionCodeInput({ ...promo, discount_value: 12.5 })).toMatch(/between 1 and 100/)
    expect(validateEventPromotionCodeInput({ ...promo, discount_type: 'FIXED', discount_value: 0 })).toMatch(/at least 1/)
    expect(validateEventPromotionCodeInput({ ...promo, discount_type: 'FIXED', discount_value: 1 })).toBeNull()
    expect(validateEventPromotionCodeInput({ ...promo, starts_at: '2026-11-02T00:00:00Z', ends_at: '2026-11-01T00:00:00Z' })).toMatch(/Expiry must be after the start/)
    expect(validateEventPromotionCodeInput({ ...promo, starts_at: 'not a date' })).toMatch(/valid date/)
    expect(validateEventPromotionCodeInput({ ...promo, max_redemptions: 0 })).toMatch(/at least 1/)
    expect(validateEventPromotionCodeInput({ ...promo, max_redemptions: null })).toBeNull()
    expect(validateEventPromotionCodeInput({ ...promo, min_cart_cents: -5 })).toMatch(/at least 1/)
    expect(validateEventPromotionCodeInput({ ...promo, ticket_type_ids: 'tt-1' })).toMatch(/list of ids/)
    expect(validateEventPromotionCodeInput({ ...promo, ticket_type_ids: ['a', 'a'] })).toMatch(/only once/)
    expect(validateEventPromotionCodeInput({ ...promo, active: 'yes' })).toMatch(/boolean/)
  })

  it('access code: minimum 8 characters (approval §3)', () => {
    expect(validateEventAccessCodeInput({ code: 'MEMBER25' })).toBeNull()
    expect(validateEventAccessCodeInput({ code: 'member25' })).toBeNull()
    expect(validateEventAccessCodeInput({ code: 'VIP10' })).toMatch(/8–32 characters/)
    expect(validateEventAccessCodeInput({ code: '' })).toBe('Code is required.')
    expect(validateEventAccessCodeInput({ code: 'MEMBER25', ends_at: '2020-01-01T00:00:00Z', starts_at: '2021-01-01T00:00:00Z' })).toMatch(/Expiry must be after/)
  })

  it('ticket type: optional sale window (close after open), optional boolean access flag; everything else unchanged', () => {
    const tt = { name: 'Adult', price_cents: 4000, capacity: 10 }
    expect(validateEventTicketTypeInput(tt)).toBeNull()
    expect(validateEventTicketTypeInput({ ...tt, sale_starts_at: '2026-11-01T00:00:00Z', sale_ends_at: '2026-11-02T00:00:00Z' })).toBeNull()
    expect(validateEventTicketTypeInput({ ...tt, sale_starts_at: '2026-11-02T00:00:00Z', sale_ends_at: '2026-11-01T00:00:00Z' })).toBe('Sales close must be after sales open.')
    expect(validateEventTicketTypeInput({ ...tt, sale_starts_at: '2026-11-01T00:00:00Z', sale_ends_at: '2026-11-01T00:00:00Z' })).toBe('Sales close must be after sales open.')
    expect(validateEventTicketTypeInput({ ...tt, sale_ends_at: 'soon' })).toMatch(/valid date/)
    expect(validateEventTicketTypeInput({ ...tt, sale_starts_at: null, sale_ends_at: '' })).toBeNull()
    expect(validateEventTicketTypeInput({ ...tt, requires_access_code: 'true' })).toMatch(/boolean/)
    // A window entirely in the past or future is legitimate configuration.
    expect(validateEventTicketTypeInput({ ...tt, sale_ends_at: '2000-01-01T00:00:00Z' })).toBeNull()
  })
})

describe('public validation — codes travel as TEXT only; a quote may have an empty selection', () => {
  const base = { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }], purchaser_name: 'Pat', purchaser_email: 'p@example.com', attendees: [{ ticket_type_id: 'tt-adult', name: 'Pat' }] }
  it('register/checkout bodies accept optional promotion_code / access_code strings, normalised; non-strings are a 400', () => {
    const v = validatePublicRegistrationInput({ ...base, promotion_code: ' early20 ', access_code: 'member25' })
    expect(typeof v === 'object' && v.promotion_code).toBe('EARLY20')
    expect(typeof v === 'object' && v.access_code).toBe('MEMBER25')
    const none = validatePublicRegistrationInput(base)
    expect(typeof none === 'object' && none.promotion_code).toBeNull()
    expect(typeof none === 'object' && none.access_code).toBeNull()
    expect(validatePublicRegistrationInput({ ...base, promotion_code: 20 })).toBe('Invalid promotion code.')
    expect(validatePublicRegistrationInput({ ...base, access_code: { code: 'x' } })).toBe('Invalid access code.')
    expect(validatePublicRegistrationInput({ ...base, promotion_code: 'A'.repeat(65) })).toBe('Invalid promotion code.')
  })

  it('the accepted shape has no discount/total/unlocked field — the server cannot be told a price', () => {
    const src = stripComments(read('lib/events/publicValidation.ts'))
    expect(src).not.toMatch(/discount_cents|total_cents|unlocked/)
  })

  it('quote: same cart rules (unique types, 20 cap); empty items allowed; codes normalised', () => {
    const q = validatePublicQuoteInput({ items: [], access_code: 'member25' })
    expect(q).toEqual({ items: [], event_session_id: null, quantity: 0, promotion_code: null, access_code: 'MEMBER25' })
    expect(validatePublicQuoteInput({ items: [{ ticket_type_id: 'a', quantity: 1 }, { ticket_type_id: 'a', quantity: 1 }] })).toBe('Each ticket type may appear only once in an order.')
    expect(validatePublicQuoteInput({ items: [{ ticket_type_id: 'a', quantity: 21 }] })).toMatch(/between 1 and 20/)
    expect(validatePublicQuoteInput({ items: 'x' })).toBe('Invalid ticket selection.')
    expect(validatePublicQuoteInput({ items: [{ ticket_type_id: 'a', quantity: 1 }], promotion_code: 5 })).toBe('Invalid promotion code.')
  })
})

// ─── SHARED CART / LOCK ORDER ──────────────────────────────────────────

describe('loadCartTicketTypes — sale windows and presale access enforced server-side at the database clock', () => {
  it('selects the on-sale verdict and access flag in the SAME tenant-scoped query (never the client clock)', async () => {
    resolver = ttRowsResolver([ADULT])
    await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }])
    expect(callText(0)).toMatch(/\(sale_starts_at IS NULL OR sale_starts_at <= NOW\(\)\) AS sale_started/)
    expect(callText(0)).toMatch(/\(sale_ends_at IS NOT NULL AND sale_ends_at <= NOW\(\)\) AS sale_ended/)
    // Phase 5A adds the fee-policy scalar subquery between the access flag
    // and FROM — same single tenant-scoped statement.
    expect(callText(0)).toMatch(/requires_access_code,\s*\n\s*\(SELECT to_jsonb\(p\) FROM ticketing_fee_policies p .*\) AS fee_policy\s*\n\s*FROM event_ticket_types\s*\n\s*WHERE organisation_id = .* AND event_id = .* AND id = ANY/)
  })

  it('SALE_NOT_STARTED / SALE_ENDED when ANY line is outside its window; ACCESS_CODE_REQUIRED when a restricted line is not unlocked', async () => {
    resolver = ttRowsResolver([ADULT, { ...VIP, sale_started: false }])
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }, { ticket_type_id: 'tt-vip', quantity: 1 }])).toEqual({ ok: false, code: 'SALE_NOT_STARTED' })
    resolver = ttRowsResolver([{ ...ADULT, sale_ended: true }])
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }])).toEqual({ ok: false, code: 'SALE_ENDED' })
    resolver = ttRowsResolver([{ ...VIP, requires_access_code: true }])
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-vip', quantity: 1 }])).toEqual({ ok: false, code: 'ACCESS_CODE_REQUIRED' })
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-vip', quantity: 1 }], { accessGrant: { id: 'ac', code: 'MEMBER25', ticket_type_ids: ['tt-adult'] } })).toEqual({ ok: false, code: 'ACCESS_CODE_REQUIRED' })
    const ok = await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-vip', quantity: 1 }], { accessGrant: { id: 'ac', code: 'MEMBER25', ticket_type_ids: [] } })
    expect(ok.ok).toBe(true)
  })

  it('check order: not found < inactive < sale window < access < mixed pricing < currency', async () => {
    resolver = ttRowsResolver([{ ...ADULT, active: false, sale_started: false, requires_access_code: true }])
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }])).toEqual({ ok: false, code: 'TICKET_TYPE_INACTIVE' })
    resolver = ttRowsResolver([{ ...ADULT, sale_started: false, requires_access_code: true }])
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }])).toEqual({ ok: false, code: 'SALE_NOT_STARTED' })
    resolver = ttRowsResolver([{ ...ADULT, requires_access_code: true }, FREE_TT])
    expect(await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }, { ticket_type_id: 'tt-free', quantity: 1 }])).toEqual({ ok: false, code: 'ACCESS_CODE_REQUIRED' })
  })

  it('G: a row with NONE of the Phase 4 fields (a pre-Phase-4 caller/fixture) reads as unrestricted — existing behaviour unchanged', async () => {
    resolver = ttRowsResolver([{ id: 'tt-adult', active: true, price_cents: 4000, currency: 'AUD', name: 'Adult' }])
    const r = await loadCartTicketTypes('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 2 }])
    // Phase 5A: a row with no fee_policy column reads as feePolicyRow null
    // — the platform default, no fee.
    expect(r).toEqual({ ok: true, pricing: 'PAID', currency: 'AUD', lines: [{ ticket_type_id: 'tt-adult', name: 'Adult', quantity: 2, unit_price_cents: 4000, currency: 'AUD' }], feePolicyRow: null })
  })
})

describe('buildCartLockStatements — the promotion code row is the LAST lock tier', () => {
  it('no promotion: identical statements to Phase 3 (types asc, pairs asc, session)', () => {
    const statements = buildCartLockStatements('org-a', ['tt-vip', 'tt-adult'], 'sess-fri')
    expect(statements).toHaveLength(5)
    expect(allTexts().some(t => /event_promotion_codes/.test(t))).toBe(false)
    const none = buildCartLockStatements('org-a', ['tt-vip', 'tt-adult'], 'sess-fri', null)
    expect(none).toHaveLength(5)
  })

  it('with a promotion: one extra FOR UPDATE on the code row AFTER every inventory lock, scoped by organisation', () => {
    const statements = buildCartLockStatements('org-a', ['tt-vip', 'tt-adult'], 'sess-fri', 'promo-1')
    expect(statements).toHaveLength(6)
    expect(callText(5)).toMatch(/SELECT max_redemptions FROM event_promotion_codes WHERE id = .* AND organisation_id = .* FOR UPDATE/)
    expect(callArgs(5)).toEqual(['promo-1', 'org-a'])
    expect(allTexts().slice(0, 5).some(t => /event_promotion_codes/.test(t))).toBe(false)
    const noSession = buildCartLockStatements('org-a', ['tt-adult'], null, 'promo-1')
    expect(noSession).toHaveLength(2)
    expect(callText(7)).toMatch(/event_promotion_codes .* FOR UPDATE/)
  })
})

// ─── RESERVATION FLOWS ─────────────────────────────────────────────────

describe('paid checkout with a promotion code — snapshot, lock tier, gate predicates, Stripe reconciliation', () => {
  it("reserves the brief's cart at $198: locks the code last, gates on the D3 redemption count, writes discount_cents/promotion snapshot/per-line discounts, sends net line items summing to total_cents", async () => {
    resolver = combine(ttRowsResolver([ADULT, CHILD, VIP]), promoResolver, stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor(ITEMS, { promotion_code: 'early20' }), buildReturnUrls: URLS })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/1' })

    // Code resolved by (organisation, event, normalised code) with active/window filters.
    const promoIdx = findCall(/FROM event_promotion_codes pc/)
    expect(callArgs(promoIdx)).toEqual(['org-a', 'event-1', 'EARLY20'])
    expect(callText(promoIdx)).toMatch(/pc\.active = true\s*\n\s*AND \(pc\.starts_at IS NULL OR pc\.starts_at <= NOW\(\)\)\s*\n\s*AND \(pc\.ends_at IS NULL OR pc\.ends_at > NOW\(\)\)/)

    // Transaction: 3 type locks, then the promotion row, then the gate.
    const tx = transactionTexts()
    expect(tx).toHaveLength(5)
    expect(tx.slice(0, 3).every(t => /FROM event_ticket_types WHERE id = .* FOR UPDATE/.test(t))).toBe(true)
    expect(tx[3]).toMatch(/FROM event_promotion_codes WHERE id = .* AND organisation_id = .* FOR UPDATE/)
    const gate = tx[4]
    expect(gate).toMatch(/UNNEST\(.*::text\[\], .*::int\[\], .*::int\[\], .*::int\[\]\) AS c\(ticket_type_id, quantity, unit_price_cents, discount_cents\)/)
    expect(gate).toContain('NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)')
    expect(gate).toContain('NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)')
    expect(gate).toContain(REDEMPTION_COUNTS_PREDICATE_SQL)
    expect(gate).toMatch(/\) \+ 1 <= pc\.max_redemptions\)/)
    expect(gate).toMatch(/INSERT INTO event_orders \([\s\S]*discount_cents, promotion_code_id, promotion_code_snapshot, access_code_id, access_code_snapshot,\s*\n\s*product_surface\s*\n\s*\)/)
    expect(gate).toMatch(/INSERT INTO event_order_items \(organisation_id, order_id, event_id, ticket_type_id, event_session_id, quantity, unit_price_cents, discount_cents\)/)
    const gateIdx = findCall(/INSERT INTO event_orders/)
    const args = callArgs(gateIdx)
    expect(args).toContainEqual([800, 400, 1000]) // per-line discounts
    expect(args).toContain(19800) // total_cents = payable
    expect(args).toContain(2200) // discount_cents
    expect(args).toContain('promo-1')
    expect(args).toContain('EARLY20')

    // Stripe gets net line items whose sum is exactly total_cents.
    const input = createCheckoutSessionMock.mock.calls[0][0] as { lineItems: { name: string; unitAmountCents: number; quantity: number; description?: string }[]; currency: string }
    expect(input.lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(19800)
    expect(input.lineItems.map(it => it.quantity)).toEqual([1, 1, 1])
    expect(input.lineItems[0].description).toContain('(EARLY20)')
  })

  it('without a promotion: no code lock, discounts all 0, total = gross, Stripe line items exactly as Phase 2 (quantity preserved, no description) — G', async () => {
    resolver = combine(ttRowsResolver([ADULT, CHILD, VIP]), stampResolver, writeBackResolver)
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor(ITEMS), buildReturnUrls: URLS })
    expect(res.ok).toBe(true)
    expect(allTexts().some(t => /FROM event_promotion_codes WHERE id = .* FOR UPDATE/.test(t))).toBe(false)
    expect(allTexts().some(t => /FROM event_promotion_codes pc\s*\n\s*WHERE pc\.organisation_id/.test(t))).toBe(false)
    expect(transactionTexts()).toHaveLength(4)
    const args = callArgs(findCall(/INSERT INTO event_orders/))
    expect(args).toContainEqual([0, 0, 0])
    expect(args).toContain(22000)
    expect(args).toContain(0)
    const input = createCheckoutSessionMock.mock.calls[0][0] as { lineItems: { name: string; unitAmountCents: number; quantity: number; description?: string }[] }
    expect(input.lineItems).toEqual([
      { name: 'Adult', unitAmountCents: 4000, quantity: 2 },
      { name: 'Child', unitAmountCents: 2000, quantity: 2 },
      { name: 'VIP', unitAmountCents: 10000, quantity: 1 },
    ])
  })

  it('an unknown / inactive / other-event code -> PROMOTION_INVALID before any reservation; 100% -> PROMOTION_TOTAL_TOO_LOW; both leave no transaction', async () => {
    resolver = ttRowsResolver([ADULT, CHILD, VIP])
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor(ITEMS, { promotion_code: 'NOPE' }), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'PROMOTION_INVALID' })
    resolver = combine(ttRowsResolver([ADULT, CHILD, VIP]), text => (/FROM event_promotion_codes pc/.test(text) ? [{ ...PROMO_ROW, discount_value: 100 }] : undefined))
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor(ITEMS, { promotion_code: 'EARLY20' }), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'PROMOTION_TOTAL_TOO_LOW' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('a zero-row gate with a promotion is diagnosed read-only: PROMOTION_UNAVAILABLE when the code no longer has room, CAPACITY_UNAVAILABLE otherwise', async () => {
    resolver = combine(ttRowsResolver([ADULT]), promoResolver, text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [] : undefined))
    transactionFinalResult = []
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([ITEMS[0]], { promotion_code: 'EARLY20' }), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'PROMOTION_UNAVAILABLE' })
    const check = callText(findCall(/SELECT 1 AS ok FROM event_promotion_codes pc/))
    expect(check).toContain(REDEMPTION_COUNTS_PREDICATE_SQL)
    expect(check).not.toMatch(/INSERT|UPDATE|FOR UPDATE/)
    resolver = combine(ttRowsResolver([ADULT]), promoResolver, text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [{ ok: 1 }] : undefined))
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([ITEMS[0]], { promotion_code: 'EARLY20' }), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'CAPACITY_UNAVAILABLE' })
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('an access code is resolved server-side; an invalid one is ACCESS_CODE_INVALID; a valid one is snapshotted onto the order and re-asserted inside the gate', async () => {
    resolver = combine(ttRowsResolver([{ ...VIP, requires_access_code: true }]), text => (/FROM event_access_codes ac\s*\n\s*WHERE ac\.organisation_id/.test(text) ? [] : undefined))
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([ITEMS[2]], { access_code: 'WRONGCODE1' }), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'ACCESS_CODE_INVALID' })
    expect(transactionMock).not.toHaveBeenCalled()
    sqlMock.mockClear()

    resolver = combine(
      ttRowsResolver([{ ...VIP, requires_access_code: true }]),
      text => (/FROM event_access_codes ac\s*\n\s*WHERE ac\.organisation_id/.test(text) ? [{ id: 'access-1', code: 'MEMBERS2026', ticket_type_ids: ['tt-vip'] }] : undefined),
      stampResolver, writeBackResolver,
    )
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1' }]
    const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([ITEMS[2]], { access_code: 'members2026' }), buildReturnUrls: URLS })
    expect(res.ok).toBe(true)
    const accessIdx = findCall(/FROM event_access_codes ac\s*\n\s*WHERE ac\.organisation_id/)
    expect(callArgs(accessIdx)).toEqual(['org-a', 'event-1', 'MEMBERS2026'])
    const gateIdx = findCall(/INSERT INTO event_orders/)
    expect(callText(gateIdx)).toMatch(/NOT tt\.requires_access_code\s*\n\s*OR EXISTS \(\s*\n\s*SELECT 1 FROM event_access_codes ac\s*\n\s*WHERE ac\.id = .* AND ac\.organisation_id = .* AND ac\.event_id = /)
    expect(callArgs(gateIdx)).toContain('access-1')
    expect(callArgs(gateIdx)).toContain('MEMBERS2026')
  })

  it('a restricted type without a code never reaches the database write path (ACCESS_CODE_REQUIRED from the pre-check)', async () => {
    resolver = ttRowsResolver([{ ...VIP, requires_access_code: true }])
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([ITEMS[2]]), buildReturnUrls: URLS })).toEqual({ ok: false, code: 'ACCESS_CODE_REQUIRED' })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('Stripe line items are built and reconciled BEFORE the reservation (a mismatch can never leave a hold behind)', () => {
    const src = stripComments(read('lib/events/services/paidCheckout.ts'))
    expect(src.indexOf('assertCheckoutLineItemsTotal(stripeLineItems, totalCents)')).toBeLessThan(src.indexOf('sql.transaction(['))
    expect(src).toMatch(/const totalCents = computeCartTotalCents\(cart\.lines\) - discountCents/)
    expect(src).toMatch(/lineItems: stripeLineItems/)
    // The transaction commits before Stripe is contacted — unchanged.
    expect(src.indexOf('sql.transaction([')).toBeLessThan(src.indexOf('createCheckoutSession({'))
  })
})

describe('free registration — access codes apply, promotion codes do not; the gate re-asserts purchasable', () => {
  it('a promotion code on a free cart is PROMOTION_NOT_APPLICABLE (never silently ignored, never a redemption)', async () => {
    resolver = ttRowsResolver([FREE_TT])
    expect(await registerFreeOrder({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-free', quantity: 1 }], { promotion_code: 'EARLY20' }) })).toEqual({ ok: false, code: 'PROMOTION_NOT_APPLICABLE' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(allTexts().some(t => /event_promotion_codes/.test(t))).toBe(false)
  })

  it('a valid access code unlocks a restricted free type and is snapshotted; the single INSERT still binds ticket_email_status = pending', async () => {
    resolver = combine(
      ttRowsResolver([{ ...FREE_TT, requires_access_code: true }]),
      text => (/FROM event_access_codes ac\s*\n\s*WHERE ac\.organisation_id/.test(text) ? [{ id: 'access-1', code: 'MEMBERS2026', ticket_type_ids: null }] : undefined),
    )
    transactionFinalResult = [{ id: 'att-1', order_id: 'order-1', attendee_name: 'tt-free-0', ticket_token: 'tok' }]
    const res = await registerFreeOrder({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor([{ ticket_type_id: 'tt-free', quantity: 1 }], { access_code: 'MEMBERS2026' }) })
    expect(res.ok).toBe(true)
    const gateIdx = findCall(/INSERT INTO event_orders/)
    expect(callText(gateIdx)).toMatch(/INSERT INTO event_orders \(organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, booking_token, ticket_email_status, access_code_id, access_code_snapshot, product_surface\)/)
    expect(callText(gateIdx)).toContain('NOT EXISTS (SELECT 1 FROM cart_tt WHERE NOT cart_tt.purchasable)')
    expect(callArgs(gateIdx)).toContain('access-1')
    expect(callArgs(gateIdx)).toContain('MEMBERS2026')
    // Free orders never lock or reference a promotion code.
    expect(transactionTexts().some(t => /event_promotion_codes/.test(t))).toBe(false)
  })

  it('the three flows share one purchasable rule text (active + half-open window + access EXISTS)', () => {
    const PURCHASABLE = /tt\.active\s*\n\s*AND \(tt\.sale_starts_at IS NULL OR tt\.sale_starts_at <= NOW\(\)\)\s*\n\s*AND \(tt\.sale_ends_at IS NULL OR tt\.sale_ends_at > NOW\(\)\)/
    for (const f of ['lib/events/services/freeRegistration.ts', 'lib/events/services/paidCheckout.ts']) {
      expect(read(f)).toMatch(PURCHASABLE)
      expect(read(f)).toMatch(/NOT EXISTS \(SELECT 1 FROM event_access_code_ticket_types att WHERE att\.access_code_id = ac\.id AND att\.organisation_id = ac\.organisation_id\)\s*\n\s*OR EXISTS \(SELECT 1 FROM event_access_code_ticket_types att WHERE att\.access_code_id = ac\.id AND att\.organisation_id = ac\.organisation_id AND att\.ticket_type_id = tt\.id\)/)
    }
  })
})

describe('retry — committed snapshot, redemption limit re-checked excluding itself, never recalculated (approval D4)', () => {
  const EVENT_ROW = [{ id: 'event-1', status: 'PUBLISHED', event_slug: 'gala', org_slug: 'org-a' }]
  const ORDER = { id: 'order-1', payment_status: 'PENDING', purchaser_email: 'p@example.com', total_cents: 19800, currency: 'AUD', stripe_account_id: 'acct_org_a', stripe_checkout_session_id: null, expires_at: null, expires_at_stamp: '1', discount_cents: 2200, promotion_code_id: 'promo-1' as string | null, promotion_code_snapshot: 'EARLY20' as string | null }
  const ITEM_ROWS = [
    { ticket_type_id: 'tt-adult', event_session_id: null, quantity: 2, unit_price_cents: 4000, discount_cents: 800 },
    { ticket_type_id: 'tt-child', event_session_id: null, quantity: 2, unit_price_cents: 2000, discount_cents: 400 },
    { ticket_type_id: 'tt-vip', event_session_id: null, quantity: 1, unit_price_cents: 10000, discount_cents: 1000 },
  ]
  // Prices changed since — retry must ignore them.
  const TT_ROWS = [{ id: 'tt-adult', name: 'Adult', active: true, price_cents: 9999, currency: 'AUD' }, { id: 'tt-child', name: 'Child', active: true, price_cents: 1, currency: 'AUD' }, { id: 'tt-vip', name: 'VIP', active: true, price_cents: 5, currency: 'AUD' }]
  function retryResolver(order = ORDER, items = ITEM_ROWS): Resolver {
    return combine(
      text => (/FROM events e JOIN organisations o/.test(text) ? EVENT_ROW : undefined),
      text => (/discount_cents, promotion_code_id, promotion_code_snapshot, product_surface\s*\n\s*FROM event_orders WHERE id = /.test(text) ? [order] : undefined),
      text => (/SELECT ticket_type_id, event_session_id, quantity, unit_price_cents, discount_cents FROM event_order_items/.test(text) ? items : undefined),
      text => (/SELECT id, name, active, price_cents, currency FROM event_ticket_types/.test(text) ? TT_ROWS : undefined),
      writeBackResolver,
    )
  }

  it('charges exactly the committed total from stored gross prices and per-line discounts (not current prices, not current promotion rules); locks the code last; gate excludes this order and checks only max_redemptions', async () => {
    resolver = retryResolver()
    transactionFinalResult = [{ id: 'order-1', expires_at: 'x', expires_at_stamp: '2' }]
    const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: URLS })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/1' })
    const input = createCheckoutSessionMock.mock.calls[0][0] as { lineItems: { unitAmountCents: number; quantity: number; description?: string }[] }
    expect(input.lineItems.reduce((s, it) => s + it.unitAmountCents * it.quantity, 0)).toBe(19800)
    expect(input.lineItems[0].description).toContain('(EARLY20)')
    expect(allTexts().some(t => /FROM event_promotion_codes pc\s*\n\s*WHERE pc\.organisation_id/.test(t))).toBe(false) // never re-resolves the code's rules
    const tx = transactionTexts()
    expect(tx).toHaveLength(5)
    expect(tx[3]).toMatch(/FROM event_promotion_codes WHERE id = .* AND organisation_id = .* FOR UPDATE/)
    const upd = tx[4]
    const promoClause = upd.slice(upd.indexOf('OR EXISTS (\n              SELECT 1 FROM event_promotion_codes pc'))
    expect(promoClause).toMatch(/ro\.id <> \$?\{?orderId\}?|ro\.id <> /)
    expect(promoClause).toContain("(ro.payment_status IN ('PAID', 'REFUNDED') OR (ro.status <> 'CANCELLED' AND (ro.payment_status <> 'PENDING' OR ro.expires_at > NOW())))")
    expect(promoClause).not.toMatch(/pc\.active|pc\.starts_at|pc\.ends_at/)
    // Still never an INSERT anywhere in retry.
    expect(stripComments(read('lib/events/services/retryCheckout.ts'))).not.toMatch(/INSERT INTO event_(orders|order_items|attendees)/)
  })

  it('fails closed with ORDER_TOTAL_MISMATCH — before any mutation or Stripe call — when the stored lines do not reconcile with total_cents or discount_cents', async () => {
    resolver = retryResolver({ ...ORDER, total_cents: 19801 })
    expect(await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: URLS })).toEqual({ ok: false, code: 'ORDER_TOTAL_MISMATCH' })
    resolver = retryResolver({ ...ORDER, discount_cents: 2199 })
    expect(await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: URLS })).toEqual({ ok: false, code: 'ORDER_TOTAL_MISMATCH' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('a zero-row reacquisition with a promotion is diagnosed (excluding this order) as PROMOTION_UNAVAILABLE, otherwise CAPACITY_UNAVAILABLE', async () => {
    resolver = combine(retryResolver(), text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [] : undefined))
    transactionFinalResult = []
    expect(await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: URLS })).toEqual({ ok: false, code: 'PROMOTION_UNAVAILABLE' })
    expect(callArgs(findCall(/SELECT 1 AS ok FROM event_promotion_codes pc/))).toContain('order-1')
    resolver = combine(retryResolver(), text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [{ ok: 1 }] : undefined))
    expect(await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: URLS })).toEqual({ ok: false, code: 'CAPACITY_UNAVAILABLE' })
  })

  it('G: an order without a promotion retries exactly as before (4 statements, no code lock, Phase 2 line items)', async () => {
    resolver = retryResolver({ ...ORDER, total_cents: 22000, discount_cents: 0, promotion_code_id: null, promotion_code_snapshot: null }, ITEM_ROWS.map(it => ({ ...it, discount_cents: 0 })))
    transactionFinalResult = [{ id: 'order-1', expires_at: 'x', expires_at_stamp: '2' }]
    const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: 'order-1', buildReturnUrls: URLS })
    expect(res.ok).toBe(true)
    expect(transactionTexts()).toHaveLength(4)
    const input = createCheckoutSessionMock.mock.calls[0][0] as { lineItems: unknown[] }
    expect(input.lineItems).toEqual([
      { name: 'Adult', unitAmountCents: 4000, quantity: 2 },
      { name: 'Child', unitAmountCents: 2000, quantity: 2 },
      { name: 'VIP', unitAmountCents: 10000, quantity: 1 },
    ])
  })
})

describe('webhook & refund paths are unchanged — redemption accounting needs no new write', () => {
  it('lib/events/stripe.ts writes nothing promotion-related (no INSERT, no promotion table) — a replayed webhook cannot double-count', () => {
    const src = stripComments(read('lib/events/stripe.ts'))
    expect(src).not.toMatch(/event_promotion|event_access|discount_cents|redemption/)
  })
  it('orderTransitions (refund/cancel) are untouched — a refunded order keeps payment_status REFUNDED and therefore keeps counting (D3)', () => {
    const src = stripComments(read('lib/events/services/orderTransitions.ts'))
    expect(src).not.toMatch(/event_promotion|promotion_code|discount_cents/)
    expect(src).toMatch(/payment_status = 'REFUNDED'/)
    expect(REDEMPTION_COUNTS_PREDICATE_SQL).toContain("eo.payment_status IN ('PAID', 'REFUNDED')")
  })
  it('the redemption predicate is exactly the capacity stale-hold predicate plus "paid/refunded always count"', () => {
    expect(REDEMPTION_COUNTS_PREDICATE_SQL).toBe("(eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())))")
    const promo = stripComments(read('lib/events/services/promotions.ts'))
    expect((promo.match(/eo\.payment_status IN \('PAID', 'REFUNDED'\)/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

// ─── PUBLIC API ────────────────────────────────────────────────────────

describe('POST .../quote — read-only server pricing with generic code feedback', () => {
  it("prices the brief's cart with EARLY20 and returns subtotal/discount/total + per-line discounts; reserves nothing", async () => {
    resolver = combine(ttRowsResolver([ADULT, CHILD, VIP]), promoResolver, text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [{ ok: 1 }] : undefined))
    const res = await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: ITEMS, promotion_code: 'early20' }), SLUG_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ subtotal_cents: 22000, discount_cents: 2200, total_cents: 19800, currency: 'AUD', pricing: 'PAID', promotion: { code: 'EARLY20' }, promotion_error: null, access: null, access_error: null, cart_error: null })
    expect(body.lines).toEqual([
      { ticket_type_id: 'tt-adult', quantity: 2, gross_cents: 8000, discount_cents: 800 },
      { ticket_type_id: 'tt-child', quantity: 2, gross_cents: 4000, discount_cents: 400 },
      { ticket_type_id: 'tt-vip', quantity: 1, gross_cents: 10000, discount_cents: 1000 },
    ])
    expect(allTexts().some(t => /INSERT|UPDATE|FOR UPDATE/.test(t))).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('every code failure is the same generic text: unknown promo, exhausted promo, invalid access, promo on a free cart', async () => {
    resolver = ttRowsResolver([ADULT])
    let body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [ITEMS[0]], promotion_code: 'NOPE' }), SLUG_CTX)).json()
    expect(body.promotion_error).toBe('Code not valid.')
    expect(body.discount_cents).toBe(0)
    expect(body.total_cents).toBe(8000)
    resolver = combine(ttRowsResolver([ADULT]), promoResolver, text => (/SELECT 1 AS ok FROM event_promotion_codes pc/.test(text) ? [] : undefined))
    body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [ITEMS[0]], promotion_code: 'EARLY20' }), SLUG_CTX)).json()
    expect(body.promotion_error).toBe('This code is no longer available.')
    resolver = combine(ttRowsResolver([ADULT]), text => (/FROM event_access_codes ac\s*\n\s*WHERE ac\.organisation_id/.test(text) ? [] : undefined))
    body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [ITEMS[0]], access_code: 'OTHERORGCODE' }), SLUG_CTX)).json()
    expect(body.access_error).toBe('Code not valid.')
    expect(body.access).toBeNull()
    sqlMock.mockClear()
    resolver = ttRowsResolver([FREE_TT])
    body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-free', quantity: 1 }], promotion_code: 'EARLY20' }), SLUG_CTX)).json()
    expect(body.promotion_error).toBe("This code can't be applied to this order.")
    expect(allTexts().some(t => /event_promotion_codes/.test(t))).toBe(false) // never even looked up for a free cart
  })

  it('an access code with an empty selection reports which restricted types it unlocks (nothing priced)', async () => {
    resolver = combine(
      text => (/FROM event_access_codes ac\s*\n\s*WHERE ac\.organisation_id/.test(text) ? [{ id: 'access-1', code: 'MEMBERS2026', ticket_type_ids: ['tt-vip'] }] : undefined),
      text => (/requires_access_code = true/.test(text) ? [{ id: 'tt-vip' }, { id: 'tt-early' }] : undefined),
    )
    const body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [], access_code: 'members2026' }), SLUG_CTX)).json()
    expect(body).toMatchObject({ subtotal_cents: 0, total_cents: 0, access: { unlocked_ticket_type_ids: ['tt-vip'] }, access_error: null, cart_error: null })
    expect(allTexts().some(t => /FROM event_ticket_types\s*\n\s*WHERE organisation_id = .* AND id = ANY/.test(t))).toBe(false)
  })

  it('a selection outside its window / needing a code returns the same server-side cart message the submit routes would', async () => {
    resolver = ttRowsResolver([{ ...ADULT, sale_ended: true }])
    expect((await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [ITEMS[0]], promotion_code: 'EARLY20' }), SLUG_CTX)).json()).cart_error).toBe('Sales for this selection have ended.')
    resolver = ttRowsResolver([{ ...VIP, requires_access_code: true }])
    expect((await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [ITEMS[2]] }), SLUG_CTX)).json()).cart_error).toBe('An access code is required for this selection.')
  })

  it('malformed body -> 400; the response never carries organisation ids', async () => {
    expect((await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'a', quantity: 0 }] }), SLUG_CTX)).status).toBe(400)
    resolver = ttRowsResolver([ADULT])
    const text = JSON.stringify(await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [ITEMS[0]] }), SLUG_CTX)).json())
    expect(text).not.toMatch(/org-a|organisation_id/)
  })

  it('is rate limited separately from register/checkout (30 per 10 minutes per IP + event) and documents the in-memory limiter as a platform limitation, not distributed protection', () => {
    const src = read('app/api/public/events/[organisationSlug]/[eventSlug]/quote/route.ts')
    expect(src).toMatch(/checkRateLimit\(`public-events-quote:\$\{organisationSlug\}:\$\{eventSlug\}:\$\{ip\}`, 30, 10 \* 60_000\)/)
    expect(src).toMatch(/per-instance in-memory[\s\S]*not\s*\n?\/\/\s*distributed protection/)
  })

  it('register / checkout / retry adapters map every Phase 4 code; code failures are generic, window failures are 409', () => {
    const register = read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts') + read('lib/events/freeRegistrationResponse.ts')
    const checkout = (read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts') + read('lib/events/paidCheckoutResponse.ts'))
    const retry = read('app/api/events/[id]/orders/[orderId]/retry/route.ts')
    for (const src of [register, checkout]) {
      expect(src).toMatch(/case 'SALE_NOT_STARTED':\s*\n\s*return NextResponse\.json\(\{ error: 'Tickets for this selection are not on sale yet\.' \}, \{ status: 409 \}\)/)
      expect(src).toMatch(/case 'SALE_ENDED':\s*\n\s*return NextResponse\.json\(\{ error: 'Sales for this selection have ended\.' \}, \{ status: 409 \}\)/)
      expect(src).toMatch(/case 'ACCESS_CODE_INVALID':[\s\S]{0,160}'Code not valid\.'/)
    }
    expect(checkout).toMatch(/case 'PROMOTION_INVALID':\s*\n\s*return NextResponse\.json\(\{ error: 'Code not valid\.' \}/)
    expect(checkout).toMatch(/case 'PROMOTION_TOTAL_TOO_LOW':\s*\n\s*case 'PROMOTION_CURRENCY_UNSUPPORTED':\s*\n\s*return NextResponse\.json\(\{ error: "This code can't be applied to this order\." \}, \{ status: 400 \}\)/)
    expect(checkout).toMatch(/case 'PROMOTION_UNAVAILABLE':\s*\n\s*return NextResponse\.json\(\{ error: 'This code is no longer available\.' \}, \{ status: 409 \}\)/)
    expect(checkout).toMatch(/case 'ORDER_TOTAL_MISMATCH':\s*\n\s*case 'RESERVATION_FAILED':/)
    expect(retry).toMatch(/case 'PROMOTION_UNAVAILABLE':/)
    expect(retry).toMatch(/case 'ORDER_TOTAL_MISMATCH':/)
  })
})

describe('GET public event detail — sale window fields, server verdict, restricted types listed not hidden, has_promotions flag', () => {
  it('returns sale_starts_at/sale_ends_at/sale_status/requires_access_code per type and has_promotions for the event; never a code', async () => {
    resolver = combine(
      text => (/FROM event_ticket_types tt\s*\n\s*WHERE tt\.event_id/.test(text)
        ? [{ id: 'tt-vip', name: 'VIP', description: null, price_cents: 10000, capacity: 10, remaining: 3, sale_starts_at: new Date('2026-11-01T00:00:00Z'), sale_ends_at: null, requires_access_code: true, sale_status: 'ON_SALE' }]
        : undefined),
      text => (/SELECT 1 AS live FROM event_promotion_codes pc/.test(text) ? [{ live: 1 }] : undefined),
    )
    const result = await getPublicEventDetail('org-a', 'gala')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.ticket_types[0]).toMatchObject({ id: 'tt-vip', sale_starts_at: '2026-11-01T00:00:00.000Z', sale_ends_at: null, requires_access_code: true, sale_status: 'ON_SALE', remaining: 3 })
    expect(result.detail.has_promotions).toBe(true)
    const promoIdx = findCall(/SELECT 1 AS live FROM event_promotion_codes pc/)
    expect(callText(promoIdx)).toMatch(/pc\.active = true\s*\n\s*AND \(pc\.starts_at IS NULL OR pc\.starts_at <= NOW\(\)\) AND \(pc\.ends_at IS NULL OR pc\.ends_at > NOW\(\)\)/)
    expect(callText(promoIdx)).not.toMatch(/pc\.code/)
    expect(JSON.stringify(result.detail)).not.toMatch(/EARLY20|organisation_id/)
    // The ticket-type query still lists restricted types (no requires_access_code filter).
    expect(callText(findCall(/FROM event_ticket_types tt\s*\n\s*WHERE tt\.event_id/))).not.toMatch(/requires_access_code = false/)
  })
})

// ─── ORGANISER API ─────────────────────────────────────────────────────

const OWNED_EVENT: Resolver = text => (/SELECT id FROM events WHERE id = .* AND organisation_id = .* LIMIT 1/.test(text) ? [{ id: 'event-1' }] : undefined)
const OWNED_TYPES: Resolver = (text, args) => (/SELECT id FROM event_ticket_types\s*\n\s*WHERE id = ANY/.test(text) ? (args[0] as string[]).filter(id => ['tt-adult', 'tt-vip'].includes(id)).map(id => ({ id })) : undefined)
const NO_DUP: Resolver = text => (/SELECT id FROM event_(promotion|access)_codes WHERE organisation_id = .* AND event_id = .* AND code = .* LIMIT 1/.test(text) ? [] : undefined)
const CREATED_PROMO = { id: 'promo-1', organisation_id: 'org-a', event_id: 'event-1', code: 'EARLY20', discount_type: 'PERCENT', discount_value: 20, active: true, starts_at: null, ends_at: null, max_redemptions: 10, min_cart_cents: null, created_at: 'c', updated_at: 'u', ticket_type_ids: ['tt-vip'] }

describe('promotions API — /api/events/[id]/promotions', () => {
  const URL = 'http://localhost/api/events/event-1/promotions'
  const BODY = { code: 'early20', discount_type: 'PERCENT', discount_value: 20, max_redemptions: 10, ticket_type_ids: ['tt-vip'] }

  it('manager creates a code: normalised upper-case, single statement for row + assignments, audit event_promotion_code.created with the code in full', async () => {
    resolver = combine(OWNED_EVENT, OWNED_TYPES, NO_DUP, text => (/INSERT INTO event_promotion_codes/.test(text) ? [CREATED_PROMO] : undefined))
    const res = await promotionsRoute.POST(jsonReq(URL, 'POST', BODY), EVENT_CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.promotion).toMatchObject({ id: 'promo-1', code: 'EARLY20', ticket_type_ids: ['tt-vip'], redeemed_count: 0, pending_count: 0 })
    const insIdx = findCall(/INSERT INTO event_promotion_codes/)
    expect(callText(insIdx)).toMatch(/WITH ins AS \(\s*\n\s*INSERT INTO event_promotion_codes \(organisation_id, event_id, code, discount_type, discount_value, active, starts_at, ends_at, max_redemptions, min_cart_cents\)/)
    expect(callText(insIdx)).toMatch(/INSERT INTO event_promotion_code_ticket_types \(promotion_code_id, ticket_type_id, event_id, organisation_id\)\s*\n\s*SELECT ins\.id, u\.ticket_type_id, .*, .* FROM ins, UNNEST\(.*::text\[\]\)/)
    expect(callArgs(insIdx)).toEqual(['org-a', 'event-1', 'EARLY20', 'PERCENT', 20, true, null, null, 10, null, 'event-1', 'org-a', ['tt-vip']])
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ organisationId: 'org-a', userId: 'staff-1', action: 'event_promotion_code.created', resourceType: 'event_promotion_code', resourceId: 'promo-1', before: null })
    expect(audits[0].after).toMatchObject({ event_id: 'event-1', code: 'EARLY20', discount_type: 'PERCENT', discount_value: 20, max_redemptions: 10, ticket_type_ids: 'tt-vip' })
  })

  it('viewer may list (with D3 redemption counts) but not create; unauthenticated 401; wrong organisation 404; nothing written', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    resolver = combine(OWNED_EVENT, text => (/FROM event_promotion_codes pc\s*\n\s*WHERE pc\.event_id/.test(text) ? [{ ...CREATED_PROMO, redeemed_count: 3, pending_count: 1 }] : undefined))
    const list = await promotionsRoute.GET(jsonReq(URL, 'GET'), EVENT_CTX)
    expect(list.status).toBe(200)
    expect((await list.json()).promotions[0]).toMatchObject({ code: 'EARLY20', redeemed_count: 3, pending_count: 1 })
    const listText = callText(findCall(/FROM event_promotion_codes pc\s*\n\s*WHERE pc\.event_id/))
    expect(listText).toMatch(/eo\.payment_status IN \('PAID', 'REFUNDED'\) OR \(eo\.status <> 'CANCELLED' AND eo\.payment_status = 'NOT_REQUIRED'\)\)\)::int AS redeemed_count/)
    expect(listText).toMatch(/eo\.status <> 'CANCELLED' AND eo\.payment_status = 'PENDING' AND eo\.expires_at > NOW\(\)\)::int AS pending_count/)
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', BODY), EVENT_CTX)).status).toBe(403)

    requireSessionMock.mockRejectedValue(new Error('no session'))
    expect((await promotionsRoute.GET(jsonReq(URL, 'GET'), EVENT_CTX)).status).toBe(401)
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', BODY), EVENT_CTX)).status).toBe(401)

    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-b'))
    resolver = () => [] // the event is not org-b's
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', BODY), EVENT_CTX)).status).toBe(404)
    expect((await promotionsRoute.GET(jsonReq(URL, 'GET'), EVENT_CTX)).status).toBe(404)
    expect(allTexts().some(t => /INSERT INTO event_promotion/.test(t))).toBe(false)
    expect(auditInserts()).toHaveLength(0)
  })

  it('rejects: invalid code format 400, a ticket type of another event 400, a duplicate code 409 (pre-check) and 409 on a unique-violation race — none audited', async () => {
    resolver = combine(OWNED_EVENT, OWNED_TYPES, NO_DUP)
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', { ...BODY, code: 'ab' }), EVENT_CTX)).status).toBe(400)
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', { ...BODY, ticket_type_ids: ['tt-other-event'] }), EVENT_CTX)).status).toBe(400)
    expect((await (await promotionsRoute.POST(jsonReq(URL, 'POST', { ...BODY, ticket_type_ids: ['tt-other-event'] }), EVENT_CTX)).json()).error).toBe('One or more ticket types do not belong to this event.')
    resolver = combine(OWNED_EVENT, OWNED_TYPES, text => (/LIMIT 1/.test(text) && /event_promotion_codes WHERE organisation_id/.test(text) ? [{ id: 'promo-0' }] : undefined))
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', BODY), EVENT_CTX)).status).toBe(409)
    resolver = combine(OWNED_EVENT, OWNED_TYPES, NO_DUP, text => { if (/INSERT INTO event_promotion_codes/.test(text)) throw Object.assign(new Error('dup'), { code: '23505' }); return undefined })
    expect((await promotionsRoute.POST(jsonReq(URL, 'POST', BODY), EVENT_CTX)).status).toBe(409)
    expect(auditInserts()).toHaveLength(0)
  })

  it('PATCH disable: merged + re-validated, assignments reconciled in the same statement (DELETE only unwanted, INSERT ON CONFLICT DO NOTHING), audited as .disabled; no DELETE route exists', async () => {
    resolver = combine(
      text => (/FROM event_promotion_codes pc\s*\n\s*WHERE pc\.id = .* AND pc\.event_id = .* AND pc\.organisation_id = .*\s*\n\s*LIMIT 1/.test(text) ? [CREATED_PROMO] : undefined),
      OWNED_TYPES,
      text => (/UPDATE event_promotion_codes SET/.test(text) ? [{ ...CREATED_PROMO, active: false, removed_assignments: 0, added_assignments: 0 }] : undefined),
    )
    const res = await promotionRoute.PATCH(jsonReq(`${URL}/promo-1`, 'PATCH', { active: false }), PROMO_CTX)
    expect(res.status).toBe(200)
    expect((await res.json()).promotion).toMatchObject({ id: 'promo-1', active: false, ticket_type_ids: ['tt-vip'] })
    const upd = callText(findCall(/UPDATE event_promotion_codes SET/))
    expect(upd).toMatch(/DELETE FROM event_promotion_code_ticket_types\s*\n\s*WHERE promotion_code_id = .* AND organisation_id = .*\s*\n\s*AND NOT \(ticket_type_id = ANY\(.*::text\[\]\)\)/)
    expect(upd).toMatch(/ON CONFLICT \(promotion_code_id, ticket_type_id\) DO NOTHING/)
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'event_promotion_code.disabled', resourceType: 'event_promotion_code', resourceId: 'promo-1', before: { event_id: 'event-1', active: true }, after: { event_id: 'event-1', active: false } })
    expect((promotionRoute as Record<string, unknown>).DELETE).toBeUndefined()
    expect((promotionsRoute as Record<string, unknown>).DELETE).toBeUndefined()
    // Only Events-module tables are touched.
    expect(allTexts().every(t => /event_|audit_logs|events/.test(t))).toBe(true)
  })

  it('PATCH never touches orders — changing a code cannot alter an existing order (invariant 6)', () => {
    for (const f of ['app/api/events/[id]/promotions/[promotionId]/route.ts', 'app/api/events/[id]/promotions/route.ts', 'app/api/events/[id]/access-codes/[accessCodeId]/route.ts', 'app/api/events/[id]/access-codes/route.ts']) {
      expect(stripComments(read(f))).not.toMatch(/UPDATE event_orders|UPDATE event_order_items|DELETE FROM event_orders/)
    }
  })
})

describe('access codes API — /api/events/[id]/access-codes', () => {
  const URL = 'http://localhost/api/events/event-1/access-codes'
  const CREATED = { id: 'access-1', organisation_id: 'org-a', event_id: 'event-1', code: 'MEMBERS2026', active: true, starts_at: null, ends_at: null, created_at: 'c', updated_at: 'u', ticket_type_ids: ['tt-vip'] }

  it('manager creates an access code (min 8 chars); the audit row stores the code MASKED (approval D8); the API response carries it in full for distribution', async () => {
    resolver = combine(OWNED_EVENT, OWNED_TYPES, NO_DUP, text => (/INSERT INTO event_access_codes/.test(text) ? [CREATED] : undefined))
    expect((await accessCodesRoute.POST(jsonReq(URL, 'POST', { code: 'VIP10', ticket_type_ids: ['tt-vip'] }), EVENT_CTX)).status).toBe(400)
    const res = await accessCodesRoute.POST(jsonReq(URL, 'POST', { code: ' members2026 ', ticket_type_ids: ['tt-vip'] }), EVENT_CTX)
    expect(res.status).toBe(201)
    expect((await res.json()).access_code).toMatchObject({ id: 'access-1', code: 'MEMBERS2026', ticket_type_ids: ['tt-vip'], order_count: 0 })
    expect(callArgs(findCall(/INSERT INTO event_access_codes/))).toEqual(['org-a', 'event-1', 'MEMBERS2026', true, null, null, 'event-1', 'org-a', ['tt-vip']])
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'event_access_code.created', resourceType: 'event_access_code', resourceId: 'access-1' })
    expect(audits[0].after.code).toMatch(/^ME\*{9}#[0-9a-f]{6}$/)
    expect(JSON.stringify(audits)).not.toContain('MEMBERS2026')
  })

  it('PATCH masks before/after code text too, audits .updated / .disabled; viewer 403; other org 404', async () => {
    resolver = combine(
      text => (/FROM event_access_codes ac\s*\n\s*WHERE ac\.id = .* AND ac\.event_id = .* AND ac\.organisation_id = .*\s*\n\s*LIMIT 1/.test(text) ? [CREATED] : undefined),
      OWNED_TYPES, NO_DUP,
      text => (/UPDATE event_access_codes SET/.test(text) ? [{ ...CREATED, code: 'MEMBERS2027', removed_assignments: 0, added_assignments: 0 }] : undefined),
    )
    const res = await accessCodeRoute.PATCH(jsonReq(`${URL}/access-1`, 'PATCH', { code: 'members2027' }), ACCESS_CTX)
    expect(res.status).toBe(200)
    const audits = auditInserts()
    expect(audits[0]).toMatchObject({ action: 'event_access_code.updated', resourceType: 'event_access_code', resourceId: 'access-1' })
    // A renamed code IS visible as a change (different fingerprint) without either text being recoverable.
    expect(audits[0].before.code).toMatch(/^ME\*{9}#[0-9a-f]{6}$/)
    expect(audits[0].after.code).toMatch(/^ME\*{9}#[0-9a-f]{6}$/)
    expect(audits[0].before.code).not.toBe(audits[0].after.code)
    expect(JSON.stringify(audits)).not.toMatch(/MEMBERS202[67]/)

    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    expect((await accessCodeRoute.PATCH(jsonReq(`${URL}/access-1`, 'PATCH', { active: false }), ACCESS_CTX)).status).toBe(403)
    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-b'))
    resolver = () => []
    expect((await accessCodeRoute.PATCH(jsonReq(`${URL}/access-1`, 'PATCH', { active: false }), ACCESS_CTX)).status).toBe(404)
  })
})

describe('ticket-type routes — sale window + access flag, audited as event_ticket_type.sale_window_changed', () => {
  const EXISTING = { id: 'tt-adult', event_id: 'event-1', organisation_id: 'org-a', name: 'Adult', description: null, price_cents: 4000, capacity: 10, active: true, sort_order: 0, sale_starts_at: null, sale_ends_at: null, requires_access_code: false }
  it('PATCH with a window writes the three columns, re-validates close > open, and audits sale_window_changed with only the changed fields', async () => {
    resolver = combine(
      text => (/SELECT \* FROM event_ticket_types\s*\n\s*WHERE id = .* AND event_id = .* AND organisation_id = .*\s*\n\s*LIMIT 1/.test(text) ? [EXISTING] : undefined),
      text => (/UPDATE event_ticket_types SET/.test(text) ? [{ ...EXISTING, sale_starts_at: new Date('2026-11-01T00:00:00Z'), sale_ends_at: null, requires_access_code: true }] : undefined),
    )
    const res = await ticketTypeRoute.PATCH(jsonReq('http://localhost/api/events/event-1/ticket-types/tt-adult', 'PATCH', { sale_starts_at: '2026-11-01T00:00:00Z', requires_access_code: true }), TT_CTX)
    expect(res.status).toBe(200)
    const upd = callText(findCall(/UPDATE event_ticket_types SET/))
    expect(upd).toMatch(/sale_starts_at = .*, sale_ends_at = .*,\s*\n\s*requires_access_code = .*,\s*\n\s*updated_at = now\(\)/)
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'event_ticket_type.sale_window_changed', resourceType: 'event_ticket_type', resourceId: 'tt-adult' })
    expect(audits[0].after).toEqual({ event_id: 'event-1', sale_starts_at: '2026-11-01T00:00:00.000Z', requires_access_code: true })
    expect(Object.keys(audits[0].before)).toEqual(['event_id', 'sale_starts_at', 'requires_access_code'])

    expect((await ticketTypeRoute.PATCH(jsonReq('http://localhost/api/events/event-1/ticket-types/tt-adult', 'PATCH', { sale_starts_at: '2026-11-02T00:00:00Z', sale_ends_at: '2026-11-01T00:00:00Z' }), TT_CTX)).status).toBe(400)
  })

  it('a PATCH that changes only price keeps the pre-existing .updated action (G)', async () => {
    resolver = combine(
      text => (/SELECT \* FROM event_ticket_types\s*\n\s*WHERE id = /.test(text) ? [EXISTING] : undefined),
      text => (/UPDATE event_ticket_types SET/.test(text) ? [{ ...EXISTING, price_cents: 4500 }] : undefined),
    )
    await ticketTypeRoute.PATCH(jsonReq('http://localhost/api/events/event-1/ticket-types/tt-adult', 'PATCH', { price_cents: 4500 }), TT_CTX)
    expect(auditInserts()[0]).toMatchObject({ action: 'event_ticket_type.updated', after: { event_id: 'event-1', price_cents: 4500 } })
  })

  it('POST defaults the three new columns to NULL / NULL / false when omitted', () => {
    const src = read('app/api/events/[id]/ticket-types/route.ts')
    expect(src).toMatch(/INSERT INTO event_ticket_types \(event_id, organisation_id, name, description, price_cents, capacity, active, sort_order, sale_starts_at, sale_ends_at, requires_access_code\)/)
    expect(src).toMatch(/\$\{\(body\.requires_access_code as boolean \| null \| undefined\) \?\? false\}/)
  })
})

describe('organiser orders list carries the discount snapshot; CSV/revenue readers keep total_cents (the amount paid)', () => {
  it('GET orders selects discount_cents and promotion_code_snapshot; the KPI strip\'s Revenue still reads total_cents only, and the CSV export keeps "Order total" = total_cents while naming the discount in its own explicit column (Phase 5A)', () => {
    expect((read('app/api/events/[id]/orders/route.ts') + read('lib/events/organiserReads.ts'))).toMatch(/eo\.discount_cents, eo\.promotion_code_snapshot,/)
    const exportSrc = stripComments(read('app/api/events/[id]/orders/export/route.ts'))
    expect(exportSrc).toMatch(/\(r\.total_cents \/ 100\)\.toFixed\(2\),\s*\n\s*r\.currency,\s*\n\s*\(\(r\.discount_cents \?\? 0\) \/ 100\)\.toFixed\(2\)/)
    expect(stripComments(read('app/events/[id]/EventDetailClient.tsx'))).toMatch(/grossRevenueCents = paidOrders\.reduce\(\(sum, o\) => sum \+ o\.total_cents, 0\)/)
  })
})

// ─── CLIENT CONTRACTS ──────────────────────────────────────────────────

describe('public page (PublicEventClient) — codes as text, server totals, status vocabulary', () => {
  const src = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
  it('submits promotion_code / access_code as TEXT only and never a discount or total', () => {
    const body = src.slice(src.indexOf('body: JSON.stringify({'), src.indexOf('const body = await res.json()'))
    expect(body).toMatch(/promotion_code: appliedPromo \?\? undefined,\s*\n\s*access_code: appliedAccess \?\? undefined,/)
    expect(body).not.toMatch(/total_cents|discount_cents|subtotal|unlocked/)
  })
  it('displays subtotal / discount / total ONLY from the server quote, and only when the quote matches the current cart', () => {
    expect(src).toMatch(/const quoteFresh = quote !== null && quote\.subtotal_cents === grossCents && quote\.cart_error === null/)
    expect(src).toMatch(/const totalCents = computeCartSelectionTotalCents\(cartLines\) - \(discountApplied\?\.discount_cents \?\? 0\);/)
    expect(src).toMatch(/Subtotal \{formatPrice\(discountApplied\.subtotal_cents\)\}/)
    expect(src).toMatch(/Discount \(\{discountApplied\.promotion!\.code\}\) −\{formatPrice\(discountApplied\.discount_cents\)\}/)
    // Phase 5A: the displayed/charged total is the payable amount — the
    // quoted payment_total_cents when a fresh quote exists (equal to
    // total_cents unless a pass-through booking fee applies), otherwise
    // the ticket total plus the locally-displayed fee.
    expect(src).toMatch(/Total \{formatPrice\(payableCents\)\}/)
    expect(src).toMatch(/const payableCents = quotedFee && typeof quotedFee\.payment_total_cents === 'number' \? quotedFee\.payment_total_cents : totalCents \+ feeCents/)
    expect(src).toMatch(/`Pay \$\{formatPrice\(payableCents\)\}`/)
    // The client never multiplies a percentage or subtracts a fixed amount itself.
    expect(stripComments(src)).not.toMatch(/discount_value|\* \(100 -|\/ 100 \*/)
  })
  it('renders every sale status from the shared helper; a type that is not ON_SALE cannot be selected (max 0, stepper disabled)', () => {
    expect(src).toMatch(/import \{ computeSaleStatus, SALE_STATUS_LABELS, type SaleStatus \} from '@\/lib\/events\/saleWindow'/)
    expect(src).toMatch(/if \(statusFor\(t\) !== 'ON_SALE'\) return 0;/)
    expect(src).toMatch(/const notOnSale = status !== 'ON_SALE';/)
    expect(src).toMatch(/\{notOnSale \? SALE_STATUS_LABELS\[status\] : formatPlacesRemaining\(ticket\.remaining\)\}/)
  })
  it('a 409 at submit refreshes availability from the server (a stale page never bypasses a boundary) and the UI is never the enforcement', () => {
    expect(src).toMatch(/if \(res\.status === 409\) void refreshDetail\(\);/)
    expect(src).toMatch(/Server\s*\n?\s*\/\/\s*enforcement at submit is independent of this/)
  })
  it('quotes only when a code is in play — without codes the page behaves exactly as before (G)', () => {
    expect(src).toMatch(/if \(!appliedPromo && !appliedAccess\) return;/)
    expect(src).toMatch(/fetch\(`\/api\/public\/events\/\$\{organisationSlug\}\/\$\{eventSlug\}\/quote`/)
  })
})

describe('organiser page — panels, ticket-type form fields, no delete for codes', () => {
  it('EventDetailClient mounts the Promotions and Access Codes panels and the ticket-type form submits sale_starts_at / sale_ends_at / requires_access_code', () => {
    const src = read('app/events/[id]/EventDetailClient.tsx')
    expect(src).toMatch(/import \{ PromotionsPanel, AccessCodesPanel \} from '\.\/PromotionsPanel'/)
    expect(src).toMatch(/<PromotionsPanel key=\{`promo-\$\{reloadKey\}`\} eventId=\{eventId\} ticketTypes=\{ticketTypes\} canManage=\{canManage\} timezone=\{event\.timezone\} \/>/)
    expect(src).toMatch(/<AccessCodesPanel key=\{`access-\$\{reloadKey\}`\} eventId=\{eventId\} ticketTypes=\{ticketTypes\} canManage=\{canManage\} timezone=\{event\.timezone\} \/>/)
    expect(src).toMatch(/sale_starts_at: saleStartsAt \? new Date\(saleStartsAt\)\.toISOString\(\) : null,/)
    expect(src).toMatch(/requires_access_code: requiresAccessCode,/)
    expect(src).toMatch(/Requires access code/)
  })
  it('PromotionsPanel: viewer read-only (every mutation behind canManage), PATCH for disable, never DELETE, codes upper-cased client-side as a convenience only', () => {
    const src = read('app/events/[id]/PromotionsPanel.tsx')
    expect(src).not.toMatch(/method: 'DELETE'/)
    expect(src.match(/method: 'PATCH'/g)?.length).toBeGreaterThanOrEqual(4)
    expect(src.match(/\{canManage && /g)?.length).toBeGreaterThanOrEqual(4)
    expect(src).toMatch(/code: code\.trim\(\)\.toUpperCase\(\)/)
    expect(src).toMatch(/minLength=\{8\} maxLength=\{32\}/)
  })
})

describe('audit allowlists', () => {
  it('the ticket-type allowlist gained exactly the three Phase 4 fields; code loggers exist with the approved actions', () => {
    const src = read('lib/events/auditLog.ts')
    expect(src).toMatch(/const EVENT_TICKET_TYPE_AUDIT_FIELDS = \['name', 'description', 'price_cents', 'capacity', 'active', 'sort_order', 'sale_starts_at', 'sale_ends_at', 'requires_access_code'\] as const;/)
    for (const action of ['event_promotion_code.created', 'event_access_code.created', 'event_ticket_type.sale_window_changed']) expect(src).toContain(`'${action}'`)
    expect(src).toMatch(/`\$\{kind\}\.disabled` : `\$\{kind\}\.updated`/)
    // No purchaser/payment data in the code audit allowlists.
    expect(src).toMatch(/const EVENT_PROMOTION_CODE_AUDIT_FIELDS = \['code', 'discount_type', 'discount_value', 'active', 'starts_at', 'ends_at', 'max_redemptions', 'min_cart_cents', 'ticket_type_ids'\] as const;/)
    expect(src).toMatch(/const EVENT_ACCESS_CODE_AUDIT_FIELDS = \['code', 'active', 'starts_at', 'ends_at', 'ticket_type_ids'\] as const;/)
  })
})
