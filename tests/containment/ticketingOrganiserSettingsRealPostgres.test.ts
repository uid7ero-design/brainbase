import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve Phase 3.4 organiser Settings (read-only).
// Runs the ACTUAL read module, the REAL fee resolver and the REAL Connect
// readers against PostgreSQL 17 with the real migration set; only
// authorization (covered in ticketingOrganiserSettings.test.ts) is stubbed.
// Proves: tenant scoping, the event > organisation > platform-default
// precedence the checkout uses, disabled-row semantics, cached Connect state
// without the account id, branding coercion on real JSONB, and that reading
// writes nothing. Never against Production/Preview — a disposable container.

const CONTAINER = `ticketing-settings-vitest-${process.pid}`
const HOST_PORT = 60700 + (process.pid % 1000)
function dockerAvailable(): boolean { try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false } }
const HAS_DOCKER = dockerAvailable()

const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool, org: 'org-plain' }))

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
vi.mock('@/lib/events/organiserPayments', () => ({ listPaymentOrders: vi.fn(), getPaymentOrder: vi.fn() }))
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
  'scripts/add-eve-registration-questions.sql',
  'scripts/add-events-booking-wallet.sql',
  'scripts/add-events-ticket-email-delivery.sql',
  'scripts/create-events-ticket-type-session-inventory.sql',
  'scripts/create-events-promotions-presales-sale-windows.sql',
  'scripts/create-events-ticketing-fees-foundation.sql',
  'scripts/add-events-order-product-surface.sql',
]

