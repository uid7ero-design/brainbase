import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Eve Phase 3.1 — order product identity is decided ONLY by the trusted
// server-side entry point. Handler-level proofs with the services mocked
// (the real services against real Postgres are in
// eventsOrderProductSurfaceRealPostgres.test.ts), plus source-level
// containment so the identity can never drift onto a client-controlled input.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

const svc = {
  resolvePublicEvent: vi.fn(),
  startPaidCheckout: vi.fn(),
  registerFreeOrder: vi.fn(),
}

vi.mock('@/lib/db', () => ({ default: async () => [] }))
vi.mock('@/lib/events/publicResolve', () => ({ resolvePublicEvent: (...a: unknown[]) => svc.resolvePublicEvent(...a) }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: (...a: unknown[]) => svc.startPaidCheckout(...a) }))
vi.mock('@/lib/events/services/freeRegistration', () => ({ registerFreeOrder: (...a: unknown[]) => svc.registerFreeOrder(...a) }))
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: vi.fn() }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: vi.fn() }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: vi.fn() }))
vi.mock('@/lib/events/qr', () => ({ generateTicketQrSvg: vi.fn() }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(async () => undefined), recordEventBookingActivity: vi.fn(async () => undefined) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: vi.fn() }))

const pub = await import('@/lib/ticketing/publicApi')
const surface = await import('@/lib/events/productSurface')

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const VALID = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }] }
const gated = (body: unknown, headers: Record<string, string> = {}, url = 'http://bb.test/x') =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { ...GATE, 'content-type': 'application/json', ...headers } })

let n = 0
const uniqueParams = () => ({ organisationSlug: 'acme', eventSlug: `gala-${++n}` })

beforeEach(() => {
  for (const f of Object.values(svc)) f.mockReset()
  svc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-a', event: { id: 'e1', name: 'Gala' } })
  svc.registerFreeOrder.mockResolvedValue({ ok: true, orderId: 'o1', quantity: 1, tickets: [{ attendee_name: 'Sam', ticket_token: 'tok' }], bookingToken: 'bk' })
  svc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
})

describe('Eve S2S API stamps EVE and never trusts a client-supplied product', () => {
  it('free registration calls the shared service directly with productSurface EVE', async () => {
    const res = await pub.handleTicketingRegister(gated(VALID), uniqueParams())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ confirmation_reference: 'o1', quantity: 1, tickets: [{ attendee_name: 'Sam', ticket_token: 'tok' }], booking_token: 'bk' })
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    expect(svc.registerFreeOrder.mock.calls[0][0].productSurface).toBe('EVE')
  })

  it('paid checkout calls the shared service with productSurface EVE', async () => {
    const res = await pub.handleTicketingCheckout(gated(VALID), uniqueParams())
    expect(res.status).toBe(201)
    expect(svc.startPaidCheckout.mock.calls[0][0].productSurface).toBe('EVE')
  })

  it.each([
    ['body product_surface', { ...VALID, product_surface: 'BRAINBASE' }, {}],
    ['body productSurface', { ...VALID, productSurface: 'BRAINBASE' }, {}],
    ['body product', { ...VALID, product: 'BRAINBASE', surface: 'BRAINBASE', source: 'BRAINBASE' }, {}],
    ['x-product-surface header', VALID, { 'x-product-surface': 'BRAINBASE' }],
    ['x-ticketing-product header', VALID, { 'x-ticketing-product': 'BRAINBASE', 'x-product': 'BRAINBASE' }],
  ])('a browser-style %s cannot override the server identity (register and checkout)', async (_label, body, headers) => {
    await pub.handleTicketingRegister(gated(body, headers as Record<string, string>), uniqueParams())
    await pub.handleTicketingCheckout(gated(body, headers as Record<string, string>), uniqueParams())
    expect(svc.registerFreeOrder.mock.calls[0][0].productSurface).toBe('EVE')
    expect(svc.startPaidCheckout.mock.calls[0][0].productSurface).toBe('EVE')
    // And the unvalidated extras never reach the service as an input.
    expect(JSON.stringify(svc.registerFreeOrder.mock.calls[0][0].validated)).not.toMatch(/product/i)
    expect(JSON.stringify(svc.startPaidCheckout.mock.calls[0][0].validated)).not.toMatch(/product/i)
  })

  it('without the server-to-server gate nothing is created: no service is reached', async () => {
    const noKey = new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(VALID), headers: { 'content-type': 'application/json' } })
    expect((await pub.handleTicketingRegister(noKey, uniqueParams())).status).toBe(401)
    expect((await pub.handleTicketingCheckout(noKey, uniqueParams())).status).toBe(401)
    const browser = gated(VALID, { origin: 'https://evil.example' })
    expect((await pub.handleTicketingRegister(browser, uniqueParams())).status).toBe(403)
    expect(svc.registerFreeOrder).not.toHaveBeenCalled()
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
  })

  it('free registration keeps the register route limiter key and budget (10 per hour per ip+event)', async () => {
    const params = uniqueParams()
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await pub.handleTicketingRegister(gated(VALID, { 'x-ticketing-client-ip': '198.51.100.77' }), params)).status)
    expect(statuses.slice(0, 10).every(s => s === 201)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
  })

  it('invalid registration input is refused before the service is reached', async () => {
    const res = await pub.handleTicketingRegister(gated({ items: [] }), uniqueParams())
    expect(res.status).toBe(400)
    expect(svc.registerFreeOrder).not.toHaveBeenCalled()
  })
})

