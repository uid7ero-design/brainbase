import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve Phase 3.1 order product identity.
//
// Runs the ACTUAL shared services (paidCheckout.ts, freeRegistration.ts,
// retryCheckout.ts) and the ACTUAL Stripe webhook handler (stripe.ts)
// against real PostgreSQL 17 with the real, unmodified migration set plus
// scripts/add-events-order-product-surface.sql, through the same tiny
// lib/db.ts stand-in used by eventsExpiryCasPrecisionRealPostgres.test.ts.
// Only Stripe network calls, the Connect-eligibility lookup, the CRM hooks
// and the ticket-email sender are mocked.
//
// Proves:
//   - a BRAINBASE paid / free order is stamped BRAINBASE, an EVE one EVE,
//     in the same statement as the order
//   - a missing / unknown surface never reaches the database
//   - Retry resolves the product from the COMMITTED order (the caller's
//     buildReturnUrls and Stripe metadata receive the stored value, never
//     anything about the current request) and the stamp survives it
//   - a webhook completion and a REPLAY cannot change the stamp, even when
//     the Stripe metadata claims a different product
//
// Never against Production/Preview — a disposable container, torn down
// after use. Skipped when docker is unavailable.

const CONTAINER = `events-product-surface-vitest-${process.pid}`
const HOST_PORT = 57700 + (process.pid % 1000)

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
  // Eve launch compliance - the paid order INSERT now writes the acceptance snapshot columns.
  'scripts/add-events-order-legal-acceptance.sql',
  'scripts/add-events-order-legal-notice.sql',
]

const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
const validatedFor = (ticketTypeId: string) => ({
  items: [{ ticket_type_id: ticketTypeId, quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, responses: [], ticket_type_id: ticketTypeId }], order_responses: [], promotion_code: null, access_code: null,
})
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })

