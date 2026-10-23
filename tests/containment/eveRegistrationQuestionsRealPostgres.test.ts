import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve registration questions (ADR 0013 §4a).
//
// Runs the ACTUAL shared services (freeRegistration.ts, paidCheckout.ts)
// against real PostgreSQL 17 with the real migration set plus
// scripts/add-eve-registration-questions.sql, through the same lib/db.ts
// stand-in as eventsOrderProductSurfaceRealPostgres.test.ts. Only Stripe,
// the Connect-eligibility lookup, CRM hooks and the ticket email are mocked.
//
// Proves the new INSERT columns against real SQL: help-text and sensitivity
// snapshots, the consent time stored ONLY on sensitive rows for an EVE
// booking (never for BRAINBASE), a "No" answer stored as JSON false, a
// refused submission writing nothing at all, and that editing a question
// afterwards leaves the stored answer's snapshot untouched.
//
// Never against Production/Preview — a disposable container, torn down after
// use. Skipped when docker is unavailable.

const CONTAINER = `eve-reg-questions-vitest-${process.pid}`
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
vi.mock('@/lib/events/ticketEmailDelivery', () => ({
  attemptAutomaticTicketEmail: vi.fn().mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-test' }),
}))
const createCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return { ...actual, createCheckoutSession: (...a: unknown[]) => createCheckoutSessionMock(...a), expireCheckoutSession: vi.fn() }
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

const EVENT = (eve: boolean) => ({
  id: 'event-1', organisation_id: 'org-a', name: 'Riverlights (test)', slug: 'rl', description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide',
  eve_questions_enabled: eve,
})
const validated = (typeId: string, consent: boolean, withAnswers = true) => ({
  items: [{ ticket_type_id: typeId, quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, ticket_type_id: typeId, responses: withAnswers ? [{ question_id: 'q-access', answer: 'Step-free access' }, { question_id: 'q-18', answer: true }] : [] }],
  order_responses: withAnswers ? [{ question_id: 'q-ec', answer: 'Sam Contact' }, { question_id: 'q-photo', answer: false }] : [],
  promotion_code: null, access_code: null, sensitive_consent: consent,
})
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })

