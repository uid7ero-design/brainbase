import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INTERACTIVE_RETRY, retryOnContention } from '@scheduling/core';
import { fromPgLike, PostgresReservationRepository } from '@scheduling/postgres';
import { FixedClock, TEST_URL, closePool, count, ensureSchema, getPool, hasDatabase, makePool, resetData, seedOccurrence, seedResource, staff } from './support/pgHarness';
import { appointmentBooking, classBooking, makeWorld, slotBooking, type World } from './support/builders';
import { race, record, summarise, timed, watchLockWaiters, type Sample } from './support/loadStats';

// Contention and load proof. Every request is its own pooled connection (one statement, one
// implicit transaction), as over the Neon HTTP driver. The suite measures and records latency
// distributions, outcome counts and database errors; its ASSERTIONS are about correctness under
// load (exactly the right winners, no overlap, no deadlock, no unexpected database error, no
// cross-tenant effect), never about speed. The numbers it prints describe THIS database on THIS
// run and are not a capacity promise for production.

const POOL = Number(process.env.SCHEDULING_TEST_POOL_MAX ?? 110);
const N = Number(process.env.SCHEDULING_LOAD_RACERS ?? 100);
const POOLED_HOST = /-pooler./.test(TEST_URL);
const ORG = 'org-load';
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const count_ = (samples: Sample[], outcome: string) => samples.filter(s => s.outcome === outcome).length;
const onlyOutcomes = (samples: Sample[], allowed: string[]) => expect([...new Set(samples.map(s => s.outcome))].filter(o => !allowed.includes(o))).toEqual([]);

let pool: ReturnType<typeof makePool>;
let repo: PostgresReservationRepository;
let w: World;

async function seedResources(org: string, prefix: string, n: number, kind = 'court') {
  await getPool().query(
    `INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity)
     SELECT $2 || g, $1, $3, $2 || g, 4 FROM generate_series(1, $4::int) g ON CONFLICT DO NOTHING`,
    [org, prefix, kind, n],
  );
  // 031: a reservation or occurrence may only use a resource its offering is assigned; these bulk resources serve the hire and class offerings
  await getPool().query(
    `INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id)
     SELECT $1, o, r.id FROM scheduling_resources r CROSS JOIN unnest($3::text[]) o WHERE r.organisation_id = $1 AND r.id LIKE $2 || '%' ON CONFLICT DO NOTHING`,
    [org, prefix, [w.hire.offering, w.cls.offering]],
  );
}
const liveOverlaps = () =>
  count(
    `SELECT count(*) FROM scheduling_resource_holds a JOIN scheduling_resource_holds b
       ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during
      WHERE a.released_at IS NULL AND b.released_at IS NULL`,
  );
const minutesToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DAY = '2027-06-01'; // Adelaide standard time: no DST edge in the way

