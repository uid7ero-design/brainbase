import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Phase 2B.3b real-Postgres proof of the availability configuration API (run by scripts/tests/verify-scheduling-phase2b3b.sh against a
// DISPOSABLE database, on PostgreSQL 16 and 17). It reaches only the database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL.
// Only the application's database client (a pool onto that same disposable database) and the session are replaced. The capability
// lookup, the central guard, the runtime, both Postgres repositories, the audit module and every route handler are the REAL code.
//
// Two phases against one database: "before migration 034" (the availability schema is absent: everything must fail closed) and "after
// migration 034" (this file applies it itself, exactly as the owner will).

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
  q<{ action: string; resource_type: string; resource_id: string; user_id: string; after_state: { summary: Record<string, unknown> } }>(
    "SELECT action, resource_type, resource_id, user_id, after_state FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'scheduling.availability_%' ORDER BY created_at, id",
    [org],
  );

type Owner = 'offering' | 'resource';
const OWNERS: Record<Owner, { id: string; rules: Route; exceptions: Route; list: Route; param: string }> = {
  offering: { id: '', rules: offeringRules, exceptions: offeringExceptions, list: offeringAvailability, param: 'offeringId' },
  resource: { id: '', rules: resourceRules, exceptions: resourceExceptions, list: resourceAvailability, param: 'resourceId' },
};
const addRule = (o: Owner, body: unknown, id = OWNERS[o].id) => call({ route: OWNERS[o].rules, method: 'POST', params: { [OWNERS[o].param]: id }, body });
const addClosure = (o: Owner, body: unknown, id = OWNERS[o].id) => call({ route: OWNERS[o].exceptions, method: 'POST', params: { [OWNERS[o].param]: id }, body });
const listFor = (o: Owner, id = OWNERS[o].id) => call({ route: OWNERS[o].list, method: 'GET', params: { [OWNERS[o].param]: id } });
const MON_MORNING = { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' };

suite('Scheduling 2B.3b availability API on real Postgres', () => {
  const reset = async () => {
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_settings, audit_logs, zz_committed CASCADE');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    for (const [id, tz] of [['org-a', 'Australia/Adelaide'], ['org-b', 'Australia/Perth'], ['org-d', 'Australia/Perth']] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $4, $5)', [`user-${id}`, id, `${id}@example.test`, id, 'manager']);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
    }
    for (const id of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [id]);
    as('manager', 'org-a');
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 30 });
    pool.on('error', () => undefined);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reset();
  });

  // ─── Phase 1: the availability schema is absent ──────────────────────────────────────────────────────────────

  describe('before migration 034', () => {
    it('every availability route fails closed with 503 AVAILABILITY_NOT_READY, writes nothing and audits nothing', async () => {
      expect((await q("SELECT 1 FROM information_schema.columns WHERE table_name = 'scheduling_availability_rules' AND column_name = 'updated_at'")).length, 'this phase needs a database without 034').toBe(0);
      const s = await newSchedule();
      const o = await newOffering(s.id);
      const r = await newResource();
      const before = await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES]);
      const stale = '2026-01-01T00:00:00.000000Z';
      const calls: Array<[string, Call]> = [
        ['list offering', { route: offeringAvailability, method: 'GET', params: { offeringId: o.id } }],
        ['list resource', { route: resourceAvailability, method: 'GET', params: { resourceId: r.id } }],
        ['add rule (offering)', { route: offeringRules, method: 'POST', params: { offeringId: o.id }, body: MON_MORNING }],
        ['add rule (resource)', { route: resourceRules, method: 'POST', params: { resourceId: r.id }, body: MON_MORNING }],
        ['add closure', { route: resourceExceptions, method: 'POST', params: { resourceId: r.id }, body: { fromDate: '2026-12-25', toDate: '2026-12-25' } }],
        ['edit rule', { route: ruleRoute, method: 'PATCH', params: { ruleId: 'x' }, body: { expectedUpdatedAt: stale, endTime: '13:00' } }],
        ['delete rule', { route: ruleRoute, method: 'DELETE', params: { ruleId: 'x' }, body: { expectedUpdatedAt: stale } }],
        ['edit closure', { route: exceptionRoute, method: 'PATCH', params: { exceptionId: 'x' }, body: { expectedUpdatedAt: stale, reason: 'x' } }],
        ['delete closure', { route: exceptionRoute, method: 'DELETE', params: { exceptionId: 'x' }, body: { expectedUpdatedAt: stale } }],
      ];
      for (const [name, c] of calls) {
        const res = await call(c);
        expect(res.status, name).toBe(503);
        expect(res.json.code, name).toBe('AVAILABILITY_NOT_READY');
        expect(JSON.stringify(res.json), name).not.toMatch(/column|relation|updated_at|postgres/i);
      }
      expect(await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES])).toEqual(before);
      expect(await availabilityAudit('org-a')).toEqual([]);
    });

    it('the rest of Scheduling is unaffected (configuration still works)', async () => {
      const s = await newSchedule();
      expect((await newOffering(s.id)).id).toBeTruthy();
    });
  });

  // ─── Phase 2: after 034 ──────────────────────────────────────────────────────────────────────────────────────

  describe('after migration 034', () => {
    let ids: { schedule: string; offering: string; resource: string };

    beforeAll(async () => {
      await pool.query(sqlFile('034_availability_integrity.sql'));
    }, 60_000);
    beforeEach(async () => {
      const s = await newSchedule();
      ids = { schedule: s.id, offering: (await newOffering(s.id)).id, resource: (await newResource()).id };
      OWNERS.offering.id = ids.offering;
      OWNERS.resource.id = ids.resource;
    });

    const everyOperation = (): Array<[string, Call, 'view' | 'manage']> => [
      ['list offering availability', { route: offeringAvailability, method: 'GET', params: { offeringId: ids.offering } }, 'view'],
      ['list resource availability', { route: resourceAvailability, method: 'GET', params: { resourceId: ids.resource } }, 'view'],
      ['add rule to offering', { route: offeringRules, method: 'POST', params: { offeringId: ids.offering }, body: { dayOfWeek: 3, startTime: '09:00', endTime: '10:00' } }, 'manage'],
      ['add rule to resource', { route: resourceRules, method: 'POST', params: { resourceId: ids.resource }, body: { dayOfWeek: 3, startTime: '09:00', endTime: '10:00' } }, 'manage'],
      ['add closure to offering', { route: offeringExceptions, method: 'POST', params: { offeringId: ids.offering }, body: { fromDate: '2026-12-25', toDate: '2026-12-25' } }, 'manage'],
      ['add closure to resource', { route: resourceExceptions, method: 'POST', params: { resourceId: ids.resource }, body: { fromDate: '2026-12-25', toDate: '2026-12-25' } }, 'manage'],
      ['edit rule', { route: ruleRoute, method: 'PATCH', params: { ruleId: 'no-such' }, body: { expectedUpdatedAt: '2026-01-01T00:00:00.000000Z', endTime: '13:00' } }, 'manage'],
      ['delete rule', { route: ruleRoute, method: 'DELETE', params: { ruleId: 'no-such' }, body: { expectedUpdatedAt: '2026-01-01T00:00:00.000000Z' } }, 'manage'],
      ['edit closure', { route: exceptionRoute, method: 'PATCH', params: { exceptionId: 'no-such' }, body: { expectedUpdatedAt: '2026-01-01T00:00:00.000000Z', reason: 'x' } }, 'manage'],
      ['delete closure', { route: exceptionRoute, method: 'DELETE', params: { exceptionId: 'no-such' }, body: { expectedUpdatedAt: '2026-01-01T00:00:00.000000Z' } }, 'manage'],
    ];

    describe('access', () => {
      it('401 without a session on every operation, and nothing is written', async () => {
        state.session = null;
        const before = await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES]);
        for (const [name, c] of everyOperation()) expect((await call(c)).status, name).toBe(401);
        expect(await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES])).toEqual(before);
      });

      it('403 for an organisation that is not entitled to Scheduling, on every operation', async () => {
        as('manager', 'org-d');
        for (const [name, c] of everyOperation()) expect((await call(c)).status, name).toBe(403);
      });

      it('403 for analyst and unknown roles on every operation, reads included', async () => {
        for (const role of ['analyst', 'guest', '']) {
          as(role, 'org-a');
          for (const [name, c] of everyOperation()) expect((await call(c)).status, `${role} ${name}`).toBe(403);
        }
      });

      it('a viewer reads but every write is 403 and changes nothing', async () => {
        const rule = await addRule('resource', MON_MORNING);
        expect(rule.status).toBe(201);
        as('viewer', 'org-a');
        const before = await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES]);
        for (const [name, c, need] of everyOperation()) expect((await call(c)).status, `viewer ${name}`).toBe(need === 'view' ? 200 : 403);
        const view = await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rule.json.rule.id }, body: { expectedUpdatedAt: rule.json.rule.updatedAt } });
        expect(view.status).toBe(403);
        expect(await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES])).toEqual(before);
        const read = await listFor('resource');
        expect(read.json.rules).toHaveLength(1);
      });

      it('manager, admin and super_admin may manage', async () => {
        for (const role of ['manager', 'admin', 'super_admin']) {
          as(role, 'org-a');
          const res = await addRule('resource', { dayOfWeek: role.length % 7, startTime: '05:00', endTime: '06:00' });
          expect(res.status, role).toBe(201);
        }
      });
    });

    describe('tenant isolation', () => {
      it('another entitled organisation gets 404 for these owners, rules and closures, and nothing changes', async () => {
        const rule = (await addRule('resource', MON_MORNING)).json.rule;
        const closure = (await addClosure('resource', { fromDate: '2026-12-25', toDate: '2026-12-25', reason: 'Christmas' })).json.exception;
        const orule = (await addRule('offering', MON_MORNING)).json.rule;
        as('manager', 'org-b');
        const before = await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES]);
        const stale = rule.updatedAt;
        const attempts: Call[] = [
          { route: resourceAvailability, method: 'GET', params: { resourceId: ids.resource } },
          { route: offeringAvailability, method: 'GET', params: { offeringId: ids.offering } },
          { route: resourceRules, method: 'POST', params: { resourceId: ids.resource }, body: { dayOfWeek: 5, startTime: '09:00', endTime: '10:00' } },
          { route: offeringRules, method: 'POST', params: { offeringId: ids.offering }, body: { dayOfWeek: 5, startTime: '09:00', endTime: '10:00' } },
          { route: resourceExceptions, method: 'POST', params: { resourceId: ids.resource }, body: { fromDate: '2027-01-01', toDate: '2027-01-01' } },
          { route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: stale, endTime: '13:00' } },
          { route: ruleRoute, method: 'DELETE', params: { ruleId: rule.id }, body: { expectedUpdatedAt: stale } },
          { route: ruleRoute, method: 'DELETE', params: { ruleId: orule.id }, body: { expectedUpdatedAt: orule.updatedAt } },
          { route: exceptionRoute, method: 'PATCH', params: { exceptionId: closure.id }, body: { expectedUpdatedAt: closure.updatedAt, reason: 'x' } },
          { route: exceptionRoute, method: 'DELETE', params: { exceptionId: closure.id }, body: { expectedUpdatedAt: closure.updatedAt } },
        ];
        for (const a of attempts) {
          const r = await call(a);
          expect(r.status, `${a.method} ${JSON.stringify(a.params)}`).toBe(404);
          expect(r.json.code).toBe('NOT_FOUND');
        }
        expect(await snapshot('org-a', [...AVAILABILITY_TABLES, ...OTHER_TABLES])).toEqual(before);
        expect(await availabilityAudit('org-b')).toEqual([]);
      });

      it('responses never carry an organisation id, and a list shows only the caller\'s own rows', async () => {
        await addRule('resource', MON_MORNING);
        const listed = await listFor('resource');
        expect(JSON.stringify(listed.json)).not.toMatch(/organisation|org-a/i);
        as('manager', 'org-b');
        const own = await newResource();
        expect((await addRule('resource', MON_MORNING, own.id)).status).toBe(201);
        expect((await listFor('resource', own.id)).json.rules).toHaveLength(1);
      });
    });

    describe('creating, reading, editing and removing rules', () => {
      for (const owner of ['offering', 'resource'] as const) {
        it(`${owner}: create (201), list, edit with the version, delete with the version`, async () => {
          const created = await addRule(owner, { ...MON_MORNING, label: ' Morning ', kind: 'hours' });
          expect(created.status, JSON.stringify(created.json)).toBe(201);
          const rule = created.json.rule;
          expect(rule).toMatchObject({ dayOfWeek: 1, startTime: '09:00', endTime: '12:00', kind: 'hours', label: 'Morning', validFrom: null, validTo: null });
          expect(rule.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
          expect(owner === 'offering' ? [rule.offeringId, rule.resourceId] : [rule.resourceId, rule.offeringId]).toEqual([OWNERS[owner].id, null]);

          const list = await listFor(owner);
          expect(list.status).toBe(200);
          expect(list.json.owner).toEqual({ kind: owner, id: OWNERS[owner].id });
          expect(list.json.rules).toHaveLength(1);
          expect(list.json.exceptions).toEqual([]);

          const edited = await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt, endTime: '24:00', label: null } });
          expect(edited.status, JSON.stringify(edited.json)).toBe(200);
          expect(edited.json.rule).toMatchObject({ endTime: '24:00', label: null });
          expect(edited.json.rule.updatedAt > rule.updatedAt).toBe(true);

          const stale = await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt, endTime: '13:00' } });
          expect(stale.status).toBe(409);
          expect(stale.json.code).toBe('STALE_WRITE');
          const staleDelete = await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt } });
          expect(staleDelete.status).toBe(409);
          expect((await listFor(owner)).json.rules).toHaveLength(1);

          const gone = await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rule.id }, body: { expectedUpdatedAt: edited.json.rule.updatedAt } });
          expect(gone.status).toBe(200);
          expect(gone.json).toEqual({ deleted: true, id: rule.id });
          expect((await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rule.id }, body: { expectedUpdatedAt: edited.json.rule.updatedAt } })).status).toBe(404);
        });
      }

      it('24:00 is accepted as the end of the day and round-trips', async () => {
        const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '24:00' });
        expect(r.status).toBe(201);
        expect(r.json.rule.endTime).toBe('24:00');
        expect((await listFor('resource')).json.rules[0].endTime).toBe('24:00');
      });

      it('overlapping rules of one owner are refused (409 OVERLAP) in every way; touching and other owners are fine', async () => {
        expect((await addRule('resource', MON_MORNING)).status).toBe(201);
        for (const [s, e] of [['11:00', '13:00'], ['08:00', '09:30'], ['09:30', '10:00'], ['09:00', '12:00']]) {
          const r = await addRule('resource', { dayOfWeek: 1, startTime: s, endTime: e });
          expect(r.status, `${s}-${e}`).toBe(409);
          expect(r.json.code).toBe('OVERLAP');
        }
        expect((await addRule('resource', { dayOfWeek: 1, startTime: '12:00', endTime: '17:00' })).status).toBe(201);
        expect((await addRule('resource', { dayOfWeek: 2, ...{ startTime: '09:00', endTime: '12:00' } })).status).toBe(201);
        expect((await addRule('offering', MON_MORNING)).status).toBe(201);
        const move = (await listFor('resource')).json.rules.find((x: { startTime: string; dayOfWeek: number }) => x.startTime === '12:00');
        const into = await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: move.id }, body: { expectedUpdatedAt: move.updatedAt, startTime: '11:00' } });
        expect([into.status, into.json.code]).toEqual([409, 'OVERLAP']);
      });

      it('concurrent identical overlapping requests: exactly one 201, the rest 409 OVERLAP, one row stored', async () => {
        const results = await Promise.all(Array.from({ length: 12 }, () => addRule('resource', MON_MORNING)));
        expect(results.filter(r => r.status === 201)).toHaveLength(1);
        expect(results.filter(r => r.status === 409).every(r => r.json.code === 'OVERLAP')).toBe(true);
        expect(results.every(r => r.status === 201 || r.status === 409)).toBe(true);
        expect((await listFor('resource')).json.rules).toHaveLength(1);
        expect((await availabilityAudit('org-a')).filter(a => a.action === 'scheduling.availability_rule.created')).toHaveLength(1);
      });

      it('concurrent edits with one version: one 200, the rest 409 STALE_WRITE', async () => {
        const rule = (await addRule('resource', MON_MORNING)).json.rule;
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt, label: `L${i}` } })));
        expect(results.filter(r => r.status === 200)).toHaveLength(1);
        expect(results.filter(r => r.status === 409).every(r => r.json.code === 'STALE_WRITE')).toBe(true);
      });

      it('an archived offering takes no availability (409 ARCHIVED); an inactive resource likewise (409 RESOURCE_INACTIVE); removal is still allowed', async () => {
        const orule = (await addRule('offering', MON_MORNING)).json.rule;
        const rrule = (await addRule('resource', MON_MORNING)).json.rule;
        expect((await call({ route: offeringArchive, method: 'POST', params: { offeringId: ids.offering }, body: { expectedUpdatedAt: (await q<{ u: string }>("SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS u FROM scheduling_offerings WHERE id = $1", [ids.offering]))[0].u } })).status).toBeLessThan(300);
        const res = (await q<{ u: string }>("SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS u FROM scheduling_resources WHERE id = $1", [ids.resource]))[0].u;
        expect((await call({ route: resourceDeactivate, method: 'POST', params: { resourceId: ids.resource }, body: { expectedUpdatedAt: res } })).status).toBe(200);

        for (const [owner, expectedCode] of [['offering', 'ARCHIVED'], ['resource', 'RESOURCE_INACTIVE']] as const) {
          const add = await addRule(owner, { dayOfWeek: 4, startTime: '09:00', endTime: '10:00' });
          expect([add.status, add.json.code], `${owner} add`).toEqual([409, expectedCode]);
          const closure = await addClosure(owner, { fromDate: '2026-12-25', toDate: '2026-12-25' });
          expect([closure.status, closure.json.code], `${owner} closure`).toEqual([409, expectedCode]);
        }
        const edit = await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: orule.id }, body: { expectedUpdatedAt: orule.updatedAt, endTime: '13:00' } });
        expect([edit.status, edit.json.code]).toEqual([409, 'ARCHIVED']);
        expect((await listFor('offering')).status).toBe(200); // still readable
        expect((await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: orule.id }, body: { expectedUpdatedAt: orule.updatedAt } })).status).toBe(200);
        expect((await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rrule.id }, body: { expectedUpdatedAt: rrule.updatedAt } })).status).toBe(200);
      });
    });

    describe('closures', () => {
      it('create, list, edit, stale edit, delete; the reason is optional and trimmed', async () => {
        const c = await addClosure('resource', { fromDate: '2026-12-25', toDate: '2026-12-26', reason: '  Christmas ' });
        expect(c.status, JSON.stringify(c.json)).toBe(201);
        expect(c.json.exception).toMatchObject({ fromDate: '2026-12-25', toDate: '2026-12-26', kind: 'closed', reason: 'Christmas' });
        expect((await listFor('resource')).json.exceptions).toHaveLength(1);
        const e = await call({ route: exceptionRoute, method: 'PATCH', params: { exceptionId: c.json.exception.id }, body: { expectedUpdatedAt: c.json.exception.updatedAt, toDate: '2026-12-27', reason: null } });
        expect(e.status, JSON.stringify(e.json)).toBe(200);
        expect(e.json.exception).toMatchObject({ toDate: '2026-12-27', reason: null });
        const stale = await call({ route: exceptionRoute, method: 'PATCH', params: { exceptionId: c.json.exception.id }, body: { expectedUpdatedAt: c.json.exception.updatedAt, reason: 'again' } });
        expect([stale.status, stale.json.code]).toEqual([409, 'STALE_WRITE']);
        const del = await call({ route: exceptionRoute, method: 'DELETE', params: { exceptionId: c.json.exception.id }, body: { expectedUpdatedAt: e.json.exception.updatedAt } });
        expect(del.status).toBe(200);
        expect((await listFor('resource')).json.exceptions).toEqual([]);
      });

      it('overlapping closures are refused (inclusive dates), concurrently as well; an override is not available yet', async () => {
        expect((await addClosure('offering', { fromDate: '2026-12-24', toDate: '2026-12-26' })).status).toBe(201);
        const clash = await addClosure('offering', { fromDate: '2026-12-26', toDate: '2026-12-28' });
        expect([clash.status, clash.json.code]).toEqual([409, 'OVERLAP']);
        expect((await addClosure('offering', { fromDate: '2026-12-27', toDate: '2026-12-28' })).status).toBe(201);
        const results = await Promise.all(Array.from({ length: 10 }, () => addClosure('resource', { fromDate: '2027-02-01', toDate: '2027-02-03' })));
        expect(results.filter(r => r.status === 201)).toHaveLength(1);
        const override = await addClosure('resource', { fromDate: '2027-03-01', toDate: '2027-03-01', kind: 'override' });
        expect(override.status).toBe(400);
        expect(override.json.problems.join(' ')).toMatch(/override/i);
      });
    });

    describe('validation (400, with plain reasons, and nothing written)', () => {
      const bad: Array<[string, unknown, RegExp]> = [
        ['missing fields', {}, /dayOfWeek is required/],
        ['unknown field', { ...MON_MORNING, organisationId: 'org-b' }, /organisationId is not a field/],
        ['day out of range', { ...MON_MORNING, dayOfWeek: 7 }, /dayOfWeek/],
        ['day not a number', { ...MON_MORNING, dayOfWeek: 'Monday' }, /dayOfWeek/],
        ['bad time', { ...MON_MORNING, startTime: '9am' }, /startTime/],
        ['end before start', { dayOfWeek: 1, startTime: '12:00', endTime: '09:00' }, /after startTime/],
        ['end equals start', { dayOfWeek: 1, startTime: '12:00', endTime: '12:00' }, /after startTime/],
        ['past 24:00', { ...MON_MORNING, endTime: '24:01' }, /endTime/],
        ['start of 24:00', { dayOfWeek: 1, startTime: '24:00', endTime: '24:00' }, /startTime/],
        ['bad kind', { ...MON_MORNING, kind: 'night' }, /kind/],
        ['label too long', { ...MON_MORNING, label: 'x'.repeat(81) }, /label/],
        ['label not text', { ...MON_MORNING, label: 5 }, /label/],
        ['bad validFrom', { ...MON_MORNING, validFrom: '2026-02-30' }, /validFrom/],
        ['validTo before validFrom', { ...MON_MORNING, validFrom: '2026-06-01', validTo: '2026-05-01' }, /valid/i],
      ];
      for (const [name, body, message] of bad) {
        it(name, async () => {
          const before = await snapshot('org-a', [...AVAILABILITY_TABLES]);
          const r = await addRule('resource', body);
          expect(r.status, JSON.stringify(r.json)).toBe(400);
          expect(r.json.code).toBe('INVALID_INPUT');
          expect(r.json.problems.join(' | ')).toMatch(message);
          expect(await snapshot('org-a', [...AVAILABILITY_TABLES])).toEqual(before);
        });
      }

      it('a window past midnight in one request is refused with the two-rule hint', async () => {
        const r = await addRule('resource', { dayOfWeek: 5, startTime: '22:00', endTime: '02:00' });
        expect(r.status).toBe(400);
        expect(r.json.problems.join(' ')).toMatch(/two rules/);
      });

      it('edits: a version is required, an empty edit is refused, an edit cannot change the owner or id', async () => {
        const rule = (await addRule('resource', MON_MORNING)).json.rule;
        const patch = (body: unknown) => call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body });
        expect((await patch({ endTime: '13:00' })).status).toBe(400);
        expect((await patch({ expectedUpdatedAt: 'yesterday', endTime: '13:00' })).status).toBe(400);
        expect((await patch({ expectedUpdatedAt: rule.updatedAt })).status).toBe(400);
        for (const field of ['resourceId', 'offeringId', 'id', 'organisationId']) expect((await patch({ expectedUpdatedAt: rule.updatedAt, [field]: 'x' })).status, field).toBe(400);
        expect((await patch({ expectedUpdatedAt: rule.updatedAt, startTime: '13:00' })).status).toBe(400); // start after the stored end
        const del = (body: unknown) => call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rule.id }, body });
        expect((await del({})).status).toBe(400);
        expect((await del({ expectedUpdatedAt: rule.updatedAt, extra: 1 })).status).toBe(400);
        expect((await listFor('resource')).json.rules).toHaveLength(1);
      });

      it('closures: dates, ordering, unknown fields and reason length', async () => {
        for (const body of [{}, { fromDate: '2026-12-25' }, { fromDate: '2026-12-26', toDate: '2026-12-25' }, { fromDate: 'x', toDate: 'y' }, { fromDate: '2026-12-25', toDate: '2026-12-25', reason: 'x'.repeat(201) }, { fromDate: '2026-12-25', toDate: '2026-12-25', organisationId: 'org-b' }, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'weird' }]) {
          const r = await addClosure('resource', body);
          expect(r.status, JSON.stringify(body)).toBe(400);
        }
        expect(await q("SELECT 1 FROM scheduling_availability_exceptions")).toEqual([]);
      });

      it('body handling: not JSON (415), malformed (400), too large (413), unknown owner (404), id with odd characters (404)', async () => {
        const post = (extra: Partial<Call>) => call({ route: resourceRules, method: 'POST', params: { resourceId: ids.resource }, ...extra });
        expect((await post({ rawBody: '{}', contentType: 'text/plain' })).status).toBe(415);
        expect((await post({ rawBody: '{nope' })).status).toBe(400);
        expect((await post({ rawBody: '[]' })).status).toBe(400);
        expect((await post({ rawBody: JSON.stringify({ ...MON_MORNING, label: 'x'.repeat(40_000) }) })).status).toBe(413);
        expect((await addRule('resource', MON_MORNING, 'no-such-resource')).status).toBe(404);
        expect((await addRule('resource', MON_MORNING, "x'; DROP TABLE scheduling_resources;--")).status).toBe(404);
        expect((await listFor('offering', 'no-such')).status).toBe(404);
        expect(await q("SELECT 1 FROM scheduling_availability_rules")).toEqual([]);
      });
    });

    describe('audit', () => {
      it('every successful mutation writes exactly one audit entry; refusals write none; the summary carries ids, times and fields, never free text', async () => {
        const rule = (await addRule('resource', { ...MON_MORNING, label: 'Peak hours' })).json.rule; // created
        const edited = (await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt, endTime: '13:00' } })).json.rule; // updated
        const closure = (await addClosure('offering', { fromDate: '2026-12-25', toDate: '2026-12-25', reason: 'Email me at boss@example.com' })).json.exception; // created
        const closureEdit = (await call({ route: exceptionRoute, method: 'PATCH', params: { exceptionId: closure.id }, body: { expectedUpdatedAt: closure.updatedAt, toDate: '2026-12-26' } })).json.exception; // updated
        // refused: none of these may audit
        await addRule('resource', { dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }); // overlap
        await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt, endTime: '14:00' } }); // stale
        await addRule('resource', { dayOfWeek: 9, startTime: '10:00', endTime: '11:00' }); // invalid
        await addRule('resource', MON_MORNING, 'no-such'); // not found
        state.session = null;
        await addRule('resource', { dayOfWeek: 2, startTime: '10:00', endTime: '11:00' }); // 401
        as('viewer', 'org-a');
        await addRule('resource', { dayOfWeek: 2, startTime: '10:00', endTime: '11:00' }); // 403
        as('manager', 'org-a');
        expect((await call({ route: ruleRoute, method: 'DELETE', params: { ruleId: rule.id }, body: { expectedUpdatedAt: edited.updatedAt } })).status).toBe(200); // deleted
        expect((await call({ route: exceptionRoute, method: 'DELETE', params: { exceptionId: closure.id }, body: { expectedUpdatedAt: closureEdit.updatedAt } })).status).toBe(200); // deleted

        const rows = await availabilityAudit('org-a');
        expect(rows.map(r => [r.action, r.resource_type, r.resource_id])).toEqual([
          ['scheduling.availability_rule.created', 'scheduling.availability_rule', rule.id],
          ['scheduling.availability_rule.updated', 'scheduling.availability_rule', rule.id],
          ['scheduling.availability_exception.created', 'scheduling.availability_exception', closure.id],
          ['scheduling.availability_exception.updated', 'scheduling.availability_exception', closure.id],
          ['scheduling.availability_rule.deleted', 'scheduling.availability_rule', rule.id],
          ['scheduling.availability_exception.deleted', 'scheduling.availability_exception', closure.id],
        ]);
        for (const r of rows) expect(r.user_id).toBe('user-org-a');
        expect(rows[0].after_state.summary).toMatchObject({ owner_kind: 'resource', owner_id: ids.resource, day_of_week: 1, start_time: '09:00', end_time: '12:00' });
        expect(rows[1].after_state.summary).toMatchObject({ fields: ['endTime'], end_time: '13:00' });
        expect(rows[2].after_state.summary).toMatchObject({ owner_kind: 'offering', from_date: '2026-12-25', has_reason: true });
        const everything = JSON.stringify(rows);
        expect(everything).not.toMatch(/Peak hours|boss@example\.com|Email me/);
        expect(await availabilityAudit('org-b')).toEqual([]);
      });
    });

    describe('what availability never touches', () => {
      it('writing and reading availability changes no schedule, offering, resource, assignment, reservation, hold or occurrence', async () => {
        const before = await snapshot('org-a', OTHER_TABLES);
        const rule = (await addRule('resource', MON_MORNING)).json.rule;
        await addRule('offering', MON_MORNING);
        await addClosure('resource', { fromDate: '2026-12-25', toDate: '2026-12-25' });
        await call({ route: ruleRoute, method: 'PATCH', params: { ruleId: rule.id }, body: { expectedUpdatedAt: rule.updatedAt, endTime: '13:00' } });
        await listFor('resource');
        await listFor('offering');
        const after = await snapshot('org-a', OTHER_TABLES);
        // audit_logs is the last element and legitimately gains the availability entries; every scheduling table is unchanged.
        expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
        for (const t of ['scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences']) expect(await q(`SELECT 1 FROM ${t}`)).toEqual([]);
      });

      it('the organisation timezone is never written (timezone pinning is a decision, not part of this API)', async () => {
        await addRule('resource', MON_MORNING);
        expect((await q<{ timezone: string | null }>("SELECT timezone FROM scheduling_schedules WHERE id = $1", [ids.schedule]))[0].timezone).toBeNull();
        expect((await q<{ timezone: string }>("SELECT timezone FROM organisations WHERE id = 'org-a'"))[0].timezone).toBe('Australia/Adelaide');
      });
    });
  });
});
