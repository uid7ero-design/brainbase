import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve launch compliance schema gate:
//   A. scripts/add-events-order-legal-acceptance.sql  (paid-purchase acceptance snapshot)
//   B. scripts/add-events-notification-event-updated.sql (EVENT_UPDATED + payload)
// and the application code that uses them (paid checkout stamping, the event
// PATCH route's material-change notice, delivery and the email).
//
// Two separate migration artifacts, each applied TWICE to prove idempotency.
// Never against Production/Preview — a disposable container, torn down after
// use. Skipped when docker is unavailable.

const CONTAINER = `eve-launch-compliance-vitest-${process.pid}`
const HOST_PORT = 57600 + (process.pid % 1000)

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
vi.mock('@/lib/events/authorize', () => ({
  authorizeEventsRequest: vi.fn(async () => ({ ok: true, session: { organisationId: 'org-a', userId: 'user-1' } })),
}))
const createCheckoutSessionMock = vi.fn()
const expireCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return {
    ...actual,
    createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a),
    expireCheckoutSession: (...a: unknown[]) => expireCheckoutSessionMock(...a),
  }
})

// Everything BEFORE the two new migrations (they are applied separately below).
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
  'scripts/create-events-ticket-email-deliveries.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  'scripts/create-events-ticketing-fees-foundation.sql',
  'scripts/create-events-notifications.sql',
  'scripts/add-events-order-product-surface.sql',
]
const MIGRATION_A = 'scripts/add-events-order-legal-acceptance.sql'
const MIGRATION_B = 'scripts/add-events-notification-event-updated.sql'
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')

const EVE_BASE = 'https://eve-preview.vercel.app'
const EVE_FROM = 'Eve <tickets@mail.eve-preview.dev>'
const T1 = '2030-01-01T10:00:00.000Z'
const T1_END = '2030-01-01T12:00:00.000Z'
const T2 = '2030-02-02T10:00:00.000Z'
const T2_END = '2030-02-02T12:00:00.000Z'

const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: 'Town Hall',
  artwork_url: null, starts_at: T1, ends_at: T1_END, timezone: 'Australia/Adelaide',
}
const VALIDATED = {
  items: [{ ticket_type_id: 'tt-paid', quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, responses: [], ticket_type_id: 'tt-paid' }], order_responses: [], promotion_code: null, access_code: null,
}
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })

type Sent = { from: string; to: string; subject: string; html: string; text?: string }

