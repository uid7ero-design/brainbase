import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { PostgresAvailabilityRepository, PostgresReservationRepository, fromPgLike } from '@scheduling/postgres';
import { slotBooking, person } from '../../packages/scheduling-postgres/tests/support/builders';
import { FixedClock, closePool, seedOffering, seedResource, seedSchedule, staff } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3b: the staff facility-hire API through the REAL chain, over a DISPOSABLE PostgreSQL (run by scripts/tests/verify-scheduling-phase2c.sh for 16 and 17): signed session cookie
// -> middleware.ts -> the route -> schedulingRoute() (kill switch, organisation capability, base capability, role permission) -> the REAL runtime and host SQL executor (the statement
// recorder with its forwarded transaction) -> the REAL PostgresHireRepository and reservation repository -> the real tables, triggers and the 037 version rows.
// Replaced: the Next cookie store, and `@/lib/db`, which is the Neon HTTP driver. The replacement behaves like the driver where it matters here: sql.query() returns a LAZY query object and
// sql.transaction([...]) is the only atomic batch (BEGIN ... COMMIT on one connection). It can also lose the reply of a committed batch and fail a batch before it is sent.
//
// Proves: the flag matrix, the permission matrix, tenant isolation, idempotent replay and payload conflicts, concurrent overlap and same-key races, stale versions and offering edits,
// cancellation and hold release, lost replies and failures before send, lock contention, audit content and audit failure, DST, and that every refused request leaves every table byte-identical.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = 'test-only-session-secret-for-the-disposable-staff-booking-matrix-0123456789';
  return { cookie: null as string | null, loseNextBatchReply: false, failNextBatchBeforeSend: false, failAudit: false, batches: 0, unexpected: null as null | 'before' | 'during' | 'after' };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'session' && state.cookie ? { name, value: state.cookie } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
}));
vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 40 });
  p.on('error', () => undefined);
  const run = (text: string, params: unknown[]) => {
    if (state.unexpected === 'before' && /idempotency_key = \$2/i.test(text)) {
      state.unexpected = null;
      return Promise.reject(Object.assign(new Error('internal error'), { code: 'XX000' })); // BEFORE anything is written
    }
    if (state.failAudit && /INSERT INTO audit_logs/i.test(text)) return Promise.reject(Object.assign(new Error('audit store down'), { code: '08006' }));
    return p.query(text, params).then(r => r.rows);
  };
  type Lazy = { text: string; params: unknown[]; then: (a: (v: unknown[]) => unknown, b?: (e: unknown) => unknown) => Promise<unknown> };
  const query = (text: string, params: unknown[] = []): Lazy => ({ text, params, then: (a, b) => run(text, params).then(a, b) });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const transaction = async (queries: Lazy[]) => {
    state.batches += 1;
    if (state.failNextBatchBeforeSend) {
      state.failNextBatchBeforeSend = false;
      throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
    }
    // Phase 2C.3c-A: an UNCLASSIFIED server error (SQLSTATE XX000: the repository rethrows it) before any write, in the middle of the batch, and a committed batch whose reply cannot be read. The handler must reconcile by the key. (An error with NO SQLSTATE is already "unknown" inside the repository and is resolved there.)
    const fault = state.unexpected === 'before' ? null : state.unexpected;
    if (fault) state.unexpected = null;
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      const out: unknown[] = [];
      for (const q of queries) {
        out.push((await c.query(q.text, q.params)).rows);
        if (fault === 'during') throw Object.assign(new Error('internal error'), { code: 'XX000' }); // after the first statement: rolled back below, nothing is written
      }
      await c.query('COMMIT');
      // AFTER the commit the reply is unusable (a row the repository cannot read: it throws a TypeError): an unclassified error although the booking IS written
      if (fault === 'after') return [...out.slice(0, -1), [null]];
      if (state.loseNextBatchReply) {
        state.loseNextBatchReply = false; // the batch COMMITTED; the reply never reaches the caller
        throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
      }
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  };
  return { default: Object.assign(tag, { query, transaction }) };
});

const { middleware } = await import('@/middleware');
const { encrypt } = await import('@/lib/session');
type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const collection = (await import('@/app/api/scheduling/reservations/route')) as unknown as { POST: Handler; GET: Handler };
const one = (await import('@/app/api/scheduling/reservations/[reservationId]/route')) as unknown as { GET: Handler };
const cancelRoute = (await import('@/app/api/scheduling/reservations/[reservationId]/cancel/route')) as unknown as { POST: Handler };

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');

const TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules', 'scheduling_availability_exceptions',
  'scheduling_availability_zones', 'scheduling_availability_versions', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences', 'scheduling_series',
  'scheduling_series_pauses', 'scheduling_settings', 'organisations', 'organisation_modules', 'users', 'organisation_user_access', 'audit_logs',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of TABLES) out.push((await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`))[0].h);
  return out;
};

type Person = { id: string; org: string; role: string; access: Record<string, string> | null };
const PEOPLE: Record<string, Person> = {
  manager: { id: 'u-manager', org: 'org-a', role: 'manager', access: { scheduling: 'use' } },
  admin: { id: 'u-admin', org: 'org-a', role: 'admin', access: { scheduling: 'use' } },
  unmanaged: { id: 'u-unmanaged', org: 'org-a', role: 'manager', access: null },
  managerViewOnly: { id: 'u-manager-view', org: 'org-a', role: 'manager', access: { scheduling: 'view' } },
  viewer: { id: 'u-viewer', org: 'org-a', role: 'viewer', access: { scheduling: 'view' } },
  analyst: { id: 'u-analyst', org: 'org-a', role: 'analyst', access: { scheduling: 'view' } },
  noCap: { id: 'u-nocap', org: 'org-c', role: 'manager', access: { scheduling: 'use' } },
  other: { id: 'u-other', org: 'org-b', role: 'manager', access: { scheduling: 'use' } },
};
const signIn = async (p: Person) => {
  state.cookie = await encrypt({ userId: p.id, organisationId: p.org, role: p.role as never, name: p.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
};
const signOut = () => { state.cookie = null; };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Outcome { status: number; json: Json; text: string; by: 'middleware' | 'route'; headers: Headers }
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };

async function call(handlerName: 'POST' | 'GET', route: { POST?: Handler; GET?: Handler }, url: string, init: { body?: unknown; headers?: Record<string, string>; params?: Record<string, string>; rawBody?: string } = {}): Promise<Outcome> {
  const headers: Record<string, string> = { ...(init.body !== undefined || init.rawBody !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) };
  if (state.cookie) headers.cookie = `session=${state.cookie}`;
  const body = init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
  const gate = await middleware(new NextRequest(url, { method: handlerName, headers, ...(body !== undefined ? { body } : {}) }));
  if (gate.headers.get('x-middleware-next') !== '1') {
    const text = await gate.text();
    return { status: gate.status, json: text ? safeJson(text) : null, text, by: 'middleware', headers: gate.headers };
  }
  const response = await route[handlerName]!(new Request(url, { method: handlerName, headers, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve(init.params ?? {}) });
  const text = await response.text();
  return { status: response.status, json: text ? safeJson(text) : null, text, by: 'route', headers: response.headers };
}

let keySeq = 0;
const newKey = () => `it-key-${String(++keySeq).padStart(6, '0')}-${Math.random().toString(36).slice(2, 10)}`;
const BASE = 'http://bb.test/api/scheduling/reservations';
const create = (body: unknown, key: string | null = newKey()) => call('POST', collection, BASE, { body, ...(key ? { headers: { 'idempotency-key': key } } : {}) });
const getById = (id: string) => call('GET', one, `${BASE}/${id}`, { params: { reservationId: id } });
const getByKey = (key: string) => call('GET', collection, `${BASE}?idempotencyKey=${key}`);
const cancel = (id: string, body?: unknown) => call('POST', cancelRoute, `${BASE}/${id}/cancel`, { ...(body !== undefined ? { body } : {}), params: { reservationId: id } });

// Dates: always in the future of the REAL clock (the routes use the system clock).
function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const MONDAY = nextWeekday(1, 40);
const MONDAY2 = nextWeekday(1, 54);
const body = (over: Record<string, unknown> = {}) => ({
  offeringId: 'a-off', resourceId: 'a-court-1', start: { date: MONDAY, time: '10:00' }, durationMinutes: 60, partySize: 2,
  customer: { name: 'Hirer Person', email: 'hirer.person@example.com', phone: '0400 123 456' }, notes: 'bring the key to gate 4', ...over,
});
const SECRETS = ['Hirer Person', 'hirer.person', 'example.com', '0400 123 456', 'gate 4', 'Zed Other', 'zed.other'];
const liveHolds = (org = 'org-a') => q<{ n: number }>(`SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND released_at IS NULL`, [org]).then(r => r[0].n);
const reservations = (org = 'org-a') => q<{ n: number }>(`SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1`, [org]).then(r => r[0].n);
const auditRows = (action?: string) => q<{ action: string; resource_id: string; user_id: string; after_state: Json; organisation_id: string }>(`SELECT action, resource_id, user_id, after_state, organisation_id FROM audit_logs WHERE action LIKE 'scheduling.reservation.%' ${action ? 'AND action = $1' : ''} ORDER BY created_at`, action ? [action] : []);
const overlappingLiveHolds = async () => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during WHERE a.released_at IS NULL AND b.released_at IS NULL`))[0].n;

const hours = (dayOfWeek: number, start = '09:00', end = '17:00') => ({ kind: 'hours' as const, label: null, dayOfWeek, startTime: start, endTime: end, validFrom: null, validTo: null });
const TZ = 'Australia/Adelaide';
let avail: PostgresAvailabilityRepository;

