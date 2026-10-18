import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — paid Events expiry compare-and-set
// precision (hotfix for the PR #231 generation guards).
//
// THE DEFECT: event_orders.expires_at is timestamptz (microsecond
// precision). The paid checkout and retry flows read it into JavaScript
// (the @neondatabase/serverless driver parses timestamptz into a `Date`,
// which keeps only milliseconds) and then sent that Date back as a
// compare-and-set guard: `expires_at IS NOT DISTINCT FROM ${capturedDate}`.
// Whenever the stored value has non-zero sub-millisecond digits — i.e.
// ~999 times in 1000, since it is written from NOW() — the guard can
// never match, so the success write-back, both compensating cancels and
// the retry reacquisition all silently matched zero rows.
//
// WHY REAL POSTGRES + THE REAL SERVICES: a mocked `sql` never parses a
// timestamptz, never serialises a Date parameter and never compares
// microseconds. This suite runs the ACTUAL shared services
// (lib/events/services/paidCheckout.ts, retryCheckout.ts) and the
// ACTUAL webhook handler (lib/events/stripe.ts) against a real
// Postgres, through a tiny adapter standing in for lib/db.ts's
// tagged-template `sql` / `sql.transaction([...])`. The adapter uses
// node-postgres configured with @neondatabase/serverless's OWN `types`
// registry, so timestamptz values come back exactly as the production
// driver returns them (a millisecond `Date`), and parameters are
// serialised by the same pg prepareValue logic Neon vendors. Only
// Stripe network calls and the Connect-eligibility lookup are mocked.
// Schema is the real, unmodified migration set.
//
// Never against Production/Preview — a disposable container, torn down
// after use. Skipped when docker is unavailable (same idiom as
// eventsResendWebhookDeliveryRealPostgres.test.ts).

const CONTAINER = `events-expiry-cas-vitest-${process.pid}`
const HOST_PORT = 56600 + (process.pid % 1000)

function dockerAvailable(): boolean {
  try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false }
}
const HAS_DOCKER = dockerAvailable()

// ── lib/db.ts stand-in over a real pg Pool ─────────────────────────────
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
  // Same contract as @neondatabase/serverless's non-interactive
  // transaction: every statement runs in order in ONE transaction, each
  // with its own READ COMMITTED snapshot; resolves to each statement's rows.
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

vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: vi.fn(async () => ({ eligible: true, accountId: 'acct_test_org_a' })),
}))
vi.mock('@/lib/crm/eventSync', () => ({
  syncEventOrderContact: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivity: vi.fn().mockResolvedValue(undefined),
  recordEventBookingActivityForOrder: vi.fn().mockResolvedValue(undefined),
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
  'scripts/add-events-booking-wallet.sql',
  'scripts/add-events-ticket-email-delivery.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  // Phase 5A — the cart load now resolves ticketing_fee_policies in its
  // single query, so every live-service harness must carry the table.
  'scripts/create-events-ticketing-fees-foundation.sql',
  // Eve Phase 3.1 - the order INSERTs now write product_surface.
  'scripts/add-events-order-product-surface.sql',
]

const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
const VALIDATED = {
  // Phase 2 (PR #429): the validated registration carries a cart of
  // items; this suite keeps a single one-ticket line so the guards are
  // exercised exactly as the hotfix exercised them.
  items: [{ ticket_type_id: 'tt-paid', quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, responses: [], ticket_type_id: 'tt-paid' }], order_responses: [], promotion_code: null, access_code: null,
}
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })
const RETRY_URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })

