import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, seedOffering, seedResource, seedSchedule, staff } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3c UI slice 1: the server visibility gate (lib/scheduling/facilityHireVisibility.ts) over the REAL session, capability and managed-access tables of a DISPOSABLE
// PostgreSQL (scripts/tests/verify-scheduling-phase2c.sh, 16 and 17), and the dialog's OWN client code (loadBookableOfferings, fetchBasis) driven against the real routes
// (middleware -> route -> schedulingRoute -> runtime -> PostgresHireRepository.readHireOffer). No browser: fetch is bridged to the real route handlers. Nothing is written by the UI
// path; every table is byte-identical after the reads.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = 'test-only-session-secret-for-the-disposable-staff-booking-ui-0123456789abcdef';
  return { cookie: null as string | null };
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
  p.on('error', () => undefined);
  const run = (text: string, params: unknown[]) => p.query(text, params).then(r => r.rows);
  type Lazy = { text: string; params: unknown[]; then: (a: (v: unknown[]) => unknown, b?: (e: unknown) => unknown) => Promise<unknown> };
  const query = (text: string, params: unknown[] = []): Lazy => ({ text, params, then: (a, b) => run(text, params).then(a, b) });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const transaction = async (queries: Lazy[]) => {
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      const out: unknown[] = [];
      for (const q of queries) out.push((await c.query(q.text, q.params)).rows);
      await c.query('COMMIT');
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
const { getFacilityHireVisibility } = await import('@/lib/scheduling/facilityHireVisibility');
const { loadBookableOfferings, fetchBasis } = await import('@/lib/scheduling/staffBooking/basisClient');
type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const schedulesRoute = (await import('@/app/api/scheduling/schedules/route')) as unknown as { GET: Handler };
const scheduleOfferingsRoute = (await import('@/app/api/scheduling/schedules/[scheduleId]/offerings/route')) as unknown as { GET: Handler };
const offeringResourcesRoute = (await import('@/app/api/scheduling/offerings/[offeringId]/resources/route')) as unknown as { GET: Handler };
const basisRoute = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as { GET: Handler };
const reservationsRoute = (await import('@/app/api/scheduling/reservations/route')) as unknown as { POST: Handler; GET: Handler };

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
  managerNone: { id: 'u-manager-none', org: 'org-a', role: 'manager', access: { scheduling: 'none' } },
  viewer: { id: 'u-viewer', org: 'org-a', role: 'viewer', access: { scheduling: 'view' } },
  viewerUse: { id: 'u-viewer-use', org: 'org-a', role: 'viewer', access: { scheduling: 'use' } },
  analyst: { id: 'u-analyst', org: 'org-a', role: 'analyst', access: { scheduling: 'view' } },
  noCap: { id: 'u-nocap', org: 'org-c', role: 'manager', access: { scheduling: 'use' } },
  other: { id: 'u-other', org: 'org-b', role: 'manager', access: { scheduling: 'use' } },
};
const signIn = async (p: Person) => {
  state.cookie = await encrypt({ userId: p.id, organisationId: p.org, role: p.role as never, name: p.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
};
const signOut = () => { state.cookie = null; };

/** Bridges the dialog's relative fetch() calls to the REAL route handlers, behind the REAL middleware, as the signed-in person. Records every request. */
const requests: Array<{ method: string; path: string }> = [];
async function bridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://bb.test');
  const method = init?.method ?? 'GET';
  requests.push({ method, path: url.pathname });
  const headers: Record<string, string> = {};
  if (state.cookie) headers.cookie = `session=${state.cookie}`;
  const full = url.toString();
  const gate = await middleware(new NextRequest(full, { method, headers }));
  if (gate.headers.get('x-middleware-next') !== '1') return new Response(await gate.text(), { status: gate.status, headers: { 'content-type': 'application/json' } });
  const route = (handler: Handler, params: Record<string, string> = {}) => handler(new Request(full, { method, headers }), { params: Promise.resolve(params) });
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if (p === '/api/scheduling/schedules') return route(schedulesRoute.GET);
  if ((m = p.match(/^\/api\/scheduling\/schedules\/([^/]+)\/offerings$/))) return route(scheduleOfferingsRoute.GET, { scheduleId: decodeURIComponent(m[1]) });
  if ((m = p.match(/^\/api\/scheduling\/offerings\/([^/]+)\/resources$/))) return route(offeringResourcesRoute.GET, { offeringId: decodeURIComponent(m[1]) });
  if (p === '/api/scheduling/reservations/basis') return route(basisRoute.GET);
  return Response.json({ error: 'not_found' }, { status: 404 });
}

const hours = (dayOfWeek: number, start = '09:00', end = '17:00') => ({ kind: 'hours' as const, label: null, dayOfWeek, startTime: start, endTime: end, validFrom: null, validTo: null });
const TZ = 'Australia/Adelaide';
let avail: PostgresAvailabilityRepository;

function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const MONDAY = nextWeekday(1, 3);

suite('Scheduling 2C.3c UI slice 1: visibility gate and the dialog’s read path through the real chain', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 10 });
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

  async function seedHire(org: string, p: string) {
    await seedSchedule(org, `${p}-hire`, 'resource_hire');
    await seedOffering(org, `${p}-off`, `${p}-hire`, { capacity: null, durationMinutes: 60 });
    await seedResource(org, `${p}-court-1`, 'court');
    await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, `${p}-off`, `${p}-court-1`]);
    await seedResource(org, `${p}-court-free`, 'court'); // never linked
    for (const owner of [{ kind: 'offering' as const, id: `${p}-off` }, { kind: 'resource' as const, id: `${p}-court-1` }]) {
      const r = await avail.createRule(staff(org), owner, hours(1), TZ);
      if (!r.ok) throw new Error(`seed rule: ${JSON.stringify(r)}`);
    }
  }

  beforeEach(async () => {
    process.env.SCHEDULING_FACILITY_HIRE = 'on';
    signOut();
    requests.length = 0;
    vi.stubGlobal('fetch', bridge);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_series_pauses, scheduling_series, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_availability_zones, scheduling_availability_exceptions, scheduling_availability_rules, scheduling_availability_versions, scheduling_settings CASCADE');
    await q('DELETE FROM organisation_user_access');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM audit_logs');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    await q("INSERT INTO modules (key, name, description, active) VALUES ('scheduling.facility_hire', 'Scheduling staff booking (test)', 'test', true) ON CONFLICT (key) DO UPDATE SET active = true");
    for (const id of ['org-a', 'org-b', 'org-c']) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, TZ]);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [id]);
    }
    for (const org of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling.facility_hire', true)", [org]); // org-c does not hold it
    for (const p of Object.values(PEOPLE)) await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $1, $4)', [p.id, p.org, `${p.id}@example.test`, p.role]);
    for (const p of Object.values(PEOPLE)) if (p.access) await q('INSERT INTO organisation_user_access (user_id, organisation_id, permissions, updated_by) VALUES ($1, $2, $3::jsonb, $1)', [p.id, p.org, JSON.stringify(p.access)]);
    await seedHire('org-a', 'a');
    await seedHire('org-b', 'b');
    await signIn(PEOPLE.manager);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('the visibility gate over the real tables', () => {
    it.each([['manager', true], ['admin', true], ['unmanaged', true], ['managerViewOnly', false], ['managerNone', false], ['viewer', false], ['viewerUse', false], ['analyst', false], ['noCap', false], ['other', true]] as const)(
      '%s -> %s',
      async (who, expected) => {
        await signIn(PEOPLE[who]);
        expect(await getFacilityHireVisibility()).toBe(expected);
      },
    );

    it('anonymous (no session) -> false', async () => {
      signOut();
      expect(await getFacilityHireVisibility()).toBe(false);
    });

    it('the switch absent/off/ON/true/1 -> false for everyone, including a fully entitled manager', async () => {
      for (const value of [undefined, '', 'off', 'ON', 'true', '1']) {
        if (value === undefined) delete process.env.SCHEDULING_FACILITY_HIRE;
        else process.env.SCHEDULING_FACILITY_HIRE = value;
        for (const who of ['manager', 'admin', 'other'] as const) {
          await signIn(PEOPLE[who]);
          expect(await getFacilityHireVisibility(), `${String(value)} ${who}`).toBe(false);
        }
      }
    });

    it('removing, disabling or deactivating the capability hides it at once (no caching)', async () => {
      expect(await getFacilityHireVisibility()).toBe(true);
      await q("UPDATE organisation_modules SET enabled = false WHERE organisation_id = 'org-a' AND module_key = 'scheduling.facility_hire'");
      expect(await getFacilityHireVisibility()).toBe(false);
      await q("UPDATE organisation_modules SET enabled = true WHERE organisation_id = 'org-a' AND module_key = 'scheduling.facility_hire'");
      expect(await getFacilityHireVisibility()).toBe(true);
      await q("UPDATE modules SET active = false WHERE key = 'scheduling.facility_hire'");
      expect(await getFacilityHireVisibility()).toBe(false);
      await q("UPDATE modules SET active = true WHERE key = 'scheduling.facility_hire'");
      await q("UPDATE organisation_modules SET enabled = false WHERE organisation_id = 'org-a' AND module_key = 'scheduling'");
      expect(await getFacilityHireVisibility()).toBe(false);
    });

    it('agrees with the API for every person: the page shows the button exactly when the basis endpoint would answer 200', async () => {
      for (const [name, person] of Object.entries(PEOPLE)) {
        await signIn(person);
        const visible = await getFacilityHireVisibility();
        const own = person.org === 'org-b' ? 'b' : 'a';
        const response = await bridge(`http://bb.test/api/scheduling/reservations/basis?offeringId=${own}-off&resourceId=${own}-court-1&from=${MONDAY}&to=${MONDAY}`);
        expect(response.status === 200, `${name}: visible=${visible} api=${response.status}`).toBe(visible);
      }
    });
  });

  describe('the dialog’s read path against the real routes', () => {
    it('finds the offerings that link THIS resource (and only active, facility-hire, unarchived ones), then reads the basis and the engine starts', async () => {
      const before = await hashAll();
      const offerings = await loadBookableOfferings('a-court-1');
      expect(offerings.ok).toBe(true);
      if (!offerings.ok) return;
      expect(offerings.data.offerings.map(o => [o.id, o.durationMinutes])).toEqual([['a-off', 60]]);
      // an unlinked resource of the same organisation has no bookable offering
      const none = await loadBookableOfferings('a-court-free');
      expect(none.ok && none.data.offerings).toEqual([]);

      const basis = await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: addDays(MONDAY, 13) });
      expect(basis.ok).toBe(true);
      if (!basis.ok) return;
      expect(basis.data.timezone).toBe(TZ);
      expect(basis.data.offering.durationMinutes).toBe(60);
      expect(basis.data.days).toHaveLength(14);
      const monday = basis.data.days.find(d => d.date === MONDAY)!;
      expect(monday.starts.map(s => s.time)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
      expect(basis.data.days.filter(d => d.starts.length > 0).map(d => d.date)).toEqual([MONDAY, addDays(MONDAY, 7)]);
      expect(Object.keys(basis.data.basis).sort()).toEqual(['offeringToken', 'offeringVersion', 'resourceVersion', 'scheduleToken']);
      // the dialog's reads are all GET, and they changed nothing
      expect(requests.every(r => r.method === 'GET')).toBe(true);
      expect(await hashAll()).toEqual(before);
    });

    it('the offering discovery chain is bounded and its request count is exactly schedules + offerings-per-schedule + resources-per-offering (measured; nothing is optimised without this evidence)', async () => {
      const timed = async (label: string) => {
        requests.length = 0;
        const t0 = performance.now();
        const r = await loadBookableOfferings('a-court-1');
        const ms = Math.round(performance.now() - t0);
        const n = requests.length;
        console.warn(`[discovery] ${label}: ${n} requests, ${ms} ms wall (${(ms / n).toFixed(1)} ms/request, local PostgreSQL, middleware + route + SQL each)`);
        if (!r.ok) throw new Error('discovery failed');
        return { n, ms, r: r.data };
      };
      // 1 schedule, 1 offering (the fixture): schedules(1) + offerings(1) + resources(1)
      const one = await timed('1 schedule x 1 offering');
      expect(one.n).toBe(3);
      expect(requests.every(r => r.method === 'GET')).toBe(true);
      // 9 more facility-hire schedules with 4 offerings each, all linking the court: 10 schedules, 37 offerings
      for (let s = 0; s < 9; s += 1) {
        await seedSchedule('org-a', `x${s}-hire`, 'resource_hire');
        for (let o = 0; o < 4; o += 1) {
          await seedOffering('org-a', `x${s}-off${o}`, `x${s}-hire`, { capacity: null, durationMinutes: 60 });
          await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', ['org-a', `x${s}-off${o}`, 'a-court-1']);
        }
      }
      const many = await timed('10 schedules x 37 offerings');
      expect(many.r.offerings).toHaveLength(37);
      expect(many.r.truncated).toBe(false);
      expect(many.n).toBe(1 + 10 + 37);
      // beyond the bound: 4 more offerings in one schedule -> 41 candidates, only 40 are checked and the list says so
      for (let o = 4; o < 8; o += 1) {
        await seedOffering('org-a', `x0-off${o}`, 'x0-hire', { capacity: null, durationMinutes: 60 });
        await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', ['org-a', `x0-off${o}`, 'a-court-1']);
      }
      const capped = await timed('10 schedules x 41 offerings (cap)');
      expect(capped.r.truncated).toBe(true);
      expect(capped.r.offerings.length).toBeLessThanOrEqual(40);
      expect(capped.n).toBe(1 + 10 + 40);
      // the schedules of other kinds and other organisations add no requests: org-b has its own, and a non-hire schedule is never walked
      await seedSchedule('org-a', 'y-classes', 'classes_coaching');
      const withClasses = await timed('plus one non-hire schedule');
      expect(withClasses.n).toBe(1 + 10 + 40);
    });

    it('every start the dialog would offer is one the booking API accepts (a spot check of the first and last through the real create route)', async () => {
      const basis = await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY });
      if (!basis.ok) throw new Error('basis');
      const times = basis.data.days[0].starts.map(s => s.time);
      // The dialog never POSTs; this proves the starts it shows are bookable by the existing 2C.3b route.
      for (const time of [times[0], times[times.length - 1]]) {
        const body = JSON.stringify({ offeringId: 'a-off', resourceId: 'a-court-1', start: { date: MONDAY, time }, durationMinutes: 60, partySize: 1, customer: { name: 'UI Slice Check', email: 'ui.slice@example.com' }, basis: basis.data.basis });
        const headers = { 'content-type': 'application/json', 'idempotency-key': `ui-slice-${time.replace(':', '')}-${Math.random().toString(36).slice(2, 10)}`, cookie: `session=${state.cookie}` };
        const gate = await middleware(new NextRequest('http://bb.test/api/scheduling/reservations', { method: 'POST', headers, body }));
        expect(gate.headers.get('x-middleware-next')).toBe('1');
        const res = await reservationsRoute.POST(new Request('http://bb.test/api/scheduling/reservations', { method: 'POST', headers, body }), { params: Promise.resolve({}) });
        expect(res.status, `${time} ${await res.clone().text()}`).toBe(201);
      }
      // and the booked starts leave the offer on the next read
      const after = await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY });
      if (!after.ok) throw new Error('basis');
      expect(after.data.days[0].starts.map(s => s.time)).toEqual(times.slice(1, -1));
    });

    it('tenant isolation: another organisation’s manager sees only their own offerings, and an organisation A id is the same refusal as an absent one', async () => {
      await signIn(PEOPLE.other);
      const mine = await loadBookableOfferings('b-court-1');
      expect(mine.ok && mine.data.offerings.map(o => o.id)).toEqual(['b-off']);
      const theirs = await loadBookableOfferings('a-court-1');
      expect(theirs.ok && theirs.data.offerings).toEqual([]);
      const foreign = await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY });
      const absent = await fetchBasis({ offeringId: 'nope', resourceId: 'nope', from: MONDAY, to: MONDAY });
      expect(foreign.ok).toBe(false);
      expect(absent.ok).toBe(false);
      if (!foreign.ok && !absent.ok) {
        expect([foreign.problem.status, foreign.problem.code]).toEqual([absent.problem.status, absent.problem.code]);
        expect(foreign.problem.status).toBe(404);
      }
    });

    it('an unentitled organisation, a viewer and an anonymous caller get refusals the dialog maps to fixed wording (404 gate, 403, 401) and no data', async () => {
      const { describeReadFailure } = await import('@/lib/scheduling/staffBooking/basisClient');
      const read = async () => {
        const r = await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY });
        if (r.ok) throw new Error('expected a refusal');
        return { status: r.problem.status, ...describeReadFailure(r.problem) };
      };
      await signIn(PEOPLE.noCap);
      expect(await read()).toMatchObject({ status: 404, gateOff: true });
      await signIn(PEOPLE.viewer);
      expect(await read()).toMatchObject({ status: 403, gateOff: false });
      signOut();
      expect(await read()).toMatchObject({ status: 401, gateOff: false });
      delete process.env.SCHEDULING_FACILITY_HIRE;
      await signIn(PEOPLE.manager);
      expect(await read()).toMatchObject({ status: 404, gateOff: true });
    });

    it('with the switch absent the whole discovery chain still works (the configuration reads are not gated) but the basis read is 404 - and the page would not have shown the button', async () => {
      delete process.env.SCHEDULING_FACILITY_HIRE;
      expect(await getFacilityHireVisibility()).toBe(false);
      const basis = await bridge(`http://bb.test/api/scheduling/reservations/basis?offeringId=a-off&resourceId=a-court-1&from=${MONDAY}&to=${MONDAY}`);
      expect([basis.status, await basis.json()]).toEqual([404, { error: 'not_found' }]);
    });
  });
});
