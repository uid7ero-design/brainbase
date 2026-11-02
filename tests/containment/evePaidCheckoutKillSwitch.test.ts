import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Eve launch compliance — explicit, fail-closed kill switch for Eve PAID
// checkout (EVE_PAID_CHECKOUT_ENABLED, ADR 0013). Handler-level proofs with every
// service below the handler mocked, plus source containment for scope.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'
delete process.env.EVE_PAID_CHECKOUT_ENABLED
delete process.env.EVE_PAID_CHECKOUT_ORGS

const svc = { resolvePublicEvent: vi.fn(), startPaidCheckout: vi.fn(), registerFreeOrder: vi.fn(), db: vi.fn(), stripeLike: vi.fn() }

vi.mock('@/lib/db', () => ({ default: async (...a: unknown[]) => { svc.db(...a); return [] } }))
vi.mock('@/lib/events/publicResolve', () => ({ resolvePublicEvent: (...a: unknown[]) => svc.resolvePublicEvent(...a) }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: (...a: unknown[]) => svc.startPaidCheckout(...a) }))
vi.mock('@/lib/events/services/freeRegistration', () => ({ registerFreeOrder: (...a: unknown[]) => svc.registerFreeOrder(...a) }))
vi.mock('@/lib/events/stripe', () => ({ createCheckoutSession: (...a: unknown[]) => svc.stripeLike(...a) }))
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: vi.fn() }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: vi.fn() }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: vi.fn() }))
vi.mock('@/lib/events/qr', () => ({ generateTicketQrSvg: vi.fn() }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(async () => undefined), recordEventBookingActivity: vi.fn(async () => undefined) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: vi.fn() }))

const pub = await import('@/lib/ticketing/publicApi')
const { isEvePaidCheckoutEnabled, isEvePaidCheckoutAllowedForOrg, evePaidCheckoutOrgAllowList } = await import('@/lib/ticketing/paidCheckoutFlag')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const BODY = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }], accept_terms: true }
const gated = (body: unknown = BODY) =>
  new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(body), headers: { ...GATE, 'content-type': 'application/json' } })
let n = 0
const params = () => ({ organisationSlug: 'ld-tennis', eventSlug: `grad-${++n}` })
const brainbase = () => ({ organisationSlug: 'brainbase', eventSlug: `proof-${++n}` })
const schoolTest = () => ({ organisationSlug: 'school-test-organisation', eventSlug: `community-${++n}` })

beforeEach(() => {
  for (const f of Object.values(svc)) f.mockReset()
  svc.resolvePublicEvent.mockResolvedValue({ ok: true, eveEnabled: true, organisationId: 'org-connected', event: { id: 'e1' } })
  svc.registerFreeOrder.mockResolvedValue({ ok: true, orderId: 'o1', quantity: 1, tickets: [{ attendee_name: 'Sam', ticket_token: 'tok' }], bookingToken: 'bk' })
  svc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  delete process.env.EVE_PAID_CHECKOUT_ENABLED
  delete process.env.EVE_PAID_CHECKOUT_ORGS
})
afterEach(() => { vi.unstubAllEnvs(); delete process.env.EVE_PAID_CHECKOUT_ENABLED; delete process.env.EVE_PAID_CHECKOUT_ORGS })

describe('flag parsing: exactly "true", nothing else', () => {
  it.each([
    [undefined, false], ['', false], ['false', false], ['0', false], ['1', false], ['yes', false], ['on', false],
    ['TRUE', false], ['True', false], [' true', false], ['true ', false], ['true\n', false], ['"true"', false], ['truee', false],
    ['true', true],
  ])('%j -> %s', (value, expected) => {
    expect(isEvePaidCheckoutEnabled({ EVE_PAID_CHECKOUT_ENABLED: value })).toBe(expected)
  })
  it('reads process.env by default', () => {
    expect(isEvePaidCheckoutEnabled()).toBe(false)
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    expect(isEvePaidCheckoutEnabled()).toBe(true)
  })
})

