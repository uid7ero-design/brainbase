import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { Client } from 'pg'
import fs from 'fs'
import path from 'path'

// PR #238 Production incident — real disposable-Postgres proof for
// lib/events/ticketEmailDeliveryTracking.ts's applyResendDeliveryWebhookEvent.
//
// This is NOT a duplicate of tests/containment/eventsTicketEmailDeliveryTracking.test.ts
// (which mocks @/lib/db entirely) — it exists specifically BECAUSE that
// mocked suite, and a static `EXPLAIN` of the statement with literal
// values substituted in place of parameters, both passed while the
// real function failed on every real invocation in Production
// (confirmed via a genuine Resend `email.delivered` webhook, replayed
// 9 times, every attempt returning HTTP 500 "Processing failed.").
//
// Root cause: applyResendDeliveryWebhookEvent's jsonb_build_object(...)
// call passed 4 bound parameters (outcome, providerMessageId, eventType,
// eventCreatedAt) directly as VARIADIC "any" arguments with no other
// context anywhere in the statement to infer a concrete type from.
// Postgres's extended query protocol cannot infer a parameter's type
// from a polymorphic-function argument position — this is a hard
// PARSE-time error (42P18 "could not determine data type of
// parameter"), not a data-dependent runtime failure, so it reproduced
// on literally every attempt regardless of payload.
//
// Why a mock can't catch this: the containment suite's sql mock never
// asks a real Postgres server to prepare/bind the statement — it just
// records the call. Why EXPLAIN alone can't catch it either: EXPLAIN
// against SQL text with literal values substituted for `$1` etc. has no
// bound parameters to fail to type — the ambiguity only exists when a
// real client sends the statement via the extended query protocol with
// genuine parameter placeholders. Only a real client speaking the real
// protocol against a real server proves this. Uses `pg` (a new,
// narrowly-scoped devDependency — see package.json) rather than
// @neondatabase/serverless's own Client/Pool, because those require
// Neon's own WebSocket/HTTP proxy infrastructure even to reach a local
// Postgres instance; parameter-type inference itself is governed by
// the Postgres server, not by which extended-protocol client asked for
// it, so this is a faithful, high-fidelity substitute for that one
// concern. Mirrors the established disposable-Postgres idiom already
// used elsewhere in this repo (see
// tests/containment/illegalDumpingAbandonedStatusSchema.test.ts) —
// never against Production/Preview, torn down after use.

const CONTAINER = `events-resend-webhook-delivery-vitest-${process.pid}`
const HOST_PORT = 55600 + (process.pid % 1000)

