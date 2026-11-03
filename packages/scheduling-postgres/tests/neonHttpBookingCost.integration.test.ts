import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';
import { TZ, slotBooking } from './support/builders';
import { GUARDED_BOOKING_TOKEN_SQL } from './support/guardedBooking';
import { staff, uid } from './support/pgHarness';

// BOOKING COST MEASUREMENTS through the REAL @neondatabase/serverless HTTP driver, against a DISPOSABLE Neon branch only. Opt-in: skipped unless NEON_REHEARSAL_URL is set.
// It MEASURES and prints (`[perf] ...` lines); its only assertions are sanity bounds so a regression of an order of magnitude is visible. Same safety contract as
// neonHttpBookingGates.integration.test.ts: NEON_REHEARSAL_HOST must name the endpoint, the role must be rehearsal_037, synthetic organisation only, removed afterwards.
// Numbers are evidence about THAT branch's compute, region and moment. They are not Production measurements and must be labelled as such.

const URL_ = process.env.NEON_REHEARSAL_URL ?? '';
const EXPECTED_HOST = process.env.NEON_REHEARSAL_HOST ?? '';
const suite = URL_ !== '' ? describe : describe.skip;
const ORG = 'neon-cost-a';
const DAYS = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18']; // Mondays
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '00:00', endTime: '23:59', validFrom: null, validTo: null };

type Q = { query(text: string, params?: unknown[]): Promise<unknown> };
let sql: Q;
let avail: PostgresAvailabilityRepository;
const rows = async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as Array<Record<string, unknown>>;
const go = <T>(p: PromiseLike<T>): Promise<T> => Promise.resolve(p);
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
};
const fmt = (label: string, xs: number[]) => console.log(`[perf] ${label} ms ${JSON.stringify(stats(xs))}`);
async function time<T>(fn: () => Promise<T>) {
  const t0 = performance.now();
  const r = await fn();
  return { ms: performance.now() - t0, r };
}

interface Fx { schedule: string; offering: string; court: string }
async function fixture(): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  const cfg = defaultScheduleConfig({ id: f.schedule, organisationId: ORG, name: 'cost', presetKey: 'resource_hire' });
  await sql.query(`INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone) VALUES ($1, $2, $3, 'resource_hire', $4, NULL, $5::jsonb, $6::jsonb, NULL)`, [f.schedule, ORG, cfg.name, PRESETS.resource_hire.version, JSON.stringify(cfg.terminology), JSON.stringify(cfg.cancellationPolicy)]);
  await sql.query(`INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, 'cost offering', NULL, 60, 0, 'AUD')`, [f.offering, ORG, f.schedule]);
  await sql.query(`INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, 'court', 'cost court', 4, true)`, [f.court, ORG]);
  await sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, f.offering, f.court]);
  const t = staff(ORG);
  const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
  const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
  if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  return f;
}
const VERSIONS_SQL = `SELECT owner_kind, version::text AS v FROM scheduling_availability_versions WHERE organisation_id = $1 AND ((owner_kind = 'offering' AND owner_id = $2) OR (owner_kind = 'resource' AND owner_id = $3))`;
const ISO = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function reads(f: Fx) {
  const v = await rows(VERSIONS_SQL, [ORG, f.offering, f.court]);
  const t = await rows(`SELECT ${ISO} AS t FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2`, [ORG, f.offering]);
  return { offering: String(v.find(x => x.owner_kind === 'offering')!.v), resource: String(v.find(x => x.owner_kind === 'resource')!.v), token: String(t[0].t) };
}
const win = (f: Fx, day: string, time: string, minutes = 60) => slotBooking(f.court, day, time, minutes, { schedule: f.schedule, offering: f.offering }).instants;
const bookParams = (f: Fx, r: Awaited<ReturnType<typeof reads>>, w: { startsAt: string; endsAt: string }, key: string | null = null) => [ORG, f.offering, r.offering, f.court, r.resource, uid('res'), uid('hold'), f.schedule, w.startsAt, w.endsAt, key, r.token];

