import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Eve organiser allow-list: an organisation's published events are offered on
// Eve ONLY when settings.events.eveEnabled === true. Events entitlement plus a
// PUBLISHED event (the LD Tennis / Cardijn case) is not enough. Enforced in
// the server-side gateway (lib/ticketing/publicApi.ts) for event read, quote,
// register and paid checkout; NOT for an existing buyer's checkout status,
// ticket (/t) or booking (/b). BrainBase's own public pages are unchanged.
//
// The gateway tests run the REAL resolver and event reader over a mocked
// database, so the decision is made from the organisation row exactly as in
// Production. The services below the resolver (registration, paid checkout,
// Stripe, the BrainBase quote/status handlers) are spies: a refused request
// must never reach them.

process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

let orgSettings: unknown = {}
let eventStatus = 'PUBLISHED'
const ORG_ROW = () => ({ id: 'org-ld', name: 'LD Tennis Internal Pty Ltd', settings: orgSettings })
const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = strings.join('?')
  if (q.includes('INSERT INTO ticketing_rate_limits')) return [{ count: 1, key: values[0] }]
  if (q.includes('FROM organisations WHERE slug')) return [ORG_ROW()]
  if (/FROM events\b/.test(q) && q.includes("status = 'PUBLISHED'")) {
    if (eventStatus !== 'PUBLISHED') return []
    return [{ id: 'ev-grad', organisation_id: 'org-ld', name: 'Year 12 Graduation', slug: 'grad', description: null, venue: 'Hall', artwork_url: null, starts_at: '2030-11-18T09:00:00Z', ends_at: '2030-11-18T13:00:00Z', timezone: 'Australia/Adelaide', eve_questions_enabled: false }]
  }
  if (q.includes('WHERE ea.ticket_token')) {
    return [{ attendee_name: 'Al', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', event_status: 'PUBLISHED', event_name: 'Year 12 Graduation', venue: 'Hall', artwork_url: null, starts_at: '2030-11-18T09:00:00Z', ends_at: '2030-11-18T13:00:00Z', timezone: 'Australia/Adelaide', ticket_type_name: 'GA', session_name: null, session_starts_at: null, session_ends_at: null, organisation_name: 'LD Tennis Internal Pty Ltd', organisation_settings: orgSettings }]
  }
  if (q.includes('WHERE eo.booking_token')) {
    return [{ id: 'ord-1', organisation_id: 'org-ld', purchaser_name: 'Sam', order_status: 'CANCELLED', payment_status: 'REFUNDED', event_status: 'PUBLISHED', event_name: 'Year 12 Graduation', venue: 'Hall', artwork_url: null, starts_at: '2030-11-18T09:00:00Z', ends_at: '2030-11-18T13:00:00Z', timezone: 'Australia/Adelaide', organisation_name: 'LD Tennis Internal Pty Ltd', organisation_settings: orgSettings }]
  }
  return []
})
const svc = { registerFreeOrder: vi.fn(), startPaidCheckout: vi.fn(), stripe: vi.fn(), quote: vi.fn(), status: vi.fn() }

vi.mock('@/lib/db', () => ({ default: (...a: Parameters<typeof db>) => db(...a) }))
vi.mock('@/lib/capabilities/requireCapability', async orig => ({ ...(await orig<object>()), checkCapability: async () => ({ allowed: true }) }))
vi.mock('@/lib/events/qr', async orig => ({ ...(await orig<object>()), generateTicketQrSvg: async () => '<svg/>' }))
vi.mock('@/lib/events/services/freeRegistration', () => ({ registerFreeOrder: (...a: unknown[]) => svc.registerFreeOrder(...a) }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: (...a: unknown[]) => svc.startPaidCheckout(...a) }))
vi.mock('@/lib/events/stripe', async orig => ({ ...(await orig<object>()), createCheckoutSession: (...a: unknown[]) => svc.stripe(...a) }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(async () => undefined), recordEventBookingActivity: vi.fn(async () => undefined) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: (...a: unknown[]) => svc.quote(...a) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: (...a: unknown[]) => svc.status(...a) }))

const pub = await import('@/lib/ticketing/publicApi')
const { isEveEnabledSetting } = await import('@/lib/organisations/eveEnablement')
const { getPublicEventDetail } = await import('@/lib/events/publicEventDetail')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const BODY = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }], accept_terms: true }
const get = () => new Request('http://bb.test/x', { headers: { ...GATE, 'x-ticketing-client-ip': '198.51.100.30' } })
const post = (body: unknown = BODY) =>
  new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(body), headers: { ...GATE, 'content-type': 'application/json', 'x-ticketing-client-ip': '198.51.100.30' } })
const P = { organisationSlug: 'ld-tennis', eventSlug: 'grad' }
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const ENABLED = { events: { eveEnabled: true } }
const UNAVAILABLE = { error: 'Event not available.' }

