import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve Phase 3.3 organiser Payments (read-only).
// Runs the ACTUAL read module and handlers against PostgreSQL 17 with the real
// migration set. Only authorization (covered in ticketingOrganiserPayments.test.ts)
// and the Connect column read are stubbed. Proves: tenant scoping on the list
// and the detail, free orders excluded, snapshot values returned as stored
// (historical NULL fee/payment-total rows included), SQL aggregates match the
// pure summary, and nothing is written.
//
// Never against Production/Preview — a disposable container. Skipped when
// docker is unavailable.

const CONTAINER = `ticketing-payments-vitest-${process.pid}`
const HOST_PORT = 59700 + (process.pid % 1000)

function dockerAvailable(): boolean {
  try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false }
}
const HAS_DOCKER = dockerAvailable()

const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool, org: 'org-a' }))

vi.mock('@/lib/db', () => {
  type Query = { text: string; values: unknown[]; then: Promise<unknown[]>['then'] }
  function sql(strings: TemplateStringsArray, ...values: unknown[]): Query {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return { text, values, then(onF, onR) { return db.pool.query(text, values as unknown[]).then(r => r.rows).then(onF, onR) } }
  }
  return { default: sql }
})
vi.mock('@/lib/ticketing/authorize', () => ({
  authorizeTicketingApiRequest: async () => ({
    ok: true,
    context: { userId: 'u', organisationId: db.org, homeOrganisationId: db.org, role: 'viewer', name: 'V', organisationSlug: db.org, organisationName: db.org },
  }),
}))
vi.mock('@/lib/events/stripeConnect', () => ({
  getConnectAccountState: async () => ({ status: 'NOT_CONNECTED', accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, connectedAt: null, lastSyncedAt: null }),
  checkPaidTicketingEligibility: async () => ({ eligible: false, reason: 'Connect Stripe before selling paid tickets.' }),
}))
vi.mock('@/lib/events/organiserReads', () => ({ listOrganisationEvents: vi.fn(), getOrganisationEvent: vi.fn(), listEventRegistrationRows: vi.fn() }))
vi.mock('@/lib/events/checkIn', () => ({ resolveAttendee: vi.fn(), searchAttendees: vi.fn() }))
vi.mock('@/lib/events/checkInOps', () => ({ eventBelongsToOrganisation: vi.fn(), confirmCheckInWithAudit: vi.fn(), undoCheckInWithAudit: vi.fn() }))

const MIGRATIONS = [
  'scripts/create-events.sql',
  'scripts/create-events-phase2.sql',
  'scripts/add-events-ticketing.sql',
  'scripts/add-events-payments.sql',
  'scripts/add-events-payment-connect.sql',
  'scripts/add-events-registration-questions.sql',
  'scripts/add-events-booking-wallet.sql',
  'scripts/add-events-ticket-email-delivery.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  'scripts/create-events-ticketing-fees-foundation.sql',
  'scripts/add-events-order-product-surface.sql',
]