suite('booking cost through the real Neon HTTP driver (disposable branch)', () => {
  beforeAll(async () => {
    const u = new URL(URL_);
    if (EXPECTED_HOST === '' || u.host !== EXPECTED_HOST || u.username !== 'rehearsal_037') throw new Error('refusing to run: NEON_REHEARSAL_HOST must name the endpoint, and the role must be rehearsal_037');
    sql = neon(URL_) as unknown as Q;
    const who = await rows(`SELECT current_user AS u, to_regclass('public.scheduling_availability_versions') IS NOT NULL AS has`);
    if (who[0].u !== 'rehearsal_037' || who[0].has !== true) throw new Error('refusing to run: not the rehearsal role, or 037 not applied');
    avail = new PostgresAvailabilityRepository({ sql: fromNeonHttpLike(sql as never) });
    await sql.query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [ORG, 'Australia/Adelaide']);
    for (let i = 0; i < 5; i++) await sql.query('SELECT 1'); // warm the compute and the connection path
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    for (const t of ['scheduling_resource_holds', 'scheduling_reservations', 'scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_offering_resources', 'scheduling_offerings', 'scheduling_resources', 'scheduling_schedules']) {
      await sql.query(`DELETE FROM ${t} WHERE organisation_id = $1`, [ORG]).catch(() => undefined);
    }
    await sql.query('DELETE FROM organisations WHERE id = $1', [ORG]).catch(() => undefined);
  }, 60_000);

  it('round trips: SELECT 1 (the floor), the version + token reads, and the server-side cost of scheduling_is_timezone()', async () => {
    const f = await fixture();
    const ping: number[] = [], ver: number[] = [], tzc: number[] = [];
    for (let i = 0; i < 20; i++) ping.push((await time(() => sql.query('SELECT 1'))).ms);
    for (let i = 0; i < 20; i++) ver.push((await time(() => rows(VERSIONS_SQL, [ORG, f.offering, f.court]))).ms);
    for (let i = 0; i < 20; i++) tzc.push((await time(() => sql.query("SELECT scheduling_is_timezone('Australia/Adelaide')"))).ms);
    fmt('SELECT 1 round trip', ping);
    fmt('version lookup round trip (2 owners, PK)', ver);
    fmt('scheduling_is_timezone() round trip', tzc);
    // Server-side execution time (no network): 1 call, then 50 calls in one statement.
    const one = JSON.parse(JSON.stringify((await rows("EXPLAIN (ANALYZE, FORMAT JSON) SELECT scheduling_is_timezone('Australia/Adelaide')"))[0]['QUERY PLAN']))[0];
    // The argument must VARY per row: with a constant argument PostgreSQL evaluates a STABLE function once and the "per call" figure is a fiction (0.05 ms instead of ~12 ms).
    const many = JSON.parse(JSON.stringify((await rows("EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM generate_series(1, 50) g WHERE scheduling_is_timezone((ARRAY['Australia/Adelaide','Australia/Perth'])[1 + g % 2])"))[0]['QUERY PLAN']))[0];
    const verPlan = JSON.parse(JSON.stringify((await rows(`EXPLAIN (ANALYZE, FORMAT JSON) ${VERSIONS_SQL.replace(/\$1/g, `'${ORG}'`).replace(/\$2/g, `'${f.offering}'`).replace(/\$3/g, `'${f.court}'`)}`))[0]['QUERY PLAN']))[0];
    console.log(`[perf] server: scheduling_is_timezone x1 ${one['Execution Time']} ms (planning ${one['Planning Time']}); x50 with varying arguments in one statement ${many['Execution Time']} ms => ${(many['Execution Time'] / 50).toFixed(3)} ms per call`);
    console.log(`[perf] server: version lookup execution ${verPlan['Execution Time']} ms (planning ${verPlan['Planning Time']})`);
    expect(stats(ping).median).toBeLessThan(2000);
  }, 120_000);

  it('the guarded statement: client round trip, and server-side execution with per-trigger time (EXPLAIN ANALYZE of the statement itself, on synthetic data)', async () => {
    const f = await fixture();
    const wall: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await reads(f);
      const { ms, r: out } = await time(() => sql.query(GUARDED_BOOKING_TOKEN_SQL, bookParams(f, r, win(f, DAYS[i], '10:00'))));
      expect((out as unknown[]).length).toBe(1);
      wall.push(ms);
    }
    fmt('guarded booking statement round trip (booked)', wall);
    // The same statement under EXPLAIN (ANALYZE): it executes (and commits) one more booking, which is why this runs on a disposable branch only.
    const r = await reads(f);
    const plan = JSON.parse(JSON.stringify((await rows(`EXPLAIN (ANALYZE, FORMAT JSON) ${GUARDED_BOOKING_TOKEN_SQL}`, bookParams(f, r, win(f, DAYS[0], '14:00'))))[0]['QUERY PLAN']))[0];
    const triggers = (plan['Triggers'] ?? []).map((t: { 'Trigger Name': string; Time: number; Calls: number }) => `${t['Trigger Name']}=${t.Time}ms x${t.Calls}`);
    console.log(`[perf] server: guarded statement execution ${plan['Execution Time']} ms (planning ${plan['Planning Time']}); triggers: ${triggers.join(' | ')}`);
    // A refused (stale) statement is cheaper: it stops at the lock CTE.
    const stale: number[] = [];
    for (let i = 0; i < 8; i++) {
      const rr = await reads(f);
      const p = bookParams(f, { ...rr, offering: String(Number(rr.offering) - 1) }, win(f, DAYS[i], '16:00'));
      const { ms, r: out } = await time(() => sql.query(GUARDED_BOOKING_TOKEN_SQL, p));
      expect(out as unknown[]).toEqual([]);
      stale.push(ms);
    }
    fmt('guarded booking statement round trip (stale version, refused)', stale);
    expect(stats(wall).median).toBeLessThan(3000);
  }, 120_000);

  it('contention: 8 parallel bookings on ONE court at distinct times (they share the version rows FOR SHARE; the hold advisory lock serialises only the insert) versus 8 courts', async () => {
    const f = await fixture();
    const r = await reads(f);
    const t1 = performance.now();
    const same = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => go(sql.query(GUARDED_BOOKING_TOKEN_SQL, bookParams(f, r, win(f, DAYS[i], '09:00'))))));
    const sameMs = performance.now() - t1;
    expect(same.every(x => x.status === 'fulfilled' && (x.value as unknown[]).length === 1)).toBe(true);
    const fs = await Promise.all(Array.from({ length: 8 }, () => fixture()));
    const rs = await Promise.all(fs.map(reads));
    const t2 = performance.now();
    const diff = await Promise.allSettled(fs.map((g, i) => go(sql.query(GUARDED_BOOKING_TOKEN_SQL, bookParams(g, rs[i], win(g, DAYS[0], '09:00'))))));
    const diffMs = performance.now() - t2;
    expect(diff.every(x => x.status === 'fulfilled' && (x.value as unknown[]).length === 1)).toBe(true);
    // A single booking for scale.
    const solo = await time(() => sql.query(GUARDED_BOOKING_TOKEN_SQL, bookParams(f, r, win(f, DAYS[9], '09:00'))));
    console.log(`[perf] contention: 8 parallel bookings, one court: ${sameMs.toFixed(0)} ms wall; 8 parallel bookings, 8 courts: ${diffMs.toFixed(0)} ms wall; one booking alone: ${solo.ms.toFixed(0)} ms`);
    // Locks taken: no waiter should be left behind.
    const waiting = await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    console.log(`[perf] lock waiters after the run: ${waiting[0].n}`);
    expect(Number(waiting[0].n)).toBe(0);
  }, 120_000);
});
