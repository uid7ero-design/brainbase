import { describe, expect, it } from 'vitest';
import {
  CALENDAR_MAX_DAYS,
  buildOfferingCalendar,
  buildResourceCalendar,
  type AvailabilityExceptionInput,
  type CalendarResourceInput,
  type CalendarView,
  type InstantWindow,
  type OfferingCalendarInput,
  type ResourceHold,
} from '../src';
import { rule } from './support/availabilityFixtures';

// Phase 2B.3d: the read-only calendar view model. Reference calendar (checked against the zone database):
//   Australia/Adelaide  +09:30 winter / +10:30 summer. Clocks go FORWARD Sun 2026-10-04 02:00 -> 03:00 (that day is 23 hours) and BACK
//                       Sun 2027-04-04 03:00 -> 02:00 (that day is 25 hours; 02:00-03:00 happens twice).
//   Australia/Perth     +08:00 all year.

const ADL = 'Australia/Adelaide';
const PER = 'Australia/Perth';
const win = (startsAt: string, endsAt: string): InstantWindow => ({ startsAt, endsAt });

const closure = (id: string, owner: { resourceId?: string | null; offeringId?: string | null }, fromDate: string, toDate: string, windows?: AvailabilityExceptionInput['windows']): AvailabilityExceptionInput => ({
  id, organisationId: 'org-1', resourceId: owner.resourceId ?? null, offeringId: owner.offeringId ?? null, fromDate, toDate, kind: 'closed', reason: null, ...(windows ? { windows } : {}),
});
const hold = (id: string, resourceId: string, startsAt: string, endsAt: string, extra: Partial<ResourceHold> = {}): ResourceHold => ({
  id, resourceId, startsAt, endsAt, reservationId: 'resv-1', occurrenceId: null, releasedAt: null, ...extra,
});
const resource = (id: string, over: Partial<CalendarResourceInput> = {}): CalendarResourceInput => ({
  resource: { id, active: true }, name: `Resource ${id}`, rules: [], exceptions: [], holds: [], timezone: ADL, pinned: true, ...over,
});
const resRule = (id: string, resourceId: string, dow: number, startTime: string, endTime: string) => rule(id, { resourceId, offeringId: null, dayOfWeek: dow, startTime, endTime });

function offeringInput(over: Partial<OfferingCalendarInput> = {}): OfferingCalendarInput {
  return {
    timezone: ADL, pinned: true, fromDate: '2027-01-11', toDate: '2027-01-11',
    offering: { id: 'off-1', name: 'Junior Squad', archivedAt: null, durationMinutes: 60 },
    offeringRules: [], offeringExceptions: [], resources: [], ...over,
  };
}
function offering(over: Partial<OfferingCalendarInput> = {}): CalendarView {
  const r = buildOfferingCalendar(offeringInput(over));
  if (!r.ok) throw new Error(`${r.reason}: ${r.problems.join('; ')}`);
  return r;
}
const lane = (v: CalendarView, id: string) => {
  const l = v.lanes.find(x => x.id === id);
  if (!l) throw new Error(`no lane ${id}`);
  return l;
};

