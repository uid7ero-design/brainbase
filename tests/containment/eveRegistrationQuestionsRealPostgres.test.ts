import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve registration questions: category
// model, answer snapshots and answer retention (ADR 0013 §4a/§4b).
//
// Runs the ACTUAL shared services (freeRegistration.ts, paidCheckout.ts) and
// the ACTUAL retention job (answerRetention.ts) against real PostgreSQL 17
// with the real migration set plus scripts/add-eve-registration-questions.sql,
// through the same lib/db.ts stand-in as eventsOrderProductSurfaceRealPostgres.
// Only Stripe, Connect eligibility, CRM hooks and the ticket email are mocked.
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
  'scripts/add-events-booking-wallet.sql',
  'scripts/add-events-ticket-email-delivery.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  'scripts/create-events-ticketing-fees-foundation.sql',
  'scripts/add-events-order-product-surface.sql',
  'scripts/add-events-order-legal-acceptance.sql',
]
const EVE_SQL = () => fs.readFileSync(path.join(process.cwd(), 'scripts/add-eve-registration-questions.sql'), 'utf8')

// Event 1 ends 2030-01-01T12:00Z.
const ENDS = new Date('2030-01-01T12:00:00Z')
const day = 24 * 3600 * 1000
const at = (ms: number) => new Date(ENDS.getTime() + ms)

