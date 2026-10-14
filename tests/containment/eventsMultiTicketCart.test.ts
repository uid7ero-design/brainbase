import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Phase 2 — multi-ticket-type orders (cart support). Mocked-SQL suite:
// proves request validation, the shared cart rules, the statements and
// arguments each flow submits (lock order, one line per item, attendee
// correlation, Stripe line items, retry reproducing the whole cart) and
// the organiser-side grouping. Real concurrency behaviour (atomic
// all-or-nothing reservation, overlapping carts, deadlock freedom,
// combined session capacity, stale holds) is proven against real
// PostgreSQL by scripts/tests/verify-events-cart-concurrency.sh — mocks
// have no locks or MVCC, so they cannot prove those properties.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
let transactionFinalResult: unknown[] = []
const transactionMock = vi.fn(async (queries: unknown[]) => [...queries.slice(1).map(() => []), transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function callText(index: number): string {
  return ((sqlMock.mock.calls[index] as unknown as unknown[])[0] as TemplateStringsArray).join(' ')
}
function callArgs(index: number): unknown[] {
  return (sqlMock.mock.calls[index] as unknown as unknown[]).slice(1)
}
function findCall(pattern: RegExp): number {
  return sqlMock.mock.calls.findIndex((_, i) => pattern.test(callText(i)))
}

const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Spring Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
vi.mock('@/lib/events/publicResolve', () => ({
  resolvePublicEvent: vi.fn(async () => ({ ok: true, organisationId: 'org-a', organisationName: 'Org A', event: EVENT, branding: {} })),
}))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => true }))
vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: vi.fn(async () => ({ eligible: true, accountId: 'acct_org_a' })),
}))
const writeRegistrationResponsesMock = vi.fn()
vi.mock('@/lib/events/registrationQuestions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/registrationQuestions')>()
  return {
    ...actual,
    listActiveQuestions: vi.fn(async () => []),
    writeRegistrationResponses: (...args: unknown[]) => writeRegistrationResponsesMock(...args),
  }
})
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivity: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
}))
const createCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
    retrieveExistingCheckoutAttempt: vi.fn(),
    expireCheckoutSession: vi.fn().mockResolvedValue(undefined),
    RESERVATION_WINDOW_SECONDS: 1860,
  }
})
const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})
vi.mock('next/headers', () => ({ headers: async () => new Map([['host', 'localhost:3000']]) }))

const { validatePublicRegistrationInput } = await import('@/lib/events/publicValidation')
const { loadCartTicketTypes, cartLockOrder, computeCartTotalCents } = await import('@/lib/events/services/cart')
const { groupOrderRows, formatOrderLines } = await import('@/lib/events/orderGrouping')
const checkoutRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route')
const retryRoute = await import('@/app/api/events/[id]/orders/[orderId]/retry/route')

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  createCheckoutSessionMock.mockReset()
  writeRegistrationResponsesMock.mockReset()
  requireSessionMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = []
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_cart', url: 'https://checkout.stripe.com/pay/cs_test_cart' })
  writeRegistrationResponsesMock.mockResolvedValue(undefined)
  requireSessionMock.mockResolvedValue({ userId: 'staff-1', organisationId: 'org-a', role: 'manager' })
})

const BASE = { purchaser_name: 'Jane Purchaser', purchaser_email: 'jane@example.com' }

// ─── Validation ────────────────────────────────────────────────────────

