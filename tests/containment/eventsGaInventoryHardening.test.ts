import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Events Phase 6 — general-admission inventory hardening. The ticket
// type × session inventory model itself (table, gate precedence, lock
// order, organiser pair API, public payload) is Phase 3's and is pinned
// by tests/containment/eventsTicketTypeSessionInventory.test.ts and
// proven on real PostgreSQL by
// scripts/tests/verify-events-ticket-type-session-inventory.sh. This
// file guards what Phase 6 adds on top:
//   * assessCartAvailability — the read-side twin of the gate — copies
//     the gate's own CTEs verbatim and never locks or writes;
//   * the public quote refuses a selection the gate would refuse (and a
//     session that is not this event's) instead of pricing it;
//   * the whole-event type × session matrix read path (viewer+, tenant
//     scoped, no scope creep);
//   * the proof script's section K (read side agrees with the gate on
//     real PostgreSQL) and ADR-0006 exist and say what they must;
//   * nothing about the gate, the lock order, the cart rules or the
//     public validation changed.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }))
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((..._args: unknown[]) => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sqlMock(...args) }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => true }))

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

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function callText(index: number): string {
  return ((sqlMock.mock.calls[index] as unknown as unknown[])[0] as TemplateStringsArray).join(' ')
}
function callArgs(index: number): unknown[] {
  return (sqlMock.mock.calls[index] as unknown as unknown[]).slice(1)
}
function allTexts(): string[] {
  return sqlMock.mock.calls.map((_, i) => callText(i))
}
function sessionAs(role: string, organisationId = 'org-a', userId = 'staff-1') { return { userId, organisationId, role } }

const { assessCartAvailability, buildCartLockStatements, cartLockOrder } = await import('@/lib/events/services/cart')
const quoteRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route')
const matrixRoute = await import('@/app/api/events/[id]/inventory/route')

const SLUG_CTX = { params: Promise.resolve({ organisationSlug: 'org-a', eventSlug: 'gala' }) }
const QUOTE_URL = 'http://localhost/api/public/events/org-a/gala/quote'
const MATRIX_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const MATRIX_URL = 'http://localhost/api/events/event-1/inventory'
const ADULT = { id: 'tt-adult', active: true, price_cents: 4000, currency: 'AUD', name: 'Adult', sale_started: true, sale_ended: false, requires_access_code: false, fee_policy: null }
const VIP = { id: 'tt-vip', active: true, price_cents: 9900, currency: 'AUD', name: 'VIP', sale_started: true, sale_ended: false, requires_access_code: false, fee_policy: null }
const AVAILABLE = { session_found: true, unavailable_ticket_type_ids: [], session_full: false }

const CART_SRC = read('lib/events/services/cart.ts')
const SERVICES = {
  free: read('lib/events/services/freeRegistration.ts'),
  paid: read('lib/events/services/paidCheckout.ts'),
  retry: read('lib/events/services/retryCheckout.ts'),
}

beforeEach(() => {
  sqlMock.mockClear()
  requireSessionMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('viewer'))
})

// ─── READ-SIDE TWIN OF THE GATE ────────────────────────────────────────

