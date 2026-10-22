import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Eve paid checkout: legal acceptance and versioning. The published text no longer says
// paid ticketing is unavailable, the version was bumped with it, a paid Eve order records
// the CURRENT version (server constants, never request values), acceptance stays mandatory
// and the Production draft-version guard still works.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'
process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'

const svc = { resolvePublicEvent: vi.fn(), startPaidCheckout: vi.fn(), db: vi.fn() }
vi.mock('@/lib/db', () => ({ default: async (...a: unknown[]) => { svc.db(...a); return [] } }))
vi.mock('@/lib/events/publicResolve', () => ({ resolvePublicEvent: (...a: unknown[]) => svc.resolvePublicEvent(...a) }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: (...a: unknown[]) => svc.startPaidCheckout(...a) }))
vi.mock('@/lib/events/services/freeRegistration', () => ({ registerFreeOrder: vi.fn() }))
vi.mock('@/lib/events/stripe', () => ({ createCheckoutSession: vi.fn() }))
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: vi.fn() }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: vi.fn() }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: vi.fn() }))
vi.mock('@/lib/events/qr', () => ({ generateTicketQrSvg: vi.fn() }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(async () => undefined), recordEventBookingActivity: vi.fn(async () => undefined) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: vi.fn() }))

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const core = await import('@ticketing/core')
const pub = await import('@/lib/ticketing/publicApi')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const BODY = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }] }
const req = (body: unknown) => new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(body), headers: { ...GATE, 'content-type': 'application/json' } })
let n = 0
const params = () => ({ organisationSlug: 'brainbase', eventSlug: `rehearsal-${++n}` })

beforeEach(() => {
  for (const f of Object.values(svc)) f.mockReset()
  svc.resolvePublicEvent.mockResolvedValue({ ok: true, organisationId: 'org-1', event: { id: 'e1' } })
  svc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('the version was bumped together with the text', () => {
  it('is a dated, non-draft version different from the previous 2026-10-21 text', () => {
    expect(core.EVE_LEGAL_DOCUMENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(core.EVE_LEGAL_DOCUMENT_VERSION).not.toBe('2026-10-21')
    expect(core.isDraftLegalVersion(core.EVE_LEGAL_DOCUMENT_VERSION)).toBe(false)
    expect(core.currentEveLegalAcceptance()).toEqual({ termsVersion: core.EVE_LEGAL_DOCUMENT_VERSION, refundsVersion: core.EVE_LEGAL_DOCUMENT_VERSION })
  })
  it('the "last updated" date shown on the legal pages agrees with the version', () => {
    const cfg = read('apps/eve/config/legal.ts')
    const shown = /export const LEGAL_LAST_UPDATED = '(\d{1,2}) (\w+) (\d{4})';/.exec(cfg)
    expect(shown).not.toBeNull()
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const [, d, m, y] = shown!
    const iso = `${y}-${String(months.indexOf(m) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`
    expect(iso).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
  })
})

describe('a paid Eve order records the CURRENT legal version, from server constants only', () => {
  it('Production, non-draft version, accepted terms: the service receives the current version for both documents', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await pub.handleTicketingCheckout(req({ ...BODY, accept_terms: true }), params())
    expect(res.status).toBe(201)
    expect(svc.startPaidCheckout).toHaveBeenCalledTimes(1)
    const input = svc.startPaidCheckout.mock.calls[0][0]
    expect(input.legalAcceptance).toEqual({ termsVersion: core.EVE_LEGAL_DOCUMENT_VERSION, refundsVersion: core.EVE_LEGAL_DOCUMENT_VERSION })
    expect(input.productSurface).toBe('EVE')
  })
  it('request-supplied versions or timestamps are ignored', async () => {
    const res = await pub.handleTicketingCheckout(req({ ...BODY, accept_terms: true, terms_version: 'evil', refunds_version: 'evil', terms_accepted_at: '2020-01-01' }), params())
    expect(res.status).toBe(201)
    expect(svc.startPaidCheckout.mock.calls[0][0].legalAcceptance.termsVersion).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
    expect(JSON.stringify(svc.startPaidCheckout.mock.calls[0][0])).not.toMatch(/evil|2020-01-01/)
  })
  it('the order INSERT stamps the three columns from that input (acceptance time is the database clock)', () => {
    const sql = read('lib/events/services/paidCheckout.ts')
    expect(sql).toMatch(/\(CASE WHEN \$\{legalAcceptance != null\}::boolean THEN NOW\(\) ELSE NULL END\), \$\{legalAcceptance\?\.termsVersion \?\? null\}::text, \$\{legalAcceptance\?\.refundsVersion \?\? null\}::text/)
  })
})

describe('acceptance stays mandatory', () => {
  it.each([[undefined], [false], ['true'], [1], [null], ['yes']])('accept_terms = %j -> 400 TERMS_NOT_ACCEPTED, no event lookup, nothing reserved', async (value) => {
    const body: Record<string, unknown> = { ...BODY }
    if (value !== undefined) body.accept_terms = value
    const res = await pub.handleTicketingCheckout(req(body), params())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TERMS_NOT_ACCEPTED')
    expect(svc.resolvePublicEvent).not.toHaveBeenCalled()
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    // (the only database touch before this check is the shared rate limiter, which has no side effect on orders)
    expect(svc.db.mock.calls.every(c => /rate|limit/i.test(String((c[0] as TemplateStringsArray)?.join?.('') ?? c[0])))).toBe(true)
  })
})

describe('the Production draft-version guard still works', () => {
  it('a draft version in Production -> 503, nothing reserved, even with acceptance', async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), isDraftLegalVersion: () => true }))
    const mod = await import('@/lib/ticketing/publicApi')
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await mod.handleTicketingCheckout(req({ ...BODY, accept_terms: true }), params())
    expect(res.status).toBe(503)
    expect(svc.startPaidCheckout).not.toHaveBeenCalled()
    vi.doUnmock('@ticketing/core')
  })
  it('a version containing "draft" is detected as a draft', () => {
    expect(core.isDraftLegalVersion('0.1-draft')).toBe(true)
    expect(core.isDraftLegalVersion('2026-10-22-DRAFT')).toBe(true)
    expect(core.isDraftLegalVersion('2026-10-22')).toBe(false)
  })
})
