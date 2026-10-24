import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOccurrenceResult, NewOccurrenceInput } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { FixedClock, closePool, count, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOccurrence, seedOffering, seedResource, sqlFile, staff } from './support/pgHarness';
import { TZ, classBooking, makeWorld, type World } from './support/builders';

// Occurrence creation against archive operations and the integrity rules (2B.3, migration 033).
//
// Before 033 (verified against 030+031+032): the repository checked "not archived" only in its own statement WHERE clause (a
// snapshot read with no lock), the database accepted a raw INSERT of an occurrence into an archived offering or schedule, and an
// archive in flight never held an occurrence creation back, so an occurrence could commit after the archive had returned.
// Reservations have had the ordering since 031 (offering) and 032 (schedule). Written FIRST: the archive tests below fail without 033.

const ORG = 'org-oc';
const OTHER = 'org-oc-2';
const clock = new FixedClock();
let w: World;

const reasonOf = (r: CreateOccurrenceResult) => (r.ok ? 'ok' : r.reason);

function occurrenceInput(offeringId: string, day: number, over: Partial<NewOccurrenceInput> = {}): NewOccurrenceInput {
  const d = `2035-06-${String(day).padStart(2, '0')}`;
  return { offeringId, resourceId: null, date: d, startTime: '16:00', timezone: TZ, startsAt: `${d}T05:30:00Z`, endsAt: `${d}T06:30:00Z`, capacity: 8, ...over };
}