describe.runIf(HAS_DOCKER)('real Postgres — organiser Settings (read-only)', () => {
  let org: typeof import('@/lib/ticketing/organiserApi')
  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const req = (qs = '') => new Request(`http://bb.test/x${qs}`)
  const get = async (o: string, qs = '') => { db.org = o; return org.handleOrganiserSettings(req(qs)) }
  const body = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

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
      `CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, settings JSONB NOT NULL DEFAULT '{}');`,
      `CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE CASCADE, username TEXT UNIQUE, name TEXT);`,
      ...MIGRATIONS.map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')),
      // org-plain: historical/default (no settings, no policy, not connected)
      `INSERT INTO organisations (id, name, slug) VALUES ('org-plain','Plain Org','plain');`,
      // org-full: connected, org-level PASS_THROUGH, one event ABSORB override, one event inherits, configured branding
      `INSERT INTO organisations (id, name, slug, settings, stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_connected_at)
         VALUES ('org-full','Full Org','full',
           '{"branding":{"name":"Full Presents","logoUrl":"https://blob.example/private/SECRETTOKEN.png","accentColor":"#112233","email":"help@full.example","phone":"0400 111 222","website":"https://full.example","address":"1 Secret St","abn":"12 345 678 901","emailFooter":"Thanks!"},"commercial":{"x":1}}',
           'acct_SECRET_FULL','CONNECTED', true, true, true, now());`,
      // org-setup: onboarding, org-level policy DISABLED
      `INSERT INTO organisations (id, name, slug, stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted)
         VALUES ('org-setup','Setup Org','setup','acct_SECRET_SETUP','ONBOARDING', false, false, false);`,
      `INSERT INTO organisations (id, name, slug) VALUES ('org-other','Other Org','other');`,
      `INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
         ('ev-full-1','org-full','Gala','gala','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide'),
         ('ev-full-2','org-full','Workshop','workshop','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide'),
         ('ev-other','org-other','Other Event','other-ev','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide'),
         ('ev-setup','org-setup','Setup Event','setup-ev','PUBLISHED', now(), now() + interval '2 hours','Australia/Adelaide');`,
      `INSERT INTO ticketing_fee_policies (id, organisation_id, event_id, enabled, fee_mode, percent_bps, fixed_per_order_cents, label) VALUES
         ('pol-full-org','org-full', NULL, true, 'PASS_THROUGH', 250, 30, 'Booking fee'),
         ('pol-full-ev1','org-full', 'ev-full-1', true, 'ABSORB', 100, 0, 'Platform fee'),
         ('pol-setup-org','org-setup', NULL, false, 'PASS_THROUGH', 250, 30, 'Booking fee');`,
    ]
    for (const stmt of schema) await db.pool.query(stmt)
    org = await import('@/lib/ticketing/organiserApi')
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  it('historical/default organisation: no fee (platform default), no branding, not connected', async () => {
    const b = await body(await get('org-plain'))
    expect(b.organisation).toEqual({ name: 'Plain Org', slug: 'plain' })
    expect(b.events_capability).toEqual({ enabled: true })
    expect(b.fees.effective).toEqual({ state: 'NO_FEE', source: 'PLATFORM_DEFAULT', reason: 'NOT_CONFIGURED' })
    expect(b.fees.event_overrides_count).toBe(0)
    expect(b.branding).toMatchObject({ configured: false, display_name: 'Plain Org', logo_configured: false })
    expect(b.connect).toMatchObject({ status: 'NOT_CONNECTED', connected: false, eligible_for_paid_ticketing: false })
    expect(b.ticketing).toEqual({ paid_ticketing_available: false })
  })

  it('connected organisation: cached state, eligibility from the checkout rule, branding coerced, nothing secret returned', async () => {
    const b = await body(await get('org-full'))
    expect(b.connect).toMatchObject({ status: 'CONNECTED', connected: true, charges_enabled: true, payouts_enabled: true, eligible_for_paid_ticketing: true })
    expect(b.ticketing.paid_ticketing_available).toBe(true)
    expect(b.branding).toMatchObject({ configured: true, display_name: 'Full Presents', logo_configured: true, accent_color: '#112233', website: 'https://full.example', support_email: 'help@full.example' })
    expect(JSON.stringify(b)).not.toMatch(/acct_|SECRET|blob\.example|1 Secret St|12 345 678|commercial|pol-full|stripe_/)
  })

  it('organisation-level fee policy and the number of per-event overrides', async () => {
    const b = await body(await get('org-full'))
    expect(b.fees.scope).toEqual({ level: 'ORGANISATION', event: null })
    expect(b.fees.effective).toMatchObject({ state: 'FEE', source: 'ORGANISATION', fee_mode: 'PASS_THROUGH', paid_by: 'BUYER', percent_bps: 250, fixed_per_order_cents: 30, label: 'Booking fee', currency: 'AUD' })
    expect(b.fees.event_overrides_count).toBe(1)
  })

  it('event scope uses the checkout precedence: an event row wins; an event without one inherits the organisation row', async () => {
    const e1 = await body(await get('org-full', '?event=ev-full-1'))
    expect(e1.fees.scope).toEqual({ level: 'EVENT', event: { id: 'ev-full-1', name: 'Gala' } })
    expect(e1.fees.effective).toMatchObject({ source: 'EVENT', fee_mode: 'ABSORB', paid_by: 'ORGANISER', percent_bps: 100, label: 'Platform fee' })
    const e2 = await body(await get('org-full', '?event=ev-full-2'))
    expect(e2.fees.effective).toMatchObject({ source: 'ORGANISATION', fee_mode: 'PASS_THROUGH' })
  })

  it('a DISABLED organisation row is "no fee (disabled)", not the platform default; onboarding state is reported without the account id', async () => {
    const b = await body(await get('org-setup'))
    expect(b.fees.effective).toEqual({ state: 'NO_FEE', source: 'ORGANISATION', reason: 'DISABLED' })
    expect(b.connect).toMatchObject({ status: 'ONBOARDING', connected: true, charges_enabled: false, eligible_for_paid_ticketing: false })
    expect(JSON.stringify(b)).not.toMatch(/acct_/)
  })

  it('another tenant\'s event id is a 404 and never reveals the other organisation or its policy', async () => {
    const res = await get('org-full', '?event=ev-other')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toMatch(/Other/)
    expect((await get('org-plain', '?event=ev-full-1')).status).toBe(404)
  })

  it('reading changes nothing', async () => {
    const snap = async () => JSON.stringify([await q(`SELECT * FROM organisations ORDER BY id`), await q(`SELECT * FROM ticketing_fee_policies ORDER BY id`)])
    const before = await snap()
    for (const o of ['org-plain', 'org-full', 'org-setup']) await get(o)
    await get('org-full', '?event=ev-full-1')
    expect(await snap()).toBe(before)
  })
})