describe.runIf(HAS_DOCKER)('real Postgres — Eve Phase 3.1 order product identity', () => {
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let registerFreeOrder: typeof import('@/lib/events/services/freeRegistration').registerFreeOrder
  let retryPendingOrderCheckout: typeof import('@/lib/events/services/retryCheckout').retryPendingOrderCheckout
  let processStripeWebhookEvent: typeof import('@/lib/events/stripe').processStripeWebhookEvent

  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const surfaces = async () => (await q<{ product_surface: string }>(`SELECT product_surface FROM event_orders ORDER BY created_at`)).map(r => r.product_surface)

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
         VALUES ('tt-paid', 'event-1', 'org-a', 'Premium', 2500, 1000, true), ('tt-free', 'event-1', 'org-a', 'Free', 0, 1000, true);`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)

    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    ;({ registerFreeOrder } = await import('@/lib/events/services/freeRegistration'))
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

  it('a pre-migration style order (column not named) is BRAINBASE', async () => {
    await q(`INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents) VALUES ('org-a','event-1','Old','old@example.com','CONFIRMED',0)`)
    expect(await surfaces()).toEqual(['BRAINBASE'])
  })

  it('paid checkout stamps the supplied product atomically with the order, and sends it to Stripe as metadata input', async () => {
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_bb', url: 'https://checkout.stripe.test/bb' })
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_eve', url: 'https://checkout.stripe.test/eve' })
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS })).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/bb' })
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS })).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/eve' })
    expect(await surfaces()).toEqual(['BRAINBASE', 'EVE'])
    expect((createCheckoutSessionMock.mock.calls[0][0] as { productSurface: string }).productSurface).toBe('BRAINBASE')
    expect((createCheckoutSessionMock.mock.calls[1][0] as { productSurface: string }).productSurface).toBe('EVE')
  })

  it('free registration stamps the supplied product atomically with the order', async () => {
    const bb = await registerFreeOrder({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: validatedFor('tt-free') })
    const eve = await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: validatedFor('tt-free') })
    expect(bb.ok && eve.ok).toBe(true)
    expect(await surfaces()).toEqual(['BRAINBASE', 'EVE'])
  })

  it('an unknown or missing surface is refused before any row is written', async () => {
    await expect(startPaidCheckout({ organisationId: 'org-a', productSurface: 'ADMIN' as never, event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS })).rejects.toThrow(/productSurface/)
    await expect(startPaidCheckout({ organisationId: 'org-a', event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS } as never)).rejects.toThrow(/productSurface/)
    await expect(registerFreeOrder({ organisationId: 'org-a', productSurface: 'eve' as never, event: EVENT, validated: validatedFor('tt-free') })).rejects.toThrow(/productSurface/)
    expect(await q(`SELECT 1 FROM event_orders`)).toHaveLength(0)
  })

  it('Retry resolves the product from the COMMITTED order: return URLs and Stripe input get the stored value, and the stamp survives', async () => {
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_eve_1', url: 'https://checkout.stripe.test/eve1' })
    await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS })
    const [order] = await q<{ id: string }>(`SELECT id FROM event_orders`)
    // The first attempt is dead and the hold has lapsed, so Retry may reacquire.
    await q(`UPDATE event_orders SET expires_at = NOW() - interval '1 minute' WHERE id = $1`, [order.id])
    retrieveExistingCheckoutAttemptMock.mockResolvedValue({ sessionStatus: 'expired', sessionPaymentStatus: 'unpaid', paymentIntentStatus: null })
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_eve_2', url: 'https://checkout.stripe.test/eve2' })
    const seen: string[] = []
    const res = await retryPendingOrderCheckout({
      organisationId: 'org-a', eventId: 'event-1', orderId: order.id,
      buildReturnUrls: async (_org, _event, surface) => { seen.push(surface); return { successUrl: 'https://eve.test/s', cancelUrl: 'https://eve.test/c' } },
    })
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/eve2' })
    expect(seen).toEqual(['EVE'])
    expect((createCheckoutSessionMock.mock.calls[1][0] as { productSurface: string }).productSurface).toBe('EVE')
    expect(await surfaces()).toEqual(['EVE'])
  })

  it('Retry refuses cleanly, with nothing mutated, when the order product has no return URLs available', async () => {
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_eve_x', url: 'https://checkout.stripe.test/x' })
    await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS })
    const [order] = await q<{ id: string; expires_at: Date }>(`SELECT id, expires_at FROM event_orders`)
    await q(`UPDATE event_orders SET expires_at = NOW() - interval '1 minute' WHERE id = $1`, [order.id])
    const [before] = await q<{ expires_at: Date; stripe_checkout_session_id: string }>(`SELECT expires_at, stripe_checkout_session_id FROM event_orders WHERE id = $1`, [order.id])
    createCheckoutSessionMock.mockClear()
    const res = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: order.id, buildReturnUrls: async () => null })
    expect(res).toEqual({ ok: false, code: 'RETURN_URLS_UNAVAILABLE' })
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
    const [after] = await q<{ expires_at: Date; stripe_checkout_session_id: string }>(`SELECT expires_at, stripe_checkout_session_id FROM event_orders WHERE id = $1`, [order.id])
    expect(after).toEqual(before)
  })

  it('a webhook completion and its REPLAY cannot change the product, even when the Stripe metadata names another one', async () => {
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_wh', url: 'https://checkout.stripe.test/wh' })
    await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: validatedFor('tt-paid'), buildReturnUrls: URLS })
    const [order] = await q<{ id: string }>(`SELECT id FROM event_orders`)
    const event = {
      type: 'checkout.session.completed', account: 'acct_test_org_a',
      // Hostile / stale metadata: claims BRAINBASE. The database row decides.
      data: { object: { id: 'cs_wh', payment_status: 'paid', payment_intent: 'pi_wh', metadata: { event_order_id: order.id, product_surface: 'BRAINBASE' } } },
    } as unknown as Parameters<typeof processStripeWebhookEvent>[0]
    await processStripeWebhookEvent(event)
    const [paid] = await q<{ payment_status: string; product_surface: string }>(`SELECT payment_status, product_surface FROM event_orders WHERE id = $1`, [order.id])
    expect(paid).toEqual({ payment_status: 'PAID', product_surface: 'EVE' })
    await processStripeWebhookEvent(event) // replay
    const [replayed] = await q<{ payment_status: string; product_surface: string }>(`SELECT payment_status, product_surface FROM event_orders WHERE id = $1`, [order.id])
    expect(replayed).toEqual({ payment_status: 'PAID', product_surface: 'EVE' })
  })
})