describe('Eve paid checkout is blocked before anything happens unless the flag is exactly "true"', () => {
  it.each([
    ['unset', undefined], ['empty', ''], ['false', 'false'], ['0', '0'], ['1', '1'], ['yes', 'yes'], ['TRUE', 'TRUE'], ['padded', ' true '],
  ])('%s -> 503, no database touch (so no limiter, order or reservation), no event lookup, no checkout service, no Stripe', async (_l, value) => {
    if (value !== undefined) process.env.EVE_PAID_CHECKOUT_ENABLED = value
    const res = await pub.handleTicketingCheckout(gated(), params())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ error: 'Paid checkout is not currently available.' })
    expect(JSON.stringify(body)).not.toMatch(/stripe|account|connect|flag|EVE_PAID/i)
    expect(svc.db).not.toHaveBeenCalled()
    expect(svc.resolvePublicEvent).not.toHaveBeenCalled()
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    expect(svc.stripeLike).not.toHaveBeenCalled()
  })

  it('a connected-Stripe organisation (LD Tennis shape) cannot start Eve paid checkout while the flag is unset', async () => {
    svc.resolvePublicEvent.mockResolvedValue({ ok: true, eveEnabled: true, organisationId: 'org-connected', event: { id: 'e1', stripe_account_id: 'acct_connected', payments_enabled: true } })
    const res = await pub.handleTicketingCheckout(gated(), params())
    expect(res.status).toBe(503)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it('the gate runs even for a request that would otherwise be refused for terms (it is first after the S2S gate)', async () => {
    const res = await pub.handleTicketingCheckout(gated({ ...BODY, accept_terms: false }), params())
    expect(res.status).toBe(503)
  })

  it('the S2S gate still comes first: no key -> 401, browser origin -> 403', async () => {
    const noKey = new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(BODY), headers: { 'content-type': 'application/json' } })
    expect((await pub.handleTicketingCheckout(noKey, params())).status).toBe(401)
    const browser = new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(BODY), headers: { ...GATE, origin: 'https://evil.example', 'content-type': 'application/json' } })
    expect((await pub.handleTicketingCheckout(browser, params())).status).toBe(403)
  })

  it('exactly "true" (with the organisation allow-listed) passes this gate and reaches the checkout service (Preview: legal draft guard is Production-only)', async () => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await pub.handleTicketingCheckout(gated(), brainbase())
    expect(res.status).toBe(201)
    expect(svc.startPaidCheckout).toHaveBeenCalledTimes(1)
    expect(svc.startPaidCheckout.mock.calls[0][0].productSurface).toBe('EVE')
  })
})

describe('free Eve registration is unaffected by the flag and the allow-list', () => {
  it.each([undefined, 'false', 'true'])('flag=%s -> free registration still succeeds', async value => {
    if (value !== undefined) process.env.EVE_PAID_CHECKOUT_ENABLED = value
    const res = await pub.handleTicketingRegister(gated(), params())
    expect(res.status).toBe(201)
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'brainbase', '*'])('flag=true, allow-list=%j -> a non-listed organisation\'s free registration still succeeds', async orgs => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    if (orgs !== undefined) process.env.EVE_PAID_CHECKOUT_ORGS = orgs
    const res = await pub.handleTicketingRegister(gated(), params())
    expect(res.status).toBe(201)
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
  })
})