describe.runIf(HAS_DOCKER)('real Postgres — paid expiry compare-and-set precision (hotfix)', () => {
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let retryPendingOrderCheckout: typeof import('@/lib/events/services/retryCheckout').retryPendingOrderCheckout
  let processStripeWebhookEvent: typeof import('@/lib/events/stripe').processStripeWebhookEvent

  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]

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
      // The production driver's own type registry: timestamptz -> ms Date.
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
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
         VALUES ('event-1', 'org-a', 'Gala', 'gala', 'PUBLISHED', '2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z', 'Australia/Adelaide');`,
      `INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
         VALUES ('tt-paid', 'event-1', 'org-a', 'Premium', 2500, 100, true);`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)

    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    ;({ retryPendingOrderCheckout } = await import('@/lib/events/services/retryCheckout'))
    ;({ processStripeWebhookEvent } = await import('@/lib/events/stripe'))
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    createCheckoutSessionMock.mockReset()
    expireCheckoutSessionMock.mockReset().mockResolvedValue(undefined)
    retrieveExistingCheckoutAttemptMock.mockReset()
    await q(`DELETE FROM event_orders`)
  })

  // Seeds a PENDING paid order whose expires_at deliberately carries
  // non-zero sub-millisecond digits (as every NOW()-derived value almost
  // always does), already lapsed so a retry may reacquire it.
  async function seedPendingOrder(opts: { sessionId?: string | null } = {}) {
    const [order] = await q<{ id: string }>(`
      INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id, stripe_checkout_session_id)
      VALUES ('org-a', 'event-1', 'Jane', 'jane@example.com', 'PENDING', 2500, 'PENDING', 'stripe', 'AUD', NOW() - interval '1 minute' + interval '0.000437 seconds', 'acct_test_org_a', $1)
      RETURNING id`, [opts.sessionId ?? null])
    const [item] = await q<{ id: string }>(`
      INSERT INTO event_order_items (organisation_id, order_id, event_id, ticket_type_id, quantity, unit_price_cents)
      VALUES ('org-a', $1, 'event-1', 'tt-paid', 1, 2500) RETURNING id`, [order.id])
    await q(`INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name) VALUES ('org-a', 'event-1', $1, $2, 'Jane')`, [order.id, item.id])
    return order.id
  }
  const orderRow = async (id: string) => (await q<{ status: string; payment_status: string; stripe_checkout_session_id: string | null }>(
    `SELECT status, payment_status, stripe_checkout_session_id FROM event_orders WHERE id = $1`, [id]))[0]

  it('A. reproduction — a microsecond expires_at read through the production driver comes back as a millisecond Date, and the old `expires_at IS NOT DISTINCT FROM <Date>` guard matches nothing', async () => {
    const id = await seedPendingOrder()
    const [raw] = await q<{ us: string; expires_at: Date }>(`SELECT (extract(epoch FROM expires_at) * 1000000)::bigint::text AS us, expires_at FROM event_orders WHERE id = $1`, [id])
    expect(Number(raw.us) % 1000).not.toBe(0) // the DB value has sub-ms digits
    expect(raw.expires_at).toBeInstanceOf(Date) // the driver hands JS a Date...
    expect(raw.expires_at.getTime() * 1000).not.toBe(Number(raw.us)) // ...that has lost them
    const oldGuard = await q(`UPDATE event_orders SET status = status WHERE id = $1 AND expires_at IS NOT DISTINCT FROM $2 RETURNING id`, [id, raw.expires_at])
    expect(oldGuard).toHaveLength(0) // the PR #231 guard shape can never match this row
    const stampGuard = await q(`UPDATE event_orders SET status = status WHERE id = $1 AND (extract(epoch FROM expires_at) * 1000000)::bigint IS NOT DISTINCT FROM $2::bigint RETURNING id`, [id, raw.us])
    expect(stampGuard).toHaveLength(1) // a database-normalised stamp matches exactly
  })

  it('B. paid checkout — the Stripe Checkout Session id is written back (CAS still applied)', async () => {
    createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_b', url: 'https://checkout.stripe.test/b' })
    const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: VALIDATED, buildReturnUrls: URLS })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/b' })
    const [row] = await q<{ stripe_checkout_session_id: string; status: string }>(`SELECT stripe_checkout_session_id, status FROM event_orders`)
    expect(row).toEqual({ stripe_checkout_session_id: 'cs_test_b', status: 'PENDING' })
    expect(expireCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('C. paid checkout — a Stripe creation failure releases the reservation (compensating cancel matches)', async () => {
    createCheckoutSessionMock.mockRejectedValue(new Error('stripe down'))
    const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: VALIDATED, buildReturnUrls: URLS })
    expect(res).toEqual({ ok: false, code: 'STRIPE_FAILED' })
    const [row] = await q<{ status: string; payment_status: string }>(`SELECT status, payment_status FROM event_orders`)
    expect(row).toEqual({ status: 'CANCELLED', payment_status: 'FAILED' })
  })

  it('D. retry — reacquires a lapsed PENDING order and writes back the new session', async () => {
    const id = await seedPendingOrder()
    createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_d', url: 'https://checkout.stripe.test/d' })
    const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: id, buildReturnUrls: RETRY_URLS })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/d' })
    expect((await orderRow(id)).stripe_checkout_session_id).toBe('cs_test_d')
  })

  it('E. two concurrent retries of the same order (no prior session) — exactly one winner, one Stripe session', async () => {
    const id = await seedPendingOrder()
    let n = 0
    createCheckoutSessionMock.mockImplementation(async () => {
      const k = ++n
      await new Promise(r => setTimeout(r, 50))
      return { sessionId: `cs_test_e${k}`, url: `https://checkout.stripe.test/e${k}` }
    })
    const [r1, r2] = await Promise.all([
      retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: id, buildReturnUrls: RETRY_URLS }),
      retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: id, buildReturnUrls: RETRY_URLS }),
    ])
    // Exactly one request ends up owning the order's Checkout Session.
    // The other either loses the reacquisition CAS outright
    // (CAPACITY_UNAVAILABLE) or — when it read the order only after the
    // winner's reacquisition committed — loses the write-back CAS and
    // its just-created session is expired as an orphan
    // (WRITE_BACK_RACE_LOST). Both are the PR #231 contract: never two
    // live, payable sessions for one order.
    const winners = [r1, r2].filter(r => r.ok)
    expect(winners).toHaveLength(1)
    const loser = [r1, r2].find(r => !r.ok)
    expect(['CAPACITY_UNAVAILABLE', 'WRITE_BACK_RACE_LOST']).toContain((loser as { code: string }).code)
    const created = createCheckoutSessionMock.mock.results.length
    const stored = (await orderRow(id)).stripe_checkout_session_id
    const winnerUrl = (winners[0] as { checkoutUrl: string }).checkoutUrl
    expect(stored).toBe(winnerUrl.replace('https://checkout.stripe.test/', 'cs_test_'))
    // Every session that was created but not stored was expired.
    expect(expireCheckoutSessionMock).toHaveBeenCalledTimes(created - 1)
    for (const call of expireCheckoutSessionMock.mock.calls) expect(call[0]).not.toBe(stored)
  })

  it('F/G. original checkout vs Retry — a Retry landing during checkout\'s Stripe call wins; checkout\'s stale write-back is rejected and its orphan session expired', async () => {
    createCheckoutSessionMock.mockImplementationOnce(async (input: { orderId: string }) => {
      // The manager Retry lands while the original checkout's Stripe
      // call is in flight (same window PR #231 closed).
      const retry = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: input.orderId, buildReturnUrls: RETRY_URLS })
      expect(retry.ok).toBe(true)
      return { sessionId: 'cs_test_original', url: 'https://checkout.stripe.test/original' }
    })
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_test_retry', url: 'https://checkout.stripe.test/retry' })
    const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: VALIDATED, buildReturnUrls: URLS })
    expect(res).toEqual({ ok: false, code: 'WRITE_BACK_RACE_LOST' })
    expect(expireCheckoutSessionMock).toHaveBeenCalledWith('cs_test_original', 'acct_test_org_a')
    const [row] = await q<{ stripe_checkout_session_id: string; status: string }>(`SELECT stripe_checkout_session_id, status FROM event_orders`)
    expect(row).toEqual({ stripe_checkout_session_id: 'cs_test_retry', status: 'PENDING' }) // the newer generation is intact
  })

  it('G. a stale generation stamp no longer matches once a retry has advanced the order', async () => {
    const id = await seedPendingOrder()
    const [before] = await q<{ us: string }>(`SELECT (extract(epoch FROM expires_at) * 1000000)::bigint::text AS us FROM event_orders WHERE id = $1`, [id])
    createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_g', url: 'https://checkout.stripe.test/g' })
    expect((await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: id, buildReturnUrls: RETRY_URLS })).ok).toBe(true)
    const stale = await q(`UPDATE event_orders SET stripe_checkout_session_id = 'cs_stale' WHERE id = $1 AND (extract(epoch FROM expires_at) * 1000000)::bigint IS NOT DISTINCT FROM $2::bigint RETURNING id`, [id, before.us])
    expect(stale).toHaveLength(0)
    expect((await orderRow(id)).stripe_checkout_session_id).toBe('cs_test_g')
  })

  it('H. an old session\'s delayed checkout.session.expired webhook is a no-op after a retry moved the order to a new session', async () => {
    const id = await seedPendingOrder({ sessionId: 'cs_test_old' })
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })
    createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_new', url: 'https://checkout.stripe.test/new' })
    expect((await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: id, buildReturnUrls: RETRY_URLS })).ok).toBe(true)
    await processStripeWebhookEvent({
      type: 'checkout.session.expired', account: 'acct_test_org_a',
      data: { object: { id: 'cs_test_old', metadata: { event_order_id: id } } },
    } as unknown as Parameters<typeof processStripeWebhookEvent>[0])
    expect(await orderRow(id)).toEqual({ status: 'PENDING', payment_status: 'PENDING', stripe_checkout_session_id: 'cs_test_new' })
  })

  it('retry still blocks when Stripe reports the prior attempt is still active (decision matrix unchanged)', async () => {
    const id = await seedPendingOrder({ sessionId: 'cs_test_active' })
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'open', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })
    const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: id, buildReturnUrls: RETRY_URLS })
    expect(res).toEqual({ ok: false, code: 'RETRY_BLOCKED', decision: 'UNSAFE_STILL_ACTIVE' })
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    expect((await orderRow(id)).stripe_checkout_session_id).toBe('cs_test_active')
  })
})