function dockerAvailable(): boolean {
  try {
    execSync('docker version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const HAS_DOCKER = dockerAvailable()

describe.runIf(HAS_DOCKER)('real disposable-Postgres proof — applyResendDeliveryWebhookEvent (PR #238 Production incident)', () => {
  let client: Client

  beforeAll(async () => {
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p ${HOST_PORT}:5432 postgres:17-alpine`,
      { stdio: 'ignore' },
    )
    let ready = false
    for (let i = 0; i < 30; i++) {
      // Ignore the image's socket-only temporary initialization server.
      const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])
      if (r.status === 0) { ready = true; break }
      await new Promise(r2 => setTimeout(r2, 1000))
    }
    if (!ready) throw new Error('postgres container did not become ready within 30s')

    client = new Client({ host: 'localhost', port: HOST_PORT, user: 'postgres', password: 'test', database: 'testdb' })
    await client.connect()

    // Minimal real-shaped schema: only what the composite/simple FKs
    // in the real migration (scripts/create-events-ticket-email-deliveries.sql)
    // require, plus the exact live audit_logs shape (confirmed against
    // Production this session via describe_table_schema) — not a
    // rewrite of the statement itself, only its dependencies.
    await client.query(`
      CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      -- Phase 5B: event_notifications (applied below from the REAL
      -- migration file) carries a composite FK onto events(id,
      -- organisation_id) — the minimal shape that FK needs.
      CREATE TABLE events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organisation_id TEXT NOT NULL REFERENCES organisations(id),
        status TEXT NOT NULL DEFAULT 'DRAFT',
        CONSTRAINT events_id_organisation_id_key UNIQUE (id, organisation_id)
      );
      CREATE TABLE event_orders (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organisation_id TEXT NOT NULL REFERENCES organisations(id),
        CONSTRAINT event_orders_id_organisation_id_key UNIQUE (id, organisation_id)
      );
      CREATE TABLE event_ticket_email_deliveries (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organisation_id       TEXT NOT NULL REFERENCES organisations(id),
        order_id              TEXT NOT NULL,
        send_source           TEXT NOT NULL CHECK (send_source IN ('automatic', 'manual')),
        provider_message_id   TEXT NOT NULL,
        delivery_status       TEXT NOT NULL DEFAULT 'accepted'
                                CHECK (delivery_status IN ('accepted', 'delivered', 'bounced', 'suppressed', 'complained', 'failed')),
        latest_event_id       TEXT,
        latest_event_at       TIMESTAMPTZ,
        latest_event_type     TEXT,
        accepted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        delivered_at          TIMESTAMPTZ,
        bounced_at            TIMESTAMPTZ,
        suppressed_at         TIMESTAMPTZ,
        complained_at         TIMESTAMPTZ,
        failed_at             TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT event_ticket_email_deliveries_order_org_fkey
          FOREIGN KEY (order_id, organisation_id)
          REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_event_ticket_email_deliveries_provider_message_id ON event_ticket_email_deliveries (provider_message_id);
      CREATE TABLE audit_logs (
        id text NOT NULL PRIMARY KEY,
        organisation_id text NOT NULL REFERENCES organisations(id) ON UPDATE CASCADE ON DELETE CASCADE,
        user_id text NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id text NULL,
        before_state jsonb NULL,
        after_state jsonb NULL,
        ip_address text NULL,
        user_agent text NULL,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO organisations (id, name) VALUES ('org-a', 'Org A');
      INSERT INTO events (id, organisation_id, status) VALUES ('event-a', 'org-a', 'PUBLISHED');
      INSERT INTO event_orders (id, organisation_id) VALUES ('order-a', 'org-a');
    `)
    // Phase 5B — the real migration, verbatim: the widened statement under
    // test now also updates event_notifications in the same CTE, so the
    // table must exist with its real constraints/indexes.
    await client.query(fs.readFileSync(path.join(process.cwd(), 'scripts/create-events-notifications.sql'), 'utf8').replace(/\r\n/g, '\n'))
  }, 120_000)

  afterAll(async () => {
    await client?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(() => {
    vi.resetModules()
    // Adapter matching lib/db.ts's own tagged-template shape
    // (`sql\`...${v}...\``) — converts each interpolation into a real
    // positional bound parameter ($1, $2, ...) executed via pg's
    // extended query protocol, the same binding mechanism
    // @neondatabase/serverless's own neon() HTTP driver delegates to
    // server-side (confirmed this session by reading its compiled
    // source: interpolated values are collected into a `params` array
    // and sent for the Neon proxy to bind, not literal-substituted).
    vi.doMock('@/lib/db', () => ({
      default: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        let text = strings[0]
        const params: unknown[] = []
        values.forEach((v, i) => { params.push(v); text += `$${i + 1}${strings[i + 1]}` })
        const result = await client.query(text, params)
        return result.rows
      },
    }))
  })

  async function insertAcceptedRow(providerMessageId: string) {
    await client.query(
      "INSERT INTO event_ticket_email_deliveries (id, organisation_id, order_id, send_source, provider_message_id, delivery_status) VALUES ($1, 'org-a', 'order-a', 'automatic', $2, 'accepted')",
      [`delivery-${providerMessageId}`, providerMessageId],
    )
  }

  it('R1. accepted -> delivered succeeds against real Postgres with genuine bound parameters (this is the exact call that returned HTTP 500 in Production before the fix)', async () => {
    await insertAcceptedRow('msg-r1')
    const { applyResendDeliveryWebhookEvent } = await import('@/lib/events/ticketEmailDeliveryTracking')

    const result = await applyResendDeliveryWebhookEvent({
      providerMessageId: 'msg-r1',
      outcome: 'delivered',
      eventId: 'svix-r1',
      eventType: 'email.delivered',
      eventCreatedAt: '2026-09-23T10:51:37.043Z',
    })
    expect(result).toEqual({ applied: true })

    const row = (await client.query(
      'SELECT delivery_status, delivered_at, latest_event_id, latest_event_at, latest_event_type FROM event_ticket_email_deliveries WHERE provider_message_id = $1',
      ['msg-r1'],
    )).rows[0]
    expect(row.delivery_status).toBe('delivered')
    expect(row.delivered_at).not.toBeNull()
    expect(row.latest_event_id).toBe('svix-r1')
    expect(row.latest_event_at).not.toBeNull()
    expect(row.latest_event_type).toBe('email.delivered')

    const rowCount = await client.query('SELECT count(*)::int AS n FROM event_ticket_email_deliveries WHERE provider_message_id = $1', ['msg-r1'])
    expect(rowCount.rows[0].n).toBe(1)

    const audit = await client.query(
      "SELECT action, after_state FROM audit_logs WHERE resource_id = 'order-a' AND action = 'event_order.ticket_email_delivered' AND after_state->>'provider_message_id' = $1",
      ['msg-r1'],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].after_state).toMatchObject({
      source: 'resend_webhook',
      delivery_status: 'delivered',
      provider_message_id: 'msg-r1',
      send_source: 'automatic',
      event_type: 'email.delivered',
    })
  })

  it('R2. replaying the exact same event (same eventId) is idempotent — no duplicate audit, delivery_status unchanged', async () => {
    await insertAcceptedRow('msg-r2')
    const { applyResendDeliveryWebhookEvent } = await import('@/lib/events/ticketEmailDeliveryTracking')

    const params = {
      providerMessageId: 'msg-r2',
      outcome: 'delivered' as const,
      eventId: 'svix-r2',
      eventType: 'email.delivered',
      eventCreatedAt: '2026-09-23T10:51:37.043Z',
    }
    const first = await applyResendDeliveryWebhookEvent(params)
    const second = await applyResendDeliveryWebhookEvent(params)
    expect(first).toEqual({ applied: true })
    expect(second).toEqual({ applied: false })

    const audit = await client.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = 'order-a' AND action = 'event_order.ticket_email_delivered' AND after_state->>'provider_message_id' = $1",
      ['msg-r2'],
    )
    expect(audit.rows[0].n).toBe(1)
  })

  // ─── Phase 5B — the same statement, resolving a lifecycle notification ──

  async function insertSentNotification(providerMessageId: string, type = 'EVENT_CANCELLED') {
    await client.query(
      `INSERT INTO event_notifications (id, organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key, status, sent_at, provider_message_id, delivery_status)
       VALUES ($1, 'org-a', 'event-a', 'order-a', $2, 'p@example.com', $3, 'sent', now(), $4, 'accepted')`,
      [`notification-${providerMessageId}`, type, `event-notification:${type}:order-a:${providerMessageId}`, providerMessageId],
    )
  }

  it('N1. a Resend id that belongs to a lifecycle notification resolves to event_notifications (accepted -> delivered), writes exactly one event_order.notification_delivered audit row, and touches no ticket-email row', async () => {
    await insertSentNotification('msg-n1')
    const { applyResendDeliveryWebhookEvent } = await import('@/lib/events/ticketEmailDeliveryTracking')
    const result = await applyResendDeliveryWebhookEvent({
      providerMessageId: 'msg-n1', outcome: 'delivered', eventId: 'svix-n1', eventType: 'email.delivered', eventCreatedAt: '2026-10-17T01:00:00.000Z',
    })
    expect(result).toEqual({ applied: true })
    const row = (await client.query('SELECT delivery_status, delivered_at, latest_event_id, latest_event_type, status FROM event_notifications WHERE provider_message_id = $1', ['msg-n1'])).rows[0]
    expect(row.delivery_status).toBe('delivered')
    expect(row.delivered_at).not.toBeNull()
    expect(row.latest_event_id).toBe('svix-n1')
    expect(row.status).toBe('sent') // the send lifecycle is never rewritten by a provider report
    const audit = await client.query("SELECT action, after_state FROM audit_logs WHERE action = 'event_order.notification_delivered' AND after_state->>'provider_message_id' = $1", ['msg-n1'])
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].after_state).toMatchObject({ source: 'resend_webhook', delivery_status: 'delivered', notification_type: 'EVENT_CANCELLED', notification_id: 'notification-msg-n1', event_type: 'email.delivered' })
    const ticketRows = await client.query('SELECT count(*)::int AS n FROM event_ticket_email_deliveries WHERE provider_message_id = $1', ['msg-n1'])
    expect(ticketRows.rows[0].n).toBe(0)
  })

  it('N2. replaying the exact same notification event is idempotent (applied false, one audit row), and a later event can never regress a terminal outcome', async () => {
    await insertSentNotification('msg-n2')
    const { applyResendDeliveryWebhookEvent } = await import('@/lib/events/ticketEmailDeliveryTracking')
    const bounced = { providerMessageId: 'msg-n2', outcome: 'bounced' as const, eventId: 'svix-n2', eventType: 'email.bounced', eventCreatedAt: '2026-10-17T01:00:00.000Z' }
    expect(await applyResendDeliveryWebhookEvent(bounced)).toEqual({ applied: true })
    expect(await applyResendDeliveryWebhookEvent(bounced)).toEqual({ applied: false })
    expect(await applyResendDeliveryWebhookEvent({ ...bounced, outcome: 'delivered', eventId: 'svix-n2-later', eventType: 'email.delivered', eventCreatedAt: '2026-10-17T02:00:00.000Z' })).toEqual({ applied: false })
    const row = (await client.query('SELECT delivery_status, bounced_at FROM event_notifications WHERE provider_message_id = $1', ['msg-n2'])).rows[0]
    expect(row.delivery_status).toBe('bounced')
    expect(row.bounced_at).not.toBeNull()
    const audit = await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'event_order.notification_%' AND after_state->>'provider_message_id' = $1", ['msg-n2'])
    expect(audit.rows[0].n).toBe(1)
  })

  it('N3. a ticket-email id still resolves ONLY to the ticket table after the widening — no notification row is created or touched', async () => {
    await insertAcceptedRow('msg-n3')
    const { applyResendDeliveryWebhookEvent } = await import('@/lib/events/ticketEmailDeliveryTracking')
    expect(await applyResendDeliveryWebhookEvent({ providerMessageId: 'msg-n3', outcome: 'delivered', eventId: 'svix-n3', eventType: 'email.delivered', eventCreatedAt: '2026-10-17T01:00:00.000Z' })).toEqual({ applied: true })
    const n = await client.query('SELECT count(*)::int AS n FROM event_notifications WHERE provider_message_id = $1', ['msg-n3'])
    expect(n.rows[0].n).toBe(0)
    const audit = await client.query("SELECT action FROM audit_logs WHERE after_state->>'provider_message_id' = $1", ['msg-n3'])
    expect(audit.rows.map(r => r.action)).toEqual(['event_order.ticket_email_delivered'])
  })

  it.each(['bounced', 'suppressed', 'complained', 'failed'] as const)(
    'R3.%s — every outcome shares the same jsonb_build_object path and is fixed by the same cast',
    async outcome => {
      const providerMessageId = `msg-r3-${outcome}`
      await insertAcceptedRow(providerMessageId)
      const { applyResendDeliveryWebhookEvent } = await import('@/lib/events/ticketEmailDeliveryTracking')

      const result = await applyResendDeliveryWebhookEvent({
        providerMessageId,
        outcome,
        eventId: `svix-${outcome}`,
        eventType: `email.${outcome}`,
        eventCreatedAt: '2026-09-23T10:51:37.043Z',
      })
      expect(result).toEqual({ applied: true })

      const row = (await client.query('SELECT delivery_status FROM event_ticket_email_deliveries WHERE provider_message_id = $1', [providerMessageId])).rows[0]
      expect(row.delivery_status).toBe(outcome)
    },
  )
})
