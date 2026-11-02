import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Eve Phase 3.3 — organiser Payments, READ-ONLY. Everything below the handler
// is mocked; this file proves authorization, tenant scoping, projection and
// the absence of any mutation. The SQL itself is proven against real Postgres
// in ticketingOrganiserPaymentsRealPostgres.test.ts.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

type Row = Record<string, unknown>
const db: { users: Row[]; orgs: Row[]; entitled: Set<string> } = { users: [], orgs: [], entitled: new Set() }

vi.mock('@/lib/db', () => ({
  default: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?')
    if (q.includes('FROM users WHERE id')) return db.users.filter(u => u.id === values[values.length - 1]).map(u => ({ ...u, session_live: true }))
    if (q.includes('FROM organisations WHERE id')) return db.orgs.filter(o => o.id === values[0])
    return []
  },
}))
vi.mock('@/lib/capabilities/requireCapability', async orig => {
  const actual = await orig<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: async (org: string) => {
      if (!db.entitled.has(org)) throw new actual.CapabilityAccessError('NO_ENTITLEMENT')
      return { key: 'events', config: {} }
    },
  }
})

const reads = { listPaymentOrders: vi.fn(), getPaymentOrder: vi.fn() }
vi.mock('@/lib/events/organiserPayments', () => ({
  listPaymentOrders: (...a: unknown[]) => reads.listPaymentOrders(...a),
  getPaymentOrder: (...a: unknown[]) => reads.getPaymentOrder(...a),
}))
const connect = { getConnectAccountState: vi.fn(), checkPaidTicketingEligibility: vi.fn() }
vi.mock('@/lib/events/stripeConnect', () => ({
  getConnectAccountState: (...a: unknown[]) => connect.getConnectAccountState(...a),
  checkPaidTicketingEligibility: (...a: unknown[]) => connect.checkPaidTicketingEligibility(...a),
}))
// Unrelated organiser reads the module also imports.
vi.mock('@/lib/events/organiserReads', () => ({ listOrganisationEvents: vi.fn(), getOrganisationEvent: vi.fn(), listEventRegistrationRows: vi.fn() }))
vi.mock('@/lib/events/checkIn', () => ({ resolveAttendee: vi.fn(), searchAttendees: vi.fn() }))
vi.mock('@/lib/events/checkInOps', () => ({ eventBelongsToOrganisation: vi.fn(), confirmCheckInWithAudit: vi.fn(), undoCheckInWithAudit: vi.fn() }))

const org = await import('@/lib/ticketing/organiserApi')
const { issueTicketingSession } = await import('@/lib/ticketing/session')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const tok = async (u: string, o: string) => (await issueTicketingSession(u, o))!.token
async function authed(userId = 'u-mgr', orgId = 'org-a', extra: Record<string, string> = {}, url = 'http://bb.test/x') {
  return new Request(url, { method: 'GET', headers: { ...GATE, 'x-ticketing-session': await tok(userId, orgId), ...extra } })
}

