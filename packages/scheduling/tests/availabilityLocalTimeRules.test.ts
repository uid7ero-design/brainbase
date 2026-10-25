import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  expandOwnerAvailability,
  splitOvernightRule,
  type AvailabilityInput,
  type AvailabilityRule,
  type LocalWindow,
} from '../src';
import { rule as ruleFixture } from './support/availabilityFixtures';

// Phase 2B.3c: the pinned, documented behaviour of LOCAL TIME in availability (docs/architecture/scheduling-phase2b3c-availability-screens.md, section 6).
//   1. A window's start and end are wall-clock times in ONE explicit zone. A time that happens twice (fall-back) resolves to its EARLIER
//      instant, a time that does not exist (spring-forward) to the instant the clock jumps. The window keeps its true elapsed length.
//   2. The slot grid is anchored at the start of each CONTINUOUS operating interval (touching windows, an overnight pair, merge into one) and
//      steps by real elapsed minutes. It is never anchored to the clock, so a window 09:15-12:15 offers 09:15, 10:15 and 11:15.
//   3. A partial-day closure is written in wall-clock times, so closing a repeated hour closes BOTH passes of it.
// Reference calendar, Australia/Adelaide (verified against the zone database):
//   2027-04-04 (Sun): clocks go back at 03:00 ACDT (+10:30) to 02:00 ACST (+09:30): local 02:00-03:00 happens twice (15:30Z-17:30Z).
//   2027-10-03 (Sun): clocks go forward at 02:00 ACST (+09:30) to 03:00 ACDT (+10:30): local 02:00-03:00 does not exist.

const ADL = 'Australia/Adelaide';
const OFF = 'off-1';
const sunday = (start: string, end: string, id = 'r') => ruleFixture(id, { offeringId: OFF, resourceId: null, dayOfWeek: 0, startTime: start, endTime: end });
const onDay = (dow: number, start: string, end: string, id: string): AvailabilityRule => ruleFixture(id, { offeringId: OFF, resourceId: null, dayOfWeek: dow, startTime: start, endTime: end });
const iso = (d: string) => d;
const local = (instant: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: ADL, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
const offsetOf = (instant: string) => {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: ADL, timeZoneName: 'longOffset' }).formatToParts(new Date(instant)).find(p => p.type === 'timeZoneName')?.value ?? '';
  return part.replace('GMT', '');
};

function compute(over: Partial<AvailabilityInput>) {
  const r = computeAvailability({
    timezone: ADL, fromDate: '2027-04-04', toDate: '2027-04-04', offering: { id: OFF, archivedAt: null },
    offeringRules: [], offeringExceptions: [], resources: [], slot: { durationMinutes: 60, stepMinutes: 60 }, ...over,
  });
  if (!r.ok) throw new Error(`${r.reason}: ${r.problems.join('; ')}`);
  return r;
}
const wnd = (startTime: string, endTime: string): LocalWindow => ({ startTime: startTime as LocalWindow['startTime'], endTime: endTime as LocalWindow['endTime'] });