async function inTransaction<T>(fn: (tx: { config: PostgresSchedulingConfigRepository }, finish: () => Promise<void>) => Promise<T>): Promise<T> {
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
    return await fn({ config: new PostgresSchedulingConfigRepository({ sql: fromPgLike(c) }) }, finish);
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

describe.skipIf(!hasDatabase)('occurrence integrity (2B.3)', () => {
  beforeAll(async () => {
    await ensureSchema(); // 010 + 030 + 031
    if (process.env.SCHEDULING_TEST_SKIP_MIGRATE !== '1') {
      await runScript(sqlFile('032_schedule_archive_ordering.sql'));
      await runScript(sqlFile('033_occurrence_integrity.sql'));
    }
  });
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
  });

  const q = (text: string, params: unknown[] = []) => getPool().query(text, params);
  const rawInsert = (org: string, offering: string, id: string, resourceId: string | null = null) =>
    q(
      `INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity, status)
       VALUES ($1, $2, $3, $4, '2035-06-20', '16:00', 'Australia/Adelaide', '2035-06-20T05:30:00Z', '2035-06-20T06:30:00Z', 8, 'scheduled')`,
      [id, org, offering, resourceId],
    ).then(() => 'inserted', (e: { code?: string }) => e.code ?? 'no-code');

  describe('no occurrence on an archived offering or schedule', () => {
    it('a raw INSERT into an archived OFFERING is refused (SCARC)', async () => {
      expect(await w.config.archiveOffering(w.staff, w.cls.offering)).toBe(true);
      expect(await rawInsert(ORG, w.cls.offering, 'raw-1')).toBe('SCARC');
      expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(0);
    });

    it('a raw INSERT into an archived SCHEDULE is refused (SCARC)', async () => {
      expect(await w.config.archiveSchedule(w.staff, w.cls.schedule)).toBe(true);
      expect(await rawInsert(ORG, w.cls.offering, 'raw-2')).toBe('SCARC');
      expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(0);
    });

    it('also with a resource, and a live offering still accepts a raw INSERT', async () => {
      expect(await rawInsert(ORG, w.cls.offering, 'raw-ok')).toBe('inserted');
      await q('DELETE FROM scheduling_occurrences'); // the slot is unique per offering; free it for the next insert
      await w.config.archiveOffering(w.staff, w.cls.offering);
      expect(await rawInsert(ORG, w.cls.offering, 'raw-res', 'court-1')).toBe('SCARC');
    });

    it('the repository reports offering_unavailable after either archive has committed', async () => {
      expect(await w.config.archiveOffering(w.staff, w.cls.offering)).toBe(true);
      expect(reasonOf(await w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 10)))).toBe('offering_unavailable');
      await seedOffering(ORG, 'cls-2', w.cls.schedule, { capacity: 10 });
      expect(await w.config.archiveSchedule(w.staff, w.cls.schedule)).toBe(true);
      expect(reasonOf(await w.config.createOccurrence(w.staff, occurrenceInput('cls-2', 10)))).toBe('offering_unavailable');
    });
  });

  describe('an archive and an occurrence creation are serialised', () => {
    it('an OFFERING archive in flight holds createOccurrence back, which is then refused', async () => {
      await inTransaction(async (tx, finish) => {
        expect(await tx.config.archiveOffering(w.staff, w.cls.offering)).toBe(true); // uncommitted
        const racing = w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 11));
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(reasonOf(await racing)).toBe('offering_unavailable');
        expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(0);
      });
    });

    it('a SCHEDULE archive in flight holds createOccurrence back, which is then refused', async () => {
      await inTransaction(async (tx, finish) => {
        expect(await tx.config.archiveSchedule(w.staff, w.cls.schedule)).toBe(true);
        const racing = w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 12));
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(reasonOf(await racing)).toBe('offering_unavailable');
        expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(0);
      });
    });

    it('an occurrence creation in flight holds an OFFERING archive back; the archive then succeeds and the occurrence stands', async () => {
      await inTransaction(async (tx, finish) => {
        expect(reasonOf(await tx.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 13)))).toBe('ok');
        const racing = w.config.archiveOffering(w.staff, w.cls.offering);
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toBe(true);
        expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(1);
      });
    });

    it('an occurrence creation in flight holds a SCHEDULE archive back; the archive then succeeds and the occurrence stands', async () => {
      await inTransaction(async (tx, finish) => {
        expect(reasonOf(await tx.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 14)))).toBe('ok');
        const racing = w.config.archiveSchedule(w.staff, w.cls.schedule);
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toBe(true);
        expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(1);
      });
    });

    it('no new deadlock cycle: occurrences, bookings, edits and both archives racing never deadlock (40 rounds)', async () => {
      const errors: string[] = [];
      const allowed = ['not_found', 'lifecycle_violation', 'offering_unavailable', 'invalid_input', 'conflict', 'resource_conflict', 'capacity_exceeded', 'stale_write', 'duplicate_occurrence', 'duplicate_reservation'];
      const note = (label: string) => (e: unknown) => {
        const code = (e as { code?: string }).code ?? String(e);
        if (!allowed.includes(code)) errors.push(`${label}:${code}`);
      };
      for (let round = 0; round < 40; round++) {
        await resetData();
        w = await makeWorld(ORG, staff(ORG));
        await seedOccurrence({ id: 'seed-occ', org: ORG, offeringId: w.cls.offering, capacity: 3 });
        const schedule = (await w.config.getSchedule(w.staff, w.cls.schedule))!;
        const offering = (await w.config.listOfferings(w.staff, w.cls.schedule)).find(o => o.id === w.cls.offering)!;
        await Promise.all([
          w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 1)).catch(note('occ-1')),
          w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 2, { resourceId: 'court-1' })).catch(note('occ-2')),
          w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 3)).catch(note('occ-3')),
          w.repo.create(w.staff, classBooking('seed-occ', w.cls)).catch(note('book')),
          w.config.archiveSchedule(w.staff, w.cls.schedule).catch(note('archive-schedule')),
          w.config.updateSchedule(w.staff, w.cls.schedule, schedule.updatedAt, { name: `Renamed ${round}` }).catch(note('update-schedule')),
          w.config.updateOffering(w.staff, w.cls.offering, offering.updatedAt, { name: `Offering ${round}` } as never).catch(note('update-offering')),
          w.config.archiveOffering(w.staff, w.cls.offering).catch(note('archive-offering')),
        ]);
      }
      expect(errors, 'unexpected errors (a 40P01 deadlock would show here)').toEqual([]);
    }, 180_000);
  });

  describe('isolation and assignment rules stay consistent', () => {
    it('another organisation cannot be written to, and its archived offering does not affect this one', async () => {
      const other = await makeWorld(OTHER, staff(OTHER));
      await other.config.archiveOffering(other.staff, other.cls.offering);
      // organisation ORG names OTHER's offering: the composite foreign key refuses (23503), the guard does not leak or lock it
      expect(await rawInsert(ORG, other.cls.offering, 'x-org')).toBe('23503');
      expect(reasonOf(await w.config.createOccurrence(w.staff, occurrenceInput(other.cls.offering, 15)))).toBe('not_found');
      // ORG's own offering is unaffected by OTHER's archive
      expect(reasonOf(await w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 15)))).toBe('ok');
      expect(await count('SELECT count(*) FROM scheduling_occurrences WHERE organisation_id = $1', [OTHER])).toBe(0);
    });

    it('a resource the offering is not assigned is still refused (SCLNK), and an assigned or no resource is accepted', async () => {
      await seedResource(ORG, 'court-2', 'court');
      expect(await rawInsert(ORG, w.cls.offering, 'unassigned', 'court-2')).toBe('SCLNK');
      expect(reasonOf(await w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 16)))).toBe('ok'); // no resource
      expect(reasonOf(await w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 17, { resourceId: 'court-1' })))).toBe('ok'); // assigned
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE occurrence_id IS NOT NULL AND released_at IS NULL")).toBe(1);
    });

    it('the guard needs READ COMMITTED for every occurrence, with or without a resource (SCISO)', async () => {
      const c = await getPool().connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const code = await c
          .query(
            `INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
             VALUES ('rr-1', $1, $2, '2035-06-21', '16:00', 'Australia/Adelaide', '2035-06-21T05:30:00Z', '2035-06-21T06:30:00Z', 8)`,
            [ORG, w.cls.offering],
          )
          .then(() => 'inserted', (e: { code?: string }) => e.code);
        expect(code).toBe('SCISO');
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
      }
    });
  });

  describe('classes and coaching capacity is participants, not the resource occupancy', () => {
    it('a class of 12 on a court whose capacity is 4 is accepted and takes exactly 12 bookings', async () => {
      const court = await q("SELECT capacity FROM scheduling_resources WHERE id = 'court-1'");
      expect(court.rows[0].capacity).toBe(4);
      const made = await w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 18, { resourceId: 'court-1', capacity: 12 }));
      expect(made.ok).toBe(true);
      const id = made.ok ? made.occurrence.id : '';
      const window = { startsAt: '2035-06-18T05:30:00Z', endsAt: '2035-06-18T06:30:00Z' };
      for (let i = 0; i < 12; i++) {
        const r = await w.repo.create(w.staff, classBooking(id, w.cls, { instants: window }));
        expect(r.ok, `booking ${i + 1}`).toBe(true);
      }
      const thirteenth = await w.repo.create(w.staff, classBooking(id, w.cls, { instants: window }));
      expect(thirteenth.ok ? 'ok' : thirteenth.reason).toBe('capacity_exceeded'); // participant capacity still binds
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE occurrence_id = $1 AND released_at IS NULL", [id])).toBe(1); // one exclusive hold, however many participants
    });
  });

  describe('existing occurrence lifecycle is preserved', () => {
    it('cancelling an occurrence still works after its offering and schedule are archived (the guard acts on INSERT only)', async () => {
      const made = await w.config.createOccurrence(w.staff, occurrenceInput(w.cls.offering, 19, { resourceId: 'court-1' }));
      const id = made.ok ? made.occurrence.id : '';
      await w.config.archiveSchedule(w.staff, w.cls.schedule);
      expect(await w.config.cancelOccurrence(w.staff, id, 'archived')).toEqual({ cancelledReservationIds: [] });
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE occurrence_id = $1 AND released_at IS NULL", [id])).toBe(0);
    });

    it('duplicate slots and resource conflicts still report their own results', async () => {
      const base = occurrenceInput(w.cls.offering, 22, { resourceId: 'court-1' });
      expect(reasonOf(await w.config.createOccurrence(w.staff, base))).toBe('ok');
      expect(reasonOf(await w.config.createOccurrence(w.staff, base))).toBe('duplicate_occurrence');
      expect(reasonOf(await w.config.createOccurrence(w.staff, { ...base, startTime: '16:10' }))).toBe('resource_conflict');
    });
  });
});