describe('product surface helpers', () => {
  it('only BRAINBASE and EVE are valid surfaces; anything else reads back as the historical default', () => {
    expect(surface.PRODUCT_SURFACES).toEqual(['BRAINBASE', 'EVE'])
    for (const ok of ['BRAINBASE', 'EVE']) expect(surface.isProductSurface(ok)).toBe(true)
    for (const bad of ['eve', 'Eve', '', null, undefined, 1, {}, 'ADMIN']) expect(surface.isProductSurface(bad)).toBe(false)
    expect(surface.productSurfaceFromRow(undefined)).toBe('BRAINBASE')
    expect(surface.productSurfaceFromRow(null)).toBe('BRAINBASE')
    expect(surface.productSurfaceFromRow('EVE')).toBe('EVE')
  })

  it('Retry return URLs follow the order product, not the request origin', () => {
    expect(surface.checkoutReturnUrlsFor('EVE', 'acme', 'gala', 'https://brainbase.example')).toEqual({
      successUrl: 'https://eve.example/e/acme/gala/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://eve.example/e/acme/gala?checkout=cancelled',
    })
    expect(surface.checkoutReturnUrlsFor('BRAINBASE', 'acme', 'gala', 'https://brainbase.example')).toEqual({
      successUrl: 'https://brainbase.example/e/acme/gala/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://brainbase.example/e/acme/gala?checkout=cancelled',
    })
    expect(surface.checkoutReturnUrlsFor('BRAINBASE', 'acme', 'gala', null)).toBeNull()
  })

  it('an Eve order has no return URLs (null, refused before mutation) when the Eve origin is not configured', () => {
    const saved = process.env.EVE_PUBLIC_BASE_URL
    delete process.env.EVE_PUBLIC_BASE_URL
    try {
      expect(surface.checkoutReturnUrlsFor('EVE', 'acme', 'gala', 'https://brainbase.example')).toBeNull()
    } finally {
      process.env.EVE_PUBLIC_BASE_URL = saved
    }
  })
})

