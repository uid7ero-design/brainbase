import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateReservationResult } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { FixedClock, closePool, count, customerActor, ensureSchema, getPool, hasDatabase, resetData, seedOccurrence, seedOffering, seedResource, seedSchedule, staff } from './support/pgHarness';
import { makeWorld, slotBooking, type World } from './support/builders';

// Reservation integrity (the remaining 2B.2 findings), proved at the database so BrainBase and the standalone application are
// both covered. Written FIRST: against 030 alone every "refused" test below fails (the reservation is accepted).
//
//   1. a resource's capacity / minimum party is never checked against a reservation's party size, and a capacity reduction can
//      race a new reservation
//   2. a staff reservation (and an occurrence) may use a resource the offering is not assigned to; only the customer path checks
//   3. a reservation's preset snapshot is free text: nothing ties it to the preset of the offering's schedule
//   4. an offering archived while a reservation is being created for it
//   5. cross-organisation allocations: already impossible (composite foreign keys); proved here so it stays that way

const ORG = 'org-ri';
const OTHER = 'org-ri-other';
const FUTURE = '2035-06-12';
const clock = new FixedClock();
let w: World;

const sqlstateOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
};
const booked = (r: CreateReservationResult) => {
  if (!r.ok) throw new Error(`expected a reservation, got ${r.reason}`);
  return r.reservation;
};
const reasonOf = (r: CreateReservationResult) => (r.ok ? 'ok' : r.reason);

