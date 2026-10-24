import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateReservationResult } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { FixedClock, closePool, count, ensureSchema, getPool, hasDatabase, resetData, runScript, sqlFile, staff } from './support/pgHarness';
import { makeWorld, slotBooking, type World } from './support/builders';

// A schedule archived while a reservation is being created for one of its offerings (the limit 2B.2.2 documented).
//
// Archiving an OFFERING is already ordered against a new reservation: the reservation guard locks the offering row FOR SHARE, so
// an archive waits for a reservation in flight and a reservation after an archive is refused. The guard read the SCHEDULE row
// without a lock, so a schedule archive and a reservation never waited for each other: a reservation could commit after
// archiveSchedule had already returned. (The end state is also reachable serially, book then archive, so no invariant breaks; what
// is missing is the ordering guarantee "once the archive has returned, nothing new is booked", which offerings already have.)
//
// Written FIRST: against 031 alone the two in-flight tests fail (nothing waits). 032 makes them pass.

const ORG = 'org-sa';
const FUTURE = '2035-06-12';
const clock = new FixedClock();
let w: World;

const reasonOf = (r: CreateReservationResult) => (r.ok ? 'ok' : r.reason);
const booked = (r: CreateReservationResult) => {
  if (!r.ok) throw new Error(`expected a reservation, got ${r.reason}`);
  return r.reservation;
};

async function inTransaction<T>(fn: (tx: { config: PostgresSchedulingConfigRepository; repo: PostgresReservationRepository }, finish: () => Promise<void>) => Promise<T>): Promise<T> {
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
    return await fn({ config: new PostgresSchedulingConfigRepository({ sql: fromPgLike(c) }), repo: new PostgresReservationRepository({ sql: fromPgLike(c), clock }) }, finish);
  } finally {
    if (!finished) await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}
/** True when the promise is still unsettled after `ms`: the statement is waiting on a lock. */
const pending = async (p: Promise<unknown>, ms = 400) => {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  await new Promise(r => setTimeout(r, ms));
  return !settled;
};

describe.skipIf(!hasDatabase)('schedule archive vs reservation (2B.2 follow-up)', () => {
  beforeAll(async () => {
    await ensureSchema(); // 010 + 030 + 031
    if (process.env.SCHEDULING_TEST_SKIP_MIGRATE !== '1') await runScript(sqlFile('032_schedule_archive_ordering.sql'));
  });
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
    await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1');
  });

  const hire = (repo: PostgresReservationRepository, time: string) => repo.create(w.staff, slotBooking('court-1', FUTURE, time, 60, w.hire));
  const q = (text: string, params: unknown[] = []) => getPool().query(text, params);

  it('a schedule archive in flight holds a reservation back, which is then refused (offering_unavailable)', async () => {
    await inTransaction(async (tx, finish) => {
      expect(await tx.config.archiveSchedule(w.staff, w.hire.schedule)).toBe(true); // uncommitted
      const racing = hire(w.repo, '10:00');
      expect(await pending(racing)).toBe(true);
      await finish();
      expect(reasonOf(await racing)).toBe('offering_unavailable');
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });
  });

  it('a reservation in flight holds the schedule archive back; the archive then succeeds and the reservation stands', async () => {
    await inTransaction(async (tx, finish) => {
      booked(await hire(tx.repo, '10:00'));
      const racing = w.config.archiveSchedule(w.staff, w.hire.schedule);
      expect(await pending(racing)).toBe(true);
      await finish();
      expect(await racing).toBe(true);
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(1);
    });
  });

  it('after the archive has committed, a reservation is refused, and so is a raw INSERT (SCARC)', async () => {
    expect(await w.config.archiveSchedule(w.staff, w.hire.schedule)).toBe(true);
    expect(reasonOf(await hire(w.repo, '10:00'))).toBe('offering_unavailable');
    const code = await q(
      `INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, timezone,
         local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, status, currency)
       VALUES ('raw-1', $1, $2, 'resource_hire', 1, $3, 'slot', 'court-1', 'Raw', 'Australia/Adelaide', '2035-06-12', '10:00', '2035-06-12', '11:00', '2035-06-12T00:30:00Z', '2035-06-12T01:30:00Z', 1, 'confirmed', 'AUD')`,
      [ORG, w.hire.schedule, w.hire.offering],
    ).then(() => null, (e: { code?: string }) => e.code ?? 'no-code');
    expect(code).toBe('SCARC');
  });

  it('the schedule-level lock joins no cycle: bookings, schedule and offering edits and archives racing never deadlock', async () => {
    const errors: string[] = [];
    const allowed = ['not_found', 'lifecycle_violation', 'offering_unavailable', 'invalid_input', 'conflict', 'resource_conflict', 'capacity_exceeded', 'stale_write'];
    const note = (label: string) => (e: unknown) => {
      const code = (e as { code?: string }).code ?? String(e);
      if (!allowed.includes(code)) errors.push(`${label}:${code}`);
    };
    for (let round = 0; round < 40; round++) {
      await resetData();
      w = await makeWorld(ORG, staff(ORG));
      await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1');
      const schedule = (await w.config.getSchedule(w.staff, w.hire.schedule))!;
      const offering = (await w.config.listOfferings(w.staff, w.hire.schedule)).find(o => o.id === w.hire.offering)!;
      await Promise.all([
        hire(w.repo, '09:00').catch(note('book-1')),
        hire(w.repo, '11:00').catch(note('book-2')),
        hire(w.repo, '13:00').catch(note('book-3')),
        w.config.archiveSchedule(w.staff, w.hire.schedule).catch(note('archive-schedule')),
        w.config.updateSchedule(w.staff, w.hire.schedule, schedule.updatedAt, { name: `Renamed ${round}` }).catch(note('update-schedule')),
        w.config.updateOffering(w.staff, w.hire.offering, offering.updatedAt, { name: `Offering ${round}` } as never).catch(note('update-offering')),
        w.config.archiveOffering(w.staff, w.hire.offering).catch(note('archive-offering')),
      ]);
      // every reservation that exists holds exactly one live hold: nothing half-written was left by a refused or waiting racer
      const orphans = await q(
        `SELECT v.id FROM scheduling_reservations v
          WHERE (SELECT count(*) FROM scheduling_resource_holds h WHERE h.organisation_id = v.organisation_id AND h.reservation_id = v.id AND h.released_at IS NULL) <> 1`,
      );
      expect(orphans.rows, `round ${round}: a reservation without exactly one live hold`).toEqual([]);
    }
    expect(errors, 'unexpected errors (a 40P01 deadlock would show here)').toEqual([]);
  }, 180_000);
});