describe('days: true lengths and whole-hour ticks in the viewing zone', () => {
  it('a normal day is 24 hours with ticks for hours 0 to 23', () => {
    const v = offering({ fromDate: '2026-10-03', toDate: '2026-10-03' });
    const day = v.days[0];
    expect([day.date, day.dayOfWeek, day.minutes, day.offsetMinutes]).toEqual(['2026-10-03', 6, 1440, 570]);
    expect(day.startsAt).toBe('2026-10-02T14:30:00Z');
    expect(day.ticks.map(t => t.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('the day Adelaide clocks go forward is 23 hours and has no 02:00 tick', () => {
    const v = offering({ fromDate: '2026-10-03', toDate: '2026-10-05' });
    expect(v.days.map(d => [d.date, d.minutes])).toEqual([['2026-10-03', 1440], ['2026-10-04', 1380], ['2026-10-05', 1440]]);
    const spring = v.days[1];
    expect(spring.startsAt).toBe('2026-10-03T14:30:00Z'); // 00:00 at +09:30
    expect(spring.endsAt).toBe('2026-10-04T13:30:00Z'); // the next 00:00 at +10:30
    expect(spring.ticks.map(t => t.hour)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(spring.offsetMinutes).toBe(570);
    expect(v.days[2].offsetMinutes).toBe(630);
  });

  it('the day Adelaide clocks go back is 25 hours and 02:00 appears twice, at two instants', () => {
    const v = offering({ fromDate: '2027-04-04', toDate: '2027-04-04' });
    const fall = v.days[0];
    expect(fall.minutes).toBe(1500);
    expect(fall.startsAt).toBe('2027-04-03T13:30:00Z');
    expect(fall.endsAt).toBe('2027-04-04T14:30:00Z');
    expect(fall.ticks).toHaveLength(25);
    expect(fall.ticks.filter(t => t.hour === 2).map(t => t.at)).toEqual(['2027-04-03T15:30:00Z', '2027-04-03T16:30:00Z']);
  });

  it('a week is seven consecutive local days, each starting where the previous one ended', () => {
    const v = offering({ fromDate: '2026-09-28', toDate: '2026-10-04' });
    expect(v.days).toHaveLength(7);
    expect(v.days.map(d => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    for (let i = 1; i < v.days.length; i++) expect(v.days[i].startsAt).toBe(v.days[i - 1].endsAt);
  });

  it('whole hours are found in a zone with a half-hour offset and in one with a whole-hour offset', () => {
    expect(offering({ timezone: PER, fromDate: '2027-01-11', toDate: '2027-01-11' }).days[0].ticks[0]).toEqual({ at: '2027-01-10T16:00:00Z', hour: 0 });
    expect(offering({ timezone: 'Asia/Kolkata', fromDate: '2027-01-11', toDate: '2027-01-11' }).days[0].ticks[0]).toEqual({ at: '2027-01-10T18:30:00Z', hour: 0 });
  });
});

describe('daylight saving: window-anchored hours keep their wall-clock time and their true elapsed length', () => {
  it('Sunday 01:00-05:00 on the spring-forward day lasts 3 hours, and the slots follow the anchored grid', () => {
    const v = offering({ fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [rule('o', { dayOfWeek: 0, startTime: '01:00', endTime: '05:00' })] });
    expect(lane(v, 'off-1').hours).toEqual([win('2026-10-03T15:30:00Z', '2026-10-03T18:30:00Z')]);
    expect(v.slots.map(s => s.startsAt)).toEqual(['2026-10-03T15:30:00Z', '2026-10-03T16:30:00Z', '2026-10-03T17:30:00Z']);
    expect(v.adjustments).toEqual([]);
  });

  it('a window that begins inside the missing hour opens at the jump, not late, and says so', () => {
    const v = offering({ fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [rule('o', { dayOfWeek: 0, startTime: '02:30', endTime: '05:00' })] });
    expect(lane(v, 'off-1').hours).toEqual([win('2026-10-03T16:30:00Z', '2026-10-03T18:30:00Z')]);
    expect(v.adjustments.map(a => [a.kind, a.owner])).toEqual([['start_in_gap', { kind: 'offering', id: 'off-1' }]]);
  });

  it('a window wholly inside the missing hour is dropped and reported', () => {
    const v = offering({ fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [rule('o', { dayOfWeek: 0, startTime: '02:10', endTime: '02:50' })] });
    expect(lane(v, 'off-1').hours).toEqual([]);
    expect(lane(v, 'off-1').state).toBe('no_hours');
    expect(v.adjustments.some(a => a.kind === 'dropped_in_gap')).toBe(true);
  });

  it('Sunday 01:00-04:00 on the fall-back day lasts 4 hours (the repeated hour counts)', () => {
    const v = offering({ fromDate: '2027-04-04', toDate: '2027-04-04', offeringRules: [rule('o', { dayOfWeek: 0, startTime: '01:00', endTime: '04:00' })] });
    expect(lane(v, 'off-1').hours).toEqual([win('2027-04-03T14:30:00Z', '2027-04-03T18:30:00Z')]);
    expect(v.slots).toHaveLength(4);
  });

  it('a window that starts in the repeated hour opens at its FIRST occurrence and says so', () => {
    const v = offering({ fromDate: '2027-04-04', toDate: '2027-04-04', offeringRules: [rule('o', { dayOfWeek: 0, startTime: '02:00', endTime: '04:00' })] });
    expect(lane(v, 'off-1').hours).toEqual([win('2027-04-03T15:30:00Z', '2027-04-03T18:30:00Z')]);
    expect(v.adjustments.map(a => a.kind)).toContain('start_ambiguous');
  });

  it('the same 09:00 Monday hours are 09:00 local every week, so the UTC instant moves by the hour the clocks moved', () => {
    const rules = [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '10:00' })];
    const before = offering({ fromDate: '2026-09-28', toDate: '2026-09-28', offeringRules: rules });
    const after = offering({ fromDate: '2026-10-05', toDate: '2026-10-05', offeringRules: rules });
    expect(lane(before, 'off-1').hours[0].startsAt).toBe('2026-09-27T23:30:00Z'); // 09:00 at +09:30
    expect(lane(after, 'off-1').hours[0].startsAt).toBe('2026-10-04T22:30:00Z'); // 09:00 at +10:30
  });
});

describe('weekly hours, closures and missing availability', () => {
  const monday = [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })];

  it('no saved hours means no availability, in the lane, the slots and the reasons', () => {
    const v = offering({});
    expect(lane(v, 'off-1')).toMatchObject({ state: 'no_hours', hours: [], closed: [], free: [] });
    expect(v.slots).toEqual([]);
    expect(v.reasons).toEqual(['no_offering_availability']);
  });

  it('Monday 09:00-17:00 shows as open hours with 8 hourly slots when no resource is needed', () => {
    const v = offering({ offeringRules: monday });
    expect(lane(v, 'off-1').state).toBe('open');
    expect(lane(v, 'off-1').hours).toEqual([win('2027-01-10T22:30:00Z', '2027-01-11T06:30:00Z')]);
    expect(lane(v, 'off-1').free).toEqual(lane(v, 'off-1').hours);
    expect(v.slots).toHaveLength(8);
    expect(v.slots.every(s => s.resourceId === null)).toBe(true);
  });

  it('a partial-day closure splits the hours and the removed time is reported as closed', () => {
    const v = offering({ offeringRules: monday, offeringExceptions: [closure('c', { offeringId: 'off-1' }, '2027-01-11', '2027-01-11', [{ startTime: '12:00', endTime: '13:00' }])] });
    expect(lane(v, 'off-1').hours).toEqual([win('2027-01-10T22:30:00Z', '2027-01-11T01:30:00Z'), win('2027-01-11T02:30:00Z', '2027-01-11T06:30:00Z')]);
    expect(lane(v, 'off-1').closed).toEqual([win('2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z')]);
    expect(v.slots.map(s => s.startsAt)).not.toContain('2027-01-11T01:30:00Z');
  });

  it('a whole-day closure removes the day: no hours, the day reported as closed, no slots', () => {
    const v = offering({ offeringRules: monday, offeringExceptions: [closure('c', { offeringId: 'off-1' }, '2027-01-11', '2027-01-11')] });
    expect(lane(v, 'off-1')).toMatchObject({ state: 'no_hours', hours: [] });
    expect(lane(v, 'off-1').closed).toEqual([win('2027-01-10T22:30:00Z', '2027-01-11T06:30:00Z')]);
    expect(v.slots).toEqual([]);
  });

  it('overnight hours (two stored halves) are one continuous interval across midnight', () => {
    const v = offering({
      fromDate: '2027-01-11', toDate: '2027-01-12',
      offeringRules: [rule('a', { dayOfWeek: 1, startTime: '22:00', endTime: '24:00' }), rule('b', { dayOfWeek: 2, startTime: '00:00', endTime: '02:00' })],
    });
    expect(lane(v, 'off-1').hours).toEqual([win('2027-01-11T11:30:00Z', '2027-01-11T15:30:00Z')]);
  });

  it('hours that start before the range and end inside it are clipped to the range', () => {
    const v = offering({
      fromDate: '2027-01-12', toDate: '2027-01-12',
      offeringRules: [rule('a', { dayOfWeek: 1, startTime: '22:00', endTime: '24:00' }), rule('b', { dayOfWeek: 2, startTime: '00:00', endTime: '02:00' })],
    });
    expect(lane(v, 'off-1').hours).toEqual([win('2027-01-11T13:30:00Z', '2027-01-11T15:30:00Z')]);
    expect(v.slots.every(s => Date.parse(s.startsAt) >= Date.parse(v.days[0].startsAt))).toBe(true);
  });

  it('an archived offering has no availability and no slots', () => {
    const v = offering({ offeringRules: monday, offering: { id: 'off-1', name: 'Old', archivedAt: '2027-01-01T00:00:00Z', durationMinutes: 60 } });
    expect(lane(v, 'off-1')).toMatchObject({ state: 'archived', hours: [] });
    expect(v.slots).toEqual([]);
    expect(v.reasons).toContain('offering_archived');
  });

  it('an offering with no duration gets no slots, and says why', () => {
    const v = offering({ offeringRules: monday, offering: { id: 'off-1', name: 'Hall', archivedAt: null, durationMinutes: null } });
    expect(v.slot).toBeNull();
    expect(v.slots).toEqual([]);
    expect(v.reasons).toContain('no_duration');
    expect(lane(v, 'off-1').state).toBe('open');
  });

  it('a step other than the duration changes the grid, still anchored at the start of the window', () => {
    const v = offering({ offeringRules: monday, stepMinutes: 30 });
    expect(v.slot).toEqual({ durationMinutes: 60, stepMinutes: 30 });
    expect(v.slots[0].startsAt).toBe('2027-01-10T22:30:00Z');
    expect(v.slots[1].startsAt).toBe('2027-01-10T23:00:00Z');
    expect(v.slots).toHaveLength(15);
  });
});

describe('resources: intersection with the offering, holds and zones', () => {
  const monday = [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })];

  it('a resource with no hours makes the offering unavailable through it', () => {
    const v = offering({ offeringRules: monday, resources: [resource('court')] });
    expect(lane(v, 'court')).toMatchObject({ state: 'no_hours', hours: [], free: [] });
    expect(v.slots).toEqual([]);
    expect(v.reasons).toContain('resource_no_availability:court');
  });

  it('free time is the offering hours intersected with the resource hours, minus live holds; released holds are ignored', () => {
    const v = offering({
      offeringRules: monday,
      resources: [
        resource('court', {
          rules: [resRule('r', 'court', 1, '08:00', '12:00')],
          holds: [
            hold('h1', 'court', '2027-01-11T00:30:00Z', '2027-01-11T01:30:00Z'), // 11:00-12:00 local
            hold('h2', 'court', '2027-01-10T23:30:00Z', '2027-01-11T00:30:00Z', { releasedAt: '2027-01-01T00:00:00Z' }),
          ],
        }),
      ],
    });
    const court = lane(v, 'court');
    expect(court.hours).toEqual([win('2027-01-10T21:30:00Z', '2027-01-11T01:30:00Z')]); // 08:00-12:00, its own hours
    expect(court.free).toEqual([win('2027-01-10T22:30:00Z', '2027-01-11T00:30:00Z')]); // 09:00-11:00: inside the offering, before the hold
    expect(court.occupied).toEqual([{ startsAt: '2027-01-11T00:30:00Z', endsAt: '2027-01-11T01:30:00Z', kind: 'reservation' }]);
    expect(v.slots.map(s => [s.startsAt, s.resourceId])).toEqual([['2027-01-10T22:30:00Z', 'court'], ['2027-01-10T23:30:00Z', 'court']]);
  });

  it('a hold for a scheduled session is labelled a session, and carries nothing that identifies a booking', () => {
    const v = offering({
      offeringRules: monday,
      resources: [resource('court', { rules: [resRule('r', 'court', 1, '09:00', '17:00')], holds: [hold('h', 'court', '2027-01-11T02:30:00Z', '2027-01-11T03:30:00Z', { reservationId: null, occurrenceId: 'occ-1' })] })],
    });
    expect(lane(v, 'court').occupied).toEqual([{ startsAt: '2027-01-11T02:30:00Z', endsAt: '2027-01-11T03:30:00Z', kind: 'session' }]);
    expect(JSON.stringify(v)).not.toMatch(/resv-1|occ-1|"h"/);
  });

  it('only the shown resource’s holds are drawn: another resource’s hold is ignored', () => {
    const v = offering({
      offeringRules: monday,
      resources: [resource('court', { rules: [resRule('r', 'court', 1, '09:00', '17:00')], holds: [hold('h', 'other', '2027-01-11T02:30:00Z', '2027-01-11T03:30:00Z')] })],
    });
    expect(lane(v, 'court').occupied).toEqual([]);
    expect(lane(v, 'court').free).toEqual(lane(v, 'off-1').hours);
  });

  it('a hold is clipped to the range', () => {
    const v = offering({
      offeringRules: monday,
      resources: [resource('court', { rules: [resRule('r', 'court', 1, '09:00', '17:00')], holds: [hold('h', 'court', '2027-01-10T00:00:00Z', '2027-01-10T20:00:00Z'), hold('g', 'court', '2027-01-11T12:00:00Z', '2027-01-12T20:00:00Z')] })],
    });
    // the Adelaide day is 2027-01-10T13:30Z to 2027-01-11T13:30Z
    expect(lane(v, 'court').occupied).toEqual([
      { startsAt: '2027-01-10T13:30:00Z', endsAt: '2027-01-10T20:00:00Z', kind: 'reservation' },
      { startsAt: '2027-01-11T12:00:00Z', endsAt: '2027-01-11T13:30:00Z', kind: 'reservation' },
    ]);
  });

  it('an inactive resource takes no availability and is drawn as inactive', () => {
    const v = offering({ offeringRules: monday, resources: [resource('court', { resource: { id: 'court', active: false }, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    expect(lane(v, 'court')).toMatchObject({ state: 'inactive', hours: [], free: [] });
    expect(v.slots).toEqual([]);
    expect(v.reasons).toContain('resource_inactive:court');
  });

  it('a Perth resource serves an Adelaide offering where both are open, each read in its own zone', () => {
    // Adelaide Mon 09:00-17:00 summer = Sun 22:30Z - Mon 06:30Z. Perth Mon 09:00-17:00 = Mon 01:00Z - 09:00Z. Shared: 01:00Z-06:30Z.
    const v = offering({ offeringRules: monday, resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    const court = lane(v, 'court');
    expect(court.timezone).toBe(PER);
    expect(court.hours).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T09:00:00Z')]);
    expect(court.free).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T06:30:00Z')]);
    expect(v.timezone).toBe(ADL);
  });

  it('a Perth resource’s hours on the Perth Sunday evening show on the Adelaide Monday: the calendar loses nothing at the range edge', () => {
    // Perth Sun 23:00-24:00 = Sun 15:00Z-16:00Z = Adelaide Mon 01:30-02:30 (summer).
    const v = offering({
      fromDate: '2027-01-11', toDate: '2027-01-11',
      offeringRules: [rule('o', { dayOfWeek: 1, startTime: '00:00', endTime: '24:00' })],
      resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 0, '23:00', '24:00')] })],
    });
    expect(lane(v, 'court').hours).toEqual([win('2027-01-10T15:00:00Z', '2027-01-10T16:00:00Z')]);
  });

  it('a resource shared by offerings in different zones keeps the same instants whichever offering asks', () => {
    const shared = resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '12:00')] });
    const fromAdelaide = offering({ fromDate: '2027-01-11', toDate: '2027-01-11', offeringRules: [rule('o', { dayOfWeek: 1, startTime: '00:00', endTime: '24:00' })], resources: [shared] });
    const fromPerth = offering({ timezone: PER, fromDate: '2027-01-11', toDate: '2027-01-11', offeringRules: [rule('o', { dayOfWeek: 1, startTime: '00:00', endTime: '24:00' })], resources: [shared] });
    expect(lane(fromAdelaide, 'court').hours).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T04:00:00Z')]);
    expect(lane(fromPerth, 'court').hours).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T04:00:00Z')]);
  });

  it('a resource’s partial closure is read in the resource’s zone', () => {
    const v = offering({
      offeringRules: [rule('o', { dayOfWeek: 1, startTime: '00:00', endTime: '24:00' })],
      resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')], exceptions: [closure('c', { resourceId: 'court' }, '2027-01-11', '2027-01-11', [{ startTime: '12:00', endTime: '13:00' }])] })],
    });
    expect(lane(v, 'court').closed).toEqual([win('2027-01-11T04:00:00Z', '2027-01-11T05:00:00Z')]); // 12:00-13:00 Perth
  });

  it('resource lanes are listed by name, after the offering', () => {
    const v = offering({ offeringRules: monday, resources: [resource('b', { name: 'Court B' }), resource('a', { name: 'Court A' })] });
    expect(v.lanes.map(l => l.id)).toEqual(['off-1', 'a', 'b']);
  });
});

