import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events registration operations phase — search/filter for
// GET /api/events/[id]/orders. Route-level tests mock every dependency
// (no real database) — real-Postgres proof of the actual filter
// SEMANTICS (EXISTS-based checkin, mixed-attendee behavior, ticket-
// type/session narrowing, cross-tenant exclusion) lives in
// scripts/tests/verify-events-registration-search-filter.sh, not
// duplicated here. What THIS file proves: parseRegistrationFilters()'s
// exact parsing rules (pure function, no mocking needed at all),
// buildRegistrationFilterSql()'s SQL text shape (static source checks,
// cross-referencing the harness's own hand-written mirror of this same
// text), and route-level auth/tenancy/wiring.
//
// MOCK NOTE: buildRegistrationFilterSql() itself calls sql`` internally
// (once per active filter, for composition) — since sql is mocked as a
// flat vi.fn() here (not a real fragment-composing driver), those
// internal calls also hit the mock and would corrupt a queue-position-
// based response strategy. Tests that need a SPECIFIC final query
// result use a query-TEXT-matching mockImplementation instead (matching
// on a distinguishing substring like 'FROM events' or
// 'FROM event_orders'), which is immune to however many internal
// fragment calls buildRegistrationFilterSql happens to make.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sqlMock = vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
sqlMock.mockResolvedValue([])
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args) }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: (...args: unknown[]) => checkCapabilityMock(...args),
  }
})

function sessionAs(role: string, organisationId = 'org-a') {
  return { userId: 'staff-1', organisationId, role, name: 'Staff One' }
}
function textMatchMock(rules: { match: string; rows: unknown[] }[]) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join('?')
    for (const rule of rules) {
      if (text.includes(rule.match)) return Promise.resolve(rule.rows)
    }
    return Promise.resolve([])
  })
}

const {
  parseRegistrationFilters,
  buildRegistrationFilterSql,
  PAYMENT_STATUS_VALUES,
} = await import('@/lib/events/registrationFilters')
const ordersRoute = await import('@/app/api/events/[id]/orders/route')

const CTX = { params: Promise.resolve({ id: 'event-1' }) }
function getReq(qs = '') {
  return new Request(`http://localhost/api/events/event-1/orders${qs ? `?${qs}` : ''}`)
}

beforeEach(() => {
  sqlMock.mockReset()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  checkCapabilityMock.mockReset()
  sqlMock.mockImplementation(() => Promise.resolve([]))
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
})

// ─────────────────────────────────────────────────────────────────────
// parseRegistrationFilters — pure function, no mocking needed
// ─────────────────────────────────────────────────────────────────────

describe('parseRegistrationFilters', () => {
  it('absent params -> every field unset', () => {
    expect(parseRegistrationFilters(new URLSearchParams())).toEqual({})
  })

  it('trims q and drops it entirely if blank after trimming', () => {
    expect(parseRegistrationFilters(new URLSearchParams('q=%20%20Jane%20%20'))).toEqual({ q: 'Jane' })
    expect(parseRegistrationFilters(new URLSearchParams('q=%20%20'))).toEqual({})
  })

  it('accepts every valid paymentStatus value', () => {
    for (const v of PAYMENT_STATUS_VALUES) {
      expect(parseRegistrationFilters(new URLSearchParams(`paymentStatus=${v}`))).toEqual({ paymentStatus: v })
    }
  })

  it('an unknown paymentStatus value is ignored, not 400 — read-only-list-endpoint policy', () => {
    expect(parseRegistrationFilters(new URLSearchParams('paymentStatus=BOGUS'))).toEqual({})
  })

  it('checkin accepts only "in" or "out"', () => {
    expect(parseRegistrationFilters(new URLSearchParams('checkin=in'))).toEqual({ checkin: 'in' })
    expect(parseRegistrationFilters(new URLSearchParams('checkin=out'))).toEqual({ checkin: 'out' })
    expect(parseRegistrationFilters(new URLSearchParams('checkin=maybe'))).toEqual({})
  })

  it('cancelled accepts only the literal strings "true"/"false"', () => {
    expect(parseRegistrationFilters(new URLSearchParams('cancelled=true'))).toEqual({ cancelled: true })
    expect(parseRegistrationFilters(new URLSearchParams('cancelled=false'))).toEqual({ cancelled: false })
    expect(parseRegistrationFilters(new URLSearchParams('cancelled=1'))).toEqual({})
  })

  it('ticketTypeId / sessionId pass through trimmed, when non-empty', () => {
    expect(parseRegistrationFilters(new URLSearchParams('ticketTypeId=tt-1'))).toEqual({ ticketTypeId: 'tt-1' })
    expect(parseRegistrationFilters(new URLSearchParams('sessionId=s-1'))).toEqual({ sessionId: 's-1' })
    expect(parseRegistrationFilters(new URLSearchParams('ticketTypeId=%20%20'))).toEqual({})
  })

  it('all six filters can be set simultaneously', () => {
    const params = new URLSearchParams('q=jane&paymentStatus=PAID&checkin=in&cancelled=false&ticketTypeId=tt-1&sessionId=s-1')
    expect(parseRegistrationFilters(params)).toEqual({
      q: 'jane', paymentStatus: 'PAID', checkin: 'in', cancelled: false, ticketTypeId: 'tt-1', sessionId: 's-1',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// buildRegistrationFilterSql — static SQL-text shape (real-Postgres
// semantic proof lives in the harness script, not here)
// ─────────────────────────────────────────────────────────────────────

describe('buildRegistrationFilterSql — SQL text shape', () => {
  it('an empty filters object produces exactly one call — the unconditional empty base fragment (sql``) — never any AND condition appended', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({}, 'org-a')
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const text = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('?')
    expect(text.trim()).toBe('')
  })

  it('q builds a search clause covering purchaser name/email, an attendee-name EXISTS, and an order-id prefix match — matching the harness\'s list_query_ids search scenarios', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ q: 'Jane' }, 'org-a')
    const allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toContain('eo.purchaser_name ILIKE')
    expect(allText).toContain('eo.purchaser_email ILIKE')
    expect(allText).toContain('eo.id ILIKE')
    expect(allText).toMatch(/EXISTS[\s\S]*event_attendees ea_search[\s\S]*ea_search\.order_item_id = oi\.id/)
    expect(allText).toContain('ea_search.attendee_name ILIKE')
  })

  it('a phone-shaped q also adds a digit-normalized purchaser_phone condition', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ q: '0412 345 678' }, 'org-a')
    const allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toContain("regexp_replace(COALESCE(eo.purchaser_phone, ''), '[^0-9]', '', 'g') ILIKE")
  })

  it('a non-phone-shaped q (pure letters) omits the phone condition entirely', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ q: 'Jane Doe' }, 'org-a')
    const allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).not.toContain('purchaser_phone')
  })

  it('checkin=in and checkin=out both use EXISTS scoped to oi.id and organisation_id — never a per-attendee-row filter', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ checkin: 'in' }, 'org-a')
    let allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toMatch(/EXISTS[\s\S]*ea_checkin\.order_item_id = oi\.id[\s\S]*ea_checkin\.checked_in_at IS NOT NULL/)

    sqlMock.mockClear()
    buildRegistrationFilterSql({ checkin: 'out' }, 'org-a')
    allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toMatch(/EXISTS[\s\S]*ea_checkin\.order_item_id = oi\.id[\s\S]*ea_checkin\.checked_in_at IS NULL/)
  })

  it('cancelled=true/false target eo.status, never event_attendees', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ cancelled: true }, 'org-a')
    let allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toContain("eo.status = 'CANCELLED'")

    sqlMock.mockClear()
    buildRegistrationFilterSql({ cancelled: false }, 'org-a')
    allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toContain("eo.status <> 'CANCELLED'")
  })

  it('ticketTypeId/sessionId target oi.ticket_type_id / oi.event_session_id directly — order_item grain, not order grain', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ ticketTypeId: 'tt-1' }, 'org-a')
    let allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toContain('oi.ticket_type_id =')

    sqlMock.mockClear()
    buildRegistrationFilterSql({ sessionId: 's-1' }, 'org-a')
    allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).toContain('oi.event_session_id =')
  })

  it('never references event_order_notes or event_registration_responses — search/filter never touches internal notes or registration answers', () => {
    sqlMock.mockClear()
    buildRegistrationFilterSql({ q: 'anything', paymentStatus: 'PAID', checkin: 'in', cancelled: true, ticketTypeId: 'tt-1', sessionId: 's-1' }, 'org-a')
    const allText = sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?')).join(' ')
    expect(allText).not.toContain('event_order_notes')
    expect(allText).not.toContain('event_registration_responses')
  })
})