describe.runIf(HAS_DOCKER)('real Postgres — organiser Payments (read-only)', () => {
  let org: typeof import('@/lib/ticketing/organiserApi')
  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const req = (qs = '') => new Request(`http://bb.test/x${qs}`)
  const body = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

  // id, org, event, payment_status, status, total, fee, fee_mode, payment_total, refunded, currency, extra
  const ORDERS: [string, string, string, string, string, number, number | null, string | null, number | null, number | null, string][] = [
    ['a-hist', 'org-a', 'ev-a', 'PAID', 'CONFIRMED', 5000, null, null, null, null, 'AUD'],           // historical: NULL fee snapshot, NULL payment total
    ['a-pt', 'org-a', 'ev-a', 'PAID', 'CONFIRMED', 19800, 525, 'PASS_THROUGH', 20325, null, 'AUD'],
    ['a-ab', 'org-a', 'ev-a', 'PAID', 'CONFIRMED', 19800, 525, 'ABSORB', 19800, null, 'AUD'],
    ['a-pe', 'org-a', 'ev-a', 'PENDING', 'PENDING', 3000, 0, null, 3000, null, 'AUD'],
    ['a-fa', 'org-a', 'ev-a', 'FAILED', 'CANCELLED', 3000, 0, null, 3000, null, 'AUD'],
    ['a-ex', 'org-a', 'ev-a2', 'EXPIRED', 'CANCELLED', 3000, 0, null, 3000, null, 'AUD'],
    ['a-re', 'org-a', 'ev-a', 'REFUNDED', 'CANCELLED', 19800, 525, 'PASS_THROUGH', 20325, 20325, 'AUD'],
    ['a-free', 'org-a', 'ev-a', 'NOT_REQUIRED', 'CONFIRMED', 0, 0, null, null, null, 'AUD'],
    ['b-paid', 'org-b', 'ev-b', 'PAID', 'CONFIRMED', 99900, 0, null, 99900, null, 'AUD'],
  ]

  beforeAll(async () => {
    execSync(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p ${HOST_PORT}:5432 postgres:17-alpine`, { stdio: 'ignore' })
    let ready = false
    for (let i = 0; i < 30; i++) {
      if (spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { ready = true; break }
      await new Promise(r => setTimeout(r, 1000))
    }
    if (!ready) throw new Error('postgres container did not become ready within 30s')
    db.pool = new Pool({ host: 'localhost', port: HOST_PORT, user: 'postgres', password: 'test', database: 'testdb', max: 4, types: neonTypes as unknown as import('pg').CustomTypesConfig })
    const schema = [
      `CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);`,
      `CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE CASCADE, username TEXT UNIQUE, name TEXT);`,
      ...MIGRATIONS.map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')),
      `INSERT INTO organisations (id, name, slug) VALUES ('org-a','Org A','org-a'),('org-b','Org B','org-b');`,
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
         ('ev-a','org-a','Gala A','gala-a','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide'),
         ('ev-a2','org-a','Second A','second-a','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide'),
         ('ev-b','org-b','Gala B','gala-b','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide');`,
      // Fee-bearing snapshots must reference a policy (event_orders_fee_snapshot_check).
      `INSERT INTO ticketing_fee_policies (id, organisation_id, enabled, fee_mode, percent_bps) VALUES ('pol-a','org-a', true, 'PASS_THROUGH', 250);`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)
    for (const [id, o, ev, ps, st, total, fee, mode, ptot, ref, cur] of ORDERS) {
      // Historical rows are written WITHOUT naming the fee snapshot columns.
      if (fee === null && ptot === null) {
        await db.pool.query(`INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, currency, paid_at) VALUES ($1,$2,$3,'Buyer','b@example.com',$4,$5,$6,$7, now())`, [id, o, ev, st, ps, total, cur])
      } else {
        await db.pool.query(
          `INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, payment_status, total_cents, platform_fee_cents, fee_mode, payment_total_cents, refunded_cents, platform_fee_refunded_cents, currency, paid_at, refunded_at, fee_policy_id, fee_policy_version)
           VALUES ($1,$2,$3,'Buyer','b@example.com',$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $5 IN ('PAID','REFUNDED') THEN now() END, CASE WHEN $5 = 'REFUNDED' THEN now() END, CASE WHEN $8::text IS NOT NULL THEN 'pol-a' END, CASE WHEN $8::text IS NOT NULL THEN 1 END)`,
          [id, o, ev, st, ps, total, fee ?? 0, mode, ptot, ref, ps === 'REFUNDED' ? fee : null, cur])
      }
    }
    org = await import('@/lib/ticketing/organiserApi')
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  it('lists only the caller organisation\'s payment-bearing orders (free orders and other tenants excluded)', async () => {
    db.org = 'org-a'
    const res = await org.handleOrganiserPayments(req())
    expect(res.status).toBe(200)
    const b = await body(res)
    expect(b.orders.map((o: any) => o.id).sort()).toEqual(['a-ab', 'a-ex', 'a-fa', 'a-hist', 'a-pe', 'a-pt', 'a-re']) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(b)).not.toMatch(/b-paid|Org B|99900/)
    db.org = 'org-b'
    const other = await body(await org.handleOrganiserPayments(req()))
    expect(other.orders.map((o: any) => o.id)).toEqual(['b-paid']) // eslint-disable-line @typescript-eslint/no-explicit-any
  })

  it('returns snapshot values exactly as stored, including the historical NULL-snapshot row', async () => {
    db.org = 'org-a'
    const b = await body(await org.handleOrganiserPayments(req()))
    const by = (id: string) => b.orders.find((o: any) => o.id === id) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(by('a-hist')).toMatchObject({ fee_mode: null, platform_fee_cents: 0, payment_total_cents: 5000, ticket_total_cents: 5000, organiser_share_before_processing_cents: 5000 })
    expect(by('a-pt')).toMatchObject({ fee_mode: 'PASS_THROUGH', platform_fee_cents: 525, payment_total_cents: 20325, organiser_share_before_processing_cents: 19800 })
    expect(by('a-ab')).toMatchObject({ fee_mode: 'ABSORB', platform_fee_cents: 525, payment_total_cents: 19800, organiser_share_before_processing_cents: 19275 })
    expect(by('a-re')).toMatchObject({ payment_state: 'REFUNDED', refunded_amount_cents: 20325, platform_fee_refunded_cents: 525 })
    expect(by('a-pe')).toMatchObject({ payment_state: 'PENDING', paid_at: null })
    expect(by('a-ex').event).toMatchObject({ id: 'ev-a2', name: 'Second A' })
  })

  it('SQL-fed aggregates equal the hand-computed figures', async () => {
    db.org = 'org-a'
    const [aud] = (await body(await org.handleOrganiserPayments(req()))).summary.currencies
    expect(aud).toMatchObject({ currency: 'AUD', paid_revenue_cents: 45125, platform_fees_cents: 1050, organiser_share_before_processing_cents: 44075, refunded_cents: 20325 })
    expect(aud.counts).toEqual({ PAID: 3, PENDING: 1, FAILED: 1, EXPIRED: 1, REFUNDED: 1 })
  })

  it('status and event filters narrow the list; the event filter also scopes the summary', async () => {
    db.org = 'org-a'
    const paid = await body(await org.handleOrganiserPayments(req('?status=PAID')))
    expect(paid.orders.map((o: any) => o.id).sort()).toEqual(['a-ab', 'a-hist', 'a-pt']) // eslint-disable-line @typescript-eslint/no-explicit-any
    const ev2 = await body(await org.handleOrganiserPayments(req('?event=ev-a2')))
    expect(ev2.orders.map((o: any) => o.id)).toEqual(['a-ex']) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ev2.summary.currencies[0].counts.EXPIRED).toBe(1)
    const foreign = await body(await org.handleOrganiserPayments(req('?event=ev-b')))
    expect(foreign.orders).toEqual([])
  })

  it('detail: own order with lines; another tenant\'s order, a free order and an unknown id are all the same 404', async () => {
    db.org = 'org-a'
    await db.pool.query(`INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active) VALUES ('tt-a','ev-a','org-a','General',9900,100,true)`)
    await db.pool.query(`INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents, discount_cents) VALUES ('org-a','a-pt','ev-a','tt-a',2,9900,0)`).catch(async () => {
      // Column set differs across migrations; fall back to the minimal shape.
      await db.pool.query(`INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents) VALUES ('org-a','a-pt','ev-a','tt-a',2,9900)`)
    })
    const ok = await org.handleOrganiserPayment(req(), 'a-pt')
    expect(ok.status).toBe(200)
    const b = await body(ok)
    expect(b.order).toMatchObject({ id: 'a-pt', payment_total_cents: 20325 })
    expect(b.lines).toEqual([{ description: 'General', quantity: 2, unit_price_cents: 9900, discount_cents: 0 }])
    for (const id of ['b-paid', 'a-free', 'does-not-exist']) {
      const res = await org.handleOrganiserPayment(req(), id)
      expect(res.status).toBe(404)
      expect(await body(res)).toEqual({ error: 'Not found.' })
    }
  })

  it('reading changes nothing', async () => {
    const snapshot = async () => JSON.stringify(await q(`SELECT * FROM event_orders ORDER BY id`))
    const before = await snapshot()
    db.org = 'org-a'
    await org.handleOrganiserPayments(req())
    await org.handleOrganiserPayment(req(), 'a-pt')
    expect(await snapshot()).toBe(before)
  })
})