describe.skipIf(!hasDatabase)('contention, throughput and lock behaviour', () => {
  beforeAll(async () => {
    await ensureSchema();
    pool = makePool(POOL);
    repo = new PostgresReservationRepository({ sql: fromPgLike(pool), clock: new FixedClock() });
  });
  afterAll(async () => {
    await pool.end();
    await closePool();
  });
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
  });

  describe('one resource, many requests', () => {
    for (const n of [50, N]) {
      it(`${n} identical requests for one slot: exactly one winner, every other a clean resource_conflict`, async () => {
        const watcher = await watchLockWaiters();
        const { samples, wallMs } = await race(range(n).map(() => () => repo.create(w.staff, slotBooking('court-1', DAY, '10:00', 60, w.hire))));
        record(summarise(`one-resource identical slot x${n}`, samples, wallMs, await watcher.stop()));
        expect(count_(samples, 'ok')).toBe(1);
        expect(count_(samples, 'resource_conflict')).toBe(n - 1);
        onlyOutcomes(samples, ['ok', 'resource_conflict']);
        expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE released_at IS NULL AND resource_id = 'court-1'")).toBe(1);
      }, 120000);
    }

    it(`${N} back-to-back slots on ONE resource all succeed (the per-resource lock serialises them) with no overlap`, async () => {
      const watcher = await watchLockWaiters();
      const { samples, wallMs } = await race(range(N).map(i => () => repo.create(w.staff, slotBooking('court-1', DAY, minutesToTime(i * 10), 10, w.hire))));
      const peak = await watcher.stop();
      record(summarise(`one-resource ${N} adjacent slots (serialised)`, samples, wallMs, peak, 'worst case for the per-resource lock: every request queues behind the previous one'));
      // Every request queues behind the per-resource lock, and a waiter gives up after the 5 s lock
      // bound. On an idle database all ${N} succeed; on a slow or loaded host the tail of the queue can
      // exceed the bound, and those requests must fail as the retryable contention_timeout having written
      // nothing. They must never be refused as "unavailable", raise a raw error, or leave an overlap.
      onlyOutcomes(samples, ['ok', 'error:contention_timeout']);
      expect(count_(samples, 'ok')).toBeGreaterThan(0);
      if (count_(samples, 'error:contention_timeout') > 0) console.warn(`[contention] ${count_(samples, 'error:contention_timeout')} of ${N} queued requests hit the 5 s lock bound on this host`);
      expect(await liveOverlaps()).toBe(0);
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE released_at IS NULL")).toBe(count_(samples, 'ok'));
      expect(await count("SELECT count(*) FROM scheduling_reservations")).toBe(count_(samples, 'ok'));
    }, 120000);

    it('the winner is deterministic in outcome: overlapping but different ranges leave a non-overlapping set and no raw database error', async () => {
      const { samples, wallMs } = await race(range(N).map(i => () => repo.create(w.staff, slotBooking('court-1', DAY, minutesToTime(8 * 60 + (i % 12) * 15), 60, w.hire))));
      record(summarise(`one-resource ${N} overlapping different ranges`, samples, wallMs));
      onlyOutcomes(samples, ['ok', 'resource_conflict']);
      expect(count_(samples, 'ok')).toBeGreaterThan(0);
      expect(await liveOverlaps()).toBe(0);
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE released_at IS NULL")).toBe(count_(samples, 'ok'));
    }, 120000);
  });

  describe('independent resources do not contend', () => {
    it(`${N} bookings on ${N} different resources all succeed`, async () => {
      await seedResources(ORG, 'ind-', N);
      const watcher = await watchLockWaiters();
      const { samples, wallMs } = await race(range(N).map(i => () => repo.create(w.staff, slotBooking(`ind-${i + 1}`, DAY, '10:00', 60, w.hire))));
      record(summarise(`independent resources x${N}`, samples, wallMs, await watcher.stop(), 'compare latency with the serialised single-resource scenario'));
      expect(count_(samples, 'ok')).toBe(N);
      onlyOutcomes(samples, ['ok']);
    }, 120000);

    it('20 resources x 5 racers each on the same slot: exactly one winner per resource', async () => {
      await seedResources(ORG, 'grp-', 20);
      const tasks = range(100).map(i => () => repo.create(w.staff, slotBooking(`grp-${(i % 20) + 1}`, DAY, '10:00', 60, w.hire)));
      const { samples, wallMs } = await race(tasks);
      record(summarise('20 resources x 5 racers', samples, wallMs));
      expect(count_(samples, 'ok')).toBe(20);
      expect(count_(samples, 'resource_conflict')).toBe(80);
      onlyOutcomes(samples, ['ok', 'resource_conflict']);
      expect(await count("SELECT count(DISTINCT resource_id) FROM scheduling_resource_holds WHERE resource_id LIKE 'grp-%' AND released_at IS NULL")).toBe(20);
    }, 120000);
  });

  describe('mixed headcount and exclusive-resource reservations', () => {
    it('classes (headcount lock) and hire bookings (resource lock) on the same courts, at once', async () => {
      const COURTS = 8;
      await seedResources(ORG, 'mix-', COURTS);
      for (const c of range(COURTS)) {
        const day = 7 + c; // a distinct occurrence date per court keeps the occurrence slot key unique
        await seedOccurrence({ id: `mix-oc-${c}`, org: ORG, offeringId: w.cls.offering, capacity: 5, resourceId: `mix-${c + 1}`, startsAt: `2026-12-${String(day).padStart(2, '0')}T05:30:00Z`, endsAt: `2026-12-${String(day).padStart(2, '0')}T06:30:00Z` });
      }
      const tasks: Array<() => Promise<unknown>> = [];
      for (const c of range(COURTS)) {
        const day = 7 + c;
        const date = `2026-12-${String(day).padStart(2, '0')}`;
        const instants = { startsAt: `${date}T05:30:00Z`, endsAt: `${date}T06:30:00Z` };
        for (let i = 0; i < 12; i++) tasks.push(() => repo.create(w.staff, classBooking(`mix-oc-${c}`, w.cls, { instants })));
        for (let i = 0; i < 12; i++) tasks.push(() => repo.create(w.staff, slotBooking(`mix-${c + 1}`, date, '17:00', 60, w.hire))); // adjacent after the class: one winner
        for (let i = 0; i < 12; i++) tasks.push(() => repo.create(w.staff, slotBooking(`mix-${c + 1}`, date, '16:30', 60, w.hire))); // overlaps the class: nobody wins
      }
      const watcher = await watchLockWaiters();
      const { samples, wallMs } = await race(tasks);
      record(summarise(`mixed headcount+exclusive x${tasks.length}`, samples, wallMs, await watcher.stop()));
      onlyOutcomes(samples, ['ok', 'capacity_exceeded', 'resource_conflict']);
      expect(count_(samples, 'ok')).toBe(COURTS * (5 + 1));
      expect(await count("SELECT coalesce(sum(party_size),0) FROM scheduling_reservations WHERE occurrence_id LIKE 'mix-oc-%' AND status <> 'cancelled'")).toBe(COURTS * 5);
      expect(await liveOverlaps()).toBe(0);
    }, 120000);
  });

  describe('advisory-lock wait times', () => {
    it('a booking behind a held per-resource lock waits roughly as long as the lock is held, then succeeds', async () => {
      const holder = new Client({ connectionString: TEST_URL, ssl: /neon\.tech/.test(TEST_URL) ? { rejectUnauthorized: false } : undefined });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || $1 || ':court-1', 0))", [ORG]);
        const pending = timed(() => repo.create(w.staff, slotBooking('court-1', DAY, '10:00', 60, w.hire)));
        await new Promise(resolve => setTimeout(resolve, 1500));
        await holder.query('COMMIT');
        const sample = await pending;
        record(summarise('waiter behind resource lock held 1.5s', [sample], sample.ms, 1));
        expect(sample.outcome).toBe('ok');
        expect(sample.ms).toBeGreaterThan(1300);
        expect(sample.ms).toBeLessThan(4500);
      } finally {
        await holder.end().catch(() => undefined);
      }
    }, 30000);

    it('the same for the per-occurrence capacity lock', async () => {
      await getPool().query("SELECT 1");
      const { seedClass } = await import('./support/pgHarness');
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const holder = new Client({ connectionString: TEST_URL, ssl: /neon\.tech/.test(TEST_URL) ? { rejectUnauthorized: false } : undefined });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling_capacity:' || $1 || ':oc', 0))", [ORG]);
        const pending = timed(() => repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' })));
        await new Promise(resolve => setTimeout(resolve, 1500));
        await holder.query('COMMIT');
        const sample = await pending;
        record(summarise('waiter behind capacity lock held 1.5s', [sample], sample.ms, 1));
        expect(sample.outcome).toBe('ok');
        expect(sample.ms).toBeGreaterThan(1300);
        expect(sample.ms).toBeLessThan(4500);
      } finally {
        await holder.end().catch(() => undefined);
      }
    }, 30000);
  });

  describe('lock timeout under load', () => {
    it('30 requests queued behind a stuck lock all fail as a bounded, retryable contention_timeout, write nothing, and succeed once the lock is free', async () => {
      const holder = new Client({ connectionString: TEST_URL, ssl: /neon\.tech/.test(TEST_URL) ? { rejectUnauthorized: false } : undefined });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || $1 || ':court-1', 0))", [ORG]);
        const { samples, wallMs } = await race(range(30).map(i => () => repo.create(w.staff, slotBooking('court-1', DAY, minutesToTime(i * 10), 10, w.hire))));
        record(summarise('30 queued behind a stuck resource lock', samples, wallMs, 30, 'lock_timeout is 5s'));
        expect(count_(samples, 'error:contention_timeout')).toBe(30);
        onlyOutcomes(samples, ['error:contention_timeout']); // never a business refusal, never a raw error
        expect(Math.max(...samples.map(s => s.ms))).toBeLessThan(15000);
        expect(Math.min(...samples.map(s => s.ms))).toBeGreaterThan(4000);
        expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
        expect(await count('SELECT count(*) FROM scheduling_resource_holds')).toBe(0);
        await holder.query('ROLLBACK');
        const again = await race(range(30).map(i => () => retryOnContention(() => repo.create(w.staff, slotBooking('court-1', DAY, minutesToTime(i * 10), 10, w.hire)), INTERACTIVE_RETRY, { sleep: ms => new Promise(r => setTimeout(r, ms)), random: Math.random })));
        expect(count_(again.samples, 'ok')).toBe(30);
      } finally {
        await holder.end().catch(() => undefined);
      }
    }, 90000);
  });

  describe('deadlock prevention', () => {
    it('overlapping different ranges on 3 resources, 12 racers each, 20 rounds: zero deadlocks, zero raw errors', async () => {
      await seedResources(ORG, 'dl-', 3);
      const all: Sample[] = [];
      const start = performance.now();
      for (let round = 0; round < 20; round++) {
        const date = `2027-07-${String(round + 1).padStart(2, '0')}`;
        const tasks = range(36).map(i => () => repo.create(w.staff, slotBooking(`dl-${(i % 3) + 1}`, date, minutesToTime(8 * 60 + (i % 4) * 30), 90, w.hire)));
        all.push(...(await race(tasks)).samples);
      }
      record(summarise('deadlock hunt: 20 rounds x 36 overlapping', all, performance.now() - start));
      onlyOutcomes(all, ['ok', 'resource_conflict']);
      expect(all.filter(s => s.outcome.includes('40P01')).length).toBe(0);
      expect(await liveOverlaps()).toBe(0);
    }, 180000);

    it('automatic assignment racing across 4 resources, 24 racers, 15 rounds: exactly 4 winners a round and no raw error', async () => {
      for (const r of ['p1', 'p2', 'p3', 'p4']) {
        await seedResource(ORG, r, 'practitioner', { capacity: 1 });
        await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, w.appt.offering, r]);
      }
      const all: Sample[] = [];
      const start = performance.now();
      for (let round = 0; round < 15; round++) {
        const date = `2027-08-${String(round + 1).padStart(2, '0')}`;
        const { samples } = await race(range(24).map(() => () => repo.createAssigned(w.staff, appointmentBooking(null, date, '09:00', 30, w.appt))));
        expect(count_(samples, 'ok'), `round ${round}`).toBe(4);
        all.push(...samples);
      }
      record(summarise('assignment: 15 rounds x 24 racers x 4 resources', all, performance.now() - start));
      onlyOutcomes(all, ['ok', 'resource_conflict']);
    }, 180000);
  });

  describe('cancellation while bookings compete', () => {
    it('10 rounds of 30 racers for one slot while the current holder is cancelled: never two live holds, every cancelled reservation holds nothing', async () => {
      const all: Sample[] = [];
      const start = performance.now();
      let holder: string | null = null;
      for (let round = 0; round < 10; round++) {
        const tasks: Array<() => Promise<unknown>> = range(30).map(() => () => repo.create(w.staff, slotBooking('court-1', DAY, '10:00', 60, w.hire)));
        if (holder !== null) {
          const target = holder;
          tasks.push(() => repo.cancel(w.staff, { reservationId: target, scope: 'this_occurrence', cancelledBy: 'staff', reason: null }).then(r => ({ ok: r.status === 'cancelled', reason: r.status === 'cancelled' ? undefined : r.status })));
        }
        const { samples } = await race(tasks);
        all.push(...samples);
        const live = await getPool().query("SELECT id FROM scheduling_reservations WHERE status <> 'cancelled' AND resource_id = 'court-1'");
        expect(live.rows.length, `round ${round}`).toBeLessThanOrEqual(1);
        holder = (live.rows[0]?.id as string | undefined) ?? null;
        expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE released_at IS NULL AND resource_id = 'court-1'"), `round ${round}`).toBe(live.rows.length);
      }
      record(summarise('cancel while 30 racers compete x10 rounds', all, performance.now() - start));
      onlyOutcomes(all, ['ok', 'resource_conflict']);
      expect(await count("SELECT count(*) FROM scheduling_resource_holds h JOIN scheduling_reservations r ON r.id = h.reservation_id AND r.organisation_id = h.organisation_id WHERE r.status = 'cancelled' AND h.released_at IS NULL")).toBe(0);
      expect(await liveOverlaps()).toBe(0);
    }, 180000);
  });

  describe('tenant isolation under concurrent load', () => {
    it('4 organisations hammer identical ids at once: one winner each, nothing crosses', async () => {
      const orgs = ['iso-a', 'iso-b', 'iso-c', 'iso-d'];
      const worlds = await Promise.all(orgs.map(o => makeWorld(o, staff(o))));
      // identical resource id, offering id and slot in every organisation (the world seeds court-1)
      const tasks = worlds.flatMap(world => range(25).map(() => () => repo.create(world.staff, slotBooking('court-1', DAY, '10:00', 60, { schedule: world.hire.schedule, offering: world.hire.offering }))));
      const { samples, wallMs } = await race(tasks);
      record(summarise('4 tenants x 25 racers, identical ids', samples, wallMs));
      expect(count_(samples, 'ok')).toBe(4);
      expect(count_(samples, 'resource_conflict')).toBe(96);
      onlyOutcomes(samples, ['ok', 'resource_conflict']);
      for (const o of orgs) {
        expect(await count('SELECT count(*) FROM scheduling_reservations WHERE organisation_id = $1', [o])).toBe(1);
        expect(await count('SELECT count(*) FROM scheduling_resource_holds WHERE organisation_id = $1 AND released_at IS NULL', [o])).toBe(1);
      }
      // no row anywhere points at another tenant's parent
      expect(await count('SELECT count(*) FROM scheduling_resource_holds h JOIN scheduling_reservations r ON r.id = h.reservation_id WHERE r.organisation_id <> h.organisation_id')).toBe(0);
      // a tenant can read only its own reservation by id
      const mine = (await getPool().query('SELECT id FROM scheduling_reservations WHERE organisation_id = $1', ['iso-a'])).rows[0].id as string;
      expect(await repo.getById(worlds[0].staff, mine)).not.toBeNull();
      for (const other of worlds.slice(1)) expect(await repo.getById(other.staff, mine)).toBeNull();
    }, 120000);

    it('a cancel issued under one tenant cannot touch another tenant\'s reservation with the same id', async () => {
      const [a, b] = await Promise.all([makeWorld('iso-x', staff('iso-x')), makeWorld('iso-y', staff('iso-y'))]);
      const mk = async (world: World) => {
        const r = await repo.create(world.staff, slotBooking('court-1', DAY, '10:00', 60, world.hire, { idempotencyKey: 'same' }));
        if (!r.ok) throw new Error('setup');
        return r.reservation.id;
      };
      const [ida, idb] = await Promise.all([mk(a), mk(b)]);
      const outcome = await repo.cancel(a.staff, { reservationId: idb, scope: 'this_occurrence', cancelledBy: 'staff', reason: null });
      expect(outcome).toMatchObject({ status: 'rejected', reason: 'not_found' });
      expect(await count("SELECT count(*) FROM scheduling_reservations WHERE status = 'cancelled'")).toBe(0);
      expect(ida).not.toBe(idb);
    });
  });

  it.skipIf(POOLED_HOST)('records the connection counts that were in use (sanity, direct hosts only)', async () => {
    const r = await getPool().query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()');
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});