// ─────────────────────────────────────────────────────────────────────
// GET /api/events/[id]/orders — auth/tenancy/wiring
// ─────────────────────────────────────────────────────────────────────

describe('GET /api/events/[id]/orders — auth (viewer+)', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await ordersRoute.GET(getReq(), CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer role passes (this route has always been viewer+, unchanged by this phase)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    textMatchMock([{ match: 'FROM events', rows: [{ id: 'event-1' }] }])
    const res = await ordersRoute.GET(getReq(), CTX)
    expect(res.status).toBe(200)
  })

  it('missing events capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockRejectedValue(new Error('Forbidden'))
    const res = await ordersRoute.GET(getReq(), CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('event not belonging to the caller\'s organisation -> 404', async () => {
    textMatchMock([{ match: 'FROM events', rows: [] }])
    const res = await ordersRoute.GET(getReq(), CTX)
    expect(res.status).toBe(404)
  })

  it('the event-existence check is always scoped to the session organisation, never a query param', () => {
    const src = stripComments(read('app/api/events/[id]/orders/route.ts'))
    expect(src).toContain('session.organisationId')
    expect(src).not.toMatch(/organisationId:\s*req\.|searchParams\.get\('organisationId'\)/)
  })
})

describe('GET /api/events/[id]/orders — search/filter query params are parsed and applied', () => {
  it('calls parseRegistrationFilters and buildRegistrationFilterSql — never a second, hand-copied filter implementation', () => {
    const src = stripComments(read('app/api/events/[id]/orders/route.ts'))
    expect(src).toContain('parseRegistrationFilters(searchParams)')
    expect(src).toContain('buildRegistrationFilterSql(filters, session.organisationId)')
    expect(src).toContain("from '@/lib/events/registrationFilters'")
  })

  it('with no query params, behavior is unchanged from before this phase — the filter clause is spliced in but empty', async () => {
    textMatchMock([{ match: 'FROM events', rows: [{ id: 'event-1' }] }])
    const res = await ordersRoute.GET(getReq(), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('orders')
    expect(body).toHaveProperty('crm_enabled')
  })

  it('order_count is computed as the DISTINCT count of order ids in the response, not the row count (row grain is one row per order_item)', async () => {
    textMatchMock([
      { match: 'FROM events', rows: [{ id: 'event-1' }] },
      {
        match: 'FROM event_orders',
        rows: [
          { id: 'order-1', order_item_id: 'item-1' },
          { id: 'order-1', order_item_id: 'item-2' }, // same order, two ticket types
          { id: 'order-2', order_item_id: 'item-3' },
        ],
      },
    ])
    const res = await ordersRoute.GET(getReq(), CTX)
    const body = await res.json()
    expect(body.orders).toHaveLength(3)
    expect(body.order_count).toBe(2)
  })
})