describe('resource calendar', () => {
  const base = { timezone: PER, pinned: true, fromDate: '2027-01-11', toDate: '2027-01-17', resource: { id: 'court', name: 'Court 1', active: true }, rules: [resRule('r', 'court', 1, '09:00', '17:00')], exceptions: [], holds: [] };

  it('is drawn in the resource’s own zone with its hours, holds and no slots', () => {
    const r = buildResourceCalendar({ ...base, holds: [hold('h', 'court', '2027-01-11T02:00:00Z', '2027-01-11T03:00:00Z')] });
    if (!r.ok) throw new Error(r.problems.join(';'));
    expect(r.timezone).toBe(PER);
    expect(r.days).toHaveLength(7);
    expect(r.lanes[0]).toMatchObject({ state: 'open', hours: [win('2027-01-11T01:00:00Z', '2027-01-11T09:00:00Z')], occupied: [{ startsAt: '2027-01-11T02:00:00Z', endsAt: '2027-01-11T03:00:00Z', kind: 'reservation' }] });
    expect(r.lanes[0].free).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T02:00:00Z'), win('2027-01-11T03:00:00Z', '2027-01-11T09:00:00Z')]);
    expect(r.slots).toEqual([]);
    expect(r.slot).toBeNull();
  });

  it('with no hours it is unavailable, and an inactive resource is drawn as inactive', () => {
    const none = buildResourceCalendar({ ...base, rules: [] });
    if (!none.ok) throw new Error('invalid');
    expect(none.lanes[0].state).toBe('no_hours');
    expect(none.reasons).toEqual(['no_resource_availability']);
    const off = buildResourceCalendar({ ...base, resource: { id: 'court', name: 'Court 1', active: false } });
    if (!off.ok) throw new Error('invalid');
    expect(off.lanes[0]).toMatchObject({ state: 'inactive', hours: [] });
  });

  it('reads an Adelaide resource through the daylight-saving change', () => {
    const r = buildResourceCalendar({ ...base, timezone: ADL, fromDate: '2026-10-04', toDate: '2026-10-04', rules: [resRule('r', 'court', 0, '01:00', '05:00')] });
    if (!r.ok) throw new Error('invalid');
    expect(r.days[0].minutes).toBe(1380);
    expect(r.lanes[0].hours).toEqual([win('2026-10-03T15:30:00Z', '2026-10-03T18:30:00Z')]);
  });
});

