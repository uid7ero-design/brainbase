import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve free-registration legal notice version:
//   scripts/add-events-order-legal-notice.sql
//
// The base migration set (everything up to and including the paid acceptance
// snapshot) is applied, HISTORICAL orders of every kind are written, and only
// then is the new migration applied — twice, to prove idempotency. The ACTUAL
// entry points then run against it: the Eve S2S register handler
// (handleTicketingRegister), the BrainBase public register route, and the
// shared paid-checkout service. Only the rate limiters, the capability lookup,
// Stripe network calls, the CRM hooks and the ticket-email sender are mocked.
//
// Never against Production/Preview — a disposable container, torn down after
// use. Skipped when docker is unavailable.

process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'

const CONTAINER = `eve-free-legal-notice-vitest-${process.pid}`
// Outside every Windows excluded TCP range seen on the dev machines.
const HOST_PORT = 62700 + (process.pid % 800)

function dockerAvailable(): boolean {
  try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false }
}
const HAS_DOCKER = dockerAvailable()

const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }))

vi.mock('@/lib/db', () => {
  type Query = { text: string; values: unknown[]; then: Promise<unknown[]>['then'] }
  function sql(strings: TemplateStringsArray, ...values: unknown[]): Query {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return {
      text, values,
      then(onFulfilled, onRejected) {
        return db.pool.query(text, values as unknown[]).then(r => r.rows).then(onFulfilled, onRejected)
      },
    }
  }
  sql.transaction = async (queries: Query[]) => {
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const out: unknown[][] = []
      for (const q of queries) out.push((await client.query(q.text, q.values as unknown[])).rows)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }
  return { default: sql }
})

vi.mock('@/lib/capabilities/requireCapability', () => ({ checkCapability: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock('@/lib/ticketing/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ticketing/rateLimit')>()),
  limit: vi.fn(async () => ({ allowed: true, degraded: false })),
}))
vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: vi.fn(async () => ({ eligible: true, accountId: 'acct_test_org_a' })),
}))
const crm = vi.hoisted(() => ({ sync: vi.fn(), activity: vi.fn() }))
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: (...a: unknown[]) => crm.sync(...a),
  recordEventBookingActivity: (...a: unknown[]) => crm.activity(...a),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
}))
const email = vi.hoisted(() => ({ attempt: vi.fn() }))
vi.mock('@/lib/events/ticketEmailDelivery', () => ({
  attemptAutomaticTicketEmail: (...a: unknown[]) => email.attempt(...a),
}))
const createCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return { ...actual, createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a), expireCheckoutSession: vi.fn() }
})

// Everything BEFORE the new migration (it is applied separately below).
const BASE_MIGRATIONS = [
  'scripts/create-events.sql',
  'scripts/create-events-phase2.sql',
  'scripts/add-events-ticketing.sql',
  'scripts/add-events-artwork.sql',
  'scripts/add-events-payments.sql',
  'scripts/add-events-payment-connect.sql',
  'scripts/add-events-registration-questions.sql',
  'scripts/add-eve-registration-questions.sql',
  'scripts/add-events-booking-wallet.sql',
  'scripts/add-events-ticket-email-delivery.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  'scripts/create-events-ticketing-fees-foundation.sql',
  'scripts/add-events-order-product-surface.sql',
  'scripts/add-events-order-legal-acceptance.sql',
]
const MIGRATION = 'scripts/add-events-order-legal-notice.sql'
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')

const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
const PAID_VALIDATED = {
  items: [{ ticket_type_id: 'tt-paid', quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, responses: [], ticket_type_id: 'tt-paid' }], order_responses: [], promotion_code: null, access_code: null,
}
const FREE_BODY = {
  items: [{ ticket_type_id: 'tt-free', quantity: 1 }], purchaser_name: 'Sam', purchaser_email: 'sam@example.com',
  attendees: [{ name: 'Sam', ticket_type_id: 'tt-free' }],
}
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })
const PARAMS = { organisationSlug: 'org-a', eventSlug: 'gala' }