describe('assessCartAvailability — the gate\'s own capacity rule, read without a lock', () => {
  it('runs ONE read-only statement: no FOR UPDATE, no INSERT/UPDATE/DELETE, no transaction', async () => {
    queue([AVAILABLE])
    await assessCartAvailability('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 2 }], 'sess-fri')
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const text = callText(0)
    expect(text).not.toMatch(/FOR UPDATE|INSERT|UPDATE |DELETE/)
    expect(text).toMatch(/^\s*WITH cart AS/)
  })

  it('copies the gate\'s cart_tt verbatim: COALESCE(inv.capacity, tt.capacity), the pair-narrowed sold predicate, the LEFT JOIN on the selected session\'s pair row, the stale-hold predicate', () => {
    const stripped = stripComments(CART_SRC)
    const fn = stripped.slice(stripped.indexOf('export async function assessCartAvailability'))
    expect(fn).toContain('COALESCE(inv.capacity, tt.capacity) AS capacity')
    expect(fn).toContain('AND (inv.id IS NULL OR oi.event_session_id = ${eventSessionId})')
    expect(fn).toMatch(/LEFT JOIN event_ticket_type_session_inventory inv\s*\n\s*ON inv\.ticket_type_id = c\.ticket_type_id AND inv\.event_session_id = \$\{eventSessionId\} AND inv\.organisation_id = \$\{organisationId\}/)
    expect(fn).toContain("AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
    expect(fn).toContain('WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity')
    expect(fn).toContain('(SELECT qty FROM sold_sess) + ${totalQuantity} > (SELECT capacity FROM sess)')
    // The session must be THIS event's and organisation's — the gate's
    // callers check that one statement earlier; the read side folds it in.
    expect(fn).toMatch(/SELECT capacity FROM event_sessions\s*\n\s*WHERE id = \$\{eventSessionId\} AND organisation_id = \$\{organisationId\} AND event_id = \$\{eventId\}/)
  })

  it('the three services\' gate CTEs still carry the exact predicates the read side mirrors (drift guard in both directions)', () => {
    for (const src of Object.values(SERVICES)) {
      expect(src).toContain('COALESCE(inv.capacity, tt.capacity) AS capacity')
      expect(src).toMatch(/AND \(inv\.id IS NULL OR oi\.event_session_id = \$\{[a-zA-Z_.]+\}\)/)
      expect(src).toContain('NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)')
      expect(src).toContain("(eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
    }
  })

  it('maps the single row: session found, the sorted list of lines that do not fit, and the shared-session verdict', async () => {
    queue([{ session_found: true, unavailable_ticket_type_ids: ['tt-vip'], session_full: true }])
    const r = await assessCartAvailability('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }, { ticket_type_id: 'tt-vip', quantity: 1 }], 'sess-fri')
    expect(r).toEqual({ assessed: true, sessionFound: true, unavailableTicketTypeIds: ['tt-vip'], sessionFull: true })
    expect(callArgs(0)).toContain('sess-fri')
    expect(callArgs(0)).toContainEqual(['tt-adult', 'tt-vip'])
    expect(callArgs(0)).toContainEqual([1, 1])
    expect(callArgs(0)).toContain(2) // Σ quantity for the session cap
  })

  it('accepts the Postgres array literal form too, and a no-session cart passes NULL for the session', async () => {
    queue([{ session_found: true, unavailable_ticket_type_ids: '{tt-adult,tt-vip}', session_full: false }])
    const r = await assessCartAvailability('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }], null)
    expect(r).toEqual({ assessed: true, sessionFound: true, unavailableTicketTypeIds: ['tt-adult', 'tt-vip'], sessionFull: false })
    expect(callArgs(0)).toContain(null)
  })

  it('a missing row is "not assessed" — never silently "available" and never "sold out"', async () => {
    queue([])
    expect(await assessCartAvailability('org-a', 'event-1', [{ ticket_type_id: 'tt-adult', quantity: 1 }], null)).toEqual({ assessed: false })
  })
})

// ─── PUBLIC QUOTE ─────────────────────────────────────────────────────

describe('POST .../quote — a selection the gate would refuse is a cart_error, not a price', () => {
  it('prices an available selection and reports availability.ok = true; the availability read runs AFTER pricing (last statement)', async () => {
    queue([ADULT, VIP], [AVAILABLE])
    const body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 2 }, { ticket_type_id: 'tt-vip', quantity: 1 }], event_session_id: 'sess-fri' }), SLUG_CTX)).json()
    expect(body.cart_error).toBeNull()
    expect(body.total_cents).toBe(17900)
    expect(body.availability).toEqual({ ok: true, unavailable_ticket_type_ids: [], session_full: false })
    const texts = allTexts()
    expect(texts[texts.length - 1]).toContain('event_ticket_type_session_inventory')
    expect(texts.some(t => /INSERT|UPDATE|FOR UPDATE/.test(t))).toBe(false)
  })

  it('a sold-out line (in the selected session) zeroes the figures and names the line', async () => {
    queue([ADULT, VIP], [{ session_found: true, unavailable_ticket_type_ids: ['tt-vip'], session_full: false }])
    const body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }, { ticket_type_id: 'tt-vip', quantity: 1 }], event_session_id: 'sess-fri' }), SLUG_CTX)).json()
    expect(body.cart_error).toBe('Some of the selected tickets are no longer available.')
    expect(body.total_cents).toBe(0)
    expect(body.pricing).toBeNull()
    expect(body.availability).toEqual({ ok: false, unavailable_ticket_type_ids: ['tt-vip'], session_full: false })
  })

  it('the shared session capacity is reported as its own message', async () => {
    queue([ADULT], [{ session_found: true, unavailable_ticket_type_ids: [], session_full: true }])
    const body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 3 }], event_session_id: 'sess-fri' }), SLUG_CTX)).json()
    expect(body.cart_error).toBe('The selected session does not have enough places left for this order.')
    expect(body.availability.session_full).toBe(true)
  })

  it('a session that is not this event\'s is refused like register/checkout refuse it', async () => {
    queue([ADULT], [{ session_found: false, unavailable_ticket_type_ids: [], session_full: false }])
    const body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }], event_session_id: 'sess-other' }), SLUG_CTX)).json()
    expect(body.cart_error).toBe('Selected session is not available for this event.')
    expect(body.availability.ok).toBe(false)
  })

  it('an empty selection is never assessed (availability null, no inventory read); an earlier cart error short-circuits before any availability read', async () => {
    queue([])
    let body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [] }), SLUG_CTX)).json()
    expect(body.availability).toBeNull()
    expect(allTexts().some(t => t.includes('event_ticket_type_session_inventory'))).toBe(false)

    sqlMock.mockClear()
    queue([{ ...ADULT, active: false }])
    body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }] }), SLUG_CTX)).json()
    expect(body.cart_error).toBe('Selected ticket type is not currently available.')
    expect(body.availability).toBeNull()
    expect(allTexts().some(t => t.includes('event_ticket_type_session_inventory'))).toBe(false)
  })

  it('when the read side could not assess (no row), the quote is still priced and availability is null — the gate remains the authority', async () => {
    queue([ADULT])
    const body = await (await quoteRoute.POST(jsonReq(QUOTE_URL, 'POST', { items: [{ ticket_type_id: 'tt-adult', quantity: 1 }] }), SLUG_CTX)).json()
    expect(body.cart_error).toBeNull()
    expect(body.total_cents).toBe(4000)
    expect(body.availability).toBeNull()
  })
})

