import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateReservationResult } from '@scheduling/core';
import { closePool, count, ensureSchema, getPool, hasDatabase, resetData, seedResource, staff } from './support/pgHarness';
import { liveHolds, makeWorld, slotBooking, stayBooking, type World } from './support/builders';

// Exclusive resources: overlap, adjacency, hotel boundaries, cancellation release,
// reactivation refusal, tenant scoping. All against the real exclusion constraint.

const ORG = 'org-x';
let w: World;

const ok = (r: CreateReservationResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.reservation;
};

describe.skipIf(!hasDatabase)('exclusive resources (exclusion constraint)', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
  });

  it('creates the reservation and its hold in one statement', async () => {
    const r = ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    const holds = await w.config.listHoldsForReservation(w.staff, r.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ resourceId: 'court-1', startsAt: r.instants.startsAt, endsAt: r.instants.endsAt, releasedAt: null });
  });

  it('rejects identical, overlapping, contained and containing ranges with resource_conflict', async () => {
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 120, w.hire)));
    for (const [time, minutes] of [['16:00', 120], ['15:00', 90], ['17:30', 60], ['16:30', 30], ['15:00', 240]] as const) {
      expect(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', time, minutes, w.hire))).toEqual({ ok: false, reason: 'resource_conflict' });
    }
    expect(await liveHolds(ORG, 'court-1')).toBe(1);
  });

  it('accepts back-to-back bookings (half-open ranges) on both sides', async () => {
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '17:00', 60, w.hire)));
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '15:00', 60, w.hire)));
    expect(await liveHolds(ORG, 'court-1')).toBe(3);
  });

  it('is scoped by resource: the same time on another resource is fine', async () => {
    await seedResource(ORG, 'court-2', 'court');
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    ok(await w.repo.create(w.staff, slotBooking('court-2', '2026-12-07', '16:00', 60, w.hire)));
  });

  it('is scoped by organisation: the SAME resource id and range in two tenants never conflict', async () => {
    const other = await makeWorld('org-y', staff('org-y'));
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    ok(await other.repo.create(other.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, other.hire)));
    expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE resource_id = 'court-1'")).toBe(2);
  });

  it("rejects another tenant's resource as not_found, whatever the id", async () => {
    await seedResource('org-y', 'only-y-court', 'court');
    const r = await w.repo.create(w.staff, slotBooking('only-y-court', '2026-12-07', '16:00', 60, w.hire));
    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    expect(await count('SELECT count(*) FROM scheduling_resource_holds')).toBe(0);
  });

  it('refuses an inactive resource without writing anything', async () => {
    await seedResource(ORG, 'court-off', 'court', { active: false });
    expect(await w.repo.create(w.staff, slotBooking('court-off', '2026-12-07', '16:00', 60, w.hire))).toEqual({ ok: false, reason: 'offering_unavailable' });
    expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
  });

  it('cancelling releases the hold in the same statement, and the slot can be booked again', async () => {
    const first = ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    expect(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire))).toEqual({ ok: false, reason: 'resource_conflict' });
    const out = await w.repo.cancel(w.staff, { reservationId: first.id, cancelledBy: 'staff', reason: 'changed mind', scope: 'this_occurrence' });
    expect(out).toMatchObject({ status: 'cancelled', cancelledReservationIds: [first.id] });
    const holds = await w.config.listHoldsForReservation(w.staff, first.id);
    expect(holds[0].releasedAt).not.toBeNull();
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    expect(await liveHolds(ORG, 'court-1')).toBe(1);
  });

  it('a cancelled reservation can never be revived, and neither can its released hold', async () => {
    const first = ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    await w.repo.cancel(w.staff, { reservationId: first.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
    // the slot is taken by someone else...
    ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire)));
    // ...so neither route back to the old booking is allowed
    const pool = getPool();
    await expect(pool.query("UPDATE scheduling_reservations SET status = 'confirmed', cancelled_at = NULL WHERE id = $1", [first.id])).rejects.toMatchObject({ code: 'SCLIF' });
    await expect(pool.query('UPDATE scheduling_resource_holds SET released_at = NULL WHERE reservation_id = $1', [first.id])).rejects.toMatchObject({ code: 'SCREA' });
    expect(await liveHolds(ORG, 'court-1')).toBe(1);
  });

  describe('hotel stays (accommodation)', () => {
    it('same-day turnover works: out at 10:00, next guest in at 14:00', async () => {
      ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-12-07', '2026-12-09', w.stay)));
      ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-12-09', '2026-12-11', w.stay)));
      expect(await liveHolds(ORG, 'room-1')).toBe(2);
    });

    it('an overlapping night is refused, including a stay inside another and the night before check-out', async () => {
      ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-12-07', '2026-12-10', w.stay)));
      for (const [a, b] of [['2026-12-08', '2026-12-09'], ['2026-12-06', '2026-12-08'], ['2026-12-09', '2026-12-12'], ['2026-12-07', '2026-12-10']] as const) {
        expect(await w.repo.create(w.staff, stayBooking('room-1', a, b, w.stay))).toEqual({ ok: false, reason: 'resource_conflict' });
      }
    });

    it('a late check-out that crosses the next guest\'s check-in is a conflict', async () => {
      ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-12-07', '2026-12-09', w.stay, { outTime: '15:00' })));
      expect(await w.repo.create(w.staff, stayBooking('room-1', '2026-12-09', '2026-12-11', w.stay))).toEqual({ ok: false, reason: 'resource_conflict' });
    });

    it('works across both Adelaide DST changeovers (nights are local dates)', async () => {
      // DST ends 5 Apr 2026 (the stay below is 45 real hours) and starts 4 Oct 2026 (43 real hours).
      const a = ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-04-04', '2026-04-06', w.stay)));
      ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-04-06', '2026-04-08', w.stay)));
      const b = ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-10-03', '2026-10-05', w.stay)));
      ok(await w.repo.create(w.staff, stayBooking('room-1', '2026-10-05', '2026-10-07', w.stay)));
      const hours = (r: { instants: { startsAt: string; endsAt: string } }) => (Date.parse(r.instants.endsAt) - Date.parse(r.instants.startsAt)) / 3600000;
      expect(hours(a)).toBe(45);
      expect(hours(b)).toBe(43);
      // the stored local fields are the wall clock, not the UTC shift
      const rows = (await getPool().query("SELECT local_start_date::text AS d, to_char(local_start_time, 'HH24:MI') AS t, to_char(local_end_time, 'HH24:MI') AS e FROM scheduling_reservations WHERE id = ANY($1)", [[a.id, b.id]])).rows;
      for (const row of rows) expect([row.t, row.e]).toEqual(['14:00', '10:00']);
    });
  });
});
