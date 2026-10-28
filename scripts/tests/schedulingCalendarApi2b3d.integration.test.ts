import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Phase 2B.3d real-Postgres proof of the READ-ONLY availability calendar API (run by scripts/tests/verify-scheduling-phase2b3d.sh against a
// DISPOSABLE database, on PostgreSQL 16 and 17). It reaches only the database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL. Only the
// application's database client and the session are replaced; the capability lookup, the central guard, the runtime, both Postgres repositories and
// every route handler are the REAL code.
//   - ACCESS: 401 without a session, 403 for an organisation that is not entitled and for analyst / unknown roles, 200 for a viewer and a manager
//     (the same body: the calendar is read only for everyone).
//   - INPUT: every bad query parameter is a 400; a missing id or another organisation's id is a 404.
//   - THE CALENDAR: empty state, weekly hours, closures, pinned zones (a Perth resource under an Adelaide offering), holds (reservations and
//     sessions), the Adelaide daylight-saving days, archived and inactive owners.
//   - NO WRITES: a content hash of every Scheduling table, the pinned zones, the organisations and the audit log is identical after any number of calls,
//     and an owner with no hours is never pinned by being looked at.

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
const scheduleOfferings = (await import('@/app/api/scheduling/schedules/[scheduleId]/offerings/route')) as Route;
const offeringArchive = (await import('@/app/api/scheduling/offerings/[offeringId]/archive/route')) as Route;
const offeringResources = (await import('@/app/api/scheduling/offerings/[offeringId]/resources/route')) as Route;
const resourcesRoute = (await import('@/app/api/scheduling/resources/route')) as Route;
const resourceDeactivate = (await import('@/app/api/scheduling/resources/[resourceId]/deactivate/route')) as Route;
const resourceItem = (await import('@/app/api/scheduling/resources/[resourceId]/route')) as Route;
const offeringRules = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-rules/route')) as Route;
const offeringExceptions = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-exceptions/route')) as Route;
const resourceRules = (await import('@/app/api/scheduling/resources/[resourceId]/availability-rules/route')) as Route;
const resourceExceptions = (await import('@/app/api/scheduling/resources/[resourceId]/availability-exceptions/route')) as Route;
const offeringCalendar = (await import('@/app/api/scheduling/offerings/[offeringId]/calendar/route')) as Route;
const resourceCalendar = (await import('@/app/api/scheduling/resources/[resourceId]/calendar/route')) as Route;

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');

const TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules',
  'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences', 'scheduling_settings',
  'organisations', 'organisation_modules', 'audit_logs',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of TABLES) {
    try {
      out.push((await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`))[0].h);
    } catch {
      out.push('absent'); // a table of a migration that is not applied yet
    }
  }
  return out;
};

const as = (role: string, organisationId: string, over: Record<string, unknown> = {}) => {
  state.session = { userId: `user-${organisationId}`, organisationId, homeOrganisationId: organisationId, role, name: 'T', ...over };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function send(route: Route, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', params: Record<string, string> = {}, body?: unknown, query = ''): Promise<{ status: number; json: Json; text: string }> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await route[method]!(new Request(`http://bb.test/api/scheduling/x${query}`, init), { params: Promise.resolve(params) });
  const text = await response.text();
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, json: text ? JSON.parse(text) : null, text };
}
const post = (route: Route, params: Record<string, string>, body: unknown) => send(route, 'POST', params, body);
const offCal = (id: string, query: string) => send(offeringCalendar, 'GET', { offeringId: id }, undefined, query);
const resCal = (id: string, query: string) => send(resourceCalendar, 'GET', { resourceId: id }, undefined, query);

const ids = { offering: '', resource: '', resource2: '', schedule: '' };

async function seedWorld() {
  as('manager', 'org-a');
  const schedule = await post(schedulesRoute, {}, { name: 'Hire', presetKey: 'resource_hire' });
  expect(schedule.status, schedule.text).toBe(201);
  ids.schedule = schedule.json.schedule.id;
  const offering = await post(scheduleOfferings, { scheduleId: ids.schedule }, { name: 'Court hire', durationMinutes: 60 });
  expect(offering.status, offering.text).toBe(201);
  ids.offering = offering.json.offering.id;
  const resource = await post(resourcesRoute, {}, { kind: 'court', name: 'Court 1', capacity: 4 });
  expect(resource.status, resource.text).toBe(201);
  ids.resource = resource.json.resource.id;
  const resource2 = await post(resourcesRoute, {}, { kind: 'court', name: 'Court 2', capacity: 4 });
  ids.resource2 = resource2.json.resource.id;
}
const link = async (resourceId = ids.resource) => expect((await post(offeringResources, { offeringId: ids.offering }, { resourceId })).status).toBeLessThan(300);
const monday = (start: string, end: string) => ({ dayOfWeek: 1, startTime: start, endTime: end });
const holdOnResource = async (resourceId: string, startsAt: string, endsAt: string, id: string) => {
  await q(
    `WITH occ AS (
       INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
       VALUES ($1, 'org-a', $2, $3, ($4::timestamptz AT TIME ZONE 'Australia/Adelaide')::date, ($4::timestamptz AT TIME ZONE 'Australia/Adelaide')::time, 'Australia/Adelaide', $4::timestamptz, $5::timestamptz, 1)
       RETURNING id, organisation_id, resource_id, starts_at, ends_at)
     INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
     SELECT $6, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM occ`,
    [id, ids.offering, resourceId, startsAt, endsAt, `hold-${id}`],
  );
};

suite('Scheduling 2B.3d availability calendar API on real Postgres', () => {
  const reset = async () => {
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_settings, audit_logs, zz_committed CASCADE');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    for (const [id, tz] of [['org-a', 'Australia/Adelaide'], ['org-b', 'Australia/Perth']] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $4, $5)', [`user-${id}`, id, `${id}@example.test`, id, 'manager']);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [id]);
    }
    // org-d exists but is NOT entitled to Scheduling
    await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', ['org-d', 'Org d', 'Australia/Adelaide']);
    await seedWorld();
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 30 });
    pool.on('error', () => undefined);
  }, 60_000);
  afterAll(async () => {
    await pool?.query(sqlFile('097_availability_zones_rollback.sql')).catch(() => undefined);
    await pool?.query(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await pool?.end();
  });
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('before migration 034', () => {
    it('both calendar routes answer 503 AVAILABILITY_NOT_READY and write nothing', async () => {
      await reset();
      await link();
      const before = await hashAll();
      for (const r of [await offCal(ids.offering, '?from=2027-01-11'), await resCal(ids.resource, '?from=2027-01-11')]) {
        expect(r.status, r.text).toBe(503);
        expect(r.json.code).toBe('AVAILABILITY_NOT_READY');
      }
      expect(await hashAll()).toEqual(before);
    });
  });

  describe('after migrations 034, 035 and 036', () => {
    beforeAll(async () => {
      await pool.query(sqlFile('034_availability_integrity.sql'));
      await pool.query(sqlFile('035_availability_partial_closures.sql'));
      await pool.query(sqlFile('036_availability_zones.sql'));
    }, 60_000);
    beforeEach(async () => {
      await reset();
    });

    describe('access', () => {
      it('401 without a session on both routes', async () => {
        state.session = null;
        expect((await offCal(ids.offering, '?from=2027-01-11')).status).toBe(401);
        expect((await resCal(ids.resource, '?from=2027-01-11')).status).toBe(401);
      });

      it('403 for an organisation that is not entitled, and for analyst and unknown roles', async () => {
        as('manager', 'org-d');
        expect((await offCal(ids.offering, '?from=2027-01-11')).status).toBe(403);
        for (const role of ['analyst', 'guest', '']) {
          as(role, 'org-a');
          expect((await offCal(ids.offering, '?from=2027-01-11')).status, role).toBe(403);
          expect((await resCal(ids.resource, '?from=2027-01-11')).status, role).toBe(403);
        }
      });

      it('a viewer and a manager see the same calendar: it is read only for everyone', async () => {
        await link();
        expect((await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'))).status).toBe(201);
        as('manager', 'org-a');
        const manager = await offCal(ids.offering, '?from=2027-01-11&to=2027-01-17');
        as('viewer', 'org-a');
        const viewer = await offCal(ids.offering, '?from=2027-01-11&to=2027-01-17');
        expect(manager.status).toBe(200);
        expect(viewer.status).toBe(200);
        expect(viewer.json).toEqual(manager.json);
        expect((await resCal(ids.resource, '?from=2027-01-11')).status).toBe(200);
      });

      it('only GET exists: every write method is refused by the route itself', async () => {
        for (const route of [offeringCalendar, resourceCalendar]) {
          for (const method of ['POST', 'PATCH', 'DELETE'] as const) expect(route[method], method).toBeUndefined();
        }
      });
    });

    describe('input', () => {
      it.each([
        ['no from', ''],
        ['a bad from', '?from=2027-02-30'],
        ['a bad to', '?from=2027-01-11&to=nope'],
        ['to before from', '?from=2027-01-12&to=2027-01-11'],
        ['a range over 14 days', '?from=2027-01-01&to=2027-01-15'],
        ['an unknown parameter', '?from=2027-01-11&organisationId=org-b'],
        ['from twice', '?from=2027-01-11&from=2027-01-12'],
        ['a bad step', '?from=2027-01-11&step=0'],
        ['a huge step', '?from=2027-01-11&step=5000'],
        ['a non-numeric step', '?from=2027-01-11&step=abc'],
      ])('400 for %s on the offering calendar', async (_name, query) => {
        const r = await offCal(ids.offering, query);
        expect(r.status, r.text).toBe(400);
        expect(r.json.code).toBe('INVALID_INPUT');
        expect(r.json.problems.length).toBeGreaterThan(0);
      });

      it('a step is not a parameter of the resource calendar', async () => {
        expect((await resCal(ids.resource, '?from=2027-01-11&step=30')).status).toBe(400);
      });

      it('exactly 14 days is accepted; to defaults to from', async () => {
        expect((await offCal(ids.offering, '?from=2027-01-01&to=2027-01-14')).json.days).toHaveLength(14);
        expect((await offCal(ids.offering, '?from=2027-01-01')).json.days).toHaveLength(1);
      });

      it('404 for an id that does not exist, and for another organisation’s id (the same answer)', async () => {
        expect((await offCal('no-such', '?from=2027-01-11')).status).toBe(404);
        expect((await resCal('no-such', '?from=2027-01-11')).status).toBe(404);
        as('manager', 'org-b');
        expect((await offCal(ids.offering, '?from=2027-01-11')).status).toBe(404);
        expect((await resCal(ids.resource, '?from=2027-01-11')).status).toBe(404);
      });
    });

    describe('the offering calendar', () => {
      it('empty state: no hours means no availability, the zone is not pinned, and nothing about the organisation is sent', async () => {
        const r = await offCal(ids.offering, '?from=2027-01-11');
        expect(r.status, r.text).toBe(200);
        expect(r.json.zone).toEqual({ value: 'Australia/Adelaide', pinned: false, source: null });
        expect(r.json.timezone).toBe('Australia/Adelaide');
        expect(r.json.lanes).toHaveLength(1);
        expect(r.json.lanes[0]).toMatchObject({ kind: 'offering', state: 'no_hours', hours: [], closed: [], free: [], occupied: [] });
        expect(r.json.slots).toEqual([]);
        expect(r.json.reasons).toEqual(['no_offering_availability']);
        expect(r.json.ok).toBeUndefined();
        expect(r.text).not.toMatch(/org-a|org-b|organisation/i);
      });

      it('weekly hours, a Perth-pinned resource and a held hour: each read in its own zone, slots only where all agree', async () => {
        await link();
        expect((await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'))).status).toBe(201);
        await q("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ('org-a', $1, 'Australia/Perth', 'backfill')", [ids.resource]);
        expect((await post(resourceRules, { resourceId: ids.resource }, monday('09:00', '17:00'))).status).toBe(201);
        await holdOnResource(ids.resource, '2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z', 'occ-1'); // Mon 12:00-13:00 Adelaide
        const r = await offCal(ids.offering, '?from=2027-01-11&to=2027-01-11');
        expect(r.status, r.text).toBe(200);
        expect(r.json.zone).toMatchObject({ value: 'Australia/Adelaide', pinned: true, source: 'first_rule' });
        const [off, court] = r.json.lanes;
        expect(off).toMatchObject({ kind: 'offering', state: 'open', timezone: 'Australia/Adelaide', pinned: true });
        expect(off.hours).toEqual([{ startsAt: '2027-01-10T22:30:00Z', endsAt: '2027-01-11T06:30:00Z' }]);
        expect(court).toMatchObject({ kind: 'resource', id: ids.resource, state: 'open', timezone: 'Australia/Perth', pinned: true });
        expect(court.hours).toEqual([{ startsAt: '2027-01-11T01:00:00Z', endsAt: '2027-01-11T09:00:00Z' }]);
        expect(court.occupied).toEqual([{ startsAt: '2027-01-11T01:30:00Z', endsAt: '2027-01-11T02:30:00Z', kind: 'session' }]);
        expect(court.free).toEqual([{ startsAt: '2027-01-11T01:00:00Z', endsAt: '2027-01-11T01:30:00Z' }, { startsAt: '2027-01-11T02:30:00Z', endsAt: '2027-01-11T06:30:00Z' }]);
        expect(r.json.slots.map((s: { startsAt: string }) => s.startsAt)).toEqual(['2027-01-11T02:30:00Z', '2027-01-11T03:30:00Z', '2027-01-11T04:30:00Z', '2027-01-11T05:30:00Z']);
        expect(r.json.slots.every((s: { resourceId: string }) => s.resourceId === ids.resource)).toBe(true);
        expect(r.text).not.toMatch(/occ-1|hold-occ-1|org-a/);
      });

      it('a second resource with no hours is drawn as unavailable and listed after the first, by name', async () => {
        await link();
        await link(ids.resource2);
        await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'));
        await post(resourceRules, { resourceId: ids.resource }, monday('09:00', '17:00'));
        const r = await offCal(ids.offering, '?from=2027-01-11');
        expect(r.json.lanes.map((l: { name: string; state: string }) => [l.name, l.state])).toEqual([['Court hire', 'open'], ['Court 1', 'open'], ['Court 2', 'no_hours']]);
        expect(r.json.reasons).toContain(`resource_no_availability:${ids.resource2}`);
      });

      it('partial-day and whole-day closures are drawn as closed time', async () => {
        await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'));
        expect((await post(offeringExceptions, { offeringId: ids.offering }, { fromDate: '2027-01-11', toDate: '2027-01-11', kind: 'closed', startTime: '12:00', endTime: '13:00' })).status).toBe(201);
        const partial = await offCal(ids.offering, '?from=2027-01-11');
        expect(partial.json.lanes[0].closed).toEqual([{ startsAt: '2027-01-11T01:30:00Z', endsAt: '2027-01-11T02:30:00Z' }]);
        expect(partial.json.lanes[0].hours).toHaveLength(2);
        expect((await post(offeringExceptions, { offeringId: ids.offering }, { fromDate: '2027-01-18', toDate: '2027-01-18', kind: 'closed' })).status).toBe(201);
        const whole = await offCal(ids.offering, '?from=2027-01-18');
        expect(whole.json.lanes[0]).toMatchObject({ state: 'no_hours', hours: [] });
        expect(whole.json.lanes[0].closed).toHaveLength(1);
        expect(whole.json.slots).toEqual([]);
      });

      it('the Adelaide daylight-saving days: 23 hours when the clocks go forward, 25 when they go back, and the hours keep their wall-clock time', async () => {
        await post(offeringRules, { offeringId: ids.offering }, { dayOfWeek: 0, startTime: '01:00', endTime: '05:00' });
        const spring = await offCal(ids.offering, '?from=2026-10-03&to=2026-10-05');
        expect(spring.json.days.map((d: { minutes: number }) => d.minutes)).toEqual([1440, 1380, 1440]);
        expect(spring.json.lanes[0].hours).toEqual([{ startsAt: '2026-10-03T15:30:00Z', endsAt: '2026-10-03T18:30:00Z' }]); // 3 hours on the short day
        const fall = await offCal(ids.offering, '?from=2027-04-04');
        expect(fall.json.days[0].minutes).toBe(1500);
        expect(fall.json.lanes[0].hours).toEqual([{ startsAt: '2027-04-03T14:30:00Z', endsAt: '2027-04-03T19:30:00Z' }]); // 01:00-05:00 is FIVE hours elapsed on the long day: the repeated hour counts
      });

      it('step changes the grid, still anchored at the window start; the offering’s duration stays the slot length', async () => {
        await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '12:00'));
        const r = await offCal(ids.offering, '?from=2027-01-11&step=30');
        expect(r.json.slot).toEqual({ durationMinutes: 60, stepMinutes: 30 });
        expect(r.json.slots.map((s: { startsAt: string }) => s.startsAt)).toEqual(['2027-01-10T22:30:00Z', '2027-01-10T23:00:00Z', '2027-01-10T23:30:00Z', '2027-01-11T00:00:00Z', '2027-01-11T00:30:00Z']);
      });

      it('an archived offering is drawn as archived with no slots; an inactive resource as inactive', async () => {
        await link();
        await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'));
        await post(resourceRules, { resourceId: ids.resource }, monday('09:00', '17:00'));
        const current = await send(resourceItem, 'GET', { resourceId: ids.resource });
        expect((await send(resourceDeactivate, 'POST', { resourceId: ids.resource }, { expectedUpdatedAt: current.json.resource.updatedAt })).status).toBeLessThan(300);
        const inactive = await offCal(ids.offering, '?from=2027-01-11');
        expect(inactive.json.lanes.find((l: { id: string }) => l.id === ids.resource)).toMatchObject({ state: 'inactive', hours: [], free: [] });
        expect(inactive.json.slots).toEqual([]);
        expect((await send(offeringArchive, 'POST', { offeringId: ids.offering }, {})).status).toBeLessThan(300);
        const archived = await offCal(ids.offering, '?from=2027-01-11');
        expect(archived.json.offering.archived).toBe(true);
        expect(archived.json.lanes[0]).toMatchObject({ state: 'archived', hours: [] });
        expect(archived.json.slots).toEqual([]);
      });
    });

    describe('the resource calendar', () => {
      it('is drawn in the resource’s own zone with its hours, closures and holds, and no slots', async () => {
        await q("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ('org-a', $1, 'Australia/Perth', 'backfill')", [ids.resource]);
        await post(resourceRules, { resourceId: ids.resource }, monday('09:00', '17:00'));
        await post(resourceExceptions, { resourceId: ids.resource }, { fromDate: '2027-01-11', toDate: '2027-01-11', kind: 'closed', startTime: '12:00', endTime: '13:00' });
        await link();
        await holdOnResource(ids.resource, '2027-01-11T02:00:00Z', '2027-01-11T03:00:00Z', 'occ-r'); // 10:00-11:00 Perth
        const r = await resCal(ids.resource, '?from=2027-01-11&to=2027-01-17');
        expect(r.status, r.text).toBe(200);
        expect(r.json.timezone).toBe('Australia/Perth');
        expect(r.json.zone).toMatchObject({ value: 'Australia/Perth', pinned: true });
        expect(r.json.resource).toMatchObject({ id: ids.resource, name: 'Court 1', active: true });
        expect(r.json.days).toHaveLength(7);
        expect(r.json.lanes[0].occupied).toEqual([{ startsAt: '2027-01-11T02:00:00Z', endsAt: '2027-01-11T03:00:00Z', kind: 'session' }]);
        expect(r.json.lanes[0].closed).toEqual([{ startsAt: '2027-01-11T04:00:00Z', endsAt: '2027-01-11T05:00:00Z' }]);
        expect(r.json.slots).toEqual([]);
      });

      it('with no hours it is unavailable and its zone is not pinned', async () => {
        const r = await resCal(ids.resource, '?from=2027-01-11');
        expect(r.json.lanes[0]).toMatchObject({ state: 'no_hours', pinned: false });
        expect(r.json.zone.pinned).toBe(false);
        expect(r.json.reasons).toEqual(['no_resource_availability']);
      });
    });

    describe('tenant isolation', () => {
      it('another organisation’s holds, hours and zones never reach this calendar', async () => {
        await link();
        await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'));
        await post(resourceRules, { resourceId: ids.resource }, monday('09:00', '17:00'));
        await holdOnResource(ids.resource, '2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z', 'occ-iso');
        as('manager', 'org-b');
        const bSchedule = await post(schedulesRoute, {}, { name: 'B hire', presetKey: 'resource_hire' });
        const bOffering = await post(scheduleOfferings, { scheduleId: bSchedule.json.schedule.id }, { name: 'B court hire', durationMinutes: 60 });
        const bCal = await offCal(bOffering.json.offering.id, '?from=2027-01-11');
        expect(bCal.status).toBe(200);
        expect(bCal.json.lanes).toHaveLength(1);
        expect(bCal.json.zone.value).toBe('Australia/Perth');
        expect(bCal.text).not.toContain(ids.resource);
        expect(bCal.text).not.toContain(ids.offering);
      });
    });

    describe('reading writes nothing', () => {
      it('many calendar reads of both routes leave every Scheduling table, the zones, the organisations and the audit log byte-identical', async () => {
        await link();
        await post(offeringRules, { offeringId: ids.offering }, monday('09:00', '17:00'));
        await post(resourceRules, { resourceId: ids.resource }, monday('09:00', '17:00'));
        await holdOnResource(ids.resource, '2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z', 'occ-ro');
        const before = await hashAll();
        for (const role of ['manager', 'viewer']) {
          as(role, 'org-a');
          for (let i = 0; i < 3; i++) {
            expect((await offCal(ids.offering, '?from=2027-01-11&to=2027-01-17')).status).toBe(200);
            expect((await resCal(ids.resource, '?from=2027-01-11&to=2027-01-17')).status).toBe(200);
            expect((await offCal(ids.offering, '?from=2026-10-04&step=15')).status).toBe(200);
          }
        }
        expect(await hashAll()).toEqual(before);
      });

      it('looking at an owner with no hours does not pin its zone, create hours, or audit anything', async () => {
        const before = await hashAll();
        const zones = Number((await q<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_zones'))[0].n);
        await offCal(ids.offering, '?from=2027-01-11');
        await resCal(ids.resource, '?from=2027-01-11');
        expect(Number((await q<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_zones'))[0].n)).toBe(zones);
        expect(await hashAll()).toEqual(before);
        const c = (t: string) => q<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`).then(r => Number(r[0].n));
        expect([await c('scheduling_reservations'), await c('scheduling_resource_holds'), await c('scheduling_occurrences')]).toEqual([0, 0, 0]);
      });
    });
  });
});
