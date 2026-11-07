import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, seedOffering, seedResource, seedSchedule, staff } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3c-B: GET /api/scheduling/reservations/basis through the REAL chain, over a DISPOSABLE PostgreSQL (scripts/tests/verify-scheduling-phase2c.sh, 16 and 17): signed session cookie ->
// middleware.ts -> the route -> schedulingRoute() (kill switch, organisation capability, base capability, role permission) -> the REAL runtime and host SQL executor -> the REAL
// PostgresHireRepository.readHireOffer (the basis row, then the engine inputs, then the shared pure engine) -> the real tables, triggers and 037 version rows. The booking routes of 2C.3b are
// used to prove that every offered start books and nothing else does. Replaced: the Next cookie store and `@/lib/db` (the Neon HTTP driver), with the same lazy-query/transaction behaviour.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = 'test-only-session-secret-for-the-disposable-staff-booking-matrix-0123456789';
  return { cookie: null as string | null, loseNextBatchReply: false, failNextBatchBeforeSend: false, failAudit: false, batches: 0 };
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
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      const out: unknown[] = [];
      for (const q of queries) out.push((await c.query(q.text, q.params)).rows);
      await c.query('COMMIT');
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
const cancelRoute = (await import('@/app/api/scheduling/reservations/[reservationId]/cancel/route')) as unknown as { POST: Handler };
const basisRoute = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as { GET: Handler };

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
const cancel = (id: string, body?: unknown) => call('POST', cancelRoute, `${BASE}/${id}/cancel`, { ...(body !== undefined ? { body } : {}), params: { reservationId: id } });

