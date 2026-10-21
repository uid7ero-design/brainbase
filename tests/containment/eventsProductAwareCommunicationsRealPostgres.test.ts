import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve Phase 3.2 product-aware communications.
//
// Runs the ACTUAL delivery orchestration (attemptAutomaticTicketEmail,
// attemptNotificationDelivery, the Stripe webhook) against real PostgreSQL 17
// with the real migration set. Only the Resend HTTP call (global fetch), the
// Stripe network calls, the Connect lookup and the CRM hooks are mocked, so
// what is asserted is the exact request BrainBase would send to Resend.
//
// Proves:
//   - a BRAINBASE order's ticket email keeps BrainBase links, wordmark and
//     the default sender
//   - an EVE order's ticket email uses Eve ticket + wallet links, the Eve
//     wordmark and the Eve sender
//   - a missing Eve link base, or a missing/placeholder Eve sender, sends
//     NOTHING (no BrainBase fallback) and leaves the order retryable
//   - recovery after configuration is fixed preserves the order's EVE identity
//   - ORDER_CANCELLED / ORDER_REFUNDED / EVENT_REMINDER for an EVE order
//     resolve identity from the underlying order and carry Eve identity
//   - a webhook completion + replay whose Stripe metadata names BRAINBASE
//     cannot change the identity of the email that is sent
//
// Never against Production/Preview — a disposable container. Skipped when
// docker is unavailable.

const CONTAINER = `events-product-comms-vitest-${process.pid}`
const HOST_PORT = 58700 + (process.pid % 1000)

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
const createCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return { ...actual, createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a) }
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
  'scripts/create-events-ticket-email-deliveries.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  'scripts/create-events-ticketing-fees-foundation.sql',
  'scripts/create-events-notifications.sql',
  'scripts/add-events-order-product-surface.sql',
  // Eve launch compliance - the paid order INSERT now writes the acceptance snapshot columns.
  'scripts/add-events-order-legal-acceptance.sql',
  // Eve launch compliance - notification delivery now reads event_notifications.payload.
  'scripts/add-events-notification-event-updated.sql',
]

const EVE_BASE = 'https://eve-preview.vercel.app'
const EVE_FROM = 'Eve <tickets@mail.eve-preview.dev>'

const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
const validatedFor = (ticketTypeId: string, quantity = 2) => ({
  items: [{ ticket_type_id: ticketTypeId, quantity }], event_session_id: null, quantity,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: Array.from({ length: quantity }, (_, i) => ({ name: `Guest ${i + 1}`, email: null, responses: [], ticket_type_id: ticketTypeId })),
  order_responses: [], promotion_code: null, access_code: null,
})

type Sent = { from: string; to: string; subject: string; html: string; text?: string; reply_to?: string }