beforeEach(() => {
  orgSettings = {}
  eventStatus = 'PUBLISHED'
  db.mockClear()
  for (const f of Object.values(svc)) f.mockReset()
  svc.registerFreeOrder.mockResolvedValue({ ok: true, orderId: 'o1', quantity: 1, tickets: [{ attendee_name: 'Sam', ticket_token: 'tok' }], bookingToken: 'bk' })
  svc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  svc.quote.mockResolvedValue(Response.json({ total_cents: 0 }))
  svc.status.mockResolvedValue(Response.json({ status: 'PAID' }))
})
afterEach(() => { vi.unstubAllEnvs() })

describe('setting: settings.events.eveEnabled, default-deny', () => {
  it.each([
    ['missing settings', undefined, false],
    ['null settings', null, false],
    ['empty settings', {}, false],
    ['branding only', { branding: { name: 'Acme' } }, false],
    ['events namespace without the key', { events: {} }, false],
    ['explicit false', { events: { eveEnabled: false } }, false],
    ['string "true"', { events: { eveEnabled: 'true' } }, false],
    ['number 1', { events: { eveEnabled: 1 } }, false],
    ['top-level eveEnabled (wrong namespace)', { eveEnabled: true }, false],
    ['events is not an object', { events: 'eveEnabled' }, false],
    ['explicit true', { events: { eveEnabled: true } }, true],
  ])('%s -> %s', (_l, raw, expected) => {
    expect(isEveEnabledSetting(raw)).toBe(expected)
  })
})

describe('Events-enabled organisation with a PUBLISHED event (LD Tennis / Cardijn case) is NOT automatically on Eve', () => {
  it('Events entitlement + published event, no Eve setting: the Eve event read is 404, identical to a missing event', async () => {
    const off = await pub.handleTicketingPublicEvent(get(), P)
    expect(off.status).toBe(404)
    expect(await off.json()).toEqual(UNAVAILABLE)

    eventStatus = 'DRAFT'
    orgSettings = ENABLED
    const missing = await pub.handleTicketingPublicEvent(get(), P)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual(UNAVAILABLE)
  })

  it('the same organisation once enabled: the event is served as before', async () => {
    orgSettings = ENABLED
    const res = await pub.handleTicketingPublicEvent(get(), P)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.event.name).toBe('Year 12 Graduation')
    expect(body.paid_checkout_available).toBe(false)
  })

  it('explicitly disabled (false) behaves exactly like never set', async () => {
    orgSettings = { events: { eveEnabled: false } }
    expect((await pub.handleTicketingPublicEvent(get(), P)).status).toBe(404)
  })
})

describe('disabled organisation: every buyer-facing event action is refused server-side', () => {
  it('quote: 404 before the BrainBase quote handler is reached', async () => {
    const res = await pub.handleTicketingQuote(post({ items: [] }), P)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(UNAVAILABLE)
    expect(svc.quote).not.toHaveBeenCalled()
  })

  it('register: 404, no order created', async () => {
    const res = await pub.handleTicketingRegister(post(), P)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(UNAVAILABLE)
    expect(svc.registerFreeOrder).not.toHaveBeenCalled()
  })

  it('paid checkout with the kill switch ON and the org allow-listed: still 404, refused before any reservation or Stripe call', async () => {
    vi.stubEnv('EVE_PAID_CHECKOUT_ENABLED', 'true')
    vi.stubEnv('EVE_PAID_CHECKOUT_ORGS', 'ld-tennis')
    const res = await pub.handleTicketingCheckout(post(), P)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(UNAVAILABLE)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    expect(svc.stripe).not.toHaveBeenCalled()
  })

  it('paid checkout with the kill switch OFF: unchanged 503 (the kill switch still answers first)', async () => {
    const res = await pub.handleTicketingCheckout(post(), P)
    expect(res.status).toBe(503)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
  })
})

describe('enabled organisation: current Eve behaviour unchanged', () => {
  beforeEach(() => { orgSettings = ENABLED })

  it('quote delegates to the BrainBase quote handler', async () => {
    const res = await pub.handleTicketingQuote(post({ items: [] }), P)
    expect(res.status).toBe(200)
    expect(svc.quote).toHaveBeenCalledTimes(1)
  })

  it('register reaches the free-registration service with productSurface EVE', async () => {
    const res = await pub.handleTicketingRegister(post(), P)
    expect(res.status).toBeLessThan(300)
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    expect(svc.registerFreeOrder.mock.calls[0][0]).toMatchObject({ organisationId: 'org-ld', productSurface: 'EVE' })
  })

  it('paid checkout (flag on, allow-listed) reaches startPaidCheckout', async () => {
    vi.stubEnv('EVE_PAID_CHECKOUT_ENABLED', 'true')
    vi.stubEnv('EVE_PAID_CHECKOUT_ORGS', 'ld-tennis')
    const res = await pub.handleTicketingCheckout(post(), P)
    expect(res.status).toBeLessThan(300)
    expect(svc.startPaidCheckout).toHaveBeenCalledTimes(1)
  })
})

