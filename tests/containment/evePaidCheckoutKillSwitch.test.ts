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
const { isEvePaidCheckoutEnabled } = await import('@/lib/ticketing/paidCheckoutFlag')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const BODY = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }], accept_terms: true }
const gated = (body: unknown = BODY) =>
  new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(body), headers: { ...GATE, 'content-type': 'application/json' } })
let n = 0
const params = () => ({ organisationSlug: 'ld-tennis', eventSlug: `grad-${++n}` })

beforeEach(() => {
  for (const f of Object.values(svc)) f.mockReset()
  svc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-connected', event: { id: 'e1' } })
  svc.registerFreeOrder.mockResolvedValue({ ok: true, orderId: 'o1', quantity: 1, tickets: [{ attendee_name: 'Sam', ticket_token: 'tok' }], bookingToken: 'bk' })
  svc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  delete process.env.EVE_PAID_CHECKOUT_ENABLED
})
afterEach(() => { vi.unstubAllEnvs(); delete process.env.EVE_PAID_CHECKOUT_ENABLED })

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
    svc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-connected', event: { id: 'e1', stripe_account_id: 'acct_connected', payments_enabled: true } })
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

  it('exactly "true" passes this gate and reaches the checkout service (Preview: legal draft guard is Production-only)', async () => {
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await pub.handleTicketingCheckout(gated(), params())
    expect(res.status).toBe(201)
    expect(svc.startPaidCheckout).toHaveBeenCalledTimes(1)
    expect(svc.startPaidCheckout.mock.calls[0][0].productSurface).toBe('EVE')
  })
})

describe('free Eve registration is unaffected by the flag', () => {
  it.each([undefined, 'false', 'true'])('flag=%s -> free registration still succeeds', async value => {
    if (value !== undefined) process.env.EVE_PAID_CHECKOUT_ENABLED = value
    const res = await pub.handleTicketingRegister(gated(), params())
    expect(res.status).toBe(201)
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
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

  it('flag ON, Production, mocked NON-draft version -> passes both controls', async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), isDraftLegalVersion: () => false }))
    const mod = await import('@/lib/ticketing/publicApi')
    process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await mod.handleTicketingCheckout(gated(), params())
    expect(res.status).toBe(201)
    vi.doUnmock('@ticketing/core')
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

  it('the flag is checked inside handleTicketingCheckout only (not register, status, or any other handler)', () => {
    const src = readFileSync(path.join(root, 'lib/ticketing/publicApi.ts'), 'utf8').replace(/\r\n/g, '\n')
    const start = src.indexOf('export async function handleTicketingCheckout(')
    const end = src.indexOf('export async function handleTicketingTicket')
    const checkout = src.slice(start, end)
    expect(src.replace(checkout, '').match(/isEvePaidCheckoutEnabled\(/g)).toBeNull()
    expect(checkout.indexOf('isEvePaidCheckoutEnabled()')).toBeGreaterThan(checkout.indexOf('checkTicketingGate'))
    for (const later of ['limit(LIMITS.paidCheckout', 'req.json()', 'resolvePublicEvent(', 'startPaidCheckout(']) {
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
})