type OrderRow = {
  id: string; product_surface: string; total_cents: number; legal_notice_version: string | null
  terms_accepted_at: Date | null; terms_version: string | null; refunds_version: string | null
}

describe.runIf(HAS_DOCKER)('real Postgres — Eve free-registration legal notice version', () => {
  let handleTicketingRegister: typeof import('@/lib/ticketing/publicApi').handleTicketingRegister
  let brainbaseRegister: typeof import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route').POST
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let core: typeof import('@ticketing/core')

  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const order = async (id: string) => (await q<OrderRow>(
    `SELECT id, product_surface, total_cents, legal_notice_version, terms_accepted_at, terms_version, refunds_version FROM event_orders WHERE id = $1`, [id]))[0]
  const historic: Record<string, OrderRow> = {}

  const eveRegister = (body: unknown) => handleTicketingRegister(
    new Request('http://bb.test/api/ticketing/x/register', {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET!, 'content-type': 'application/json' },
    }), PARAMS)
  const bbRegister = (body: unknown) => brainbaseRegister(
    new Request('http://bb.test/api/public/events/org-a/gala/register', {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve(PARAMS) })
  const latestOrderId = async () => (await q<{ id: string }>(`SELECT id FROM event_orders ORDER BY created_at DESC, id DESC LIMIT 1`))[0].id

  beforeAll(async () => {
    execSync(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p ${HOST_PORT}:5432 postgres:17-alpine`, { stdio: 'ignore' })
    let ready = false
    for (let i = 0; i < 30; i++) {
      const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])
      if (r.status === 0) { ready = true; break }
      await new Promise(r2 => setTimeout(r2, 1000))
    }
    if (!ready) throw new Error('postgres container did not become ready within 30s')

    db.pool = new Pool({
      host: 'localhost', port: HOST_PORT, user: 'postgres', password: 'test', database: 'testdb', max: 8,
      types: neonTypes as unknown as import('pg').CustomTypesConfig,
    })
    const schema = [
      `CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, settings JSONB);`,
      `CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE CASCADE, username TEXT UNIQUE, name TEXT);`,
      ...BASE_MIGRATIONS.map(read),
      `CREATE TABLE audit_logs (
        id text NOT NULL PRIMARY KEY, organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        user_id text NULL REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text NOT NULL,
        resource_id text NULL, before_state jsonb NULL, after_state jsonb NULL, ip_address text NULL, user_agent text NULL,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
      // Eve-enabled (Eve organiser allow-list): Eve registers only for these.
      `INSERT INTO organisations (id, name, slug, settings) VALUES ('org-a', 'Org A', 'org-a', '{"events":{"eveEnabled":true}}');`,
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
         VALUES ('event-1', 'org-a', 'Gala', 'gala', 'PUBLISHED', '2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z', 'Australia/Adelaide');`,
      `INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
         VALUES ('tt-paid', 'event-1', 'org-a', 'Premium', 2500, 1000, true), ('tt-free', 'event-1', 'org-a', 'Free', 0, 1000, true);`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)

    // Historical orders written BEFORE the migration, one of each kind that
    // exists in Production: BrainBase free + paid, Eve free (no stamp), Eve paid
    // with the explicit acceptance snapshot.
    const seed = async (key: string, surface: string, total: number, payment: string, accepted: boolean) => {
      const [row] = await q<{ id: string }>(`
        INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, currency, product_surface,
                                  terms_accepted_at, terms_version, refunds_version)
        VALUES ('org-a', 'event-1', 'Old', $1, 'CONFIRMED', $2, $3, 'AUD', $4,
                CASE WHEN $5::boolean THEN NOW() END, CASE WHEN $5::boolean THEN '2026-10-22' END, CASE WHEN $5::boolean THEN '2026-10-22' END)
        RETURNING id`, [`${key}@example.com`, total, payment, surface, accepted])
      return row.id
    }
    const ids = {
      bbFree: await seed('bb-free', 'BRAINBASE', 0, 'NOT_REQUIRED', false),
      bbPaid: await seed('bb-paid', 'BRAINBASE', 2500, 'PAID', false),
      eveFree: await seed('eve-free', 'EVE', 0, 'NOT_REQUIRED', false),
      evePaid: await seed('eve-paid', 'EVE', 2500, 'PAID', true),
    }
    await db.pool.query(read(MIGRATION))
    await db.pool.query(read(MIGRATION))
    for (const [k, id] of Object.entries(ids)) historic[k] = await order(id)

    ;({ handleTicketingRegister } = await import('@/lib/ticketing/publicApi'))
    ;({ POST: brainbaseRegister } = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route'))
    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    core = await import('@ticketing/core')
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(() => {
    crm.sync.mockReset().mockResolvedValue(undefined)
    crm.activity.mockReset().mockResolvedValue(undefined)
    email.attempt.mockReset().mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-test' })
    createCheckoutSessionMock.mockReset()
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('@ticketing/core') })

  // ── Migration ──────────────────────────────────────────────────────────
  describe('migration', () => {
    it('adds one nullable TEXT column and exactly one constraint, even when run twice', async () => {
      const cols = await q(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_orders' AND column_name = 'legal_notice_version'`)
      expect(cols).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }])
      const cons = await q<{ convalidated: boolean }>(`SELECT convalidated FROM pg_constraint WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_legal_notice_check'`)
      expect(cons).toEqual([{ convalidated: true }])
      // No index was added for it.
      expect(await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'event_orders' AND indexdef ILIKE '%legal_notice_version%'`)).toEqual([])
    })

    it('historical orders of every kind stay NULL — nothing is backfilled or fabricated — and their acceptance snapshot is untouched', () => {
      for (const k of ['bbFree', 'bbPaid', 'eveFree', 'evePaid']) expect(historic[k].legal_notice_version, k).toBeNull()
      expect(historic.eveFree.terms_accepted_at).toBeNull()
      expect(historic.evePaid.terms_version).toBe('2026-10-22')
      expect(historic.evePaid.refunds_version).toBe('2026-10-22')
      expect(historic.evePaid.terms_accepted_at).not.toBeNull()
    })

    it('leaves the paid acceptance CHECK in place and valid', async () => {
      expect(await q(`SELECT convalidated FROM pg_constraint WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_legal_acceptance_check'`)).toEqual([{ convalidated: true }])
    })

    it('the CHECK: a notice version only on an EVE, zero-total order without explicit acceptance', async () => {
      const set = (id: string) => q(`UPDATE event_orders SET legal_notice_version = 'v1' WHERE id = $1`, [id])
      await expect(set(historic.evePaid.id), 'paid order with acceptance').rejects.toThrow(/event_orders_legal_notice_check/)
      await expect(set(historic.bbFree.id), 'BrainBase free order').rejects.toThrow(/event_orders_legal_notice_check/)
      await expect(set(historic.bbPaid.id), 'BrainBase paid order').rejects.toThrow(/event_orders_legal_notice_check/)
      // An Eve free order may carry it — and then can never gain an acceptance snapshot as well.
      await set(historic.eveFree.id)
      await expect(q(`UPDATE event_orders SET terms_accepted_at = NOW(), terms_version = 'v1', refunds_version = 'v1' WHERE id = $1`, [historic.eveFree.id]))
        .rejects.toThrow(/event_orders_legal_notice_check/)
      await q(`UPDATE event_orders SET legal_notice_version = NULL WHERE id = $1`, [historic.eveFree.id])
    })

    it('rolls back cleanly as documented (drop constraint, drop column), and re-applies', async () => {
      const client = await db.pool.connect()
      try {
        await client.query(`BEGIN; SET LOCAL lock_timeout = '5s';
          ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_legal_notice_check;
          ALTER TABLE event_orders DROP COLUMN IF EXISTS legal_notice_version;
          COMMIT;`)
      } finally { client.release() }
      expect(await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'event_orders' AND column_name = 'legal_notice_version'`)).toEqual([])
      await db.pool.query(read(MIGRATION))
      expect(await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'event_orders' AND column_name = 'legal_notice_version'`)).toHaveLength(1)
      expect((await order(historic.eveFree.id)).legal_notice_version).toBeNull()
    })
  })

  // ── Eve free registration ──────────────────────────────────────────────
  describe('Eve free registration (the gated S2S register handler)', () => {
    it('succeeds as before and stores the current Eve legal-document version; the acceptance columns stay NULL', async () => {
      const res = await eveRegister(FREE_BODY)
      expect(res.status).toBe(201)
      const body = await res.json() as Record<string, unknown>
      expect(body.confirmation_reference).toBeTruthy()
      expect(body.booking_token).toBeTruthy()
      const row = await order(await latestOrderId())
      expect(row).toMatchObject({
        product_surface: 'EVE', total_cents: 0, legal_notice_version: core.EVE_LEGAL_DOCUMENT_VERSION,
        terms_accepted_at: null, terms_version: null, refunds_version: null,
      })
      // Existing post-commit behaviour unchanged: CRM hooks and the ticket email still run once.
      expect(crm.sync).toHaveBeenCalledTimes(1)
      expect(crm.activity).toHaveBeenCalledTimes(1)
      expect(email.attempt).toHaveBeenCalledTimes(1)
    })

    it('injected body values cannot control the stored version or add acceptance', async () => {
      const res = await eveRegister({
        ...FREE_BODY, legal_notice_version: 'evil', terms_version: 'evil', refunds_version: 'evil',
        terms_accepted_at: '2020-01-01T00:00:00Z', accept_terms: true,
      })
      expect(res.status).toBe(201)
      const row = await order(await latestOrderId())
      expect(row.legal_notice_version).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
      expect(row).toMatchObject({ terms_accepted_at: null, terms_version: null, refunds_version: null })
    })

    it('a draft version on Production: the registration still succeeds and the version is NULL', async () => {
      vi.resetModules()
      vi.doMock('@ticketing/core', async orig => ({ ...(await orig<typeof import('@ticketing/core')>()), currentEveLegalNoticeVersion: () => '2026-11-01-draft' }))
      const mod = await import('@/lib/ticketing/publicApi')
      vi.stubEnv('VERCEL_ENV', 'production')
      const res = await mod.handleTicketingRegister(new Request('http://bb.test/x', {
        method: 'POST', body: JSON.stringify(FREE_BODY),
        headers: { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET!, 'content-type': 'application/json' },
      }), PARAMS)
      expect(res.status).toBe(201)
      const row = await order(await latestOrderId())
      expect(row).toMatchObject({ product_surface: 'EVE', legal_notice_version: null, terms_accepted_at: null })
    })
  })

  // ── BrainBase free + paid orders ───────────────────────────────────────
  it('a BrainBase free registration (public route) stays NULL in every legal column', async () => {
    const res = await bbRegister({ ...FREE_BODY, legal_notice_version: 'evil', accept_terms: true })
    expect(res.status).toBe(201)
    const row = await order(await latestOrderId())
    expect(row).toMatchObject({
      product_surface: 'BRAINBASE', legal_notice_version: null, terms_accepted_at: null, terms_version: null, refunds_version: null,
    })
  })

  it('a paid Eve order is unchanged: explicit acceptance snapshot stamped, no notice version', async () => {
    createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_paid', url: 'https://checkout.stripe.test/paid' })
    const res = await startPaidCheckout({
      organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: PAID_VALIDATED, buildReturnUrls: URLS,
      legalAcceptance: core.currentEveLegalAcceptance(),
    })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/paid' })
    const row = await order(await latestOrderId())
    expect(row.product_surface).toBe('EVE')
    expect(row.total_cents).toBe(2500)
    expect(row.terms_accepted_at).not.toBeNull()
    expect(row.terms_version).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
    expect(row.refunds_version).toBe(core.EVE_LEGAL_DOCUMENT_VERSION)
    expect(row.legal_notice_version).toBeNull()
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
  })
})
