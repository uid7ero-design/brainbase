import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon, neonConfig } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';
import { TZ, slotBooking } from './support/builders';
import { GUARDED_BOOKING_SQL, SLOW_BUMP_SQL, SLOW_GUARDED_BOOKING_SQL } from './support/guardedBooking';
import { staff, uid } from './support/pgHarness';

// Migration 037 and the guarded booking statement through the REAL @neondatabase/serverless driver, over real HTTPS, to a DISPOSABLE Neon branch. No fetch shim, no local
// Postgres. It runs only when NEON_REHEARSAL_URL is set, and then ONLY against the rehearsal endpoint as the rehearsal role: anything else refuses to start, so it can never be
// pointed at Production by a wrong environment variable. Everything it writes carries its own organisation ids on the disposable branch, and it removes them afterwards.
//
// What this proves that the local shim does not: the request/response path through Neon's proxy and HTTP endpoint, Neon's own statement-per-request transaction behaviour,
// and what a client sees when it aborts or loses a response.

const URL_ = process.env.NEON_REHEARSAL_URL ?? '';
const EXPECTED_HOST = 'ep-orange-paper-a76x8m9p.ap-southeast-2.aws.neon.tech';
const suite = URL_ !== '' ? describe : describe.skip;

const ORG = 'neon-reh-a';
const OTHER = 'neon-reh-b';
const DAY = '2026-11-09'; // a Monday
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };

type Q = { query(text: string, params?: unknown[], opts?: Record<string, unknown>): Promise<unknown> };
let sql: Q;
let avail: PostgresAvailabilityRepository;
const rows = async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as Array<Record<string, unknown>>;
const tenant = staff(ORG);

interface Fx { schedule: string; offering: string; court: string }

async function fixture(org = ORG): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  const cfg = defaultScheduleConfig({ id: f.schedule, organisationId: org, name: 'rehearsal', presetKey: 'resource_hire' });
  await sql.query(
    `INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone) VALUES ($1, $2, $3, 'resource_hire', $4, NULL, $5::jsonb, $6::jsonb, NULL)`,
    [f.schedule, org, cfg.name, PRESETS.resource_hire.version, JSON.stringify(cfg.terminology), JSON.stringify(cfg.cancellationPolicy)],
  );
  await sql.query(`INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, 'rehearsal offering', NULL, 60, 0, 'AUD')`, [f.offering, org, f.schedule]);
  await sql.query(`INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, 'court', 'rehearsal court', 4, true)`, [f.court, org]);
  await sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);
  const t = staff(org);
  const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
  const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
  if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  return f;
}
const versions = async (f: Fx, org = ORG) => {
  const r = await rows(`SELECT owner_kind, version::text AS v FROM scheduling_availability_versions WHERE organisation_id = $1 AND ((owner_kind = 'offering' AND owner_id = $2) OR (owner_kind = 'resource' AND owner_id = $3))`, [org, f.offering, f.court]);
  return { offering: String(r.find(x => x.owner_kind === 'offering')?.v), resource: String(r.find(x => x.owner_kind === 'resource')?.v) };
};
const slot = (f: Fx, time = '10:00') => slotBooking(f.court, DAY, time, 60, { schedule: f.schedule, offering: f.offering }).instants;
const params = (f: Fx, v: { offering: string; resource: string }, w: { startsAt: string; endsAt: string }, key: string | null = null, org = ORG) => [org, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, w.startsAt, w.endsAt, key];
const book = (f: Fx, v: { offering: string; resource: string }, w: { startsAt: string; endsAt: string }, key: string | null = null) => sql.query(GUARDED_BOOKING_SQL, params(f, v, w, key)) as Promise<Array<Record<string, unknown>>>;
const live = async (f: Fx) => Number((await rows("SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 AND status <> 'cancelled'", [ORG, f.offering]))[0].n);
const holds = async (f: Fx) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL', [ORG, f.court]))[0].n);
const code = (e: unknown) => (e as { code?: string }).code;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const go = <T>(p: PromiseLike<T>): Promise<T> => Promise.resolve(p); // the driver's query objects are lazy thenables: this starts the request

