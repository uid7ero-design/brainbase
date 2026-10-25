import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Phase 2B.3c real-Postgres proof of what the availability screens add to the API (run by scripts/tests/verify-scheduling-phase2b3c.sh against
// a DISPOSABLE database, on PostgreSQL 16 and 17). It reaches only the database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL.
// Only the application's database client and the session are replaced; the capability lookup, the central guard, the runtime, both Postgres
// repositories, the audit module and every route handler are the REAL code.
//   - ATOMIC CREATES: `daysOfWeek` (one window on several weekdays) and `overnight` (a window past midnight is two rules) are stored in one
//     statement, all or none, with one audit entry per rule.
//   - PARTIAL-DAY CLOSURES: startTime/endTime on a closure. Before the staged migration 035 they answer 503 PARTIAL_CLOSURES_NOT_READY and
//     write nothing; full-day closures and weekly hours work either way. This file applies 035 itself, exactly as the owner will, and removes it.

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
const resourcesRoute = (await import('@/app/api/scheduling/resources/route')) as Route;
const resourceDeactivate = (await import('@/app/api/scheduling/resources/[resourceId]/deactivate/route')) as Route;
const offeringAvailability = (await import('@/app/api/scheduling/offerings/[offeringId]/availability/route')) as Route;
const offeringRules = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-rules/route')) as Route;
const offeringExceptions = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-exceptions/route')) as Route;
const resourceAvailability = (await import('@/app/api/scheduling/resources/[resourceId]/availability/route')) as Route;
const resourceRules = (await import('@/app/api/scheduling/resources/[resourceId]/availability-rules/route')) as Route;
const resourceExceptions = (await import('@/app/api/scheduling/resources/[resourceId]/availability-exceptions/route')) as Route;
const ruleRoute = (await import('@/app/api/scheduling/availability-rules/[ruleId]/route')) as Route;
const exceptionRoute = (await import('@/app/api/scheduling/availability-exceptions/[exceptionId]/route')) as Route;
const removeOvernightRoute = (await import('@/app/api/scheduling/availability-rules/remove-overnight/route')) as Route;

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const hash = async (table: string, org?: string) =>
  (await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${table} t${org ? ` WHERE t.organisation_id = '${org}'` : ''}`))[0].h;
const AVAILABILITY_TABLES = ['scheduling_availability_rules', 'scheduling_availability_exceptions'];
const OTHER_TABLES = ['scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences'];
const snapshot = async (org: string, tables: string[]) => Promise.all([...tables.map(t => hash(t, org)), hash('audit_logs', org)]);
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');

const as = (role: string, organisationId: string, over: Record<string, unknown> = {}) => {
  state.session = { userId: `user-${organisationId}`, organisationId, homeOrganisationId: organisationId, role, name: 'T', ...over };
};

interface Call {
  route: Route;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: Record<string, string>;
  body?: unknown;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call({ route, method, params = {}, body }: Call): Promise<{ status: number; json: any }> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await route[method]!(new Request('http://bb.test/api/scheduling/x', init), { params: Promise.resolve(params) });
  const text = await response.text();
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function newSchedule() {
  const r = await call({ route: schedulesRoute, method: 'POST', body: { name: 'Hire', presetKey: 'resource_hire' } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.schedule as { id: string };
}
async function newOffering(scheduleId: string) {
  const r = await call({ route: scheduleOfferings, method: 'POST', params: { scheduleId }, body: { name: 'Court hire', durationMinutes: 60 } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.offering as { id: string; updatedAt: string };
}
async function newResource() {
  const r = await call({ route: resourcesRoute, method: 'POST', body: { kind: 'court', name: 'Court 1', capacity: 4 } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.resource as { id: string; updatedAt: string };
}
const availabilityAudit = (org: string) =>
  q<{ action: string; resource_id: string; after_state: { summary: Record<string, unknown> } }>(
    "SELECT action, resource_id, after_state FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'scheduling.availability_%' ORDER BY created_at, id",
    [org],
  );
const countRules = (owner: string) => q<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_rules WHERE resource_id = $1 OR offering_id = $1', [owner]).then(r => Number(r[0].n));
const countClosures = (owner: string) => q<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_exceptions WHERE resource_id = $1 OR offering_id = $1', [owner]).then(r => Number(r[0].n));

type Owner = 'offering' | 'resource';
const OWNERS: Record<Owner, { id: string; rules: Route; exceptions: Route; list: Route; param: string }> = {
  offering: { id: '', rules: offeringRules, exceptions: offeringExceptions, list: offeringAvailability, param: 'offeringId' },
  resource: { id: '', rules: resourceRules, exceptions: resourceExceptions, list: resourceAvailability, param: 'resourceId' },
};
const addRule = (o: Owner, body: unknown, id = OWNERS[o].id) => call({ route: OWNERS[o].rules, method: 'POST', params: { [OWNERS[o].param]: id }, body });
const addClosure = (o: Owner, body: unknown, id = OWNERS[o].id) => call({ route: OWNERS[o].exceptions, method: 'POST', params: { [OWNERS[o].param]: id }, body });
const listFor = (o: Owner, id = OWNERS[o].id) => call({ route: OWNERS[o].list, method: 'GET', params: { [OWNERS[o].param]: id } });
const WEEKDAYS = { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' };

suite('Scheduling 2B.3c availability API on real Postgres', () => {
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
    as('manager', 'org-a');
    const schedule = await newSchedule();
    OWNERS.offering.id = (await newOffering(schedule.id)).id;
    OWNERS.resource.id = (await newResource()).id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 30 });
    pool.on('error', () => undefined);
    await pool.query(sqlFile('034_availability_integrity.sql'));
    await pool.query(sqlFile('096_availability_partial_closures_rollback.sql')); // 034 only, whatever ran before
  }, 60_000);
  afterAll(async () => {
    await q('DELETE FROM scheduling_availability_exceptions');
    await pool?.query(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await pool?.end();
  });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reset();
  });

  // ─── Atomic creates (needs 034 only) ──────────────────────────────────────────────────────────────────────

  describe('atomic rule creation', () => {
    it.each<Owner>(['resource', 'offering'])('daysOfWeek: one window on five weekdays is stored together and answered as { rule, rules } (%s)', async o => {
      const r = await addRule(o, WEEKDAYS);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.rules.map((x: { dayOfWeek: number }) => x.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
      expect(r.json.rule).toEqual(r.json.rules[0]);
      expect(await countRules(OWNERS[o].id)).toBe(5);
      const audit = (await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_rule.created');
      expect(audit).toHaveLength(5);
      expect(audit.every(a => a.after_state.summary.batch_size === 5)).toBe(true);
      expect(new Set(audit.map(a => a.resource_id)).size).toBe(5);
    });

    it('a single dayOfWeek still answers { rule } (and now also { rules }) with no batch_size in its audit entry', async () => {
      const r = await addRule('resource', { dayOfWeek: 2, startTime: '08:00', endTime: '24:00' });
      expect(r.status).toBe(201);
      expect(r.json.rule).toMatchObject({ dayOfWeek: 2, startTime: '08:00', endTime: '24:00' });
      expect(r.json.rules).toHaveLength(1);
      const audit = await availabilityAudit('org-a');
      expect(audit.at(-1)?.after_state.summary).not.toHaveProperty('batch_size');
    });

    it('overnight: 22:00 to 02:00 on Friday is Friday 22:00-24:00 and Saturday 00:00-02:00, written together, with an audit entry for each', async () => {
      const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true, label: 'Late' });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.rules.map((x: { dayOfWeek: number; startTime: string; endTime: string; label: string }) => [x.dayOfWeek, x.startTime, x.endTime, x.label])).toEqual([[5, '22:00', '24:00', 'Late'], [6, '00:00', '02:00', 'Late']]);
      expect(await countRules(OWNERS.resource.id)).toBe(2);
      expect((await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_rule.created')).toHaveLength(2);
    });

    it('overnight on Saturday wraps to Sunday, and validity dates move one day forward with the second half', async () => {
      const r = await addRule('offering', { dayOfWeek: 6, startTime: '23:00', endTime: '01:00', overnight: true, validFrom: '2027-01-01', validTo: '2027-06-30' });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.rules.map((x: { dayOfWeek: number; validFrom: string; validTo: string }) => [x.dayOfWeek, x.validFrom, x.validTo])).toEqual([[0, '2027-01-02', '2027-07-01'], [6, '2027-01-01', '2027-06-30']]);
    });

    it('overnight on several nights at once: five pairs, ten rules, one statement', async () => {
      const r = await addRule('resource', { daysOfWeek: [1, 2, 3, 4, 5], startTime: '22:00', endTime: '06:00', overnight: true });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.rules).toHaveLength(10);
      expect(await countRules(OWNERS.resource.id)).toBe(10);
    });

    it('a pair whose second half would overlap an existing rule stores NEITHER half and audits nothing', async () => {
      const seeded = await addRule('resource', { dayOfWeek: 6, startTime: '00:00', endTime: '01:00' });
      expect(seeded.status).toBe(201);
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
      expect([r.status, r.json.code]).toEqual([409, 'OVERLAP']);
      expect(await countRules(OWNERS.resource.id)).toBe(1); // Friday 22:00-24:00 was NOT left behind
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
    });

    it('a pair whose FIRST half would overlap is refused whole too', async () => {
      await addRule('resource', { dayOfWeek: 5, startTime: '23:00', endTime: '24:00' });
      const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
      expect([r.status, r.json.code]).toEqual([409, 'OVERLAP']);
      expect(await countRules(OWNERS.resource.id)).toBe(1);
    });

    it('a window that crosses midnight WITHOUT the flag is refused, with the hint', async () => {
      const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '02:00' });
      expect(r.status).toBe(400);
      expect(r.json.problems.join(' ')).toMatch(/overnight/);
      expect(await countRules(OWNERS.resource.id)).toBe(0);
    });

    it.each([
      [{ dayOfWeek: 5, startTime: '09:00', endTime: '17:00', overnight: true }, 'ends after it starts'],
      [{ dayOfWeek: 5, startTime: '22:00', endTime: '24:00', overnight: true }, '24:00'],
      [{ dayOfWeek: 5, startTime: '22:00', endTime: '00:00', overnight: true }, '00:00'],
      [{ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: 'yes' }, 'not a boolean'],
      [{ dayOfWeek: 1, daysOfWeek: [1], startTime: '09:00', endTime: '10:00' }, 'both day fields'],
      [{ startTime: '09:00', endTime: '10:00' }, 'no day'],
      [{ daysOfWeek: [], startTime: '09:00', endTime: '10:00' }, 'empty list'],
      [{ daysOfWeek: [1, 1], startTime: '09:00', endTime: '10:00' }, 'duplicate days'],
      [{ daysOfWeek: [1, 2, 3, 4, 5, 6, 0, 1], startTime: '09:00', endTime: '10:00' }, 'too many days'],
      [{ daysOfWeek: [1, 7], startTime: '09:00', endTime: '10:00' }, 'a bad day'],
      [{ daysOfWeek: 'weekdays', startTime: '09:00', endTime: '10:00' }, 'not a list'],
      [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', colour: 'red' }, 'an unknown field'],
    ])('invalid request %# (%s) is a 400 that writes nothing', async body => {
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const r = await addRule('resource', body);
      expect(r.status, JSON.stringify(r.json)).toBe(400);
      expect(r.json.code).toBe('INVALID_INPUT');
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
    });

    it('a batch overlapping itself by a repeated day cannot be sent (daysOfWeek must be distinct), and two overnight pairs on adjacent nights do not collide', async () => {
      const r = await addRule('resource', { daysOfWeek: [5, 6], startTime: '22:00', endTime: '02:00', overnight: true });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.rules.map((x: { dayOfWeek: number; startTime: string }) => `${x.dayOfWeek}@${x.startTime}`)).toEqual(['0@00:00', '5@22:00', '6@00:00', '6@22:00']);
    });

    it('concurrent identical batches over HTTP: exactly one commits, whole', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => addRule('resource', WEEKDAYS)));
      expect(results.filter(r => r.status === 201)).toHaveLength(1);
      expect(results.filter(r => r.status !== 201).every(r => r.status === 409 && r.json.code === 'OVERLAP')).toBe(true);
      expect(await countRules(OWNERS.resource.id)).toBe(5);
      expect((await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_rule.created')).toHaveLength(5);
    });

    it('an archived offering and an inactive resource refuse the whole batch', async () => {
      const off = await call({ route: offeringArchive, method: 'POST', params: { offeringId: OWNERS.offering.id } });
      expect(off.status).toBe(200);
      const a = await addRule('offering', WEEKDAYS);
      expect([a.status, a.json.code]).toEqual([409, 'ARCHIVED']);
      const res = await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: OWNERS.resource.id }, body: { expectedUpdatedAt: (await q<{ u: string }>("SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS u FROM scheduling_resources WHERE id = $1", [OWNERS.resource.id]))[0].u } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const b = await addRule('resource', WEEKDAYS);
      expect([b.status, b.json.code]).toEqual([409, 'RESOURCE_INACTIVE']);
      expect(await q('SELECT 1 FROM scheduling_availability_rules')).toHaveLength(0);
    });

    it('permissions and tenants: a viewer cannot batch (403), another organisation gets 404, and neither writes', async () => {
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      as('viewer', 'org-a');
      expect((await addRule('resource', WEEKDAYS)).status).toBe(403);
      as('manager', 'org-b');
      expect((await addRule('resource', WEEKDAYS)).status).toBe(404);
      as('manager', 'org-a');
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
    });

    it('writes no reservation, hold or occurrence, and changes no other Scheduling row', async () => {
      const before = await snapshot('org-a', OTHER_TABLES);
      await addRule('resource', { daysOfWeek: [5], startTime: '22:00', endTime: '02:00', overnight: true });
      await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02' });
      const after = await snapshot('org-a', OTHER_TABLES);
      expect(after.slice(0, -1)).toEqual(before.slice(0, -1)); // everything but the audit table
    });
  });

  // ─── Partial-day closures before 035 ──────────────────────────────────────────────────────────────────────

  describe('partial-day closures before migration 035', () => {
    it('GET availability says so: capabilities.partialClosures is false, and every closure reads as whole-day', async () => {
      await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-05', reason: 'Easter' });
      const r = await listFor('resource');
      expect(r.status).toBe(200);
      expect(r.json.capabilities).toEqual({ partialClosures: false });
      expect(r.json.exceptions).toHaveLength(1);
      expect(r.json.exceptions[0]).toMatchObject({ startTime: null, endTime: null });
    });

    it('a partial-day closure answers 503 PARTIAL_CLOSURES_NOT_READY, writes nothing and audits nothing; a full-day closure still works', async () => {
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const r = await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00' });
      expect([r.status, r.json.code]).toEqual([503, 'PARTIAL_CLOSURES_NOT_READY']);
      expect(JSON.stringify(r.json)).not.toMatch(/column|relation|start_time|exceptions/);
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
      expect((await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02' })).status).toBe(201);
    });

    it('editing a closure to add a window answers the same 503 and leaves the closure untouched', async () => {
      const made = await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02' });
      const c = made.json.exception;
      const r = await call({ route: exceptionRoute, method: 'PATCH', params: { exceptionId: c.id }, body: { expectedUpdatedAt: c.updatedAt, startTime: '12:00', endTime: '13:00' } });
      expect([r.status, r.json.code]).toEqual([503, 'PARTIAL_CLOSURES_NOT_READY']);
      expect((await listFor('resource')).json.exceptions[0].updatedAt).toBe(c.updatedAt);
    });

    it.each([
      [{ startTime: '12:00' }, 'only a start'],
      [{ endTime: '13:00' }, 'only an end'],
      [{ startTime: '13:00', endTime: '12:00' }, 'backwards'],
      [{ startTime: '12:00', endTime: '12:00' }, 'empty'],
      [{ startTime: '25:00', endTime: '26:00' }, 'not times'],
      [{ startTime: 'noon', endTime: '13:00' }, 'text'],
      [{ startTime: 1200, endTime: 1300 }, 'numbers'],
    ])('a malformed window %# (%s) is a 400, not a 503: it is refused before the database', async window => {
      const r = await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02', ...window });
      expect([r.status, r.json.code]).toEqual([400, 'INVALID_INPUT']);
    });
  });

  // ─── With migration 035 ───────────────────────────────────────────────────────────────────────────────────

  describe('with migration 035 applied', () => {
    beforeAll(async () => {
      await pool.query(sqlFile('035_availability_partial_closures.sql'));
    }, 60_000);
    afterAll(async () => {
      await q('DELETE FROM scheduling_availability_exceptions');
      await pool.query(sqlFile('096_availability_partial_closures_rollback.sql'));
    }, 60_000);

    it.each<Owner>(['resource', 'offering'])('stores a partial-day closure, reports the capability, and audits the times but never the reason (%s)', async o => {
      const r = await addClosure(o, { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:30', reason: 'Staff lunch' });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.exception).toMatchObject({ fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:30', kind: 'closed' });
      const list = await listFor(o);
      expect(list.json.capabilities).toEqual({ partialClosures: true });
      expect(list.json.exceptions[0]).toMatchObject({ startTime: '12:00', endTime: '13:30' });
      const audit = (await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_exception.created');
      expect(audit.at(-1)?.after_state.summary).toMatchObject({ start_time: '12:00', end_time: '13:30', has_reason: true });
      expect(JSON.stringify(audit)).not.toMatch(/Staff lunch/);
    });

    it('a window may end at 24:00; a full-day closure has no window in the response or in its audit entry', async () => {
      const a = await addClosure('resource', { fromDate: '2027-04-03', toDate: '2027-04-03', startTime: '22:00', endTime: '24:00' });
      expect(a.json.exception).toMatchObject({ startTime: '22:00', endTime: '24:00' });
      const b = await addClosure('resource', { fromDate: '2027-04-10', toDate: '2027-04-12' });
      expect(b.json.exception).toMatchObject({ startTime: null, endTime: null });
      expect((await availabilityAudit('org-a')).at(-1)?.after_state.summary).not.toHaveProperty('start_time');
    });

    it('two closures on one date may remove different times; overlapping times, and a whole-day closure over a partial one, are 409 OVERLAP', async () => {
      const day = { fromDate: '2027-04-02', toDate: '2027-04-02' };
      expect((await addClosure('resource', { ...day, startTime: '12:00', endTime: '13:00' })).status).toBe(201);
      expect((await addClosure('resource', { ...day, startTime: '15:00', endTime: '16:00' })).status).toBe(201);
      expect((await addClosure('resource', { ...day, startTime: '13:00', endTime: '14:00' })).status).toBe(201);
      for (const body of [{ ...day, startTime: '12:30', endTime: '12:45' }, { ...day }, { fromDate: '2027-04-01', toDate: '2027-04-03', startTime: '09:00', endTime: '24:00' }]) {
        const r = await addClosure('resource', body);
        expect([r.status, r.json.code], JSON.stringify(body)).toEqual([409, 'OVERLAP']);
      }
      expect(await countClosures(OWNERS.resource.id)).toBe(3);
    });

    it('edits: move the window, clear it (whole day), set one again; a one-sided edit is a 400; a stale edit is a 409', async () => {
      const made = await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00' });
      const c = made.json.exception;
      const patch = (updatedAt: string, body: Record<string, unknown>) => call({ route: exceptionRoute, method: 'PATCH', params: { exceptionId: c.id }, body: { expectedUpdatedAt: updatedAt, ...body } });
      const moved = await patch(c.updatedAt, { startTime: '14:00', endTime: '15:00' });
      expect(moved.status, JSON.stringify(moved.json)).toBe(200);
      expect(moved.json.exception).toMatchObject({ startTime: '14:00', endTime: '15:00' });
      const stale = await patch(c.updatedAt, { startTime: '16:00', endTime: '17:00' });
      expect([stale.status, stale.json.code]).toEqual([409, 'STALE_WRITE']);
      expect((await patch(moved.json.exception.updatedAt, { startTime: '14:00' })).status).toBe(400);
      const cleared = await patch(moved.json.exception.updatedAt, { startTime: null, endTime: null });
      expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
      expect(cleared.json.exception).toMatchObject({ startTime: null, endTime: null });
      const again = await patch(cleared.json.exception.updatedAt, { startTime: '10:00', endTime: '11:00' });
      expect(again.json.exception).toMatchObject({ startTime: '10:00', endTime: '11:00' });
      const audit = (await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_exception.updated');
      expect(audit).toHaveLength(3);
      expect(audit[0].after_state.summary.fields).toEqual(expect.arrayContaining(['startTime', 'endTime']));
    });

    it('an edit that would overlap another closure is a 409 and changes nothing', async () => {
      await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00' });
      const other = (await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '15:00', endTime: '16:00' })).json.exception;
      const r = await call({ route: exceptionRoute, method: 'PATCH', params: { exceptionId: other.id }, body: { expectedUpdatedAt: other.updatedAt, startTime: '12:30', endTime: '13:30' } });
      expect([r.status, r.json.code]).toEqual([409, 'OVERLAP']);
      expect((await listFor('resource')).json.exceptions.find((e: { id: string }) => e.id === other.id).updatedAt).toBe(other.updatedAt);
    });

    it('delete works with the version token, and a viewer or another organisation can do none of it', async () => {
      const made = (await addClosure('resource', { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00' })).json.exception;
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      as('viewer', 'org-a');
      expect((await addClosure('resource', { fromDate: '2027-04-09', toDate: '2027-04-09', startTime: '12:00', endTime: '13:00' })).status).toBe(403);
      expect((await call({ route: exceptionRoute, method: 'DELETE', params: { exceptionId: made.id }, body: { expectedUpdatedAt: made.updatedAt } })).status).toBe(403);
      expect((await listFor('resource')).status).toBe(200); // a viewer reads, window included
      as('manager', 'org-b');
      expect((await listFor('resource')).status).toBe(404);
      expect((await call({ route: exceptionRoute, method: 'DELETE', params: { exceptionId: made.id }, body: { expectedUpdatedAt: made.updatedAt } })).status).toBe(404);
      as('manager', 'org-a');
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
      expect((await call({ route: exceptionRoute, method: 'DELETE', params: { exceptionId: made.id }, body: { expectedUpdatedAt: made.updatedAt } })).status).toBe(200);
      expect(await countClosures(OWNERS.resource.id)).toBe(0);
    });

    it('the rule batches behave identically with 035 applied (a rule route and a rule patch/delete round trip)', async () => {
      const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
      expect(r.status).toBe(201);
      const [first] = r.json.rules as Array<{ id: string; updatedAt: string }>;
      const edited = await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: first.id }, body: { expectedUpdatedAt: first.updatedAt, startTime: '21:00' } });
      expect(edited.status, JSON.stringify(edited.json)).toBe(200);
      const removed = await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: first.id }, body: { expectedUpdatedAt: edited.json.rule.updatedAt } });
      expect(removed.status).toBe(200);
      expect(await countRules(OWNERS.resource.id)).toBe(1); // the Saturday half remains: removal is per rule
    });
  });

  // ─── Atomic removal of an overnight window (needs 034 only) ───────────────────────────────────────────────

  describe('removing an overnight window: POST availability-rules/remove-overnight', () => {
    type Half = { id: string; updatedAt: string; dayOfWeek: number; startTime: string; endTime: string };
    const makeWindow = async (o: Owner = 'resource', body: Record<string, unknown> = { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true }) => {
      const r = await addRule(o, body);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      return r.json.rules as Half[];
    };
    const tokens = (halves: Half[]) => halves.map(h => ({ id: h.id, expectedUpdatedAt: h.updatedAt }));
    const removeWindow = (halves: unknown) => call({ route: removeOvernightRoute, method: 'POST', body: { rules: halves } });
    const deletedAudit = async () => (await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_rule.deleted');
    const TOKEN = '2027-01-01T00:00:00.000000Z';

    it.each<Owner>(['resource', 'offering'])('removes both halves in one request and audits exactly the two rules that were deleted (%s)', async o => {
      const bystander = await addRule(o, { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' });
      expect(bystander.status).toBe(201);
      const halves = await makeWindow(o);
      const r = await removeWindow(tokens(halves));
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toEqual({ deleted: true, ids: expect.arrayContaining(halves.map(h => h.id)) });
      expect(await countRules(OWNERS[o].id)).toBe(1); // the unrelated Tuesday rule survives
      const audit = await deletedAudit();
      expect(audit).toHaveLength(2);
      expect(audit.map(a => a.resource_id).sort()).toEqual(halves.map(h => h.id).sort());
      for (const a of audit) expect(a.after_state.summary).toMatchObject({ batch_size: 2, window: 'overnight', owner_kind: o, owner_id: OWNERS[o].id, rule_kind: 'hours' });
      expect(audit.map(a => [a.after_state.summary.day_of_week, a.after_state.summary.start_time, a.after_state.summary.end_time]).sort()).toEqual([[5, '22:00', '24:00'], [6, '00:00', '02:00']]);
    });

    it('a stale half removes nothing, audits nothing, and says STALE_WRITE', async () => {
      const halves = await makeWindow();
      const moved = await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: halves[1].id }, body: { expectedUpdatedAt: halves[1].updatedAt, label: 'changed' } });
      expect(moved.status).toBe(200);
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const auditBefore = (await deletedAudit()).length;
      const r = await removeWindow(tokens(halves));
      expect([r.status, r.json.code]).toEqual([409, 'STALE_WRITE']);
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
      expect((await deletedAudit()).length).toBe(auditBefore);
    });

    it('a half that is gone is 404 and the other half is left alone; two unrelated rules are 409 NOT_OVERNIGHT_WINDOW', async () => {
      const halves = await makeWindow();
      const gone = await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: halves[0].id }, body: { expectedUpdatedAt: halves[0].updatedAt } });
      expect(gone.status).toBe(200);
      expect((await removeWindow(tokens(halves))).status).toBe(404);
      expect(await countRules(OWNERS.resource.id)).toBe(1);

      await q('DELETE FROM scheduling_availability_rules');
      const mon = (await addRule('resource', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })).json.rule as Half;
      const tue = (await addRule('resource', { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' })).json.rule as Half;
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const r = await removeWindow(tokens([mon, tue]));
      expect([r.status, r.json.code]).toEqual([409, 'NOT_OVERNIGHT_WINDOW']);
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
    });

    it('two windows of two owners cannot be removed by naming one half of each', async () => {
      const a = await makeWindow('resource');
      const b = await makeWindow('offering');
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const r = await removeWindow(tokens([a[0], b[1]]));
      expect([r.status, r.json.code]).toEqual([409, 'NOT_OVERNIGHT_WINDOW']);
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
    });

    it("another organisation's manager gets 404 and changes nothing; a viewer gets 403 and changes nothing", async () => {
      const halves = await makeWindow();
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const auditBefore = await snapshot('org-a', ['audit_logs']);
      as('manager', 'org-b');
      expect((await removeWindow(tokens(halves))).status).toBe(404);
      as('viewer', 'org-a');
      expect((await removeWindow(tokens(halves))).status).toBe(403);
      as('manager', 'org-a');
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
      expect(await snapshot('org-a', ['audit_logs'])).toEqual(auditBefore);
      expect(await countRules(OWNERS.resource.id)).toBe(2);
    });

    it('signed out is 401', async () => {
      const halves = await makeWindow();
      state.session = null;
      expect((await removeWindow(tokens(halves))).status).toBe(401);
      as('manager', 'org-a');
      expect(await countRules(OWNERS.resource.id)).toBe(2);
    });

    it.each([
      [{}, 'rules missing'],
      [{ rules: [] }, 'empty'],
      [{ rules: 'a,b' }, 'not a list'],
      [{ rules: [{ id: 'x', expectedUpdatedAt: TOKEN }] }, 'one rule'],
      [{ rules: [1, 2] }, 'not objects'],
      [{ rules: [{ id: 'x' }, { id: 'y' }] }, 'no tokens'],
      [{ rules: [{ id: 'x', expectedUpdatedAt: 'yesterday' }, { id: 'y', expectedUpdatedAt: TOKEN }] }, 'a bad token'],
      [{ rules: [{ id: 'x', expectedUpdatedAt: TOKEN }, { id: 'x', expectedUpdatedAt: TOKEN }] }, 'the same rule twice'],
      [{ rules: [{ id: 'x', expectedUpdatedAt: TOKEN, extra: 1 }, { id: 'y', expectedUpdatedAt: TOKEN }] }, 'an unknown field'],
      [{ rules: [{ id: 'x', expectedUpdatedAt: TOKEN }, { id: 'y', expectedUpdatedAt: TOKEN }], colour: 'red' }, 'an unknown top-level field'],
      [{ rules: [{ id: 'x', expectedUpdatedAt: TOKEN }, { id: '', expectedUpdatedAt: TOKEN }] }, 'an empty id'],
    ])('invalid request %# (%s) is a 400 that changes nothing', async body => {
      await makeWindow();
      const before = await snapshot('org-a', AVAILABILITY_TABLES);
      const r = await call({ route: removeOvernightRoute, method: 'POST', body });
      expect(r.status, JSON.stringify(r.json)).toBe(400);
      expect(r.json.code).toBe('INVALID_INPUT');
      expect(await snapshot('org-a', AVAILABILITY_TABLES)).toEqual(before);
    });

    it('is allowed on an archived offering and an inactive resource', async () => {
      const onOffering = await makeWindow('offering');
      const onResource = await makeWindow('resource');
      expect((await call({ route: offeringArchive, method: 'POST', params: { offeringId: OWNERS.offering.id } })).status).toBe(200);
      const stamp = (await q<{ u: string }>("SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS u FROM scheduling_resources WHERE id = $1", [OWNERS.resource.id]))[0].u;
      expect((await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: OWNERS.resource.id }, body: { expectedUpdatedAt: stamp } })).status).toBe(200);
      expect((await removeWindow(tokens(onOffering))).status).toBe(200);
      expect((await removeWindow(tokens(onResource))).status).toBe(200);
      expect((await countRules(OWNERS.offering.id)) + (await countRules(OWNERS.resource.id))).toBe(0);
    });

    it('8 simultaneous requests: exactly one removes the window (200), the rest find it gone (404), and it is audited once', async () => {
      const halves = await makeWindow();
      const results = await Promise.all(Array.from({ length: 8 }, () => removeWindow(tokens(halves))));
      expect(results.filter(r => r.status === 200)).toHaveLength(1);
      expect(results.filter(r => r.status !== 200).every(r => r.status === 404)).toBe(true);
      expect(await countRules(OWNERS.resource.id)).toBe(0);
      expect(await deletedAudit()).toHaveLength(2);
    });

    it('a removal racing an edit of one half: never half a window, and the audit matches what committed', async () => {
      for (let round = 0; round < 8; round++) {
        await q('DELETE FROM scheduling_availability_rules');
        await q("DELETE FROM audit_logs WHERE action LIKE 'scheduling.availability_%'");
        const halves = await makeWindow();
        const target = halves[round % 2];
        const [del, upd] = await Promise.all([
          removeWindow(tokens(halves)),
          call({ route: ruleRoute, method: 'PATCH', params: { ruleId: target.id }, body: { expectedUpdatedAt: target.updatedAt, label: `round ${round}` } }),
        ]);
        const left = await countRules(OWNERS.resource.id);
        const deletedEntries = (await deletedAudit()).length;
        if (del.status === 200) {
          expect([left, deletedEntries, upd.status === 404 || upd.status === 409]).toEqual([0, 2, true]);
        } else {
          expect([del.status, del.json.code, upd.status, left, deletedEntries]).toEqual([409, 'STALE_WRITE', 200, 2, 0]);
        }
      }
    });

    it('fails closed before migration 034: 503 AVAILABILITY_NOT_READY, nothing deleted, nothing audited; 034 restores it', async () => {
      const halves = await makeWindow();
      await pool.query(sqlFile('096_availability_partial_closures_rollback.sql'));
      await pool.query(sqlFile('095_availability_integrity_rollback.sql'));
      try {
        const auditBefore = (await deletedAudit()).length;
        const r = await removeWindow(tokens(halves));
        expect([r.status, r.json.code]).toEqual([503, 'AVAILABILITY_NOT_READY']);
        expect(await countRules(OWNERS.resource.id)).toBe(2);
        expect((await deletedAudit()).length).toBe(auditBefore);
      } finally {
        await pool.query(sqlFile('034_availability_integrity.sql'));
      }
      const fresh = (await listFor('resource')).json.rules as Half[];
      expect((await removeWindow(tokens(fresh))).status).toBe(200);
    });
  });
});
