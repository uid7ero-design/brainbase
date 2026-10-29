import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SchedulingError, buildOfferingCalendar, type AvailabilityExceptionInput, type AvailabilityRule, type StoredAvailabilityException, type StoredAvailabilityRule } from '@scheduling/core';
import { PostgresAvailabilityRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { slotBooking, makeWorld, type World } from './support/builders';
import { closePool, count, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOccurrence, seedResource, seedSchedule, sqlFile, staff } from './support/pgHarness';

// Phase 2B.3d on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2b3d.sh on 16 and 17): the READ side the availability calendar
// stands on. listLiveHoldsForResources must return exactly the live holds of this tenant's resources that overlap a half-open range, and the whole
// read path (rules, closures, pinned zones, linked resources, holds) fed into the shared calendar model must give the calendar a person expects.
//   - The read never writes: a content hash of every Scheduling table, the pinned zones and the audit log is the same after it.
//   - Another organisation's resource ids and rows are invisible; a caller without scheduling.view is refused.
//   - Reference calendar: Australia/Adelaide +10:30 in summer, clocks forward Sun 2026-10-04 (that day is 23 hours); Australia/Perth +08:00.

const A = 'org-cal-a';
const B = 'org-cal-b';
const tenantA = staff(A);
const viewerA = staff(A, ['scheduling.view']);
const nobodyA = staff(A, []);
const tenantB = staff(B);
const suite = hasDatabase ? describe : describe.skip;

let avail: PostgresAvailabilityRepository;
let config: PostgresSchedulingConfigRepository;
let world: World;

const SCHEDULING_TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules',
  'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences', 'scheduling_settings',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of [...SCHEDULING_TABLES, 'organisations']) {
    out.push((await getPool().query(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`)).rows[0].h as string);
  }
  return out;
};

const coreRule = (org: string, r: StoredAvailabilityRule): AvailabilityRule => ({
  id: r.id, organisationId: org, resourceId: r.resourceId, offeringId: r.offeringId, dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, validFrom: r.validFrom, validTo: r.validTo,
});
const coreException = (org: string, e: StoredAvailabilityException): AvailabilityExceptionInput => ({
  id: e.id, organisationId: org, resourceId: e.resourceId, offeringId: e.offeringId, fromDate: e.fromDate, toDate: e.toDate, kind: e.kind, reason: e.reason,
  ...(e.startTime !== null && e.endTime !== null ? { windows: [{ startTime: e.startTime, endTime: e.endTime }] } : {}),
});
const hours = (over: Partial<{ dayOfWeek: number; startTime: string; endTime: string }> = {}) => ({ kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });

suite('availability calendar read path on real PostgreSQL', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql')); // partial-day closures, applied to this DISPOSABLE database exactly as the owner will
    await resetData();
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
    config = new PostgresSchedulingConfigRepository({ sql: fromPgLike(getPool()) });
  }, 60_000);
  afterAll(async () => {
    await runScript(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await resetData();
    await getPool().query('DELETE FROM organisations WHERE id IN ($1, $2)', [A, B]).catch(() => undefined);
    await closePool();
  });
  beforeEach(async () => {
    await resetData();
    for (const org of [A, B]) await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [org, 'Australia/Adelaide']);
    world = await makeWorld(A, tenantA);
    await seedSchedule(B, 'sch-b', 'resource_hire');
    await seedResource(B, 'court-b');
  });

  const book = async (resourceId: string, date: string, time: string, minutes: number) => {
    const r = await world.repo.create(tenantA, slotBooking(resourceId, date, time, minutes, world.hire));
    expect(r.ok, JSON.stringify(r)).toBe(true);
  };

  describe('listLiveHoldsForResources', () => {
    it('returns the live holds that overlap the half-open range, in time order, labelled by what holds them', async () => {
      await book('court-1', '2026-12-07', '10:00', 60); // 10:00-11:00 Adelaide (+10:30) = 2026-12-06T23:30Z - 2026-12-07T00:30Z
      await book('court-1', '2026-12-07', '14:00', 60);
      await seedOccurrence({ id: 'occ-1', org: A, offeringId: world.cls.offering, capacity: 5, resourceId: 'court-1', startsAt: '2026-12-07T06:30:00Z', endsAt: '2026-12-07T07:30:00Z' }); // 17:00-18:00 Adelaide: a scheduled session
      const holds = await config.listLiveHoldsForResources(tenantA, ['court-1'], '2026-12-06T13:30:00Z', '2026-12-07T13:30:00Z');
      expect(holds.map(h => h.startsAt)).toEqual(['2026-12-06T23:30:00Z', '2026-12-07T03:30:00Z', '2026-12-07T06:30:00Z']);
      expect(holds.filter(h => h.reservationId !== null)).toHaveLength(2);
      expect(holds.filter(h => h.occurrenceId !== null)).toHaveLength(1);
      expect(holds.every(h => h.releasedAt === null)).toBe(true);
      expect([...holds].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))).toEqual(holds);
    });

    it('a hold that ends exactly when the range starts, or starts exactly when it ends, is not returned (half-open on both sides)', async () => {
      await book('court-1', '2026-12-07', '10:00', 60); // [2026-12-06T23:30Z, 2026-12-07T00:30Z)
      expect(await config.listLiveHoldsForResources(tenantA, ['court-1'], '2026-12-07T00:30:00Z', '2026-12-07T05:00:00Z')).toEqual([]);
      expect(await config.listLiveHoldsForResources(tenantA, ['court-1'], '2026-12-06T20:00:00Z', '2026-12-06T23:30:00Z')).toEqual([]);
      expect(await config.listLiveHoldsForResources(tenantA, ['court-1'], '2026-12-07T00:29:00Z', '2026-12-07T05:00:00Z')).toHaveLength(1);
      expect(await config.listLiveHoldsForResources(tenantA, ['court-1'], '2026-12-06T20:00:00Z', '2026-12-06T23:31:00Z')).toHaveLength(1);
    });

    it('released holds are not occupied time', async () => {
      await book('court-1', '2026-12-07', '10:00', 60);
      await getPool().query("UPDATE scheduling_resource_holds SET released_at = now() WHERE organisation_id = $1", [A]);
      expect(await config.listLiveHoldsForResources(tenantA, ['court-1'], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z')).toEqual([]);
    });

    it('only the named resources are read, an empty list reads nothing, and another organisation’s resource ids match nothing', async () => {
      await seedResource(A, 'court-2');
      await book('court-1', '2026-12-07', '10:00', 60);
      expect(await config.listLiveHoldsForResources(tenantA, ['court-2'], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z')).toEqual([]);
      expect(await config.listLiveHoldsForResources(tenantA, [], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z')).toEqual([]);
      // org B has its own court and its own hold; org A cannot see it by id, and org B cannot see org A's
      await getPool().query('INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, $1, NULL, 60, 0, $4)', ['off-b', B, 'sch-b', 'AUD']);
      await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [B, 'off-b', 'court-b']);
      await seedOccurrence({ id: 'occ-b', org: B, offeringId: 'off-b', capacity: 1, resourceId: 'court-b', startsAt: '2026-12-07T01:00:00Z', endsAt: '2026-12-07T02:00:00Z' });
      expect(await config.listLiveHoldsForResources(tenantA, ['court-b', 'court-1'], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z').then(h => h.map(x => x.resourceId))).toEqual(['court-1']);
      expect(await config.listLiveHoldsForResources(tenantB, ['court-b', 'court-1'], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z').then(h => h.map(x => x.resourceId))).toEqual(['court-b']);
    });

    it('needs scheduling.view: a viewer may read, a caller without it is refused', async () => {
      await book('court-1', '2026-12-07', '10:00', 60);
      expect(await config.listLiveHoldsForResources(viewerA, ['court-1'], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z')).toHaveLength(1);
      await expect(config.listLiveHoldsForResources(nobodyA, ['court-1'], '2026-12-06T00:00:00Z', '2026-12-08T00:00:00Z')).rejects.toBeInstanceOf(SchedulingError);
    });
  });

  describe('the whole read path, fed to the shared calendar model', () => {
    // Offering: Monday 09:00-17:00 Adelaide. Resource: Monday 09:00-17:00 pinned to PERTH (Mon 01:00Z-09:00Z); shared 01:00Z-06:30Z (summer).
    const buildFor = async (offeringId: string, fromDate: string, toDate: string) => {
      const offering = (await config.getOffering(tenantA, offeringId))!;
      const schedule = (await config.getSchedule(tenantA, offering.scheduleId))!;
      const offeringZone = (await avail.getZone(tenantA, { kind: 'offering', id: offeringId }))?.timezone ?? schedule.timezone ?? 'Australia/Adelaide';
      const linked = await config.listOfferingResources(tenantA, offeringId);
      const per = await Promise.all(linked.map(async r => ({
        r,
        rules: (await avail.listRules(tenantA, { kind: 'resource', id: r.id })).map(x => coreRule(A, x)),
        exceptions: (await avail.listExceptions(tenantA, { kind: 'resource', id: r.id })).map(x => coreException(A, x)),
        zone: await avail.getZone(tenantA, { kind: 'resource', id: r.id }),
      })));
      const holds = await config.listLiveHoldsForResources(tenantA, linked.map(r => r.id), '2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
      return buildOfferingCalendar({
        timezone: offeringZone, pinned: true, fromDate, toDate,
        offering: { id: offering.id, name: offering.name, archivedAt: offering.archivedAt, durationMinutes: offering.durationMinutes },
        offeringRules: (await avail.listRules(tenantA, { kind: 'offering', id: offeringId })).map(x => coreRule(A, x)),
        offeringExceptions: (await avail.listExceptions(tenantA, { kind: 'offering', id: offeringId })).map(x => coreException(A, x)),
        resources: per.map(p => ({ resource: { id: p.r.id, active: p.r.active }, name: p.r.name, rules: p.rules, exceptions: p.exceptions, holds: holds.filter(h => h.resourceId === p.r.id), timezone: p.zone?.timezone ?? 'Australia/Adelaide', pinned: p.zone !== null })),
      });
    };

    it('a Perth-pinned resource and an Adelaide offering: each read in its own zone, holds subtracted, slots only where all agree', async () => {
      expect((await avail.createRule(tenantA, { kind: 'offering', id: world.hire.offering }, hours(), 'Australia/Adelaide')).ok).toBe(true);
      expect((await avail.createRule(tenantA, { kind: 'resource', id: 'court-1' }, hours(), 'Australia/Perth')).ok).toBe(true);
      await book('court-1', '2027-01-11', '10:00', 60); // Mon 10:00-11:00 Adelaide = 2027-01-10T23:30Z - 2027-01-11T00:30Z: before the resource opens (Perth 09:00 = 01:00Z)
      await book('court-1', '2027-01-11', '12:00', 60); // 12:00-13:00 Adelaide = 01:30Z - 02:30Z: inside the shared time
      const view = await buildFor(world.hire.offering, '2027-01-11', '2027-01-11');
      if (!view.ok) throw new Error(view.problems.join(';'));
      const court = view.lanes.find(l => l.id === 'court-1')!;
      expect(court.timezone).toBe('Australia/Perth');
      expect(court.hours).toEqual([{ startsAt: '2027-01-11T01:00:00Z', endsAt: '2027-01-11T09:00:00Z' }]);
      // both holds are occupied time, even the 10:00 one that falls before the resource opens (it is still held); only the second one takes free time away
      expect(court.occupied.map(o => [o.startsAt, o.endsAt, o.kind])).toEqual([['2027-01-10T23:30:00Z', '2027-01-11T00:30:00Z', 'reservation'], ['2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z', 'reservation']]);
      expect(court.free).toEqual([{ startsAt: '2027-01-11T01:00:00Z', endsAt: '2027-01-11T01:30:00Z' }, { startsAt: '2027-01-11T02:30:00Z', endsAt: '2027-01-11T06:30:00Z' }]);
      // the offering's grid is anchored at ITS window start (22:30Z): 01:30Z and 02:30Z hold slots; 02:30Z-03:30Z is the first free hour after the hold
      expect(view.slots.map(s => s.startsAt)).toEqual(['2027-01-11T02:30:00Z', '2027-01-11T03:30:00Z', '2027-01-11T04:30:00Z', '2027-01-11T05:30:00Z']);
    });

    it('missing availability: an offering with no rules and a resource with no rules are drawn as unavailable, never as open', async () => {
      const view = await buildFor(world.hire.offering, '2027-01-11', '2027-01-17');
      if (!view.ok) throw new Error(view.problems.join(';'));
      expect(view.lanes.every(l => l.state === 'no_hours')).toBe(true);
      expect(view.slots).toEqual([]);
    });

    it('the Adelaide daylight-saving day is 23 hours and Sunday 01:00-05:00 lasts 3 hours, from stored rules', async () => {
      await avail.createRule(tenantA, { kind: 'offering', id: world.hire.offering }, hours({ dayOfWeek: 0, startTime: '01:00', endTime: '05:00' }), 'Australia/Adelaide');
      const view = await buildFor(world.hire.offering, '2026-10-04', '2026-10-04');
      if (!view.ok) throw new Error(view.problems.join(';'));
      expect(view.days[0].minutes).toBe(1380);
      expect(view.lanes[0].hours).toEqual([{ startsAt: '2026-10-03T15:30:00Z', endsAt: '2026-10-03T18:30:00Z' }]);
    });

    it('a stored partial-day closure and a whole-day closure are drawn as closed time', async () => {
      await avail.createRule(tenantA, { kind: 'offering', id: world.hire.offering }, hours(), 'Australia/Adelaide');
      const partial = await avail.createException(tenantA, { kind: 'offering', id: world.hire.offering }, { fromDate: '2027-01-11', toDate: '2027-01-11', kind: 'closed', reason: null, startTime: '12:00', endTime: '13:00' });
      expect(partial.ok).toBe(true);
      expect((await avail.createException(tenantA, { kind: 'offering', id: world.hire.offering }, { fromDate: '2027-01-18', toDate: '2027-01-18', kind: 'closed', reason: null })).ok).toBe(true);
      const view = await buildFor(world.hire.offering, '2027-01-11', '2027-01-18');
      if (!view.ok) throw new Error(view.problems.join(';'));
      expect(view.lanes[0].closed).toContainEqual({ startsAt: '2027-01-11T01:30:00Z', endsAt: '2027-01-11T02:30:00Z' }); // the partial-day closure, 12:00-13:00
      expect(view.lanes[0].closed).toContainEqual({ startsAt: '2027-01-17T22:30:00Z', endsAt: '2027-01-18T06:30:00Z' }); // the whole Monday 18th
      expect(view.slots.some(s => s.startsAt.startsWith('2027-01-18'))).toBe(false);
    });
  });

  describe('the read path writes nothing', () => {
    it('listing holds, rules, closures, zones and linked resources leaves every Scheduling table, the organisations and the audit log byte-identical', async () => {
      await avail.createRule(tenantA, { kind: 'offering', id: world.hire.offering }, hours(), 'Australia/Adelaide');
      await avail.createRule(tenantA, { kind: 'resource', id: 'court-1' }, hours(), 'Australia/Adelaide');
      await book('court-1', '2027-01-11', '12:00', 60);
      const before = await hashAll();
      const auditBefore = await count('SELECT count(*) FROM audit_logs').catch(() => 0);
      for (let i = 0; i < 3; i++) {
        await config.listLiveHoldsForResources(tenantA, ['court-1'], '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z');
        await avail.listRules(tenantA, { kind: 'resource', id: 'court-1' });
        await avail.listExceptions(tenantA, { kind: 'offering', id: world.hire.offering });
        await avail.getZone(tenantA, { kind: 'resource', id: 'court-1' });
        await config.listOfferingResources(tenantA, world.hire.offering);
      }
      expect(await hashAll()).toEqual(before);
      expect(await count('SELECT count(*) FROM audit_logs').catch(() => 0)).toBe(auditBefore);
      expect(await count('SELECT count(*) FROM scheduling_availability_zones')).toBe(2);
    });

    it('reading an owner that has no hours does not pin its zone', async () => {
      expect(await avail.getZone(tenantA, { kind: 'offering', id: world.hire.offering })).toBeNull();
      await config.listLiveHoldsForResources(tenantA, ['court-1'], '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z');
      expect(await count('SELECT count(*) FROM scheduling_availability_zones')).toBe(0);
    });
  });
});
