import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateReservationResult } from '@scheduling/core';
import { TEST_URL, closePool, count, ensureSchema, getPool, hasDatabase, resetData, seedClass, seedOccurrence, seedResource, staff } from './support/pgHarness';
import { classBooking, liveHolds, makeWorld, person, slotBooking, stayBooking, type World } from './support/builders';

// Real concurrency: every call below goes through pg.Pool, so each racer is its own connection
// and its own implicit transaction, exactly as it is over the Neon HTTP driver (one statement,
// one transaction, no interactive transaction available).

const ORG = 'org-c';
const POOLED_HOST = /-pooler./.test(TEST_URL); // PgBouncer multiplexes sessions, so session-state tests are direct-host only
let w: World;
const wins = (rs: CreateReservationResult[]) => rs.filter(r => r.ok).length;
const reasons = (rs: CreateReservationResult[]) => rs.filter(r => !r.ok).map(r => (r as { reason: string }).reason);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe.skipIf(!hasDatabase)('concurrency (database-enforced)', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
  });

  describe('headcount capacity', () => {
    it('30 racers for 5 places: exactly 5 confirmed, 25 refused as capacity_exceeded', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const results = await Promise.all(range(30).map(() => w.repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' }))));
      expect(wins(results)).toBe(5);
      expect(reasons(results).every(r => r === 'capacity_exceeded')).toBe(true);
      expect(await count("SELECT count(*) FROM scheduling_reservations WHERE occurrence_id = 'oc' AND status <> 'cancelled'")).toBe(5);
    });

    it('counts headcount, not rows: mixed party sizes never exceed capacity', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 10, { presetKey: 'event_capacity' });
      const results = await Promise.all(
        range(24).map(i => w.repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' }, { presetKey: 'event_capacity', partySize: (i % 4) + 1 }))),
      );
      const booked = await count("SELECT COALESCE(sum(party_size), 0) FROM scheduling_reservations WHERE occurrence_id = 'oc' AND status <> 'cancelled'");
      expect(booked).toBeLessThanOrEqual(10);
      expect(booked).toBeGreaterThanOrEqual(7); // the greedy fill leaves at most a hole smaller than the smallest refused party
      expect(wins(results)).toBeGreaterThan(0);
    });

    it('two occurrences are independent: filling one never blocks the other', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'o1' }, 2);
      await seedOccurrence({ id: 'o2', org: ORG, offeringId: 'of', capacity: 2, startsAt: '2026-12-14T05:30:00Z', endsAt: '2026-12-14T06:30:00Z' });
      const ids = { schedule: 'sc', offering: 'of' };
      const results = await Promise.all([
        ...range(6).map(() => w.repo.create(w.staff, classBooking('o1', ids))),
        ...range(6).map(() => w.repo.create(w.staff, classBooking('o2', ids, { instants: { startsAt: '2026-12-14T05:30:00Z', endsAt: '2026-12-14T06:30:00Z' } }))),
      ]);
      expect(wins(results)).toBe(4);
    });

    it('cancel and re-book storm never ends above capacity', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 3);
      const ids = { schedule: 'sc', offering: 'of' };
      const first = await Promise.all(range(3).map(() => w.repo.create(w.staff, classBooking('oc', ids))));
      const booked = first.flatMap(r => (r.ok ? [r.reservation.id] : []));
      const storm = await Promise.all([
        ...range(20).map(() => w.repo.create(w.staff, classBooking('oc', ids))),
        ...booked.map(id => w.repo.cancel(w.staff, { reservationId: id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' })),
      ]);
      expect(storm.length).toBe(23);
      const live = await count("SELECT COALESCE(sum(party_size), 0) FROM scheduling_reservations WHERE occurrence_id = 'oc' AND status <> 'cancelled'");
      expect(live).toBeLessThanOrEqual(3);
    });

    it('closes the LD Tennis same-email race: 12 racers with one email book exactly once', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 20);
      const ids = { schedule: 'sc', offering: 'of' };
      const results = await Promise.all(range(12).map(() => w.repo.create(w.staff, classBooking('oc', ids, { customerSnapshot: person('Sam', 'Sam@Example.com') }))));
      expect(wins(results)).toBe(1);
      expect(reasons(results).every(r => r === 'duplicate_reservation')).toBe(true);
    });

    it('a concurrent same-customer race books once (linked customer id)', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 20);
      const ids = { schedule: 'sc', offering: 'of' };
      const results = await Promise.all(range(12).map(() => w.repo.create(w.staff, classBooking('oc', ids, { customerId: 'cust-1', customerSnapshot: person('Sam', null) }))));
      expect(wins(results)).toBe(1);
    });
  });

  describe('idempotency', () => {
    it('10 concurrent creates with one key produce ONE reservation; all report ok, 9 as replays', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 1); // capacity 1: a replay of a full occurrence must still succeed
      const ids = { schedule: 'sc', offering: 'of' };
      const input = classBooking('oc', ids, { idempotencyKey: 'key-1', customerSnapshot: person('Sam', 'sam@example.com') });
      const results = await Promise.all(range(10).map(() => w.repo.create(w.staff, input)));
      expect(results.every(r => r.ok)).toBe(true);
      const idsSeen = new Set(results.map(r => (r.ok ? r.reservation.id : '')));
      expect(idsSeen.size).toBe(1);
      expect(results.filter(r => r.ok && r.replayed).length).toBe(9);
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(1);
    });

    it('a retry after the occurrence filled up is still a replay, not capacity_exceeded', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 1);
      const ids = { schedule: 'sc', offering: 'of' };
      const input = classBooking('oc', ids, { idempotencyKey: 'key-2' });
      const first = await w.repo.create(w.staff, input);
      expect(first.ok && !first.replayed).toBe(true);
      const again = await w.repo.create(w.staff, input);
      expect(again).toMatchObject({ ok: true, replayed: true });
      // a different person is refused: the place is gone
      expect(await w.repo.create(w.staff, classBooking('oc', ids))).toEqual({ ok: false, reason: 'capacity_exceeded' });
    });

    it('the same key with a different request is refused, never silently merged', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const ids = { schedule: 'sc', offering: 'of' };
      await w.repo.create(w.staff, classBooking('oc', ids, { idempotencyKey: 'key-3', customerSnapshot: person('A', 'a@example.com') }));
      const other = await w.repo.create(w.staff, classBooking('oc', ids, { idempotencyKey: 'key-3', customerSnapshot: person('B', 'b@example.com') }));
      expect(other).toEqual({ ok: false, reason: 'duplicate_reservation' });
    });

    it('keys are tenant-scoped: another organisation may use the same key', async () => {
      const other = await makeWorld('org-d', staff('org-d'));
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      await seedClass('org-d', { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const ids = { schedule: 'sc', offering: 'of' };
      const a = await w.repo.create(w.staff, classBooking('oc', ids, { idempotencyKey: 'shared' }));
      const b = await other.repo.create(other.staff, classBooking('oc', ids, { idempotencyKey: 'shared' }));
      expect(a.ok && !a.replayed).toBe(true);
      expect(b.ok && !b.replayed).toBe(true);
    });
  });

  describe('exclusive resources', () => {
    it('30 racers for one court slot: exactly one winner, 29 resource_conflict, one live hold', async () => {
      const results = await Promise.all(range(30).map(() => w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire))));
      expect(wins(results)).toBe(1);
      expect(reasons(results).every(r => r === 'resource_conflict')).toBe(true);
      expect(await liveHolds(ORG, 'court-1')).toBe(1);
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(1); // losers wrote no reservation row either
    });

    it('30 adjacent slots in parallel all succeed', async () => {
      const slots = range(30).map(i => {
        const minutes = i * 30;
        const hh = String(Math.floor(minutes / 60) + 6).padStart(2, '0');
        const mm = String(minutes % 60).padStart(2, '0');
        return slotBooking('court-1', '2026-12-08', `${hh}:${mm}`, 30, w.hire);
      });
      const results = await Promise.all(slots.map(s => w.repo.create(w.staff, s)));
      expect(wins(results)).toBe(30);
    });

    it('racing hotel stays: overlapping ranges give one winner, abutting ranges all win', async () => {
      const overlapping = await Promise.all(range(12).map(() => w.repo.create(w.staff, stayBooking('room-1', '2026-12-07', '2026-12-10', w.stay))));
      expect(wins(overlapping)).toBe(1);
      const abutting = await Promise.all(
        range(10).map(i => {
          const d = (n: number) => `2027-01-${String(n).padStart(2, '0')}`;
          return w.repo.create(w.staff, stayBooking('room-1', d(1 + i * 2), d(3 + i * 2), w.stay));
        }),
      );
      expect(wins(abutting)).toBe(10);
    });

    it('mixed 80-request storm (book / overlap / cancel) leaves no overlapping live holds and raises no deadlock', async () => {
      const ops: Array<Promise<unknown>> = [];
      const created: string[] = [];
      for (let i = 0; i < 80; i++) {
        const slot = i % 8; // 8 distinct hours, 10 racers each
        const hh = String(8 + slot).padStart(2, '0');
        ops.push(
          w.repo.create(w.staff, slotBooking('court-1', '2026-12-09', `${hh}:00`, i % 3 === 0 ? 90 : 60, w.hire)).then(r => {
            if (r.ok) created.push(r.reservation.id);
          }),
        );
      }
      await Promise.all(ops);
      await Promise.all(created.filter((_, i) => i % 3 === 0).map(id => w.repo.cancel(w.staff, { reservationId: id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' })));
      const overlaps = await count(
        `SELECT count(*) FROM scheduling_resource_holds a JOIN scheduling_resource_holds b
           ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during
          WHERE a.released_at IS NULL AND b.released_at IS NULL`,
      );
      expect(overlaps).toBe(0);
    });

    it('REGRESSION: overlapping inserts never surface a raw deadlock (40P01); losers get a clean resource_conflict', async () => {
      // Without scheduling_holds_serialise, two inserts for overlapping ranges wait on each other's
      // uncommitted index entry and Postgres kills one with deadlock_detected. 25 rounds of 16
      // mutually-overlapping racers made that fail reliably; the loser must be a domain refusal.
      const raw: unknown[] = [];
      let winners = 0;
      for (let round = 0; round < 25; round++) {
        const date = `2027-02-${String((round % 27) + 1).padStart(2, '0')}`;
        const settled = await Promise.allSettled(
          range(16).map(i => w.repo.create(w.staff, slotBooking('court-1', date, `${String(8 + (i % 4)).padStart(2, '0')}:00`, 90, w.hire))),
        );
        for (const s of settled) {
          if (s.status === 'rejected') raw.push(s.reason);
          else if (s.value.ok) winners++;
        }
      }
      expect(raw.map(e => (e as { code?: string }).code ?? String(e))).toEqual([]);
      expect(winners).toBeGreaterThan(0);
      const overlaps = await count(
        `SELECT count(*) FROM scheduling_resource_holds a JOIN scheduling_resource_holds b
           ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during
          WHERE a.released_at IS NULL AND b.released_at IS NULL`,
      );
      expect(overlaps).toBe(0);
    });

    it('a class occurrence and a hire booking on the same court exclude each other (one holds table across presets)', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 8, { resourceId: 'court-1', startsAt: '2026-12-10T06:00:00Z', endsAt: '2026-12-10T07:00:00Z' });
      // 2026-12-10 16:30 Adelaide (+10:30) = 06:00Z
      const clash = await w.repo.create(w.staff, slotBooking('court-1', '2026-12-10', '16:30', 60, w.hire));
      expect(clash).toEqual({ ok: false, reason: 'resource_conflict' });
      const adjacent = await w.repo.create(w.staff, slotBooking('court-1', '2026-12-10', '17:30', 60, w.hire));
      expect(adjacent.ok).toBe(true);
    });
  });

  describe('occurrence lifecycle races', () => {
    it('cancelling an occurrence while 20 racers book leaves NO live reservation on it', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 50);
      const ids = { schedule: 'sc', offering: 'of' };
      const [, ...bookings] = await Promise.all([
        w.config.cancelOccurrence(w.staff, 'oc', 'weather'),
        ...range(20).map(() => w.repo.create(w.staff, classBooking('oc', ids))),
      ]);
      expect((bookings as CreateReservationResult[]).filter(r => !r.ok).every(r => !r.ok && r.reason === 'offering_unavailable')).toBe(true);
      expect(await count("SELECT count(*) FROM scheduling_reservations WHERE occurrence_id = 'oc' AND status <> 'cancelled'")).toBe(0);
    });

    it('cancelling an occurrence releases its court hold and cancels its reservations, atomically', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 8, { resourceId: 'court-1', startsAt: '2026-12-10T06:00:00Z', endsAt: '2026-12-10T07:00:00Z' });
      const ids = { schedule: 'sc', offering: 'of' };
      const a = await w.repo.create(w.staff, classBooking('oc', ids, { instants: { startsAt: '2026-12-10T06:00:00Z', endsAt: '2026-12-10T07:00:00Z' } }));
      expect(a.ok).toBe(true);
      const out = await w.config.cancelOccurrence(w.staff, 'oc', 'rain');
      expect(out?.cancelledReservationIds).toHaveLength(1);
      expect(await liveHolds(ORG, 'court-1')).toBe(0);
      expect(await w.config.cancelOccurrence(w.staff, 'oc', 'again')).toBeNull(); // already closed
      const rebooked = await w.repo.create(w.staff, slotBooking('court-1', '2026-12-10', '16:30', 60, w.hire));
      expect(rebooked.ok).toBe(true);
    });
  });

  describe('lock behaviour and timeouts', () => {
    it('a booking waits behind an open transaction on the same occurrence, then succeeds when it commits', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const holder = new Client({ connectionString: TEST_URL });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id,
            customer_name, timezone, local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
          VALUES ('hold-a', $1, 'sc', 'classes_coaching', 1, 'of', 'occurrence', 'oc', 'Holder', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00',
            '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD')`, [ORG]);
        let finished = false;
        const waiting = w.repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' })).then(r => {
          finished = true;
          return r;
        });
        await new Promise(r => setTimeout(r, 400));
        expect(finished).toBe(false); // blocked on the advisory lock
        await holder.query('COMMIT');
        expect((await waiting).ok).toBe(true);
      } finally {
        await holder.end();
      }
    });

    it('the function-level lock_timeout bounds a stuck waiter: it fails with a RAW 55P03 (never a business refusal) and writes nothing', async () => {
      // No session setting is used on purpose: the Neon HTTP driver and PgBouncer cannot carry one.
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const holder = new Client({ connectionString: TEST_URL });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling_capacity:' || $1 || ':oc', 0))", [ORG]);
        const started = Date.now();
        await expect(w.repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' }))).rejects.toMatchObject({ code: '55P03' });
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThanOrEqual(4500);
        expect(waited).toBeLessThan(15000);
        await holder.query('ROLLBACK');
        expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
        expect((await w.repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' }))).ok).toBe(true); // recovers
      } finally {
        await holder.end();
      }
    }, 30000);

    it('the same bound applies to the per-resource lock', async () => {
      const holder = new Client({ connectionString: TEST_URL });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || $1 || ':court-1', 0))", [ORG]);
        await expect(w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire))).rejects.toMatchObject({ code: '55P03' });
        await holder.query('ROLLBACK');
        expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
      } finally {
        await holder.end();
      }
    }, 30000);

    // Needs a real session (BEGIN ISOLATION LEVEL ...), which PgBouncer transaction pooling does not keep.
    it.skipIf(POOLED_HOST)('refuses to run under REPEATABLE READ: the capacity count would use a stale snapshot', async () => {
      await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
      const c = new Client({ connectionString: TEST_URL });
      await c.connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await expect(
          c.query(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id,
              customer_name, timezone, local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
            VALUES ('r1', $1, 'sc', 'classes_coaching', 1, 'of', 'occurrence', 'oc', 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00',
              '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD')`, [ORG]),
        ).rejects.toMatchObject({ code: 'SCISO' });
        await c.query('ROLLBACK');
      } finally {
        await c.end();
      }
    });
  });

  it.skipIf(POOLED_HOST)('the pool really is concurrent (guards the guard): 10 distinct backend connections at once', async () => {
    const pool = getPool();
    const clients = await Promise.all(range(10).map(() => pool.connect()));
    const pids = new Set((await Promise.all(clients.map(c => c.query('SELECT pg_backend_pid() AS pid')))).map(r => r.rows[0].pid));
    clients.forEach(c => c.release());
    expect(pids.size).toBe(10);
    await seedResource(ORG, 'extra', 'court');
  });
});