describe('input checks and purity', () => {
  it('refuses a range longer than the calendar allows, a reversed range, a bad date and a bad zone', () => {
    expect(CALENDAR_MAX_DAYS).toBe(14);
    for (const bad of [{ toDate: '2027-02-01' }, { fromDate: '2027-01-12', toDate: '2027-01-11' }, { fromDate: '2027-02-30' }, { timezone: 'Mars/Olympus' }]) {
      const r = buildOfferingCalendar(offeringInput(bad));
      expect(r.ok).toBe(false);
    }
    expect(buildOfferingCalendar(offeringInput({ fromDate: '2027-01-11', toDate: '2027-01-24' })).ok).toBe(true);
  });

  it('refuses overlapping weekly hours rather than drawing them', () => {
    const r = buildOfferingCalendar(offeringInput({ offeringRules: [rule('a', { startTime: '09:00', endTime: '12:00' }), rule('b', { startTime: '11:00', endTime: '14:00' })] }));
    expect(r.ok).toBe(false);
  });

  it('is deterministic, never modifies its input, and the result survives a JSON round trip', () => {
    const input = offeringInput({
      offeringRules: [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })],
      resources: [resource('court', { rules: [resRule('r', 'court', 1, '09:00', '17:00')], holds: [hold('h', 'court', '2027-01-11T02:30:00Z', '2027-01-11T03:30:00Z')] })],
    });
    const frozen = JSON.stringify(input);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(input);
    const a = buildOfferingCalendar(input);
    const b = buildOfferingCalendar(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('exposes no way to create a booking: it returns values only', () => {
    const v = offering({ offeringRules: [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })] });
    for (const s of v.slots) expect(Object.keys(s).sort()).toEqual(['endsAt', 'resourceId', 'startsAt']);
  });
});