describe('historical buyer artefacts stay usable for a NOT-enabled organisation', () => {
  it('/t ticket: 200 with the ticket', async () => {
    const res = await pub.handleTicketingTicket(get(), 'tkn_abcdefghijklmnop')
    expect(res.status).toBe(200)
    expect((await res.json()).attendee_name).toBe('Al')
  })

  it('/b booking (a refunded/cancelled historical order): 200 with the booking', async () => {
    const res = await pub.handleTicketingBooking(get(), 'bk_abcdefghijklmnop')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order_status ?? body.status ?? body).toBeTruthy()
  })

  it('checkout status for an existing session still delegates (a buyer returning from Stripe is never stranded)', async () => {
    const req = new Request('http://bb.test/x?session_id=cs_test_abc', { headers: { ...GATE, 'x-ticketing-client-ip': '198.51.100.30' } })
    const res = await pub.handleTicketingCheckoutStatus(req, P)
    expect(res.status).toBe(200)
    expect(svc.status).toHaveBeenCalledTimes(1)
  })

  it('source: the ticket, booking and checkout-status handlers do not consult the allow-list', () => {
    const src = read('lib/ticketing/publicApi.ts')
    for (const fn of ['handleTicketingTicket', 'handleTicketingBooking', 'handleTicketingCheckoutStatus']) {
      const start = src.indexOf(`export async function ${fn}`)
      const body = src.slice(start, src.indexOf('\n}\n', start))
      expect(body, fn).not.toMatch(/resolveEveEvent|eveEnabled/)
    }
  })
})

describe('BrainBase public pages and routes are unchanged for a NOT-enabled organisation', () => {
  it('the shared event reader still returns the event (BrainBase /e and /api/public use it)', async () => {
    const result = await getPublicEventDetail('ld-tennis', 'grad')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.eveEnabled).toBe(false)
  })

  it('the BrainBase public event route serves 200 and its body carries no Eve flag', async () => {
    const route = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/route')
    const res = await route.GET(new Request('http://bb.test/api/public/events/ld-tennis/grad', { headers: { 'x-forwarded-for': '198.51.100.31' } }) as never, { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const raw = await res.text()
    expect(raw).not.toMatch(/eveEnabled|eve_enabled/)
  })

  it('BrainBase routes and pages never read the Eve setting', () => {
    for (const rel of [
      'app/api/public/events/[organisationSlug]/[eventSlug]/route.ts',
      'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts',
      'app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts',
      'app/api/public/events/[organisationSlug]/[eventSlug]/quote/route.ts',
      'app/e/[organisationSlug]/[eventSlug]/page.tsx',
    ]) {
      expect(read(rel), rel).not.toMatch(/eveEnabled|eveEnablement/)
    }
  })
})

describe('no internal data leakage', () => {
  it('an enabled Eve event response carries neither the flag nor the internal organisation name', async () => {
    orgSettings = { ...ENABLED, branding: { email: 'private@ld.example' } }
    const raw = await (await pub.handleTicketingPublicEvent(get(), P)).text()
    for (const s of ['eveEnabled', 'eve_enabled', 'LD Tennis Internal Pty Ltd', 'private@ld.example', 'org-ld']) expect(raw, s).not.toContain(s)
  })

  it('a refused response is the bare unavailable body, nothing about why', async () => {
    const raw = await (await pub.handleTicketingPublicEvent(get(), P)).text()
    expect(raw).toBe(JSON.stringify(UNAVAILABLE))
  })
})

describe('only the admin settings route can turn Eve on', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
  it('setOrganisationEveEnabled is called from exactly one place: app/api/organisations/eve/route.ts', () => {
    const callers = ['app', 'lib', 'components', 'packages', 'scripts']
      .filter(d => fs.existsSync(path.join(process.cwd(), d)))
      .flatMap(d => walk(path.join(process.cwd(), d)))
      .map(f => path.relative(process.cwd(), f).replace(/\\/g, '/'))
      .filter(f => f !== 'lib/organisations/eveEnablement.ts' && read(f).includes('setOrganisationEveEnabled'))
    expect(callers).toEqual(['app/api/organisations/eve/route.ts'])
  })

  it('event publication never touches settings.events', () => {
    for (const rel of ['lib/events/auditLog.ts', 'app/api/events/[id]/route.ts']) {
      if (!fs.existsSync(path.join(process.cwd(), rel))) continue
      expect(read(rel), rel).not.toMatch(/settings\s*->\s*'events'|'\{events/)
    }
  })

  it('the write merges into settings.events (siblings kept) and only ever stores a boolean', () => {
    const src = read('lib/organisations/eveEnablement.ts')
    expect(src).toContain("'{events}'")
    expect(src).toContain("jsonb_build_object('eveEnabled', ${enabled}::boolean)")
    expect(src).toMatch(/jsonb_typeof\(organisations\.settings -> 'events'\) = 'object'/)
  })
})