describe('organisation allow-list parsing (EVE_PAID_CHECKOUT_ORGS): fails closed, no wildcard', () => {
  it.each([
    [undefined, []], ['', []], [',', []], ['brainbase,', []], [',brainbase', []], ['brainbase,,ld-tennis', []],
    [' brainbase', []], ['brainbase ', []], ['brainbase, ld-tennis', []], ['Brainbase', []], ['BRAINBASE', []],
    ['*', []], ['all', ['all']], ['brainbase;ld-tennis', []], ['brain base', []], ['-brainbase', []], ['brainbase-', []],
    ['"brainbase"', []], ['brainbase,*', []],
    ['brainbase', ['brainbase']], ['brainbase,other-org', ['brainbase', 'other-org']],
  ])('%j -> %j', (value, expected) => {
    expect(evePaidCheckoutOrgAllowList({ EVE_PAID_CHECKOUT_ORGS: value })).toEqual(expected)
  })

  it('one malformed entry denies every organisation, including well-formed ones next to it', () => {
    const env = { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: 'brainbase,*' }
    expect(isEvePaidCheckoutAllowedForOrg('brainbase', env)).toBe(false)
    expect(isEvePaidCheckoutAllowedForOrg('ld-tennis', env)).toBe(false)
  })

  it('needs BOTH the global flag and the allow-list', () => {
    expect(isEvePaidCheckoutAllowedForOrg('brainbase', { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: 'brainbase' })).toBe(true)
    expect(isEvePaidCheckoutAllowedForOrg('brainbase', { EVE_PAID_CHECKOUT_ORGS: 'brainbase' })).toBe(false)
    expect(isEvePaidCheckoutAllowedForOrg('brainbase', { EVE_PAID_CHECKOUT_ENABLED: 'false', EVE_PAID_CHECKOUT_ORGS: 'brainbase' })).toBe(false)
    expect(isEvePaidCheckoutAllowedForOrg('brainbase', { EVE_PAID_CHECKOUT_ENABLED: 'true' })).toBe(false)
    expect(isEvePaidCheckoutAllowedForOrg('brainbase', { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: '' })).toBe(false)
  })

  it('matches the organisation slug exactly (no prefix, suffix or case match)', () => {
    const env = { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: 'brainbase' }
    for (const slug of ['brainbase-2', 'brain', 'Brainbase', 'xbrainbase', '', 'ld-tennis', 'school-test-organisation']) {
      expect(isEvePaidCheckoutAllowedForOrg(slug, env), slug).toBe(false)
    }
  })

  it('reads process.env by default', () => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    expect(isEvePaidCheckoutAllowedForOrg('brainbase')).toBe(false)
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    expect(isEvePaidCheckoutAllowedForOrg('brainbase')).toBe(true)
  })
})

describe('global flag ON: only allow-listed organisations reach Eve paid checkout', () => {
  const expectDenied = async (res: Response) => {
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ error: 'Paid checkout is not currently available.' })
    expect(JSON.stringify(body)).not.toMatch(/stripe|account|connect|flag|allow|EVE_PAID/i)
    expect(svc.db).not.toHaveBeenCalled()
    expect(svc.resolvePublicEvent).not.toHaveBeenCalled()
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    expect(svc.stripeLike).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    vi.stubEnv('VERCEL_ENV', 'preview')
    // LD Tennis shape: a connected, charges-enabled organisation — denied by the allow-list alone.
    svc.resolvePublicEvent.mockResolvedValue({ ok: true, eveEnabled: true, organisationId: 'org-connected', event: { id: 'e1', stripe_account_id: 'acct_connected', payments_enabled: true } })
  })

  it('EVE_PAID_CHECKOUT_ORGS=brainbase: Brainbase is allowed (201, EVE surface) and LD Tennis is denied (503, nothing touched)', async () => {
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    const allowed = await pub.handleTicketingCheckout(gated(), brainbase())
    expect(allowed.status).toBe(201)
    expect(svc.startPaidCheckout).toHaveBeenCalledTimes(1)
    expect(svc.startPaidCheckout.mock.calls[0][0].productSurface).toBe('EVE')

    for (const f of Object.values(svc)) f.mockClear()
    await expectDenied(await pub.handleTicketingCheckout(gated(), params()))
  })

  it('EVE_PAID_CHECKOUT_ORGS=brainbase: School Test Organisation is denied', async () => {
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    await expectDenied(await pub.handleTicketingCheckout(gated(), schoolTest()))
  })

  it.each([
    ['absent', undefined], ['empty', ''], ['wildcard', '*'], ['malformed list', 'brainbase,'], ['padded', ' brainbase'],
    ['wrong case', 'Brainbase'], ['malformed entry beside brainbase', 'brainbase,LD Tennis'],
  ])('allow-list %s -> Brainbase is denied too (no allow-all fallback)', async (_l, orgs) => {
    if (orgs !== undefined) process.env.EVE_PAID_CHECKOUT_ORGS = orgs
    await expectDenied(await pub.handleTicketingCheckout(gated(), brainbase()))
  })

  it.each([params, schoolTest])('allow-list absent -> %o is denied', async mk => {
    await expectDenied(await pub.handleTicketingCheckout(gated(), mk()))
  })

  it('global flag OFF with Brainbase allow-listed -> still denied', async () => {
    delete process.env.EVE_PAID_CHECKOUT_ENABLED
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    await expectDenied(await pub.handleTicketingCheckout(gated(), brainbase()))
  })
})