// Dates: always in the future of the REAL clock (the routes use the system clock).
function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const MONDAY = nextWeekday(1, 40);
const body = (over: Record<string, unknown> = {}) => ({
  offeringId: 'a-off', resourceId: 'a-court-1', start: { date: MONDAY, time: '10:00' }, durationMinutes: 60, partySize: 2,
  customer: { name: 'Hirer Person', email: 'hirer.person@example.com', phone: '0400 123 456' }, notes: 'bring the key to gate 4', ...over,
});
const SECRETS = ['Hirer Person', 'hirer.person', 'example.com', '0400 123 456', 'gate 4', 'Zed Other', 'zed.other'];
const reservations = (org = 'org-a') => q<{ n: number }>(`SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1`, [org]).then(r => r[0].n);
const auditRows = (action?: string) => q<{ action: string; resource_id: string; user_id: string; after_state: Json; organisation_id: string }>(`SELECT action, resource_id, user_id, after_state, organisation_id FROM audit_logs WHERE action LIKE 'scheduling.reservation.%' ${action ? 'AND action = $1' : ''} ORDER BY created_at`, action ? [action] : []);
const overlappingLiveHolds = async () => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during WHERE a.released_at IS NULL AND b.released_at IS NULL`))[0].n;

const hours = (dayOfWeek: number, start = '09:00', end = '17:00') => ({ kind: 'hours' as const, label: null, dayOfWeek, startTime: start, endTime: end, validFrom: null, validTo: null });
const TZ = 'Australia/Adelaide';
let avail: PostgresAvailabilityRepository;

suite('Scheduling 2C.3c-B availability basis: gates, permissions, contract, bounds and offered-equals-bookable through the real chain', () => {
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

  // ══ Phase 2C.3c-B: GET /api/scheduling/reservations/basis ══════════════════════════════════════════════════════════════════════════

  const BASIS_URL = `${BASE}/basis`;
  const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const basisGet = (query: Record<string, string> | string = {}) =>
    call('GET', basisRoute, `${BASIS_URL}?${typeof query === 'string' ? query : new URLSearchParams({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY, ...query }).toString()}`);
  const offeredTimes = (r: Outcome, date = MONDAY): string[] => ((r.json.days as Array<{ date: string; starts: Array<{ time: string }> }>).find(d => d.date === date)?.starts ?? []).map(s => s.time);
  const firstSundayOf = (year: number, month: number) => {
    const d = new Date(Date.UTC(year, month, 1, 12));
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const nextFirstSunday = (month: number) => {
    for (let y = new Date().getUTCFullYear(); ; y += 1) {
      const s = firstSundayOf(y, month);
      if (Date.parse(`${s}T00:00:00Z`) > Date.now() + 3 * 86_400_000) return s;
    }
  };

  describe('basis: gates and permissions, default OFF', () => {
    it('with the switch off (unset, "", "off", "ON", "true") the route is 404 not_found for a signed-in manager and every table is byte-identical', async () => {
      const before = await hashAll();
      for (const value of [undefined, '', 'off', 'ON', 'true']) {
        if (value === undefined) delete process.env.SCHEDULING_STAFF_BOOKING;
        else process.env.SCHEDULING_STAFF_BOOKING = value;
        const r = await basisGet();
        expect(r.status, String(value)).toBe(404);
        expect(r.json).toEqual({ error: 'not_found' });
      }
      expect(await hashAll()).toEqual(before);
    });

    it('an organisation WITHOUT scheduling.staff_booking, a disabled entitlement, an inactive module and an unregistered capability are all 404', async () => {
      await signIn(PEOPLE.noCap);
      expect((await basisGet()).status).toBe(404);
      await signIn(PEOPLE.manager);
      expect((await basisGet()).status).toBe(200);
      await q("UPDATE organisation_modules SET enabled = false WHERE organisation_id = 'org-a' AND module_key = 'scheduling.staff_booking'");
      expect((await basisGet()).status).toBe(404);
      await q("UPDATE organisation_modules SET enabled = true WHERE organisation_id = 'org-a' AND module_key = 'scheduling.staff_booking'");
      await q("UPDATE modules SET active = false WHERE key = 'scheduling.staff_booking'");
      expect((await basisGet()).status).toBe(404);
      await q("DELETE FROM organisation_modules WHERE module_key = 'scheduling.staff_booking'");
      await q("DELETE FROM modules WHERE key = 'scheduling.staff_booking'");
      expect((await basisGet()).status).toBe(404);
    });

    it('anonymous callers are refused (401) and nothing is read', async () => {
      signOut();
      const before = await hashAll();
      const r = await basisGet();
      expect(r.status).toBe(401);
      expect(r.text).not.toMatch(/basis|offeringVersion|days/);
      expect(await hashAll()).toEqual(before);
    });

    for (const who of ['viewer', 'analyst', 'managerViewOnly'] as const) {
      it(`${who} is refused (403) and receives no scheduling data`, async () => {
        await signIn(PEOPLE[who]);
        const r = await basisGet();
        expect(r.status).toBe(403);
        expect(r.text).not.toMatch(/basis|offeringVersion|durationMinutes|days|a-off|a-court/);
      });
    }
    for (const who of ['manager', 'admin', 'unmanaged'] as const) {
      it(`${who} reads it (200)`, async () => {
        await signIn(PEOPLE[who]);
        expect((await basisGet()).status).toBe(200);
      });
    }

    it('tenant isolation: another organisation\'s manager gets the SAME 404 for a real id as for an absent one, in both directions', async () => {
      await signIn(PEOPLE.other); // org-b
      const real = await basisGet(); // org-a's offering and court
      const absent = await basisGet({ offeringId: 'nope', resourceId: 'nope' });
      expect([real.status, absent.status]).toEqual([404, 404]);
      expect(real.json).toEqual(absent.json);
      expect((await basisGet({ offeringId: 'b-off', resourceId: 'b-court-1' })).status).toBe(200); // its own
      await signIn(PEOPLE.manager);
      expect((await basisGet({ offeringId: 'b-off', resourceId: 'b-court-1' })).status).toBe(404);
    });
  });

  describe('basis: the response contract', () => {
    it('is exactly the basis, the configured duration, the pinned zone and the starts per local date - and equals the database', async () => {
      const r = await basisGet({ to: addDays(MONDAY, 6) });
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('server-timing')).toMatch(/db;dur=/);
      expect(Object.keys(r.json).sort()).toEqual(['basis', 'days', 'generatedAt', 'offering', 'range', 'resource', 'timezone']);
      const versions = await q<{ owner_kind: string; v: string }>("SELECT owner_kind, version::text AS v FROM scheduling_availability_versions WHERE owner_id IN ('a-off', 'a-court-1')");
      expect(r.json.basis.offeringVersion).toBe(versions.find(v => v.owner_kind === 'offering')!.v);
      expect(r.json.basis.resourceVersion).toBe(versions.find(v => v.owner_kind === 'resource')!.v);
      expect(r.json.basis.offeringToken).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
      expect(r.json.basis.scheduleToken).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
      expect(r.json.offering).toEqual({ id: 'a-off', durationMinutes: 60, price: { amountCents: 0, currency: 'AUD' } });
      expect(r.json.resource).toMatchObject({ id: 'a-court-1' });
      expect(r.json.timezone).toBe(TZ);
      expect(r.json.range).toEqual({ from: MONDAY, to: addDays(MONDAY, 6) });
      expect(r.json.days.map((d: { date: string }) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(MONDAY, i)));
      expect(offeredTimes(r)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
      expect(offeredTimes(r, addDays(MONDAY, 6))).toEqual(Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, '0')}:00`)); // Sunday 00:00-12:00
      expect(offeredTimes(r, addDays(MONDAY, 2))).toEqual([]);
      expect(r.text).not.toMatch(/org-a|organi[sz]ation|customer|email|phone|notes|step/i);
      for (const secret of SECRETS) expect(r.text).not.toContain(secret);
    });

    it('is a READ: successful and refused requests leave every table byte-identical, and write no audit entry', async () => {
      const before = await hashAll();
      for (const query of [{}, { to: addDays(MONDAY, 13) }, { to: addDays(MONDAY, 14) }, { step: '15' }, { organisationId: 'org-b' }, { resourceId: 'a-court-2' }]) await basisGet(query);
      expect(await hashAll()).toEqual(before);
      expect(await auditRows()).toHaveLength(0);
    });

    it('is strictly validated: unknown parameters (step, organisationId ...), missing or repeated ones, bad ids and dates, reversed and over-long ranges are 400 VALIDATION naming fields only', async () => {
      const bad: Array<[string, string, string[]]> = [
        ['step', `offeringId=a-off&resourceId=a-court-1&from=${MONDAY}&to=${MONDAY}&step=15`, ['step']],
        ['organisationId', `offeringId=a-off&resourceId=a-court-1&from=${MONDAY}&to=${MONDAY}&organisationId=org-b`, ['organisationId']],
        ['missing', '', ['offeringId', 'resourceId', 'from', 'to']],
        ['bad id', `offeringId=../x&resourceId=a-court-1&from=${MONDAY}&to=${MONDAY}`, ['offeringId']],
        ['bad date', 'offeringId=a-off&resourceId=a-court-1&from=2026-02-30&to=2026-03-01', ['from']],
        ['reversed', `offeringId=a-off&resourceId=a-court-1&from=${addDays(MONDAY, 3)}&to=${MONDAY}`, ['to']],
        ['over 14 days', `offeringId=a-off&resourceId=a-court-1&from=${MONDAY}&to=${addDays(MONDAY, 14)}`, ['range']],
      ];
      for (const [name, query, problems] of bad) {
        const r = await basisGet(query);
        expect(r.status, name).toBe(400);
        expect(r.json.code, name).toBe('VALIDATION');
        expect(r.json.problems, name).toEqual(problems);
        expect(r.text, name).not.toContain('org-b');
      }
      expect((await basisGet({ to: addDays(MONDAY, 13) })).status).toBe(200); // 14 days is the longest
    });

    it('a range with too many start times is refused, not truncated (RANGE_TOO_LARGE 422), and a single day of the same offering is still served within a bounded size', async () => {
      await q("UPDATE scheduling_offerings SET duration_minutes = 1, updated_at = clock_timestamp() WHERE id = 'a-off'");
      const wide = await basisGet({ to: addDays(MONDAY, 13) });
      expect(wide.status).toBe(422);
      expect(wide.json.code).toBe('RANGE_TOO_LARGE');
      const day = await basisGet();
      expect(day.status).toBe(200);
      expect(offeredTimes(day).length).toBe(480);
      expect(day.text.length).toBeLessThan(100_000);
    });
  });

  describe('basis: the starts offered are exactly the starts that book', () => {
    it('every offered start books (201) with the basis it was offered with, nothing else on the 15-minute grid does, and then the day has nothing left to offer', async () => {
      const first = await basisGet();
      const offered = offeredTimes(first);
      expect(offered).toHaveLength(8);
      for (const time of offered) {
        const offer = await basisGet(); // a fresh read each time, as the form does
        const r = await create(body({ start: { date: MONDAY, time }, basis: offer.json.basis }));
        expect(r.status, time).toBe(201);
      }
      expect(await reservations()).toBe(8);
      expect(offeredTimes(await basisGet())).toEqual([]);
      expect(await overlappingLiveHolds()).toBe(0);
    });

    it('a time that is NOT offered is refused by the booking: before the hours, off the grid, at the closing time, on a closed day', async () => {
      const offer = await basisGet();
      for (const [time, date] of [['08:00', MONDAY], ['09:30', MONDAY], ['17:00', MONDAY], ['10:00', addDays(MONDAY, 2)]] as const) {
        expect(offeredTimes(offer, date)).not.toContain(time);
        const r = await create(body({ start: { date, time }, basis: offer.json.basis }));
        expect(r.status, `${date} ${time}`).toBe(409);
        expect(['OFF_GRID', 'OUTSIDE_AVAILABILITY'], `${date} ${time}`).toContain(r.json.code);
      }
      expect(await reservations()).toBe(0);
    });

    it('a booked start leaves the offer for that court only, and returns when the booking is cancelled (the hold is released)', async () => {
      const booked = await create(body({ start: { date: MONDAY, time: '10:00' } }));
      expect(booked.status).toBe(201);
      expect(offeredTimes(await basisGet())).not.toContain('10:00');
      expect(offeredTimes(await basisGet())).toContain('11:00');
      expect(offeredTimes(await basisGet({ resourceId: 'a-court-2' }))).toContain('10:00');
      expect((await cancel(booked.json.reservation.id)).status).toBe(200);
      expect(offeredTimes(await basisGet())).toContain('10:00');
    });
  });

  describe('basis: stale configuration is refused at commit, and a refused booking returns the current basis', () => {
    it('a basis the server did not issue (forged) is AVAILABILITY_CHANGED with exactly the basis the endpoint now returns', async () => {
      const real = (await basisGet()).json.basis;
      const forged = await create(body({ basis: { offeringVersion: '999', resourceVersion: '999', offeringToken: '2000-01-01T00:00:00.000000Z', scheduleToken: '2000-01-01T00:00:00.000000Z' } }));
      expect(forged.status).toBe(409);
      expect(forged.json.code).toBe('AVAILABILITY_CHANGED');
      expect(forged.json.basis).toEqual(real);
      expect(await reservations()).toBe(0);
    });

    it('each kind of change moves the basis the endpoint returns, and the OLD basis can no longer book (the new one can)', async () => {
      const edits: Array<[string, string, () => Promise<unknown>]> = [
        ['offering edit', 'offeringToken', () => q("UPDATE scheduling_offerings SET name = 'Edited', updated_at = clock_timestamp() WHERE id = 'a-off'")],
        ['schedule edit', 'scheduleToken', () => q("UPDATE scheduling_schedules SET name = 'Edited', updated_at = clock_timestamp() WHERE id = 'a-hire'")],
        ['court availability change', 'resourceVersion', () => q("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'resource' AND owner_id = 'a-court-1'")],
        ['offering availability change', 'offeringVersion', () => q("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'offering' AND owner_id = 'a-off'")],
      ];
      let slot = 9;
      for (const [name, component, edit] of edits) {
        const old = (await basisGet()).json.basis as Json;
        await edit();
        const fresh = (await basisGet()).json.basis as Json;
        expect(fresh[component], name).not.toEqual(old[component]);
        const time = `${String(slot++).padStart(2, '0')}:00`;
        const stale = await create(body({ start: { date: MONDAY, time }, basis: old }));
        expect(stale.status, name).toBe(409);
        expect(stale.json.code, name).toBe('AVAILABILITY_CHANGED');
        expect(stale.json.basis, name).toEqual(fresh);
        expect((await create(body({ start: { date: MONDAY, time }, basis: fresh }))).status, name).toBe(201);
      }
    });

    it('a court deactivated, unlinked, or an offering archived or of another kind is refused with its own stable code - and the booking would be refused too', async () => {
      await q("UPDATE scheduling_resources SET active = false, updated_at = clock_timestamp() WHERE id = 'a-court-1'");
      const inactive = await basisGet();
      expect([inactive.status, inactive.json.code]).toEqual([409, 'RESOURCE_INACTIVE']);
      await q("UPDATE scheduling_resources SET active = true WHERE id = 'a-court-1'");
      await q("DELETE FROM scheduling_offering_resources WHERE offering_id = 'a-off' AND resource_id = 'a-court-1'");
      const unlinked = await basisGet();
      expect([unlinked.status, unlinked.json.code]).toEqual([422, 'RESOURCE_NOT_ELIGIBLE']);
      await q("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ('org-a', 'a-off', 'a-court-1')");
      await q("UPDATE scheduling_offerings SET archived_at = now() WHERE id = 'a-off'");
      const archived = await basisGet();
      expect([archived.status, archived.json.code]).toEqual([409, 'OFFERING_UNAVAILABLE']);
      await q("UPDATE scheduling_offerings SET archived_at = NULL WHERE id = 'a-off'");
      await seedSchedule('org-a', 'a-classes', 'classes_coaching');
      await seedOffering('org-a', 'a-class-off', 'a-classes');
      const kind = await basisGet({ offeringId: 'a-class-off' });
      expect([kind.status, kind.json.code]).toEqual([422, 'OFFERING_NOT_BOOKABLE']);
      expect((await basisGet()).status).toBe(200);
    });

    it('a configuration writer racing the read: the booking made with what was read is a 201 or an AVAILABILITY_CHANGED - never a 500, never an overlap', async () => {
      for (let i = 0; i < 12; i += 1) {
        const time = `${String(9 + (i % 8)).padStart(2, '0')}:00`;
        const [read] = await Promise.all([basisGet(), q("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'resource' AND owner_id = 'a-court-1'")]);
        expect(read.status).toBe(200);
        const r = await create(body({ start: { date: MONDAY, time }, basis: read.json.basis }));
        expect([201, 409], `${i} ${time} ${r.text}`).toContain(r.status);
        if (r.status === 409) expect(['AVAILABILITY_CHANGED', 'RESOURCE_CONFLICT']).toContain(r.json.code);
      }
      expect(await overlappingLiveHolds()).toBe(0);
    });

    it('ten parallel readers get the same basis, the same days, and no one is slowed into an error', async () => {
      const rs = await Promise.all(Array.from({ length: 10 }, () => basisGet({ to: addDays(MONDAY, 6) })));
      expect(rs.map(r => r.status)).toEqual(Array(10).fill(200));
      const shape = (r: Outcome) => JSON.stringify({ basis: r.json.basis, days: r.json.days });
      expect(new Set(rs.map(shape)).size).toBe(1);
    });
  });

  describe('basis: daylight saving - only starts the booking can reproduce', () => {
    it('fall back (first Sunday of April): the repeated 02:00 hour is offered ONCE, no time repeats, and the offered 02:00 books at exactly the offered instant', async () => {
      const sunday = nextFirstSunday(3);
      const r = await basisGet({ from: sunday, to: sunday });
      expect(r.status).toBe(200);
      const day = (r.json.days as Array<{ date: string; starts: Array<{ time: string; startsAt: string }> }>)[0];
      const times = day.starts.map(s => s.time);
      expect(times.filter(t => t === '02:00')).toHaveLength(1);
      expect(new Set(times).size).toBe(times.length);
      expect(times).toHaveLength(12);
      const offered = day.starts.find(s => s.time === '02:00')!;
      const booked = await create(body({ start: { date: sunday, time: '02:00' }, basis: r.json.basis }));
      expect(booked.status).toBe(201);
      const stored = await q<{ starts_at: Date }>("SELECT starts_at FROM scheduling_reservations WHERE organisation_id = 'org-a'");
      expect(stored[0].starts_at.getTime()).toBe(Date.parse(offered.startsAt));
    });

    it('spring forward (first Sunday of October): nothing is offered in the non-existent 02:00-03:00 hour, and a booking there is NONEXISTENT_LOCAL_TIME', async () => {
      const sunday = nextFirstSunday(9);
      const r = await basisGet({ from: sunday, to: sunday });
      expect(r.status).toBe(200);
      const times = offeredTimes(r, sunday);
      expect(times.some(t => t >= '02:00' && t < '03:00')).toBe(false);
      expect(times).toHaveLength(11);
      const gap = await create(body({ start: { date: sunday, time: '02:00' }, basis: r.json.basis }));
      expect(gap.status).toBe(422);
      expect(gap.json.code).toBe('NONEXISTENT_LOCAL_TIME');
    });
  });
});
