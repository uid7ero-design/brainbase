import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateAssignedReservationResult } from '@scheduling/core';
import { SchedulingError } from '@scheduling/core';
import { closePool, count, customerActor, ensureSchema, getPool, hasDatabase, publicActor, resetData, seedResource, seedSchedule, staff } from './support/pgHarness';
import { appointmentBooking, liveHolds, makeWorld, type World } from './support/builders';

// Appointments preset v2: every appointment holds a concrete internal resource (a practitioner,
// a room or an explicitly modelled virtual capacity). The customer may name a provider or let
// the repository assign one; either way the resource is never created during booking.

const ORG = 'org-appt';
let w: World;
const DATE = '2026-12-08';
const link = (org: string, offering: string, resource: string) =>
  getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [org, offering, resource]);
const resourceCount = () => count('SELECT count(*) FROM scheduling_resources');
const ok = (r: CreateAssignedReservationResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r;
};

describe.skipIf(!hasDatabase)('appointments: a concrete resource for every confirmed appointment', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
    await seedResource(ORG, 'dr-a', 'practitioner', { capacity: 1 });
    await seedResource(ORG, 'dr-b', 'practitioner', { capacity: 1 });
    await seedResource(ORG, 'room-x', 'room', { capacity: 1 });
    await seedResource(ORG, 'tele-1', 'virtual', { capacity: 1 });
  });

  describe('explicit provider', () => {
    it('books the named practitioner, and the same practitioner cannot be double-booked', async () => {
      const a = await w.repo.createAssigned(w.staff, appointmentBooking('dr-a', DATE, '10:00', 30, w.appt));
      expect(ok(a).reservation.resourceId).toBe('dr-a');
      expect(a.ok && a.assigned).toBe(false);
      expect(await w.repo.createAssigned(w.staff, appointmentBooking('dr-a', DATE, '10:15', 30, w.appt))).toEqual({ ok: false, reason: 'resource_conflict' });
      expect(ok(await w.repo.createAssigned(w.staff, appointmentBooking('dr-a', DATE, '10:30', 30, w.appt))).reservation.resourceId).toBe('dr-a'); // abutting is fine
      expect(await liveHolds(ORG, 'dr-a')).toBe(2);
    });

    it('supports a room and an explicitly modelled virtual capacity exactly like a practitioner', async () => {
      for (const resource of ['room-x', 'tele-1']) {
        ok(await w.repo.createAssigned(w.staff, appointmentBooking(resource, DATE, '11:00', 30, w.appt)));
        expect(await w.repo.createAssigned(w.staff, appointmentBooking(resource, DATE, '11:00', 30, w.appt))).toEqual({ ok: false, reason: 'resource_conflict' });
      }
    });

    it('a kind the preset does not accept (a court) is refused, and so is an inactive resource, without writing anything', async () => {
      await seedResource(ORG, 'court-1', 'court'); // already seeded by the world; harmless
      expect(await w.repo.createAssigned(w.staff, appointmentBooking('court-1', DATE, '09:00', 30, w.appt))).toEqual({ ok: false, reason: 'offering_unavailable' });
      await seedResource(ORG, 'dr-off', 'practitioner', { active: false });
      expect(await w.repo.createAssigned(w.staff, appointmentBooking('dr-off', DATE, '09:00', 30, w.appt))).toEqual({ ok: false, reason: 'offering_unavailable' });
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });

    it("another organisation's resource is not_found, indistinguishable from a missing one", async () => {
      await seedResource('org-other', 'dr-z', 'practitioner');
      expect(await w.repo.createAssigned(w.staff, appointmentBooking('dr-z', DATE, '09:00', 30, w.appt))).toEqual({ ok: false, reason: 'not_found' });
      expect(await w.repo.createAssigned(w.staff, appointmentBooking('nobody', DATE, '09:00', 30, w.appt))).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe('automatic assignment', () => {
    beforeEach(async () => {
      for (const r of ['dr-a', 'dr-b', 'tele-1']) await link(ORG, w.appt.offering, r);
    });

    it('assigns a linked, free resource; the customer never supplied one', async () => {
      const r = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt)));
      expect(r.assigned).toBe(true);
      expect(['dr-a', 'dr-b', 'tele-1']).toContain(r.reservation.resourceId);
      expect(await liveHolds(ORG, r.reservation.resourceId as string)).toBe(1);
    });

    it('fills resources one by one for the same slot, then reports resource_conflict (no free provider)', async () => {
      const used = new Set<string>();
      for (let i = 0; i < 3; i++) used.add(ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt))).reservation.resourceId as string);
      expect([...used].sort()).toEqual(['dr-a', 'dr-b', 'tele-1']);
      expect(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt))).toEqual({ ok: false, reason: 'resource_conflict' });
    });

    it('never creates a resource and never uses an unlinked, inactive or wrong-kind one', async () => {
      await seedResource(ORG, 'dr-unlinked', 'practitioner'); // exists, linked only to a different offering
      await link(ORG, w.cls.offering, 'dr-unlinked');
      await seedResource(ORG, 'dr-inactive', 'practitioner', { active: false });
      await link(ORG, w.appt.offering, 'dr-inactive');
      await link(ORG, w.appt.offering, 'court-1'); // linked but not a kind appointments accept
      const before = await resourceCount();
      const used = new Set<string>();
      for (let i = 0; i < 3; i++) used.add(ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '12:00', 30, w.appt))).reservation.resourceId as string);
      expect([...used].sort()).toEqual(['dr-a', 'dr-b', 'tele-1']);
      expect(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '12:00', 30, w.appt))).toEqual({ ok: false, reason: 'resource_conflict' });
      expect(await resourceCount()).toBe(before);
    });

    it('an offering with no usable resource is offering_unavailable (a configuration gap), not "fully booked"', async () => {
      await getPool().query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1', [ORG]);
      expect(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt))).toEqual({ ok: false, reason: 'offering_unavailable' });
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });

    it('prefers the less-booked resource so work spreads out', async () => {
      ok(await w.repo.createAssigned(w.staff, appointmentBooking('dr-a', DATE, '09:00', 30, w.appt)));
      ok(await w.repo.createAssigned(w.staff, appointmentBooking('dr-a', DATE, '09:30', 30, w.appt)));
      const r = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt)));
      expect(r.reservation.resourceId).not.toBe('dr-a');
    });

    it('a cancelled appointment frees its resource for the next assignment', async () => {
      const taken: string[] = [];
      for (let i = 0; i < 3; i++) taken.push(ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '14:00', 30, w.appt))).reservation.resourceId as string);
      const first = (await getPool().query("SELECT id FROM scheduling_reservations WHERE resource_id = $1 AND status <> 'cancelled'", [taken[0]])).rows[0].id as string;
      expect((await w.repo.cancel(w.staff, { reservationId: first, scope: 'this_occurrence', cancelledBy: 'staff', reason: null })).status).toBe('cancelled');
      expect(ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '14:00', 30, w.appt))).reservation.resourceId).toBe(taken[0]);
    });

    it('20 racers for 3 resources and one slot: exactly 3 win, one per resource, the rest get resource_conflict, nobody errors', async () => {
      const settled = await Promise.allSettled(Array.from({ length: 20 }, () => w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '16:00', 30, w.appt))));
      expect(settled.filter(s => s.status === 'rejected')).toEqual([]);
      const results = settled.map(s => (s as PromiseFulfilledResult<CreateAssignedReservationResult>).value);
      const winners = results.filter(r => r.ok);
      expect(winners).toHaveLength(3);
      expect(new Set(winners.map(r => r.ok && r.reservation.resourceId)).size).toBe(3);
      expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'resource_conflict')).toBe(true);
    });

    it('a repeated request with the same idempotency key returns the original reservation and never takes a second resource', async () => {
      const first = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt, { idempotencyKey: 'k-1' })));
      const retry = { idempotencyKey: 'k-1', customerSnapshot: first.reservation.customerSnapshot }; // a retry resends the same request
      const again = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt, retry)));
      expect(again.replayed).toBe(true);
      expect(again.reservation.id).toBe(first.reservation.id);
      const racing = await Promise.all(Array.from({ length: 10 }, () => w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '11:00', 30, w.appt, { idempotencyKey: 'k-2', customerSnapshot: first.reservation.customerSnapshot }))));
      expect(racing.every(r => r.ok)).toBe(true);
      expect(new Set(racing.map(r => r.ok && r.reservation.id)).size).toBe(1);
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE released_at IS NULL AND reservation_id IN (SELECT id FROM scheduling_reservations WHERE idempotency_key = 'k-2')")).toBe(1);
    });

    it('the same key for a different request is refused, never merged', async () => {
      const first = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt, { idempotencyKey: 'k-3' })));
      expect(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '13:00', 30, w.appt, { idempotencyKey: 'k-3', customerSnapshot: first.reservation.customerSnapshot }))).toEqual({ ok: false, reason: 'duplicate_reservation' });
    });

    it('the stored reservation always names a concrete resource and carries the v2 snapshot', async () => {
      const r = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt)));
      const row = (await getPool().query('SELECT resource_id, preset_version, span_kind, status FROM scheduling_reservations WHERE id = $1', [r.reservation.id])).rows[0];
      expect(row).toMatchObject({ preset_version: 2, span_kind: 'slot' });
      expect(row.resource_id).toBeTruthy();
      expect(['pending', 'confirmed']).toContain(row.status);
    });
  });

  describe('input rules', () => {
    it('only exclusive-resource presets take an assigned resource', async () => {
      await expect(w.repo.createAssigned(w.staff, { ...appointmentBooking(null, DATE, '10:00', 30, w.cls), presetKey: 'classes_coaching', presetVersion: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    });

    it('createAssigned needs the same permission as create', async () => {
      await expect(w.repo.createAssigned(staff(ORG, ['scheduling.view']), appointmentBooking(null, DATE, '10:00', 30, w.appt))).rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('create() itself still refuses a resourceless appointment (domain validation, before any SQL)', async () => {
      await expect(w.repo.create(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt))).rejects.toBeInstanceOf(SchedulingError);
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });
  });

  describe('existing schedules', () => {
    it('a schedule stamped preset v1 books under the current rule: a resource is still required', async () => {
      await getPool().query("UPDATE scheduling_schedules SET preset_version = 1 WHERE organisation_id = $1 AND id = $2", [ORG, w.appt.schedule]);
      await link(ORG, w.appt.offering, 'dr-a');
      const r = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt, { presetVersion: 1 })));
      expect(r.reservation.resourceId).toBe('dr-a');
      expect(r.reservation.presetVersion).toBe(1); // the snapshot records the version the schedule had
    });
  });

  describe('customers and the public', () => {
    beforeEach(async () => {
      await link(ORG, w.appt.offering, 'dr-a');
    });

    it('cannot book an unpublished schedule, assigned or not', async () => {
      expect(await w.repo.createAssigned(publicActor(ORG), appointmentBooking(null, DATE, '10:00', 30, w.appt))).toEqual({ ok: false, reason: 'offering_unavailable' });
    });

    it('on a published schedule the public gets an assigned provider without naming one, and may name only a linked, active one', async () => {
      await getPool().query("UPDATE scheduling_schedules SET public_slug = 'clinic' WHERE organisation_id = $1 AND id = $2", [ORG, w.appt.schedule]);
      const auto = ok(await w.repo.createAssigned(publicActor(ORG), appointmentBooking(null, DATE, '10:00', 30, w.appt)));
      expect(auto.reservation.resourceId).toBe('dr-a');
      // dr-b exists but is not offered on this service: a customer cannot pick it, staff can
      expect(await w.repo.createAssigned(customerActor(ORG, 'cust-9'), appointmentBooking('dr-b', DATE, '11:00', 30, w.appt))).toEqual({ ok: false, reason: 'offering_unavailable' });
      expect(await w.repo.create(customerActor(ORG, 'cust-9'), appointmentBooking('dr-b', DATE, '11:00', 30, w.appt))).toEqual({ ok: false, reason: 'offering_unavailable' });
      expect(ok(await w.repo.createAssigned(w.staff, appointmentBooking('dr-b', DATE, '11:00', 30, w.appt))).reservation.resourceId).toBe('dr-b');
      expect(await count("SELECT count(*) FROM scheduling_reservations WHERE resource_id = 'dr-b'")).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('two organisations with identical ids assign only their own resources', async () => {
      await seedSchedule('org-two', 'sched-appt', 'appointments');
      const two = await makeWorld('org-two', staff('org-two'));
      await seedResource('org-two', 'dr-a', 'practitioner');
      await link(ORG, w.appt.offering, 'dr-a');
      await link('org-two', two.appt.offering, 'dr-a');
      const a = ok(await w.repo.createAssigned(w.staff, appointmentBooking(null, DATE, '10:00', 30, w.appt)));
      const b = ok(await two.repo.createAssigned(two.staff, appointmentBooking(null, DATE, '10:00', 30, two.appt)));
      expect(a.reservation.organisationId).toBe(ORG);
      expect(b.reservation.organisationId).toBe('org-two');
      expect(await liveHolds(ORG, 'dr-a')).toBe(1);
      expect(await liveHolds('org-two', 'dr-a')).toBe(1);
    });
  });
});
