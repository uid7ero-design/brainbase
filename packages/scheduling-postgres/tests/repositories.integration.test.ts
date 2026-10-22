import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS, SchedulingError, defaultScheduleConfig, type CreateReservationResult } from '@scheduling/core';
import { PostgresReservationRepository } from '@scheduling/postgres';
import { FixedClock, closePool, count, customerActor, ensureSchema, getPool, hasDatabase, publicActor, resetData, seedClass, seedResource, seedSchedule, seedOffering, sql, staff } from './support/pgHarness';
import { TZ, classBooking, makeWorld, person, slotBooking, stayBooking, type World } from './support/builders';

const ORG = 'org-p';
let w: World;
const ok = (r: CreateReservationResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.reservation;
};
const thrown = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as SchedulingError;
  }
  throw new Error('expected a rejection');
};

describe.skipIf(!hasDatabase)('config repository', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
  });

  const scheduleInput = (over: Record<string, unknown> = {}) => {
    const d = defaultScheduleConfig({ id: 'x', organisationId: ORG, name: 'Restaurant', presetKey: 'restaurant_tables' });
    return { name: d.name, presetKey: d.presetKey, presetVersion: d.presetVersion, terminology: d.terminology, cancellationPolicy: d.cancellationPolicy, timezone: null, publicSlug: 'dine', ...over };
  };

  it('stores settings per organisation and never a timezone (host-owned)', async () => {
    const saved = await w.config.saveSettings(w.staff, { currency: 'AUD' });
    expect(saved.timezone).toBeNull();
    await w.config.saveSettings(w.staff, { currency: 'NZD' });
    expect((await w.config.getSettings(w.staff))?.currency).toBe('NZD');
    expect(await w.config.getSettings(staff('org-other'))).toBeNull();
    expect(await thrown(w.config.saveSettings(w.staff, { currency: 'aud' }))).toMatchObject({ code: 'invalid_input' });
  });

  it('creates schedules with their own preset, version, terminology and timezone override; round-trips them', async () => {
    const a = await w.config.createSchedule(w.staff, scheduleInput({ timezone: 'Australia/Perth', terminology: { reservationPlural: 'Covers' } }));
    const b = await w.config.createSchedule(w.staff, scheduleInput({ name: 'Coaching', presetKey: 'classes_coaching', presetVersion: PRESETS.classes_coaching.version, publicSlug: null }));
    expect(await w.config.getSchedule(w.staff, a.id)).toMatchObject({ presetKey: 'restaurant_tables', timezone: 'Australia/Perth', publicSlug: 'dine', terminology: { reservationPlural: 'Covers' } });
    expect(await w.config.getSchedule(w.staff, b.id)).toMatchObject({ presetKey: 'classes_coaching', timezone: null, publicSlug: null });
    expect((await w.config.listSchedules(w.staff)).map(s => s.presetKey).sort()).toEqual(['accommodation', 'appointments', 'classes_coaching', 'classes_coaching', 'resource_hire', 'restaurant_tables']);
  });

  it('validates in the domain before touching SQL: bad timezone, slug, policy and preset version', async () => {
    for (const bad of [{ timezone: 'Mars/Olympus' }, { publicSlug: 'Not A Slug' }, { presetVersion: 99 }, { name: '  ' }]) {
      expect(await thrown(w.config.createSchedule(w.staff, scheduleInput(bad)))).toMatchObject({ code: 'invalid_input' });
    }
    expect(await count("SELECT count(*) FROM scheduling_schedules WHERE name = 'Restaurant'")).toBe(0);
  });

  it('a duplicate public slug is a conflict; the same slug in another organisation is fine', async () => {
    await w.config.createSchedule(w.staff, scheduleInput());
    expect(await thrown(w.config.createSchedule(w.staff, scheduleInput()))).toMatchObject({ code: 'conflict' });
    await new PostgresReservationRepository({ sql: sql(), clock: new FixedClock() }); // sanity: construction is side-effect free
    const other = await makeWorld('org-q', staff('org-q'));
    await other.config.createSchedule(other.staff, scheduleInput());
  });

  it('writes need scheduling.manage; reads need scheduling.view; the analyst role (no permissions) sees nothing', async () => {
    const viewer = staff(ORG, ['scheduling.view']);
    const nobody = staff(ORG, []);
    expect(await thrown(w.config.createSchedule(viewer, scheduleInput()))).toMatchObject({ code: 'permission_denied' });
    expect(await thrown(w.config.createResource(viewer, { kind: 'court', name: 'C', capacity: 1, minParty: null, active: true }))).toMatchObject({ code: 'permission_denied' });
    expect(await w.config.listSchedules(viewer)).toHaveLength(4);
    expect(await thrown(w.config.listSchedules(nobody))).toMatchObject({ code: 'permission_denied' });
    expect(await thrown(w.config.listResources(nobody))).toMatchObject({ code: 'permission_denied' });
  });

  it('a public actor reads only PUBLISHED schedules and their offerings, never resources, and can write nothing', async () => {
    const published = await w.config.createSchedule(w.staff, scheduleInput({ publicSlug: 'classes', presetKey: 'classes_coaching', presetVersion: 1, name: 'Public classes' }));
    const hidden = await w.config.createSchedule(w.staff, scheduleInput({ publicSlug: null, presetKey: 'classes_coaching', presetVersion: 1, name: 'Staff only' }));
    const offering = await w.config.createOffering(w.staff, published.id, { scheduleId: published.id, name: 'Beginner', typeKey: null, colourKey: null, durationMinutes: 60, capacity: 8, price: { amountCents: 2500, currency: 'AUD' }, startTime: null, recurrence: { kind: 'none' } });
    const hiddenOffering = await w.config.createOffering(w.staff, hidden.id, { scheduleId: hidden.id, name: 'Secret', typeKey: null, colourKey: null, durationMinutes: 60, capacity: 8, price: { amountCents: 0, currency: 'AUD' }, startTime: null, recurrence: { kind: 'none' } });
    const pub = publicActor(ORG);
    expect((await w.config.listSchedules(pub)).map(s => s.id)).toEqual([published.id]);
    expect(await w.config.getSchedule(pub, hidden.id)).toBeNull();
    expect((await w.config.findScheduleByPublicSlug(pub, 'classes'))?.id).toBe(published.id);
    expect(await w.config.getOffering(pub, offering.id)).not.toBeNull();
    expect(await w.config.getOffering(pub, hiddenOffering.id)).toBeNull();
    expect(await thrown(w.config.listResources(pub))).toMatchObject({ code: 'permission_denied' });
    expect(await thrown(w.config.createSchedule(pub, scheduleInput({ publicSlug: 'x' })))).toMatchObject({ code: 'permission_denied' });
    // an archived schedule disappears from the public view
    await w.config.archiveSchedule(w.staff, published.id);
    expect(await w.config.findScheduleByPublicSlug(pub, 'classes')).toBeNull();
  });

  it('tenant scoping: another organisation sees none of it, even by exact id', async () => {
    const s = await w.config.createSchedule(w.staff, scheduleInput());
    const other = staff('org-other');
    expect(await w.config.getSchedule(other, s.id)).toBeNull();
    expect(await w.config.listSchedules(other)).toEqual([]);
    expect(await w.config.archiveSchedule(other, s.id)).toBe(false);
    expect(await thrown(w.config.createOffering(other, s.id, { scheduleId: s.id, name: 'X', typeKey: null, colourKey: null, durationMinutes: 30, capacity: null, price: { amountCents: 0, currency: 'AUD' }, startTime: null, recurrence: { kind: 'none' } }))).toMatchObject({ code: 'not_found' });
  });

  it('offerings round-trip weekly recurrence and derive resourceKinds from linked resources', async () => {
    const s = await w.config.createSchedule(w.staff, scheduleInput({ presetKey: 'classes_coaching', presetVersion: 1, publicSlug: null, name: 'Coaching' }));
    const o = await w.config.createOffering(w.staff, s.id, {
      scheduleId: s.id, name: 'Squad', typeKey: 'squad', colourKey: 'green', durationMinutes: 60, capacity: 8, price: { amountCents: 3000, currency: 'AUD' }, startTime: '16:00',
      recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-02', end: { mode: 'after_occurrences', count: 10 } },
    });
    expect(o.recurrence).toEqual({ kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-02', end: { mode: 'after_occurrences', count: 10 } });
    expect(o.startTime).toBe('16:00');
    expect(o.resourceKinds).toEqual([]);
    await w.config.linkOfferingResource(w.staff, o.id, 'court-1');
    await w.config.linkOfferingResource(w.staff, o.id, 'court-1'); // idempotent
    expect((await w.config.getOffering(w.staff, o.id))?.resourceKinds).toEqual(['court']);
    expect(await thrown(w.config.createOffering(w.staff, s.id, { ...o, name: 'Bad', recurrence: { kind: 'weekly', dayOfWeek: 9, startDate: null, end: { mode: 'ongoing' } } }))).toMatchObject({ code: 'invalid_input' });
  });

  it('an offering cannot be linked to another tenant\'s resource', async () => {
    await seedResource('org-other', 'their-court', 'court');
    await expect(w.config.linkOfferingResource(w.staff, w.cls.offering, 'their-court')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('availability rules and exceptions are validated and tenant-scoped', async () => {
    const rule = await w.config.addAvailabilityRule(w.staff, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, dayOfWeek: 1, startTime: '08:00', endTime: '20:00', validFrom: null, validTo: null, kind: 'hours', label: null });
    expect((await w.config.listAvailabilityRules(w.staff, 'resource', 'court-1')).map(r => r.id)).toEqual([rule.id]);
    expect(await thrown(w.config.addAvailabilityRule(w.staff, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, dayOfWeek: 1, startTime: '20:00', endTime: '08:00', validFrom: null, validTo: null, kind: 'hours', label: null }))).toMatchObject({ code: 'invalid_input' });
    await w.config.addAvailabilityException(w.staff, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, fromDate: '2026-12-25', toDate: '2026-12-26', kind: 'closed', reason: 'Christmas' });
    expect(await thrown(w.config.addAvailabilityException(w.staff, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, fromDate: '2026-12-26', toDate: '2026-12-25', kind: 'closed', reason: null }))).toMatchObject({ code: 'invalid_input' });
    expect(await w.config.listAvailabilityRules(staff('org-other'), 'resource', 'court-1')).toEqual([]);
    expect(await thrown(w.config.addAvailabilityRule(staff('org-other'), 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, dayOfWeek: 1, startTime: '08:00', endTime: '09:00', validFrom: null, validTo: null, kind: 'hours', label: null }))).toMatchObject({ code: 'not_found' });
  });

  it('occurrences: created with their court hold, duplicates and court clashes reported softly (not thrown)', async () => {
    const base = { offeringId: w.cls.offering, resourceId: 'court-1', date: '2026-12-10', startTime: '16:30', timezone: TZ, startsAt: '2026-12-10T06:00:00Z', endsAt: '2026-12-10T07:00:00Z', capacity: 8 };
    const first = await w.config.createOccurrence(w.staff, base);
    expect(first).toMatchObject({ ok: true, occurrence: { date: '2026-12-10', startTime: '16:30', durationMinutes: 60, capacity: 8, status: 'scheduled', resourceId: 'court-1' } });
    expect(await w.config.createOccurrence(w.staff, base)).toEqual({ ok: false, reason: 'duplicate_occurrence' });
    expect(await w.config.createOccurrence(w.staff, { ...base, date: '2026-12-10', startTime: '17:00', startsAt: '2026-12-10T06:30:00Z', endsAt: '2026-12-10T07:30:00Z' })).toEqual({ ok: false, reason: 'resource_conflict' });
    expect(await w.config.createOccurrence(w.staff, { ...base, offeringId: 'nope' })).toEqual({ ok: false, reason: 'not_found' });
    const listed = await w.config.listOccurrences(w.staff, w.cls.offering, '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(listed).toHaveLength(1);
  });

  it('weekly occurrences keep their LOCAL time across both DST changes while the UTC instant moves', async () => {
    const mk = (date: string, startsAt: string, endsAt: string) => w.config.createOccurrence(w.staff, { offeringId: w.cls.offering, resourceId: null, date, startTime: '16:00', timezone: TZ, startsAt, endsAt, capacity: 8 });
    // 16:00 Adelaide: +10:30 before 5 Apr and after 4 Oct, +09:30 between.
    ok2(await mk('2026-03-29', '2026-03-29T05:30:00Z', '2026-03-29T06:30:00Z'));
    ok2(await mk('2026-04-12', '2026-04-12T06:30:00Z', '2026-04-12T07:30:00Z'));
    ok2(await mk('2026-10-11', '2026-10-11T05:30:00Z', '2026-10-11T06:30:00Z'));
    const rows = (await getPool().query("SELECT local_date::text AS d, to_char(local_start_time, 'HH24:MI') AS t, to_char(starts_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc FROM scheduling_occurrences ORDER BY local_date")).rows;
    expect(rows.map(r => r.t)).toEqual(['16:00', '16:00', '16:00']);
    expect(rows.map(r => r.utc)).toEqual(['05:30', '06:30', '05:30']);
  });

  it('series and pauses: tenant-scoped, validated, ordered', async () => {
    const series = await w.config.createSeries(w.staff, { offeringId: w.cls.offering, customerId: null, customerName: 'Sam', customerEmail: ' Sam@Example.com ', customerPhone: null, timezone: TZ });
    expect(series.customerEmailNormalised).toBe('sam@example.com');
    const p1 = await w.config.addSeriesPause(w.staff, series.id, { pauseFrom: '2026-12-20', pauseUntil: '2027-01-10', reason: 'holiday' });
    expect(p1).toMatchObject({ pauseFrom: '2026-12-20', pauseUntil: '2027-01-10' });
    expect(await thrown(w.config.addSeriesPause(w.staff, series.id, { pauseFrom: '2027-01-10', pauseUntil: '2026-12-20', reason: null }))).toMatchObject({ code: 'invalid_input' });
    expect(await w.config.addSeriesPause(staff('org-other'), series.id, { pauseFrom: '2026-12-20', pauseUntil: '2027-01-10', reason: null })).toBeNull();
    expect(await w.config.getSeries(staff('org-other'), series.id)).toBeNull();
    expect((await w.config.listSeriesPauses(w.staff, series.id)).map(p => p.id)).toEqual([p1!.id]);
  });
});