async function inTransaction<T>(fn: (tx: { config: PostgresSchedulingConfigRepository; repo: PostgresReservationRepository; sql: (text: string, params?: unknown[]) => Promise<unknown> }, finish: () => Promise<void>) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  await c.query('BEGIN');
  let finished = false;
  const finish = async () => {
    if (!finished) {
      finished = true;
      await c.query('COMMIT');
    }
  };
  try {
    return await fn({ config: new PostgresSchedulingConfigRepository({ sql: fromPgLike(c) }), repo: new PostgresReservationRepository({ sql: fromPgLike(c), clock }), sql: (text, params) => c.query(text, params) }, finish);
  } finally {
    if (!finished) await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}
const pending = async (p: Promise<unknown>, ms = 400) => {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  await new Promise(r => setTimeout(r, ms));
  return !settled;
};

describe.skipIf(!hasDatabase)('reservation integrity (2B.2 findings)', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
    await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1'); // court-1 (capacity 4) is assigned to the hire offering
    await w.config.linkOfferingResource(w.staff, w.stay.offering, 'room-1');
  });

  const hire = (repo: PostgresReservationRepository, resource: string, time: string, over: Record<string, unknown> = {}, actor = w.staff) =>
    repo.create(actor, slotBooking(resource, FUTURE, time, 60, w.hire, over as never));
  const q = (text: string, params: unknown[] = []) => getPool().query(text, params);
  const tokenOf = async (id: string) => (await w.config.listResources(w.staff)).find(r => r.id === id)!.updatedAt;

  // ─── 1. party size against the resource ───────────────────────────────────────────────────────────────────────

  describe('party size must fit the resource', () => {
    it('a party above the resource capacity is refused (capacity_exceeded) and writes nothing; up to the capacity is fine', async () => {
      expect(reasonOf(await hire(w.repo, 'court-1', '09:00', { partySize: 5 }))).toBe('capacity_exceeded');
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
      expect(await count('SELECT count(*) FROM scheduling_resource_holds')).toBe(0);
      booked(await hire(w.repo, 'court-1', '10:00', { partySize: 4 }));
      booked(await hire(w.repo, 'court-1', '11:00', { partySize: 1 }));
    });

    it('a party below the resource minimum is refused, and a customer is held to the same rule', async () => {
      await seedResource(ORG, 'tbl', 'court', { capacity: 6 });
      await q("UPDATE scheduling_resources SET min_party = 2 WHERE organisation_id = $1 AND id = 'tbl'", [ORG]);
      await w.config.linkOfferingResource(w.staff, w.hire.offering, 'tbl');
      expect(reasonOf(await hire(w.repo, 'tbl', '09:00', { partySize: 1 }))).toBe('capacity_exceeded');
      booked(await hire(w.repo, 'tbl', '10:00', { partySize: 2 }));
      await seedSchedule(ORG, 'pub', 'resource_hire', { publicSlug: 'pub' });
      await seedOffering(ORG, 'pub-off', 'pub', { capacity: null });
      await w.config.linkOfferingResource(w.staff, 'pub-off', 'tbl');
      const c = customerActor(ORG, 'cust-1');
      expect(reasonOf(await w.repo.create(c, slotBooking('tbl', FUTURE, '12:00', 60, { schedule: 'pub', offering: 'pub-off' }, { partySize: 9 })))).toBe('capacity_exceeded');
    });

    it('the database refuses a direct insert too (SCPTY)', async () => {
      expect(await sqlstateOf(insertReservation({ id: 'raw-1', resource: 'court-1', party: 7 }))).toBe('SCPTY');
    });
  });

  describe('a capacity change racing a new reservation', () => {
    it('a reservation in flight holds a capacity reduction back, which is then refused (resource_in_use)', async () => {
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00', { partySize: 4 })); // uncommitted
        const racing = w.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { capacity: 2 });
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toMatchObject({ ok: false, reason: 'resource_in_use' });
        expect((await w.config.listResources(w.staff)).find(r => r.id === 'court-1')!.capacity).toBe(4);
      });
    });

    it('a capacity reduction in flight holds a new reservation back, which is then refused', async () => {
      await inTransaction(async (tx, finish) => {
        const done = await tx.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { capacity: 2 });
        expect(done.ok).toBe(true); // uncommitted
        const racing = hire(w.repo, 'court-1', '10:00', { partySize: 4 });
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(reasonOf(await racing)).toBe('capacity_exceeded');
        expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
      });
    });

    it('raising the minimum party under a live smaller party is refused by the database (SCRIU), a past or released one is not', async () => {
      booked(await hire(w.repo, 'court-1', '10:00', { partySize: 1 }));
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET min_party = 2 WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBe('SCRIU');
      await q("UPDATE scheduling_resource_holds SET released_at = now() WHERE organisation_id = $1 AND resource_id = 'court-1'", [ORG]);
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET min_party = 2 WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBeNull();
    });
  });

  // ─── 2. the resource must be assigned to the offering, for every actor ───────────────────────────────────────

  describe('the resource must be assigned to the offering, for staff as well as customers', () => {
    it('a staff reservation on an unassigned resource is refused (offering_unavailable); once assigned it is accepted', async () => {
      await seedResource(ORG, 'court-2', 'court');
      expect(reasonOf(await hire(w.repo, 'court-2', '09:00'))).toBe('offering_unavailable');
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
      await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-2');
      booked(await hire(w.repo, 'court-2', '09:00'));
    });

    it('an occurrence cannot hold a resource its offering does not use (SCLNK), and can once assigned', async () => {
      await seedResource(ORG, 'space-9', 'space');
      expect(await sqlstateOf(seedOccurrence({ id: 'occ-x', org: ORG, offeringId: w.cls.offering, capacity: 5, resourceId: 'space-9', autoLink: false }))).toBe('SCLNK');
      await w.config.linkOfferingResource(w.staff, w.cls.offering, 'space-9');
      expect(await sqlstateOf(seedOccurrence({ id: 'occ-y', org: ORG, offeringId: w.cls.offering, capacity: 5, resourceId: 'space-9' }))).toBeNull();
    });

    it('the database refuses a direct insert on an unassigned resource (SCLNK)', async () => {
      await seedResource(ORG, 'court-3', 'court');
      expect(await sqlstateOf(insertReservation({ id: 'raw-2', resource: 'court-3' }))).toBe('SCLNK');
    });

    it('an unlink in flight holds a STAFF reservation back, which is then refused', async () => {
      await inTransaction(async (tx, finish) => {
        expect(await tx.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1')).toMatchObject({ ok: true }); // uncommitted
        const racing = hire(w.repo, 'court-1', '10:00');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(reasonOf(await racing)).toBe('offering_unavailable');
        expect(await count('SELECT count(*) FROM scheduling_resource_holds')).toBe(0);
      });
    });

    it('an unlink in flight holds an occurrence insert back, which is then refused (SCLNK): the occurrence guard takes the same lock', async () => {
      await w.config.linkOfferingResource(w.staff, w.cls.offering, 'court-1');
      await inTransaction(async (tx, finish) => {
        expect(await tx.config.unlinkOfferingResource(w.staff, w.cls.offering, 'court-1')).toMatchObject({ ok: true }); // uncommitted
        const racing = seedOccurrence({ id: 'occ-race', org: ORG, offeringId: w.cls.offering, capacity: 5, resourceId: 'court-1', autoLink: false });
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await sqlstateOf(racing)).toBe('SCLNK');
        expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(0);
      });
    });

    it('a staff reservation in flight holds the unlink back, which is then refused (allocation_in_use)', async () => {
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00'));
        const racing = w.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toMatchObject({ ok: false, reason: 'allocation_in_use' });
      });
    });
  });

  // ─── 3. the preset snapshot ──────────────────────────────────────────────────────────────────────────────────

  describe('the reservation preset must be the preset of the offering schedule', () => {
    it('a reservation claiming another preset than its offering schedule is refused (SCPRE), whichever resource it names', async () => {
      expect(await sqlstateOf(insertReservation({ id: 'raw-3', resource: 'court-1', preset: 'appointments' }))).toBe('SCPRE');
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });

    it('the repository path cannot be talked into it either', async () => {
      // a room is accepted by BOTH presets, so only the schedule's preset can stop this: the appointments offering is booked as 'resource_hire'
      await seedResource(ORG, 'room-a', 'room');
      await w.config.linkOfferingResource(w.staff, w.appt.offering, 'room-a');
      await expect(w.repo.create(w.staff, slotBooking('room-a', FUTURE, '09:00', 60, w.appt))).rejects.toMatchObject({ code: 'invalid_input' });
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });
  });

  // ─── 4. archiving vs a new reservation ───────────────────────────────────────────────────────────────────────

  describe('an offering archived while a reservation is being created', () => {
    it('an archive in flight holds a reservation back, which is then refused (offering_unavailable)', async () => {
      await inTransaction(async (tx, finish) => {
        expect(await tx.config.archiveOffering(w.staff, w.hire.offering)).toBe(true); // uncommitted
        const racing = hire(w.repo, 'court-1', '10:00');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(reasonOf(await racing)).toBe('offering_unavailable');
        expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
      });
    });

    it('a reservation in flight holds the archive back; the archive then succeeds and the reservation stands', async () => {
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00'));
        const racing = w.config.archiveOffering(w.staff, w.hire.offering);
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toBe(true);
        expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(1);
      });
    });
  });

  // ─── 5. cross-organisation allocations ───────────────────────────────────────────────────────────────────────

  describe('cross-organisation allocations are impossible (composite foreign keys), whoever issues the SQL', () => {
    beforeEach(async () => {
      await seedResource(OTHER, 'their-court', 'court');
      await seedSchedule(OTHER, 'their-sched', 'resource_hire');
      await seedOffering(OTHER, 'their-off', 'their-sched', { capacity: null });
    });

    it('cannot link our offering to their resource, or their offering to ours', async () => {
      expect(await sqlstateOf(q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, w.hire.offering, 'their-court']))).toBe('23503');
      expect(await sqlstateOf(q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [OTHER, 'their-off', 'court-1']))).toBe('23503');
      expect(await sqlstateOf(q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [OTHER, w.hire.offering, 'their-court']))).toBe('23503');
    });

    it('cannot book their resource, their offering, or hold their resource from our reservation or occurrence', async () => {
      expect(await sqlstateOf(insertReservation({ id: 'x-1', resource: 'their-court' }))).toBe('23503');
      expect(await sqlstateOf(q(
        `INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, timezone,
           local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, status, currency)
         VALUES ('x-2', $1, 'their-sched', 'resource_hire', 1, 'their-off', 'slot', 'court-1', 'X', 'Australia/Adelaide', '2035-06-12', '10:00', '2035-06-12', '11:00', '2035-06-12T00:30:00Z', '2035-06-12T01:30:00Z', 1, 'confirmed', 'AUD')`,
        [ORG],
      ))).toBe('23503');
      expect(await sqlstateOf(seedOccurrence({ id: 'x-occ', org: ORG, offeringId: w.cls.offering, capacity: 3, resourceId: 'their-court', autoLink: false }))).toBe('23503');
    });

    it('the same ids in two organisations are different rows: editing one never reaches the other', async () => {
      await seedResource(OTHER, 'court-1', 'court');
      const before = (await q("SELECT row_to_json(r)::text AS j FROM scheduling_resources r WHERE organisation_id = $1 AND id = 'court-1'", [OTHER])).rows[0].j;
      await w.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { name: 'Renamed in ORG only' });
      expect((await q("SELECT row_to_json(r)::text AS j FROM scheduling_resources r WHERE organisation_id = $1 AND id = 'court-1'", [OTHER])).rows[0].j).toBe(before);
    });
  });

  // ─── stress: the invariants hold under random interleavings, with no deadlock ────────────────────────────────

  describe('lock ordering', () => {
    it('stress: capacity change, unlink, archive and bookings racing on one resource never deadlock and never break the invariants', async () => {
      const errors: string[] = [];
      const note = (label: string) => (e: unknown) => {
        const code = (e as { code?: string }).code ?? String(e);
        if (!['not_found', 'lifecycle_violation', 'offering_unavailable', 'invalid_input', 'conflict', 'resource_conflict', 'capacity_exceeded'].includes(code)) errors.push(`${label}:${code}`);
      };
      for (let round = 0; round < 40; round++) {
        await resetData();
        w = await makeWorld(ORG, staff(ORG));
        await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1');
        const token = await tokenOf('court-1');
        await Promise.all([
          w.config.updateResource(w.staff, 'court-1', token, { capacity: 2 }).catch(note('capacity')),
          hire(w.repo, 'court-1', '09:00', { partySize: 4 }).catch(note('book-4')),
          hire(w.repo, 'court-1', '11:00', { partySize: 2 }).catch(note('book-2')),
          hire(w.repo, 'court-1', '13:00', { partySize: 1 }).catch(note('book-1')),
          w.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1').catch(note('unlink')),
        ]);
        const bad = await q(
          `SELECT v.id FROM scheduling_resource_holds h
             JOIN scheduling_reservations v ON v.organisation_id = h.organisation_id AND v.id = h.reservation_id
             JOIN scheduling_resources r ON r.organisation_id = h.organisation_id AND r.id = h.resource_id
            WHERE h.released_at IS NULL AND upper(h.during) > now()
              AND (v.party_size > r.capacity OR v.party_size < COALESCE(r.min_party, 0)
                   OR NOT EXISTS (SELECT 1 FROM scheduling_offering_resources l WHERE l.organisation_id = h.organisation_id AND l.offering_id = v.offering_id AND l.resource_id = h.resource_id))`,
        );
        expect(bad.rows, `round ${round}: a live reservation breaks an invariant`).toEqual([]);
      }
      expect(errors, 'unexpected errors (a 40P01 deadlock would show here)').toEqual([]);
    }, 180_000);
  });
});

/** A raw reservation INSERT with its hold in the same statement, as any other writer could issue it. */
function insertReservation({ id, resource, party = 1, preset = 'resource_hire' }: { id: string; resource: string; party?: number; preset?: string }) {
  return getPool().query(
    `WITH r AS (
       INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, timezone,
         local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, status, currency)
       VALUES ($1, $2, $3, $4, 1, $5, 'slot', $6, 'Raw', 'Australia/Adelaide', '2035-06-12', '10:00', '2035-06-12', '11:00', '2035-06-12T00:30:00Z', '2035-06-12T01:30:00Z', $7, 'confirmed', 'AUD') RETURNING *)
     INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
     SELECT $1 || '-hold', organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM r`,
    [id, ORG, `${ORG}-sched-hire`, preset, `${ORG}-off-hire`, resource, party],
  );
}