describe('Cart validation (lib/events/publicValidation.ts)', () => {
  const att = (ticket_type_id: string, name: string) => ({ ticket_type_id, name })

  it('accepts multiple valid items with attendees tagged per line, in submitted order', () => {
    const v = validatePublicRegistrationInput({
      ...BASE,
      items: [{ ticket_type_id: 'adult', quantity: 2 }, { ticket_type_id: 'child', quantity: 1 }],
      attendees: [att('adult', 'A1'), att('child', 'C1'), att('adult', 'A2')],
    })
    expect(typeof v).not.toBe('string')
    if (typeof v === 'string') return
    expect(v.items).toEqual([{ ticket_type_id: 'adult', quantity: 2 }, { ticket_type_id: 'child', quantity: 1 }])
    expect(v.quantity).toBe(3)
    expect(v.attendees.map(a => a.ticket_type_id)).toEqual(['adult', 'child', 'adult'])
  })

  it('rejects duplicate ticket types rather than merging them', () => {
    expect(validatePublicRegistrationInput({
      ...BASE,
      items: [{ ticket_type_id: 'adult', quantity: 1 }, { ticket_type_id: 'adult', quantity: 1 }],
      attendees: [att('adult', 'A1'), att('adult', 'A2')],
    })).toMatch(/only once/i)
  })

  it('rejects zero, negative and non-integer quantities', () => {
    for (const quantity of [0, -1, 1.5, '2']) {
      expect(validatePublicRegistrationInput({
        ...BASE, items: [{ ticket_type_id: 'adult', quantity }], attendees: [att('adult', 'A1')],
      })).toMatch(/whole number/i)
    }
  })

  it('rejects an empty cart and a missing/blank ticket type', () => {
    expect(validatePublicRegistrationInput({ ...BASE, items: [], attendees: [] })).toMatch(/at least one ticket/i)
    expect(validatePublicRegistrationInput({ ...BASE, items: [{ ticket_type_id: ' ', quantity: 1 }], attendees: [att(' ', 'A')] })).toMatch(/ticket type is required/i)
  })

  it('keeps the 20-ticket ceiling for the WHOLE order, not per line', () => {
    const items = [{ ticket_type_id: 'adult', quantity: 15 }, { ticket_type_id: 'child', quantity: 6 }]
    const attendees = [
      ...Array.from({ length: 15 }, (_, i) => att('adult', `A${i}`)),
      ...Array.from({ length: 6 }, (_, i) => att('child', `C${i}`)),
    ]
    expect(validatePublicRegistrationInput({ ...BASE, items, attendees })).toMatch(/at most 20 tickets/i)
  })

  it('rejects attendees not assigned to a selected line, and per-line attendee counts that do not match', () => {
    expect(validatePublicRegistrationInput({
      ...BASE, items: [{ ticket_type_id: 'adult', quantity: 1 }], attendees: [att('vip', 'X')],
    })).toMatch(/assigned to one of the selected ticket types/i)
    expect(validatePublicRegistrationInput({
      ...BASE,
      items: [{ ticket_type_id: 'adult', quantity: 1 }, { ticket_type_id: 'child', quantity: 1 }],
      attendees: [att('adult', 'A1'), att('adult', 'A2')],
    })).toMatch(/exactly one attendee per ticket/i)
  })

  it('rejects supplying both the cart and the legacy single-type shape', () => {
    expect(validatePublicRegistrationInput({
      ...BASE, ticket_type_id: 'adult', quantity: 1, items: [{ ticket_type_id: 'adult', quantity: 1 }], attendees: [att('adult', 'A')],
    })).toMatch(/not both/i)
  })

  it('backward compatible: the legacy single-type request still validates, normalised to a one-line cart', () => {
    const v = validatePublicRegistrationInput({ ...BASE, ticket_type_id: 'adult', quantity: 2, attendees: [{ name: 'A1' }, { name: 'A2' }] })
    expect(typeof v).not.toBe('string')
    if (typeof v === 'string') return
    expect(v.items).toEqual([{ ticket_type_id: 'adult', quantity: 2 }])
    expect(v.attendees.every(a => a.ticket_type_id === 'adult')).toBe(true)
  })
})

// ─── Shared cart rules ─────────────────────────────────────────────────

