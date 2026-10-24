import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';

// Phase 2B.2b real-Postgres proof of the Scheduling CONFIGURATION API (run by scripts/tests/verify-scheduling-phase2b2b.sh
// against a DISPOSABLE database). It reaches only the database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL.
// Only two things are replaced: the application's database client (a pool onto that same disposable database, with Neon's
// tagged-template and .query shapes) and the session. The capability lookup, the central guard, the runtime, the shared
// Postgres repositories, the audit module and every route handler are the REAL code.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => ({ session: null as null | Record<string, unknown> }));

vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 40 });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    p.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values).then(r => r.rows);
  const query = (text: string, params: unknown[] = []) => p.query(text, [...params]).then(r => r.rows);
  return { default: Object.assign(tag, { query }) };
});
vi.mock('@/lib/org', () => ({
  requireSession: async () => {
    if (!state.session) throw new Error('Unauthorized');
    return state.session;
  },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
type Route = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', Handler>>;

const schedulesRoute = (await import('@/app/api/scheduling/schedules/route')) as Route;
const scheduleRoute = (await import('@/app/api/scheduling/schedules/[scheduleId]/route')) as Route;
const scheduleArchive = (await import('@/app/api/scheduling/schedules/[scheduleId]/archive/route')) as Route;
const scheduleOfferings = (await import('@/app/api/scheduling/schedules/[scheduleId]/offerings/route')) as Route;
const offeringRoute = (await import('@/app/api/scheduling/offerings/[offeringId]/route')) as Route;
const offeringArchive = (await import('@/app/api/scheduling/offerings/[offeringId]/archive/route')) as Route;
const offeringResources = (await import('@/app/api/scheduling/offerings/[offeringId]/resources/route')) as Route;
const offeringResource = (await import('@/app/api/scheduling/offerings/[offeringId]/resources/[resourceId]/route')) as Route;
const resourcesRoute = (await import('@/app/api/scheduling/resources/route')) as Route;
const resourceRoute = (await import('@/app/api/scheduling/resources/[resourceId]/route')) as Route;
const resourceDeactivate = (await import('@/app/api/scheduling/resources/[resourceId]/deactivate/route')) as Route;
const resourceReactivate = (await import('@/app/api/scheduling/resources/[resourceId]/reactivate/route')) as Route;
const { staffTenantContext } = await import('@/lib/scheduling/adapters/brainbase');
const { createPostgresScheduling, fromPgLike } = await import('@scheduling/postgres');
const { slotBooking } = await import('../../packages/scheduling-postgres/tests/support/builders');

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const hash = async (table: string, org?: string) =>
  (await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${table} t${org ? ` WHERE t.organisation_id = '${org}'` : ''}`))[0].h;
const SCHED_TABLES = ['scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences'];
const snapshot = async (org: string) => Promise.all([...SCHED_TABLES.map(t => hash(t, org)), hash('audit_logs', org)]);

const as = (role: string, organisationId: string, over: Record<string, unknown> = {}) => {
  state.session = { userId: `user-${organisationId}`, organisationId, homeOrganisationId: organisationId, role, name: 'T', ...over };
};

interface Call {
  route: Route;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  contentType?: string | null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call({ route, method, params = {}, body, rawBody, contentType = 'application/json' }: Call): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  const init: RequestInit = { method, headers };
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const response = await route[method]!(new Request('http://bb.test/api/scheduling/x', init), { params: Promise.resolve(params) });
  const text = await response.text();
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const classes = { name: 'Junior coaching', presetKey: 'classes_coaching' };
async function newSchedule(over: Record<string, unknown> = classes) {
  const r = await call({ route: schedulesRoute, method: 'POST', body: over });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.schedule as { id: string; updatedAt: string; presetKey: string };
}
async function newOffering(scheduleId: string, over: Record<string, unknown> = { name: 'Tuesday juniors', durationMinutes: 60, capacity: 8 }) {
  const r = await call({ route: scheduleOfferings, method: 'POST', params: { scheduleId }, body: over });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.offering as { id: string; updatedAt: string; price: { currency: string } };
}
async function newResource(over: Record<string, unknown> = { kind: 'court', name: 'Court 1', capacity: 4 }) {
  const r = await call({ route: resourcesRoute, method: 'POST', body: over });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.resource as { id: string; updatedAt: string };
}
const auditRows = (org: string) => q<{ action: string; resource_type: string; resource_id: string; after_state: { summary: Record<string, unknown> } }>("SELECT action, resource_type, resource_id, after_state FROM audit_logs WHERE organisation_id = $1 ORDER BY created_at, id", [org]);

suite('Scheduling 2B.2b configuration API on real Postgres', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 30 });
    pool.on('error', () => undefined);
  }, 60_000);
  afterAll(async () => { await pool?.end(); });

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_settings, audit_logs, zz_committed CASCADE');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    for (const [id, tz] of [['org-a', 'Australia/Perth'], ['org-b', null], ['org-d', 'Australia/Perth']] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $4, $5)', [`user-${id}`, id, `${id}@example.test`, id, 'manager']);
    }
    for (const [id, cur] of [['org-a', 'AUD'], ['org-b', 'NZD'], ['org-d', 'AUD']] as const) await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, cur]);
    for (const id of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [id]);
    as('manager', 'org-a');
  });

  // ─── access: the central guard in front of every route ───────────────────────────────────────────────────────

  describe('access', () => {
    const everyOperation = (ids: { scheduleId: string; offeringId: string; resourceId: string }): Array<[string, Call, 'view' | 'manage']> => [
      ['list schedules', { route: schedulesRoute, method: 'GET' }, 'view'],
      ['create schedule', { route: schedulesRoute, method: 'POST', body: classes }, 'manage'],
      ['get schedule', { route: scheduleRoute, method: 'GET', params: ids }, 'view'],
      ['edit schedule', { route: scheduleRoute, method: 'PATCH', params: ids, body: { name: 'x' } }, 'manage'],
      ['archive schedule', { route: scheduleArchive, method: 'POST', params: ids }, 'manage'],
      ['list offerings', { route: scheduleOfferings, method: 'GET', params: ids }, 'view'],
      ['create offering', { route: scheduleOfferings, method: 'POST', params: ids, body: { name: 'x' } }, 'manage'],
      ['get offering', { route: offeringRoute, method: 'GET', params: ids }, 'view'],
      ['edit offering', { route: offeringRoute, method: 'PATCH', params: ids, body: { name: 'x' } }, 'manage'],
      ['archive offering', { route: offeringArchive, method: 'POST', params: ids }, 'manage'],
      ['list assigned resources', { route: offeringResources, method: 'GET', params: ids }, 'view'],
      ['assign resource', { route: offeringResources, method: 'POST', params: ids, body: { resourceId: ids.resourceId } }, 'manage'],
      ['unlink resource', { route: offeringResource, method: 'DELETE', params: ids }, 'manage'],
      ['list resources', { route: resourcesRoute, method: 'GET' }, 'view'],
      ['create resource', { route: resourcesRoute, method: 'POST', body: { kind: 'court', name: 'x', capacity: 1 } }, 'manage'],
      ['get resource', { route: resourceRoute, method: 'GET', params: ids }, 'view'],
      ['edit resource', { route: resourceRoute, method: 'PATCH', params: ids, body: { name: 'x' } }, 'manage'],
      ['deactivate resource', { route: resourceDeactivate, method: 'POST', params: ids }, 'manage'],
      ['reactivate resource', { route: resourceReactivate, method: 'POST', params: ids }, 'manage'],
    ];
    const ids = { scheduleId: 'no-such', offeringId: 'no-such', resourceId: 'no-such' };

    it('401 without a session on every operation, and nothing is written', async () => {
      state.session = null;
      const before = await snapshot('org-a');
      for (const [name, c] of everyOperation(ids)) expect((await call(c)).status, name).toBe(401);
      expect(await snapshot('org-a')).toEqual(before);
    });

    it('403 for an organisation that is not entitled (even a manager), on every operation', async () => {
      as('manager', 'org-d');
      for (const [name, c] of everyOperation(ids)) expect((await call(c)).status, name).toBe(403);
      expect(await q("SELECT 1 FROM scheduling_schedules WHERE organisation_id = 'org-d'")).toEqual([]);
    });

    it('403 for analyst and unknown roles on every operation', async () => {
      for (const role of ['analyst', 'guest', '']) {
        as(role, 'org-a');
        for (const [name, c] of everyOperation(ids)) expect((await call(c)).status, `${role} ${name}`).toBe(403);
      }
    });

    it('a viewer may read but not write: every manage operation is 403 and writes nothing', async () => {
      const s = await newSchedule();
      const o = await newOffering(s.id);
      const r = await newResource();
      const real = { scheduleId: s.id, offeringId: o.id, resourceId: r.id };
      as('viewer', 'org-a');
      const before = await snapshot('org-a');
      for (const [name, c, need] of everyOperation(real)) {
        const res = await call(c);
        expect(res.status, `viewer ${name}`).toBe(need === 'view' ? 200 : 403);
      }
      expect(await snapshot('org-a')).toEqual(before);
    });
  });

  // ─── schedules ───────────────────────────────────────────────────────────────────────────────────────────────

  describe('schedules', () => {
    it('creates a schedule for each initial preset, with the preset defaults, and never a public slug', async () => {
      for (const presetKey of ['classes_coaching', 'appointments', 'resource_hire']) {
        const s = await newSchedule({ name: `S ${presetKey}`, presetKey });
        const got = await call({ route: scheduleRoute, method: 'GET', params: { scheduleId: s.id } });
        expect(got.json.schedule).toMatchObject({ presetKey, publicSlug: null, archivedAt: null, timezone: null });
        expect(got.json.schedule.organisationId).toBeUndefined();
        expect(got.json.schedule.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      }
      expect((await call({ route: schedulesRoute, method: 'GET' })).json.schedules).toHaveLength(3);
    });

    it('preset-aware: restaurant, accommodation and events are supported by the architecture but not configurable here', async () => {
      for (const presetKey of ['restaurant_tables', 'accommodation', 'event_capacity', 'nonsense']) {
        const r = await call({ route: schedulesRoute, method: 'POST', body: { name: 'X', presetKey } });
        expect(r.status, presetKey).toBe(400);
        expect(r.json.problems.join()).toMatch(/presetKey must be one of/);
      }
      expect(await q('SELECT 1 FROM scheduling_schedules')).toEqual([]);
    });

    it('refuses malformed bodies with a plain 400/413/415 and writes nothing', async () => {
      const cases: Array<[Call, number]> = [
        [{ route: schedulesRoute, method: 'POST', rawBody: '{nope' }, 400],
        [{ route: schedulesRoute, method: 'POST', rawBody: '[]' }, 400],
        [{ route: schedulesRoute, method: 'POST', body: { presetKey: 'classes_coaching' } }, 400],
        [{ route: schedulesRoute, method: 'POST', body: { name: '  ', presetKey: 'classes_coaching' } }, 400],
        [{ route: schedulesRoute, method: 'POST', body: { ...classes, publicSlug: 'book-me' } }, 400],
        [{ route: schedulesRoute, method: 'POST', body: { ...classes, organisationId: 'org-b' } }, 400],
        [{ route: schedulesRoute, method: 'POST', body: { ...classes, timezone: 'Mars/Olympus' } }, 400],
        [{ route: schedulesRoute, method: 'POST', body: classes, contentType: 'text/plain' }, 415],
        [{ route: schedulesRoute, method: 'POST', rawBody: JSON.stringify({ ...classes, notes: 'x'.repeat(40_000) }) }, 413],
      ];
      for (const [c, status] of cases) expect((await call(c)).status, JSON.stringify(c.body ?? c.rawBody?.slice(0, 30))).toBe(status);
      expect(await q('SELECT 1 FROM scheduling_schedules')).toEqual([]);
    });

    it('edit needs the version token; a stale token is HTTP 409 STALE_WRITE and writes nothing', async () => {
      const s = await newSchedule();
      const edited = await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: s.updatedAt, name: 'Renamed' } });
      expect(edited.status).toBe(200);
      expect(edited.json.schedule.name).toBe('Renamed');
      expect(edited.json.schedule.updatedAt).not.toBe(s.updatedAt);

      const before = await snapshot('org-a');
      const stale = await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: s.updatedAt, name: 'Lost update' } });
      expect(stale.status).toBe(409);
      expect(stale.json.code).toBe('STALE_WRITE');
      expect(await snapshot('org-a')).toEqual(before);

      expect((await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { name: 'No token' } })).status).toBe(400);
      expect((await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: 'yesterday', name: 'x' } })).status).toBe(400);
      expect((await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: edited.json.schedule.updatedAt } })).status).toBe(400); // nothing to change
    });

    it('12 simultaneous edits from one read: exactly one wins, eleven are 409 STALE_WRITE, the row holds the winner', async () => {
      const s = await newSchedule();
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: s.updatedAt, name: `Editor ${i}` } })));
      const winners = results.filter(r => r.status === 200);
      expect(winners).toHaveLength(1);
      expect(results.filter(r => r.status === 409 && r.json.code === 'STALE_WRITE')).toHaveLength(11);
      expect((await q<{ name: string }>('SELECT name FROM scheduling_schedules'))[0].name).toBe(winners[0].json.schedule.name);
      expect((await auditRows('org-a')).filter(a => a.action === 'scheduling.schedule.updated')).toHaveLength(1); // only the success is audited
    });

    it('the preset is locked once an offering exists (409 PRESET_LOCKED), and changeable while empty', async () => {
      const s = await newSchedule();
      const switched = await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: s.updatedAt, presetKey: 'appointments' } });
      expect(switched.status).toBe(200);
      expect(switched.json.schedule.presetKey).toBe('appointments');
      await newOffering(s.id, { name: 'Check-up', durationMinutes: 30 });
      const fresh = (await call({ route: scheduleRoute, method: 'GET', params: { scheduleId: s.id } })).json.schedule;
      const locked = await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: fresh.updatedAt, presetKey: 'resource_hire' } });
      expect(locked.status).toBe(409);
      expect(locked.json.code).toBe('PRESET_LOCKED');
      expect((await q<{ preset_key: string }>('SELECT preset_key FROM scheduling_schedules'))[0].preset_key).toBe('appointments');
    });

    it('archiving is one-way: 200, then 409 ARCHIVED for a second archive, an edit, and a new offering', async () => {
      const s = await newSchedule();
      expect((await call({ route: scheduleArchive, method: 'POST', params: { scheduleId: s.id } })).json).toEqual({ archived: true });
      expect((await call({ route: scheduleArchive, method: 'POST', params: { scheduleId: s.id } })).json.code).toBe('ARCHIVED');
      const fresh = (await call({ route: scheduleRoute, method: 'GET', params: { scheduleId: s.id } })).json.schedule;
      expect(fresh.archivedAt).not.toBeNull();
      expect((await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: fresh.updatedAt, name: 'x' } })).json.code).toBe('ARCHIVED');
      expect((await call({ route: scheduleOfferings, method: 'POST', params: { scheduleId: s.id }, body: { name: 'x', durationMinutes: 60, capacity: 4 } })).json.code).toBe('ARCHIVED');
    });
  });

  // ─── offerings ───────────────────────────────────────────────────────────────────────────────────────────────

  describe('offerings', () => {
    it('create uses the organisation currency and the schedule preset; archive is one-way and leaves reservations alone', async () => {
      const s = await newSchedule();
      const o = await newOffering(s.id, { name: 'Tuesday juniors', durationMinutes: 60, capacity: 8, priceCents: 2500, startTime: '16:00', recurrence: { kind: 'weekly', dayOfWeek: 2, startDate: null, end: { mode: 'ongoing' } } });
      expect(o.price).toEqual({ amountCents: 2500, currency: 'AUD' });
      as('manager', 'org-b');
      const sb = await newSchedule({ name: 'NZ', presetKey: 'classes_coaching' });
      expect((await newOffering(sb.id)).price.currency).toBe('NZD');
      as('manager', 'org-a');
      expect((await call({ route: offeringArchive, method: 'POST', params: { offeringId: o.id } })).json).toEqual({ archived: true });
      expect((await call({ route: offeringArchive, method: 'POST', params: { offeringId: o.id } })).json.code).toBe('ARCHIVED');
      const fresh = (await call({ route: offeringRoute, method: 'GET', params: { offeringId: o.id } })).json.offering;
      expect((await call({ route: offeringRoute, method: 'PATCH', params: { offeringId: o.id }, body: { expectedUpdatedAt: fresh.updatedAt, name: 'x' } })).json.code).toBe('ARCHIVED');
    });

    it('preset-aware validation on create: classes need capacity and duration; appointments and hire take capacity from the resource', async () => {
      const classesSchedule = await newSchedule();
      const post = (scheduleId: string, body: unknown) => call({ route: scheduleOfferings, method: 'POST', params: { scheduleId }, body });
      expect((await post(classesSchedule.id, { name: 'No capacity', durationMinutes: 60 })).json.problems.join()).toMatch(/need a capacity/);
      expect((await post(classesSchedule.id, { name: 'No duration', capacity: 8 })).json.problems.join()).toMatch(/need a duration/);
      expect((await post(classesSchedule.id, { name: 'Weekly, no time', durationMinutes: 60, capacity: 8, recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: null, end: { mode: 'ongoing' } } })).json.problems.join()).toMatch(/needs a startTime/);
      const appts = await newSchedule({ name: 'Clinic', presetKey: 'appointments' });
      expect((await post(appts.id, { name: 'Consult', durationMinutes: 30, capacity: 4 })).json.problems.join()).toMatch(/capacity must be empty/);
      expect((await post(appts.id, { name: 'Consult' })).json.problems.join()).toMatch(/need a duration/);
      expect((await post(appts.id, { name: 'Consult', durationMinutes: 30, currency: 'USD' })).json.problems.join()).toMatch(/currency is not a field/);
      expect((await post(appts.id, { name: 'Consult', durationMinutes: 30, scheduleId: classesSchedule.id })).json.problems.join()).toMatch(/scheduleId is not a field/);
      const weekly = (end: unknown) => ({ name: 'Series', durationMinutes: 30, startTime: '09:00', recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2035-06-04', end } });
      expect((await post(appts.id, weekly({ mode: 'ongoing' }))).json.problems.join()).toMatch(/does not allow the ongoing end mode/);
      expect((await post(appts.id, weekly({ mode: 'after_occurrences', count: 6 }))).status).toBe(201);
      expect(await q("SELECT 1 FROM scheduling_offerings WHERE name IN ('No capacity','No duration','Weekly, no time')")).toEqual([]);
    });

    it('edit applies the preset rules to the RESULT, and a stale token is 409', async () => {
      const appts = await newSchedule({ name: 'Clinic', presetKey: 'appointments' });
      const o = await newOffering(appts.id, { name: 'Consult', durationMinutes: 30 });
      const patch = (body: unknown) => call({ route: offeringRoute, method: 'PATCH', params: { offeringId: o.id }, body });
      expect((await patch({ expectedUpdatedAt: o.updatedAt, capacity: 5 })).json.problems.join()).toMatch(/capacity must be empty/);
      expect((await patch({ expectedUpdatedAt: o.updatedAt, durationMinutes: null })).json.problems.join()).toMatch(/need a duration/);
      expect((await patch({ expectedUpdatedAt: o.updatedAt, currency: 'USD' })).status).toBe(400);
      const ok = await patch({ expectedUpdatedAt: o.updatedAt, durationMinutes: 45, priceCents: 9000 });
      expect(ok.status).toBe(200);
      expect(ok.json.offering).toMatchObject({ durationMinutes: 45, price: { amountCents: 9000, currency: 'AUD' } });
      const stale = await patch({ expectedUpdatedAt: o.updatedAt, name: 'Late' });
      expect(stale.status).toBe(409);
      expect(stale.json.code).toBe('STALE_WRITE');
      expect((await q<{ name: string }>('SELECT name FROM scheduling_offerings'))[0].name).toBe('Consult');
    });
  });

  // ─── resources and assignment ────────────────────────────────────────────────────────────────────────────────

  describe('resources', () => {
    it('create, edit, deactivate and reactivate; `active` is not an ordinary edit', async () => {
      const r = await newResource();
      const edited = await call({ route: resourceRoute, method: 'PATCH', params: { resourceId: r.id }, body: { expectedUpdatedAt: r.updatedAt, name: 'Centre court', capacity: 6 } });
      expect(edited.status).toBe(200);
      expect(edited.json.resource).toMatchObject({ name: 'Centre court', capacity: 6, active: true });
      expect((await call({ route: resourceRoute, method: 'PATCH', params: { resourceId: r.id }, body: { expectedUpdatedAt: edited.json.resource.updatedAt, active: false } })).status).toBe(400);
      const off = await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: r.id }, body: { expectedUpdatedAt: edited.json.resource.updatedAt } });
      expect(off.status).toBe(200);
      expect(off.json.resource.active).toBe(false);
      const on = await call({ route: resourceReactivate, method: 'POST', params: { resourceId: r.id }, body: { expectedUpdatedAt: off.json.resource.updatedAt } });
      expect(on.json.resource.active).toBe(true);
      const stale = await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: r.id }, body: { expectedUpdatedAt: off.json.resource.updatedAt } });
      expect(stale.status).toBe(409);
      expect(stale.json.code).toBe('STALE_WRITE');
    });

    it('preset-independent validation of a new resource', async () => {
      const post = (body: unknown) => call({ route: resourcesRoute, method: 'POST', body });
      expect((await post({ name: 'x', capacity: 1 })).json.problems.join()).toMatch(/kind is required/);
      expect((await post({ kind: 'spaceship', name: 'x', capacity: 1 })).json.problems.join()).toMatch(/unknown resource kind/);
      expect((await post({ kind: 'court', name: 'x', capacity: 0 })).status).toBe(400);
      expect((await post({ kind: 'court', name: 'x', capacity: 2, minParty: 3 })).json.problems.join()).toMatch(/minParty/);
      expect((await post({ kind: 'court', name: 'x', capacity: 2, active: false })).status).toBe(400);
      expect(await q('SELECT 1 FROM scheduling_resources')).toEqual([]);
    });

    it('assignment: kind and active state are checked against the offering preset; re-assigning is idempotent', async () => {
      const appts = await newSchedule({ name: 'Clinic', presetKey: 'appointments' });
      const o = await newOffering(appts.id, { name: 'Consult', durationMinutes: 30 });
      const court = await newResource({ kind: 'court', name: 'Court', capacity: 2 });
      const dr = await newResource({ kind: 'practitioner', name: 'Dr A', capacity: 1 });
      const link = (resourceId: string) => call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId } });

      const wrongKind = await link(court.id);
      expect(wrongKind.status).toBe(409);
      expect(wrongKind.json.code).toBe('KIND_NOT_ACCEPTED');
      expect(wrongKind.json.accepted).toEqual(['practitioner', 'room', 'virtual']);

      const first = await link(dr.id);
      expect(first.status).toBe(201);
      expect(first.json).toEqual({ linked: true, changed: true });
      const again = await link(dr.id);
      expect(again.status).toBe(200);
      expect(again.json).toEqual({ linked: true, changed: false });
      expect((await auditRows('org-a')).filter(a => a.action === 'scheduling.resource.linked')).toHaveLength(1);

      const listed = await call({ route: offeringResources, method: 'GET', params: { offeringId: o.id } });
      expect(listed.json.resources.map((r: { id: string }) => r.id)).toEqual([dr.id]);

      const inactive = await newResource({ kind: 'practitioner', name: 'Dr B', capacity: 1 });
      await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: inactive.id }, body: { expectedUpdatedAt: inactive.updatedAt } });
      expect((await link(inactive.id)).json.code).toBe('RESOURCE_INACTIVE');
      expect((await link('no-such-resource')).status).toBe(404);
      expect((await call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: {} })).status).toBe(400);
    });

    it('a live reservation blocks deactivation, a kind change, and unlinking; history is never deleted', async () => {
      const hire = await newSchedule({ name: 'Hire', presetKey: 'resource_hire' });
      const o = await newOffering(hire.id, { name: 'Court hire', durationMinutes: 60 });
      const court = await newResource({ kind: 'court', name: 'Court', capacity: 4 });
      expect((await call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId: court.id } })).status).toBe(201);

      // a real reservation through the shared repository (booking is NOT exposed by this API)
      const persistence = createPostgresScheduling({ sql: fromPgLike(pool as never), clock: { now: () => new Date('2026-11-01T00:00:00Z'), today: () => '2026-11-01' } });
      const booked = await persistence.reservations.create(staffTenantContext({ organisationId: 'org-a', userId: 'user-org-a', role: 'manager', timezone: 'Australia/Perth' }), slotBooking(court.id, '2035-06-12', '10:00', 60, { schedule: hire.id, offering: o.id }));
      expect(booked.ok).toBe(true);
      const counts = async () => [await q('SELECT count(*) FROM scheduling_reservations'), await q('SELECT count(*) FROM scheduling_resource_holds'), await q('SELECT count(*) FROM scheduling_occurrences')];
      const before = await counts();

      const token = (await call({ route: resourceRoute, method: 'GET', params: { resourceId: court.id } })).json.resource.updatedAt;
      const deact = await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: court.id }, body: { expectedUpdatedAt: token } });
      expect(deact.status).toBe(409);
      expect(deact.json.code).toBe('RESOURCE_IN_USE');
      const kind = await call({ route: resourceRoute, method: 'PATCH', params: { resourceId: court.id }, body: { expectedUpdatedAt: token, kind: 'space' } });
      expect(kind.json.code).toBe('RESOURCE_IN_USE');
      const unlink = await call({ route: offeringResource, method: 'DELETE', params: { offeringId: o.id, resourceId: court.id } });
      expect(unlink.status).toBe(409);
      expect(unlink.json.code).toBe('ALLOCATION_IN_USE');

      expect(await counts()).toEqual(before);
      expect((await call({ route: resourceRoute, method: 'GET', params: { resourceId: court.id } })).json.resource.active).toBe(true);
      expect((await call({ route: offeringResources, method: 'GET', params: { offeringId: o.id } })).json.resources).toHaveLength(1);
    });

    it('unlinking an unlinked resource is removed=false (idempotent); the resource and offering stay', async () => {
      const s = await newSchedule();
      const o = await newOffering(s.id);
      const r = await newResource();
      expect((await call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId: r.id } })).status).toBe(201);
      expect((await call({ route: offeringResource, method: 'DELETE', params: { offeringId: o.id, resourceId: r.id } })).json).toEqual({ removed: true });
      expect((await call({ route: offeringResource, method: 'DELETE', params: { offeringId: o.id, resourceId: r.id } })).json).toEqual({ removed: false });
      expect((await q('SELECT 1 FROM scheduling_resources'))).toHaveLength(1);
      expect((await q('SELECT 1 FROM scheduling_offerings'))).toHaveLength(1);
      expect((await auditRows('org-a')).filter(a => a.action === 'scheduling.resource.unlinked')).toHaveLength(1);
    });
  });

  // ─── tenant isolation ────────────────────────────────────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it("another organisation's manager gets 404 for every id of this organisation, on every operation, and nothing changes in either", async () => {
      const s = await newSchedule();
      const o = await newOffering(s.id);
      const r = await newResource();
      await call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId: r.id } });
      as('manager', 'org-b');
      const sb = await newSchedule({ name: 'Theirs', presetKey: 'classes_coaching' });
      const ob = await newOffering(sb.id);
      const rb = await newResource({ kind: 'court', name: 'Their court', capacity: 2 });
      const beforeA = await snapshot('org-a');
      const beforeB = await snapshot('org-b');

      const t = { scheduleId: s.id, offeringId: o.id, resourceId: r.id };
      const attempts: Array<[string, Call]> = [
        ['get schedule', { route: scheduleRoute, method: 'GET', params: t }],
        ['edit schedule', { route: scheduleRoute, method: 'PATCH', params: t, body: { expectedUpdatedAt: s.updatedAt, name: 'Hijack' } }],
        ['archive schedule', { route: scheduleArchive, method: 'POST', params: t }],
        ['list offerings', { route: scheduleOfferings, method: 'GET', params: t }],
        ['create offering under their schedule', { route: scheduleOfferings, method: 'POST', params: t, body: { name: 'Sneak', durationMinutes: 60, capacity: 4 } }],
        ['get offering', { route: offeringRoute, method: 'GET', params: t }],
        ['edit offering', { route: offeringRoute, method: 'PATCH', params: t, body: { expectedUpdatedAt: o.updatedAt, name: 'Hijack' } }],
        ['archive offering', { route: offeringArchive, method: 'POST', params: t }],
        ['list assigned', { route: offeringResources, method: 'GET', params: t }],
        ['assign their resource to our offering', { route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId: rb.id } }],
        ['assign our resource to their offering', { route: offeringResources, method: 'POST', params: { offeringId: ob.id }, body: { resourceId: r.id } }],
        ['unlink', { route: offeringResource, method: 'DELETE', params: t }],
        ['get resource', { route: resourceRoute, method: 'GET', params: t }],
        ['edit resource', { route: resourceRoute, method: 'PATCH', params: t, body: { expectedUpdatedAt: r.updatedAt, name: 'Hijack' } }],
        ['deactivate resource', { route: resourceDeactivate, method: 'POST', params: t, body: { expectedUpdatedAt: r.updatedAt } }],
        ['reactivate resource', { route: resourceReactivate, method: 'POST', params: t, body: { expectedUpdatedAt: r.updatedAt } }],
      ];
      for (const [name, c] of attempts) expect((await call(c)).status, name).toBe(404);

      expect(await snapshot('org-a')).toEqual(beforeA);
      expect(await snapshot('org-b')).toEqual(beforeB);
      expect((await call({ route: schedulesRoute, method: 'GET' })).json.schedules.map((x: { id: string }) => x.id)).toEqual([sb.id]);
      expect((await call({ route: resourcesRoute, method: 'GET' })).json.resources.map((x: { id: string }) => x.id)).toEqual([rb.id]);
    });

    it('a named organisation in the body, query string or headers is never used', async () => {
      const s = await newSchedule();
      as('manager', 'org-b');
      const withHeader = await schedulesRoute.GET!(new Request('http://bb.test/api/scheduling/schedules?organisation_id=org-a&organisationId=org-a', { headers: { 'x-organisation-id': 'org-a' } }), { params: Promise.resolve({}) });
      expect((await withHeader.json()).schedules).toEqual([]);
      expect((await call({ route: schedulesRoute, method: 'POST', body: { ...classes, organisation_id: 'org-a' } })).status).toBe(400);
      expect(s.id).toBeTruthy();
    });

    it('malformed or hostile ids are an ordinary 404 and reach no query', async () => {
      for (const id of ['../x', "x'; DROP TABLE scheduling_schedules;--", '', ' ', 'a'.repeat(300), '%00']) {
        expect((await call({ route: scheduleRoute, method: 'GET', params: { scheduleId: id } })).status, id).toBe(404);
        expect((await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: id }, body: { expectedUpdatedAt: '2026-11-01T00:00:00.000000Z' } })).status, id).toBe(404);
      }
      expect((await q('SELECT to_regclass(\'scheduling_schedules\') AS t'))[0].t).not.toBeNull();
    });

    it('while a super_admin impersonates, the impersonated organisation is the one read and written', async () => {
      as('super_admin', 'org-b', { homeOrganisationId: 'org-a' });
      const s = await newSchedule({ name: 'Imp', presetKey: 'classes_coaching' });
      expect((await q<{ organisation_id: string }>('SELECT organisation_id FROM scheduling_schedules WHERE id = $1', [s.id]))[0].organisation_id).toBe('org-b');
      expect((await auditRows('org-b')).map(a => a.action)).toEqual(['scheduling.schedule.created']);
      expect(await auditRows('org-a')).toEqual([]);
    });
  });

  // ─── audit ───────────────────────────────────────────────────────────────────────────────────────────────────

  describe('audit', () => {
    it('every successful mutation writes exactly one entry with the right action; refusals and reads write none', async () => {
      const s = await newSchedule();
      const o = await newOffering(s.id);
      const r = await newResource();
      await call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId: r.id } });
      await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: (await call({ route: scheduleRoute, method: 'GET', params: { scheduleId: s.id } })).json.schedule.updatedAt, name: 'Renamed' } });
      const fo = (await call({ route: offeringRoute, method: 'GET', params: { offeringId: o.id } })).json.offering;
      await call({ route: offeringRoute, method: 'PATCH', params: { offeringId: o.id }, body: { expectedUpdatedAt: fo.updatedAt, capacity: 12 } });
      const fr = (await call({ route: resourceRoute, method: 'GET', params: { resourceId: r.id } })).json.resource;
      const upd = await call({ route: resourceRoute, method: 'PATCH', params: { resourceId: r.id }, body: { expectedUpdatedAt: fr.updatedAt, name: 'Court 1B' } });
      const off = await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: r.id }, body: { expectedUpdatedAt: upd.json.resource.updatedAt } });
      await call({ route: resourceReactivate, method: 'POST', params: { resourceId: r.id }, body: { expectedUpdatedAt: off.json.resource.updatedAt } });
      await call({ route: offeringResource, method: 'DELETE', params: { offeringId: o.id, resourceId: r.id } });
      await call({ route: offeringArchive, method: 'POST', params: { offeringId: o.id } });
      await call({ route: scheduleArchive, method: 'POST', params: { scheduleId: s.id } });

      expect((await auditRows('org-a')).map(a => a.action)).toEqual([
        'scheduling.schedule.created',
        'scheduling.offering.created',
        'scheduling.resource.created',
        'scheduling.resource.linked',
        'scheduling.schedule.updated',
        'scheduling.offering.updated',
        'scheduling.resource.updated',
        'scheduling.resource.deactivated',
        'scheduling.resource.reactivated',
        'scheduling.resource.unlinked',
        'scheduling.offering.archived',
        'scheduling.schedule.archived',
      ]);

      const count = (await auditRows('org-a')).length;
      // refusals and reads: stale write, archived, invalid, not found, plain reads
      await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: s.updatedAt, name: 'stale' } });
      await call({ route: scheduleArchive, method: 'POST', params: { scheduleId: s.id } });
      await call({ route: schedulesRoute, method: 'POST', body: { name: '' } });
      await call({ route: resourceRoute, method: 'GET', params: { resourceId: 'no-such' } });
      await call({ route: schedulesRoute, method: 'GET' });
      await call({ route: resourcesRoute, method: 'GET' });
      expect((await auditRows('org-a')).length).toBe(count);
    });

    it('records the actor and the organisation from the session, ids and field names only, never a name or value', async () => {
      const s = await newSchedule({ name: 'Secret name pat@example.test', presetKey: 'classes_coaching' });
      await call({ route: scheduleRoute, method: 'PATCH', params: { scheduleId: s.id }, body: { expectedUpdatedAt: s.updatedAt, name: 'Another 0400 111 222' } });
      const rows = await q<{ organisation_id: string; user_id: string; resource_type: string; after_state: unknown }>('SELECT organisation_id, user_id, resource_type, after_state FROM audit_logs ORDER BY created_at');
      expect(rows.map(r => [r.organisation_id, r.user_id, r.resource_type])).toEqual([['org-a', 'user-org-a', 'scheduling.schedule'], ['org-a', 'user-org-a', 'scheduling.schedule']]);
      const text = JSON.stringify(rows.map(r => r.after_state));
      expect(text).not.toMatch(/Secret|pat@example|0400|Another/);
      expect(rows[1].after_state).toMatchObject({ summary: { fields: ['name'] } });
    });
  });

  // ─── scope: configuration only ───────────────────────────────────────────────────────────────────────────────

  describe('scope', () => {
    it('the API creates no reservation, occurrence, hold or payment record', async () => {
      const s = await newSchedule({ name: 'Hire', presetKey: 'resource_hire' });
      const o = await newOffering(s.id, { name: 'Court hire', durationMinutes: 60 });
      const r = await newResource();
      await call({ route: offeringResources, method: 'POST', params: { offeringId: o.id }, body: { resourceId: r.id } });
      for (const t of ['scheduling_reservations', 'scheduling_occurrences', 'scheduling_resource_holds', 'scheduling_series']) expect(await q(`SELECT 1 FROM ${t}`), t).toEqual([]);
    });
  });
});