const base = {
  event_id: 'ev-1', event_name: 'Gala', event_timezone: 'Australia/Adelaide', purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
  status: 'CONFIRMED', currency: 'aud', discount_cents: 0, fee_label: null, platform_fee_refunded_cents: null,
  created_at: '2026-10-01T00:00:00.000Z', paid_at: null, refunded_at: null,
}
const ROWS = {
  paidZeroFeeHistorical: { ...base, id: 'o-hist', payment_status: 'PAID', total_cents: 5000, platform_fee_cents: null, fee_mode: null, payment_total_cents: null, refunded_cents: null, paid_at: '2026-10-01T01:00:00.000Z' },
  paidPassThrough: { ...base, id: 'o-pt', payment_status: 'PAID', total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', fee_label: 'Booking fee', payment_total_cents: 20325, refunded_cents: null, paid_at: '2026-10-02T01:00:00.000Z' },
  paidAbsorb: { ...base, id: 'o-ab', payment_status: 'PAID', total_cents: 19800, platform_fee_cents: 525, fee_mode: 'ABSORB', payment_total_cents: 19800, refunded_cents: null, paid_at: '2026-10-03T01:00:00.000Z' },
  pending: { ...base, id: 'o-pe', status: 'PENDING', payment_status: 'PENDING', total_cents: 3000, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 3000, refunded_cents: null },
  failed: { ...base, id: 'o-fa', status: 'CANCELLED', payment_status: 'FAILED', total_cents: 3000, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 3000, refunded_cents: null },
  expired: { ...base, id: 'o-ex', status: 'CANCELLED', payment_status: 'EXPIRED', total_cents: 3000, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 3000, refunded_cents: null },
  refunded: { ...base, id: 'o-re', status: 'CANCELLED', payment_status: 'REFUNDED', total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: 20325, refunded_cents: 20325, platform_fee_refunded_cents: 525, paid_at: '2026-10-04T01:00:00.000Z', refunded_at: '2026-10-05T01:00:00.000Z' },
  refundedNoFigure: { ...base, id: 'o-re2', status: 'CANCELLED', payment_status: 'REFUNDED', total_cents: 5000, platform_fee_cents: 0, fee_mode: null, payment_total_cents: null, refunded_cents: null, refunded_at: '2026-10-05T01:00:00.000Z' },
}
const ALL = Object.values(ROWS)

beforeEach(() => {
  for (const f of [...Object.values(reads), ...Object.values(connect)]) f.mockReset()
  db.entitled = new Set(['org-a', 'org-b'])
  db.orgs = [
    { id: 'org-a', name: 'A', slug: 'a', status: 'ACTIVE', settings: { events: { eveEnabled: true } } },
    { id: 'org-b', name: 'B', slug: 'b', status: 'ACTIVE', settings: { events: { eveEnabled: true } } },
  ]
  db.users = [
    { id: 'u-mgr', organisation_id: 'org-a', role: 'MANAGER', status: 'ACTIVE', name: 'Mgr' },
    { id: 'u-view', organisation_id: 'org-a', role: 'VIEWER', status: 'ACTIVE', name: 'View' },
    { id: 'u-b', organisation_id: 'org-b', role: 'ADMIN', status: 'ACTIVE', name: 'B user' },
  ]
  reads.listPaymentOrders.mockResolvedValue({ rows: ALL, truncated: false })
  reads.getPaymentOrder.mockResolvedValue(null)
  connect.getConnectAccountState.mockResolvedValue({
    status: 'CONNECTED', accountId: 'acct_SECRET123', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
    connectedAt: '2026-09-01T00:00:00.000Z', lastSyncedAt: '2026-10-10T00:00:00.000Z',
  })
  connect.checkPaidTicketingEligibility.mockResolvedValue({ eligible: true, accountId: 'acct_SECRET123' })
})

const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('authorization', () => {
  it('denies both payment handlers without the gate, without a session, and with a browser origin — before any read', async () => {
    const handlers: ((r: Request) => Promise<Response>)[] = [r => org.handleOrganiserPayments(r), r => org.handleOrganiserPayment(r, 'o-pt')]
    for (const h of handlers) {
      expect((await h(new Request('http://bb.test/x'))).status).toBe(401)
      expect((await h(new Request('http://bb.test/x', { headers: GATE }))).status).toBe(401)
      expect((await h(await authed('u-mgr', 'org-a', { origin: 'https://evil.example' }))).status).toBe(403)
      expect((await h(await authed('u-mgr', 'org-a', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    }
    expect(reads.listPaymentOrders).not.toHaveBeenCalled()
    expect(reads.getPaymentOrder).not.toHaveBeenCalled()
    expect(connect.getConnectAccountState).not.toHaveBeenCalled()
  })

  it('a viewer and a manager may both read', async () => {
    for (const u of ['u-view', 'u-mgr']) {
      expect((await org.handleOrganiserPayments(await authed(u))).status).toBe(200)
    }
  })

  it('is denied after the Events capability is removed or the user is disabled', async () => {
    db.entitled.delete('org-a')
    expect((await org.handleOrganiserPayments(await authed('u-view'))).status).toBe(403)
    db.entitled.add('org-a')
    db.users[1].status = 'INACTIVE'
    expect((await org.handleOrganiserPayments(await authed('u-view'))).status).toBe(401)
    expect(reads.listPaymentOrders).not.toHaveBeenCalled()
  })

  it('reads are scoped to the organisation reloaded from the database, never to anything in the request', async () => {
    await org.handleOrganiserPayments(await authed('u-mgr', 'org-a', {}, 'http://bb.test/x?organisationId=org-b&organisation_id=org-b'))
    expect(reads.listPaymentOrders).toHaveBeenCalledWith('org-a', null)
    expect(connect.getConnectAccountState).toHaveBeenCalledWith('org-a')
    await org.handleOrganiserPayment(await authed('u-mgr', 'org-a', { 'x-organisation-id': 'org-b' }), 'o-pt')
    expect(reads.getPaymentOrder).toHaveBeenCalledWith('org-a', 'o-pt')
  })

  it('a user of another organisation cannot use a token minted for org-a', async () => {
    expect((await org.handleOrganiserPayments(await authed('u-b', 'org-a'))).status).toBe(401)
  })

  it('cross-tenant order id: the tenant-scoped reader returns nothing, so the answer is the same 404 as an unknown id', async () => {
    reads.getPaymentOrder.mockResolvedValue(null)
    const res = await org.handleOrganiserPayment(await authed('u-view', 'org-a'), 'order-of-org-b')
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: 'Not found.' })
    expect(reads.getPaymentOrder).toHaveBeenCalledWith('org-a', 'order-of-org-b')
  })

  it('rejects non-identifier order ids before any query, and invalid filters with 400', async () => {
    expect((await org.handleOrganiserPayment(await authed(), "x'; DROP TABLE event_orders;--")).status).toBe(404)
    expect(reads.getPaymentOrder).not.toHaveBeenCalled()
    expect((await org.handleOrganiserPayments(await authed('u-mgr', 'org-a', {}, 'http://bb.test/x?status=NOT_REQUIRED'))).status).toBe(400)
    expect((await org.handleOrganiserPayments(await authed('u-mgr', 'org-a', {}, 'http://bb.test/x?event=a%20b'))).status).toBe(400)
    expect(reads.listPaymentOrders).not.toHaveBeenCalled()
  })
})

describe('payment states and snapshot semantics', () => {
  async function list(qs = '') {
    const res = await org.handleOrganiserPayments(await authed('u-view', 'org-a', {}, `http://bb.test/x${qs}`))
    expect(res.status).toBe(200)
    return json(res)
  }
  const byId = (body: any, id: string) => body.orders.find((o: any) => o.id === id) // eslint-disable-line @typescript-eslint/no-explicit-any

  it('paid order: charged amount, paid_at, share before processing', async () => {
    const o = byId(await list(), 'o-ab')
    expect(o).toMatchObject({ payment_state: 'PAID', currency: 'AUD', paid_at: '2026-10-03T01:00:00.000Z', refunded_amount_cents: null })
    expect(o.payment_total_cents).toBe(19800)
  })
  it('PASS_THROUGH fee: buyer paid ticket + fee; organiser share is the ticket total', async () => {
    const o = byId(await list(), 'o-pt')
    expect(o).toMatchObject({ fee_mode: 'PASS_THROUGH', platform_fee_cents: 525, fee_label: 'Booking fee', ticket_total_cents: 19800, payment_total_cents: 20325, organiser_share_before_processing_cents: 19800 })
  })
  it('ABSORB fee: buyer paid the ticket total; the fee is deducted from the organiser share', async () => {
    const o = byId(await list(), 'o-ab')
    expect(o).toMatchObject({ fee_mode: 'ABSORB', platform_fee_cents: 525, payment_total_cents: 19800, organiser_share_before_processing_cents: 19275 })
  })
  it('historical zero-fee order (no fee snapshot, no payment total): reads the ticket total, no fee, never recomputed', async () => {
    const o = byId(await list(), 'o-hist')
    expect(o).toMatchObject({ fee_mode: null, platform_fee_cents: 0, payment_total_cents: 5000, ticket_total_cents: 5000, organiser_share_before_processing_cents: 5000 })
  })
  it('pending / failed / expired carry their state and no refund or share', async () => {
    const body = await list()
    for (const [id, state] of [['o-pe', 'PENDING'], ['o-fa', 'FAILED'], ['o-ex', 'EXPIRED']] as const) {
      expect(byId(body, id)).toMatchObject({ payment_state: state, refunded_amount_cents: null, organiser_share_before_processing_cents: null, paid_at: null })
    }
  })
  it('refunded: the stored refunded_cents wins; with no stored figure the payment total is used; no organiser share', async () => {
    const body = await list()
    expect(byId(body, 'o-re')).toMatchObject({ payment_state: 'REFUNDED', refunded_amount_cents: 20325, platform_fee_refunded_cents: 525, refunded_at: '2026-10-05T01:00:00.000Z', organiser_share_before_processing_cents: null })
    expect(byId(body, 'o-re2')).toMatchObject({ refunded_amount_cents: 5000, platform_fee_refunded_cents: null })
  })

  it('state filter narrows the list but not the summary', async () => {
    const body = await list('?status=REFUNDED')
    expect(body.orders.map((o: any) => o.id).sort()).toEqual(['o-re', 'o-re2']) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.summary.currencies[0].counts).toMatchObject({ PAID: 3, PENDING: 1, FAILED: 1, EXPIRED: 1, REFUNDED: 2 })
    expect(body.filter).toEqual({ status: 'REFUNDED', event: null })
  })

  it('aggregates: paid revenue, platform fees, refunds, share before processing, counts — per currency, from snapshots', async () => {
    const [aud] = (await list()).summary.currencies
    expect(aud.currency).toBe('AUD')
    // PAID = 5000 (historical) + 20325 (pass-through) + 19800 (absorb)
    expect(aud.paid_revenue_cents).toBe(45125)
    // fees on PAID orders only: 0 + 525 + 525
    expect(aud.platform_fees_cents).toBe(1050)
    // share: 5000 + 19800 + (19800 - 525)
    expect(aud.organiser_share_before_processing_cents).toBe(44075)
    // refunds: 20325 (stored) + 5000 (fallback to the payment total)
    expect(aud.refunded_cents).toBe(25325)
    expect(aud.counts).toEqual({ PAID: 3, PENDING: 1, FAILED: 1, EXPIRED: 1, REFUNDED: 2 })
  })

  it('currencies are summarised separately, never added together', async () => {
    reads.listPaymentOrders.mockResolvedValue({ rows: [ROWS.paidAbsorb, { ...ROWS.paidAbsorb, id: 'o-nz', currency: 'nzd' }], truncated: false })
    const cur = (await list()).summary.currencies
    expect(cur.map((c: any) => [c.currency, c.paid_revenue_cents])).toEqual([['AUD', 19800], ['NZD', 19800]]) // eslint-disable-line @typescript-eslint/no-explicit-any
  })

  it('reports an incomplete summary when the row cap was hit', async () => {
    reads.listPaymentOrders.mockResolvedValue({ rows: ALL, truncated: true })
    expect((await list()).summary.complete).toBe(false)
  })

  it('detail returns the order plus its lines', async () => {
    reads.getPaymentOrder.mockResolvedValue({ order: ROWS.paidPassThrough, lines: [{ description: 'General', quantity: 2, unit_price_cents: 10000, discount_cents: 200 }] })
    const body = await json(await org.handleOrganiserPayment(await authed('u-view'), 'o-pt'))
    expect(body.order).toMatchObject({ id: 'o-pt', payment_total_cents: 20325 })
    expect(body.lines).toEqual([{ description: 'General', quantity: 2, unit_price_cents: 10000, discount_cents: 200 }])
  })
})

describe('Connect status handling', () => {
  it('projects cached state only and derives eligibility from the existing paid-checkout rule', async () => {
    const { connect: c } = await json(await org.handleOrganiserPayments(await authed('u-view')))
    expect(c).toEqual({
      status: 'CONNECTED', connected: true, charges_enabled: true, payouts_enabled: true, details_submitted: true,
      eligible_for_paid_ticketing: true, connected_at: '2026-09-01T00:00:00.000Z', last_synced_at: '2026-10-10T00:00:00.000Z',
    })
  })
  it('not connected => eligible false, still 200', async () => {
    connect.getConnectAccountState.mockResolvedValue({ status: 'NOT_CONNECTED', accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, connectedAt: null, lastSyncedAt: null })
    connect.checkPaidTicketingEligibility.mockResolvedValue({ eligible: false, reason: 'Connect Stripe before selling paid tickets.' })
    const res = await org.handleOrganiserPayments(await authed('u-view'))
    expect(res.status).toBe(200)
    expect((await json(res)).connect).toMatchObject({ status: 'NOT_CONNECTED', connected: false, eligible_for_paid_ticketing: false })
  })
  it('a Connect read failure degrades to connect: null, not a 500', async () => {
    connect.getConnectAccountState.mockRejectedValue(new Error('boom'))
    const res = await org.handleOrganiserPayments(await authed('u-view'))
    expect(res.status).toBe(200)
    expect((await json(res)).connect).toBeNull()
  })
})

describe('no leakage, no mutation', () => {
  it('responses contain no provider account id, secret, token or internal id', async () => {
    reads.getPaymentOrder.mockResolvedValue({ order: ROWS.refunded, lines: [] })
    const bodies = [
      JSON.stringify(await json(await org.handleOrganiserPayments(await authed('u-view')))),
      JSON.stringify(await json(await org.handleOrganiserPayment(await authed('u-view'), 'o-re'))),
    ]
    for (const b of bodies) {
      expect(b).not.toMatch(/acct_|SECRET|sk_|whsec_|cs_|pi_|ticket_token|booking_token|stripe_|account_id|accountId|product_surface/i)
    }
  })

  it('payment handlers perform no write: only the two read functions and the two Connect reads are ever called', async () => {
    await org.handleOrganiserPayments(await authed('u-mgr'))
    await org.handleOrganiserPayment(await authed('u-mgr'), 'o-pt')
    expect(Object.keys(reads).sort()).toEqual(['getPaymentOrder', 'listPaymentOrders'])
    expect(Object.keys(connect).sort()).toEqual(['checkPaidTicketingEligibility', 'getConnectAccountState'])
  })

  const ROOT = path.resolve(__dirname, '../..')
  const code = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the read module issues SELECTs only and scopes every query by organisation', () => {
    const src = code('lib/events/organiserPayments.ts')
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i)
    expect(src.match(/organisation_id = \$\{organisationId\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(src).not.toMatch(/stripe|refund\(|createRefund/i)
  })

  it('the payment handlers import no Stripe client, refund, checkout or webhook code', () => {
    const src = code('lib/ticketing/organiserApi.ts')
    expect(src).not.toMatch(/from '@\/lib\/events\/stripe'|services\/orderTransitions|createRefund|refundPayment|getStripeClient|createCheckoutSession|createOnboardingLink|getOrCreateConnectedAccount|refreshConnectedAccountStatus/)
  })

  it('exposes no refund, mutation or onboarding route under payments', () => {
    const routes = ['app/api/ticketing/organiser/payments/route.ts', 'app/api/ticketing/organiser/payments/[orderId]/route.ts']
    for (const f of routes) {
      const exported = [...code(f).matchAll(/export (?:async function|const|function) (\w+)/g)].map(m => m[1])
      expect(exported, f).toEqual(['GET'])
    }
  })
})