describe('Shared cart rules (lib/events/services/cart.ts)', () => {
  const items = [{ ticket_type_id: 'tt-a', quantity: 2 }, { ticket_type_id: 'tt-b', quantity: 1 }]
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, active: true, price_cents: 2500, currency: 'AUD', name: id, ...extra })

  it('looks every line up in ONE query scoped to the organisation AND the event', async () => {
    queue([row('tt-a'), row('tt-b')])
    const r = await loadCartTicketTypes('org-a', 'event-1', items)
    expect(r.ok).toBe(true)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(callText(0)).toMatch(/organisation_id = .* AND event_id = .* AND id = ANY\(/)
    expect(callArgs(0)).toEqual(['org-a', 'event-1', ['tt-a', 'tt-b']])
  })

  it('a ticket type from another event or organisation (not returned) rejects the whole cart', async () => {
    queue([row('tt-a')])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'TICKET_TYPE_NOT_FOUND' })
  })

  it('any inactive ticket type rejects the whole cart', async () => {
    queue([row('tt-a'), row('tt-b', { active: false })])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'TICKET_TYPE_INACTIVE' })
  })

  it('a mix of free and paid ticket types is rejected (orders are all-free or all-paid)', async () => {
    queue([row('tt-a'), row('tt-b', { price_cents: 0 })])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'MIXED_FREE_AND_PAID' })
  })

  it('paid lines in different currencies are rejected', async () => {
    queue([row('tt-a'), row('tt-b', { currency: 'NZD' })])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'CURRENCY_MISMATCH' })
  })

  it('lines come back in purchase order with server-derived prices, regardless of row order', async () => {
    queue([row('tt-b', { price_cents: 1500 }), row('tt-a', { price_cents: 2500 })])
    const r = await loadCartTicketTypes('org-a', 'event-1', items)
    expect(r.ok && r.lines.map(l => [l.ticket_type_id, l.unit_price_cents, l.quantity])).toEqual([['tt-a', 2500, 2], ['tt-b', 1500, 1]])
    expect(r.ok && r.pricing).toBe('PAID')
  })

  it('lock order is ascending id by code-unit comparison, independent of cart order, and does not mutate the input', () => {
    const input = ['tt-c', 'tt-a', 'TT-b', 'tt-b']
    expect(cartLockOrder(input)).toEqual(['TT-b', 'tt-a', 'tt-b', 'tt-c'])
    expect(input).toEqual(['tt-c', 'tt-a', 'TT-b', 'tt-b'])
    expect(cartLockOrder(['tt-b', 'tt-a'])).toEqual(cartLockOrder(['tt-a', 'tt-b']))
  })

  it('order total is the integer sum of every line', () => {
    expect(computeCartTotalCents([{ unit_price_cents: 2500, quantity: 2 }, { unit_price_cents: 1500, quantity: 2 }, { unit_price_cents: 9900, quantity: 1 }])).toBe(17900)
  })
})

// ─── Paid checkout: 2 Adult + 2 Child + 1 VIP ──────────────────────────

