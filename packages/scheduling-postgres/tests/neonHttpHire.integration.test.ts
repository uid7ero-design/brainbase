import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig, resolveLocalTime, type HireFailure, type HireRequest, type HireResult } from '@scheduling/core';
import { PostgresAvailabilityRepository, PostgresHireRepository, PostgresReservationRepository, fromNeonHttpLike, type SqlExecutor, type SqlStatement } from '@scheduling/postgres';
import { TZ } from './support/builders';
import { FixedClock, staff, uid } from './support/pgHarness';

// createHire through the REAL @neondatabase/serverless HTTP driver, against a DISPOSABLE Neon branch only. Opt-in: skipped unless NEON_REHEARSAL_URL is set.
//
// SAFETY (the same guard as neonHttpBookingGates): the suite refuses to run unless NEON_REHEARSAL_HOST equals the host of NEON_REHEARSAL_URL, the login role is exactly rehearsal_037
// (a role that exists only on a disposable branch; never the application role), and migration 037 is present. It writes only synthetic organisations (neon-hire-a, neon-hire-b) and
// removes them afterwards. A pilot organisation can be named with NEON_REHEARSAL_PILOT_ORG: it is READ, never written, and compared before and after. No credential is stored here.
//
// What this adds over the PostgreSQL 16/17 suite: the driver's real behaviour. One HTTP request per statement, `sql.transaction([...])` as the only atomic batch, a client abort
// that cancels the statement, a reply that can be lost after the commit, and transaction-local timeouts through the driver.

const URL_ = process.env.NEON_REHEARSAL_URL ?? '';
const EXPECTED_HOST = process.env.NEON_REHEARSAL_HOST ?? '';
const PILOT = process.env.NEON_REHEARSAL_PILOT_ORG ?? '';
const suite = URL_ !== '' ? describe : describe.skip;

const ORG = 'neon-hire-a';
const OTHER = 'neon-hire-b';
const DAY = '2026-11-16'; // a Monday, ACDT
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };
const clock = new FixedClock(new Date('2026-11-02T00:00:00Z'));
const tenant = staff(ORG);

type Q = { query(text: string, params?: unknown[], opts?: Record<string, unknown>): Promise<unknown>; transaction: (q: unknown[], o?: Record<string, unknown>) => Promise<unknown[]> };
let sql: Q;
let exec: SqlExecutor;
let avail: PostgresAvailabilityRepository;
let hire: PostgresHireRepository;
let reservations: PostgresReservationRepository;
const rows = async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as Array<Record<string, unknown>>;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
interface Fx { schedule: string; offering: string; court: string }

async function fixture(org = ORG, rules = true): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  const cfg = defaultScheduleConfig({ id: f.schedule, organisationId: org, name: 'neon hire', presetKey: 'resource_hire' });
  await sql.query(
    `INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone) VALUES ($1, $2, $3, 'resource_hire', $4, NULL, $5::jsonb, $6::jsonb, NULL)`,
    [f.schedule, org, cfg.name, PRESETS.resource_hire.version, JSON.stringify(cfg.terminology), JSON.stringify(cfg.cancellationPolicy)],
  );
  await sql.query(`INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, 'neon hire offering', NULL, 60, 5000, 'AUD')`, [f.offering, org, f.schedule]);
  await sql.query(`INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, 'court', 'neon hire court', 4, true)`, [f.court, org]);
  await sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);
  if (rules) {
    const t = staff(org);
    const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
    const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
    if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  }
  return f;
}
let keySeq = 0;
const newKey = () => `neon-hire-${String(++keySeq).padStart(5, '0')}-${Math.random().toString(36).slice(2, 10)}`;
const req = (f: Fx, over: Partial<HireRequest> = {}): HireRequest => ({
  idempotencyKey: newKey(), offeringId: f.offering, resourceId: f.court, start: { date: DAY, time: '10:00' }, partySize: 2, customer: { name: 'Neon Hirer', email: 'neon@example.com' }, ...over,
});
const total = async (f: Fx, org = ORG) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2', [org, f.offering]))[0].n);
const holds = async (f: Fx, org = ORG) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL', [org, f.court]))[0].n);
const fail = (r: HireResult): HireFailure => {
  if (r.ok) throw new Error('expected a failure');
  return r;
};
const ok = (r: HireResult) => {
  if (!r.ok) throw new Error(`expected a reservation, got ${r.code}: ${r.message}`);
  return r;
};

