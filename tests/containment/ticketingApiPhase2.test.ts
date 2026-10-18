import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Eve Phase 2 — the bounded /api/ticketing public + organiser surface.
// Every dependency below the handler layer is mocked; no Production
// connection exists in this file.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

type Row = Record<string, unknown>
const db: { users: Row[]; orgs: Row[]; entitled: Set<string>; counters: Map<string, number>; limiterDown: boolean } = { users: [], orgs: [], entitled: new Set(), counters: new Map(), limiterDown: false }

vi.mock('@/lib/db', () => ({
  default: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?')
    if (q.includes('INSERT INTO ticketing_rate_limits')) {
      if (db.limiterDown) throw new Error('limiter down')
      const k = String(values[0]); const n = (db.counters.get(k) ?? 0) + 1; db.counters.set(k, n); return [{ count: n }]
    }
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

const reads = {
  listOrganisationEvents: vi.fn(), getOrganisationEvent: vi.fn(), listEventRegistrationRows: vi.fn(),
}
vi.mock('@/lib/events/organiserReads', () => ({
  listOrganisationEvents: (...a: unknown[]) => reads.listOrganisationEvents(...a),
  getOrganisationEvent: (...a: unknown[]) => reads.getOrganisationEvent(...a),
  listEventRegistrationRows: (...a: unknown[]) => reads.listEventRegistrationRows(...a),
}))
const checkIn = { resolveAttendee: vi.fn(), searchAttendees: vi.fn() }
vi.mock('@/lib/events/checkIn', () => ({
  resolveAttendee: (...a: unknown[]) => checkIn.resolveAttendee(...a),
  searchAttendees: (...a: unknown[]) => checkIn.searchAttendees(...a),
}))
const ops = { eventBelongsToOrganisation: vi.fn(), confirmCheckInWithAudit: vi.fn(), undoCheckInWithAudit: vi.fn() }
vi.mock('@/lib/events/checkInOps', () => ({
  eventBelongsToOrganisation: (...a: unknown[]) => ops.eventBelongsToOrganisation(...a),
  confirmCheckInWithAudit: (...a: unknown[]) => ops.confirmCheckInWithAudit(...a),
  undoCheckInWithAudit: (...a: unknown[]) => ops.undoCheckInWithAudit(...a),
}))

const publicSvc = {
  getPublicEventDetail: vi.fn(), getPublicTicketDetail: vi.fn(), getPublicBookingDetail: vi.fn(),
  resolvePublicEvent: vi.fn(), startPaidCheckout: vi.fn(), generateTicketQrSvg: vi.fn(),
}
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: (...a: unknown[]) => publicSvc.getPublicEventDetail(...a) }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: (...a: unknown[]) => publicSvc.getPublicTicketDetail(...a) }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: (...a: unknown[]) => publicSvc.getPublicBookingDetail(...a) }))
vi.mock('@/lib/events/publicResolve', () => ({ resolvePublicEvent: (...a: unknown[]) => publicSvc.resolvePublicEvent(...a) }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: (...a: unknown[]) => publicSvc.startPaidCheckout(...a) }))
vi.mock('@/lib/events/qr', () => ({ generateTicketQrSvg: (...a: unknown[]) => publicSvc.generateTicketQrSvg(...a) }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(async () => undefined), recordEventBookingActivity: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: vi.fn(async () => Response.json({ total_cents: 1 })) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route', () => ({ POST: vi.fn(async () => Response.json({ booking_token: 'b' }, { status: 201 })) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: vi.fn(async () => Response.json({ payment_status: 'PAID' })) }))

const org = await import('@/lib/ticketing/organiserApi')
const pub = await import('@/lib/ticketing/publicApi')
const { issueTicketingSession } = await import('@/lib/ticketing/session')
const { checkoutSuccessUrl, checkoutCancelUrl, publicTicketUrl, publicBookingWalletUrl, productLinkBase, extractTicketToken } = await import('@ticketing/core')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const tok = async (u: string, o: string) => (await issueTicketingSession(u, o))!.token
async function authed(userId = 'u-mgr', orgId = 'org-a', extra: Record<string, string> = {}, body?: unknown, method = 'GET', url = 'http://bb.test/x') {
  return new Request(url, {
    method, headers: { ...GATE, 'x-ticketing-session': await tok(userId, orgId), 'content-type': 'application/json', ...extra },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  db.counters = new Map(); db.limiterDown = false
  for (const group of [reads, checkIn, ops, publicSvc]) for (const f of Object.values(group)) f.mockReset()
  db.entitled = new Set(['org-a', 'org-b'])
  db.orgs = [
    { id: 'org-a', name: 'A', slug: 'a', status: 'ACTIVE' },
    { id: 'org-b', name: 'B', slug: 'b', status: 'ACTIVE' },
  ]
  db.users = [
    { id: 'u-mgr', organisation_id: 'org-a', role: 'MANAGER', status: 'ACTIVE', name: 'Mgr' },
    { id: 'u-view', organisation_id: 'org-a', role: 'VIEWER', status: 'ACTIVE', name: 'View' },
    { id: 'u-b', organisation_id: 'org-b', role: 'ADMIN', status: 'ACTIVE', name: 'B user' },
  ]
  ops.eventBelongsToOrganisation.mockResolvedValue(true)
  reads.listOrganisationEvents.mockResolvedValue([])
})

describe('organiser API: authorization', () => {
  it('denies every organiser handler without the gate, without a session, and with a browser origin', async () => {
    const handlers: ((r: Request) => Promise<Response>)[] = [
      r => org.handleOrganiserEvents(r), r => org.handleOrganiserSummary(r), r => org.handleOrganiserEvent(r, 'e1'),
      r => org.handleOrganiserOrders(r, 'e1'), r => org.handleOrganiserAttendees(r, 'e1'), r => org.handleOrganiserCheckInSearch(r, 'e1'),
      r => org.handleOrganiserCheckIn(r, 'e1', 'resolve'), r => org.handleOrganiserCheckIn(r, 'e1', 'confirm'), r => org.handleOrganiserCheckIn(r, 'e1', 'undo'),
    ]
    for (const h of handlers) {
      expect((await h(new Request('http://bb.test/x', { method: 'POST' }))).status).toBe(401) // no gate
      expect((await h(new Request('http://bb.test/x', { method: 'POST', headers: GATE }))).status).toBe(401) // gate, no session
      expect((await h(await authed('u-mgr', 'org-a', { origin: 'https://evil.example' }))).status).toBe(403) // browser origin
    }
    expect(reads.listOrganisationEvents).not.toHaveBeenCalled()
    expect(ops.confirmCheckInWithAudit).not.toHaveBeenCalled()
  })

  it('a BrainBase session token is not an Eve session', async () => {
    const { SignJWT } = await import('jose')
    const bb = await new SignJWT({ userId: 'u-mgr', organisationId: 'org-a', role: 'admin', name: 'x', expiresAt: 'x' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SESSION_SECRET!))
    const r = new Request('http://bb.test/x', { headers: { ...GATE, 'x-ticketing-session': bb } })
    expect((await org.handleOrganiserEvents(r)).status).toBe(401)
  })

  it('reads are scoped to the organisation reloaded from the database, never to anything in the request', async () => {
    reads.listOrganisationEvents.mockResolvedValue([{ id: 'e1', name: 'Gala', slug: 'g', status: 'PUBLISHED', stripe_account: 'secret', session_count: 1, ticket_type_count: 1 }])
    const res = await org.handleOrganiserEvents(await authed('u-mgr', 'org-a', {}, undefined, 'GET', 'http://bb.test/x?organisationId=org-b'))
    expect(reads.listOrganisationEvents).toHaveBeenCalledWith('org-a')
    const body = await res.json()
    expect(body.organisation).toEqual({ slug: 'a', name: 'A' })
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('denies a user from another organisation using a token minted for org-a (cross-tenant)', async () => {
    expect((await org.handleOrganiserEvents(await authed('u-b', 'org-a'))).status).toBe(401)
  })

  it('denies after the user is disabled, and after the Events capability is removed', async () => {
    const r1 = await authed('u-mgr', 'org-a')
    db.users[0].status = 'INACTIVE'
    expect((await org.handleOrganiserEvents(r1)).status).toBe(401)
    db.users[0].status = 'ACTIVE'
    const r2 = await authed('u-mgr', 'org-a')
    db.entitled.delete('org-a')
    expect((await org.handleOrganiserEvents(r2)).status).toBe(403)
    expect(reads.listOrganisationEvents).not.toHaveBeenCalled()
  })

  it('check-in: viewers may look up and search; only managers may confirm or undo', async () => {
    checkIn.resolveAttendee.mockResolvedValue({ ok: true, attendee: { id: 'a1', attendee_name: 'Al', ticket_type_name: 'G', session_name: null, checked_in_at: null } })
    checkIn.searchAttendees.mockResolvedValue([])
    ops.confirmCheckInWithAudit.mockResolvedValue({ ok: true, first: true, attendee: { id: 'a1', attendee_name: 'Al', ticket_type_name: 'G', session_name: null, checked_in_at: 'now' } })
    ops.undoCheckInWithAudit.mockResolvedValue({ ok: true, attendee: { id: 'a1', attendee_name: 'Al', ticket_type_name: 'G', session_name: null, checked_in_at: null } })

    const body = { attendee_id: 'a1' }
    expect((await org.handleOrganiserCheckIn(await authed('u-view', 'org-a', {}, body, 'POST'), 'e1', 'resolve')).status).toBe(200)
    expect((await org.handleOrganiserCheckInSearch(await authed('u-view', 'org-a'), 'e1')).status).toBe(200)
    expect((await org.handleOrganiserCheckIn(await authed('u-view', 'org-a', {}, body, 'POST'), 'e1', 'confirm')).status).toBe(403)
    expect((await org.handleOrganiserCheckIn(await authed('u-view', 'org-a', {}, body, 'POST'), 'e1', 'undo')).status).toBe(403)
    expect(ops.confirmCheckInWithAudit).not.toHaveBeenCalled()
    expect(ops.undoCheckInWithAudit).not.toHaveBeenCalled()

    expect((await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, body, 'POST'), 'e1', 'confirm')).status).toBe(200)
    expect(ops.confirmCheckInWithAudit).toHaveBeenCalledWith('org-a', 'e1', { attendee_id: 'a1' }, 'u-mgr')
    expect((await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, body, 'POST'), 'e1', 'undo')).status).toBe(200)
    expect(ops.undoCheckInWithAudit).toHaveBeenCalledWith('org-a', 'e1', 'a1', 'u-mgr')
  })

  it('check-in on an event outside the caller\'s organisation is a 404 and touches nothing', async () => {
    ops.eventBelongsToOrganisation.mockResolvedValue(false)
    const res = await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, { attendee_id: 'a1' }, 'POST'), 'other-event', 'confirm')
    expect(res.status).toBe(404)
    expect(ops.confirmCheckInWithAudit).not.toHaveBeenCalled()
    expect(ops.eventBelongsToOrganisation).toHaveBeenCalledWith('org-a', 'other-event')
  })

  it('a duplicate scan returns 409 with the attendee; failures use the BrainBase wording', async () => {
    const attendee = { id: 'a1', attendee_name: 'Al', ticket_type_name: 'G', session_name: null, checked_in_at: 'earlier' }
    ops.confirmCheckInWithAudit.mockResolvedValueOnce({ ok: true, first: false, attendee })
    const dup = await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, { ticket_token: 'abc' }, 'POST'), 'e1', 'confirm')
    expect(dup.status).toBe(409)
    expect((await dup.json()).first).toBe(false)
    ops.confirmCheckInWithAudit.mockResolvedValueOnce({ ok: false, reason: 'cancelled' })
    const bad = await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, { ticket_token: 'abc' }, 'POST'), 'e1', 'confirm')
    expect(bad.status).toBe(409)
    expect((await bad.json()).error).toBe('Ticket cancelled.')
  })

  it('orders and attendees are projected through an allow-list (no tokens, answers or CRM ids)', async () => {
    reads.listEventRegistrationRows.mockResolvedValue([{
      id: 'o1', purchaser_name: 'Sam', purchaser_email: 's@x.test', purchaser_phone: '0400', status: 'CONFIRMED', payment_status: 'PAID',
      total_cents: 100, payment_total_cents: 100, currency: 'aud', crm_contact_id: 'crm-1', stripe_payment_intent_id: 'pi_1',
      ticket_type_name: 'G', session_name: 'S', quantity: 1,
      attendees: [{ id: 'a1', name: 'Al', email: null, checked_in_at: null, checked_in_by: null, ticket_token: 'SECRETTOKEN', responses: [{ answer: 'x' }] }],
    }])
    const orders = await (await org.handleOrganiserOrders(await authed(), 'e1')).text()
    const attendees = await (await org.handleOrganiserAttendees(await authed(), 'e1')).text()
    for (const text of [orders, attendees]) {
      expect(text).not.toMatch(/SECRETTOKEN|crm-1|pi_1|0400|responses/)
    }
    expect(JSON.parse(orders).orders[0].lines).toEqual([{ ticket_type_name: 'G', session_name: 'S', quantity: 1 }])
    expect(JSON.parse(attendees).attendees[0]).toMatchObject({ name: 'Al', order_id: 'o1' })
  })

  it('drops unknown filter parameters before they reach the reader', async () => {
    reads.listEventRegistrationRows.mockResolvedValue([])
    await org.handleOrganiserOrders(await authed('u-mgr', 'org-a', {}, undefined, 'GET', 'http://bb.test/x?q=al&organisationId=org-b&checkin=yes'), 'e1')
    const params = reads.listEventRegistrationRows.mock.calls[0][2] as URLSearchParams
    expect([...params.keys()].sort()).toEqual(['checkin', 'q'])
  })

  it('rejects non-identifier event ids before any query', async () => {
    expect((await org.handleOrganiserOrders(await authed(), "e1'; DROP TABLE x;--")).status).toBe(404)
    expect(reads.listEventRegistrationRows).not.toHaveBeenCalled()
  })
})