describe('Paid checkout — multi-line cart (one order, three items, five attendees, one Checkout Session)', () => {
  const TT_ROWS = [
    { id: 'tt-vip', active: true, price_cents: 9900, currency: 'AUD', name: 'VIP' },
    { id: 'tt-adult', active: true, price_cents: 2500, currency: 'AUD', name: 'Adult' },
    { id: 'tt-child', active: true, price_cents: 1500, currency: 'AUD', name: 'Child' },
  ]
  const CART = {
    ...BASE,
    items: [{ ticket_type_id: 'tt-adult', quantity: 2 }, { ticket_type_id: 'tt-child', quantity: 2 }, { ticket_type_id: 'tt-vip', quantity: 1 }],
    attendees: [
      { ticket_type_id: 'tt-adult', name: 'Adult One' },
      { ticket_type_id: 'tt-adult', name: 'Adult Two' },
      { ticket_type_id: 'tt-child', name: 'Child One' },
      { ticket_type_id: 'tt-child', name: 'Child Two' },
      { ticket_type_id: 'tt-vip', name: 'VIP One' },
    ],
  }
  function req(body: unknown) {
    return asNextRequest(new Request('http://localhost/api/public/events/org/gala/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }
  const CTX = { params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'gala' }) }

  async function runSuccessfulCheckout() {
    // 0=ticket types, 1-3=locks, 4=gate, 5=captured expires_at, 6=write-back.
    queue(TT_ROWS, [], [], [], [], [{ expires_at: '2026-01-01T00:30:00.000Z' }], [{ id: 'order-1' }])
    transactionFinalResult = Array.from({ length: 5 }, (_, i) => ({ id: `att-${i}`, order_id: 'order-1' }))
    return checkoutRoute.POST(req(CART), CTX)
  }

  it('returns 201 with one Checkout URL', async () => {
    const res = await runSuccessfulCheckout()
    expect(res.status).toBe(201)
    expect((await res.json()).checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_cart')
  })

  it('one Stripe Checkout Session with three line items, in purchase order, at DB-derived unit prices and quantities', async () => {
    await runSuccessfulCheckout()
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
    const input = createCheckoutSessionMock.mock.calls[0][0]
    expect(input.lineItems).toEqual([
      { name: 'Adult', unitAmountCents: 2500, quantity: 2 },
      { name: 'Child', unitAmountCents: 1500, quantity: 2 },
      { name: 'VIP', unitAmountCents: 9900, quantity: 1 },
    ])
    expect(input.currency).toBe('AUD')
    expect(input.connectedAccountId).toBe('acct_org_a')
    expect(input.orderId).toBe('order-1')
  })

  it('the order total written to event_orders equals the sum Stripe charges', async () => {
    await runSuccessfulCheckout()
    const input = createCheckoutSessionMock.mock.calls[0][0] as { lineItems: { unitAmountCents: number; quantity: number }[] }
    const stripeTotal = input.lineItems.reduce((s, l) => s + l.unitAmountCents * l.quantity, 0)
    expect(stripeTotal).toBe(17900)
    const gate = findCall(/INSERT INTO event_orders/)
    expect(callArgs(gate)).toContain(17900)
  })

  it('locks all three ticket types in ascending id order, then gates in one statement inside one transaction', async () => {
    await runSuccessfulCheckout()
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect((transactionMock.mock.calls[0] as unknown as unknown[][])[0]).toHaveLength(4)
    const lockedIds = [1, 2, 3].map(i => {
      expect(callText(i)).toMatch(/FROM event_ticket_types WHERE id = .* FOR UPDATE/)
      return callArgs(i)[0]
    })
    expect(lockedIds).toEqual(['tt-adult', 'tt-child', 'tt-vip'])
    expect(callText(4)).toMatch(/INSERT INTO event_order_items/)
  })

  it('creates one order item per line with its own quantity and unit price, and attaches each attendee to its own line', async () => {
    await runSuccessfulCheckout()
    const gate = findCall(/INSERT INTO event_orders/)
    const args = callArgs(gate)
    expect(args).toContainEqual(['tt-adult', 'tt-child', 'tt-vip'])
    expect(args).toContainEqual([2, 2, 1])
    expect(args).toContainEqual([2500, 1500, 9900])
    expect(args).toContainEqual(['tt-adult', 'tt-adult', 'tt-child', 'tt-child', 'tt-vip'])
    expect(callText(gate)).toMatch(/ON a\.ticket_type_id = ii\.ticket_type_id/)
  })

  it('attendee answers are written against pre-generated attendee ids — the SAME ids inserted, in attendee order — never RETURNING order', async () => {
    await runSuccessfulCheckout()
    const gate = findCall(/INSERT INTO event_orders/)
    const idArray = callArgs(gate).find(a => Array.isArray(a) && a.length === 5 && (a as string[]).every(x => /^[0-9a-f-]{36}$/.test(x))) as string[]
    expect(idArray).toBeDefined()
    expect(new Set(idArray).size).toBe(5)
    expect(writeRegistrationResponsesMock).toHaveBeenCalledTimes(1)
    expect(writeRegistrationResponsesMock.mock.calls[0][3]).toEqual(idArray)
  })

  it('one line sold out -> the gated statement returns nothing -> 409, no Stripe session, no responses written', async () => {
    queue(TT_ROWS, [], [], [], [])
    transactionFinalResult = []
    const res = await checkoutRoute.POST(req(CART), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    expect(writeRegistrationResponsesMock).not.toHaveBeenCalled()
  })

  it('mixed currencies -> 400 before any reservation', async () => {
    queue([TT_ROWS[0], TT_ROWS[1], { ...TT_ROWS[2], currency: 'NZD' }])
    const res = await checkoutRoute.POST(req(CART), CTX)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/same currency/i)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('mixed free and paid -> 400 before any reservation', async () => {
    queue([TT_ROWS[0], TT_ROWS[1], { ...TT_ROWS[2], price_cents: 0 }])
    const res = await checkoutRoute.POST(req(CART), CTX)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/separate orders/i)
    expect(transactionMock).not.toHaveBeenCalled()
  })
})

// ─── Retry reproduces the whole cart ───────────────────────────────────

describe('Retry payment — reproduces every line of a multi-line order', () => {
  const ORDER_ROW = { id: 'order-1', payment_status: 'PENDING', purchaser_email: 'p@example.com', total_cents: 17900, currency: 'AUD', stripe_account_id: 'acct_org_a', stripe_checkout_session_id: null, expires_at: '2026-01-01T00:00:00.000Z' }
  const ITEM_ROWS = [
    { ticket_type_id: 'tt-vip', event_session_id: 'sess-1', quantity: 1, unit_price_cents: 9900 },
    { ticket_type_id: 'tt-adult', event_session_id: 'sess-1', quantity: 2, unit_price_cents: 2500 },
    { ticket_type_id: 'tt-child', event_session_id: 'sess-1', quantity: 2, unit_price_cents: 1500 },
  ]
  // Current prices deliberately differ from the stored unit prices.
  const TT_ROWS = [
    { id: 'tt-adult', name: 'Adult', active: true, price_cents: 3000, currency: 'AUD' },
    { id: 'tt-child', name: 'Child', active: true, price_cents: 2000, currency: 'AUD' },
    { id: 'tt-vip', name: 'VIP', active: true, price_cents: 12000, currency: 'AUD' },
  ]
  const CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1' }) }
  const req = () => new Request('http://localhost/x', { method: 'POST' })

  function queueRetry(items = ITEM_ROWS, types = TT_ROWS) {
    // 0=event, 1=order, 2=items, 3=ticket types, 4-6=type locks, 7=session lock, 8=reacquire, 9=write-back.
    queue([{ id: 'event-1', status: 'PUBLISHED', event_slug: 'gala', org_slug: 'org' }], [ORDER_ROW], items, types, [], [], [], [], [], [{ id: 'order-1' }])
    transactionFinalResult = [{ id: 'order-1', expires_at: '2026-01-01T00:31:00.000Z' }]
  }

  it('reads every order item (no LIMIT 1) in a stable order', async () => {
    queueRetry()
    await retryRoute.POST(req(), CTX)
    expect(callText(2)).toMatch(/FROM event_order_items/)
    expect(callText(2)).toMatch(/ORDER BY created_at, id/)
    expect(callText(2)).not.toMatch(/LIMIT 1/)
  })

  it('creates one Checkout Session with all three lines at the STORED unit prices, so Stripe charges exactly total_cents', async () => {
    queueRetry()
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const input = createCheckoutSessionMock.mock.calls[0][0] as { lineItems: { name: string; unitAmountCents: number; quantity: number }[] }
    expect(input.lineItems).toEqual([
      { name: 'VIP', unitAmountCents: 9900, quantity: 1 },
      { name: 'Adult', unitAmountCents: 2500, quantity: 2 },
      { name: 'Child', unitAmountCents: 1500, quantity: 2 },
    ])
    expect(input.lineItems.reduce((s, l) => s + l.unitAmountCents * l.quantity, 0)).toBe(ORDER_ROW.total_cents)
  })

  it('locks every line\'s ticket type in ascending id order, then the session, and re-checks the whole order in one UPDATE', async () => {
    queueRetry()
    await retryRoute.POST(req(), CTX)
    expect([4, 5, 6].map(i => callArgs(i)[0])).toEqual(['tt-adult', 'tt-child', 'tt-vip'])
    expect(callText(7)).toMatch(/FROM event_sessions WHERE id = .* FOR UPDATE/)
    const update = callText(8)
    expect(update).toMatch(/UPDATE event_orders eo/)
    expect(update).toMatch(/NOT EXISTS \(SELECT 1 FROM cart_tt WHERE cart_tt\.sold \+ cart_tt\.quantity > cart_tt\.capacity\)/)
    expect(callArgs(8)).toContain(5) // combined order quantity vs session capacity
  })

  it('any line whose ticket type is now inactive blocks the retry (409) — no partial re-charge', async () => {
    queueRetry(ITEM_ROWS, [TT_ROWS[0], TT_ROWS[1], { ...TT_ROWS[2], active: false }])
    const res = await retryRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })
})

// ─── Organiser view grouping ───────────────────────────────────────────

describe('Organiser registrations view — one card per order (lib/events/orderGrouping.ts)', () => {
  const rows = [
    { id: 'o1', order_item_id: 'i1', ticket_type_name: 'Adult', quantity: 2, total_cents: 17900, attendees: [{ id: 'a1' }, { id: 'a2' }] },
    { id: 'o2', order_item_id: 'i9', ticket_type_name: 'Adult', quantity: 1, total_cents: 2500, attendees: [{ id: 'a9' }] },
    { id: 'o1', order_item_id: 'i2', ticket_type_name: 'Child', quantity: 2, total_cents: 17900, attendees: [{ id: 'a3' }, { id: 'a4' }] },
    { id: 'o1', order_item_id: 'i3', ticket_type_name: 'VIP', quantity: 1, total_cents: 17900, attendees: [{ id: 'a5' }] },
  ]

  it('folds a multi-item order into one entry with every line and every attendee; order-level fields appear once', () => {
    const grouped = groupOrderRows(rows)
    expect(grouped.map(g => g.id)).toEqual(['o1', 'o2'])
    const o1 = grouped[0]
    expect(o1.lines.map(l => l.order_item_id)).toEqual(['i1', 'i2', 'i3'])
    expect(o1.quantity).toBe(5)
    expect(o1.total_cents).toBe(17900)
    expect(o1.attendees.map(a => [a.id, a.ticket_type_name])).toEqual([['a1', 'Adult'], ['a2', 'Adult'], ['a3', 'Child'], ['a4', 'Child'], ['a5', 'VIP']])
    expect(formatOrderLines(o1.lines)).toBe('Adult × 2, Child × 2, VIP × 1')
  })

  it('the registrations panel renders grouped orders keyed by order id, so refund/cancel/retry render once per order', () => {
    const panel = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))
    expect(panel).toMatch(/const displayedOrders = listOrders \? groupOrderRows\(listOrders\) : null/)
    expect(panel).toMatch(/<div key=\{o\.id\} style=\{rowCardStyle\}>/)
  })
})

// ─── Existing order-level systems handle multiple items ───────────────

describe('Refund / cancel / ticket validity / wallet / email — order-level, multi-item safe', () => {
  it('refund and cancel transition the whole order (event_orders by order id) — every item\'s tickets follow the order status', () => {
    const t = stripComments(read('lib/events/services/orderTransitions.ts'))
    expect(t).toMatch(/UPDATE event_orders\s+SET payment_status = 'REFUNDED', refunded_at = now\(\), status = 'CANCELLED'\s+WHERE id = \$\{orderId\} AND organisation_id = \$\{organisationId\} AND payment_status = 'PAID'/)
    expect(t).not.toMatch(/UPDATE event_order_items|UPDATE event_attendees|DELETE FROM/)
    const validity = stripComments(read('lib/events/ticketValidity.ts'))
    expect(validity).toMatch(/orderStatus === 'CANCELLED'/)
  })

  it('the booking wallet lists every attendee of the order across all items, with each ticket type', () => {
    const wallet = stripComments(read('lib/events/publicBooking.ts'))
    expect(wallet).toMatch(/WHERE ea\.order_id = \$\{order\.id\} AND ea\.organisation_id = \$\{order\.organisation_id\}/)
    expect(wallet).toMatch(/tt\.name AS ticket_type_name/)
  })

  it('automatic ticket email and manual resend aggregate attendees across every order item', () => {
    for (const file of ['lib/events/ticketEmailDelivery.ts', 'app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts']) {
      const src = stripComments(read(file))
      expect(src).toMatch(/JOIN event_order_items oi ON oi\.order_id = eo\.id/)
      expect(src).toMatch(/LEFT JOIN event_attendees ea ON ea\.order_item_id = oi\.id/)
      expect(src).toMatch(/GROUP BY eo\.id, e\.name, o\.name, o\.settings/)
    }
  })

  it('the paid webhook issues tokens for every attendee of the order, not one item', () => {
    const stripe = stripComments(read('lib/events/stripe.ts'))
    expect(stripe).toMatch(/WHERE ea\.order_id = \$\{orderId\} AND ea\.ticket_token IS NULL AND eo\.payment_status = 'PAID'/)
  })
})

// ─── Drift guard: the real-Postgres proof mirrors the live statements ──

describe('scripts/tests/verify-events-cart-concurrency.sh mirrors the live cart SQL', () => {
  const proof = read('scripts/tests/verify-events-cart-concurrency.sh')
  const services = ['lib/events/services/paidCheckout.ts', 'lib/events/services/freeRegistration.ts', 'lib/events/services/retryCheckout.ts']
    .map(f => read(f))

  it('every service and the proof share the same all-lines gate and line-count guard', () => {
    const gate = 'NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)'
    expect(proof).toContain(gate)
    for (const src of services) {
      expect(src).toContain(gate)
      expect(src).toMatch(/\(SELECT count\(\*\) FROM cart_tt\) = \$\{/)
    }
  })

  it('the proof locks ticket types in byte order, then the session — matching cartLockOrder/buildCartLockStatements', () => {
    expect(proof).toMatch(/LC_ALL=C sort/)
    expect(proof).toMatch(/FROM event_ticket_types WHERE id = '\$id' AND organisation_id = 'org-a' FOR UPDATE/)
    expect(proof).toMatch(/FROM event_sessions WHERE id = '\$sess' AND organisation_id = 'org-a' FOR UPDATE/)
  })

  it('the proof covers scenarios A–F plus free carts and whole-order retry', () => {
    for (const section of ['=== A:', '=== B:', '=== C:', '=== D:', '=== E:', '=== F:', '=== F MUTATION PROOF', '=== G:', '=== R:']) {
      expect(proof).toContain(section)
    }
  })
})
