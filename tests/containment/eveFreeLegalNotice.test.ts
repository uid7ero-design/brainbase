import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Eve free registration: legal notice version (no checkbox — evidence of the
// version in force for the notice flow, NOT acceptance). The value comes only
// from a server constant, only the gated Eve register handler supplies it, a
// draft version on Production records NULL without refusing the registration,
// and the paid acceptance path is untouched.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'
process.env.EVE_PAID_CHECKOUT_ENABLED = 'true'
process.env.EVE_PAID_CHECKOUT_ORGS = 'brainbase'

const svc = { resolvePublicEvent: vi.fn(), startPaidCheckout: vi.fn(), registerFreeOrder: vi.fn(), db: vi.fn() }
vi.mock('@/lib/db', () => ({ default: async (...a: unknown[]) => { svc.db(...a); return [] } }))
vi.mock('@/lib/events/publicResolve', () => ({ resolvePublicEvent: (...a: unknown[]) => svc.resolvePublicEvent(...a) }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: (...a: unknown[]) => svc.startPaidCheckout(...a) }))
vi.mock('@/lib/events/services/freeRegistration', () => ({ registerFreeOrder: (...a: unknown[]) => svc.registerFreeOrder(...a) }))
vi.mock('@/lib/events/stripe', () => ({ createCheckoutSession: vi.fn() }))
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: vi.fn() }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: vi.fn() }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: vi.fn() }))
vi.mock('@/lib/events/qr', () => ({ generateTicketQrSvg: vi.fn() }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(async () => undefined), recordEventBookingActivity: vi.fn(async () => undefined) }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: vi.fn() }))

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')
const core = await import('@ticketing/core')
const pub = await import('@/lib/ticketing/publicApi')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const BODY = { items: [{ ticket_type_id: 't1', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 's@x.test', attendees: [{ name: 'Sam', ticket_type_id: 't1' }] }
const req = (body: unknown) => new Request('http://bb.test/x', { method: 'POST', body: JSON.stringify(body), headers: { ...GATE, 'content-type': 'application/json' } })
let n = 0
const params = () => ({ organisationSlug: 'brainbase', eventSlug: `notice-${++n}` })

beforeEach(() => {
  for (const f of Object.values(svc)) f.mockReset()
  svc.resolvePublicEvent.mockResolvedValue({ ok: true, eveEnabled: true, organisationId: 'org-1', event: { id: 'e1', name: 'Gala' } })
  svc.registerFreeOrder.mockResolvedValue({ ok: true, orderId: 'o1', quantity: 1, tickets: [], bookingToken: 'bt' })
  svc.startPaidCheckout.mockResolvedValue({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('the notice version is the shared Eve legal-document version', () => {
  it('equals EVE_LEGAL_DOCUMENT_VERSION (Terms and Privacy share it) and is not a draft', () => {
    expect(core.currentEveLegalNoticeVersion()).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
    expect(core.isDraftLegalVersion(core.currentEveLegalNoticeVersion())).toBe(false)
  })
})

describe('Eve free registration records the version from the server constant only', () => {
  it.each([['production'], ['preview'], [undefined]])('VERCEL_ENV=%s, non-draft: 201 and the service receives the current version', async (env) => {
    if (env) vi.stubEnv('VERCEL_ENV', env)
    const res = await pub.handleTicketingRegister(req(BODY), params())
    expect(res.status).toBe(201)
    const input = svc.registerFreeOrder.mock.calls[0][0]
    expect(input.productSurface).toBe('EVE')
    expect(input.legalNoticeVersion).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
    expect(input).not.toHaveProperty('legalAcceptance')
  })

  it('request-supplied versions, timestamps or acceptance are ignored', async () => {
    const res = await pub.handleTicketingRegister(req({
      ...BODY, legal_notice_version: 'evil', legalNoticeVersion: 'evil', terms_version: 'evil', refunds_version: 'evil',
      terms_accepted_at: '2020-01-01', accept_terms: true,
    }), params())
    expect(res.status).toBe(201)
    const input = svc.registerFreeOrder.mock.calls[0][0]
    expect(input.legalNoticeVersion).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
    expect(JSON.stringify(input)).not.toMatch(/evil|2020-01-01|accept_terms/)
  })

  it('a free registration never needs accept_terms (absent, false or junk all still succeed)', async () => {
    for (const accept of [undefined, false, 'yes']) {
      svc.registerFreeOrder.mockClear()
      const res = await pub.handleTicketingRegister(req(accept === undefined ? BODY : { ...BODY, accept_terms: accept }), params())
      expect(res.status).toBe(201)
      expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    }
  })
})

describe('a draft version never blocks a free registration', () => {
  const withDraft = async () => {
    vi.resetModules()
    vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), currentEveLegalNoticeVersion: () => '2026-11-01-draft' }))
    return import('@/lib/ticketing/publicApi')
  }
  afterEach(() => { vi.doUnmock('@ticketing/core') })

  it('Production + draft: 201, registration proceeds, version recorded as NULL', async () => {
    const mod = await withDraft()
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await mod.handleTicketingRegister(req(BODY), params())
    expect(res.status).toBe(201)
    expect(svc.registerFreeOrder).toHaveBeenCalledTimes(1)
    expect(svc.registerFreeOrder.mock.calls[0][0].legalNoticeVersion).toBeNull()
  })

  it('Preview + draft: the draft text is what Preview shows, so its version is recorded', async () => {
    const mod = await withDraft()
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await mod.handleTicketingRegister(req(BODY), params())
    expect(res.status).toBe(201)
    expect(svc.registerFreeOrder.mock.calls[0][0].legalNoticeVersion).toBe('2026-11-01-draft')
  })
})

describe('paid checkout is unchanged', () => {
  it('the paid handler passes the acceptance snapshot and never a notice version', async () => {
    const res = await pub.handleTicketingCheckout(req({ ...BODY, accept_terms: true }), params())
    expect(res.status).toBe(201)
    const input = svc.startPaidCheckout.mock.calls[0][0]
    expect(input.legalAcceptance).toEqual(core.currentEveLegalAcceptance())
    expect(input).not.toHaveProperty('legalNoticeVersion')
  })
  it('paid services never name the notice column or input', () => {
    for (const f of ['lib/events/services/paidCheckout.ts', 'lib/events/services/retryCheckout.ts', 'lib/events/stripe.ts']) {
      expect(read(f), f).not.toMatch(/legal_notice_version|legalNoticeVersion/)
    }
  })
})

// ─── Source contracts ─────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name)) walk(rel, out) } else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}
let CORPUS: Map<string, string> | null = null
const corpus = (): Map<string, string> => (CORPUS ??= new Map([...walk('lib'), ...walk('app'), ...walk('apps/eve/app'), ...walk('apps/eve/components'), ...walk('apps/eve/lib')].map(f => [f, read(f)] as [string, string])))
const SLOW = 60_000

describe('write-once, server-side only', () => {
  it('only the free-registration service names the column, in its order INSERT', () => {
    const writers = [...corpus()].filter(([, src]) => /legal_notice_version/.test(stripComments(src))).map(([f]) => f)
    expect(writers).toEqual(['lib/events/services/freeRegistration.ts'])
    const src = stripComments(read('lib/events/services/freeRegistration.ts'))
    expect(src).toMatch(/INSERT INTO event_orders \([^)]*product_surface, legal_notice_version\)/)
    expect(src).toMatch(/\$\{productSurface\}, \$\{legalNoticeVersion\}::text/)
  }, SLOW)

  it('no application SQL ever UPDATEs the column', () => {
    for (const [f, src] of corpus()) {
      for (const m of src.matchAll(/UPDATE\s+event_orders[\s\S]*?(?:WHERE|RETURNING|`)/g)) {
        expect(m[0], `${f} must not update the notice version`).not.toMatch(/legal_notice_version/)
      }
    }
  }, SLOW)

  it('only the gated Eve register handler supplies legalNoticeVersion; the BrainBase public route never does', () => {
    const callers = [...corpus()]
      .filter(([f, src]) => /legalNoticeVersion/.test(stripComments(src)) && f !== 'lib/events/services/freeRegistration.ts')
      .map(([f]) => f)
    expect(callers).toEqual(['lib/ticketing/publicApi.ts'])
    expect(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts')).not.toMatch(/legalNotice|legal_notice|EVE_LEGAL/)
    const handler = read('lib/ticketing/publicApi.ts')
    const register = handler.slice(handler.indexOf('export async function handleTicketingRegister'), handler.indexOf('export async function handleTicketingCheckoutStatus'))
    expect(register).toMatch(/productSurface: 'EVE',\n\s*legalNoticeVersion: eveFreeLegalNoticeVersion\(\),/)
  }, SLOW)

  it('the Eve buyer UI never sends a version; the notice wording and the no-checkbox free flow are unchanged', () => {
    const ui = read('apps/eve/components/buyer/BuyerBooking.tsx')
    expect(ui).not.toMatch(/legal_notice|_version|LEGAL_DOCUMENT_VERSION/)
    expect(ui).toContain('By registering you agree to the <Link href="/terms"')
    expect(ui).toContain('Privacy Policy</Link>.')
    // The only checkbox tied to Terms is the paid one.
    expect(ui).toMatch(/\{anyPaid \? \(\s*<div className="flex items-start gap-3">\s*<input id="accept-terms" type="checkbox"/)
  })
})

describe('migration contract — scripts/add-events-order-legal-notice.sql', () => {
  const raw = read('scripts/add-events-order-legal-notice.sql')
  const sqlOnly = stripComments(raw)

  it('one transaction with a short lock timeout', () => {
    expect(sqlOnly.trim().startsWith('BEGIN;')).toBe(true)
    expect(sqlOnly).toMatch(/SET LOCAL lock_timeout = '5s';/)
    expect(sqlOnly.trim().endsWith('COMMIT;')).toBe(true)
  })
  it('additive and idempotent: ADD COLUMN IF NOT EXISTS, constraint looked up on event_orders, NOT VALID then VALIDATE', () => {
    expect(sqlOnly).toMatch(/ADD COLUMN IF NOT EXISTS legal_notice_version TEXT NULL;/)
    expect(sqlOnly).toMatch(/conname = 'event_orders_legal_notice_check'\s+AND conrelid = 'event_orders'::regclass/)
    expect(sqlOnly).toMatch(/\) NOT VALID;/)
    expect(sqlOnly).toMatch(/VALIDATE CONSTRAINT event_orders_legal_notice_check;/)
  })
  it('the CHECK forbids a notice version beside explicit acceptance, on a non-Eve order, or on a non-zero total', () => {
    expect(sqlOnly).toMatch(/legal_notice_version IS NULL\s+OR \(terms_accepted_at IS NULL AND product_surface = 'EVE' AND total_cents = 0\)/)
  })
  it('no backfill, no index, no default, nothing else touched', () => {
    expect(sqlOnly).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|CREATE\s+(UNIQUE\s+)?INDEX|\bDEFAULT\b|\bDROP\b/i)
    const altered = [...sqlOnly.matchAll(/ALTER TABLE (\w+)/g)].map(m => m[1])
    expect(new Set(altered)).toEqual(new Set(['event_orders']))
  })
  it('documents a rollback (drop constraint, then column) and the migration-before-code order', () => {
    expect(raw).toMatch(/DROP CONSTRAINT IF EXISTS event_orders_legal_notice_check/)
    expect(raw).toMatch(/DROP COLUMN IF EXISTS legal_notice_version/)
    expect(raw).toMatch(/BEFORE the application code/)
  })
})