interface Hooks { beforeWrite?: () => Promise<void>; transform?: (s: readonly SqlStatement[]) => readonly SqlStatement[]; loseReply?: Error }
function hooked(real: SqlExecutor, hooks: Hooks): SqlExecutor {
  return {
    query: (t, p) => real.query(t, p),
    async transaction(statements) {
      if (hooks.beforeWrite) await hooks.beforeWrite();
      const out = await real.transaction!(hooks.transform ? hooks.transform(statements) : statements);
      if (hooks.loseReply) throw hooks.loseReply;
      return out;
    },
  };
}
const repoWith = (hooks: Hooks, extra: Partial<ConstructorParameters<typeof PostgresHireRepository>[0]> = {}) => new PostgresHireRepository({ sql: hooked(exec, hooks), clock, sleep: async () => undefined, ...extra });
const slow = (seconds: number) => (statements: readonly SqlStatement[]) =>
  statements.map(s => {
    if (!s.text.includes('WITH ls AS')) return s;
    const at = s.text.lastIndexOf('FROM res r');
    return { ...s, text: `/* slow-neon-hire */ ${s.text.slice(0, at)}FROM res r, (SELECT pg_sleep(${seconds})) z` };
  });
async function waitForBackend(marker: string) {
  for (let i = 0; i < 400; i++) {
    const r = await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND wait_event = 'PgSleep' AND query LIKE $1 AND pid <> pg_backend_pid()", [`%${marker}%`]);
    if (Number(r[0].n) > 0) return;
    await sleep(25);
  }
  throw new Error(`never observed a sleeping backend for ${marker}`);
}

const PILOT_SNAPSHOT_SQL = `SELECT
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_availability_rules r WHERE organisation_id = $1) AS rules,
  (SELECT md5(string_agg(v::text, '|' ORDER BY owner_kind, owner_id)) FROM scheduling_availability_versions v WHERE organisation_id = $1) AS versions,
  (SELECT count(*)::int FROM scheduling_reservations WHERE organisation_id = $1) AS reservations,
  (SELECT count(*)::int FROM scheduling_resource_holds WHERE organisation_id = $1) AS holds`;
// Everything that is NOT one of this suite's two synthetic organisations (the Production-data copy, including the pilot): read before and after, never written.
const OTHERS_SNAPSHOT_SQL = `SELECT
  (SELECT count(*)::int FROM scheduling_reservations WHERE organisation_id NOT IN ($1, $2)) AS reservations,
  (SELECT count(*)::int FROM scheduling_resource_holds WHERE organisation_id NOT IN ($1, $2)) AS holds,
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_availability_rules r WHERE organisation_id NOT IN ($1, $2)) AS rules,
  (SELECT md5(string_agg(v::text, '|' ORDER BY organisation_id, owner_kind, owner_id)) FROM scheduling_availability_versions v WHERE organisation_id NOT IN ($1, $2)) AS versions`;
let pilotBefore: Record<string, unknown>;
let othersBefore: Record<string, unknown>;