suite('Scheduling 2C.3b staff booking: gates, permissions, isolation and concurrency through the real chain', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 20 });
    pool.on('error', () => undefined);
    for (const f of ['034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql']) await pool.query(sqlFile(f));
    if (!(await q<{ r: string | null }>("SELECT to_regclass('scheduling_availability_versions')::text AS r"))[0].r) await pool.query(sqlFile('037_availability_versions.sql'));
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS organisation_user_access (user_id TEXT PRIMARY KEY REFERENCES users(id), organisation_id TEXT NOT NULL REFERENCES organisations(id),
         permissions JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL REFERENCES users(id))`,
    );
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(pool) });
  }, 90_000);
  afterAll(async () => {
    await pool?.query('DROP TABLE IF EXISTS organisation_user_access').catch(() => undefined);
    await pool?.end();
    await closePool();
  });

  beforeEach(async () => {
    process.env.SCHEDULING_STAFF_BOOKING = 'on';
    signOut();
    state.loseNextBatchReply = false;
    state.failNextBatchBeforeSend = false;
    state.failAudit = false;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_series_pauses, scheduling_series, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_availability_zones, scheduling_availability_exceptions, scheduling_availability_rules, scheduling_availability_versions, scheduling_settings CASCADE');
    await q('DELETE FROM organisation_user_access');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM audit_logs');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    await q("INSERT INTO modules (key, name, description, active) VALUES ('scheduling.staff_booking', 'Scheduling staff booking (test)', 'test', true) ON CONFLICT (key) DO UPDATE SET active = true");
    for (const [id, tz] of [['org-a', TZ], ['org-b', TZ], ['org-c', TZ]] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [id]);
    }
    // the second entitlement: org-a and org-b hold it; org-c (base scheduling only) does not
    for (const org of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling.staff_booking', true)", [org]);
    for (const p of Object.values(PEOPLE)) await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $1, $4)', [p.id, p.org, `${p.id}@example.test`, p.role]);
    for (const p of Object.values(PEOPLE)) if (p.access) await q('INSERT INTO organisation_user_access (user_id, organisation_id, permissions, updated_by) VALUES ($1, $2, $3::jsonb, $1)', [p.id, p.org, JSON.stringify(p.access)]);
    await seedHire('org-a', 'a');
    await seedHire('org-b', 'b');
    await signIn(PEOPLE.manager);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A facility hire: schedule, a 60-minute offering, two courts linked, hours Monday 09:00-17:00 for the offering and each court (zones pinned). */
  async function seedHire(org: string, p: string) {
    await seedSchedule(org, `${p}-hire`, 'resource_hire');
    await seedOffering(org, `${p}-off`, `${p}-hire`, { capacity: null, durationMinutes: 60 });
    for (const c of [`${p}-court-1`, `${p}-court-2`]) {
      await seedResource(org, c, 'court');
      await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, `${p}-off`, c]);
    }
    for (const owner of [{ kind: 'offering' as const, id: `${p}-off` }, { kind: 'resource' as const, id: `${p}-court-1` }, { kind: 'resource' as const, id: `${p}-court-2` }]) {
      for (const day of [1, 0]) {
        const r = await avail.createRule(staff(org), owner, hours(day, day === 1 ? '09:00' : '00:00', day === 1 ? '17:00' : '12:00'), TZ);
        if (!r.ok) throw new Error(`seed rule: ${JSON.stringify(r)}`);
      }
    }
  }
  const bodyFor = (p: 'a' | 'b', over: Record<string, unknown> = {}) => body({ offeringId: `${p}-off`, resourceId: `${p}-court-1`, ...over });

  // ── gates ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('gates: the kill switch and the organisation capability, both default OFF', () => {
    it('with the switch off (unset, "off", "ON", "true") every route answers 404 for a signed-in manager, and every table is byte-identical afterwards', async () => {
      const before = await hashAll();
      for (const value of [undefined, '', 'off', 'ON', 'true']) {
        if (value === undefined) delete process.env.SCHEDULING_STAFF_BOOKING;
        else process.env.SCHEDULING_STAFF_BOOKING = value;
        for (const r of [await create(body()), await getById('res-1'), await getByKey(newKey()), await cancel('res-1')]) {
          expect(r.status, String(value)).toBe(404);
          expect(r.json).toEqual({ error: 'not_found' });
          expect(r.headers.get('cache-control')).toBe('no-store');
        }
      }
      expect(await hashAll()).toEqual(before);
    });

    it('with the switch off an anonymous caller also gets the middleware answer for the session, never a booking; with it on the switch is irrelevant to anonymous users (401)', async () => {
      signOut();
      process.env.SCHEDULING_STAFF_BOOKING = 'on';
      const r = await create(body());
      expect(r.status).toBe(401);
      expect(await reservations()).toBe(0);
    });

    it('an organisation WITHOUT scheduling.staff_booking gets 404 although it has the base scheduling capability and the switch is on; nothing is written', async () => {
      await signIn(PEOPLE.noCap);
      const before = await hashAll();
      for (const r of [await create(bodyFor('a')), await getById('x'), await getByKey(newKey()), await cancel('x')]) expect(r.status).toBe(404);
      expect(await hashAll()).toEqual(before);
    });

    it('disabling the organisation row (enabled = false), or deactivating the module for everyone, closes it again', async () => {
      expect((await create(body())).status).toBe(201);
      await q("UPDATE organisation_modules SET enabled = false WHERE organisation_id = 'org-a' AND module_key = 'scheduling.staff_booking'");
      expect((await create(body({ start: { date: MONDAY, time: '12:00' } }))).status).toBe(404);
      await q("UPDATE organisation_modules SET enabled = true WHERE organisation_id = 'org-a' AND module_key = 'scheduling.staff_booking'");
      expect((await create(body({ start: { date: MONDAY, time: '12:00' } }))).status).toBe(201);
      await q("UPDATE modules SET active = false WHERE key = 'scheduling.staff_booking'");
      expect((await create(body({ start: { date: MONDAY, time: '14:00' } }))).status).toBe(404);
    });

    it('an unregistered capability (no modules row at all, which is the state of every organisation today) is denied', async () => {
      await q("DELETE FROM organisation_modules WHERE module_key = 'scheduling.staff_booking'");
      await q("DELETE FROM modules WHERE key = 'scheduling.staff_booking'");
      expect((await create(body())).status).toBe(404);
      expect(await reservations()).toBe(0);
    });
  });

  // ── permissions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('permissions: manager, admin and an unmanaged manager may; viewer, analyst, view-only users and anonymous may not', () => {
    for (const who of ['manager', 'admin', 'unmanaged'] as const) {
      it(`${who} creates (201), reads (200) and cancels (200)`, async () => {
        await signIn(PEOPLE[who]);
        const created = await create(body());
        expect(created.status).toBe(201);
        const id = created.json.reservation.id;
        expect((await getById(id)).status).toBe(200);
        expect((await cancel(id)).status).toBe(200);
      });
    }

    for (const who of ['viewer', 'analyst', 'managerViewOnly'] as const) {
      it(`${who} is refused (403) on every route, sees no customer data, and writes nothing`, async () => {
        await signIn(PEOPLE.manager);
        const made = await create(body());
        const id = made.json.reservation.id;
        const key = (await q<{ idempotency_key: string }>('SELECT idempotency_key FROM scheduling_reservations'))[0].idempotency_key;
        await signIn(PEOPLE[who]);
        const before = await hashAll();
        for (const r of [await create(body({ start: { date: MONDAY, time: '13:00' } })), await getById(id), await getByKey(key), await cancel(id)]) {
          expect(r.status, who).toBe(403);
          for (const secret of [...SECRETS, id, 'a-court-1', 'a-off', key]) expect(r.text).not.toContain(secret);
        }
        expect(await hashAll()).toEqual(before);
      });
    }

    it('anonymous callers are stopped by the middleware (401) on every route', async () => {
      signOut();
      for (const r of [await create(body()), await getById('x'), await getByKey(newKey()), await cancel('x')]) {
        expect(r.status).toBe(401);
      }
    });

    it('a body that names an organisation is refused, and a foreign organisation can never be addressed', async () => {
      const r = await create({ ...body(), organisationId: 'org-b' });
      expect(r.status).toBe(400);
      expect(r.json.problems).toContain('organisationId');
      const q2 = await create({ ...body(), organisation_id: 'org-b' });
      expect(q2.status).toBe(400);
      expect(await reservations('org-b')).toBe(0);
      expect(await reservations('org-a')).toBe(0);
    });
  });

  // ── tenant isolation ────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it("org-b's manager cannot book org-a's offering, resource, or read, find or cancel org-a's reservation: all are the same 404", async () => {
      const mine = await create(body());
      const id = mine.json.reservation.id;
      const key = (await q<{ idempotency_key: string }>('SELECT idempotency_key FROM scheduling_reservations'))[0].idempotency_key;
      await signIn(PEOPLE.other);
      const before = await hashAll();
      const foreignOffering = await create(body());
      expect(foreignOffering.status).toBe(404);
      expect(foreignOffering.json.code).toBe('NOT_FOUND');
      expect((await create(bodyFor('b', { resourceId: 'a-court-1' }))).status).toBe(404);
      for (const r of [await getById(id), await getByKey(key), await cancel(id)]) {
        expect(r.status).toBe(404);
        for (const secret of [...SECRETS, id]) expect(r.text).not.toContain(secret);
      }
      expect(await hashAll()).toEqual(before);
      expect((await q<{ status: string }>('SELECT status FROM scheduling_reservations'))[0].status).toBe('confirmed');
    });

    it('two organisations may use the same idempotency key independently, and each sees only its own booking', async () => {
      const key = newKey();
      const a = await create(body(), key);
      await signIn(PEOPLE.other);
      const b = await create(bodyFor('b'), key);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.json.reservation.id).not.toBe(b.json.reservation.id);
      expect((await getByKey(key)).json.reservation.id).toBe(b.json.reservation.id);
      await signIn(PEOPLE.manager);
      expect((await getByKey(key)).json.reservation.id).toBe(a.json.reservation.id);
      expect(await reservations('org-a')).toBe(1);
      expect(await reservations('org-b')).toBe(1);
    });
  });

  // ── create, replay, conflicts ──────────────────────────────────────────────────────────────────────────────────────────────────

  describe('create: atomic reservation and hold, tenant-scoped idempotency, payload comparison', () => {
    it('creates ONE reservation and ONE hold atomically, with the configured duration, the price snapshot and the creator; and audits it without any customer data', async () => {
      const r = await create(body());
      expect(r.status).toBe(201);
      expect(r.json.replayed).toBe(false);
      expect(r.json.reservation).toMatchObject({ status: 'confirmed', offeringId: 'a-off', resourceId: 'a-court-1', durationMinutes: 60, partySize: 2, customer: { name: 'Hirer Person', email: 'hirer.person@example.com', phone: '0400 123 456' }, notes: 'bring the key to gate 4', timezone: TZ });
      const row = (await q<Json>('SELECT * FROM scheduling_reservations'))[0];
      expect(row).toMatchObject({ organisation_id: 'org-a', created_by: 'staff:u-manager', status: 'confirmed', contact_link: 'none', customer_id: null });
      expect(await liveHolds()).toBe(1);
      expect((await q<Json>('SELECT reservation_id FROM scheduling_resource_holds'))[0].reservation_id).toBe(row.id);
      expect(Date.parse(row.ends_at) - Date.parse(row.starts_at)).toBe(3_600_000);

      const audit = await auditRows('scheduling.reservation.created');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ organisation_id: 'org-a', user_id: 'u-manager', resource_id: row.id });
      expect(audit[0].after_state.summary).toEqual({ offering_id: 'a-off', resource_id: 'a-court-1', local_date: MONDAY, local_start_time: '10:00', duration_minutes: 60, party_size: 2, source: 'staff_form' });
      expect(audit[0].after_state.identity).toBeUndefined();
      for (const secret of SECRETS) expect(JSON.stringify(audit[0])).not.toContain(secret);
    });

    it('a repeat of the same key and payload is 200 replayed: no second reservation, hold or audit entry; a repeat after the offering was renamed still matches', async () => {
      const key = newKey();
      const first = await create(body(), key);
      const again = await create(body(), key);
      expect(again.status).toBe(200);
      expect(again.json.replayed).toBe(true);
      expect(again.json.reservation.id).toBe(first.json.reservation.id);
      await q("UPDATE scheduling_offerings SET name = 'Renamed', updated_at = now() WHERE id = 'a-off'");
      const after = await create(body(), key);
      expect(after.status).toBe(200);
      expect(await reservations()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect(await auditRows('scheduling.reservation.created')).toHaveLength(1);
    });

    it('the same key with ANY different field is 409 IDEMPOTENCY_CONFLICT, and the original is unchanged', async () => {
      const key = newKey();
      const first = await create(body(), key);
      const variants: Array<Record<string, unknown>> = [
        { customer: { name: 'Someone Else' } },
        { customer: { name: 'Hirer Person', email: 'other@example.com', phone: '0400 123 456' } },
        { start: { date: MONDAY, time: '11:00' } },
        { start: { date: MONDAY2, time: '10:00' } },
        { resourceId: 'a-court-2' },
        { partySize: 3 },
        { notes: 'a different note' },
      ];
      for (const v of variants) {
        const r = await create(body(v), key);
        expect(r.status, JSON.stringify(v)).toBe(409);
        expect(r.json.code).toBe('IDEMPOTENCY_CONFLICT');
        for (const secret of SECRETS) expect(r.text).not.toContain(secret);
      }
      expect(await reservations()).toBe(1);
      expect((await getById(first.json.reservation.id)).json.reservation.customer.name).toBe('Hirer Person');
    });

    it('a second booking for an overlapping window of the same court is 409 RESOURCE_CONFLICT; a different court, or an adjacent hour, is fine', async () => {
      expect((await create(body())).status).toBe(201);
      const clash = await create(body());
      expect(clash.status).toBe(409);
      expect(clash.json.code).toBe('RESOURCE_CONFLICT');
      expect((await create(body({ resourceId: 'a-court-2' }))).status).toBe(201);
      expect((await create(body({ start: { date: MONDAY, time: '11:00' } }))).status).toBe(201);
      expect(await liveHolds()).toBe(3);
      expect(await overlappingLiveHolds()).toBe(0);
    });

    it('only engine-offered starts and the configured duration can be booked', async () => {
      for (const [over, code] of [
        [{ start: { date: MONDAY, time: '10:30' } }, 'OFF_GRID'],
        [{ start: { date: MONDAY, time: '08:00' } }, 'OUTSIDE_AVAILABILITY'],
        [{ start: { date: MONDAY, time: '16:00' }, durationMinutes: 90 }, 'DURATION_NOT_ALLOWED'],
        [{ durationMinutes: 30 }, 'DURATION_NOT_ALLOWED'],
        [{ start: { date: '2020-01-06', time: '10:00' } }, 'IN_THE_PAST'],
        [{ resourceId: 'ghost' }, 'NOT_FOUND'],
      ] as Array<[Record<string, unknown>, string]>) {
        const r = await create(body(over));
        expect(r.json.code, JSON.stringify(over)).toBe(code);
      }
      expect((await create(body({ start: { date: MONDAY, time: '16:00' } }))).status).toBe(201); // the last hour fits; the booking still ends at 17:00
      expect((await create(body({ start: { date: MONDAY, time: '17:00' } }))).json.code).toBe('OUTSIDE_AVAILABILITY');
      expect(await overlappingLiveHolds()).toBe(0);
    });

    it('validation failures name fields only, reach no table, and cost no booking', async () => {
      const before = await hashAll();
      for (const [b, key] of [
        [body({ extra: 1 }), newKey()], [body(), null], [body(), 'short'], [body({ partySize: 0 }), newKey()], [body({ customer: { name: '' } }), newKey()],
        [body({ start: { date: '2026-02-31', time: '10:00' } }), newKey()], [body({ notes: 'x'.repeat(1001) }), newKey()],
      ] as Array<[Record<string, unknown>, string | null]>) {
        const r = await create(b, key);
        expect(r.status).toBe(400);
        expect(r.json.code).toBe('VALIDATION');
        expect(Array.isArray(r.json.problems)).toBe(true);
      }
      const notJson = await call('POST', collection, BASE, { rawBody: '{nope', headers: { 'idempotency-key': newKey() } });
      expect(notJson.status).toBe(400);
      expect(await hashAll()).toEqual(before);
    });

    it('a DST gap start (the hour that does not exist on the spring-forward Sunday) is 422 NONEXISTENT_LOCAL_TIME; the hour after it books', async () => {
      // first Sunday of October at least 40 days ahead, Adelaide: 02:00 -> 03:00 (hours Sunday 00:00-12:00 are seeded)
      const probe = new Date(Date.now() + 40 * 86_400_000);
      let year = probe.getUTCFullYear();
      let day = '';
      for (;;) {
        const d = new Date(Date.UTC(year, 9, 1, 12));
        while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
        day = d.toISOString().slice(0, 10);
        if (Date.parse(`${day}T00:00:00Z`) > Date.now() + 40 * 86_400_000) break;
        year += 1;
      }
      const gap = await create(body({ start: { date: day, time: '02:00' } }));
      expect(gap.status).toBe(422);
      expect(gap.json.code).toBe('NONEXISTENT_LOCAL_TIME');
      expect((await create(body({ start: { date: day, time: '03:00' } }))).status).toBe(201);
      expect(await reservations()).toBe(1);
    });
  });

  // ── stale versions and offering edits ──────────────────────────────────────────────────────────────────────────────────────────

  describe('stale configuration is AVAILABILITY_CHANGED, with a fresh basis, and nothing is written', () => {
    const freshBasis = async () => {
      const r = await create(body({ basis: { offeringVersion: '0', resourceVersion: '0', offeringToken: 'x', scheduleToken: 'y' } }));
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('AVAILABILITY_CHANGED');
      return r.json.basis as Json;
    };

    it('a stale basis is refused and returns the current one, which then books with the same payload', async () => {
      const basis = await freshBasis();
      expect(Object.keys(basis).sort()).toEqual(['offeringToken', 'offeringVersion', 'resourceVersion', 'scheduleToken']);
      expect(await reservations()).toBe(0);
      expect((await create(body({ basis }))).status).toBe(201);
    });

    it('each kind of change after the basis was read refuses the booking: offering edit, schedule edit, a court or offering availability change, court deactivated, link removed', async () => {
      const edits: Array<[string, () => Promise<unknown>]> = [
        ['offering edit', () => q("UPDATE scheduling_offerings SET name = 'Edited', updated_at = clock_timestamp() WHERE id = 'a-off'")],
        ['schedule edit', () => q("UPDATE scheduling_schedules SET name = 'Edited', updated_at = clock_timestamp() WHERE id = 'a-hire'")],
        ['court availability change (any rule, closure or pin bumps the version row)', () => q("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'resource' AND owner_id = 'a-court-1'")],
        ['offering availability change', () => q("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'offering' AND owner_id = 'a-off'")],
        ['court deactivated', async () => { await q("UPDATE scheduling_resources SET active = false, updated_at = clock_timestamp() WHERE id = 'a-court-1'"); }],
        ['link removed', () => q("DELETE FROM scheduling_offering_resources WHERE offering_id = 'a-off' AND resource_id = 'a-court-1'")],
      ];
      for (const [name, edit] of edits) {
        const basis = await (async () => {
          await q("UPDATE scheduling_resources SET active = true WHERE id = 'a-court-1'");
          await q("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ('org-a', 'a-off', 'a-court-1') ON CONFLICT DO NOTHING");
          return freshBasis();
        })();
        await edit().catch(() => undefined);
        const r = await create(body({ basis, start: { date: MONDAY, time: '15:00' } }));
        expect(r.status, name).toBeGreaterThanOrEqual(409);
        expect(['AVAILABILITY_CHANGED', 'RESOURCE_INACTIVE', 'RESOURCE_NOT_ELIGIBLE', 'OUTSIDE_AVAILABILITY'], name).toContain(r.json.code);
        expect(await reservations(), name).toBe(0);
      }
    });
  });

  // ── concurrency ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('concurrency through the routes', () => {
    it('8 parallel requests for the same court and hour with DIFFERENT keys: exactly one 201, the rest RESOURCE_CONFLICT, one live hold, no overlap', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => create(body())));
      expect(results.filter(r => r.status === 201)).toHaveLength(1);
      expect(results.filter(r => r.status === 409).map(r => r.json.code)).toEqual(Array(7).fill('RESOURCE_CONFLICT'));
      expect(await reservations()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect(await overlappingLiveHolds()).toBe(0);
      expect(await auditRows('scheduling.reservation.created')).toHaveLength(1);
    });

    it('6 parallel requests with the SAME key: exactly one reservation; one 201 and the others 200 replayed (or the same 201 recovered); one audit entry', async () => {
      const key = newKey();
      const results = await Promise.all(Array.from({ length: 6 }, () => create(body(), key)));
      for (const r of results) expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
      expect(new Set(results.map(r => r.json.reservation.id)).size).toBe(1);
      expect(await reservations()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect(await auditRows('scheduling.reservation.created')).toHaveLength(1);
    });

    it('16 requests across 2 courts and 4 hours (32 slots contested by 16 distinct windows twice): never an overlap, every 201 has exactly one hold, every key one reservation', async () => {
      const windows = ['09:00', '10:00', '11:00', '12:00'].flatMap(time => ['a-court-1', 'a-court-2'].map(resourceId => ({ time, resourceId })));
      const calls = [...windows, ...windows].map(w => create(body({ resourceId: w.resourceId, start: { date: MONDAY, time: w.time } })));
      const results = await Promise.all(calls);
      expect(results.filter(r => r.status === 201)).toHaveLength(windows.length);
      expect(results.filter(r => r.status !== 201).every(r => r.json.code === 'RESOURCE_CONFLICT')).toBe(true);
      expect(await reservations()).toBe(windows.length);
      expect(await liveHolds()).toBe(windows.length);
      expect(await overlappingLiveHolds()).toBe(0);
      expect((await q<{ n: number }>('SELECT count(DISTINCT idempotency_key)::int AS n FROM scheduling_reservations'))[0].n).toBe(windows.length);
    });

    it('bookings racing a configuration writer: no unexpected failure (no 500), no overlap, and every 201 is a complete reservation with its hold', async () => {
      const stop = Date.now() + 2500;
      let n = 0;
      const writer = (async () => {
        while (Date.now() < stop) {
          await q("UPDATE scheduling_offerings SET name = name || 'x', updated_at = clock_timestamp() WHERE id = 'a-off'").catch(() => undefined);
          await new Promise(r => setTimeout(r, 120));
        }
      })();
      const hirers = Array.from({ length: 4 }, async () => {
        const out: Outcome[] = [];
        while (Date.now() < stop) {
          n += 1;
          out.push(await create(body({ start: { date: MONDAY, time: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'][n % 6] } })));
        }
        return out;
      });
      const all = (await Promise.all(hirers)).flat();
      await writer;
      expect(all.length).toBeGreaterThan(0);
      expect(all.filter(r => r.status >= 500 && r.json?.code !== 'CONTENTION_TIMEOUT')).toEqual([]);
      expect(await overlappingLiveHolds()).toBe(0);
      expect(await reservations()).toBe(await liveHolds());
      expect(console.error).not.toHaveBeenCalledWith('[scheduling] handler failed', '40P01');
    }, 30_000);
  });

  // ── cancel ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('cancel: history retained, hold released atomically, idempotent', () => {
    it('cancels as staff, keeps the row and its snapshot, releases the hold, frees the window for a new booking, and audits without the reason text', async () => {
      const created = await create(body());
      const id = created.json.reservation.id;
      const r = await cancel(id, { reason: 'Customer rang to cancel' });
      expect(r.status).toBe(200);
      expect(r.json.reservation.status).toBe('cancelled');
      const row = (await q<Json>('SELECT status, cancelled_by, cancel_reason, cancelled_at, customer_name, starts_at, ends_at, price_cents FROM scheduling_reservations WHERE id = $1', [id]))[0];
      expect(row).toMatchObject({ status: 'cancelled', cancelled_by: 'staff', cancel_reason: 'Customer rang to cancel', customer_name: 'Hirer Person' });
      expect(row.cancelled_at).not.toBeNull();
      expect(await reservations()).toBe(1); // history stays
      expect(await liveHolds()).toBe(0); // the hold went with the status change, in the same statement
      expect((await q<Json>('SELECT released_at FROM scheduling_resource_holds WHERE reservation_id = $1', [id])).map(h => h.released_at !== null)).toEqual([true]); // released, and kept as history
      expect((await create(body())).status).toBe(201); // the window is free at once
      const audit = await auditRows('scheduling.reservation.cancelled');
      expect(audit).toHaveLength(1);
      expect(audit[0].after_state.summary).toMatchObject({ has_reason: true, source: 'staff_form', offering_id: 'a-off' });
      expect(JSON.stringify(audit[0])).not.toMatch(/Customer rang|Hirer Person|hirer\.person/);
    });

    it('cancelling twice is 200 both times, with one cancellation and one audit entry; 5 parallel cancels end the same way', async () => {
      const id = (await create(body())).json.reservation.id;
      const results = await Promise.all(Array.from({ length: 5 }, () => cancel(id)));
      expect(results.every(r => r.status === 200)).toBe(true);
      expect((await cancel(id)).json.alreadyCancelled).toBe(true);
      expect(await auditRows('scheduling.reservation.cancelled')).toHaveLength(1);
      expect(await liveHolds()).toBe(0);
    });

    it('a booking that has already started is 422 IN_THE_PAST; absent, foreign and class ids are 404; a bad reason is 400', async () => {
      const repo = new PostgresReservationRepository({ sql: fromPgLike(pool), clock: new FixedClock(new Date('2020-01-01T00:00:00Z')) });
      const old = await repo.create(staff('org-a'), slotBooking('a-court-2', '2020-01-06', '10:00', 60, { schedule: 'a-hire', offering: 'a-off' }, { customerSnapshot: person('Old Booking', 'old@example.com') }));
      if (!old.ok) throw new Error('seed old booking');
      const past = await cancel(old.reservation.id);
      expect(past.status).toBe(422);
      expect(past.json.code).toBe('IN_THE_PAST');
      expect((await q<{ status: string }>('SELECT status FROM scheduling_reservations WHERE id = $1', [old.reservation.id]))[0].status).toBe('confirmed');
      expect((await cancel('nope-123')).status).toBe(404);
      const id = (await create(body())).json.reservation.id;
      expect((await cancel(id, { reason: '<script>x</script>' })).status).toBe(400);
      expect((await cancel(id, { reason: 'ok', scope: 'this_and_future' })).status).toBe(400);
      expect((await q<{ status: string }>('SELECT status FROM scheduling_reservations WHERE id = $1', [id]))[0].status).toBe('confirmed');
    });
  });

  // ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('reads', () => {
    it('GET by id and by key return the staff view; absent ids and keys are 404', async () => {
      const key = newKey();
      const created = await create(body(), key);
      const byId = await getById(created.json.reservation.id);
      const byKey = await getByKey(key);
      expect(byId.status).toBe(200);
      expect(byKey.status).toBe(200);
      expect(byKey.json.reservation).toEqual(byId.json.reservation);
      expect(byId.json.reservation.customer.name).toBe('Hirer Person');
      expect(byId.text).not.toMatch(/organisation|org-a|idempotency|created_?by|customer_?id|series/i);
      expect((await getById('absent-id')).status).toBe(404);
      expect((await getByKey(newKey())).status).toBe(404);
    });
  });

  // ── lost replies, failures, contention, audit ────────────────────────────────────────────────────────────────────────────────

  describe('unknown outcomes: lost replies, failures before send, lock contention, audit failure', () => {
    it('a COMMITTED batch whose reply is lost is resolved by key to the booking (recovered), once; a repeat of the key is a plain replay', async () => {
      const key = newKey();
      state.loseNextBatchReply = true;
      const r = await create(body(), key);
      expect(r.status).toBe(201);
      expect(r.json.recovered).toBe(true);
      expect(await reservations()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect(await auditRows('scheduling.reservation.created')).toHaveLength(1);
      const again = await create(body(), key);
      expect(again.status).toBe(200);
      expect(again.json.replayed).toBe(true);
      expect(await auditRows('scheduling.reservation.created')).toHaveLength(1);
    });

    it('a failure BEFORE the batch is sent: nothing is written, the caller is told OUTCOME_UNKNOWN (never "unavailable"), a lookup by key finds nothing, and repeating the SAME key books exactly once', async () => {
      const key = newKey();
      state.failNextBatchBeforeSend = true;
      const first = await create(body(), key);
      expect(first.status).toBe(504);
      expect(first.json).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: true });
      expect(await reservations()).toBe(0);
      expect((await getByKey(key)).status).toBe(404); // reconciliation by key: not written
      expect((await create(body(), key)).status).toBe(201);
      expect(await reservations()).toBe(1);
      expect(await liveHolds()).toBe(1);
    });

    describe('UNEXPECTED errors before, during and after the transaction (2C.3c-A): reconciled by the original key, never a 500, never a duplicate', () => {
      it('BEFORE anything is written (the first read fails): nothing is written, OUTCOME_UNKNOWN with the same-key retry contract, and repeating the SAME key books exactly once', async () => {
        const key = newKey();
        state.unexpected = 'before';
        const first = await create(body(), key);
        expect(first.status).toBe(504);
        expect(first.json).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: true });
        expect(JSON.stringify(first.json)).not.toMatch(/internal error|XX000|Internal error/);
        expect(await reservations()).toBe(0);
        expect((await getByKey(key)).status).toBe(404);
        expect(await auditRows('scheduling.reservation.created')).toHaveLength(0);
        expect((await create(body(), key)).status).toBe(201);
        expect(await reservations()).toBe(1);
        expect(await liveHolds()).toBe(1);
      });

      it('DURING the batch (after its first statement): the transaction rolls back as a whole - no reservation and no hold - and the answer is OUTCOME_UNKNOWN, then the same key books once', async () => {
        const key = newKey();
        state.unexpected = 'during';
        const first = await create(body(), key);
        expect(first.status).toBe(504);
        expect(first.json.code).toBe('OUTCOME_UNKNOWN');
        expect(await reservations()).toBe(0);
        expect(await liveHolds()).toBe(0);
        expect((await create(body(), key)).status).toBe(201);
        expect(await reservations()).toBe(1);
        expect(await liveHolds()).toBe(1);
      });

      it('AFTER the batch committed: the booking is found by the original key and returned (201, recovered), with one reservation, one hold and one audit entry; the repeat is a plain replay', async () => {
        const key = newKey();
        state.unexpected = 'after';
        const r = await create(body(), key);
        expect(r.status).toBe(201);
        expect(r.json).toMatchObject({ replayed: false, recovered: true });
        expect(r.json.reservation.id).toBeTruthy();
        expect(await reservations()).toBe(1);
        expect(await liveHolds()).toBe(1);
        const audits = await auditRows('scheduling.reservation.created');
        expect(audits).toHaveLength(1);
        expect(JSON.stringify(audits)).not.toMatch(/Pat|Hirer|example\.com|0400/);
        const again = await create(body(), key);
        expect(again.status).toBe(200);
        expect(again.json.replayed).toBe(true);
        expect(await reservations()).toBe(1);
      });

      it('AFTER the commit with the audit store down as well: still the booking, still 201', async () => {
        state.unexpected = 'after';
        state.failAudit = true;
        const r = await create(body());
        expect(r.status).toBe(201);
        expect(await reservations()).toBe(1);
        expect(await auditRows()).toHaveLength(0);
      });

      it('a different payload under a key whose first attempt committed after an unexpected error is IDEMPOTENCY_CONFLICT, and the original is untouched', async () => {
        const key = newKey();
        state.unexpected = 'after';
        expect((await create(body(), key)).status).toBe(201);
        const other = await create(body({ partySize: 3 }), key);
        expect(other.status).toBe(409);
        expect(other.json.code).toBe('IDEMPOTENCY_CONFLICT');
        expect(await reservations()).toBe(1);
      });

      it('a burst of 6 same-key requests where the first hits an unexpected error after commit: exactly one reservation and one hold, every answer a success or a retryable unknown', async () => {
        const key = newKey();
        state.unexpected = 'after';
        const rs = await Promise.all(Array.from({ length: 6 }, () => create(body(), key)));
        expect(rs.every(r => [200, 201].includes(r.status) || (r.status === 504 && r.json.code === 'OUTCOME_UNKNOWN'))).toBe(true);
        expect(rs.some(r => r.status === 500)).toBe(false);
        expect(await reservations()).toBe(1);
        expect(await liveHolds()).toBe(1);
      });
    });

    it('lock contention: a configuration writer holding the offering row longer than the 2 s lock timeout gives 503 CONTENTION_TIMEOUT with Retry-After, writes nothing, and the same key books once the writer is gone', async () => {
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query("UPDATE scheduling_offerings SET name = name WHERE id = 'a-off'");
        const key = newKey();
        const r = await create(body(), key);
        expect(r.status).toBe(503);
        expect(r.json.code).toBe('CONTENTION_TIMEOUT');
        expect(r.headers.get('retry-after')).toBe('1');
        expect(await reservations()).toBe(0);
        await blocker.query('ROLLBACK');
        expect((await create(body(), key)).status).toBe(201);
        expect(await reservations()).toBe(1);
      } finally {
        blocker.release();
      }
    }, 40_000);

    it('a failing audit store never undoes or hides a committed booking or cancellation', async () => {
      state.failAudit = true;
      const r = await create(body());
      expect(r.status).toBe(201);
      expect(await reservations()).toBe(1);
      expect(await auditRows()).toHaveLength(0);
      expect((await cancel(r.json.reservation.id)).status).toBe(200);
      expect((await q<{ status: string }>('SELECT status FROM scheduling_reservations'))[0].status).toBe('cancelled');
    });
  });

  // ── observability ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('observability: status, duration and database timing are kept, customer data is not', () => {
    it('Server-Timing counts the booking transaction, and the request log line holds numbers and a route template only', async () => {
      const r = await create(body());
      expect(r.headers.get('server-timing')).toMatch(/app;dur=\d+, db;dur=\d+;desc="(\d+) statements, summed"/);
      const statements = Number(/desc="(\d+) statements/.exec(r.headers.get('server-timing') ?? '')?.[1]);
      expect(statements).toBeGreaterThanOrEqual(4); // key lookup, basis, inputs, and the 2 statements of the booking transaction
      const lines = (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[1])).filter(l => l.includes('/api/scheduling/reservations'));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toMatchObject({ route: '/api/scheduling/reservations', method: 'POST', status: 201, outcome: 'ok' });
        expect(parsed.stmts).toBeGreaterThanOrEqual(4);
        for (const secret of [...SECRETS, 'org-a', 'u-manager', 'a-court-1', 'a-off']) expect(line).not.toContain(secret);
      }
    });
  });
});