describe('source containment', () => {
  const pubApi = strip(read('lib/ticketing/publicApi.ts'))
  const paid = strip(read('lib/events/services/paidCheckout.ts'))
  const free = strip(read('lib/events/services/freeRegistration.ts'))
  const retry = strip(read('lib/events/services/retryCheckout.ts'))
  const stripe = strip(read('lib/events/stripe.ts'))

  it('the identity is a literal at each trusted entry point, never read from the request', () => {
    expect(strip(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))).toMatch(/productSurface: 'BRAINBASE'/)
    expect(strip(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))).toMatch(/productSurface: 'BRAINBASE'/)
    expect(pubApi.match(/productSurface: 'EVE'/g)).toHaveLength(2)
    expect(pubApi).not.toMatch(/productSurface:\s*[^'\s]/)
    for (const rel of [
      'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts',
      'app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts',
      'lib/ticketing/publicApi.ts',
      'lib/events/publicValidation.ts',
    ]) {
      expect(strip(read(rel))).not.toMatch(/product_surface|productSurface:\s*(?:body|raw|validated|req|input|params|headers)/i)
    }
  })

  it('Eve free registration no longer delegates to the BrainBase public register route handler', () => {
    expect(pubApi).not.toMatch(/api\/public\/events\/\[organisationSlug\]\/\[eventSlug\]\/register\/route/)
    expect(pubApi).not.toMatch(/publicRegister/)
    expect(pubApi).toMatch(/registerFreeOrder\(/)
  })

  it('both services write the column in the SAME INSERT as the order, from their validated input', () => {
    expect(paid).toMatch(/INSERT INTO event_orders \([\s\S]*?product_surface\s*\)\s*SELECT[\s\S]*?\$\{productSurface\}\s*FROM gate/)
    expect(free).toMatch(/INSERT INTO event_orders \([^)]*product_surface\)\s*SELECT[^;]*\$\{productSurface\}\s*FROM gate/)
    expect(paid).toMatch(/isProductSurface\(input\.productSurface\)/)
    expect(free).toMatch(/isProductSurface\(input\.productSurface\)/)
  })

  it('nothing ever UPDATEs event_orders.product_surface', () => {
    for (const rel of ['lib', 'app']) void rel
    for (const src of [paid, free, retry, stripe, strip(read('lib/events/services/orderTransitions.ts'))]) {
      expect(src).not.toMatch(/SET[^`;]*product_surface/i)
    }
  })

  it('Retry reads the product from the committed order row and passes it on', () => {
    expect(retry).toMatch(/promotion_code_snapshot, product_surface\s*\n\s*FROM event_orders WHERE id = /)
    expect(retry).toMatch(/productSurfaceFromRow\(order\.product_surface\)/)
    expect(retry).toMatch(/buildReturnUrls\(event\.org_slug, event\.event_slug, productSurface\)/)
    // Resolved before any capacity is reacquired.
    expect(retry.indexOf('input.buildReturnUrls(')).toBeLessThan(retry.indexOf('buildCartLockStatements('))
    expect(retry).toMatch(/\n\s+productSurface,\n\s+\}\);/)
    // The BrainBase retry route delegates the URL decision to the product helper.
    expect(strip(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))).toMatch(/checkoutReturnUrlsFor\(productSurface,/)
  })

  it('Stripe metadata carries the product for reconciliation only; the webhook never reads it', () => {
    expect(stripe).toMatch(/\.\.\.\(input\.productSurface \? \{ product_surface: input\.productSurface \} : \{\}\)/)
    // Every metadata read in the webhook handlers is event_order_id only.
    const reads = stripe.match(/metadata\??\.[a-z_]+/g) ?? []
    expect([...new Set(reads)]).toEqual(['metadata?.event_order_id'])
    expect(stripe).not.toMatch(/metadata\??\.product/)
  })

  it('the migration adds only the approved column and constraint', () => {
    const sql = read('scripts/add-events-order-product-surface.sql').replace(/--.*$/gm, '')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS product_surface TEXT NOT NULL DEFAULT 'BRAINBASE'/)
    expect(sql).toMatch(/CHECK \(product_surface IN \('BRAINBASE', 'EVE'\)\) NOT VALID/)
    expect(sql).toMatch(/VALIDATE CONSTRAINT event_orders_product_surface_check/)
    expect((sql.match(/ALTER TABLE/g) ?? []).length).toBe(3)
    expect(sql).not.toMatch(/UPDATE |INSERT |DELETE |DROP |CREATE (?:INDEX|TABLE)/i)
  })

  it('BrainBase routes, URLs and the zero-fee default are not touched by this slice', () => {
    expect(strip(read('lib/events/services/fees.ts'))).not.toMatch(/product_surface|productSurface/)
    expect(strip(read('lib/events/feeCalculation.ts'))).not.toMatch(/product_surface|productSurface/)
    expect(strip(read('lib/email.ts'))).not.toMatch(/product_surface|productSurface/)
    expect(strip(read('lib/events/ticketEmail.ts'))).not.toMatch(/product_surface|productSurface/)
    expect(strip(read('lib/events/lifecycleEmail.ts'))).not.toMatch(/product_surface|productSurface/)
    expect(strip(read('lib/events/authorize.ts'))).not.toMatch(/product_surface|productSurface/)
  })
})