describe('the legal draft guard and the paid flag are independent controls', () => {
  it('flag ON, Production, DRAFT legal version -> still 503 (draft guard alone blocks)', async () => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    vi.stubEnv('VERCEL_ENV', 'production')
    const { EVE_LEGAL_DOCUMENT_VERSION } = await import('@ticketing/core')
    const draft = /draft/i.test(EVE_LEGAL_DOCUMENT_VERSION)
    const res = await pub.handleTicketingCheckout(gated(), params())
    // While the repo constant is a draft this is 503; once it is bumped the guard no longer applies and
    // the next test (mocked draft) keeps proving the draft guard independently.
    if (draft) { expect(res.status).toBe(503); expect(svc.startPaidCheckout).not.toHaveBeenCalled() }
  })

  it('flag ON, Production, mocked DRAFT version -> 503, nothing reserved', async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), isDraftLegalVersion: () => true }))
    const mod = await import('@/lib/ticketing/publicApi')
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await mod.handleTicketingCheckout(gated(), params())
    expect(res.status).toBe(503)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    vi.doUnmock('@ticketing/core')
  })

  it('flag OFF, Production, mocked NON-draft version -> 503 (the paid flag alone blocks once the version is bumped)', async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), isDraftLegalVersion: () => false }))
    const mod = await import('@/lib/ticketing/publicApi')
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await mod.handleTicketingCheckout(gated(), params())
    expect(res.status).toBe(503)
    expect(svc.db).not.toHaveBeenCalled()
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    vi.doUnmock('@ticketing/core')
  })

  it('flag ON, organisation allow-listed, Production, mocked NON-draft version -> passes every control', async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), isDraftLegalVersion: () => false }))
    const mod = await import('@/lib/ticketing/publicApi')
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await mod.handleTicketingCheckout(gated(), brainbase())
    expect(res.status).toBe(201)
    vi.doUnmock('@ticketing/core')
  })
})

