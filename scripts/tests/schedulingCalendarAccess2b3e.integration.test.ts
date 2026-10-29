import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
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
  return { cookie: null as string | null, failScheduling: false };
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
  const run = (text: string, params: unknown[]) => {
    if (state.failScheduling && /scheduling_/.test(text)) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2 relation scheduling_resources'), { code: 'ECONNREFUSED' }));
    return p.query(text, params).then(r => r.rows);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const query = (text: string, params: unknown[] = []) => run(text, [...params]);
  return { default: Object.assign(tag, { query }) };
});

const { middleware } = await import('@/middleware');
const { encrypt } = await import('@/lib/session');

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
type Route = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', Handler>>;
const offeringCalendar = (await import('@/app/api/scheduling/offerings/[offeringId]/calendar/route')) as Route;
const resourceCalendar = (await import('@/app/api/scheduling/resources/[resourceId]/calendar/route')) as Route;
const offeringRules = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-rules/route')) as Route;

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
interface Outcome { status: number; json: Json; text: string; by: 'middleware' | 'route' }
/** One request through the whole chain. The middleware runs first, exactly as in the deployment; it either answers or lets the route handle it. */
async function request(route: Route, method: 'GET' | 'POST', params: Record<string, string>, urlPath: string, opts: { query?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Outcome> {
  const url = `http://bb.test${urlPath}${opts.query ?? ''}`;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  if (state.cookie) headers.cookie = `session=${state.cookie}`;
  const gate = await middleware(new NextRequest(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  if (gate.headers.get('x-middleware-next') !== '1') {
    const text = await gate.text();
    return { status: gate.status, json: text ? safeJson(text) : null, text, by: 'middleware' };
  }
  const response = await route[method]!(new Request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, json: text ? safeJson(text) : null, text, by: 'route' };
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
