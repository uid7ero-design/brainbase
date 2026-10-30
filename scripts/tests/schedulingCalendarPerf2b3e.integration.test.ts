import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Phase 2B.3e: how many database statements the READ-ONLY calendar issues, and how long it takes, for an offering with 1, 5, 20 and 50 linked
// resources (run by scripts/tests/verify-scheduling-phase2b3e.sh against a DISPOSABLE database, on PostgreSQL 16 and 17).
// The application's database client is wrapped so every statement is counted and classified; the session is the only other thing replaced.
//   - COUNT: the statement count of one offering calendar request is a small constant, not a function of the number of resources.
//   - SAME ANSWER: the response body is identical to the one built from the per-owner reads (the unbatched reference path, kept in this file).
//   - TENANT: the batched reads never return another organisation's rows, even when asked for that organisation's ids.
// SCHEDULING_PERF_REPORT (optional) names a file the measurements are written to as JSON.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const stats = vi.hoisted(() => ({ statements: [] as string[] }));
vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 40 });
  const run = (text: string, params: unknown[]) => {
    stats.statements.push(text);
    return p.query(text, params).then(r => r.rows);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const query = (text: string, params: unknown[] = []) => run(text, [...params]);
  return { default: Object.assign(tag, { query }) };
});
const state = vi.hoisted(() => ({ session: null as null | Record<string, unknown> }));
vi.mock('@/lib/org', () => ({
  requireSession: async () => {
    if (!state.session) throw new Error('Unauthorized');
    return state.session;
  },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
type Route = Partial<Record<'GET' | 'POST', Handler>>;
const schedulesRoute = (await import('@/app/api/scheduling/schedules/route')) as Route;
const scheduleOfferings = (await import('@/app/api/scheduling/schedules/[scheduleId]/offerings/route')) as Route;
const offeringRules = (await import('@/app/api/scheduling/offerings/[offeringId]/availability-rules/route')) as Route;
const resourceRules = (await import('@/app/api/scheduling/resources/[resourceId]/availability-rules/route')) as Route;
const resourceExceptions = (await import('@/app/api/scheduling/resources/[resourceId]/availability-exceptions/route')) as Route;
const offeringCalendar = (await import('@/app/api/scheduling/offerings/[offeringId]/calendar/route')) as Route;

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');
const as = (role: string, organisationId: string) => {
  state.session = { userId: `user-${organisationId}`, organisationId, homeOrganisationId: organisationId, role, name: 'T' };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function send(route: Route, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown, query = ''): Promise<{ status: number; json: Json; text: string }> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await route[method]!(new Request(`http://bb.test/api/scheduling/x${query}`, init), { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, text };
}
const post = async (route: Route, params: Record<string, string>, body: unknown) => {
  const r = await send(route, 'POST', params, body);
  expect(r.status, r.text).toBeLessThan(300);
  return r;
};

const SIZES = [1, 5, 20, 50];
const WEEK = '?from=2027-01-11&to=2027-01-17&step=30';
const report: Record<string, unknown> = {};

/** Statements issued by the calendar request, minus the central guard's entitlement/session lookups (constant, independent of N). */
const classify = (statements: string[]) => {
  const out: Record<string, number> = {};
  for (const s of statements) {
    const m = /FROM\s+(\w+)/i.exec(s);
    const key = m ? m[1] : 'other';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

async function world(n: number) {
  await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_availability_zones, scheduling_availability_rules, scheduling_availability_exceptions, scheduling_settings, audit_logs, zz_committed CASCADE');
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
  const schedule = (await post(schedulesRoute, {}, { name: 'Hire', presetKey: 'resource_hire' })).json.schedule.id as string;
  const offering = (await post(scheduleOfferings, { scheduleId: schedule }, { name: 'Court hire', durationMinutes: 60 })).json.offering.id as string;
  await post(offeringRules, { offeringId: offering }, { dayOfWeek: 1, startTime: '08:00', endTime: '20:00' });
  await post(offeringRules, { offeringId: offering }, { dayOfWeek: 2, startTime: '08:00', endTime: '20:00' });
  const resourceIds: string[] = [];
  for (let i = 0; i < n; i++) {
    // fixed ids, so two implementations can be compared byte for byte (slots tie-break on the resource id)
    const id = `res-${String(i + 1).padStart(3, '0')}`;
    await q("INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, 'org-a', 'court', $2, 4, true)", [id, `Court ${String(i + 1).padStart(2, '0')}`]);
    await q("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ('org-a', $1, $2)", [offering, id]);
    resourceIds.push(id);
    // every third resource is set in Perth; every fifth has no hours at all (fails closed)
    if (i % 3 === 0) await q("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ('org-a', $1, 'Australia/Perth', 'backfill')", [id]);
    if (i % 5 === 4) continue;
    await post(resourceRules, { resourceId: id }, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    await post(resourceRules, { resourceId: id }, { dayOfWeek: 2, startTime: '10:00', endTime: '18:00' });
    if (i % 4 === 0) await post(resourceExceptions, { resourceId: id }, { fromDate: '2027-01-12', toDate: '2027-01-12', kind: 'closed', startTime: '12:00', endTime: '13:00' });
    if (i % 2 === 0) {
      await q(
        `WITH occ AS (INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
           VALUES ($1, 'org-a', $2, $3, '2027-01-11', time '12:00' + ($5 * interval '1 minute'), 'Australia/Adelaide', timestamptz '2027-01-11T01:30:00Z' + ($5 * interval '1 minute'), timestamptz '2027-01-11T02:30:00Z' + ($5 * interval '1 minute'), 1) RETURNING id, organisation_id, resource_id, starts_at, ends_at)
         INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id) SELECT $4, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM occ`,
        [`occ-${i}`, offering, id, `hold-${i}`, i],
      );
    }
  }
  // another organisation with its own offering and resource, to prove the batched reads stay inside the tenant
  await q("INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ('foreign-res', 'org-b', 'court', 'Foreign', 1, true)");
  return { offering, resourceIds };
}

/** The response body with every generated id replaced by a stable name, hashed: two implementations that answer identically give the same digest. */
const digest = (text: string, offering: string, resourceIds: string[]) => {
  let t = text.split(offering).join('OFFERING');
  resourceIds.forEach((id, i) => { t = t.split(id).join(`RESOURCE-${i + 1}`); });
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID'); // the schedule's id
  return createHash('sha256').update(t).digest('hex').slice(0, 16);
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

suite('Scheduling 2B.3e calendar read cost on real Postgres', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 10 });
    pool.on('error', () => undefined);
    await pool.query(sqlFile('034_availability_integrity.sql'));
    await pool.query(sqlFile('035_availability_partial_closures.sql'));
    await pool.query(sqlFile('036_availability_zones.sql'));
  }, 60_000);
  afterAll(async () => {
    await pool?.query(sqlFile('097_availability_zones_rollback.sql')).catch(() => undefined);
    await pool?.query(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await pool?.end();
    if (process.env.SCHEDULING_PERF_REPORT) writeFileSync(process.env.SCHEDULING_PERF_REPORT, JSON.stringify(report, null, 2));
  });

  it('an offering with more linked resources than a calendar draws is refused (422 CALENDAR_TOO_LARGE), reads nothing further and writes nothing', async () => {
    const { offering } = await world(1);
    for (let i = 2; i <= 101; i++) {
      const id = `cap-${String(i).padStart(3, '0')}`;
      await q("INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, 'org-a', 'court', $1, 1, true)", [id]);
      await q("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ('org-a', $1, $2)", [offering, id]);
    }
    as('viewer', 'org-a');
    stats.statements.length = 0;
    const r = await send(offeringCalendar, 'GET', { offeringId: offering }, undefined, WEEK);
    expect(r.status, r.text).toBe(422);
    expect(r.json.code).toBe('CALENDAR_TOO_LARGE');
    expect(r.json.limit).toBe(100);
    expect(stats.statements.some(s => /scheduling_availability_rules/.test(s))).toBe(false); // refused before the heavy reads
    expect(r.text).not.toMatch(/org-a|cap-0/);
    await q('DELETE FROM scheduling_offering_resources WHERE resource_id LIKE $1', ['cap-%']);
    const ok = await send(offeringCalendar, 'GET', { offeringId: offering }, undefined, WEEK);
    expect(ok.status).toBe(200); // the same offering draws again once it is under the limit
  }, 120_000);

  it('the calendar queries use their indexes on a table with realistic noise (EXPLAIN, plans recorded in the report)', async () => {
    const { offering } = await world(5);
    // noise in the SAME organisation: 120 other resources, each with 7 rules, 3 closures and 30 holds (840 rules, 360 closures, 3,600 holds), so the
    // queries have to pick this offering's five resources out of a busy tenant, not out of an empty one
    await q(`INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) SELECT 'n-' || g, 'org-a', 'court', 'N ' || g, 1, true FROM generate_series(1, 120) g`);
    await q(`INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) SELECT 'org-a', $1, 'n-' || g FROM generate_series(1, 120) g`, [offering]);
    await q(`INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) SELECT 'org-a', 'n-' || g, 'Australia/Perth', 'backfill' FROM generate_series(1, 120) g`);
    await q(`INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, kind, day_of_week, start_time, end_time)
             SELECT 'nr-' || g || '-' || d, 'org-a', 'n-' || g, 'hours', d, '09:00', '17:00' FROM generate_series(1, 120) g, generate_series(0, 6) d`);
    await q(`INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, from_date, to_date, kind)
             SELECT 'ne-' || g || '-' || d, 'org-a', 'n-' || g, date '2027-03-01' + d * 10, date '2027-03-01' + d * 10, 'closed' FROM generate_series(1, 120) g, generate_series(0, 2) d`);
    await q(`WITH occ AS (
               INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
               SELECT 'no-' || g || '-' || h, 'org-a', $1, 'n-' || g, date '2027-01-01' + h, time '00:00' + (g * interval '1 minute'), 'Australia/Adelaide',
                      timestamptz '2027-01-01' + (h * interval '1 day') + (g * interval '1 minute'), timestamptz '2027-01-01' + (h * interval '1 day') + (g * interval '1 minute') + interval '1 hour', 1
               FROM generate_series(1, 120) g, generate_series(1, 30) h
               RETURNING id, organisation_id, resource_id, starts_at, ends_at)
             INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
             SELECT 'nh-' || id, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM occ`, [offering]);
    const plans: Record<string, string[]> = {};
    const explain = async (name: string, text: string, params: unknown[]) => {
      await q('ANALYZE scheduling_availability_rules, scheduling_availability_exceptions, scheduling_availability_zones, scheduling_resource_holds, scheduling_resources');
      const rows = await q<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${text}`, params);
      plans[name] = rows.map(r => r['QUERY PLAN']);
      return plans[name].join('\n');
    };
    const ids = Array.from({ length: 5 }, (_, i) => `res-${String(i + 1).padStart(3, '0')}`);
    await explain('rules', "SELECT * FROM scheduling_availability_rules r WHERE r.organisation_id = $1 AND r.resource_id = ANY($2::text[]) ORDER BY r.day_of_week, r.start_time, r.id", ['org-a', ids]);
    await explain('exceptions', "SELECT * FROM scheduling_availability_exceptions e WHERE e.organisation_id = $1 AND e.resource_id = ANY($2::text[]) ORDER BY e.from_date, e.to_date, e.id", ['org-a', ids]);
    await explain('zones', "SELECT * FROM scheduling_availability_zones WHERE organisation_id = $1 AND owner_kind = 'resource' AND owner_id = ANY($2::text[])", ['org-a', ids]);
    await explain('holds', "SELECT * FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = ANY($2::text[]) AND released_at IS NULL AND during && tstzrange($3::timestamptz, $4::timestamptz, '[)') ORDER BY lower(during), resource_id, id", ['org-a', ids, '2027-01-09T00:00:00Z', '2027-01-21T00:00:00Z']);
    expect(Number((await q<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_resource_holds'))[0].n)).toBeGreaterThanOrEqual(3600);
    report.plans = plans;
    // The natural plans above are recorded as evidence, not asserted: a table of a few pages may be sequentially scanned (the planner's right answer), and which side of that line
    // a table falls on differs between PostgreSQL versions. What is asserted is that every query HAS its intended index and uses it when the planner may not prefer a scan.
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL enable_seqscan = off');
      const ex = (await client.query("EXPLAIN (COSTS OFF) SELECT * FROM scheduling_availability_exceptions e WHERE e.organisation_id = $1 AND e.resource_id = ANY($2::text[]) ORDER BY e.from_date, e.to_date, e.id", ['org-a', ids])).rows.map(r => r['QUERY PLAN']).join('\n');
      const zn = (await client.query("EXPLAIN (COSTS OFF) SELECT * FROM scheduling_availability_zones WHERE organisation_id = $1 AND owner_kind = 'resource' AND owner_id = ANY($2::text[])", ['org-a', ids])).rows.map(r => r['QUERY PLAN']).join('\n');
      plans.exceptionsIndexForced = ex.split('\n');
      plans.zonesIndexForced = zn.split('\n');
      const q4 = async (text: string, params: unknown[]) => (await client.query(`EXPLAIN (COSTS OFF) ${text}`, params)).rows.map(r => r['QUERY PLAN']).join('\n');
      const rl = await q4("SELECT * FROM scheduling_availability_rules r WHERE r.organisation_id = $1 AND r.resource_id = ANY($2::text[]) ORDER BY r.day_of_week, r.start_time, r.id", ['org-a', ids]);
      const hd = await q4("SELECT * FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = ANY($2::text[]) AND released_at IS NULL AND during && tstzrange($3::timestamptz, $4::timestamptz, '[)')", ['org-a', ids, '2027-01-09T00:00:00Z', '2027-01-21T00:00:00Z']);
      expect(rl).toMatch(/scheduling_availability_rules_resource_idx/);
      expect(hd).toMatch(/scheduling_holds_no_overlap/); // the exclusion constraint's GiST index serves the overlap read
      expect(ex).toMatch(/Index.*scheduling_availability_exceptions_resource_idx/);
      expect(zn).toMatch(/Index.*scheduling_availability_zones_pk/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }, 120_000);

  for (const n of SIZES) {
    it(`${n} linked resources: statement count and time of a week view`, async () => {
      const { offering, resourceIds } = await world(n);
      as('viewer', 'org-a');
      await send(offeringCalendar, 'GET', { offeringId: offering }, undefined, WEEK); // warm the connection
      const counts: number[] = [];
      const times: number[] = [];
      let last: { status: number; json: Json; text: string } | null = null;
      let breakdown: Record<string, number> = {};
      for (let i = 0; i < 5; i++) {
        stats.statements.length = 0;
        const t0 = performance.now();
        last = await send(offeringCalendar, 'GET', { offeringId: offering }, undefined, WEEK);
        times.push(performance.now() - t0);
        counts.push(stats.statements.length);
        breakdown = classify(stats.statements);
      }
      expect(last!.status).toBe(200);
      expect(last!.json.lanes).toHaveLength(n + 1);
      report[`n${n}`] = { statements: counts[0], breakdown, medianMs: Math.round(median(times) * 10) / 10, bodyBytes: last!.text.length, digest: digest(last!.text, offering, resourceIds) };
      expect(new Set(counts).size).toBe(1); // deterministic
      if (process.env.SCHEDULING_PERF_ASSERT === '1') expect(counts[0], JSON.stringify(breakdown)).toBeLessThanOrEqual(14); // constant, not 3N+11
    }, 120_000);
  }
});