// ─── WHOLE-EVENT MATRIX READ PATH ──────────────────────────────────────

describe('GET /api/events/[id]/inventory — the type × session matrix (viewer+, read only)', () => {
  const SESSIONS = [{ id: 'sess-fri', name: 'Friday', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z', capacity: 8, sold: 5 }]
  const TYPES = [
    { id: 'tt-adult', name: 'Adult', active: true, capacity: 10, sold: 7, sold_without_session: 2 },
    { id: 'tt-vip', name: 'VIP', active: true, capacity: 3, sold: 1, sold_without_session: 0 },
  ]
  const CELLS = [
    { event_session_id: 'sess-fri', ticket_type_id: 'tt-adult', override_capacity: null, effective_capacity: 10, sold: 5 },
    { event_session_id: 'sess-fri', ticket_type_id: 'tt-vip', override_capacity: 1, effective_capacity: 1, sold: 1 },
  ]

  it('viewer reads every cell with override, effective capacity, sold and remaining; a no-override cell is bounded by the type\'s event-wide remaining', async () => {
    queue([{ id: 'event-1' }], SESSIONS, TYPES, CELLS)
    const res = await matrixRoute.GET(jsonReq(MATRIX_URL, 'GET'), MATRIX_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toEqual([{ ...SESSIONS[0], remaining: 3 }])
    expect(body.ticket_types).toEqual([{ ...TYPES[0], remaining: 3 }, { ...TYPES[1], remaining: 2 }])
    // Adult has no override: 10 - 5 in this session would be 5, but only
    // 3 Adult remain event-wide (7 sold anywhere) — the gate's fallback.
    expect(body.cells[0]).toMatchObject({ ticket_type_id: 'tt-adult', override_capacity: null, remaining: 3 })
    // VIP's override replaces the event-wide figure: 1 - 1 = 0.
    expect(body.cells[1]).toMatchObject({ ticket_type_id: 'tt-vip', override_capacity: 1, remaining: 0 })
  })

  it('every statement is scoped by the caller\'s organisation and the event; sold figures use the gate\'s live predicate; nothing is written', async () => {
    queue([{ id: 'event-1' }], SESSIONS, TYPES, CELLS)
    await matrixRoute.GET(jsonReq(MATRIX_URL, 'GET'), MATRIX_CTX)
    const texts = allTexts()
    expect(texts.length).toBe(4)
    for (const t of texts) {
      expect(t).toContain('organisation_id')
      expect(t).not.toMatch(/INSERT|UPDATE|DELETE|FOR UPDATE/)
    }
    for (const t of texts.slice(1)) {
      expect(t).toContain("eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
    }
    expect(texts[3]).toContain('COALESCE(inv.capacity, tt.capacity)::int AS effective_capacity')
    expect(callArgs(0)).toContain('org-a')
  })

  it('an event of another organisation is "Not found" before any inventory statement', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer', 'org-b'))
    queue([])
    const res = await matrixRoute.GET(jsonReq(MATRIX_URL, 'GET'), MATRIX_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('unauthenticated -> 401, no SQL', async () => {
    requireSessionMock.mockRejectedValue(new Error('no session'))
    const res = await matrixRoute.GET(jsonReq(MATRIX_URL, 'GET'), MATRIX_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('is viewer+ via authorizeEventsRequest, never casts ::uuid, and has no seating / allocation / promo / fee / Stripe scope creep', () => {
    const code = stripComments(read('app/api/events/[id]/inventory/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\('viewer'\)/)
    expect(code).not.toMatch(/::uuid/i)
    expect(code).not.toMatch(/seat|row_number|promo|coupon|gst|tax|fee|allocation|hold_|recurr|stripe|eve\b/i)
    expect(code).not.toMatch(/body\.organisation_id|organisationId: body/)
  })
})

// ─── PROOF + ADR + CONTAINMENT ────────────────────────────────────────

describe('real-Postgres proof section K and ADR-0006', () => {
  const proof = read('scripts/tests/verify-events-ticket-type-session-inventory.sh')

  it('the proof script mirrors assessCartAvailability (same cart_tt, a sess CTE scoped to the event, the session-full arithmetic) and runs section K', () => {
    expect(proof).toContain('=== K: read-side availability (public quote) agrees with the reservation gate ===')
    const fn = proof.slice(proof.indexOf('avail_sql() {'), proof.indexOf('# Mirrors lib/events/services/paidCheckout.ts'))
    expect(fn).toContain('$(cart_tt_sql "$s" "")')
    expect(fn).toMatch(/SELECT capacity FROM event_sessions\s*\n\s*WHERE id = \$s AND organisation_id = 'org-a' AND event_id = 'event-1'/)
    expect(fn).toContain("(SELECT qty FROM sold_sess) + $TOTAL_QTY > (SELECT capacity FROM sess)")
    expect(fn).not.toMatch(/FOR UPDATE|INSERT|UPDATE /)
    for (const k of ['K1.', 'K5.', 'K8.', 'K9.', 'K12.', 'K13.', 'K14.']) expect(proof).toContain(k)
  })

  it('every earlier proof section is still present (M, Z, A–J, the mutation proof)', () => {
    for (const section of ['=== M:', '=== Z:', '=== A:', '=== B:', '=== C:', '=== D:', '=== E:', '=== F:', '=== G:', '=== H:', '=== I:', '=== J:', '=== J MUTATION PROOF']) {
      expect(proof).toContain(section)
    }
  })

  it('ADR-0006 records the compatibility rule, the effective-capacity rule, the lock order, the deadlock analysis, the retry decision, the read-side twin and the seating seam', () => {
    const adr = read('docs/architecture/decisions/0006-events-ga-inventory-layer.md')
    for (const needle of [
      'Backward-compatibility rule', 'fallback', 'event_sessions.capacity', 'Effective-capacity rule',
      'Lock order and deadlock analysis', 'ascending `ticket_type_id`', 'Retry uses **current available',
      'assessCartAvailability', 'Seating seam', 'general-admission', 'Known deferrals',
    ]) expect(adr).toContain(needle)
  })
})

describe('Phase 6 containment — nothing about the gate, the lock order, the cart rules or the public validation changed', () => {
  it('the lock builder and lock order are unchanged: types asc, pair rows asc, session, promotion', () => {
    expect(cartLockOrder(['tt-b', 'tt-a', 'tt-c'])).toEqual(['tt-a', 'tt-b', 'tt-c'])
    sqlMock.mockClear()
    buildCartLockStatements('org-a', ['tt-b', 'tt-a'], 'sess-fri', 'promo-1')
    const texts = allTexts()
    expect(texts.length).toBe(6)
    expect(texts[0]).toContain('FROM event_ticket_types')
    expect(texts[1]).toContain('FROM event_ticket_types')
    expect(texts[2]).toContain('FROM event_ticket_type_session_inventory')
    expect(texts[3]).toContain('FROM event_ticket_type_session_inventory')
    expect(texts[4]).toContain('FROM event_sessions')
    expect(texts[5]).toContain('FROM event_promotion_codes')
    for (const t of texts) expect(t).toContain('FOR UPDATE')
    expect(callArgs(0)).toContain('tt-a')
    expect(callArgs(1)).toContain('tt-b')
  })

  it('the cart rules (all-free or all-paid, one currency, 20-ticket cap) and the public validation are untouched', () => {
    const cart = stripComments(CART_SRC)
    expect(cart).toMatch(/MIXED_FREE_AND_PAID/)
    expect(cart).toMatch(/CURRENCY_MISMATCH/)
    const pv = stripComments(read('lib/events/publicValidation.ts'))
    expect(pv).toContain('export const MAX_QUANTITY = 20;')
    expect(pv).not.toMatch(/session_inventory|override|availability/)
  })

  it('no schema change in this phase: no new migration file, Prisma mirror unchanged for the inventory table', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'scripts')).filter(f => /session-inventory|phase-?6|ga-inventory/i.test(f))
    expect(files).toEqual(['create-events-ticket-type-session-inventory.sql'])
    const prisma = read('prisma/schema.prisma')
    expect((prisma.match(/@@map\("event_ticket_type_session_inventory"\)/g) ?? []).length).toBe(1)
  })

  it('the services never call the read-side twin (the gate stays the only decision inside a reservation)', () => {
    for (const src of Object.values(SERVICES)) expect(src).not.toContain('assessCartAvailability')
  })
})