describe.runIf(HAS_DOCKER)('real Postgres — Eve Phase 3.2 product-aware communications', () => {
  let registerFreeOrder: typeof import('@/lib/events/services/freeRegistration').registerFreeOrder
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let attemptAutomaticTicketEmail: typeof import('@/lib/events/ticketEmailDelivery').attemptAutomaticTicketEmail
  let attemptNotificationDelivery: typeof import('@/lib/events/notificationDelivery').attemptNotificationDelivery
  let processStripeWebhookEvent: typeof import('@/lib/events/stripe').processStripeWebhookEvent
  let BASE_URL: string

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

    ;({ registerFreeOrder } = await import('@/lib/events/services/freeRegistration'))
    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    ;({ attemptAutomaticTicketEmail } = await import('@/lib/events/ticketEmailDelivery'))
    ;({ attemptNotificationDelivery } = await import('@/lib/events/notificationDelivery'))
    ;({ processStripeWebhookEvent } = await import('@/lib/events/stripe'))
    ;({ BASE_URL } = await import('@/lib/email'))
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    sent.length = 0
    createCheckoutSessionMock.mockReset()
    await q(`DELETE FROM event_notifications`)
    await q(`DELETE FROM event_orders`)
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

  // The shared free-registration service itself makes the initial automatic
  // ticket-email attempt (after commit), so the emails it produced are the
  // ones captured here; `sent` is then cleared for the assertions that follow.
  async function freeOrder(surface: 'BRAINBASE' | 'EVE'): Promise<{ orderId: string; initial: Sent[] }> {
    const res = await registerFreeOrder({ organisationId: 'org-a', productSurface: surface, event: EVENT, validated: validatedFor('tt-free') })
    expect(res.ok).toBe(true)
    const [row] = await q<{ id: string }>(`SELECT id FROM event_orders ORDER BY created_at DESC LIMIT 1`)
    const initial = sent.splice(0, sent.length)
    return { orderId: row.id, initial }
  }
  const emailState = async (orderId: string) =>
    (await q<{ ticket_email_status: string; ticket_email_attempt_count: number }>(`SELECT ticket_email_status, ticket_email_attempt_count FROM event_orders WHERE id = $1`, [orderId]))[0]
  const tokens = async (orderId: string) => ({
    wallet: (await q<{ booking_token: string }>(`SELECT booking_token FROM event_orders WHERE id = $1`, [orderId]))[0].booking_token,
    tickets: (await q<{ ticket_token: string }>(`SELECT ticket_token FROM event_attendees WHERE order_id = $1 AND ticket_token IS NOT NULL`, [orderId])).map(r => r.ticket_token),
  })
  const hrefs = (html: string) => Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1])

  it('BRAINBASE order: ticket email keeps BrainBase links, wordmark and the default sender', async () => {
    const { orderId, initial: sent } = await freeOrder('BRAINBASE')
    expect(sent).toHaveLength(1)
    const t = await tokens(orderId)
    expect(sent[0].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
    expect(sent[0].reply_to).toBeUndefined()
    expect(sent[0].html).toContain('BRAINB')
    expect(sent[0].html).toContain('Brainbase · Adelaide SA Australia')
    expect(hrefs(sent[0].html)).toContain(`${BASE_URL}/b/${t.wallet}/tickets`)
    for (const tok of t.tickets) expect(hrefs(sent[0].html)).toContain(`${BASE_URL}/t/${tok}`)
    expect(sent[0].html).not.toContain(EVE_BASE)
  })

  it('EVE order: ticket email uses Eve ticket + wallet links, the Eve wordmark and the Eve sender', async () => {
    const { orderId, initial: sent } = await freeOrder('EVE')
    expect(sent).toHaveLength(1)
    const t = await tokens(orderId)
    expect(sent[0].from).toBe(EVE_FROM)
    expect(sent[0].reply_to).toBeUndefined()
    const links = hrefs(sent[0].html)
    expect(links).toContain(`${EVE_BASE}/b/${t.wallet}/tickets`)
    for (const tok of t.tickets) expect(links).toContain(`${EVE_BASE}/t/${tok}`)
    // Not one BrainBase link, wordmark or legal line on an Eve order.
    expect(links.some(h => h.startsWith(BASE_URL))).toBe(false)
    expect(sent[0].html).not.toMatch(/brainb|Adelaide/i)
    expect(sent[0].html).toMatch(/>\s*EVE\s*</)
  })

  it('EVE order with no Eve link base sends NOTHING (no BrainBase fallback) and stays retryable', async () => {
    vi.stubEnv('EVE_PUBLIC_BASE_URL', '')
    const { orderId, initial } = await freeOrder('EVE')
    expect(initial).toHaveLength(0)
    const state = await emailState(orderId)
    expect(state.ticket_email_status).toBe('failed')
    expect(state.ticket_email_attempt_count).toBe(1)
    const [row] = await q<{ ticket_email_last_error: string; ticket_email_next_attempt_at: Date | null }>(`SELECT ticket_email_last_error, ticket_email_next_attempt_at FROM event_orders WHERE id = $1`, [orderId])
    expect(row.ticket_email_last_error).toMatch(/Eve buyer links are not configured/)
    expect(row.ticket_email_next_attempt_at).not.toBeNull()
  })

  it('EVE order with a missing, placeholder or BrainBase-claiming Eve sender sends NOTHING', async () => {
    for (const bad of ['', 'Eve <no-reply@eve.invalid>', 'Brainbase Tickets <tickets@mail.eve-preview.dev>', 'not an address']) {
      await q(`DELETE FROM event_orders`)
      vi.stubEnv('EVE_EMAIL_FROM', bad)
      const { orderId, initial } = await freeOrder('EVE')
      expect(initial).toHaveLength(0)
      expect((await emailState(orderId)).ticket_email_status).toBe('failed')
    }
  })

  it('recovery after configuration is fixed preserves the order identity (EVE), never BrainBase', async () => {
    vi.stubEnv('EVE_EMAIL_FROM', '')
    const { orderId, initial } = await freeOrder('EVE')
    expect(initial).toHaveLength(0)
    expect((await emailState(orderId)).ticket_email_status).toBe('failed')
    // The recovery sweep claims due 'failed' rows.
    await q(`UPDATE event_orders SET ticket_email_next_attempt_at = NOW() - interval '1 minute' WHERE id = $1`, [orderId])
    vi.stubEnv('EVE_EMAIL_FROM', EVE_FROM)
    const out = await attemptAutomaticTicketEmail(orderId)
    expect(out.outcome).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].from).toBe(EVE_FROM)
    expect(hrefs(sent[0].html).every(h => !h.startsWith(BASE_URL))).toBe(true)
    const [row] = await q<{ product_surface: string }>(`SELECT product_surface FROM event_orders WHERE id = $1`, [orderId])
    expect(row.product_surface).toBe('EVE')
  })

  it('a historical row (pre-migration default) is BRAINBASE and gets the BrainBase email', async () => {
    // A historical row: written without naming the column, so only the
    // database default says BRAINBASE.
    const { orderId } = await freeOrder('BRAINBASE')
    await q(`UPDATE event_orders SET ticket_email_status = 'pending' WHERE id = $1`, [orderId])
    await q(`ALTER TABLE event_orders ALTER COLUMN product_surface SET DEFAULT 'BRAINBASE'`)
    const [row] = await q<{ product_surface: string }>(`SELECT product_surface FROM event_orders WHERE id = $1`, [orderId])
    expect(row.product_surface).toBe('BRAINBASE')
    expect((await attemptAutomaticTicketEmail(orderId)).outcome).toBe('sent')
    expect(sent[0].html).toContain('BRAINB')
    expect(sent[0].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
  })

  async function scheduleNotification(orderId: string, type: string): Promise<string> {
    const [id] = await q<{ id: string }>(
      `INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key, scheduled_for)
       VALUES ('org-a', 'event-1', $1, $2, 'jane@example.com', $3, NOW() - interval '1 minute') RETURNING id`,
      [orderId, type, `event-notification:${type}:${orderId}`],
    )
    return id.id
  }

  it('lifecycle emails for an EVE order carry Eve identity (cancel + refund + reminder)', async () => {
    const { orderId } = await freeOrder('EVE')
    await q(`UPDATE events SET reminder_enabled = true WHERE id = 'event-1'`)
    for (const type of ['ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_REMINDER']) {
      const id = await scheduleNotification(orderId, type)
      const out = await attemptNotificationDelivery(id)
      expect(out.outcome).toBe('sent')
    }
    expect(sent).toHaveLength(3)
    for (const m of sent) {
      expect(m.from).toBe(EVE_FROM)
      expect(m.html).not.toMatch(/brainb|Adelaide/i)
      expect(m.html).toMatch(/>\s*EVE\s*</)
      expect(hrefs(m.html).every(h => !h.startsWith(BASE_URL))).toBe(true)
    }
    const t = await tokens(orderId)
    const reminder = sent.find(m => m.subject.startsWith('Reminder'))!
    expect(hrefs(reminder.html)).toContain(`${EVE_BASE}/b/${t.wallet}/tickets`)
    expect(reminder.text).toContain(`${EVE_BASE}/b/${t.wallet}/tickets`)
  })

  it('lifecycle emails for a BRAINBASE order are unchanged', async () => {
    const { orderId } = await freeOrder('BRAINBASE')
    const id = await scheduleNotification(orderId, 'ORDER_CANCELLED')
    expect((await attemptNotificationDelivery(id)).outcome).toBe('sent')
    expect(sent[0].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
    expect(sent[0].html).toContain('Brainbase · Adelaide SA Australia')
  })

  it('a lifecycle email for an EVE order with no Eve configuration fails closed and is retryable', async () => {
    const { orderId } = await freeOrder('EVE')
    const id = await scheduleNotification(orderId, 'ORDER_REFUNDED')
    vi.stubEnv('EVE_PUBLIC_BASE_URL', '')
    const out = await attemptNotificationDelivery(id)
    expect(out).toMatchObject({ outcome: 'failed', reason: 'not_configured', terminal: false })
    expect(sent).toHaveLength(0)
    const [n] = await q<{ status: string; next_attempt_at: Date | null }>(`SELECT status, next_attempt_at FROM event_notifications WHERE id = $1`, [id])
    expect(n.status).toBe('failed')
    expect(n.next_attempt_at).not.toBeNull()
  })

  it('a webhook completion + replay whose Stripe metadata names BRAINBASE cannot change the identity of the email sent', async () => {
    createCheckoutSessionMock.mockResolvedValueOnce({ sessionId: 'cs_eve_mail', url: 'https://checkout.stripe.test/eve' })
    await startPaidCheckout({
      organisationId: 'org-a', productSurface: 'EVE', event: EVENT, validated: validatedFor('tt-paid', 1),
      buildReturnUrls: async () => ({ successUrl: `${EVE_BASE}/s`, cancelUrl: `${EVE_BASE}/c` }),
    })
    const [order] = await q<{ id: string }>(`SELECT id FROM event_orders`)
    const event = {
      type: 'checkout.session.completed', account: 'acct_test_org_a',
      data: { object: { id: 'cs_eve_mail', payment_status: 'paid', payment_intent: 'pi_mail', metadata: { event_order_id: order.id, product_surface: 'BRAINBASE' } } },
    } as unknown as Parameters<typeof processStripeWebhookEvent>[0]
    await processStripeWebhookEvent(event)
    await processStripeWebhookEvent(event) // replay
    const [row] = await q<{ product_surface: string; payment_status: string }>(`SELECT product_surface, payment_status FROM event_orders WHERE id = $1`, [order.id])
    expect(row).toEqual({ product_surface: 'EVE', payment_status: 'PAID' })
    // The webhook only schedules the ticket email (ticket_email_status =
    // 'pending'); the recovery sweep / attempt delivers it. Deliver it now.
    expect(sent).toHaveLength(0)
    expect((await attemptAutomaticTicketEmail(order.id)).outcome).toBe('sent')
    expect(sent).toHaveLength(1)
    for (const m of sent) {
      expect(m.from).toBe(EVE_FROM)
      expect(hrefs(m.html).every(h => !h.startsWith(BASE_URL))).toBe(true)
      expect(m.html).not.toMatch(/brainb|Adelaide/i)
    }
  })
})