const EVENT = (eve: boolean) => ({
  id: 'event-1', organisation_id: 'org-a', name: 'Riverlights (test)', slug: 'rl', description: null, venue: null,
  artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: ENDS.toISOString(), timezone: 'Australia/Adelaide',
  eve_questions_enabled: eve,
})
const validated = (typeId: string, consent: boolean) => ({
  items: [{ ticket_type_id: typeId, quantity: 1 }], event_session_id: null, quantity: 1,
  purchaser_name: 'Jane', purchaser_email: 'jane@example.com', purchaser_phone: null,
  attendees: [{ name: 'Jane', email: null, ticket_type_id: typeId, responses: [{ question_id: 'q-access', answer: 'Step-free access' }, { question_id: 'q-hear-a', answer: 'Radio' }] }],
  order_responses: [{ question_id: 'q-ec', answer: 'Sam Contact' }, { question_id: 'q-photo', answer: false }],
  promotion_code: null, access_code: null, sensitive_consent: consent,
})
const URLS = async () => ({ successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c' })

describe.runIf(HAS_DOCKER)('real Postgres — Eve registration questions: categories + retention', () => {
  let registerFreeOrder: typeof import('@/lib/events/services/freeRegistration').registerFreeOrder
  let startPaidCheckout: typeof import('@/lib/events/services/paidCheckout').startPaidCheckout
  let runAnswerRetention: typeof import('@/lib/events/answerRetention').runAnswerRetention
  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  type Row = {
    question_id: string; question_label_snapshot: string; question_help_text_snapshot: string | null; data_category_snapshot: string;
    sensitive_consent_at: Date | null; redacted_at: Date | null; answer: unknown; attendee_id: string | null; order_id: string;
  }
  const responses = () => q<Row>(`SELECT question_id, question_label_snapshot, question_help_text_snapshot, data_category_snapshot, sensitive_consent_at, redacted_at, answer, attendee_id, order_id FROM event_registration_responses ORDER BY order_id, question_id`)
  const book = async () => {
    const r = await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-free', true) })
    if (!r.ok) throw new Error(JSON.stringify(r))
    return r.orderId
  }

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
      `CREATE TABLE audit_logs (id text PRIMARY KEY, organisation_id text NOT NULL, user_id text NULL, action text NOT NULL, resource_type text NOT NULL,
         resource_id text NULL, before_state jsonb NULL, after_state jsonb NULL, ip_address text NULL, user_agent text NULL,
         created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
      ...MIGRATIONS.map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')),
      `INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');`,
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone)
         VALUES ('event-1', 'org-a', 'Riverlights (test)', 'rl', 'PUBLISHED', '2030-01-01T10:00:00Z', '${ENDS.toISOString()}', 'Australia/Adelaide');`,
      `INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, active)
         VALUES ('tt-paid', 'event-1', 'org-a', 'General Admission', 8900, 1000, true), ('tt-free', 'event-1', 'org-a', 'Free', 0, 1000, true);`,
      // A pre-existing answered question + answer, BEFORE the new migration (the School Test shape).
      `INSERT INTO event_registration_questions (id, organisation_id, event_id, label, field_type, required, scope)
         VALUES ('q-old', 'org-a', 'event-1', 'Accessibility or support requirements', 'LONG_TEXT', false, 'ATTENDEE');`,
      `INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents) VALUES ('order-old', 'org-a', 'event-1', 'Old', 'old@example.com', 'CONFIRMED', 0);`,
      `INSERT INTO event_registration_responses (organisation_id, event_id, question_id, order_id, question_label_snapshot, field_type_snapshot, answer)
         VALUES ('org-a', 'event-1', 'q-old', 'order-old', 'Accessibility or support requirements', 'LONG_TEXT', '"wheelchair access"');`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)
    // The new migration, applied over existing data — twice (must be idempotent).
    await db.pool.query(EVE_SQL())
    await db.pool.query(EVE_SQL())
    await db.pool.query(`INSERT INTO event_registration_questions (id, organisation_id, event_id, label, help_text, field_type, required, scope, sort_order, data_category, template_key) VALUES
      ('q-ec', 'org-a', 'event-1', 'Emergency contact name', NULL, 'SHORT_TEXT', true, 'ORDER', 0, 'THIRD_PARTY', 'EMERGENCY_CONTACT_NAME'),
      ('q-photo', 'org-a', 'event-1', 'Consent to event photography/videography', 'Photos may be used in event promotion.', 'YES_NO', true, 'ORDER', 1, 'CONSENT', 'PHOTO_CONSENT'),
      ('q-access', 'org-a', 'event-1', 'Accessibility or support requirements', NULL, 'LONG_TEXT', false, 'ATTENDEE', 0, 'SENSITIVE', 'ACCESSIBILITY'),
      ('q-hear-a', 'org-a', 'event-1', 'How did you hear about this event?', NULL, 'SINGLE_SELECT', false, 'ATTENDEE', 1, 'STANDARD', NULL);`)
    await db.pool.query(`UPDATE event_registration_questions SET options = '["Radio","Friend"]'::jsonb WHERE id = 'q-hear-a'`)
    await db.pool.query(`UPDATE event_registration_questions SET active = false WHERE id = 'q-old'`)
    ;({ registerFreeOrder } = await import('@/lib/events/services/freeRegistration'))
    ;({ startPaidCheckout } = await import('@/lib/events/services/paidCheckout'))
    ;({ runAnswerRetention } = await import('@/lib/events/answerRetention'))
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    createCheckoutSessionMock.mockReset().mockResolvedValue({ sessionId: 'cs_test', url: 'https://checkout.stripe.test/x' })
    await q(`DELETE FROM event_orders WHERE id <> 'order-old'`)
    await q(`DELETE FROM audit_logs`)
    await q(`UPDATE events SET status = 'PUBLISHED', cancelled_at = NULL, answers_legal_hold = NULL WHERE id = 'event-1'`)
    await q(`UPDATE event_orders SET answers_legal_hold = NULL`)
    await q(`UPDATE event_registration_responses SET answer = '"wheelchair access"'::jsonb, redacted_at = NULL WHERE order_id = 'order-old'`)
  })

  it('migration: existing data keeps its meaning — questions STANDARD, answers STANDARD and untouched, every event opted out, no holds', async () => {
    const [ev] = await q<{ eve_questions_enabled: boolean; cancelled_at: unknown; answers_legal_hold: unknown }>(`SELECT eve_questions_enabled, cancelled_at, answers_legal_hold FROM events WHERE id = 'event-1'`)
    expect(ev).toEqual({ eve_questions_enabled: false, cancelled_at: null, answers_legal_hold: null })
    const [oldQ] = await q<{ data_category: string; template_key: unknown }>(`SELECT data_category, template_key FROM event_registration_questions WHERE id = 'q-old'`)
    expect(oldQ).toEqual({ data_category: 'STANDARD', template_key: null })
    const [old] = await q<Row>(`SELECT * FROM event_registration_responses WHERE order_id = 'order-old'`)
    expect(old).toMatchObject({ data_category_snapshot: 'STANDARD', answer: 'wheelchair access', redacted_at: null, sensitive_consent_at: null, question_help_text_snapshot: null })
  })

  it('migration: constraints — only the four categories, only the four hold reasons, and answer/redacted_at always in step', async () => {
    await expect(q(`UPDATE event_registration_questions SET data_category = 'HEALTH' WHERE id = 'q-old'`)).rejects.toThrow(/data_category_chk/)
    await expect(q(`UPDATE events SET answers_legal_hold = 'because' WHERE id = 'event-1'`)).rejects.toThrow(/answers_legal_hold_chk/)
    await expect(q(`UPDATE event_orders SET answers_legal_hold = 'x' WHERE id = 'order-old'`)).rejects.toThrow(/answers_legal_hold_chk/)
    await expect(q(`UPDATE event_registration_responses SET answer = NULL WHERE order_id = 'order-old'`)).rejects.toThrow(/redaction_chk/)
    await expect(q(`UPDATE event_registration_responses SET redacted_at = now() WHERE order_id = 'order-old'`)).rejects.toThrow(/redaction_chk/)
  })

  it('EVE booking: category snapshots stored; agreement time only on SENSITIVE and THIRD_PARTY rows; "No" kept as false', async () => {
    const orderId = await book()
    const rows = (await responses()).filter(r => r.order_id === orderId)
    const by = Object.fromEntries(rows.map(r => [r.question_id, r]))
    expect(by['q-ec']).toMatchObject({ data_category_snapshot: 'THIRD_PARTY', answer: 'Sam Contact' })
    expect(by['q-access']).toMatchObject({ data_category_snapshot: 'SENSITIVE', answer: 'Step-free access' })
    expect(by['q-photo']).toMatchObject({ data_category_snapshot: 'CONSENT', answer: false, sensitive_consent_at: null, question_help_text_snapshot: 'Photos may be used in event promotion.' })
    expect(by['q-hear-a']).toMatchObject({ data_category_snapshot: 'STANDARD', answer: 'Radio', sensitive_consent_at: null })
    expect(by['q-ec'].sensitive_consent_at).toBeInstanceOf(Date)
    expect(by['q-access'].sensitive_consent_at).toBeInstanceOf(Date)
  })

  it('EVE refused submissions write nothing (THIRD_PARTY/SENSITIVE without agreement; opt-in off)', async () => {
    expect(await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-free', false) })).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(await registerFreeOrder({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(false), validated: validated('tt-free', true) })).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(await startPaidCheckout({ organisationId: 'org-a', productSurface: 'EVE', event: EVENT(true), validated: validated('tt-paid', false), buildReturnUrls: URLS })).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(await q(`SELECT 1 FROM event_orders WHERE id <> 'order-old'`)).toHaveLength(0)
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('a later edit to the question (category included) never rewrites a stored answer\'s snapshot', async () => {
    const orderId = await book()
    await q(`UPDATE event_registration_questions SET label = 'Reworded', help_text = 'New wording', data_category = 'STANDARD' WHERE id = 'q-photo'`)
    const [photo] = (await responses()).filter(r => r.order_id === orderId && r.question_id === 'q-photo')
    expect(photo).toMatchObject({ question_label_snapshot: 'Consent to event photography/videography', question_help_text_snapshot: 'Photos may be used in event promotion.', data_category_snapshot: 'CONSENT' })
    await q(`UPDATE event_registration_questions SET label = 'Consent to event photography/videography', help_text = 'Photos may be used in event promotion.', data_category = 'CONSENT' WHERE id = 'q-photo'`)
  })

  // ── Retention ───────────────────────────────────────────────────────
  const removedIds = async (orderId: string) => (await responses()).filter(r => r.order_id === orderId && r.redacted_at).map(r => r.question_id).sort()

  it('timers after a normal event: THIRD_PARTY at +7d, SENSITIVE at +30d, STANDARD at +12 months, CONSENT at +3 years', async () => {
    const orderId = await book()
    // Before the event ends, and just before each boundary: nothing.
    expect((await runAnswerRetention({ mode: 'enforce', now: at(-day) })).redacted).toBe(0)
    expect((await runAnswerRetention({ mode: 'enforce', now: at(7 * day - 1000) })).redacted).toBe(0)
    expect(await removedIds(orderId)).toEqual([])

    await runAnswerRetention({ mode: 'enforce', now: at(7 * day) })
    expect(await removedIds(orderId)).toEqual(['q-ec'])

    // Each boundary is exact: one second before it, nothing more is removed.
    await runAnswerRetention({ mode: 'enforce', now: at(30 * day - 1000) })
    expect(await removedIds(orderId)).toEqual(['q-ec'])
    await runAnswerRetention({ mode: 'enforce', now: at(30 * day) })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec'])

    await runAnswerRetention({ mode: 'enforce', now: new Date('2031-01-01T11:59:59Z') })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec'])
    await runAnswerRetention({ mode: 'enforce', now: new Date('2031-01-01T12:00:00Z') })
    // 12 months: this order's STANDARD answer, AND the pre-existing STANDARD answer (order-old).
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec', 'q-hear-a'])
    expect(await removedIds('order-old')).toEqual(['q-old'])

    await runAnswerRetention({ mode: 'enforce', now: new Date('2033-01-01T11:59:59Z') })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec', 'q-hear-a'])
    await runAnswerRetention({ mode: 'enforce', now: new Date('2033-01-01T12:00:00Z') })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec', 'q-hear-a', 'q-photo'])
  })

  it('removal keeps only structure: answer NULL, no text elsewhere; label/type/category/help-text snapshots and the agreement time stay', async () => {
    const orderId = await book()
    await runAnswerRetention({ mode: 'enforce', now: at(30 * day) })
    const [acc] = await q<Record<string, unknown>>(`SELECT * FROM event_registration_responses WHERE order_id = $1 AND question_id = 'q-access'`, [orderId])
    expect(acc.answer).toBeNull()
    expect(acc.redacted_at).toBeInstanceOf(Date)
    expect(acc).toMatchObject({ question_label_snapshot: 'Accessibility or support requirements', field_type_snapshot: 'LONG_TEXT', data_category_snapshot: 'SENSITIVE' })
    expect(acc.sensitive_consent_at).toBeInstanceOf(Date)
    expect(JSON.stringify(await q(`SELECT * FROM event_registration_responses WHERE order_id = $1 AND redacted_at IS NOT NULL`, [orderId]))).not.toMatch(/Step-free|Sam Contact/)
    // The order, its attendee and its ticket are untouched.
    expect(await q(`SELECT 1 FROM event_orders WHERE id = $1`, [orderId])).toHaveLength(1)
    expect(await q(`SELECT 1 FROM event_attendees WHERE order_id = $1`, [orderId])).toHaveLength(1)
  })

  it('cancelled event: SENSITIVE and THIRD_PARTY answers go 7 days after cancellation, even when the event date is far away', async () => {
    const orderId = await book()
    const cancelledAt = new Date('2029-06-01T00:00:00Z') // long before the event end (2030-01-01)
    await q(`UPDATE events SET status = 'CANCELLED', cancelled_at = $1 WHERE id = 'event-1'`, [cancelledAt])
    await runAnswerRetention({ mode: 'enforce', now: new Date(cancelledAt.getTime() + 7 * day - 1000) })
    expect(await removedIds(orderId)).toEqual([])
    await runAnswerRetention({ mode: 'enforce', now: new Date(cancelledAt.getTime() + 7 * day) })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec'])
    // STANDARD and CONSENT keep their event-end timers.
    await runAnswerRetention({ mode: 'enforce', now: new Date('2030-06-01T00:00:00Z') })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec'])
  })

  it('cancelled AFTER the event ended: the earlier of the two timers applies (event end + 7d for THIRD_PARTY)', async () => {
    const orderId = await book()
    await q(`UPDATE events SET status = 'CANCELLED', cancelled_at = $1 WHERE id = 'event-1'`, [at(3 * day)])
    await runAnswerRetention({ mode: 'enforce', now: at(7 * day - 1000) })
    expect(await removedIds(orderId)).toEqual([])
    await runAnswerRetention({ mode: 'enforce', now: at(7 * day) })
    expect(await removedIds(orderId)).toEqual(['q-ec'])
    await runAnswerRetention({ mode: 'enforce', now: at(10 * day) }) // cancellation + 7d → SENSITIVE too
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec'])
  })

  it('cancelled before cancelled_at existed: falls back to updated_at', async () => {
    const orderId = await book()
    const updated = new Date('2029-06-01T00:00:00Z')
    await q(`UPDATE events SET status = 'CANCELLED', cancelled_at = NULL, updated_at = $1 WHERE id = 'event-1'`, [updated])
    await runAnswerRetention({ mode: 'enforce', now: new Date(updated.getTime() + 7 * day) })
    expect(await removedIds(orderId)).toEqual(['q-access', 'q-ec'])
  })

  it('legal hold on the event or on one order pauses removal; clearing it resumes on the normal timers', async () => {
    const held = await book()
    const free = await book()
    await q(`UPDATE event_orders SET answers_legal_hold = 'COMPLAINT' WHERE id = $1`, [held])
    let s = await runAnswerRetention({ mode: 'enforce', now: at(30 * day) })
    expect(await removedIds(held)).toEqual([])
    expect(await removedIds(free)).toEqual(['q-access', 'q-ec'])
    expect(s.held).toBe(2)

    await q(`UPDATE events SET answers_legal_hold = 'INCIDENT' WHERE id = 'event-1'`)
    await q(`UPDATE event_orders SET answers_legal_hold = NULL WHERE id = $1`, [held])
    s = await runAnswerRetention({ mode: 'enforce', now: new Date('2031-06-01T00:00:00Z') })
    expect(s.redacted).toBe(0)
    expect(await removedIds(held)).toEqual([])

    await q(`UPDATE events SET answers_legal_hold = NULL WHERE id = 'event-1'`)
    await runAnswerRetention({ mode: 'enforce', now: new Date('2031-06-01T00:00:00Z') })
    expect(await removedIds(held)).toEqual(['q-access', 'q-ec', 'q-hear-a'])
  })

  it('dry-run reports what is due and changes nothing; re-runs and already-removed answers are no-ops', async () => {
    const orderId = await book()
    const dry = await runAnswerRetention({ mode: 'dry-run', now: at(30 * day) })
    expect(dry).toMatchObject({ mode: 'dry-run', due: 2, redacted: 0, by_category: { SENSITIVE: 1, THIRD_PARTY: 1 }, events: 1 })
    expect(await removedIds(orderId)).toEqual([])
    expect(await q(`SELECT 1 FROM audit_logs`)).toHaveLength(0)

    const first = await runAnswerRetention({ mode: 'enforce', now: at(30 * day) })
    expect(first.redacted).toBe(2)
    const [firstRow] = await q<{ redacted_at: Date }>(`SELECT redacted_at FROM event_registration_responses WHERE order_id = $1 AND question_id = 'q-ec'`, [orderId])
    const again = await runAnswerRetention({ mode: 'enforce', now: at(31 * day) })
    expect(again).toMatchObject({ due: 0, redacted: 0 })
    const [secondRow] = await q<{ redacted_at: Date }>(`SELECT redacted_at FROM event_registration_responses WHERE order_id = $1 AND question_id = 'q-ec'`, [orderId])
    expect(secondRow.redacted_at.getTime()).toBe(firstRow.redacted_at.getTime()) // not re-stamped
  })

  it('audit: one row per event, ids and counts only — never answer text or labels; user is the system (null)', async () => {
    const orderId = await book()
    await runAnswerRetention({ mode: 'enforce', now: at(30 * day) })
    const audits = await q<{ action: string; user_id: unknown; resource_id: string; after_state: Record<string, unknown> }>(`SELECT action, user_id, resource_id, after_state FROM audit_logs`)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'event_responses.redacted', user_id: null, resource_id: 'event-1' })
    expect(audits[0].after_state).toMatchObject({ reason: 'RETENTION', count: 2, by_category: { SENSITIVE: 1, THIRD_PARTY: 1 } })
    expect((audits[0].after_state.response_ids as string[]).length).toBe(2)
    expect(JSON.stringify(audits)).not.toMatch(/Step-free|Sam Contact|Accessibility|Emergency|Radio/)
    void orderId
  })
})