describe.runIf(HAS_DOCKER)('real Postgres — Eve registration questions', () => {
  let registerFreeOrder: typeof import('@/lib/events/services/freeRegistration').registerFreeOrder
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  type Row = { question_id: string; question_label_snapshot: string; question_help_text_snapshot: string | null; sensitive_snapshot: boolean; sensitive_consent_at: Date | null; answer: unknown; attendee_id: string | null }
  const responses = () => q<Row>(`SELECT question_id, question_label_snapshot, question_help_text_snapshot, sensitive_snapshot, sensitive_consent_at, answer, attendee_id FROM event_registration_responses ORDER BY question_id`)

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
      // Idempotent: the new script must be safe to run twice.
      fs.readFileSync(path.join(process.cwd(), 'scripts/add-eve-registration-questions.sql'), 'utf8'),
      `INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');`,
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
         VALUES ('event-1', 'org-a', 'Riverlights (test)', 'rl', 'PUBLISHED', '2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z', 'Australia/Adelaide');`,
      `INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
         VALUES ('tt-paid', 'event-1', 'org-a', 'General Admission', 8900, 1000, true), ('tt-free', 'event-1', 'org-a', 'Free', 0, 1000, true);`,
      `INSERT INTO event_registration_questions (id, organisation_id, event_id, label, help_text, field_type, required, scope, sort_order, sensitive) VALUES
         ('q-ec', 'org-a', 'event-1', 'Emergency Contact Name', NULL, 'SHORT_TEXT', true, 'ORDER', 0, true),
         ('q-photo', 'org-a', 'event-1', 'Consent to event photography/videography', 'Photos may be used in event promotion.', 'YES_NO', true, 'ORDER', 1, false),
         ('q-access', 'org-a', 'event-1', 'Accessibility requirements', NULL, 'LONG_TEXT', false, 'ATTENDEE', 0, true),
         ('q-18', 'org-a', 'event-1', 'Are you over 18 years of age?', NULL, 'YES_NO', true, 'ATTENDEE', 1, false);`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)
    ;({ registerFreeOrder } = await import('@/lib/events/services/freeRegistration'))
    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    createCheckoutSessionMock.mockReset().mockResolvedValue({ sessionId: 'cs_test', url: 'https://checkout.stripe.test/x' })
    await q(`DELETE FROM event_orders`)
  })

  it('the migration defaults every existing row to today\'s meaning (opt-in off, not sensitive)', async () => {
    const [ev] = await q<{ eve_questions_enabled: boolean }>(`SELECT eve_questions_enabled FROM events WHERE id = 'event-1'`)
    expect(ev.eve_questions_enabled).toBe(false)
    await q(`INSERT INTO event_registration_questions (organisation_id, event_id, label, field_type, scope) VALUES ('org-a','event-1','Old style','SHORT_TEXT','ORDER')`)
    const [old] = await q<{ sensitive: boolean }>(`SELECT sensitive FROM event_registration_questions WHERE label = 'Old style'`)
    expect(old.sensitive).toBe(false)
    await q(`DELETE FROM event_registration_questions WHERE label = 'Old style'`)
  })

  it('EVE free registration, opted in + acknowledged: snapshots stored, consent time on sensitive rows only, "No" kept as false', async () => {
    const r = await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-free', true) })
    expect(r.ok).toBe(true)
    const rows = await responses()
    expect(rows.map(x => x.question_id)).toEqual(['q-18', 'q-access', 'q-ec', 'q-photo'])
    const by = Object.fromEntries(rows.map(x => [x.question_id, x]))
    expect(by['q-ec']).toMatchObject({ sensitive_snapshot: true, answer: 'Sam Contact', attendee_id: null })
    expect(by['q-access']).toMatchObject({ sensitive_snapshot: true, answer: 'Step-free access' })
    expect(by['q-access'].attendee_id).not.toBeNull()
    expect(by['q-ec'].sensitive_consent_at).toBeInstanceOf(Date)
    expect(by['q-access'].sensitive_consent_at).toBeInstanceOf(Date)
    expect(by['q-photo']).toMatchObject({ sensitive_snapshot: false, sensitive_consent_at: null, answer: false, question_help_text_snapshot: 'Photos may be used in event promotion.' })
    expect(by['q-18']).toMatchObject({ sensitive_consent_at: null, answer: true })
  })

  it('EVE refused submissions write nothing: opt-in off, or sensitive answers without acknowledgement', async () => {
    expect(await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(false), validated: validated('tt-free', true) })).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-free', false) })).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-paid', false), buildReturnUrls: URLS })).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(await q(`SELECT 1 FROM event_orders`)).toHaveLength(0)
    expect(await responses()).toHaveLength(0)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('BRAINBASE registration is unchanged: answers stored with snapshots, never a consent time', async () => {
    const r = await registerFreeOrder({ organisationId: 'org-a', productSurface: 'BRAINBASE', event: EVENT(false), validated: validated('tt-free', false) })
    expect(r.ok).toBe(true)
    const rows = await responses()
    expect(rows).toHaveLength(4)
    expect(rows.every(x => x.sensitive_consent_at === null)).toBe(true)
    expect(rows.filter(x => x.sensitive_snapshot).map(x => x.question_id).sort()).toEqual(['q-access', 'q-ec'])
  })

  it('EVE paid checkout, opted in + acknowledged: answers written with consent time before Stripe is called', async () => {
    const r = await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-paid', true), buildReturnUrls: URLS })
    expect(r).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.test/x' })
    const rows = await responses()
    expect(rows).toHaveLength(4)
    expect(rows.filter(x => x.sensitive_consent_at !== null).map(x => x.question_id).sort()).toEqual(['q-access', 'q-ec'])
  })

  it('editing a question after it was answered never rewrites the stored answer or its snapshot', async () => {
    await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-free', true) })
    await q(`UPDATE event_registration_questions SET label = 'Photo consent (reworded)', help_text = 'New wording', sensitive = true WHERE id = 'q-photo'`)
    const [photo] = (await responses()).filter(x => x.question_id === 'q-photo')
    expect(photo).toMatchObject({ question_label_snapshot: 'Consent to event photography/videography', question_help_text_snapshot: 'Photos may be used in event promotion.', sensitive_snapshot: false, answer: false })
    await q(`UPDATE event_registration_questions SET label = 'Consent to event photography/videography', help_text = 'Photos may be used in event promotion.', sensitive = false WHERE id = 'q-photo'`)
  })
})