function ok2(r: { ok: boolean }) {
  expect(r.ok).toBe(true);
}

describe.skipIf(!hasDatabase)('reservation repository: actors, validation and lifecycle', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  let clock: FixedClock;
  beforeEach(async () => {
    await resetData();
    clock = new FixedClock(new Date('2026-11-01T00:00:00Z'));
    w = await makeWorld(ORG, staff(ORG), clock);
    await seedClass(ORG, { schedule: 'pub-s', offering: 'pub-o', occurrence: 'pub-c' }, 5, { publicSlug: 'classes' });
  });

  const pubIds = { schedule: 'pub-s', offering: 'pub-o' };

  it('a PUBLIC actor can book a published schedule but not an unpublished one', async () => {
    const pub = publicActor(ORG);
    const r = ok(await w.repo.create(pub, classBooking('pub-c', pubIds)));
    expect(r.organisationId).toBe(ORG); // stamped from the authenticated tenant, never from input
    await seedClass(ORG, { schedule: 'priv-s', offering: 'priv-o', occurrence: 'priv-c' }, 5);
    expect(await w.repo.create(pub, classBooking('priv-c', { schedule: 'priv-s', offering: 'priv-o' }))).toEqual({ ok: false, reason: 'offering_unavailable' });
  });

  it('a public actor cannot read reservations, list them or set attendance', async () => {
    const pub = publicActor(ORG);
    const r = ok(await w.repo.create(pub, classBooking('pub-c', pubIds)));
    expect(await w.repo.getById(pub, r.id)).toBeNull();
    expect(await thrown(w.repo.listForOccurrence(pub, 'pub-c'))).toMatchObject({ code: 'permission_denied' });
    expect(await thrown(w.repo.setAttendance(pub, r.id, 'attended'))).toMatchObject({ code: 'permission_denied' });
    expect(await w.repo.cancel(pub, { reservationId: r.id, cancelledBy: 'customer', reason: null, scope: 'this_occurrence' })).toEqual({ status: 'rejected', reason: 'not_found' });
  });

  it('staff without scheduling.reserve cannot create; without scheduling.attendance cannot mark attendance', async () => {
    const viewer = staff(ORG, ['scheduling.view']);
    expect(await thrown(w.repo.create(viewer, classBooking('pub-c', pubIds)))).toMatchObject({ code: 'permission_denied' });
    const r = ok(await w.repo.create(w.staff, classBooking('pub-c', pubIds)));
    expect(await thrown(w.repo.setAttendance(viewer, r.id, 'attended'))).toMatchObject({ code: 'permission_denied' });
    expect((await w.repo.setAttendance(w.staff, r.id, 'late'))?.attendance).toBe('late');
  });

  it('unknown or foreign offerings are not_found; an inconsistent schedule/offering pair is not_found too', async () => {
    expect(await w.repo.create(w.staff, classBooking('pub-c', { schedule: 'pub-s', offering: 'missing' }))).toEqual({ ok: false, reason: 'not_found' });
    expect(await w.repo.create(w.staff, classBooking('pub-c', { schedule: w.hire.schedule, offering: 'pub-o' }))).toEqual({ ok: false, reason: 'not_found' });
  });

  it('an archived schedule takes no new bookings', async () => {
    await w.config.archiveSchedule(w.staff, 'pub-s');
    expect(await w.repo.create(w.staff, classBooking('pub-c', pubIds))).toEqual({ ok: false, reason: 'offering_unavailable' });
  });

  it('domain validation runs before SQL and reports every problem', async () => {
    const bad = classBooking('pub-c', pubIds, { customerSnapshot: { displayName: ' ', email: 'x', emailNormalised: 'WRONG', phone: null }, timezone: 'Mars/Olympus', partySize: 0 });
    const err = await thrown(w.repo.create(w.staff, bad));
    expect(err).toMatchObject({ code: 'invalid_input' });
    expect(err.message.split('; ').length).toBeGreaterThan(1);
    expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
  });

  it('preset rules are enforced in the domain: a hire booking needs a slot span and a resource; a class takes no resource', async () => {
    const noResource = slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire, { resourceId: null });
    expect(await thrown(w.repo.create(w.staff, noResource))).toMatchObject({ code: 'invalid_input' });
    const wrongSpan = slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire, { span: { kind: 'stay', checkIn: '2026-12-07', checkOut: '2026-12-08' } });
    expect(await thrown(w.repo.create(w.staff, wrongSpan))).toMatchObject({ code: 'invalid_input' });
    const classWithResource = classBooking('pub-c', pubIds, { resourceId: 'court-1' });
    expect(await thrown(w.repo.create(w.staff, classWithResource))).toMatchObject({ code: 'invalid_input' });
  });

  it('a staff-entered slot in the spring-forward gap is rejected with a clear message (the database would resolve it silently)', async () => {
    // 4 Oct 2026 02:30 does not exist in Adelaide.
    const gap = slotBooking('court-1', '2026-10-04', '02:30', 60, w.hire, { instants: { startsAt: '2026-10-03T17:00:00Z', endsAt: '2026-10-03T18:00:00Z' } });
    const err = await thrown(w.repo.create(w.staff, gap));
    expect(err).toMatchObject({ code: 'invalid_input' });
    expect(err.message).toMatch(/does not exist/);
  });

  it('a slot whose local time disagrees with its instants is rejected', async () => {
    const wrong = slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire, { instants: { startsAt: '2026-12-07T06:00:00Z', endsAt: '2026-12-07T07:00:00Z' } });
    expect(await thrown(w.repo.create(w.staff, wrong))).toMatchObject({ code: 'invalid_input' });
  });

  it('a fall-back ambiguous slot resolves to the EARLIER instant and is accepted', async () => {
    // 5 Apr 2026 02:30 happens twice; the earlier is 2026-04-04T16:00:00Z (+10:30).
    const r = ok(await w.repo.create(w.staff, slotBooking('court-1', '2026-04-05', '02:30', 60, w.hire)));
    expect(r.instants.startsAt).toBe('2026-04-04T16:00:00Z');
  });

  it('the snapshot of a reservation survives reconfiguring its schedule and editing the customer elsewhere', async () => {
    const r = ok(await w.repo.create(w.staff, classBooking('pub-c', pubIds, { customerId: 'cust-1', customerSnapshot: person('Pat Original', 'pat@example.com') })));
    await getPool().query("UPDATE scheduling_schedules SET name = 'Renamed', preset_version = 1, terminology = '{\"reservation\": \"Booking\"}'::jsonb WHERE id = 'pub-s'");
    const again = await w.repo.getById(w.staff, r.id);
    expect(again?.customerSnapshot.displayName).toBe('Pat Original');
    expect(again?.presetKey).toBe('classes_coaching');
    expect(again?.timezone).toBe(TZ);
    expect(again?.instants).toEqual(r.instants);
  });

  describe('cancellation rules', () => {
    it('a customer may cancel only their own booking, only if the schedule allows it, and only before it starts', async () => {
      const r = ok(await w.repo.create(w.staff, classBooking('pub-c', pubIds, { customerId: 'cust-1' })));
      const me = customerActor(ORG, 'cust-1');
      const someoneElse = customerActor(ORG, 'cust-2');
      expect(await w.repo.cancel(someoneElse, { reservationId: r.id, cancelledBy: 'customer', reason: null, scope: 'this_occurrence' })).toEqual({ status: 'rejected', reason: 'not_found' });
      await getPool().query(`UPDATE scheduling_schedules SET cancellation_policy = jsonb_set(cancellation_policy, '{customerCanCancel}', 'false') WHERE id = 'pub-s'`);
      expect(await w.repo.cancel(me, { reservationId: r.id, cancelledBy: 'customer', reason: null, scope: 'this_occurrence' })).toEqual({ status: 'rejected', reason: 'not_permitted' });
      await getPool().query(`UPDATE scheduling_schedules SET cancellation_policy = jsonb_set(cancellation_policy, '{customerCanCancel}', 'true') WHERE id = 'pub-s'`);
      clock.current = new Date('2026-12-08T00:00:00Z'); // after the class
      expect(await w.repo.cancel(me, { reservationId: r.id, cancelledBy: 'customer', reason: null, scope: 'this_occurrence' })).toEqual({ status: 'rejected', reason: 'in_the_past' });
      clock.current = new Date('2026-11-01T00:00:00Z');
      expect(await w.repo.cancel(me, { reservationId: r.id, cancelledBy: 'customer', reason: 'ill', scope: 'this_occurrence' })).toMatchObject({ status: 'cancelled', charge: null });
      expect(await w.repo.cancel(me, { reservationId: r.id, cancelledBy: 'customer', reason: null, scope: 'this_occurrence' })).toEqual({ status: 'rejected', reason: 'already_cancelled' });
    });

    it('a customer actor sees only their own reservations', async () => {
      const mine = ok(await w.repo.create(w.staff, classBooking('pub-c', pubIds, { customerId: 'cust-1' })));
      const theirs = ok(await w.repo.create(w.staff, classBooking('pub-c', pubIds, { customerId: 'cust-2' })));
      const me = customerActor(ORG, 'cust-1');
      expect((await w.repo.getById(me, mine.id))?.id).toBe(mine.id);
      expect(await w.repo.getById(me, theirs.id)).toBeNull();
      expect((await w.repo.listForCustomer(me, 'cust-1')).map(r => r.id)).toEqual([mine.id]);
      expect(await thrown(w.repo.listForCustomer(me, 'cust-2'))).toMatchObject({ code: 'permission_denied' });
    });

    it('cancel this_and_future cancels the rest of a series, not the past or other series', async () => {
      const series = await w.config.createSeries(w.staff, { offeringId: 'pub-o', customerId: 'cust-1', customerName: 'Sam', customerEmail: null, customerPhone: null, timezone: TZ });
      const other = await w.config.createSeries(w.staff, { offeringId: 'pub-o', customerId: 'cust-2', customerName: 'Pat', customerEmail: null, customerPhone: null, timezone: TZ });
      const occ = async (n: number) => {
        const day = `2026-12-${String(14 + n * 7 - 7).padStart(2, '0')}`;
        const startsAt = `${day}T05:30:00Z`;
        const endsAt = `${day}T06:30:00Z`;
        const id = `wk-${n}`;
        await w.config.createOccurrence(w.staff, { offeringId: 'pub-o', resourceId: null, date: day, startTime: '16:00', timezone: TZ, startsAt, endsAt, capacity: 5 });
        const created = await getPool().query('SELECT id FROM scheduling_occurrences WHERE offering_id = $1 AND local_date = $2', ['pub-o', day]);
        void id;
        return { id: created.rows[0].id as string, startsAt, endsAt };
      };
      const weeks = [await occ(1), await occ(2), await occ(3)];
      const mine = [];
      for (const wk of weeks) mine.push(ok(await w.repo.create(w.staff, classBooking(wk.id, pubIds, { seriesId: series.id, customerId: 'cust-1', customerSnapshot: person('Sam', null), instants: { startsAt: wk.startsAt, endsAt: wk.endsAt } }))));
      const theirs = ok(await w.repo.create(w.staff, classBooking(weeks[2].id, pubIds, { seriesId: other.id, customerId: 'cust-2', customerSnapshot: person('Pat', null), instants: { startsAt: weeks[2].startsAt, endsAt: weeks[2].endsAt } })));
      const out = await w.repo.cancel(w.staff, { reservationId: mine[1].id, cancelledBy: 'staff', reason: 'moved away', scope: 'this_and_future' });
      expect(out).toMatchObject({ status: 'cancelled', cancelledReservationIds: [mine[1].id, mine[2].id].sort() });
      expect((await w.repo.getById(w.staff, mine[0].id))?.status).toBe('confirmed');
      expect((await w.repo.getById(w.staff, theirs.id))?.status).toBe('confirmed');
      // the series is also unique per occurrence
      expect(await w.repo.create(w.staff, classBooking(weeks[0].id, pubIds, { seriesId: series.id, customerId: 'cust-9', customerSnapshot: person('Z', null), instants: { startsAt: weeks[0].startsAt, endsAt: weeks[0].endsAt } }))).toEqual({ ok: false, reason: 'duplicate_reservation' });
    });
  });

  it('stays and slots: an appointments schedule works the same way through the same table', async () => {
    await seedSchedule(ORG, 'appt', 'appointments');
    await seedOffering(ORG, 'appt-o', 'appt', { capacity: null });
    await seedResource(ORG, 'dr-1', 'practitioner');
    const input = slotBooking('dr-1', '2026-12-07', '10:00', 30, { schedule: 'appt', offering: 'appt-o' }, { presetKey: 'appointments', presetVersion: PRESETS.appointments.version, price: { amountCents: 9000, currency: 'AUD' } });
    ok(await w.repo.create(w.staff, input));
    expect(await w.repo.create(w.staff, input)).toEqual({ ok: false, reason: 'resource_conflict' });
    const room = stayBooking('room-1', '2026-12-07', '2026-12-08', w.stay);
    ok(await w.repo.create(w.staff, room));
  });
});