suite('migration 037 and the guarded booking statement through the REAL Neon HTTP driver', () => {
  beforeAll(async () => {
    const u = new URL(URL_);
    if (u.host !== EXPECTED_HOST || u.username !== 'rehearsal_037') throw new Error('refusing to run: NEON_REHEARSAL_URL is not the rehearsal endpoint and role');
    sql = neon(URL_) as unknown as Q;
    const who = await rows('SELECT current_user AS u, current_database() AS d, (SELECT count(*)::int FROM scheduling_reservations) AS r');
    if (who[0].u !== 'rehearsal_037') throw new Error('refusing to run: not connected as the rehearsal role');
    avail = new PostgresAvailabilityRepository({ sql: fromNeonHttpLike(sql) });
    for (const org of [ORG, OTHER]) await sql.query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [org, 'Australia/Adelaide']);
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    // Only this suite's own organisations, on the disposable branch.
    for (const org of [ORG, OTHER]) {
      for (const t of ['scheduling_resource_holds', 'scheduling_reservations', 'scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_offering_resources']) {
        await sql.query(`DELETE FROM ${t} WHERE organisation_id = $1`, [org]).catch(() => undefined);
      }
    }
  }, 60_000);

  it('the driver reaches the rehearsal branch, which has migration 037 and no Production reservation', async () => {
    const r = await rows(`SELECT current_user AS u, version() AS pg, to_regclass('public.scheduling_availability_versions') IS NOT NULL AS has, (SELECT count(*)::int FROM scheduling_reservations WHERE organisation_id NOT IN ('${ORG}', '${OTHER}')) AS others`);
    expect(r[0]).toMatchObject({ u: 'rehearsal_037', has: true, others: 0 });
    expect(String(r[0].pg)).toMatch(/PostgreSQL 1[67]|PostgreSQL 18/);
  });

  it('current versions: the guarded statement is one request, writes the reservation and its hold, and stale versions write nothing', async () => {
    const f = await fixture();
    const v = await versions(f);
    const w = slot(f);
    expect(await book(f, v, w)).toHaveLength(1);
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
    const other = slot(f, '13:00');
    expect(await book(f, { offering: String(BigInt(v.offering) - BigInt(1)), resource: v.resource }, other)).toEqual([]);
    expect(await book(f, { offering: v.offering, resource: String(BigInt(v.resource) + BigInt(1)) }, other)).toEqual([]);
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
  });

  it('a closure that COMMITS BEFORE the booking makes the booking, which carries the old version, write nothing', async () => {
    const f = await fixture();
    const v = await versions(f); // read first, as the host must
    const closed = await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
    expect(closed.ok).toBe(true);
    expect(BigInt((await versions(f)).resource)).toBeGreaterThan(BigInt(v.resource));
    expect(await book(f, v, slot(f))).toEqual([]);
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
  });

  it('a booking that COMMITS FIRST is preserved, with its history, when the closure follows; the next booking on the old version is refused', async () => {
    const f = await fixture();
    const v = await versions(f);
    expect(await book(f, v, slot(f), 'first')).toHaveLength(1);
    const closed = await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
    expect(closed.ok).toBe(true);
    const kept = await rows("SELECT status, cancelled_at IS NULL AS untouched FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2", [ORG, f.offering]);
    expect(kept).toEqual([{ status: expect.stringMatching(/pending|confirmed/), untouched: true }]);
    expect(await holds(f)).toBe(1);
    expect(await book(f, v, slot(f, '14:00'))).toEqual([]);
  });

  it('RACE, writer first: a configuration write still committing makes a booking that arrives meanwhile wait, then write nothing', async () => {
    const f = await fixture();
    const v = await versions(f);
    const writer = go(sql.query(SLOW_BUMP_SQL(2), [ORG, 'resource', f.court]));
    await sleep(500); // the bump has run and holds the row
    const t0 = Date.now();
    const result = await book(f, v, slot(f));
    const waited = Date.now() - t0;
    await writer;
    expect(result).toEqual([]);
    expect(waited).toBeGreaterThan(900); // it really waited for the writer rather than racing it
    expect(await live(f)).toBe(0);
  }, 60_000);

  it('RACE, booking first: a booking still committing makes a configuration write wait for it, and the booking stands', async () => {
    const f = await fixture();
    const v = await versions(f);
    const slow = go(sql.query(SLOW_GUARDED_BOOKING_SQL(2), params(f, v, slot(f), 'slow-first')) as PromiseLike<unknown[]>);
    await sleep(500);
    const t0 = Date.now();
    const closed = await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
    const waited = Date.now() - t0;
    expect(await slow).toHaveLength(1);
    expect(closed.ok).toBe(true);
    expect(waited).toBeGreaterThan(900);
    expect(await live(f)).toBe(1);
    expect(await holds(f)).toBe(1);
  }, 60_000);

  it('deactivating the resource, or unlinking it, after the versions were read cannot be bypassed', async () => {
    const a = await fixture();
    const va = await versions(a);
    await sql.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, a.court]);
    expect(await book(a, va, slot(a))).toEqual([]);
    const b = await fixture();
    const vb = await versions(b);
    await sql.query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, b.offering, b.court]);
    expect(await book(b, vb, slot(b))).toEqual([]);
    // And with the fresh versions the inactive resource is still refused (the active predicate, not only the version).
    expect(await book(a, await versions(a), slot(a))).toEqual([]);
    expect([await live(a), await live(b)]).toEqual([0, 0]);
  });

  it('8 parallel requests for the same overlapping slot: exactly one wins and the rest are refused by the exclusion constraint (23P01)', async () => {
    const f = await fixture();
    const v = await versions(f);
    const w = slot(f);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => book(f, v, w)));
    const won = results.filter(r => r.status === 'fulfilled' && (r.value as unknown[]).length === 1);
    const lost = results.filter(r => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(7);
    for (const l of lost) expect(code((l as PromiseRejectedResult).reason)).toBe('23P01');
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
  }, 60_000);

  it('idempotent retries: 6 concurrent requests with one key make one reservation; a later retry finds it by key and writes nothing', async () => {
    const f = await fixture();
    const v = await versions(f);
    const w = slot(f);
    const key = uid('idem');
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => book(f, v, w, key)));
    const wrote = results.filter(r => r.status === 'fulfilled' && (r.value as unknown[]).length === 1).length;
    expect(wrote).toBe(1);
    for (const r of results) if (r.status === 'rejected') expect(['23P01', '23505']).toContain(code(r.reason));
    expect(await book(f, await versions(f), w, key)).toEqual([]);
    const found = await rows('SELECT id FROM scheduling_reservations WHERE organisation_id = $1 AND idempotency_key = $2', [ORG, key]);
    expect(found).toHaveLength(1);
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
  }, 60_000);

  it('another organisation cannot book, or move a version of, this organisation\'s owners', async () => {
    const f = await fixture();
    const v = await versions(f);
    expect(await sql.query(GUARDED_BOOKING_SQL, params(f, v, slot(f), null, OTHER))).toEqual([]);
    const before = await versions(f);
    const theirs = await fixture(OTHER);
    await avail.createException(staff(OTHER), { kind: 'resource', id: theirs.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
    expect(await versions(f)).toEqual(before);
    await expect(sql.query('INSERT INTO scheduling_availability_versions (organisation_id, offering_id) VALUES ($1, $2)', [OTHER, f.offering])).rejects.toMatchObject({ code: '23503' });
    expect([await live(f)]).toEqual([0]);
  });

  describe('a client that aborts or loses the response does not learn that nothing happened', () => {
    it('ABORT mid-statement: the client sees an error and learns nothing; whichever way the server went, a retry with the same key leaves exactly ONE reservation', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = slot(f);
      const key = uid('abort');
      const ac = new AbortController();
      const pending = sql.query(SLOW_GUARDED_BOOKING_SQL(2), params(f, v, w, key), { fetchOptions: { signal: ac.signal } });
      const outcome = Promise.allSettled([pending]);
      await sleep(600);
      ac.abort();
      const [settled] = await outcome;
      expect(settled.status).toBe('rejected'); // the client saw an error ...
      await sleep(4000); // ... and gives the server time to finish, or to have cancelled, whatever it does
      const afterAbort = await live(f);
      // OBSERVED on Neon's HTTP endpoint (recorded in the report): an abort during execution cancels the statement, so nothing was written. The test does not depend on that:
      // it is 0 or 1, never more, and the retry below must converge on exactly one either way.
      expect([0, 1]).toContain(afterAbort);
      console.log('[neon-abort] reservations after client abort mid-statement:', afterAbort);
      const retry = await book(f, await versions(f), w, key);
      expect(retry).toHaveLength(afterAbort === 0 ? 1 : 0);
      expect(await rows('SELECT id FROM scheduling_reservations WHERE organisation_id = $1 AND idempotency_key = $2', [ORG, key])).toHaveLength(1);
      expect([await live(f), await holds(f)]).toEqual([1, 1]);
    }, 60_000);

    it('LOST RESPONSE: the request reaches Neon and commits, the client sees a network error, and the idempotency key resolves it without a duplicate', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = slot(f);
      const key = uid('lost');
      const real = neonConfig.fetchFunction as typeof fetch | undefined;
      const sender = real ?? fetch;
      neonConfig.fetchFunction = async (...args: Parameters<typeof fetch>) => {
        const response = await sender(...args);
        await response.arrayBuffer(); // the server answered; the client never gets to use it
        throw new TypeError('fetch failed (simulated: connection reset after the request was sent)');
      };
      let seen: unknown = null;
      try {
        const lossy = neon(URL_) as unknown as Q;
        await lossy.query(GUARDED_BOOKING_SQL, params(f, v, w, key));
      } catch (err) {
        seen = err;
      } finally {
        neonConfig.fetchFunction = real;
      }
      expect(String((seen as Error)?.message ?? seen)).toMatch(/fetch failed|NeonDbError|network/i);
      // The client cannot tell. Asking by key can.
      const byKey = await rows('SELECT id, status FROM scheduling_reservations WHERE organisation_id = $1 AND idempotency_key = $2', [ORG, key]);
      expect(byKey).toHaveLength(1);
      expect(await book(f, await versions(f), w, key)).toEqual([]);
      expect([await live(f), await holds(f)]).toEqual([1, 1]);
    }, 60_000);
  });
});