describe('public API', () => {
  const params = { organisationSlug: 'acme', eventSlug: 'gala' }
  const gated = (url = 'http://bb.test/x', init: RequestInit = {}) => new Request(url, { ...init, headers: { ...GATE, 'content-type': 'application/json', ...(init.headers as object) } })
  const VALID = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }], accept_terms: true }

  it('every public handler needs the gate and refuses browser-origin calls', async () => {
    const calls: ((r: Request) => Promise<Response>)[] = [
      r => pub.handleTicketingPublicEvent(r, params), r => pub.handleTicketingQuote(r, params), r => pub.handleTicketingRegister(r, params),
      r => pub.handleTicketingCheckout(r, params), r => pub.handleTicketingCheckoutStatus(r, params),
      r => pub.handleTicketingTicket(r, 'abcdefghijklmnop'), r => pub.handleTicketingBooking(r, 'abcdefghijklmnop'),
    ]
    for (const c of calls) {
      expect((await c(new Request('http://bb.test/x', { method: 'POST', body: '{}' }))).status).toBe(401)
      expect((await c(gated('http://bb.test/x', { method: 'POST', headers: { origin: 'https://evil.example' } }))).status).toBe(403)
    }
    expect(publicSvc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it('accepts a Node-style server fetch (which sets sec-fetch-mode) but refuses anything carrying Sec-Fetch-Site', async () => {
    publicSvc.getPublicEventDetail.mockResolvedValue({ ok: true, detail: { event: { name: 'Gala' } } })
    const serverFetch = gated('http://bb.test/x', { headers: { 'sec-fetch-mode': 'cors' } })
    expect((await pub.handleTicketingPublicEvent(serverFetch, params)).status).toBe(200)
    const browserFetch = gated('http://bb.test/x', { headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' } })
    expect((await pub.handleTicketingPublicEvent(browserFetch, params)).status).toBe(403)
  })

  it('paid checkout returns Eve URLs for success and cancel, and never reads the request host', async () => {
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1' } })
    let captured: { successUrl: string; cancelUrl: string } | null = null
    publicSvc.startPaidCheckout.mockImplementation(async (opts: { buildReturnUrls: () => Promise<{ successUrl: string; cancelUrl: string }> }) => {
      captured = await opts.buildReturnUrls()
      return { ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' }
    })
    const res = await pub.handleTicketingCheckout(gated('https://attacker.example/api/ticketing/x', { method: 'POST', body: JSON.stringify(VALID), headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' } }), params)
    expect(res.status).toBe(201)
    expect((await res.json()).checkout_url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    expect(captured).toEqual({
      successUrl: 'https://eve.example/e/acme/gala/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://eve.example/e/acme/gala?checkout=cancelled',
    })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses paid checkout before reserving anything when the product origin is not configured', async () => {
    const saved = process.env.EVE_PUBLIC_BASE_URL
    delete process.env.EVE_PUBLIC_BASE_URL
    try {
      const res = await pub.handleTicketingCheckout(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID) }), { organisationSlug: 'acme', eventSlug: 'nolink' })
      expect(res.status).toBe(503)
      expect(publicSvc.startPaidCheckout).not.toHaveBeenCalled()
    } finally { process.env.EVE_PUBLIC_BASE_URL = saved }
  })

  it('rate-limits paid checkout per buyer address and event using the shared limiter key', async () => {
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1' } })
    publicSvc.startPaidCheckout.mockResolvedValue({ ok: false, code: 'CAPACITY_UNAVAILABLE' })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await pub.handleTicketingCheckout(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'x-ticketing-client-ip': '198.51.100.7' } }), { organisationSlug: 'acme', eventSlug: 'ratelimited' })).status)
    }
    expect(statuses.slice(0, 10).every(s => s === 409)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('maps service results to the same status and message the public checkout route returns', async () => {
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1' } })
    publicSvc.startPaidCheckout.mockResolvedValue({ ok: false, code: 'ACCESS_CODE_REQUIRED' })
    const res = await pub.handleTicketingCheckout(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'x-ticketing-client-ip': '198.51.100.8' } }), { organisationSlug: 'acme', eventSlug: 'codes' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('An access code is required for this selection.')
  })

  it('ticket QR encodes the Eve ticket link; the wallet and ticket endpoints return only public-safe detail', async () => {
    publicSvc.getPublicTicketDetail.mockResolvedValue({ ok: true, detail: { attendee_name: 'Al', status: 'VALID', checked_in_at: null } })
    publicSvc.generateTicketQrSvg.mockResolvedValue('<svg/>')
    const res = await pub.handleTicketingTicket(gated('http://bb.test/x', { headers: { 'x-ticketing-client-ip': '198.51.100.9' } }), 'tkn_abcdefghijklmnop')
    expect(publicSvc.generateTicketQrSvg).toHaveBeenCalledWith('https://eve.example/t/tkn_abcdefghijklmnop')
    expect((await res.json()).qr_svg).toBe('<svg/>')
    publicSvc.getPublicBookingDetail.mockResolvedValue({ ok: false })
    expect((await pub.handleTicketingBooking(gated('http://bb.test/x', { headers: { 'x-ticketing-client-ip': '198.51.100.9' } }), 'bk_abcdefghijklmnop')).status).toBe(404)
  })

  it('the shared link builders produce Eve URLs from a product base and leave BrainBase behaviour to its own builders', () => {
    const base = productLinkBase('https://eve.example/', true)!
    expect(publicTicketUrl(base, 'tkn')).toBe('https://eve.example/t/tkn')
    expect(publicBookingWalletUrl(base, 'bk')).toBe('https://eve.example/b/bk/tickets')
    expect(checkoutSuccessUrl(base, 'a', 'b')).toBe('https://eve.example/e/a/b/checkout/success?session_id={CHECKOUT_SESSION_ID}')
    expect(checkoutCancelUrl(base, 'a', 'b')).toBe('https://eve.example/e/a/b?checkout=cancelled')
    expect(productLinkBase('http://eve.example', true)).toBeNull()
    expect(productLinkBase('https://user:pw@eve.example', true)).toBeNull()
    expect(productLinkBase('javascript:alert(1)', false)).toBeNull()
    expect(extractTicketToken('https://eve.example/t/abcdefghijklmnopqrstuvwx?x=1')).toBe('abcdefghijklmnopqrstuvwx')
    expect(extractTicketToken('<script>')).toBeNull()
  })
})

describe('surface boundary', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const code = (f: string) =>
    readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  function walk(dir: string, out: string[] = []) {
    for (const e of readdirSync(dir)) {
      const f = path.join(dir, e)
      if (statSync(f).isDirectory()) walk(f, out); else if (/route\.ts$/.test(e)) out.push(f)
    }
    return out
  }
  const routes = walk(path.join(ROOT, 'app/api/ticketing')).map(f => path.relative(ROOT, f).replace(/\\/g, '/')).sort()

  it('exposes exactly the approved routes — no refund, cancel, retry, resend, payment mutation or fee-policy surface', () => {
    expect(routes).toEqual([
      'app/api/ticketing/auth/login/route.ts',
      'app/api/ticketing/auth/logout/route.ts',
      'app/api/ticketing/auth/organisation/route.ts',
      'app/api/ticketing/auth/session/route.ts',
      'app/api/ticketing/organiser/events/[id]/attendees/route.ts',
      'app/api/ticketing/organiser/events/[id]/check-in/confirm/route.ts',
      'app/api/ticketing/organiser/events/[id]/check-in/resolve/route.ts',
      'app/api/ticketing/organiser/events/[id]/check-in/search/route.ts',
      'app/api/ticketing/organiser/events/[id]/check-in/undo/route.ts',
      'app/api/ticketing/organiser/events/[id]/orders/route.ts',
      'app/api/ticketing/organiser/events/[id]/route.ts',
      'app/api/ticketing/organiser/events/route.ts',
      'app/api/ticketing/organiser/payments/[orderId]/route.ts',
      'app/api/ticketing/organiser/payments/route.ts',
      'app/api/ticketing/organiser/settings/route.ts',
      'app/api/ticketing/organiser/summary/route.ts',
      'app/api/ticketing/public/bookings/[bookingToken]/route.ts',
      'app/api/ticketing/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts',
      'app/api/ticketing/public/events/[organisationSlug]/[eventSlug]/checkout/status/route.ts',
      'app/api/ticketing/public/events/[organisationSlug]/[eventSlug]/quote/route.ts',
      'app/api/ticketing/public/events/[organisationSlug]/[eventSlug]/register/route.ts',
      'app/api/ticketing/public/events/[organisationSlug]/[eventSlug]/route.ts',
      'app/api/ticketing/public/tickets/[token]/route.ts',
    ])
  })

  it('the payments and settings routes are READ-ONLY: GET is their only exported method', () => {
    for (const f of routes.filter(r => /\/organiser\/(payments|settings)\//.test(r))) {
      const exported = [...code(f).matchAll(/export (?:async function|const|function) (\w+)/g)].map(m => m[1])
      expect(exported, f).toEqual(['GET'])
    }
  })

  it('no ticketing route or handler module emits CORS headers or an OPTIONS handler, and none sets a cookie', () => {
    const files = [...routes, 'lib/ticketing/http.ts', 'lib/ticketing/publicApi.ts', 'lib/ticketing/organiserApi.ts', 'lib/ticketing/gate.ts', 'lib/ticketing/login.ts']
    for (const f of files) {
      const src = code(f)
      expect(src, f).not.toMatch(/Access-Control|export (async )?function OPTIONS|export const OPTIONS|Set-Cookie|cookies\(\)/i)
    }
  })

  it('the organiser API never imports a BrainBase route handler or the cookie-session authoriser', () => {
    const src = code('lib/ticketing/organiserApi.ts')
    expect(src).not.toMatch(/@\/app\/api\/|authorizeEventsRequest|requireSession|@\/lib\/org['"]|delegated/i)
    const pub = code('lib/ticketing/publicApi.ts')
    expect(pub).not.toMatch(/authorizeEventsRequest|requireSession|@\/lib\/org['"]/)
  })

  it('authorizeEventsRequest accepts no alternate principal', () => {
    const src = code('lib/events/authorize.ts')
    expect(src).toMatch(/session = await requireSession\(\)/)
    expect(src).not.toMatch(/delegated|ticketing|AsyncLocalStorage/i)
  })
})

const { limiterKeyHash, LIMITS } = await import('@/lib/ticketing/rateLimit')

describe('distributed rate limiting wiring (Phase 3.5)', () => {
  const gated = (url = 'http://bb.test/x', init: RequestInit = {}) => new Request(url, { ...init, headers: { ...GATE, 'content-type': 'application/json', ...(init.headers as object) } })
  const VALID = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }], accept_terms: true }
  const params = { organisationSlug: 'acme', eventSlug: 'gala' }
  const IP = '198.51.100.20'
  const exhaust = (policy: { cls: string; max: number }, dims: string[]) => db.counters.set(limiterKeyHash(policy.cls, dims), policy.max)

  it('paid checkout: the 11th request from one address is a 429 and the service (reservation, Stripe) is NOT called a 11th time', async () => {
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1' } })
    publicSvc.startPaidCheckout.mockResolvedValue({ ok: false, code: 'CAPACITY_UNAVAILABLE' })
    const run = () => pub.handleTicketingCheckout(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'x-ticketing-client-ip': IP } }), params)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await run()).status)
    expect(statuses.slice(0, 10).every(x => x === 409)).toBe(true)
    expect(statuses[10]).toBe(429)
    expect(publicSvc.startPaidCheckout).toHaveBeenCalledTimes(10)
    expect(publicSvc.resolvePublicEvent).toHaveBeenCalledTimes(10)
  })

  it('free registration and quote: an exhausted budget is refused BEFORE the event is resolved or anything is created/computed', async () => {
    exhaust(LIMITS.freeRegistration, ['acme', 'gala', IP])
    const reg = await pub.handleTicketingRegister(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'x-ticketing-client-ip': IP } }), params)
    expect(reg.status).toBe(429)
    exhaust(LIMITS.publicQuote, ['acme', 'gala', IP])
    const quote = await pub.handleTicketingQuote(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'x-ticketing-client-ip': IP } }), params)
    expect(quote.status).toBe(429)
    exhaust(LIMITS.ticketLookup, [IP])
    expect((await pub.handleTicketingTicket(gated('http://bb.test/x', { headers: { 'x-ticketing-client-ip': IP } }), 'abcdefghijklmnop')).status).toBe(429)
    expect((await pub.handleTicketingBooking(gated('http://bb.test/x', { headers: { 'x-ticketing-client-ip': IP } }), 'abcdefghijklmnop')).status).toBe(429)
    expect(publicSvc.resolvePublicEvent).not.toHaveBeenCalled()
    expect(publicSvc.getPublicTicketDetail).not.toHaveBeenCalled()
    expect(publicSvc.getPublicBookingDetail).not.toHaveBeenCalled()
  })

  it('another address or another event keeps its own budget', async () => {
    exhaust(LIMITS.paidCheckout, ['acme', 'gala', IP])
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1' } })
    publicSvc.startPaidCheckout.mockResolvedValue({ ok: false, code: 'CAPACITY_UNAVAILABLE' })
    const go = (ip: string, eventSlug = 'gala') => pub.handleTicketingCheckout(gated('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'x-ticketing-client-ip': ip } }), { organisationSlug: 'acme', eventSlug })
    expect((await go(IP)).status).toBe(429)
    expect((await go('198.51.100.21')).status).toBe(409)
    expect((await go(IP, 'other-event')).status).toBe(409)
  })

  it('organiser reads: limited per VERIFIED user and organisation, refused before the handler reads anything; other users are unaffected', async () => {
    exhaust(LIMITS.organiserRead, ['org-a', 'u-mgr'])
    const res = await org.handleOrganiserEvents(await authed('u-mgr', 'org-a'))
    expect(res.status).toBe(429)
    expect(reads.listOrganisationEvents).not.toHaveBeenCalled()
    expect((await org.handleOrganiserEvents(await authed('u-view', 'org-a'))).status).toBe(200)
    expect((await org.handleOrganiserEvents(await authed('u-b', 'org-b'))).status).toBe(200)
  })

  it('check-in: lookups and confirm/undo have separate per-user-per-event budgets; a limited scan changes nothing', async () => {
    exhaust(LIMITS.checkInMutation, ['org-a', 'u-mgr', 'e1'])
    const confirm = await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, { ticket_token: 'abc' }, 'POST'), 'e1', 'confirm')
    expect(confirm.status).toBe(429)
    expect(ops.confirmCheckInWithAudit).not.toHaveBeenCalled()
    // The lookup budget for the same event is untouched; another event is untouched.
    ops.eventBelongsToOrganisation.mockResolvedValue(true)
    checkIn.resolveAttendee.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect((await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, { ticket_token: 'abc' }, 'POST'), 'e1', 'resolve')).status).toBe(404)
    ops.confirmCheckInWithAudit.mockResolvedValue({ ok: true, first: true, attendee: {} })
    expect((await org.handleOrganiserCheckIn(await authed('u-mgr', 'org-a', {}, { ticket_token: 'abc' }, 'POST'), 'e2', 'confirm')).status).toBe(200)
    exhaust(LIMITS.checkInLookup, ['org-a', 'u-view', 'e1'])
    expect((await org.handleOrganiserCheckInSearch(await authed('u-view', 'org-a'), 'e1')).status).toBe(429)
    expect(checkIn.searchAttendees).not.toHaveBeenCalled()
  })

  it('limiter outage: public and organiser classes degrade to the in-memory limiter and keep serving; the unauthenticated denial is unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    db.limiterDown = true
    publicSvc.getPublicTicketDetail.mockResolvedValue({ ok: false })
    expect((await pub.handleTicketingTicket(gated('http://bb.test/x', { headers: { 'x-ticketing-client-ip': '198.51.100.55' } }), 'abcdefghijklmnop')).status).toBe(404)
    expect((await org.handleOrganiserEvents(await authed('u-view', 'org-a'))).status).toBe(200)
    expect((await org.handleOrganiserEvents(new Request('http://bb.test/x', { headers: GATE }))).status).toBe(401)
    expect(warn.mock.calls.map(c => String(c[0])).join('')).toContain('ticketing_rate_limit_degraded')
    warn.mockRestore()
  })

  it('a future organiser MUTATION class fails closed (policy), and every class is bounded and named', () => {
    expect(LIMITS.organiserMutation.outage).toBe('closed')
    expect(LIMITS.loginIp.outage).toBe('closed')
    expect(LIMITS.loginUser.outage).toBe('closed')
    for (const [name, p] of Object.entries(LIMITS)) {
      expect(p.max, name).toBeGreaterThan(0)
      expect(p.windowSeconds, name).toBeGreaterThan(0)
      expect(p.cls, name).toMatch(/^eve-[a-z-]+$/)
    }
    expect(new Set(Object.values(LIMITS).map(p => p.cls)).size).toBe(Object.keys(LIMITS).length)
  })

  it('limiter callers pass no raw secret or token: dimensions come from the verified context, the trusted IP path or URL slugs', () => {
    const root = path.resolve(__dirname, '../..')
    const strip = (f: string) => readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const login = strip('lib/ticketing/login.ts')
    expect(login).toMatch(/limit\(LIMITS\.loginIp, \[clientIp\]\)/)
    expect(login).toMatch(/limit\(LIMITS\.loginUser, \[username\]\)/)
    expect(login).not.toMatch(/checkRateLimit|resetRateLimit/)
    for (const f of ['lib/ticketing/publicApi.ts', 'lib/ticketing/organiserApi.ts', 'lib/ticketing/login.ts']) {
      const src = strip(f)
      expect(src, f).not.toMatch(/limit\([^)]*(password|secret|token|authorization|cookie)/i)
    }
    expect(strip('lib/ticketing/organiserApi.ts')).toMatch(/\[ctx\.organisationId, ctx\.userId/)
  })
})