describe('fall-back: the repeated hour (Sunday 2027-04-04, Adelaide)', () => {
  it('a window across the repeated hour keeps its true length (00:00-06:00 is 7 real hours) and has no adjustment', () => {
    const r = compute({ offeringRules: [sunday('00:00', '06:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-04-03T13:30:00Z', endsAt: '2027-04-03T20:30:00Z' }]);
    expect(r.adjustments).toEqual([]);
  });

  it('hourly slots step in real elapsed time, so the wall clock shows 02:00 twice, told apart by the offset', () => {
    const r = compute({ offeringRules: [sunday('00:00', '06:00')] });
    expect(r.slots.map(s => `${local(s.startsAt)}${offsetOf(s.startsAt)}`)).toEqual(['00:00+10:30', '01:00+10:30', '02:00+10:30', '02:00+09:30', '03:00+09:30', '04:00+09:30', '05:00+09:30']);
    expect(r.slots).toHaveLength(7);
  });

  it('an END inside the repeated hour is the FIRST pass: "open until 02:30" ends at 02:30 ACDT, and it is reported', () => {
    const r = compute({ offeringRules: [sunday('00:00', '02:30')], slot: { durationMinutes: 30, stepMinutes: 30 } });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-04-03T13:30:00Z', endsAt: '2027-04-03T16:00:00Z' }]);
    expect(r.adjustments).toEqual([{ date: '2027-04-04', startTime: '00:00', endTime: '02:30', kind: 'end_ambiguous', owner: { kind: 'offering', id: OFF } }]);
    expect(r.slots).toHaveLength(5);
  });

  it('a START inside the repeated hour is the first pass too, so the window includes the repeated half hour', () => {
    const r = compute({ offeringRules: [sunday('02:30', '05:00')], slot: { durationMinutes: 30, stepMinutes: 30 } });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-04-03T16:00:00Z', endsAt: '2027-04-03T19:30:00Z' }]);
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_ambiguous']);
    expect(r.slots[0].startsAt).toBe('2027-04-03T16:00:00Z'); // the grid starts at the window's own start
  });

  it('to cover the whole repeated hour, end the window after it: 02:00-03:00 is 2 real hours', () => {
    const r = compute({ offeringRules: [sunday('02:00', '03:00')] });
    // 02:00 resolves to the first pass (15:30Z); 03:00 is unambiguous (+09:30 = 17:30Z): the window spans both passes.
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-04-03T15:30:00Z', endsAt: '2027-04-03T17:30:00Z' }]);
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_ambiguous']);
  });

  it('a partial-day closure of the repeated hour closes BOTH passes of it', () => {
    const r = compute({
      offeringRules: [sunday('00:00', '06:00')],
      offeringExceptions: [{ id: 'c', organisationId: 'o', resourceId: null, offeringId: OFF, fromDate: '2027-04-04', toDate: '2027-04-04', kind: 'closed', reason: null, windows: [wnd('02:00', '03:00')] }],
    });
    expect(r.free[0].intervals).toEqual([
      { startsAt: '2027-04-03T13:30:00Z', endsAt: '2027-04-03T15:30:00Z' }, // 00:00-02:00 (first pass of 02:00)
      { startsAt: '2027-04-03T17:30:00Z', endsAt: '2027-04-03T20:30:00Z' }, // 03:00-06:00 (after the change)
    ]);
  });

  it('every computation is repeatable and independent of the order of the rules', () => {
    const rules = [onDay(0, '00:00', '03:00', 'a'), onDay(0, '03:00', '06:00', 'b')];
    const a = compute({ offeringRules: rules });
    const b = compute({ offeringRules: [...rules].reverse() });
    expect(b).toEqual(a);
    expect(compute({ offeringRules: rules })).toEqual(a);
  });
});

describe('spring-forward: the missing hour (Sunday 2027-10-03, Adelaide)', () => {
  it('00:00-06:00 is 5 real hours; hourly slots skip 02:00 on the wall clock', () => {
    const r = compute({ fromDate: '2027-10-03', toDate: '2027-10-03', offeringRules: [sunday('00:00', '06:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-10-02T14:30:00Z', endsAt: '2027-10-02T19:30:00Z' }]);
    expect(r.slots.map(s => `${local(s.startsAt)}${offsetOf(s.startsAt)}`)).toEqual(['00:00+09:30', '01:00+09:30', '03:00+10:30', '04:00+10:30', '05:00+10:30']);
  });

  it('a START in the missing hour opens at the jump, not 30 minutes late (02:30-05:00 opens at 03:00)', () => {
    const r = compute({ fromDate: '2027-10-03', toDate: '2027-10-03', offeringRules: [sunday('02:30', '05:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-10-02T16:30:00Z', endsAt: '2027-10-02T18:30:00Z' }]);
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_in_gap']);
    expect(local(r.slots[0].startsAt)).toBe('03:00');
  });

  it('a window wholly inside the missing hour disappears, and says so', () => {
    const r = compute({ fromDate: '2027-10-03', toDate: '2027-10-03', offeringRules: [sunday('02:10', '02:50')] });
    expect(r.slots).toEqual([]);
    expect(r.free.flatMap(f => f.intervals)).toEqual([]);
    expect(r.adjustments.map(a => a.kind)).toContain('dropped_in_gap');
  });

  it('00:00-24:00 is 23 real hours on this day and 25 on the fall-back day', () => {
    const spring = compute({ fromDate: '2027-10-03', toDate: '2027-10-03', offeringRules: [sunday('00:00', '24:00')] });
    const fall = compute({ offeringRules: [sunday('00:00', '24:00')] });
    const hours = (r: ReturnType<typeof compute>) => (Date.parse(r.free[0].intervals[0].endsAt) - Date.parse(r.free[0].intervals[0].startsAt)) / 3_600_000;
    expect(hours(spring)).toBe(23);
    expect(hours(fall)).toBe(25);
  });
});

describe('the slot grid is anchored to the operating window, not to the clock', () => {
  it('09:15-12:15 offers 09:15, 10:15 and 11:15 local, before and after a daylight-saving change (the UTC hour moves, the wall time does not)', () => {
    const rules = [onDay(1, '09:15', '12:15', 'a')];
    const summer = compute({ fromDate: '2027-03-29', toDate: '2027-03-29', offeringRules: rules });
    const winter = compute({ fromDate: '2027-04-05', toDate: '2027-04-05', offeringRules: rules });
    expect(summer.slots.map(s => local(s.startsAt))).toEqual(['09:15', '10:15', '11:15']);
    expect(winter.slots.map(s => local(s.startsAt))).toEqual(['09:15', '10:15', '11:15']);
    expect(summer.slots[0].startsAt).toBe('2027-03-28T22:45:00Z');
    expect(winter.slots[0].startsAt).toBe('2027-04-04T23:45:00Z');
  });

  it('a step that does not divide the window leaves the tail unused, and never shifts the grid', () => {
    const r = compute({ fromDate: '2027-03-29', toDate: '2027-03-29', offeringRules: [onDay(1, '09:00', '12:00', 'a')], slot: { durationMinutes: 50, stepMinutes: 50 } });
    expect(r.slots.map(s => local(s.startsAt))).toEqual(['09:00', '09:50', '10:40']); // 11:30-12:20 would run past 12:00
  });

  it('touching windows are ONE continuous operating interval: the grid starts at the first, and a slot may straddle the junction', () => {
    const rules = [onDay(1, '09:00', '12:00', 'a'), onDay(1, '12:00', '17:00', 'b')];
    const r = compute({ fromDate: '2027-03-29', toDate: '2027-03-29', offeringRules: rules, slot: { durationMinutes: 90, stepMinutes: 120 } });
    expect(r.slots.map(s => `${local(s.startsAt)}-${local(s.endsAt)}`)).toEqual(['09:00-10:30', '11:00-12:30', '13:00-14:30', '15:00-16:30']);
  });

  it('windows separated by a gap are separate anchors: each restarts the grid at its own start', () => {
    const rules = [onDay(1, '09:00', '11:00', 'a'), onDay(1, '13:30', '15:30', 'b')];
    const r = compute({ fromDate: '2027-03-29', toDate: '2027-03-29', offeringRules: rules });
    expect(r.slots.map(s => local(s.startsAt))).toEqual(['09:00', '10:00', '13:30', '14:30']);
  });

  it('an overnight pair is one interval anchored at the evening start: Friday 22:00-02:00 offers 22:00, 23:00, 00:00 and 01:00', () => {
    const pair = splitOvernightRule({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null });
    const rules = pair.map((p, i) => onDay(p.dayOfWeek, p.startTime, p.endTime, `p${i}`));
    const r = compute({ fromDate: '2027-03-26', toDate: '2027-03-27', offeringRules: rules });
    expect(r.slots.map(s => local(s.startsAt))).toEqual(['22:00', '23:00', '00:00', '01:00']);
    expect(r.free[0].intervals).toHaveLength(1); // merged across local midnight
  });

  it('the Saturday-night overnight window that ends in the repeated hour ends at its FIRST pass and is reported', () => {
    const pair = splitOvernightRule({ dayOfWeek: 6, startTime: '22:00', endTime: '02:30', validFrom: null, validTo: null });
    const rules = pair.map((p, i) => onDay(p.dayOfWeek, p.startTime, p.endTime, `p${i}`));
    const r = compute({ fromDate: '2027-04-03', toDate: '2027-04-04', offeringRules: rules });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2027-04-03T11:30:00Z', endsAt: '2027-04-03T16:00:00Z' }]); // 22:00 ACDT to 02:30 ACDT: 4.5 real hours
    expect(r.adjustments.map(a => a.kind)).toEqual(['end_ambiguous']);
  });
});

describe('expansion is bounded and exact', () => {
  it('expands the 2027 changeover weekend date by date with one adjustment per ambiguous or missing boundary', () => {
    const e = expandOwnerAvailability({ rules: [onDay(0, '02:30', '04:00', 'a')], exceptions: [] }, '2027-04-04', '2027-04-04', ADL);
    expect(e.adjustments.map(a => a.kind)).toEqual(['start_ambiguous']);
    expect(iso(e.intervals[0].startsAt)).toBe('2027-04-03T16:00:00Z');
  });
});