describe('public event read: server-derived paid_checkout_available (one boolean, same rules as the checkout gate)', () => {
  const DETAIL = { event: { name: 'Riverlights' }, ticket_types: [{ id: 't1', price_cents: 8900 }], questions: [], has_promotions: false, organisationName: 'Brainbase' }
  const read = (p: { organisationSlug: string; eventSlug: string }) =>
    pub.handleTicketingPublicEvent(new Request('http://bb.test/x', { headers: GATE }), p)

  beforeEach(async () => {
    const { getPublicEventDetail } = await import('@/lib/events/publicEventDetail')
    vi.mocked(getPublicEventDetail).mockResolvedValue({ ok: true, eveEnabled: true, detail: DETAIL, eveQuestionsEnabled: false } as never)
    vi.stubEnv('VERCEL_ENV', 'preview')
  })

  const cases: [string, Record<string, string | undefined>, { brainbase: boolean; ldTennis: boolean; schoolTest: boolean }][] = [
    ['flag absent, brainbase listed', { EVE_PAID_CHECKOUT_ORGS: 'brainbase' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag "false"', { EVE_PAID_CHECKOUT_ENABLED: 'false', EVE_PAID_CHECKOUT_ORGS: 'brainbase' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag malformed "TRUE"', { EVE_PAID_CHECKOUT_ENABLED: 'TRUE', EVE_PAID_CHECKOUT_ORGS: 'brainbase' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag malformed " true "', { EVE_PAID_CHECKOUT_ENABLED: ' true ', EVE_PAID_CHECKOUT_ORGS: 'brainbase' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag true, allow-list absent', { EVE_PAID_CHECKOUT_ENABLED: 'true' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag true, allow-list malformed', { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: 'brainbase,*' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag true, other org only', { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: 'other-org' }, { brainbase: false, ldTennis: false, schoolTest: false }],
    ['flag true, brainbase listed', { EVE_PAID_CHECKOUT_ENABLED: 'true', EVE_PAID_CHECKOUT_ORGS: 'brainbase' }, { brainbase: true, ldTennis: false, schoolTest: false }],
  ]

  it.each(cases)('%s -> brainbase/ld-tennis/school-test as expected, and the checkout gate agrees for each', async (_l, env, expected) => {
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
    for (const [org, mk] of [['brainbase', brainbase], ['ldTennis', params], ['schoolTest', schoolTest]] as const) {
      const p = mk()
      const res = await read(p)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.paid_checkout_available, org).toBe(expected[org])
      // Parity with the authoritative gate: available <=> checkout gets past every configuration control.
      const checkout = await pub.handleTicketingCheckout(gated(), p)
      expect(checkout.status === 503, `${org} checkout`).toBe(!expected[org])
    }
  })

  it('returns the event detail unchanged plus server-derived booleans only, and nothing about the flag or allow-list', async () => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase,other-org'
    for (const mk of [brainbase, params]) {
      const body = await (await read(mk())).json()
      // organisationName (internal) is replaced by organiser_name (public display name or null).
      const expectedKeys = [...Object.keys(DETAIL).filter(k => k !== 'organisationName'), 'organiser_contact', 'organiser_name', 'paid_checkout_available', 'questions_block_booking']
      expect(Object.keys(body).sort()).toEqual(expectedKeys.sort())
      expect(body.organiser_name).toBeNull()
      expect(JSON.stringify(body)).not.toContain('Brainbase')
      expect(typeof body.questions_block_booking).toBe('boolean')
      expect(typeof body.paid_checkout_available).toBe('boolean')
      const text = JSON.stringify(body)
      expect(text).not.toMatch(/EVE_PAID|other-org|allow|flag|enabled|orgs/i)
      expect(text).not.toContain('"true"')
    }
  })

  it('fails closed when the product return-URL base is not configured (the checkout gate refuses then too)', async () => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    vi.stubEnv('EVE_PUBLIC_BASE_URL', '')
    const p = brainbase()
    expect((await (await read(p)).json()).paid_checkout_available).toBe(false)
    expect((await pub.handleTicketingCheckout(gated(), p)).status).toBe(503)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it('fails closed in Production while the legal version is a draft (the checkout gate refuses then too)', async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), isDraftLegalVersion: () => true }))
    const mod = await import('@/lib/ticketing/publicApi')
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    vi.stubEnv('VERCEL_ENV', 'production')
    const p = brainbase()
    const res = await mod.handleTicketingPublicEvent(new Request('http://bb.test/x', { headers: GATE }), p)
    expect((await res.json()).paid_checkout_available).toBe(false)
    expect((await mod.handleTicketingCheckout(gated(), p)).status).toBe(503)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    vi.doUnmock('@ticketing/core')
  })

  it('the API stays fail-closed independently of the UI: flag off -> checkout 503 with nothing touched, whatever the client sends', async () => {
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    const p = brainbase()
    expect((await (await read(p)).json()).paid_checkout_available).toBe(false)
    for (const body of [BODY, { ...BODY, paid_checkout_available: true }, { ...BODY, accept_terms: true, force: true }]) {
      const res = await pub.handleTicketingCheckout(gated(body), p)
      expect(res.status).toBe(503)
    }
    expect(svc.db).not.toHaveBeenCalled()
    expect(svc.resolvePublicEvent).not.toHaveBeenCalled()
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    expect(svc.stripeLike).not.toHaveBeenCalled()
  })

  it('free registration is still available while paid checkout is unavailable', async () => {
    const p = brainbase()
    expect((await (await read(p)).json()).paid_checkout_available).toBe(false)
    const res = await pub.handleTicketingRegister(gated(), p)
    expect(res.status).toBe(201)
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it('an unknown or draft event is still a plain 404 with no availability field', async () => {
    const { getPublicEventDetail } = await import('@/lib/events/publicEventDetail')
    vi.mocked(getPublicEventDetail).mockResolvedValue({ ok: false } as never)
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'
    const res = await read(brainbase())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Event not available.' })
  })
})