suite('createHire through the REAL Neon HTTP driver', () => {
  beforeAll(async () => {
    const u = new URL(URL_);
    if (EXPECTED_HOST === '' || u.host !== EXPECTED_HOST || u.username !== 'rehearsal_037') throw new Error('refusing to run: NEON_REHEARSAL_HOST must name the endpoint, and the role must be rehearsal_037');
    sql = neon(URL_) as unknown as Q;
    const who = await rows(`SELECT current_user AS u, to_regclass('public.scheduling_availability_versions') IS NOT NULL AS has`);
    if (who[0].u !== 'rehearsal_037' || who[0].has !== true) throw new Error('refusing to run: not the rehearsal role, or 037 not applied');
    exec = fromNeonHttpLike(sql as never);
    avail = new PostgresAvailabilityRepository({ sql: exec });
    hire = new PostgresHireRepository({ sql: exec, clock, sleep: async () => undefined });
    reservations = new PostgresReservationRepository({ sql: exec, clock });
    for (const org of [ORG, OTHER]) await sql.query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [org, TZ]);
    pilotBefore = PILOT === '' ? {} : (await rows(PILOT_SNAPSHOT_SQL, [PILOT]))[0];
    othersBefore = (await rows(OTHERS_SNAPSHOT_SQL, [ORG, OTHER]))[0];
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    for (const org of [ORG, OTHER]) {
      for (const t of ['scheduling_resource_holds', 'scheduling_reservations', 'scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_offering_resources', 'scheduling_offerings', 'scheduling_resources', 'scheduling_schedules']) {
        await sql.query(`DELETE FROM ${t} WHERE organisation_id = $1`, [org]).catch(() => undefined);
      }
      await sql.query('DELETE FROM organisations WHERE id = $1', [org]).catch(() => undefined);
    }
  }, 60_000);

  it('the driver adapter exposes a transaction, so createHire can bound its own waiting', () => {
    expect(typeof exec.transaction).toBe('function');
  });

  it('A: books the reservation and its hold together, and replays the same key without writing', async () => {
    const f = await fixture();
    const request = req(f);
    const a = ok(await hire.createHire(tenant, request));
    expect(a).toMatchObject({ replayed: false, attempts: 1 });
    expect(a.reservation).toMatchObject({ presetKey: 'resource_hire', price: { amountCents: 5000, currency: 'AUD' }, span: { kind: 'slot', date: DAY, startTime: '10:00', durationMinutes: 60 } });
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
    const b = ok(await hire.createHire(tenant, request));
    expect(b).toMatchObject({ replayed: true });
    expect(b.reservation.id).toBe(a.reservation.id);
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
  });

  it('B: eight parallel requests for the same window on one court: exactly one wins, the rest are resource_conflict, one hold', async () => {
    const f = await fixture();
    const results = await Promise.all(['10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00'].map(time => hire.createHire(tenant, req(f, { start: { date: DAY, time } }))));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    for (const r of results.filter(r => !r.ok)) expect(['resource_conflict']).toContain(fail(r).code);
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
  });

  it('C: six parallel calls with the same key create one reservation; all six are answered with it', async () => {
    const f = await fixture();
    const request = req(f);
    const results = await Promise.all(Array.from({ length: 6 }, () => hire.createHire(tenant, request)));
    expect(results.every(r => r.ok)).toBe(true);
    expect(new Set(results.map(r => (r as { reservation: { id: string } }).reservation.id)).size).toBe(1);
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
  });

  it.each([
    ['the offering renamed', (f: Fx) => rows("UPDATE scheduling_offerings SET name = 'renamed' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering])],
    ['the offering duration edited', (f: Fx) => rows('UPDATE scheduling_offerings SET duration_minutes = 90 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering])],
    ['the schedule edited', (f: Fx) => rows("UPDATE scheduling_schedules SET name = 'renamed' WHERE organisation_id = $1 AND id = $2", [ORG, f.schedule])],
    ['a closure added to the resource', (f: Fx) => avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: 'x' }, TZ)],
    ['the resource switched off', (f: Fx) => rows('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court])],
  ])('D: %s between the decision and the write -> availability_changed, nothing written', async (_name, change) => {
    const f = await fixture();
    const racing = repoWith({ beforeWrite: async () => void (await change(f)) });
    const r = fail(await racing.createHire(tenant, req(f)));
    expect(r.code).toBe('availability_changed');
    expect([await total(f), await holds(f)]).toEqual([0, 0]);
  });

  it('E: statement_timeout set with set_config(..., true) in the same batch cancels the booking (57014 -> contention_timeout), writes nothing, is not retried, and does not leak', async () => {
    const f = await fixture();
    const repo = repoWith({ transform: slow(4) }, { statementTimeoutMs: 700, maxAttempts: 3 });
    const r = fail(await repo.createHire(tenant, req(f)));
    expect(r).toMatchObject({ code: 'contention_timeout', retryable: true, attempts: 1 });
    expect([await total(f), await holds(f)]).toEqual([0, 0]);
    for (let i = 0; i < 4; i++) expect((await rows("SELECT current_setting('statement_timeout') AS s, current_setting('lock_timeout') AS l"))[0]).toEqual({ s: '0', l: '0' });
    ok(await hire.createHire(tenant, req(f))); // the next, unbounded-by-test request still works
  }, 30_000);

  it('F: lock_timeout behind a configuration writer that holds the offering row -> contention_timeout (retried within bounds), nothing written', async () => {
    const f = await fixture();
    // a writer as one batch: it updates the offering row and then keeps its transaction open for 3 seconds
    const writer = go(sql.transaction([sql.query(`/* neon-hire-writer */ UPDATE scheduling_offerings SET name = 'held' WHERE organisation_id = $1 AND id = $2`, [ORG, f.offering]), sql.query('/* neon-hire-writer */ SELECT pg_sleep(3)')]));
    await waitForBackend('neon-hire-writer');
    const repo = new PostgresHireRepository({ sql: exec, clock, lockTimeoutMs: 400, maxAttempts: 2, sleep: async () => undefined });
    const r = fail(await repo.createHire(tenant, req(f)));
    expect(r).toMatchObject({ code: 'contention_timeout', family: 'transient', retryable: true });
    expect([await total(f), await holds(f)]).toEqual([0, 0]);
    await writer;
    ok(await hire.createHire(tenant, req(f))); // once the writer is done the same kind of request books
  }, 40_000);

  it('G: the reply is lost after the commit (a dropped response): found by its key and returned as recovered; asking again replays', async () => {
    const f = await fixture();
    const request = req(f);
    const lost = repoWith({ loseReply: new Error('fetch failed') });
    const r = ok(await lost.createHire(tenant, request));
    expect(r).toMatchObject({ replayed: false, recovered: true });
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
    expect(ok(await hire.createHire(tenant, request)).replayed).toBe(true);
    expect(await total(f)).toBe(1);
  });

  it('H: a client abort while the booking runs cancels the statement; the outcome is unknown to the caller and is resolved by the key, never by guessing', async () => {
    const f = await fixture();
    const request = req(f);
    const controller = new AbortController();
    const abortable = new PostgresHireRepository({ sql: hooked(fromNeonHttpLike(sql as never, { queryOptions: { fetchOptions: { signal: controller.signal } } }), { transform: slow(3) }), clock, sleep: async () => undefined });
    const running = go(abortable.createHire(tenant, request));
    await waitForBackend('slow-neon-hire');
    controller.abort();
    const r = await running;
    expect(r.ok === false && r.code === 'outcome_unknown').toBe(true);
    expect(r.ok === false && r.retryable).toBe(true);
    const afterAbort = await total(f); // measured on the preflight branch: an abort cancels the statement. Whichever it is, the key resolves it:
    console.log(`[neon hire] after a client abort the booking was ${afterAbort === 1 ? 'COMMITTED' : 'NOT written (statement cancelled)'}`);
    const again = ok(await hire.createHire(tenant, request));
    expect(again.replayed).toBe(afterAbort === 1);
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
  }, 40_000);

  it("I: another organisation's ids are not found; keys are tenant-scoped; nothing lands in the other organisation", async () => {
    const mine = await fixture(ORG);
    const theirs = await fixture(OTHER);
    expect(fail(await hire.createHire(tenant, req(theirs))).code).toBe('not_found');
    expect(fail(await hire.createHire(tenant, req(mine, { resourceId: theirs.court }))).code).toBe('not_found');
    const key = newKey();
    const a = ok(await hire.createHire(tenant, req(mine, { idempotencyKey: key })));
    const b = ok(await hire.createHire(staff(OTHER), req(theirs, { idempotencyKey: key })));
    expect(a.reservation.id).not.toBe(b.reservation.id);
    expect(await total(mine)).toBe(1);
    expect(await total(theirs, OTHER)).toBe(1);
    expect(await hire.findHireByKey(staff(OTHER), key).then(r => r?.id)).toBe(b.reservation.id);
  });

  it('J: cancelling releases the hold in the same statement and the time books again under a new key; the cancelled row keeps its snapshot', async () => {
    const f = await fixture();
    const made = ok(await hire.createHire(tenant, req(f))).reservation;
    const out = await reservations.cancel(tenant, { reservationId: made.id, cancelledBy: 'staff', reason: 'rang', scope: 'this_occurrence' });
    expect(out.status).toBe('cancelled');
    expect(await holds(f)).toBe(0);
    ok(await hire.createHire(tenant, req(f)));
    expect([await total(f), await holds(f)]).toEqual([2, 1]);
    const kept = (await rows('SELECT status, cancelled_by, customer_name FROM scheduling_reservations WHERE id = $1', [made.id]))[0];
    expect(kept).toEqual({ status: 'cancelled', cancelled_by: 'staff', customer_name: 'Neon Hirer' });
  });

  it('K: daylight saving through the driver: a nonexistent local time is refused; the instants of the starts around the gap are right', async () => {
    const f = await fixture(ORG, false);
    const sunday = { kind: 'hours' as const, label: null, dayOfWeek: 0, startTime: '00:00', endTime: '06:00', validFrom: null, validTo: null };
    for (const owner of [{ kind: 'offering' as const, id: f.offering }, { kind: 'resource' as const, id: f.court }]) {
      const r = await avail.createRule(tenant, owner, sunday, TZ);
      if (!r.ok) throw new Error(`sunday rule: ${JSON.stringify(r)}`);
    }
    const early = new PostgresHireRepository({ sql: exec, clock: new FixedClock(new Date('2026-09-01T00:00:00Z')), sleep: async () => undefined });
    expect(fail(await early.createHire(tenant, req(f, { start: { date: '2026-10-04', time: '02:30' } }))).code).toBe('nonexistent_local_time');
    const after = ok(await early.createHire(tenant, req(f, { start: { date: '2026-10-04', time: '04:00' } })));
    expect(after.reservation.instants.startsAt).toBe(resolveLocalTime('2026-10-04', '04:00', TZ).instant);
    expect(after.reservation.instants.startsAt).toBe('2026-10-03T17:30:00Z');
  });

  it('M: mixed stress through the driver - hires racing configuration writers (closures, link toggles, rename, deactivate): zero deadlocks, no overlapping live holds, one reservation and one hold per successful key', async () => {
    const f = await fixture();
    const end = Date.now() + 5000;
    const errors: string[] = [];
    const wins = new Map<string, string>();
    const days = ['2026-11-16', '2026-11-23', '2026-11-30'];
    const hours9 = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
    const loop = (fn: (i: number) => Promise<void>, pauseMs = 40) => (async () => { for (let i = 0; Date.now() < end; i++) { try { await fn(i); } catch (e) { errors.push(String((e as { code?: string }).code ?? (e as Error).message)); } await sleep(pauseMs); } })();
    const hirers = [0, 1, 2, 3, 4, 5].map(h => loop(async i => {
      const r = req(f, { start: { date: days[(h + i) % 3], time: hours9[(h * 3 + i) % 8] } });
      const res = await hire.createHire(tenant, r);
      if (res.ok) wins.set(r.idempotencyKey, res.reservation.id);
    }));
    const writers = [
      loop(async i => { const c = await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: `2027-0${(i % 9) + 1}-01`, toDate: `2027-0${(i % 9) + 1}-01`, kind: 'closed', reason: 'stress' }, TZ); if (c.ok) await avail.deleteException(tenant, c.value.id, c.value.updatedAt); }, 200),
      loop(async i => { const c = await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: `2027-0${(i % 9) + 1}-02`, toDate: `2027-0${(i % 9) + 1}-02`, kind: 'closed', reason: 'stress' }, TZ); if (c.ok) await avail.deleteException(tenant, c.value.id, c.value.updatedAt); }, 250),
      loop(async i => { await sql.query('UPDATE scheduling_offerings SET name = $3 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering, `neon hire ${i}`]); }, 500),
      loop(async () => { await sql.query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, f.offering, f.court]); await sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [ORG, f.offering, f.court]); }, 600),
      loop(async () => { await sql.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court]); await sql.query('UPDATE scheduling_resources SET active = true WHERE organisation_id = $1 AND id = $2', [ORG, f.court]); }, 600),
    ];
    await Promise.all([...hirers, ...writers]);
    console.log(`[neon hire stress] wins=${wins.size} errors=${JSON.stringify(errors.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}))}`);
    expect(errors.filter(c => c === '40P01')).toEqual([]);
    expect(wins.size).toBeGreaterThan(0);
    const overlapping = await rows(`SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id WHERE a.organisation_id = $1 AND a.resource_id = $2 AND a.released_at IS NULL AND b.released_at IS NULL AND a.during && b.during`, [ORG, f.court]);
    expect(Number(overlapping[0].n)).toBe(0);
    const perKey = await rows(`SELECT idempotency_key, count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 GROUP BY 1`, [ORG, f.offering]);
    for (const r of perKey) expect(Number(r.n)).toBe(1);
    expect(perKey.length).toBe(wins.size);
    expect(await holds(f)).toBe(wins.size);
  }, 60_000);

  it('L: every other organisation on the branch (the Production-data copy, pilot included) is identical after all of the above; the named pilot too, if one is given', async () => {
    expect((await rows(OTHERS_SNAPSHOT_SQL, [ORG, OTHER]))[0]).toEqual(othersBefore);
    expect(Number(othersBefore.reservations)).toBeGreaterThanOrEqual(0);
    if (PILOT !== '') expect((await rows(PILOT_SNAPSHOT_SQL, [PILOT]))[0]).toEqual(pilotBefore);
  });
});

const go = <T>(p: PromiseLike<T>): Promise<T> => Promise.resolve(p);