describe('paid checkout acceptance is enforced server-side (launch compliance)', () => {
  const gated = (body: unknown) => new Request('http://bb.test/x', { method: 'POST', headers: { ...GATE, 'content-type': 'application/json', 'x-ticketing-client-ip': '198.51.100.90' }, body: JSON.stringify(body) })
  const BASE = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }] }
  const params = () => ({ organisationSlug: 'acme', eventSlug: 'accept-' + Math.random().toString(36).slice(2, 8) })

  it.each([
    ['missing', BASE],
    ['false', { ...BASE, accept_terms: false }],
    ['string "true"', { ...BASE, accept_terms: 'true' }],
    ['1', { ...BASE, accept_terms: 1 }],
    ['null', { ...BASE, accept_terms: null }],
    ['nested', { ...BASE, terms: { accept_terms: true } }],
  ])('%s acceptance is refused with a 400 before the event is resolved or anything is reserved', async (_l, body) => {
    const res = await pub.handleTicketingCheckout(gated(body), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'TERMS_NOT_ACCEPTED' })
    expect(publicSvc.resolvePublicEvent).not.toHaveBeenCalled()
    expect(publicSvc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it('accept_terms: true proceeds to the normal checkout path, and the field never reaches the service input', async () => {
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1' } })
    publicSvc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    const res = await pub.handleTicketingCheckout(gated({ ...BASE, accept_terms: true }), params())
    expect(res.status).toBe(201)
    expect(publicSvc.startPaidCheckout).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(publicSvc.startPaidCheckout.mock.calls[0][0].validated)).not.toMatch(/accept|terms/i)
  })

  it('free registration does not require acceptance (linked notice only)', async () => {
    publicSvc.resolvePublicEvent.mockResolvedValue({ ok: false })
    const res = await pub.handleTicketingRegister(gated(BASE), params())
    expect(res.status).not.toBe(400)
  })

  it('a refused acceptance does not touch Stripe configuration or the database', async () => {
    await pub.handleTicketingCheckout(gated(BASE), params())
    expect(publicSvc.startPaidCheckout).not.toHaveBeenCalled()
  })
})