describe.runIf(HAS_DOCKER)('real Postgres — Eve launch compliance schema gate (A: acceptance snapshot, B: EVENT_UPDATED)', () => {
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let retryPendingOrderCheckout: typeof import('@/lib/events/services/retryCheckout').retryPendingOrderCheckout
  let PATCH: typeof import('@/app/api/events/[id]/route').PATCH
  let scheduleEventUpdatedNotifications: typeof import('@/lib/events/notifications').scheduleEventUpdatedNotifications
  let attemptNotificationDelivery: typeof import('@/lib/events/notificationDelivery').attemptNotificationDelivery
  let findNotificationRecoveryCandidateIds: typeof import('@/lib/events/notificationRecovery').findNotificationRecoveryCandidateIds
  let currentEveLegalAcceptance: typeof import('@ticketing/core').currentEveLegalAcceptance

  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const sent: Sent[] = []
  const realFetch = globalThis.fetch

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
      `INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');`,
      `INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'u1', 'User One');`,
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone, venue)
         VALUES ('event-1', 'org-a', 'Gala', 'gala', 'PUBLISHED', '${T1}', '${T1_END}', 'Australia/Adelaide', 'Town Hall');`,
      `INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
         VALUES ('tt-paid', 'event-1', 'org-a', 'Premium', 2500, 100, true);`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)

    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    ;({ retryPendingOrderCheckout } = await import('@/lib/events/services/retryCheckout'))
    ;({ PATCH } = await import('@/app/api/events/[id]/route'))
    ;({ scheduleEventUpdatedNotifications } = await import('@/lib/events/notifications'))
    ;({ attemptNotificationDelivery } = await import('@/lib/events/notificationDelivery'))
    ;({ findNotificationRecoveryCandidateIds } = await import('@/lib/events/notificationRecovery'))
    ;({ currentEveLegalAcceptance } = await import('@ticketing/core'))
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    sent.length = 0
    createCheckoutSessionMock.mockReset()
    expireCheckoutSessionMock.mockReset().mockResolvedValue(undefined)
    await q(`DELETE FROM event_notifications`)
    await q(`DELETE FROM event_orders`)
    await q(`DELETE FROM audit_logs`)
    await q(`UPDATE events SET status = 'PUBLISHED', starts_at = $1, ends_at = $2, venue = 'Town Hall', description = NULL, name = 'Gala', timezone = 'Australia/Adelaide'`, [T1, T1_END])
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
    vi.stubEnv('EVE_EMAIL_FROM', EVE_FROM)
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      if (String(url) !== 'https://api.resend.com/emails') return realFetch(url as never, init as never)
      sent.push(JSON.parse(init?.body ?? '{}') as Sent)
      return new Response(JSON.stringify({ id: `msg-${sent.length}` }), { status: 200 })
    }) as typeof fetch
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    globalThis.fetch = realFetch
  })

  // ── helpers ────────────────────────────────────────────────────────────
  async function seedOrder(opts: {
    surface?: 'BRAINBASE' | 'EVE'; status?: string; payment?: string; email?: string | null; name?: string;
  } = {}): Promise<string> {
    const [row] = await q<{ id: string }>(`
      INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, payment_provider, currency, product_surface)
      VALUES ('org-a', 'event-1', $1, $2, $3, 0, $4, 'stripe', 'AUD', $5) RETURNING id`,
      [opts.name ?? 'Buyer', opts.email === undefined ? `buyer-${Math.random().toString(36).slice(2)}@example.com` : opts.email, opts.status ?? 'CONFIRMED', opts.payment ?? 'PAID', opts.surface ?? 'BRAINBASE'])
    return row.id
  }

  async function patch(body: Record<string, unknown>) {
    const req = new Request('http://localhost/api/events/event-1', { method: 'PATCH', body: JSON.stringify(body) })
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'event-1' }) })
    return { status: res.status, json: await res.json() as Record<string, unknown> }
  }
  const updatedRows = (orderId?: string) => q<{ id: string; order_id: string; idempotency_key: string; status: string; payload: Record<string, unknown> | null; recipient_email: string }>(
    `SELECT id, order_id, idempotency_key, status, payload, recipient_email FROM event_notifications WHERE notification_type = 'EVENT_UPDATED' ${orderId ? 'AND order_id = $1' : ''} ORDER BY created_at, id`,
    orderId ? [orderId] : [])

  // ── Migration A ────────────────────────────────────────────────────────
  describe('A. paid-purchase legal acceptance snapshot', () => {
    it('applies cleanly, twice (idempotent), leaving existing rows NULL', async () => {
      const historic = await seedOrder()
      await db.pool.query(read(MIGRATION_A))
      await db.pool.query(read(MIGRATION_A))
      const cols = await q<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'event_orders' AND column_name IN ('terms_accepted_at','terms_version','refunds_version') ORDER BY column_name`)
      expect(cols).toEqual([
        { column_name: 'refunds_version', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'terms_accepted_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
        { column_name: 'terms_version', data_type: 'text', is_nullable: 'YES' },
      ])
      const cons = await q(`SELECT conname FROM pg_constraint WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_legal_acceptance_check'`)
      expect(cons).toHaveLength(1) // exactly one, not duplicated by the second run
      const [row] = await q(`SELECT terms_accepted_at, terms_version, refunds_version FROM event_orders WHERE id = $1`, [historic])
      expect(row).toEqual({ terms_accepted_at: null, terms_version: null, refunds_version: null })
    })

    it('the CHECK makes a half-stamped row unrepresentable (all NULL or all set)', async () => {
      const id = await seedOrder()
      for (const [set, label] of [
        [`terms_accepted_at = NOW()`, 'timestamp only'],
        [`terms_version = 'v1'`, 'terms only'],
        [`terms_version = 'v1', refunds_version = 'v1'`, 'versions without a timestamp'],
        [`terms_accepted_at = NOW(), terms_version = 'v1'`, 'missing refunds version'],
      ] as const) {
        await expect(q(`UPDATE event_orders SET ${set} WHERE id = $1`, [id]), label).rejects.toThrow(/event_orders_legal_acceptance_check/)
      }
      await q(`UPDATE event_orders SET terms_accepted_at = NOW(), terms_version = 'v1', refunds_version = 'v1' WHERE id = $1`, [id])
      await q(`UPDATE event_orders SET terms_accepted_at = NULL, terms_version = NULL, refunds_version = NULL WHERE id = $1`, [id])
    })

    it('Eve paid checkout stamps all three in the order INSERT: DB-generated time, server-constant versions', async () => {
      createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_a1', url: 'https://checkout.stripe.test/a1' })
      const before = Date.now()
      const res = await startPaidCheckout({
        organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: VALIDATED, buildReturnUrls: URLS,
        legalAcceptance: currentEveLegalAcceptance(),
      })
      expect(res.ok).toBe(true)
      const [row] = await q<{ terms_accepted_at: Date; terms_version: string; refunds_version: string; product_surface: string }>(
        `SELECT terms_accepted_at, terms_version, refunds_version, product_surface FROM event_orders`)
      const expected = currentEveLegalAcceptance()
      expect(row.terms_version).toBe(expected.termsVersion)
      expect(row.refunds_version).toBe(expected.refundsVersion)
      expect(row.product_surface).toBe('EVE')
      const at = row.terms_accepted_at.getTime()
      expect(at).toBeGreaterThanOrEqual(before - 5000)
      expect(at).toBeLessThanOrEqual(Date.now() + 5000)
    })

    it('BrainBase paid checkout (no legalAcceptance) leaves all three NULL — no acceptance imposed', async () => {
      createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_a2', url: 'https://checkout.stripe.test/a2' })
      const res = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT, validated: VALIDATED, buildReturnUrls: URLS })
      expect(res.ok).toBe(true)
      const [row] = await q(`SELECT terms_accepted_at, terms_version, refunds_version FROM event_orders`)
      expect(row).toEqual({ terms_accepted_at: null, terms_version: null, refunds_version: null })
    })

    it('a Stripe failure that cancels the order keeps its snapshot; a retry never re-stamps or alters it', async () => {
      createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_a3', url: 'https://checkout.stripe.test/a3' })
      await startPaidCheckout({
        organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: VALIDATED, buildReturnUrls: URLS,
        legalAcceptance: currentEveLegalAcceptance(),
      })
      const [orig] = await q<{ id: string; terms_accepted_at: Date }>(`SELECT id, terms_accepted_at FROM event_orders`)
      // Lapse the reservation so a retry may reacquire it, then retry.
      await q(`UPDATE event_orders SET expires_at = NOW() - interval '1 minute', stripe_checkout_session_id = NULL WHERE id = $1`, [orig.id])
      createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_a3b', url: 'https://checkout.stripe.test/a3b' })
      const retry = await retryPendingOrderCheckout({ organisationId: 'org-a', eventId: 'event-1', orderId: orig.id, buildReturnUrls: URLS })
      expect(retry.ok).toBe(true)
      const [after] = await q<{ terms_accepted_at: Date; terms_version: string; refunds_version: string }>(
        `SELECT terms_accepted_at, terms_version, refunds_version FROM event_orders WHERE id = $1`, [orig.id])
      expect(after.terms_accepted_at.getTime()).toBe(orig.terms_accepted_at.getTime())
      expect(after.terms_version).toBe(currentEveLegalAcceptance().termsVersion)
      expect(after.refunds_version).toBe(currentEveLegalAcceptance().refundsVersion)
    })
  })

  // ── Migration B ────────────────────────────────────────────────────────
  describe('B. EVENT_UPDATED notification type + payload', () => {
    it('applies cleanly, twice, keeps existing rows (payload NULL) and the four old types', async () => {
      const oid = await seedOrder({ payment: 'NOT_REQUIRED' })
      await q(`INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key)
               VALUES ('org-a', 'event-1', $1, 'EVENT_CANCELLED', 'x@example.com', 'event-notification:EVENT_CANCELLED:' || $1)`, [oid])
      await db.pool.query(read(MIGRATION_B))
      await db.pool.query(read(MIGRATION_B))
      const [old] = await q<{ payload: unknown }>(`SELECT payload FROM event_notifications WHERE order_id = $1`, [oid])
      expect(old.payload).toBeNull()
      const defs = await q<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'event_notifications'::regclass AND conname IN ('event_notifications_type_check','event_notifications_payload_object_check') ORDER BY conname`)
      expect(defs.map(d => d.conname)).toEqual(['event_notifications_payload_object_check', 'event_notifications_type_check'])
      for (const t of ['ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER', 'EVENT_UPDATED']) {
        expect(defs[1].def).toContain(t)
      }
    })

    it('the type CHECK accepts EVENT_UPDATED and rejects unknown types; payload must be a JSON object or NULL', async () => {
      const oid = await seedOrder()
      const ins = (type: string, payload: string | null, key: string) => q(
        `INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key, payload)
         VALUES ('org-a', 'event-1', $1, $2, 'x@example.com', $3, $4::jsonb)`, [oid, type, key, payload])
      await ins('EVENT_UPDATED', '{"a":1}', 'k1')
      await ins('EVENT_UPDATED', null, 'k2')
      await expect(ins('EVENT_DELETED', null, 'k3')).rejects.toThrow(/event_notifications_type_check/)
      await expect(ins('EVENT_UPDATED', '[1,2]', 'k4')).rejects.toThrow(/event_notifications_payload_object_check/)
      await expect(ins('EVENT_UPDATED', '"str"', 'k5')).rejects.toThrow(/event_notifications_payload_object_check/)
    })
  })

  // ── EVENT_UPDATED behaviour ────────────────────────────────────────────
  describe('material event change => EVENT_UPDATED', () => {
    it('a date change schedules exactly one notice per ELIGIBLE order and none for ineligible ones', async () => {
      const paid = await seedOrder({ payment: 'PAID', surface: 'BRAINBASE' })
      const free = await seedOrder({ payment: 'NOT_REQUIRED', surface: 'EVE' })
      await seedOrder({ status: 'CANCELLED', payment: 'PAID' })           // cancelled
      await seedOrder({ status: 'CANCELLED', payment: 'REFUNDED' })       // refunded
      await seedOrder({ status: 'PENDING', payment: 'PENDING' })          // mid-checkout
      await seedOrder({ status: 'CANCELLED', payment: 'FAILED' })         // failed
      await seedOrder({ payment: 'PAID', email: '   ' })                  // blank address

      const res = await patch({ starts_at: T2, ends_at: T2_END })
      expect(res.status).toBe(200)
      expect(res.json.notifications_scheduled).toBe(2)
      const rows = await updatedRows()
      expect(rows.map(r => r.order_id).sort()).toEqual([paid, free].sort())
      // The internal change columns never leak into the response.
      const ev = res.json.event as Record<string, unknown>
      expect(Object.keys(ev).filter(k => k.startsWith('__'))).toEqual([])
    })

    it('the payload is buyer-safe: exactly before/after/change_version, no purchaser data or secrets', async () => {
      await seedOrder({ payment: 'PAID', name: 'Secret Purchaser', email: 'secret.purchaser@example.com' })
      await patch({ starts_at: T2, ends_at: T2_END, venue: 'New Hall' })
      const [row] = await updatedRows()
      expect(Object.keys(row.payload!).sort()).toEqual(['after', 'before', 'change_version'])
      expect(row.payload).toEqual({
        before: { starts_at: T1, ends_at: T1_END, venue: 'Town Hall' },
        after: { starts_at: T2, ends_at: T2_END, venue: 'New Hall' },
        change_version: expect.stringMatching(/^\d{15,17}$/),
      })
      const text = JSON.stringify(row.payload)
      expect(text).not.toMatch(/secret|purchaser|@|token|email/i)
    })

    it('time-only (ends_at) and venue-only changes are material; description / name / artwork / reminder-only edits are not', async () => {
      await seedOrder()
      expect((await patch({ ends_at: '2030-01-01T13:00:00.000Z' })).json.notifications_scheduled).toBe(1)
      expect((await patch({ venue: 'Other Venue' })).json.notifications_scheduled).toBe(1)
      for (const harmless of [
        { description: 'A fuller description' }, { name: 'Gala 2030' }, { artwork_url: 'https://example.com/a.png' }, { reminder_enabled: true },
      ]) {
        const r = await patch(harmless)
        expect(r.status).toBe(200)
        expect(r.json.notifications_scheduled).toBeUndefined()
      }
      expect(await updatedRows()).toHaveLength(2)
    })

    it('a same-value PATCH (and a venue whitespace-only edit) creates no notice', async () => {
      await seedOrder()
      expect((await patch({ starts_at: T1, ends_at: T1_END, venue: 'Town Hall' })).json.notifications_scheduled).toBeUndefined()
      expect((await patch({ venue: '  Town Hall  ' })).json.notifications_scheduled).toBeUndefined()
      expect(await updatedRows()).toHaveLength(0)
    })

    it('replaying the SAME committed change is a no-op; a LATER distinct change — even back to the earlier values — is a new notice', async () => {
      const oid = await seedOrder()
      await patch({ starts_at: T2, ends_at: T2_END })                      // A -> B
      const [first] = await updatedRows(oid)
      expect(first.payload!.change_version).toBeTruthy()

      // Replay the identical committed change (same version): nothing new.
      const [ev] = await q<{ at: string }>(`SELECT updated_at::text AS at FROM events WHERE id = 'event-1'`)
      const replay = await scheduleEventUpdatedNotifications({
        organisationId: 'org-a', eventId: 'event-1', actorUserId: 'user-1',
        payload: first.payload as never, changedAt: ev.at,
      })
      expect(replay).toEqual([])
      expect(await updatedRows(oid)).toHaveLength(1)

      await patch({ starts_at: T1, ends_at: T1_END })                      // B -> A (revert)
      await patch({ starts_at: T2, ends_at: T2_END })                      // A -> B again
      const all = await updatedRows(oid)
      expect(all).toHaveLength(3)
      const versions = all.map(r => r.payload!.change_version as string)
      expect(new Set(versions).size).toBe(3)
      expect(new Set(all.map(r => r.idempotency_key)).size).toBe(3)
      for (const r of all) expect(r.idempotency_key).toBe(`event-notification:EVENT_UPDATED:${oid}:${r.payload!.change_version}`)
      // Versions are strictly increasing.
      expect(BigInt(versions[0]) < BigInt(versions[1]) && BigInt(versions[1]) < BigInt(versions[2])).toBe(true)
    })

    it('concurrent edits serialise: each sees the previous edit as its "before", versions are all distinct', async () => {
      const oid = await seedOrder()
      const starts = [1, 2, 3, 4].map(n => `2030-03-0${n}T10:00:00.000Z`)
      const ends = [1, 2, 3, 4].map(n => `2030-03-0${n}T12:00:00.000Z`)
      await Promise.all(starts.map((s, i) => patch({ starts_at: s, ends_at: ends[i] })))
      const rows = await updatedRows(oid)
      expect(rows).toHaveLength(4)
      expect(new Set(rows.map(r => r.payload!.change_version)).size).toBe(4)
      // The chain is exact: one "before" is the original, every other "before"
      // is some other edit's "after" (no lost update, no phantom before).
      const befores = rows.map(r => (r.payload!.before as { starts_at: string }).starts_at)
      const afters = rows.map(r => (r.payload!.after as { starts_at: string }).starts_at)
      expect(befores.filter(b => b === T1)).toHaveLength(1)
      expect(new Set(afters).size).toBe(4)
      for (const b of befores.filter(b => b !== T1)) expect(afters).toContain(b)
    })

    it('a cancelled or draft event never schedules EVENT_UPDATED (cancelling has its own notice)', async () => {
      await seedOrder()
      expect((await patch({ status: 'CANCELLED', starts_at: T2, ends_at: T2_END })).status).toBe(200)
      expect(await updatedRows()).toHaveLength(0)
      await q(`UPDATE events SET status = 'DRAFT', starts_at = $1, ends_at = $2`, [T1, T1_END])
      await patch({ starts_at: T2, ends_at: T2_END })
      expect(await updatedRows()).toHaveLength(0)
    })

    it('orders created AFTER the change are not notified (they saw the new details)', async () => {
      const early = await seedOrder()
      await patch({ starts_at: T2, ends_at: T2_END })
      const late = await seedOrder()
      expect((await updatedRows()).map(r => r.order_id)).toEqual([early])
      expect((await updatedRows(late))).toHaveLength(0)
    })

    it('delivery: Eve order gets Eve identity, BrainBase order gets BrainBase identity, no refund promise or marketing', async () => {
      await q(`UPDATE organisations SET slug = 'org-a' WHERE id = 'org-a'`)
      const eve = await seedOrder({ surface: 'EVE', payment: 'PAID', email: 'eve.buyer@example.com' })
      const bb = await seedOrder({ surface: 'BRAINBASE', payment: 'NOT_REQUIRED', email: 'bb.buyer@example.com' })
      await patch({ starts_at: T2, ends_at: T2_END, venue: 'New Hall' })     // PATCH sends inline (bounded)

      expect(sent).toHaveLength(2)
      const toEve = sent.find(s => s.to === 'eve.buyer@example.com')!
      const toBb = sent.find(s => s.to === 'bb.buyer@example.com')!
      expect(toEve.from).toBe(EVE_FROM)
      expect(toBb.from).not.toBe(EVE_FROM)
      // Eve links: event page on the Eve origin + the Eve refunds page; no BrainBase origin.
      expect(toEve.html).toContain(`${EVE_BASE}/e/org-a/gala`)
      expect(toEve.html).toContain(`${EVE_BASE}/refunds`)
      expect(toEve.html).not.toContain('BRAINB')
      expect(toBb.html).toContain('/e/org-a/gala')
      expect(toBb.html).not.toContain(EVE_BASE)
      for (const m of [toEve, toBb]) {
        expect(m.subject).toBe('Details changed for Gala')
        expect(m.html).toContain('Previously')
        expect(m.html).toContain('Now')
        expect(m.html).toContain('Previous venue')
        expect(m.html).toContain('Town Hall')
        expect(m.html).toContain('New Hall')
        expect(m.html).toContain('rights under applicable law')
        expect(m.html).toContain('does not issue a refund')
        expect(m.text ?? '').toContain('Previously:')
        expect(`${m.html}${m.text}`).not.toMatch(/Tax Invoice|credit note|business days|Book now|Buy now|Limited time|Don.t miss|automatic(ally)? refund|will be refunded/i)
      }
      expect((await updatedRows(eve))[0].status).toBe('sent')
      expect((await updatedRows(bb))[0].status).toBe('sent')
    })

    it('claim-time eligibility: a notice for an order that was cancelled/refunded after scheduling is not sent', async () => {
      const oid = await seedOrder({ surface: 'BRAINBASE', payment: 'PAID', email: 'later.cancelled@example.com' })
      // Schedule only (no inline delivery): call the scheduler directly.
      const [ev] = await q<{ at: string }>(`SELECT clock_timestamp()::text AS at`)
      const ids = await scheduleEventUpdatedNotifications({
        organisationId: 'org-a', eventId: 'event-1', actorUserId: null, changedAt: ev.at,
        payload: {
          before: { starts_at: T1, ends_at: T1_END, venue: 'Town Hall' },
          after: { starts_at: T2, ends_at: T2_END, venue: 'Town Hall' },
          change_version: '1900000000000001',
        },
      })
      expect(ids).toHaveLength(1)
      await q(`UPDATE event_orders SET status = 'CANCELLED', payment_status = 'REFUNDED' WHERE id = $1`, [oid])
      expect((await attemptNotificationDelivery(ids[0])).outcome).toBe('not_claimed')
      expect(sent).toHaveLength(0)
      // And the hourly recovery path does not keep retrying it forever.
      const { runNotificationRecovery } = await import('@/lib/events/notificationRecovery')
      await runNotificationRecovery()
      expect((await updatedRows(oid))[0].status).toBe('failed')
      expect(await findNotificationRecoveryCandidateIds()).toEqual([])
      expect(sent).toHaveLength(0)
    })

    it('each scheduled notice has an audit row with a masked recipient only', async () => {
      await seedOrder({ email: 'someone@example.com' })
      await patch({ starts_at: T2, ends_at: T2_END })
      const audits = await q<{ after_state: Record<string, unknown> }>(
        `SELECT after_state FROM audit_logs WHERE action = 'event_order.notification_scheduled' AND after_state->>'notification_type' = 'EVENT_UPDATED'`)
      expect(audits).toHaveLength(1)
      expect(audits[0].after_state.source).toBe('event_updated')
      expect(audits[0].after_state.recipient_masked).toBe('s***@example.com')
      expect(JSON.stringify(audits[0].after_state)).not.toContain('someone@')
    })
  })
})
