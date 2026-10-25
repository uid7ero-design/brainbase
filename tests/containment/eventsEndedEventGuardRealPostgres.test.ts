import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — the ended-event registration guard.
//
// Runs the ACTUAL shared services (freeRegistration.ts, paidCheckout.ts,
// retryCheckout.ts, cart.ts) against real PostgreSQL 17 with the real
// migration set, through the same lib/db.ts stand-in as
// eventsOrderProductSurfaceRealPostgres.test.ts. Only Stripe network calls,
// the Connect-eligibility lookup, the CRM hooks and the ticket-email sender
// are mocked.
//
// Proves, at the database's own NOW():
//   - not started / in progress: free and paid bookings succeed as before
//   - ended: free, paid and retry all refuse with EVENT_ENDED — no order,
//     item, attendee or response row, no reservation transaction opened, no
//     Stripe call — even when the ticket type's own sale window is open
//   - ticket sale windows still apply unchanged while the event is live
//   - the locked reservation gate re-asserts it: an event that ends between
//     the pre-check and the reservation still inserts nothing
//   - the database session timezone (here UTC+14) never moves the boundary
//
// Never against Production/Preview — a disposable container, torn down
// after use. Skipped when docker is unavailable.

const CONTAINER = `events-ended-guard-vitest-${process.pid}`
// Outside every Windows excluded TCP range seen on the dev machines (the
// 58806+ / 59025+ / 60046+ blocks have broken other real-PG suites).
const HOST_PORT = 55100 + (process.pid % 600)

function dockerAvailable(): boolean {
  try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false }
}
const HAS_DOCKER = dockerAvailable()

const db = vi.hoisted(() => ({
  pool: null as unknown as import('pg').Pool,
  transactions: 0,
  // Runs at the start of every sql.transaction — used to end an event
  // between the cart pre-check and the locked reservation statement.
  beforeTransaction: null as null | (() => Promise<void>),
}))

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
    db.transactions++
    if (db.beforeTransaction) await db.beforeTransaction()
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

vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: vi.fn(async () => ({ eligible: true, accountId: 'acct_test_org_a' })),
}))
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivity: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/events/ticketEmailDelivery', () => ({
  attemptAutomaticTicketEmail: vi.fn().mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-test' }),
}))
const createCheckoutSessionMock = vi.fn()
const expireCheckoutSessionMock = vi.fn()
const retrieveExistingCheckoutAttemptMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a),
    expireCheckoutSession: (...a: unknown[]) => expireCheckoutSessionMock(...a),
    retrieveExistingCheckoutAttempt: (...a: unknown[]) => retrieveExistingCheckoutAttemptMock(...a),
  }
})

const MIGRATIONS = [
  'scripts/create-events.sql',
  'scripts/create-events-phase2.sql',
  'scripts/add-events-ticketing.sql',
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

// Only id is read by the services' SQL; the rest satisfies PublicEvent.
const eventFor = (id: string) => ({
  id, organisation_id: 'org-a', name: id, slug: id, description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide',
})
const validatedFor = (ticketTypeId: string) => ({
  items: [{ ticket_type_id: ticketTypeId, quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, responses: [], ticket_type_id: ticketTypeId }], order_responses: [], promotion_code: null, access_code: null,
})
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })

describe.runIf(HAS_DOCKER)('real Postgres — ended-event registration guard', () => {
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let registerFreeOrder: typeof import('@/lib/events/services/freeRegistration').registerFreeOrder
  let retryPendingOrderCheckout: typeof import('@/lib/events/services/retryCheckout').retryPendingOrderCheckout
  let loadCartTicketTypes: typeof import('@/lib/events/services/cart').loadCartTicketTypes

  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const counts = async () => (await q<Record<string, number>>(`
    SELECT (SELECT count(*)::int FROM event_orders) AS orders, (SELECT count(*)::int FROM event_order_items) AS items,
           (SELECT count(*)::int FROM event_attendees) AS attendees, (SELECT count(*)::int FROM event_registration_responses) AS responses
  `))[0]
  const free = (eventId: string, tt: string) => registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: eventFor(eventId), validated: validatedFor(tt) })
  const paid = (eventId: string, tt: string) => startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: eventFor(eventId), validated: validatedFor(tt), buildReturnUrls: URLS })

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
      // A session timezone 14 hours ahead of UTC: the guard compares
      // instants, so this must change nothing.
      options: '-c TimeZone=Pacific/Kiritimati',
      types: neonTypes as unknown as import('pg').CustomTypesConfig,
    })
    const schema = [
      `CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);`,
      `CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE CASCADE, username TEXT UNIQUE, name TEXT);`,
      ...MIGRATIONS.map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')),
      `CREATE TABLE audit_logs (
        id text NOT NULL PRIMARY KEY, organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        user_id text NULL REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text NOT NULL,
        resource_id text NULL, before_state jsonb NULL, after_state jsonb NULL, ip_address text NULL, user_agent text NULL,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
      `INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)

    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    ;({ registerFreeOrder } = await import('@/lib/events/services/freeRegistration'))
    ;({ retryPendingOrderCheckout } = await import('@/lib/events/services/retryCheckout'))
    ;({ loadCartTicketTypes } = await import('@/lib/events/services/cart'))
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    createCheckoutSessionMock.mockReset().mockResolvedValue({ sessionId: 'cs_test', url: 'https://checkout.stripe.test/x' })
    expireCheckoutSessionMock.mockReset().mockResolvedValue(undefined)
    retrieveExistingCheckoutAttemptMock.mockReset()
    db.beforeTransaction = null
    await q(`DELETE FROM event_orders`)
    await q(`DELETE FROM event_ticket_types`)
    await q(`DELETE FROM events`)
    // Every time relative to the database clock.
    await q(`INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
      ('ev-future', 'org-a', 'Future', 'future', 'PUBLISHED', NOW() + interval '30 days', NOW() + interval '30 days 2 hours', 'Australia/Adelaide'),
      ('ev-live',   'org-a', 'Live',   'live',   'PUBLISHED', NOW() - interval '1 hour',  NOW() + interval '1 hour',          'Australia/Adelaide'),
      ('ev-ended',  'org-a', 'Ended',  'ended',  'PUBLISHED', NOW() - interval '3 hours', NOW() - interval '1 minute',        'Australia/Adelaide')`)
    await q(`INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active, sale_starts_at, sale_ends_at) VALUES
      ('future-free', 'ev-future', 'org-a', 'Free', 0, 100, true, NULL, NULL),
      ('live-free',   'ev-live',   'org-a', 'Free', 0, 100, true, NULL, NULL),
      ('live-paid',   'ev-live',   'org-a', 'Paid', 2500, 100, true, NULL, NULL),
      ('live-sale-closed', 'ev-live', 'org-a', 'Closed', 0, 100, true, NULL, NOW() - interval '1 minute'),
      ('ended-free',  'ev-ended',  'org-a', 'Free', 0, 100, true, NULL, NULL),
      ('ended-paid',  'ev-ended',  'org-a', 'Paid', 2500, 100, true, NULL, NULL),
      ('ended-sale-open', 'ev-ended', 'org-a', 'Open', 0, 100, true, NOW() - interval '1 day', NOW() + interval '1 year')`)
    db.transactions = 0
  })

  it('the database session really is UTC+14 (the boundary must not care)', async () => {
    expect((await q<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`))[0].tz).toBe('Pacific/Kiritimati')
  })

  it('event not started: a free booking succeeds exactly as before', async () => {
    expect((await free('ev-future', 'future-free')).ok).toBe(true)
    expect((await counts()).orders).toBe(1)
  })

  it('event in progress: free and paid both succeed (paid reaches Stripe once)', async () => {
    expect((await free('ev-live', 'live-free')).ok).toBe(true)
    expect(await paid('ev-live', 'live-paid')).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/x' })
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1)
    expect((await counts()).orders).toBe(2)
  })

  it('event ended: free registration is EVENT_ENDED — no rows, no reservation transaction', async () => {
    expect(await free('ev-ended', 'ended-free')).toEqual({ ok: false, code: 'EVENT_ENDED' })
    expect(await counts()).toEqual({ orders: 0, items: 0, attendees: 0, responses: 0 })
    expect(db.transactions).toBe(0)
  })

  it('event ended: paid checkout is EVENT_ENDED — no rows, no transaction, no Stripe call', async () => {
    expect(await paid('ev-ended', 'ended-paid')).toEqual({ ok: false, code: 'EVENT_ENDED' })
    expect(await counts()).toEqual({ orders: 0, items: 0, attendees: 0, responses: 0 })
    expect(db.transactions).toBe(0)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('event ended: an open ticket sale window does not reopen it', async () => {
    expect(await free('ev-ended', 'ended-sale-open')).toEqual({ ok: false, code: 'EVENT_ENDED' })
    expect((await counts()).orders).toBe(0)
  })

  it('event live: a closed ticket sale window still refuses as SALE_ENDED (unchanged)', async () => {
    expect(await free('ev-live', 'live-sale-closed')).toEqual({ ok: false, code: 'SALE_ENDED' })
  })

  it('the quote path (cart loader) reports EVENT_ENDED too', async () => {
    expect(await loadCartTicketTypes('org-a', 'ev-ended', [{ ticket_type_id: 'ended-free', quantity: 1 }])).toEqual({ ok: false, code: 'EVENT_ENDED' })
    expect((await loadCartTicketTypes('org-a', 'ev-live', [{ ticket_type_id: 'live-free', quantity: 1 }])).ok).toBe(true)
  })

  it('tenant scoping: another organisation cannot see the event at all (TICKET_TYPE_NOT_FOUND, not a leak of its state)', async () => {
    expect(await loadCartTicketTypes('org-b', 'ev-ended', [{ ticket_type_id: 'ended-free', quantity: 1 }])).toEqual({ ok: false, code: 'TICKET_TYPE_NOT_FOUND' })
  })

  it('retry of a pending order on an ended event is EVENT_ENDED before any lock or Stripe call', async () => {
    const r = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'ev-ended', orderId: 'any-order', buildReturnUrls: URLS })
    expect(r).toEqual({ ok: false, code: 'EVENT_ENDED' })
    expect(db.transactions).toBe(0)
    expect(retrieveExistingCheckoutAttemptMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('the locked gate re-asserts it: an event that ends after the pre-check still inserts nothing (free)', async () => {
    db.beforeTransaction = async () => { await q(`UPDATE events SET ends_at = NOW() - interval '1 second' WHERE id = 'ev-live'`) }
    const r = await free('ev-live', 'live-free')
    expect(r.ok).toBe(false)
    expect(db.transactions).toBe(1)
    expect(await counts()).toEqual({ orders: 0, items: 0, attendees: 0, responses: 0 })
  })

  it('the locked gate re-asserts it: an event that ends after the pre-check still reserves nothing and never reaches Stripe (paid)', async () => {
    db.beforeTransaction = async () => { await q(`UPDATE events SET ends_at = NOW() - interval '1 second' WHERE id = 'ev-live'`) }
    const r = await paid('ev-live', 'live-paid')
    expect(r.ok).toBe(false)
    expect(await counts()).toEqual({ orders: 0, items: 0, attendees: 0, responses: 0 })
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('an event with no end time keeps existing behaviour (bookable)', async () => {
    // events.ends_at is NOT NULL in the live schema; drop it here only to
    // prove the guard's NULL branch (both the pre-check and the gate).
    await q(`ALTER TABLE events ALTER COLUMN ends_at DROP NOT NULL`)
    try {
      await q(`UPDATE events SET ends_at = NULL WHERE id = 'ev-live'`)
      expect((await free('ev-live', 'live-free')).ok).toBe(true)
    } finally {
      await q(`UPDATE events SET ends_at = NOW() + interval '1 hour' WHERE id = 'ev-live'`)
      await q(`ALTER TABLE events ALTER COLUMN ends_at SET NOT NULL`)
    }
  })
})