describe('scope: only the gated Eve checkout handler reads the flag', () => {
  const root = process.cwd()
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      if (['node_modules', '.next', '.git', 'tests', 'apps'].includes(f)) return []
      const p = path.join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
    })
  const readers = ['lib', 'app'].flatMap(d => walk(path.join(root, d)))
    .filter(f => /EVE_PAID_CHECKOUT_ENABLED|isEvePaidCheckoutEnabled/.test(readFileSync(f, 'utf8')))
    .map(f => path.relative(root, f).replace(/\\/g, '/')).sort()

  it('is referenced only by the flag module and the Eve checkout handler', () => {
    expect(readers).toEqual(['lib/ticketing/paidCheckoutFlag.ts', 'lib/ticketing/publicApi.ts'])
  })

  // The read-only availability helper is the one other place allowed to call
  // the flag functions; it is used only by the public event read and only to
  // produce a boolean.
  const availabilitySection = (src: string) =>
    src.slice(src.indexOf('function isEvePaidCheckoutAvailableFor('), src.indexOf('export async function handleTicketingPublicEvent('))

  it('the flag is enforced inside handleTicketingCheckout; outside it only the read-only availability helper reads it (not register, status, or any other handler)', () => {
    const src = readFileSync(path.join(root, 'lib/ticketing/publicApi.ts'), 'utf8').replace(/\r\n/g, '\n')
    const start = src.indexOf('export async function handleTicketingCheckout(')
    const end = src.indexOf('export async function handleTicketingTicket')
    const checkout = src.slice(start, end)
    const helper = availabilitySection(src)
    expect(helper).toContain('isEvePaidCheckoutEnabled()')
    expect(src.replace(checkout, '').replace(helper, '').match(/isEvePaidCheckoutEnabled\(/g)).toBeNull()
    expect(src.match(/isEvePaidCheckoutAvailableFor\(/g)).toHaveLength(2) // definition + the public event read
    const eventRead = src.slice(src.indexOf('export async function handleTicketingPublicEvent('), src.indexOf('export async function handleTicketingQuote('))
    expect(eventRead).toContain('paid_checkout_available: isEvePaidCheckoutAvailableFor(params.organisationSlug)')
    expect(checkout).not.toContain('isEvePaidCheckoutAvailableFor')
    expect(checkout.indexOf('isEvePaidCheckoutEnabled()')).toBeGreaterThan(checkout.indexOf('checkTicketingGate'))
    for (const later of ['limit(LIMITS.paidCheckout', 'req.json()', 'resolveEveEvent(', 'startPaidCheckout(']) {
      expect(checkout.indexOf('isEvePaidCheckoutEnabled()'), later).toBeLessThan(checkout.indexOf(later))
    }
  })

  it('BrainBase public checkout, Stripe Connect, webhook, retry and refunds do not reference the flag', () => {
    for (const f of [
      'app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts',
      'lib/events/services/paidCheckout.ts', 'lib/events/services/retryCheckout.ts', 'lib/events/stripe.ts', 'lib/events/stripeConnect.ts',
    ]) {
      expect(readers, f).not.toContain(f)
    }
  })

  it('the allow-list is read only by the flag module and enforced only in handleTicketingCheckout, before any side effect', () => {
    const allowReaders = ['lib', 'app'].flatMap(d => walk(path.join(root, d)))
      .filter(f => /EVE_PAID_CHECKOUT_ORGS|isEvePaidCheckoutAllowedForOrg|evePaidCheckoutOrgAllowList/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(root, f).replace(/\\/g, '/')).sort()
    expect(allowReaders).toEqual(['lib/ticketing/paidCheckoutFlag.ts', 'lib/ticketing/publicApi.ts'])
    const flagSrc = readFileSync(path.join(root, 'lib/ticketing/publicApi.ts'), 'utf8').replace(/\r\n/g, '\n')
    expect(flagSrc).not.toMatch(/EVE_PAID_CHECKOUT_ORGS/)
    const start = flagSrc.indexOf('export async function handleTicketingCheckout(')
    const end = flagSrc.indexOf('export async function handleTicketingTicket')
    const checkout = flagSrc.slice(start, end)
    expect(flagSrc.replace(checkout, '').replace(availabilitySection(flagSrc), '').match(/isEvePaidCheckoutAllowedForOrg\(/g)).toBeNull()
    expect(checkout).toContain('isEvePaidCheckoutAllowedForOrg(organisationSlug)')
    for (const later of ['limit(LIMITS.paidCheckout', 'req.json()', 'resolveEveEvent(', 'startPaidCheckout(']) {
      expect(checkout.indexOf('isEvePaidCheckoutAllowedForOrg('), later).toBeLessThan(checkout.indexOf(later))
    }
  })
})
