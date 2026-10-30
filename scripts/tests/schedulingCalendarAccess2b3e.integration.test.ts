import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Phase 2B.3e permission and isolation matrix for the READ-ONLY availability calendar, through the REAL chain (run by
// scripts/tests/verify-scheduling-phase2b3e.sh against a DISPOSABLE database, on PostgreSQL 16 and 17):
//   signed session cookie -> middleware.ts (the module-access boundary of PR #489: organisation_user_access x entitled modules) -> the route's real
//   requireSession() (users row, organisation match, ACTIVE status) -> schedulingRoute() (capability lookup + role -> scheduling permission) -> handler.
// Only the Next cookie store and the database client are replaced; SESSION_SECRET is a throwaway test value. Nothing here reads DATABASE_URL.
// Every denied or rejected request is followed by a content hash of every Scheduling table, the pinned zones, the user and access tables and the audit
// log: a refusal never mutates anything. The response bodies are searched for the identifiers the calendar must never expose.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = 'test-only-session-secret-for-the-disposable-calendar-matrix-0123456789';
  return { cookie: null as string | null, failScheduling: false, delayScheduling: 0, aborted: 0, latencyMs: 0, statements: 0 };
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
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 20 });
  // a switch that makes every Scheduling statement fail the way a dead database does (the session and module lookups still work)
  // A networked database: with latencyMs set, EVERY statement (middleware, session, entitlement, runtime, handler) takes that long, as one Neon HTTP request does
  const run = (text: string, params: unknown[], opts?: { fetchOptions?: { signal?: AbortSignal } }) => {
    state.statements += 1;
    return state.latencyMs > 0 ? new Promise<void>(resolve => setTimeout(resolve, state.latencyMs)).then(() => run0(text, params, opts)) : run0(text, params, opts);
  };
  const run0 = (text: string, params: unknown[], opts?: { fetchOptions?: { signal?: AbortSignal } }) => {
    // a slow database: Scheduling statements take delayScheduling ms, and stop waiting (like the Neon HTTP driver does) when the request's signal aborts
    if (state.delayScheduling > 0 && /scheduling_/.test(text)) {
      const signal = opts?.fetchOptions?.signal;
      return new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const timer = setTimeout(() => p.query(text, params).then(r => resolve(r.rows), reject), state.delayScheduling);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          state.aborted += 1;
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    }
    if (state.failScheduling && /scheduling_/.test(text)) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2 relation scheduling_resources'), { code: 'ECONNREFUSED' }));
    return p.query(text, params).then(r => r.rows);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const query = (text: string, params: unknown[] = [], opts?: { fetchOptions?: { signal?: AbortSignal } }) => run(text, [...params], opts);
  return { default: Object.assign(tag, { query }) };
});

const { middleware } = await import('@/middleware');
const { encrypt } = await import('@/lib/session');

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
type Route = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', Handler>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const offeringCalendar = (await import('@/app/api/scheduling/offerings/[offeringId]/calendar/route')) as Route;
const resourceCalendar = (await import('@/app/api/scheduling/resources/[resourceId]/calendar/route')) as Route;
const offeringRules = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-rules/route')) as Route;
const offeringHours = (await import('@/app/api/scheduling/offerings/[offeringId]/availability/route')) as Route;
const ruleItem = (await import('@/app/api/scheduling/availability-rules/[ruleId]/route')) as Route;

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');

const TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules',
  'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences',
  'scheduling_settings', 'organisations', 'organisation_modules', 'users', 'organisation_user_access', 'audit_logs',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of TABLES) out.push((await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`))[0].h);
  return out;
};

// ── people ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Person = { id: string; org: string; role: string; access: Record<string, string> | null };
const PEOPLE: Record<string, Person> = {
  managerUse: { id: 'u-manager-use', org: 'org-a', role: 'manager', access: { scheduling: 'use' } },
  managerView: { id: 'u-manager-view', org: 'org-a', role: 'manager', access: { scheduling: 'view' } },
  viewerView: { id: 'u-viewer-view', org: 'org-a', role: 'viewer', access: { scheduling: 'view' } },
  viewerNone: { id: 'u-viewer-none', org: 'org-a', role: 'viewer', access: { crm: 'use' } },
  viewerUse: { id: 'u-viewer-use', org: 'org-a', role: 'viewer', access: { scheduling: 'use' } },
  analyst: { id: 'u-analyst', org: 'org-a', role: 'analyst', access: { scheduling: 'view' } },
  unmanagedManager: { id: 'u-unmanaged', org: 'org-a', role: 'manager', access: null }, // no organisation_user_access row: the legacy, unrestricted account
  unentitled: { id: 'u-unentitled', org: 'org-d', role: 'manager', access: { scheduling: 'use' } },
  otherOrg: { id: 'u-other', org: 'org-b', role: 'manager', access: { scheduling: 'use' } },
};
const signIn = async (p: Person, over: Partial<{ organisationId: string; role: string }> = {}) => {
  state.cookie = await encrypt({ userId: p.id, organisationId: over.organisationId ?? p.org, role: (over.role ?? p.role) as never, name: p.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
};
const signOut = () => { state.cookie = null; };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Outcome { status: number; json: Json; text: string; by: 'middleware' | 'route'; serverTiming: string | null }
/** One request through the whole chain. The middleware runs first, exactly as in the deployment; it either answers or lets the route handle it. */
async function request(route: Route, method: Method, params: Record<string, string>, urlPath: string, opts: { query?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Outcome> {
  const url = `http://bb.test${urlPath}${opts.query ?? ''}`;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  if (state.cookie) headers.cookie = `session=${state.cookie}`;
  const gate = await middleware(new NextRequest(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  if (gate.headers.get('x-middleware-next') !== '1') {
    const text = await gate.text();
    return { status: gate.status, json: text ? safeJson(text) : null, text, by: 'middleware', serverTiming: null };
  }
  const response = await route[method]!(new Request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, json: text ? safeJson(text) : null, text, by: 'route', serverTiming: response.headers.get('server-timing') };
}
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };

const ids = { schedule: '', offering: '', resource: '', otherOffering: '', otherResource: '' };
const offCal = (query = '?from=2027-01-11&to=2027-01-17', headers?: Record<string, string>) => request(offeringCalendar, 'GET', { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/calendar`, { query, headers });
const resCal = (query = '?from=2027-01-11&to=2027-01-17') => request(resourceCalendar, 'GET', { resourceId: ids.resource }, `/api/scheduling/resources/${ids.resource}/calendar`, { query });

suite('Scheduling 2B.3e calendar: permission and isolation matrix through the real chain', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 10 });
    pool.on('error', () => undefined);
    await pool.query(sqlFile('034_availability_integrity.sql'));
    await pool.query(sqlFile('035_availability_partial_closures.sql'));
    await pool.query(sqlFile('036_availability_zones.sql'));
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS organisation_user_access (user_id TEXT PRIMARY KEY REFERENCES users(id), organisation_id TEXT NOT NULL REFERENCES organisations(id),
         permissions JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL REFERENCES users(id))`,
    );
  }, 60_000);
  afterAll(async () => {
    await pool?.query('DROP TABLE IF EXISTS organisation_user_access').catch(() => undefined);
    await pool?.query(sqlFile('097_availability_zones_rollback.sql')).catch(() => undefined);
    await pool?.query(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await pool?.end();
  });

  beforeEach(async () => {
    signOut();
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_availability_zones, scheduling_availability_rules, scheduling_availability_exceptions, scheduling_settings, audit_logs, zz_committed CASCADE');
    await q('DELETE FROM organisation_user_access');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    for (const [id, tz] of [['org-a', 'Australia/Adelaide'], ['org-b', 'Australia/Perth'], ['org-d', 'Australia/Adelaide']] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
    }
    for (const org of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [org]); // org-d is NOT entitled
    for (const p of Object.values(PEOPLE)) {
      await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $1, $4)', [p.id, p.org, `${p.id}@example.test`, p.role]);
    }
    for (const p of Object.values(PEOPLE)) {
      if (p.access) await q('INSERT INTO organisation_user_access (user_id, organisation_id, permissions, updated_by) VALUES ($1, $2, $3::jsonb, $1)', [p.id, p.org, JSON.stringify(p.access)]);
    }
    await seed();
  });

  // Seeds through the real manager API (the unmanaged manager has full access), so the rows are exactly what the product writes.
  async function seed() {
    const mod = async <T,>(p: string) => (await import(p)) as T;
    void mod;
    const schedulesRoute = (await import('@/app/api/scheduling/schedules/route')) as Route;
    const scheduleOfferings = (await import('@/app/api/scheduling/schedules/[scheduleId]/offerings/route')) as Route;
    const resourcesRoute = (await import('@/app/api/scheduling/resources/route')) as Route;
    const offeringResources = (await import('@/app/api/scheduling/offerings/[offeringId]/resources/route')) as Route;
    const resourceRules = (await import('@/app/api/scheduling/resources/[resourceId]/availability-rules/route')) as Route;
    const create = async (as: Person, route: Route, params: Record<string, string>, p: string, body: unknown) => {
      await signIn(as);
      const r = await request(route, 'POST', params, p, { body });
      expect(r.status, r.text).toBeLessThan(300);
      return r.json;
    };
    const a = PEOPLE.unmanagedManager;
    ids.schedule = (await create(a, schedulesRoute, {}, '/api/scheduling/schedules', { name: 'Hire', presetKey: 'resource_hire' })).schedule.id;
    ids.offering = (await create(a, scheduleOfferings, { scheduleId: ids.schedule }, `/api/scheduling/schedules/${ids.schedule}/offerings`, { name: 'Court hire', durationMinutes: 60 })).offering.id;
    ids.resource = (await create(a, resourcesRoute, {}, '/api/scheduling/resources', { kind: 'court', name: 'Court 1', capacity: 4 })).resource.id;
    await create(a, offeringResources, { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/resources`, { resourceId: ids.resource });
    await create(a, offeringRules, { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/availability-rules`, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    await create(a, resourceRules, { resourceId: ids.resource }, `/api/scheduling/resources/${ids.resource}/availability-rules`, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    const b = PEOPLE.otherOrg;
    ids.otherOffering = (await create(b, scheduleOfferings, { scheduleId: (await create(b, schedulesRoute, {}, '/api/scheduling/schedules', { name: 'Other', presetKey: 'resource_hire' })).schedule.id }, '/api/scheduling/schedules/x/offerings', { name: 'Other hire', durationMinutes: 60 })).offering.id;
    ids.otherResource = (await create(b, resourcesRoute, {}, '/api/scheduling/resources', { kind: 'court', name: 'Other court', capacity: 2 })).resource.id;
    signOut();
  }


  const FORBIDDEN_IN_BODY = () => [/org-[abd]\b/, /organisation/i, /reservation_?id/i, /occurrence_?id/i, /hold_?id/i, /customer/i, /email/i, /@example\.test/, /u-(manager|viewer|analyst|unmanaged|other)/];

  describe('who may see the calendar', () => {
    const ALLOWED: Array<[string, keyof typeof PEOPLE]> = [
      ['a MANAGER with use access', 'managerUse'],
      ['a MANAGER with view-only access', 'managerView'],
      ['a VIEWER with view access', 'viewerView'],
      ['a VIEWER with use access (the module grant is not the role)', 'viewerUse'],
      ['a legacy account with no module restrictions', 'unmanagedManager'],
    ];
    for (const [label, who] of ALLOWED) {
      it(`${label}: 200 on both calendars, identical bodies`, async () => {
        await signIn(PEOPLE.managerUse);
        const baseOffering = (await offCal()).text;
        const baseResource = (await resCal()).text;
        await signIn(PEOPLE[who]);
        const o = await offCal();
        const r = await resCal();
        expect(o.status, o.text).toBe(200);
        expect(r.status, r.text).toBe(200);
        expect(o.by).toBe('route');
        expect(o.text).toBe(baseOffering);
        expect(r.text).toBe(baseResource);
      });
    }

    it('a VIEWER with no module access is stopped by the module boundary (403) before the route', async () => {
      await signIn(PEOPLE.viewerNone);
      for (const r of [await offCal(), await resCal()]) {
        expect(r.status).toBe(403);
        expect(r.by).toBe('middleware');
      }
    });

    it('an ANALYST is denied even with a Scheduling grant (403 from the route’s permission mapping)', async () => {
      await signIn(PEOPLE.analyst);
      for (const r of [await offCal(), await resCal()]) expect(r.status, r.text).toBe(403);
    });

    it('an organisation that is not entitled to Scheduling is denied (403), and so is its manager even with a Scheduling grant', async () => {
      await signIn(PEOPLE.unentitled);
      for (const r of [await offCal(), await resCal()]) expect(r.status, r.text).toBe(403);
    });

    it('an unauthenticated request is 401, a tampered or foreign-signed cookie is 401, and a session for a user that no longer matches the database is 401', async () => {
      signOut();
      expect((await offCal()).status).toBe(401);
      expect((await resCal()).status).toBe(401);
      state.cookie = 'not-a-jwt';
      expect((await offCal()).status).toBe(401);
      await signIn(PEOPLE.managerUse);
      state.cookie = `${state.cookie}x`; // signature no longer verifies
      expect((await offCal()).status).toBe(401);
      await signIn(PEOPLE.managerUse, { organisationId: 'org-b' }); // the cookie claims another organisation than the user row
      const mismatch = await offCal();
      expect(mismatch.status, mismatch.text).toBe(401);
      await q("UPDATE users SET status = 'INACTIVE' WHERE id = 'u-manager-use'");
      await signIn(PEOPLE.managerUse);
      expect((await offCal()).status).toBe(401);
    });

    it('a cookie that claims a higher role than the user row has is judged by the row (no privilege from the cookie)', async () => {
      await signIn(PEOPLE.viewerView, { role: 'super_admin' });
      const o = await offCal();
      expect(o.status, o.text).toBe(200); // a viewer may view; the claim neither helps nor hurts
      await signIn(PEOPLE.analyst, { role: 'manager' });
      expect((await offCal()).status).toBe(403); // the analyst row wins over the manager claim
    });
  });

  describe('isolation: foreign ids and spoofed organisation identifiers', () => {
    it('another organisation’s offering and resource ids answer 404 exactly like a missing id, with no trace of the other organisation', async () => {
      await signIn(PEOPLE.managerUse);
      const foreignO = await request(offeringCalendar, 'GET', { offeringId: ids.otherOffering }, `/api/scheduling/offerings/${ids.otherOffering}/calendar`, { query: '?from=2027-01-11' });
      const foreignR = await request(resourceCalendar, 'GET', { resourceId: ids.otherResource }, `/api/scheduling/resources/${ids.otherResource}/calendar`, { query: '?from=2027-01-11' });
      const missingO = await request(offeringCalendar, 'GET', { offeringId: 'does-not-exist' }, '/api/scheduling/offerings/does-not-exist/calendar', { query: '?from=2027-01-11' });
      const missingR = await request(resourceCalendar, 'GET', { resourceId: 'does-not-exist' }, '/api/scheduling/resources/does-not-exist/calendar', { query: '?from=2027-01-11' });
      for (const r of [foreignO, foreignR, missingO, missingR]) expect(r.status, r.text).toBe(404);
      expect(foreignO.text).toBe(missingO.text);
      expect(foreignR.text).toBe(missingR.text);
      expect(foreignO.text).not.toContain('Other');
    });

    it('the other organisation sees only its own, and cannot read this organisation’s ids either', async () => {
      await signIn(PEOPLE.otherOrg);
      const own = await request(offeringCalendar, 'GET', { offeringId: ids.otherOffering }, `/api/scheduling/offerings/${ids.otherOffering}/calendar`, { query: '?from=2027-01-11' });
      expect(own.status, own.text).toBe(200);
      expect((await offCal()).status).toBe(404);
      expect((await resCal()).status).toBe(404);
    });

    it('an organisation named in the query string is refused (400), never honoured, and one named in a header is ignored', async () => {
      await signIn(PEOPLE.managerUse);
      const plain = await offCal();
      for (const q of ['&organisationId=org-b', '&organisation_id=org-b', '&org=org-b', '&tenant=org-b', '&userId=u-other']) {
        const r = await offCal(`?from=2027-01-11&to=2027-01-17${q}`);
        expect(r.status, q).toBe(400);
        expect(r.text).not.toContain('Other hire');
      }
      const spoofed = await offCal('?from=2027-01-11&to=2027-01-17', { 'x-organisation-id': 'org-b', 'x-org-id': 'org-b', 'x-forwarded-organisation': 'org-b', 'x-tenant-id': 'org-b' });
      expect(spoofed.status).toBe(200);
      expect(spoofed.text).toBe(plain.text);
    });
  });

  describe('what the response carries', () => {
    it('no organisation, customer, reservation, occurrence or hold identifier, and no user identity, in either calendar', async () => {
      // one live hold on the resource, so the occupied block exists
      await q(
        `WITH occ AS (INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
           VALUES ('occ-secret-1', 'org-a', $1, $2, '2027-01-11', '12:00', 'Australia/Adelaide', '2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z', 1) RETURNING id, organisation_id, resource_id, starts_at, ends_at)
         INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id) SELECT 'hold-secret-1', organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM occ`,
        [ids.offering, ids.resource],
      );
      await signIn(PEOPLE.viewerView);
      for (const r of [await offCal(), await resCal()]) {
        expect(r.status, r.text).toBe(200);
        for (const pattern of FORBIDDEN_IN_BODY()) expect(r.text, String(pattern)).not.toMatch(pattern);
        expect(r.text).not.toMatch(/occ-secret-1|hold-secret-1/);
      }
      const o = await offCal();
      expect(JSON.stringify(o.json.lanes.flatMap((l: { occupied: unknown[] }) => l.occupied))).toContain('"kind":"session"');
    });

    it('every answer, including refusals, is uncacheable by shared caches', async () => {
      const heads: string[] = [];
      for (const who of ['managerUse', 'analyst', 'unentitled'] as const) {
        await signIn(PEOPLE[who]);
        const gate = await middleware(new NextRequest(`http://bb.test/api/scheduling/offerings/${ids.offering}/calendar?from=2027-01-11`, { headers: { cookie: `session=${state.cookie}` } }));
        heads.push(gate.headers.get('cache-control') ?? '(none from middleware)');
        if (gate.headers.get('x-middleware-next') === '1') {
          const response = await offeringCalendar.GET!(new Request(`http://bb.test/api/scheduling/offerings/${ids.offering}/calendar?from=2027-01-11`, { headers: { cookie: `session=${state.cookie}` } }), { params: Promise.resolve({ offeringId: ids.offering }) });
          heads.push(response.headers.get('cache-control') ?? '(none)');
          await response.text();
        }
      }
      for (const h of heads) expect(h === '(none from middleware)' || /no-store|private/.test(h), h).toBe(true);
      expect(heads.filter(h => h === '(none)')).toEqual([]);
    });
  });

  describe('service_period fails closed in the API', () => {
    const rulesRoute = offeringRules;
    const insertServicePeriod = async (owner: 'offering' | 'resource') => {
      const column = owner === 'offering' ? 'offering_id' : 'resource_id';
      const id = owner === 'offering' ? ids.offering : ids.resource;
      await q(`INSERT INTO scheduling_availability_rules (id, organisation_id, ${column}, kind, label, day_of_week, start_time, end_time) VALUES ($1, 'org-a', $2, 'service_period', 'Dinner', 2, '17:00', '21:00')`, [`sp-${owner}`, id]);
    };

    it('the hours API refuses to save a service_period rule (400 INVALID_INPUT), says what to do, and writes nothing', async () => {
      await signIn(PEOPLE.managerUse);
      const before = await hashAll();
      const created = await request(rulesRoute, 'POST', { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/availability-rules`, { body: { dayOfWeek: 3, startTime: '17:00', endTime: '21:00', kind: 'service_period' } });
      expect(created.status, created.text).toBe(400);
      expect(created.text).toMatch(/not supported yet/);
      expect(created.text).not.toMatch(/org-a/);
      const unknown = await request(rulesRoute, 'POST', { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/availability-rules`, { body: { dayOfWeek: 3, startTime: '17:00', endTime: '21:00', kind: 'banquet' } });
      expect(unknown.status).toBe(400);
      expect(await hashAll()).toEqual(before);
    });

    it('a stored service_period rule makes the offering calendar unavailable: no slots, a clear reason, the lane marked unsupported, nothing identifying', async () => {
      await insertServicePeriod('offering');
      await signIn(PEOPLE.viewerView);
      const before = await hashAll();
      const r = await offCal();
      expect(r.status, r.text).toBe(200);
      expect(r.json.slots).toEqual([]);
      expect(r.json.reasons).toContain('unsupported_rule_kind');
      expect(r.json.lanes.find((l: { kind: string }) => l.kind === 'offering')).toMatchObject({ state: 'unsupported', hours: [], free: [] });
      expect(r.text).not.toMatch(/Dinner|sp-offering|org-a|organisation/i);
      expect(await hashAll()).toEqual(before);
    });

    it('a stored service_period rule on a resource makes that resource unavailable (and the offering draws no slot through it); the resource calendar says so too', async () => {
      await insertServicePeriod('resource');
      await signIn(PEOPLE.viewerView);
      const o = await offCal();
      expect(o.status, o.text).toBe(200);
      expect(o.json.slots).toEqual([]);
      expect(o.json.reasons).toContain(`resource_unsupported_rule_kind:${ids.resource}`);
      expect(o.json.lanes.find((l: { id: string }) => l.id === ids.resource)).toMatchObject({ state: 'unsupported', hours: [] });
      const r = await resCal();
      expect(r.status, r.text).toBe(200);
      expect(r.json.reasons).toEqual([`resource_unsupported_rule_kind:${ids.resource}`]);
      expect(r.json.lanes[0].state).toBe('unsupported');
    });

    it('the way out works: the rule can be changed to hours (not to service_period) or removed, and the calendar opens again', async () => {
      await insertServicePeriod('offering');
      await signIn(PEOPLE.managerUse);
      const hours = await request(offeringHours, 'GET', { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/availability`);
      expect(hours.status, hours.text).toBe(200);
      const stored = (hours.json.rules as Array<{ id: string; kind: string; updatedAt: string }>).find(x => x.kind === 'service_period')!;
      expect(stored).toBeTruthy();
      const path = `/api/scheduling/availability-rules/${stored.id}`;
      const toServicePeriod = await request(ruleItem, 'PATCH', { ruleId: stored.id }, path, { body: { kind: 'service_period', expectedUpdatedAt: stored.updatedAt } });
      expect(toServicePeriod.status, toServicePeriod.text).toBe(400);
      const stillClosed = await offCal('?from=2027-01-12&to=2027-01-12');
      expect(stillClosed.json.reasons).toContain('unsupported_rule_kind');
      const toHours = await request(ruleItem, 'PATCH', { ruleId: stored.id }, path, { body: { kind: 'hours', expectedUpdatedAt: stored.updatedAt } });
      expect(toHours.status, toHours.text).toBe(200);
      const open = await offCal('?from=2027-01-11&to=2027-01-17');
      expect(open.json.reasons).not.toContain('unsupported_rule_kind');
      expect(open.json.slots.length).toBeGreaterThan(0);
      // and removal: put one back, delete it with its version token
      await q("UPDATE scheduling_availability_rules SET kind = 'service_period' WHERE id = $1", [stored.id]);
      const again = await request(offeringHours, 'GET', { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/availability`);
      const fresh = (again.json.rules as Array<{ id: string; kind: string; updatedAt: string }>).find(x => x.id === stored.id)!;
      const removed = await request(ruleItem, 'DELETE', { ruleId: stored.id }, path, { body: { expectedUpdatedAt: fresh.updatedAt } });
      expect(removed.status, removed.text).toBeLessThan(300);
      expect((await offCal('?from=2027-01-11&to=2027-01-17')).json.reasons).not.toContain('unsupported_rule_kind');
    });
  });

  describe('a bounded execution time and a safe log line', () => {
    const logLines = () => logged.map(l => JSON.parse(l.replace(/^\[scheduling\] request /, '')) as { route: string; method: string; status: number; ms: number; outcome: string; error?: string });
    let logged: string[] = [];
    let infoSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logged = [];
      infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => { if (String(args[0]).startsWith('[scheduling] request')) logged.push(args.map(String).join(' ')); });
    });
    afterEach(() => {
      infoSpy.mockRestore();
      delete process.env.SCHEDULING_CALENDAR_DEADLINE_MS;
      state.delayScheduling = 0;
    });

    it('the deadline is 8 seconds by default, tunable between 250 ms and 25 s, and a bad value never means "no limit"', async () => {
      const { calendarDeadlineMs, CALENDAR_DEADLINE_DEFAULT_MS } = await import('@/lib/scheduling/config/calendar');
      expect(CALENDAR_DEADLINE_DEFAULT_MS).toBe(8000);
      const at = (v: string | undefined) => {
        if (v === undefined) delete process.env.SCHEDULING_CALENDAR_DEADLINE_MS;
        else process.env.SCHEDULING_CALENDAR_DEADLINE_MS = v;
        return calendarDeadlineMs();
      };
      expect([at(undefined), at(''), at('abc'), at('10'), at('249'), at('25001'), at('99999999'), at('-5'), at('NaN'), at('Infinity')]).toEqual(Array(10).fill(8000));
      expect([at('250'), at('500'), at('1234.4'), at('25000')]).toEqual([250, 500, 1234, 25000]);
    });

    it('a slow database ends in 504 SCHEDULING_TIMEOUT at the deadline: the statements stop waiting, nothing is returned or written, and the next request works', async () => {
      process.env.SCHEDULING_CALENDAR_DEADLINE_MS = '300';
      const errors: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')); });
      await signIn(PEOPLE.viewerView);
      const before = await hashAll();
      state.delayScheduling = 2000;
      state.aborted = 0;
      const t0 = Date.now();
      const o = await offCal();
      const took = Date.now() - t0;
      expect(o.status, o.text).toBe(504);
      expect(o.json).toEqual({ error: expect.stringMatching(/took too long.*Nothing was changed/), code: 'SCHEDULING_TIMEOUT' });
      expect(took, 'answered at the deadline, not when the database finally answered').toBeLessThan(1500);
      expect(o.text).not.toMatch(/org-a|scheduling_[a-z]|SELECT|AbortError/); // (its own code, SCHEDULING_TIMEOUT, is upper case)
      expect(state.aborted, 'the in-flight statements were told to stop').toBeGreaterThan(0);
      const r = await resCal();
      expect(r.status).toBe(504);
      state.delayScheduling = 0;
      await new Promise(resolve => setTimeout(resolve, 100)); // the discarded work settles quietly
      expect(await hashAll()).toEqual(before);
      const ok = await offCal();
      expect(ok.status, ok.text).toBe(200);
      const lines = logLines();
      expect(lines.filter(l => l.outcome === 'timeout')).toHaveLength(2); // exactly one line per timed-out request: the late result is not logged again
      expect(lines.filter(l => l.outcome === 'error')).toEqual([]);
      expect(errors.filter(e => /AbortError/.test(e)), 'the abort that ended the wait is not reported as a fault').toEqual([]);
      errSpy.mockRestore();
    });

    it('a request inside its deadline is not cut off, even when the database is a little slow', async () => {
      process.env.SCHEDULING_CALENDAR_DEADLINE_MS = '5000';
      await signIn(PEOPLE.viewerView);
      state.delayScheduling = 20;
      const o = await offCal();
      expect(o.status, o.text).toBe(200);
    });

    it('every Scheduling request logs ONE line with the route template, method, status, duration and outcome, and nothing that identifies anyone or anything', async () => {
      await signIn(PEOPLE.managerUse);
      const ok = await offCal('?from=2027-01-11&to=2027-01-17&step=30');
      const missing = await request(offeringCalendar, 'GET', { offeringId: 'nope' }, '/api/scheduling/offerings/nope/calendar', { query: '?from=2027-01-11' });
      await signIn(PEOPLE.analyst);
      const denied = await offCal();
      signOut();
      const anonymous = await offCal();
      expect([ok.status, missing.status, denied.status, anonymous.status]).toEqual([200, 404, 403, 401]);

      expect(logged).toHaveLength(4);
      const [a, b, c, d] = logLines();
      expect(a).toEqual({ route: '/api/scheduling/offerings/:id/calendar', method: 'GET', status: 200, ms: expect.any(Number), outcome: 'ok', stmts: expect.any(Number), dbMs: expect.any(Number) });
      expect(a.stmts, 'the repository statements of one calendar: settings, offering, links, schedule, three batched reads for the offering, three for the resources, holds').toBe(11);
      expect(a.dbMs).toBeGreaterThanOrEqual(0);
      expect(b).toMatchObject({ route: '/api/scheduling/offerings/:id/calendar', status: 404, outcome: 'ok' }); // a handled 404 is the handler's normal answer
      expect(c).toEqual({ route: '/api/scheduling/(not resolved)', method: 'GET', status: 403, ms: expect.any(Number), outcome: 'denied', stmts: 0, dbMs: 0 });
      expect(d).toMatchObject({ status: 401, outcome: 'denied', route: '/api/scheduling/(not resolved)' });
      for (const line of logged) {
        expect(line).not.toMatch(new RegExp(`${ids.offering}|${ids.resource}|org-|u-manager|u-analyst|nope|eyJ|session|cookie|from=|step=|SELECT|INSERT|scheduling_|password|@`, 'i'));
      }
      expect(logLines().every(l => Number.isInteger(l.ms) && l.ms >= 0 && l.ms < 10_000)).toBe(true);
    });

    it('the response carries a Server-Timing header with numbers only (request time, database time, statement count), on success and on a refusal that reached the runtime', async () => {
      await signIn(PEOPLE.viewerView);
      const ok = await offCal();
      expect(ok.serverTiming, 'Server-Timing on a 200').toMatch(/^app;dur=\d+, db;dur=\d+;desc="\d+ statements, summed"$/);
      const missing = await request(offeringCalendar, 'GET', { offeringId: 'nope' }, '/api/scheduling/offerings/nope/calendar', { query: '?from=2027-01-11' });
      expect(missing.status).toBe(404);
      expect(missing.serverTiming).toMatch(/^app;dur=\d+, db;dur=\d+;desc="\d+ statements, summed"$/);
      expect(`${ok.serverTiming} ${missing.serverTiming}`).not.toMatch(new RegExp(`${ids.offering}|org-|nope|SELECT|scheduling_`));
      const denied = (signOut(), await offCal());
      expect(denied.status).toBe(401);
    });

    it('a failing database is logged as an error with its code or name only', async () => {
      await signIn(PEOPLE.managerUse);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      state.failScheduling = true;
      try {
        expect((await offCal()).status).toBeGreaterThanOrEqual(500);
      } finally {
        state.failScheduling = false;
        errSpy.mockRestore();
      }
      const [line] = logLines();
      expect(line.outcome === 'unavailable' || line.outcome === 'error').toBe(true);
      expect(line.error).toBe('ECONNREFUSED');
      expect(logged.join('\n')).not.toMatch(/hunter2|10\.1\.2\.3|password|relation|scheduling_/i);
    });
  });

  describe('request time with a networked database (every statement takes one round trip)', () => {
    const ROUND_TRIP_MS = Number(process.env.SCHEDULING_LATENCY_MS ?? 40);
    afterEach(() => { state.latencyMs = 0; });

    /** One request through the whole chain, timed, with the number of statements it issued. */
    async function timed(call: () => Promise<Outcome>) {
      state.statements = 0;
      const t0 = performance.now();
      const r = await call();
      const ms = Math.round(performance.now() - t0);
      return { status: r.status, statements: state.statements, ms, roundTrips: Math.round((ms / ROUND_TRIP_MS) * 10) / 10 };
    }

    it('records the cost of the calendar request, of the /status request the screen used to wait for, and of both in a row; the calendar needs no more than its bound', async () => {
      const statusRoute = (await import('@/app/api/scheduling/status/route')) as Route;
      await signIn(PEOPLE.viewerView);
      await offCal(); // warm the pool
      state.latencyMs = ROUND_TRIP_MS;
      const status = await timed(() => request(statusRoute, 'GET', {}, '/api/scheduling/status'));
      const offering = await timed(() => offCal());
      const resource = await timed(() => resCal());
      const old = { statusThenCalendarMs: status.ms + offering.ms, statusThenCalendarRoundTrips: Math.round(((status.ms + offering.ms) / ROUND_TRIP_MS) * 10) / 10 };
      const report = { roundTripMs: ROUND_TRIP_MS, status, offering, resource, old };
      console.log('[latency]', JSON.stringify(report));
      if (process.env.SCHEDULING_LATENCY_REPORT) fs.writeFileSync(process.env.SCHEDULING_LATENCY_REPORT, JSON.stringify(report, null, 2));
      expect([status.status, offering.status, resource.status]).toEqual([200, 200, 200]);
      // the bound this change establishes: the calendar's own work is a handful of sequential round trips, however many statements it issues
      // Bounds with room for scheduler noise. Before the handler read its inputs together and the runtime read the zone and settings together these were 14.1 and 12.2 round trips
      // (and the screen waited for a /status request of 9.4 before asking for the calendar at all). Time-based, so it is only enforced where the proof script asks (a loaded machine would flake).
      if (process.env.SCHEDULING_LATENCY_ASSERT === '1') {
        expect(offering.roundTrips, JSON.stringify(offering)).toBeLessThanOrEqual(12.5);
        expect(resource.roundTrips, JSON.stringify(resource)).toBeLessThanOrEqual(11.5);
      }
    }, 60_000);
  });

  describe('when the database fails', () => {
    it('both calendars answer a generic 5xx with no driver text, address, credential or SQL, log only a code, and a recovered database serves again', async () => {
      await signIn(PEOPLE.managerUse);
      const logged: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
      state.failScheduling = true;
      try {
        for (const r of [await offCal(), await resCal()]) {
          expect(r.status, r.text).toBeGreaterThanOrEqual(500);
          expect(r.status).toBeLessThan(600);
          expect(r.text).not.toMatch(/ECONNREFUSED|10.1.2.3|hunter2|password|scheduling_|SELECT|relation/i);
          expect(r.by).toBe('route');
        }
      } finally {
        state.failScheduling = false;
        spy.mockRestore();
      }
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) expect(line, line).not.toMatch(/hunter2|10.1.2.3|password|SELECT/i);
      expect((await offCal()).status).toBe(200); // nothing is stuck
    });
  });

  describe('a rejected request mutates nothing', () => {
    it('after every denial, bad input, foreign id and spoof above, and a write attempt by view-only accounts, all tables hash identically', async () => {
      const before = await hashAll();
      const attempts: Array<() => Promise<unknown>> = [
        async () => { signOut(); await offCal(); await resCal(); },
        async () => { await signIn(PEOPLE.viewerNone); await offCal(); await resCal(); },
        async () => { await signIn(PEOPLE.analyst); await offCal(); await resCal(); },
        async () => { await signIn(PEOPLE.unentitled); await offCal(); await resCal(); },
        async () => { await signIn(PEOPLE.managerUse); await offCal('?from=bad'); await offCal('?from=2027-01-11&to=2027-03-30'); await offCal('?from=2027-01-11&organisationId=org-b'); await offCal('?from=2027-01-11&step=0'); },
        async () => { await signIn(PEOPLE.managerUse); await request(offeringCalendar, 'GET', { offeringId: ids.otherOffering }, `/api/scheduling/offerings/${ids.otherOffering}/calendar`, { query: '?from=2027-01-11' }); },
        // write attempts at the hours API by accounts that may only view: refused by the module boundary (view-only grant) or by the route (viewer role)
        async () => {
          for (const who of ['managerView', 'viewerView', 'analyst'] as const) {
            await signIn(PEOPLE[who]);
            const r = await request(offeringRules, 'POST', { offeringId: ids.offering }, `/api/scheduling/offerings/${ids.offering}/availability-rules`, { body: { dayOfWeek: 3, startTime: '09:00', endTime: '10:00' } });
            expect(r.status, who).toBe(403);
          }
        },
      ];
      for (const attempt of attempts) {
        await attempt();
        expect(await hashAll()).toEqual(before);
      }
    });

    it('even an ALLOWED look changes nothing: no rule, no pin, no hold, no reservation, no occurrence, no audit row', async () => {
      const before = await hashAll();
      for (const who of ['managerUse', 'managerView', 'viewerView', 'unmanagedManager'] as const) {
        await signIn(PEOPLE[who]);
        for (let i = 0; i < 3; i++) {
          expect((await offCal()).status).toBe(200);
          expect((await resCal()).status).toBe(200);
        }
      }
      expect(await hashAll()).toEqual(before);
    });
  });
});
