import { describe, expect, it } from 'vitest';
import {
  MAX_AVAILABILITY_QUERY_DAYS,
  compareAvailabilityAcrossTimezones,
  computeAvailability,
  expandOwnerAvailability,
  generateSlots,
  intersectIntervals,
  localWindowOnDate,
  normaliseIntervals,
  splitOvernightRule,
  subtractHolds,
  subtractIntervals,
  type AvailabilityExceptionInput,
  type AvailabilityInput,
  type AvailabilityRule,
  type ResourceAvailabilityInput,
  type ResourceHold,
} from '../src';
import { rule as ruleFixture } from './support/availabilityFixtures';

const ADL = 'Australia/Adelaide';
const PER = 'Australia/Perth';
const LON = 'Europe/London';
const NYC = 'America/New_York';

const OFF = 'off-1';
const offeringRule = (id: string, dayOfWeek: number, startTime: string, endTime: string, extra: Partial<AvailabilityRule> = {}) => ruleFixture(id, { offeringId: OFF, resourceId: null, dayOfWeek, startTime, endTime, ...extra });
const resourceRule = (resourceId: string, id: string, dayOfWeek: number, startTime: string, endTime: string, extra: Partial<AvailabilityRule> = {}) => ruleFixture(id, { offeringId: null, resourceId, dayOfWeek, startTime, endTime, ...extra });
const offeringException = (id: string, extra: Partial<AvailabilityExceptionInput>): AvailabilityExceptionInput => ({ id, organisationId: 'org-1', resourceId: null, offeringId: OFF, fromDate: '2026-01-15', toDate: '2026-01-15', kind: 'closed', reason: null, ...extra });
const resourceException = (resourceId: string, id: string, extra: Partial<AvailabilityExceptionInput>): AvailabilityExceptionInput => ({ id, organisationId: 'org-1', resourceId, offeringId: null, fromDate: '2026-01-15', toDate: '2026-01-15', kind: 'closed', reason: null, ...extra });
const hold = (resourceId: string, startsAt: string, endsAt: string, extra: Partial<ResourceHold> = {}): ResourceHold => ({ id: `h-${startsAt}`, resourceId, startsAt, endsAt, reservationId: 'rv', occurrenceId: null, releasedAt: null, ...extra });
const res = (id: string, rules: AvailabilityRule[], extra: Partial<ResourceAvailabilityInput> = {}): ResourceAvailabilityInput => ({ resource: { id, active: true }, rules, exceptions: [], holds: [], ...extra });

function input(extra: Partial<AvailabilityInput>): AvailabilityInput {
  return {
    timezone: ADL,
    fromDate: '2026-01-15',
    toDate: '2026-01-15',
    offering: { id: OFF, archivedAt: null },
    offeringRules: [],
    offeringExceptions: [],
    resources: [],
    slot: { durationMinutes: 60, stepMinutes: 60 },
    ...extra,
  };
}
function ok(extra: Partial<AvailabilityInput>) {
  const r = computeAvailability(input(extra));
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.problems.join('; ')}`);
  return r;
}
const minutes = (w: { startsAt: string; endsAt: string }) => (Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 60000;
const starts = (slots: Array<{ startsAt: string }>) => slots.map(s => s.startsAt);

// Reference calendar (verified against the zone database):
//   Australia/Adelaide: DST ends Sun 2026-04-05 03:00 (+10:30 -> +09:30) and starts Sun 2026-10-04 02:00 (+09:30 -> +10:30).
//   Europe/London:      DST starts Sun 2026-03-29 01:00 (GMT -> BST) and ends Sun 2026-10-25 02:00 (BST -> GMT).
//   America/New_York:   DST starts Sun 2026-03-08 02:00 and ends Sun 2026-11-01 02:00.
//   Australia/Perth:    +08:00 all year, no daylight saving.

describe('weekly hours in one zone, summer and winter (Australia/Adelaide)', () => {
  it('Thursday 09:00-12:00 in summer (+10:30) is 22:30Z to 01:30Z', () => {
    const r = ok({ offeringRules: [offeringRule('a', 4, '09:00', '12:00')] });
    expect(r.free).toEqual([{ resourceId: null, intervals: [{ startsAt: '2026-01-14T22:30:00Z', endsAt: '2026-01-15T01:30:00Z' }] }]);
    expect(starts(r.slots)).toEqual(['2026-01-14T22:30:00Z', '2026-01-14T23:30:00Z', '2026-01-15T00:30:00Z']);
    expect(r.adjustments).toEqual([]);
  });
  it('Wednesday 09:00-12:00 in winter (+09:30) is 23:30Z to 02:30Z, so the same wall time has a different UTC hour', () => {
    const r = ok({ fromDate: '2026-07-15', toDate: '2026-07-15', offeringRules: [offeringRule('a', 3, '09:00', '12:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-07-14T23:30:00Z', endsAt: '2026-07-15T02:30:00Z' }]);
  });
  it('a rule only applies on its weekday', () => {
    expect(ok({ offeringRules: [offeringRule('a', 5, '09:00', '12:00')] }).slots).toEqual([]);
  });
  it('a multi-day range yields each matching weekday in order', () => {
    const r = ok({ fromDate: '2026-01-12', toDate: '2026-01-18', offeringRules: [offeringRule('mon', 1, '09:00', '10:00'), offeringRule('wed', 3, '09:00', '10:00'), offeringRule('sun', 0, '09:00', '10:00')] });
    expect(starts(r.slots)).toEqual(['2026-01-11T22:30:00Z', '2026-01-13T22:30:00Z', '2026-01-17T22:30:00Z']);
  });
});

describe('Adelaide daylight-saving transition days', () => {
  it('spring forward (Sun 4 Oct 2026): a window across the jump is 3 real hours, not 4, and needs no adjustment when its edges exist', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [offeringRule('a', 0, '01:00', '05:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-10-03T15:30:00Z', endsAt: '2026-10-03T18:30:00Z' }]);
    expect(minutes(r.free[0].intervals[0])).toBe(180);
    expect(r.adjustments).toEqual([]);
  });
  it('spring forward: a window starting in the gap opens at the jump, not 30 minutes late', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [offeringRule('a', 0, '02:30', '05:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-10-03T16:30:00Z', endsAt: '2026-10-03T18:30:00Z' }]); // 03:00 local to 05:00 local
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_in_gap']);
  });
  it('spring forward: a window ending in the gap closes at the jump', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [offeringRule('a', 0, '01:00', '02:30')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-10-03T15:30:00Z', endsAt: '2026-10-03T16:30:00Z' }]);
    expect(r.adjustments.map(a => a.kind)).toEqual(['end_in_gap']);
  });
  it('spring forward: a window wholly inside the gap disappears and says so', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [offeringRule('a', 0, '02:15', '02:45')] });
    expect(r.free).toEqual([]);
    expect(r.reasons).toEqual(['no_offering_availability']);
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_in_gap', 'end_in_gap', 'dropped_in_gap']);
  });
  it('fall back (Sun 5 Apr 2026): a window across the repeated hour is 7 real hours, not 6', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-04-05', toDate: '2026-04-05', offeringRules: [offeringRule('a', 0, '00:00', '06:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-04-04T13:30:00Z', endsAt: '2026-04-04T20:30:00Z' }]);
    expect(minutes(r.free[0].intervals[0])).toBe(420);
    expect(r.adjustments).toEqual([]);
  });
  it('fall back: a window starting in the repeated hour starts at the earlier instant and is reported', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-04-05', toDate: '2026-04-05', offeringRules: [offeringRule('a', 0, '02:30', '04:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-04-04T16:00:00Z', endsAt: '2026-04-04T18:30:00Z' }]);
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_ambiguous']);
  });
  it('the day before and the day after each changeover behave as ordinary days', () => {
    const before = ok({ fromDate: '2026-04-04', toDate: '2026-04-04', offeringRules: [offeringRule('a', 6, '09:00', '10:00')] });
    const after = ok({ fromDate: '2026-04-06', toDate: '2026-04-06', offeringRules: [offeringRule('a', 1, '09:00', '10:00')] });
    expect(before.free[0].intervals[0].startsAt).toBe('2026-04-03T22:30:00Z'); // +10:30
    expect(after.free[0].intervals[0].startsAt).toBe('2026-04-05T23:30:00Z'); // +09:30
    expect(before.adjustments).toEqual([]);
    expect(after.adjustments).toEqual([]);
  });
  it('a 00:00-24:00 rule is 23 hours on spring-forward day and 25 hours on fall-back day', () => {
    const spring = ok({ fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [offeringRule('a', 0, '00:00', '24:00')] });
    const fall = ok({ fromDate: '2026-04-05', toDate: '2026-04-05', offeringRules: [offeringRule('a', 0, '00:00', '24:00')] });
    expect(minutes(spring.free[0].intervals[0])).toBe(23 * 60);
    expect(minutes(fall.free[0].intervals[0])).toBe(25 * 60);
  });
  it('hourly slots on fall-back day include both passes of the repeated hour as distinct real hours', () => {
    const r = ok({ fromDate: '2026-04-05', toDate: '2026-04-05', offeringRules: [offeringRule('a', 0, '01:00', '04:00')], slot: { durationMinutes: 60, stepMinutes: 60 } });
    expect(r.slots).toHaveLength(4); // 01:00 (+10:30), 02:00 (+10:30), 02:00 again (+9:30), 03:00 (+9:30)
    expect(new Set(starts(r.slots)).size).toBe(4);
  });
});

describe('Australia/Perth: no daylight saving, so the UTC hour never moves', () => {
  it('Monday 09:00-17:00 is 01:00Z-09:00Z in January and in October, and on the Adelaide changeover dates', () => {
    for (const [date, dow] of [['2026-01-05', 1], ['2026-10-05', 1], ['2026-04-05', 0], ['2026-10-04', 0]] as const) {
      const r = ok({ timezone: PER, fromDate: date, toDate: date, offeringRules: [offeringRule('a', dow, '09:00', '17:00')] });
      expect(r.free[0].intervals).toEqual([{ startsAt: `${date}T01:00:00Z`, endsAt: `${date}T09:00:00Z` }]);
      expect(r.adjustments).toEqual([]);
    }
  });
});

describe('northern-hemisphere daylight saving (Europe/London and America/New_York)', () => {
  it('London spring forward (Sun 29 Mar 2026): 00:00-06:00 is 5 real hours', () => {
    const r = ok({ timezone: LON, fromDate: '2026-03-29', toDate: '2026-03-29', offeringRules: [offeringRule('a', 0, '00:00', '06:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-03-29T00:00:00Z', endsAt: '2026-03-29T05:00:00Z' }]);
  });
  it('London spring forward: 01:30-03:00 starts in the gap and opens at the jump (01:00Z), one real hour', () => {
    const r = ok({ timezone: LON, fromDate: '2026-03-29', toDate: '2026-03-29', offeringRules: [offeringRule('a', 0, '01:30', '03:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-03-29T01:00:00Z', endsAt: '2026-03-29T02:00:00Z' }]);
    expect(r.adjustments.map(a => a.kind)).toEqual(['start_in_gap']);
  });
  it('London fall back (Sun 25 Oct 2026): 00:00-06:00 is 7 real hours', () => {
    const r = ok({ timezone: LON, fromDate: '2026-10-25', toDate: '2026-10-25', offeringRules: [offeringRule('a', 0, '00:00', '06:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-10-24T23:00:00Z', endsAt: '2026-10-25T06:00:00Z' }]);
    expect(minutes(r.free[0].intervals[0])).toBe(420);
  });
  it('New York: Monday 09:00-17:00 is 14:00Z-22:00Z before the 8 Mar changeover and 13:00Z-21:00Z after it', () => {
    const before = ok({ timezone: NYC, fromDate: '2026-03-02', toDate: '2026-03-02', offeringRules: [offeringRule('a', 1, '09:00', '17:00')] });
    const after = ok({ timezone: NYC, fromDate: '2026-03-09', toDate: '2026-03-09', offeringRules: [offeringRule('a', 1, '09:00', '17:00')] });
    expect(before.free[0].intervals[0].startsAt).toBe('2026-03-02T14:00:00Z');
    expect(after.free[0].intervals[0].startsAt).toBe('2026-03-09T13:00:00Z');
  });
  it('New York spring forward (8 Mar 2026): a window starting at 02:30 opens at the jump (07:00Z)', () => {
    const r = ok({ timezone: NYC, fromDate: '2026-03-08', toDate: '2026-03-08', offeringRules: [offeringRule('a', 0, '02:30', '05:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-03-08T07:00:00Z', endsAt: '2026-03-08T09:00:00Z' }]);
  });
});

describe('overnight and cross-midnight rules', () => {
  const overnight = (id: string, day: number, start: string, end: string) => splitOvernightRule({ dayOfWeek: day, startTime: start, endTime: end, validFrom: null, validTo: null }).map((p, i) => offeringRule(`${id}${i}`, p.dayOfWeek, p.startTime, p.endTime, { validFrom: p.validFrom, validTo: p.validTo }));

  it('Friday 22:00 to Saturday 02:00 becomes ONE continuous interval across local midnight', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-07-17', toDate: '2026-07-18', offeringRules: overnight('n', 5, '22:00', '02:00') });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-07-17T12:30:00Z', endsAt: '2026-07-17T16:30:00Z' }]);
  });
  it('a slot may straddle midnight when both halves are open', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-07-17', toDate: '2026-07-18', offeringRules: overnight('n', 5, '22:00', '02:00'), slot: { durationMinutes: 90, stepMinutes: 30 } });
    expect(starts(r.slots)).toContain('2026-07-17T14:00:00Z'); // 23:30 local, ends 01:00 local the next day
    expect(r.slots.at(-1)).toMatchObject({ startsAt: '2026-07-17T15:00:00Z', endsAt: '2026-07-17T16:30:00Z' }); // the last slot ends exactly at 02:00
  });
  it('the Saturday half alone does not create a Friday window: querying only Saturday shows just 00:00-02:00', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-07-18', toDate: '2026-07-18', offeringRules: overnight('n', 5, '22:00', '02:00') });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-07-17T14:30:00Z', endsAt: '2026-07-17T16:30:00Z' }]);
  });
  it('an overnight window across the Adelaide fall-back (Sat 4 Apr 22:00 to Sun 06:00) is 9 real hours', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-04-04', toDate: '2026-04-05', offeringRules: overnight('n', 6, '22:00', '06:00') });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-04-04T11:30:00Z', endsAt: '2026-04-04T20:30:00Z' }]);
    expect(minutes(r.free[0].intervals[0])).toBe(540);
  });
  it('an overnight window across the Adelaide spring-forward (Sat 3 Oct 22:00 to Sun 06:00) is 7 real hours', () => {
    const r = ok({ timezone: ADL, fromDate: '2026-10-03', toDate: '2026-10-04', offeringRules: overnight('n', 6, '22:00', '06:00') });
    expect(minutes(r.free[0].intervals[0])).toBe(420);
  });
  it('rules that touch at midnight on the SAME weekday boundary merge, and a gap of a minute does not', () => {
    const touching = ok({ timezone: PER, fromDate: '2026-01-05', toDate: '2026-01-06', offeringRules: [offeringRule('a', 1, '20:00', '24:00'), offeringRule('b', 2, '00:00', '03:00')] });
    expect(touching.free[0].intervals).toHaveLength(1);
    const apart = ok({ timezone: PER, fromDate: '2026-01-05', toDate: '2026-01-06', offeringRules: [offeringRule('a', 1, '20:00', '23:59'), offeringRule('b', 2, '00:00', '03:00')] });
    expect(apart.free[0].intervals).toHaveLength(2);
  });
  it('the query range clips nothing it should keep: the window ending at 24:00 on the last date is included in full', () => {
    const r = ok({ timezone: PER, fromDate: '2026-01-05', toDate: '2026-01-05', offeringRules: [offeringRule('a', 1, '20:00', '24:00')] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-01-05T12:00:00Z', endsAt: '2026-01-05T16:00:00Z' }]);
  });
});

describe('half-open interval boundaries', () => {
  it('a slot may end exactly where the window ends, and no slot may start at the end', () => {
    const r = ok({ timezone: PER, offeringRules: [offeringRule('a', 4, '09:00', '10:00')] });
    expect(r.slots).toEqual([{ startsAt: '2026-01-15T01:00:00Z', endsAt: '2026-01-15T02:00:00Z', resourceId: null }]);
  });
  it('a duration longer than the window yields nothing; equal to the window yields one', () => {
    expect(ok({ timezone: PER, offeringRules: [offeringRule('a', 4, '09:00', '10:00')], slot: { durationMinutes: 61, stepMinutes: 15 } }).slots).toEqual([]);
    expect(ok({ timezone: PER, offeringRules: [offeringRule('a', 4, '09:00', '10:00')], slot: { durationMinutes: 60, stepMinutes: 15 } }).slots).toHaveLength(1);
  });
  it('touching windows merge, so a slot can span the join', () => {
    const r = ok({ timezone: PER, offeringRules: [offeringRule('a', 4, '09:00', '10:00'), offeringRule('b', 4, '10:00', '11:00')], slot: { durationMinutes: 90, stepMinutes: 30 } });
    expect(r.free[0].intervals).toHaveLength(1);
    expect(starts(r.slots)).toEqual(['2026-01-15T01:00:00Z', '2026-01-15T01:30:00Z']);
  });
  it('windows separated by a gap do not merge and no slot spans the gap', () => {
    const r = ok({ timezone: PER, offeringRules: [offeringRule('a', 4, '09:00', '10:00'), offeringRule('b', 4, '10:30', '11:30')], slot: { durationMinutes: 60, stepMinutes: 30 } });
    expect(r.free[0].intervals).toHaveLength(2);
    expect(starts(r.slots)).toEqual(['2026-01-15T01:00:00Z', '2026-01-15T02:30:00Z']);
  });
  it('validity dates are inclusive on both ends', () => {
    const rules = [offeringRule('a', 4, '09:00', '10:00', { validFrom: '2026-01-15', validTo: '2026-01-15' })];
    expect(ok({ timezone: PER, offeringRules: rules }).slots).toHaveLength(1);
    expect(ok({ timezone: PER, fromDate: '2026-01-22', toDate: '2026-01-22', offeringRules: rules }).slots).toEqual([]);
    expect(ok({ timezone: PER, fromDate: '2026-01-08', toDate: '2026-01-08', offeringRules: rules }).slots).toEqual([]);
  });
});

describe('exceptions', () => {
  const rules = [offeringRule('a', 4, '09:00', '12:00')];
  it('a closure removes the whole date and says why', () => {
    const r = ok({ timezone: PER, offeringRules: rules, offeringExceptions: [offeringException('x', {})] });
    expect(r.slots).toEqual([]);
    expect(r.reasons).toEqual(['no_offering_availability']);
  });
  it('a closure is inclusive of its first and last date and does not touch the days around it', () => {
    const r = ok({ timezone: PER, fromDate: '2026-01-08', toDate: '2026-01-22', offeringRules: rules, offeringExceptions: [offeringException('x', { fromDate: '2026-01-15', toDate: '2026-01-15' })] });
    expect(r.free[0].intervals.map(i => i.startsAt.slice(0, 10))).toEqual(['2026-01-08', '2026-01-22']);
  });
  it('an override REPLACES the weekly hours for the date (shorter, later or on a day with no rule)', () => {
    const o = offeringException('x', { kind: 'override', windows: [{ startTime: '13:00', endTime: '15:00' }] });
    const replaced = ok({ timezone: PER, offeringRules: rules, offeringExceptions: [o] });
    expect(replaced.free[0].intervals).toEqual([{ startsAt: '2026-01-15T05:00:00Z', endsAt: '2026-01-15T07:00:00Z' }]);
    const extra = ok({ timezone: PER, fromDate: '2026-01-17', toDate: '2026-01-17', offeringRules: rules, offeringExceptions: [{ ...o, fromDate: '2026-01-17', toDate: '2026-01-17' }] });
    expect(extra.slots.length).toBeGreaterThan(0); // a Saturday with no weekly rule is opened by the override
  });
  it('a closure beats an override on the same date', () => {
    const o = offeringException('o', { kind: 'override', fromDate: '2026-01-12', toDate: '2026-01-18', windows: [{ startTime: '13:00', endTime: '15:00' }] });
    const c = offeringException('c', { kind: 'closed', fromDate: '2026-01-15', toDate: '2026-01-15' });
    const r = ok({ timezone: PER, fromDate: '2026-01-14', toDate: '2026-01-16', offeringRules: rules, offeringExceptions: [o, c] });
    expect(r.free[0].intervals.map(i => i.startsAt.slice(0, 10))).toEqual(['2026-01-14', '2026-01-16']);
  });
  it('an override window may run to the end of the day, and DST rules still apply inside it', () => {
    const o = offeringException('o', { kind: 'override', fromDate: '2026-10-04', toDate: '2026-10-04', windows: [{ startTime: '22:00', endTime: '24:00' }] });
    const r = ok({ timezone: ADL, fromDate: '2026-10-04', toDate: '2026-10-04', offeringRules: [], offeringExceptions: [o] });
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-10-04T11:30:00Z', endsAt: '2026-10-04T13:30:00Z' }]);
  });
  it('an override without windows that reaches the computation unvalidated fails closed', () => {
    const o = offeringException('o', { kind: 'override' });
    expect(expandOwnerAvailability({ rules, exceptions: [o] }, '2026-01-15', '2026-01-15', PER).intervals).toEqual([]);
    expect(expandOwnerAvailability({ rules, exceptions: [{ ...o, kind: 'something-else' as never }] }, '2026-01-15', '2026-01-15', PER).intervals).toEqual([]);
  });
  it('and the validated entry point refuses it instead', () => {
    const r = computeAvailability(input({ timezone: PER, offeringRules: rules, offeringExceptions: [offeringException('o', { kind: 'override' })] }));
    expect(r.ok).toBe(false);
  });
});

describe('offering and resource intersection', () => {
  const offeringRules = [offeringRule('o', 4, '09:00', '17:00')];

  it('a resource can offer a slot only where the offering AND that resource are open', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [res('court-a', [resourceRule('court-a', 'ra', 4, '10:00', '12:00')])] });
    expect(r.slots.map(s => [s.startsAt, s.resourceId])).toEqual([
      ['2026-01-15T02:00:00Z', 'court-a'],
      ['2026-01-15T03:00:00Z', 'court-a'],
    ]);
    expect(r.free[0].intervals).toEqual([{ startsAt: '2026-01-15T02:00:00Z', endsAt: '2026-01-15T04:00:00Z' }]);
  });
  it('a resource open when the offering is closed contributes nothing', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [res('court-a', [resourceRule('court-a', 'ra', 4, '06:00', '08:00')])] });
    expect(r.slots).toEqual([]);
  });
  it('only the overlap counts when the hours partly overlap', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [res('court-a', [resourceRule('court-a', 'ra', 4, '07:30', '09:30')])], slot: { durationMinutes: 30, stepMinutes: 30 } });
    expect(starts(r.slots)).toEqual(['2026-01-15T01:00:00Z']); // 09:00-09:30 only
  });
  it('slots keep the offering grid even when the resource opens off-grid', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [res('court-a', [resourceRule('court-a', 'ra', 4, '10:20', '13:00')])] });
    expect(starts(r.slots)).toEqual(['2026-01-15T03:00:00Z', '2026-01-15T04:00:00Z']); // 11:00 and 12:00; 10:00 would start before the resource opens
  });
  it('several resources are listed per resource, ordered by start then resource id', () => {
    const r = ok({
      timezone: PER,
      offeringRules,
      resources: [res('b', [resourceRule('b', 'rb', 4, '09:00', '11:00')]), res('a', [resourceRule('a', 'ra', 4, '10:00', '12:00')])],
    });
    expect(r.slots.map(s => `${s.startsAt.slice(11, 16)} ${s.resourceId}`)).toEqual(['01:00 b', '02:00 a', '02:00 b', '03:00 a']);
    expect(r.free.map(f => f.resourceId)).toEqual(['a', 'b']);
  });
  it('MISSING RULES MEAN NO AVAILABILITY: an offering with no rules offers nothing, even when its resources are open', () => {
    const r = ok({ timezone: PER, offeringRules: [], resources: [res('a', [resourceRule('a', 'ra', 4, '00:00', '24:00')])] });
    expect(r.slots).toEqual([]);
    expect(r.reasons).toEqual(['no_offering_availability']);
  });
  it('MISSING RULES MEAN NO AVAILABILITY: a resource with no rules offers nothing, and an explicit 00:00-24:00 rule opens it fully', () => {
    const closed = ok({ timezone: PER, offeringRules, resources: [res('a', [])] });
    expect(closed.slots).toEqual([]);
    expect(closed.reasons).toEqual(['resource_no_availability:a']);
    const open = ok({ timezone: PER, offeringRules, resources: [res('a', [resourceRule('a', 'ra', 4, '00:00', '24:00')])] });
    expect(open.slots).toHaveLength(8); // the offering's 09:00-17:00 hourly grid
  });
  it('an inactive resource and an archived offering have no availability', () => {
    const inactive = ok({ timezone: PER, offeringRules, resources: [res('a', [resourceRule('a', 'ra', 4, '00:00', '24:00')], { resource: { id: 'a', active: false } })] });
    expect(inactive.slots).toEqual([]);
    expect(inactive.reasons).toEqual(['resource_inactive:a']);
    const archived = ok({ timezone: PER, offering: { id: OFF, archivedAt: '2026-01-01T00:00:00Z' }, offeringRules });
    expect(archived.slots).toEqual([]);
    expect(archived.reasons).toEqual(['offering_archived']);
  });
  it('a resource exception closes only that resource; an offering exception closes them all', () => {
    const a = res('a', [resourceRule('a', 'ra', 4, '00:00', '24:00')], { exceptions: [resourceException('a', 'xa', {})] });
    const b = res('b', [resourceRule('b', 'rb', 4, '00:00', '24:00')]);
    const one = ok({ timezone: PER, offeringRules, resources: [a, b] });
    expect(new Set(one.slots.map(s => s.resourceId))).toEqual(new Set(['b']));
    const all = ok({ timezone: PER, offeringRules, offeringExceptions: [offeringException('x', {})], resources: [a, b] });
    expect(all.slots).toEqual([]);
  });
  it('an offering with no resource requirement is decided by its own hours alone, with a null resource', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [] });
    expect(new Set(r.slots.map(s => s.resourceId))).toEqual(new Set([null]));
    expect(r.slots).toHaveLength(8);
  });
  it('rules owned by the wrong owner are refused rather than silently applied', () => {
    const wrong = computeAvailability(input({ timezone: PER, offeringRules: [offeringRule('o', 4, '09:00', '17:00', { offeringId: 'someone-else' })] }));
    expect(wrong.ok).toBe(false);
    const wrongResource = computeAvailability(input({ timezone: PER, offeringRules, resources: [res('a', [resourceRule('b', 'rb', 4, '09:00', '10:00')])] }));
    expect(wrongResource.ok).toBe(false);
  });
  it('participant capacity and resource capacity play no part in availability', () => {
    const base = ok({ timezone: PER, offeringRules, resources: [res('a', [resourceRule('a', 'ra', 4, '10:00', '12:00')])] });
    const withCapacity = ok({
      timezone: PER,
      offering: { id: OFF, archivedAt: null, capacity: 1 } as never,
      offeringRules,
      resources: [{ ...res('a', [resourceRule('a', 'ra', 4, '10:00', '12:00')]), resource: { id: 'a', active: true, capacity: 100 } as never }],
    });
    expect(withCapacity).toEqual(base);
  });
});

describe('existing resource holds', () => {
  const offeringRules = [offeringRule('o', 4, '09:00', '13:00')];
  const open = (holds: ResourceHold[]) => res('a', [resourceRule('a', 'ra', 4, '00:00', '24:00')], { holds });

  it('a hold removes exactly the slots it overlaps; slots that merely touch it remain (half-open)', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-15T02:00:00Z', '2026-01-15T03:00:00Z')])] }); // 10:00-11:00 local
    expect(starts(r.slots)).toEqual(['2026-01-15T01:00:00Z', '2026-01-15T03:00:00Z', '2026-01-15T04:00:00Z']); // 09:00, 11:00, 12:00 stay
    expect(r.free[0].intervals).toEqual([
      { startsAt: '2026-01-15T01:00:00Z', endsAt: '2026-01-15T02:00:00Z' },
      { startsAt: '2026-01-15T03:00:00Z', endsAt: '2026-01-15T05:00:00Z' },
    ]);
  });
  it('a hold that overlaps by a single minute removes the slot', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-15T02:59:00Z', '2026-01-15T03:30:00Z')])] });
    expect(starts(r.slots)).toEqual(['2026-01-15T01:00:00Z', '2026-01-15T04:00:00Z']);
  });
  it('slots after a hold keep the offering grid instead of shifting to the hold end', () => {
    const r = ok({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-15T01:00:00Z', '2026-01-15T02:20:00Z')])] });
    expect(starts(r.slots)).toEqual(['2026-01-15T03:00:00Z', '2026-01-15T04:00:00Z']); // 11:00, 12:00; not 10:20
  });
  it('released holds and other resources holds are ignored', () => {
    const r = ok({
      timezone: PER,
      offeringRules,
      resources: [open([hold('a', '2026-01-15T01:00:00Z', '2026-01-15T05:00:00Z', { releasedAt: '2026-01-14T00:00:00Z' }), hold('other', '2026-01-15T01:00:00Z', '2026-01-15T05:00:00Z')])],
    });
    expect(r.slots).toHaveLength(4);
  });
  it('overlapping and adjacent holds are merged correctly, and a hold covering everything leaves nothing', () => {
    const merged = ok({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-15T01:00:00Z', '2026-01-15T02:30:00Z'), hold('a', '2026-01-15T02:00:00Z', '2026-01-15T03:00:00Z'), hold('a', '2026-01-15T03:00:00Z', '2026-01-15T04:00:00Z')])] });
    expect(starts(merged.slots)).toEqual(['2026-01-15T04:00:00Z']);
    const all = ok({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-14T00:00:00Z', '2026-01-16T00:00:00Z')])] });
    expect(all.slots).toEqual([]);
    expect(all.free[0].intervals).toEqual([]);
  });
  it('holds belong to a resource: the other resource is still free in the same hour', () => {
    const b = res('b', [resourceRule('b', 'rb', 4, '00:00', '24:00')]);
    const r = ok({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-15T01:00:00Z', '2026-01-15T05:00:00Z')]), b] });
    expect(new Set(r.slots.map(s => s.resourceId))).toEqual(new Set(['b']));
  });
  it('an invalid hold interval is refused, never guessed at', () => {
    expect(computeAvailability(input({ timezone: PER, offeringRules, resources: [open([hold('a', '2026-01-15T03:00:00Z', '2026-01-15T03:00:00Z')])] })).ok).toBe(false);
    expect(computeAvailability(input({ timezone: PER, offeringRules, resources: [open([hold('a', 'not-a-date', '2026-01-15T03:00:00Z')])] })).ok).toBe(false);
  });
});

describe('interval helpers', () => {
  const w = (s: string, e: string) => ({ startsAt: `2026-01-01T${s}:00Z`, endsAt: `2026-01-01T${e}:00Z` });
  it('normaliseIntervals sorts, merges overlapping and touching intervals and drops empty ones', () => {
    expect(normaliseIntervals([w('10:00', '11:00'), w('09:00', '10:00'), w('12:00', '12:00'), w('10:30', '10:45')])).toEqual([w('09:00', '11:00')]);
  });
  it('intersect and subtract respect half-open ends', () => {
    expect(intersectIntervals([w('09:00', '10:00')], [w('10:00', '11:00')])).toEqual([]);
    expect(intersectIntervals([w('09:00', '12:00')], [w('10:00', '11:00')])).toEqual([w('10:00', '11:00')]);
    expect(subtractIntervals([w('09:00', '12:00')], [w('10:00', '11:00')])).toEqual([w('09:00', '10:00'), w('11:00', '12:00')]);
    expect(subtractIntervals([w('09:00', '10:00')], [w('10:00', '11:00')])).toEqual([w('09:00', '10:00')]);
  });
  it('subtractHolds ignores released holds and other resources', () => {
    const free = [w('09:00', '12:00')];
    const h = (resourceId: string, releasedAt: string | null) => hold(resourceId, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', { releasedAt });
    expect(subtractHolds(free, [h('a', null)], 'a')).toEqual([w('09:00', '10:00'), w('11:00', '12:00')]);
    expect(subtractHolds(free, [h('a', '2026-01-01T00:00:00Z'), h('b', null)], 'a')).toEqual(free);
  });
  it('generateSlots never yields a slot that is not wholly inside the allowed intervals', () => {
    const slots = generateSlots([w('09:00', '12:00')], [w('09:00', '10:30'), w('11:00', '12:00')], { durationMinutes: 60, stepMinutes: 30 }, null);
    expect(slots.map(s => s.startsAt.slice(11, 16))).toEqual(['09:00', '09:30', '11:00']);
  });
  it('localWindowOnDate exposes the daylight-saving handling directly', () => {
    expect(localWindowOnDate('2026-10-04', { startTime: '02:00', endTime: '03:00' }, ADL).interval).toBeNull(); // 02:00-03:00 does not exist on that day
    expect(localWindowOnDate('2026-01-15', { startTime: '09:00', endTime: '10:00' }, PER).interval).toEqual({ startsAt: '2026-01-15T01:00:00Z', endsAt: '2026-01-15T02:00:00Z' });
  });
});

describe('timezone changes are never applied silently', () => {
  const base = (extra: Partial<AvailabilityInput> = {}) => input({ timezone: PER, offeringRules: [offeringRule('o', 4, '09:00', '12:00')], authoredTimezone: ADL, ...extra });

  it('rules authored in one zone but read in another are refused until the change is explicitly confirmed', () => {
    const refused = computeAvailability(base());
    expect(refused).toMatchObject({ ok: false, reason: 'timezone_changed' });
    expect(computeAvailability(base({ allowTimezoneReinterpretation: true })).ok).toBe(true);
  });
  it('the same zone, or no recorded authoring zone, is not a change', () => {
    expect(computeAvailability(base({ authoredTimezone: PER })).ok).toBe(true);
    expect(computeAvailability(base({ authoredTimezone: null })).ok).toBe(true);
    expect(computeAvailability(base({ authoredTimezone: undefined })).ok).toBe(true);
  });
  it('the review reports how far availability moves (Adelaide to Perth in January: +10:30 to +08:00)', () => {
    const report = compareAvailabilityAcrossTimezones(base(), PER);
    expect(report).toMatchObject({ ok: true, from: ADL, to: PER, offsetMinutes: { from: { first: 630, last: 630 }, to: { first: 480, last: 480 } }, requiresConfirmation: true });
    if (report.ok) {
      expect(report.slotsUnchanged).toBe(0);
      expect(report.slotsRemoved).toBe(3);
      expect(report.slotsAdded).toBe(3);
    }
  });
  it('zones with the same offsets and no daylight saving over the range need no confirmation (Perth to Singapore)', () => {
    const report = compareAvailabilityAcrossTimezones(base({ authoredTimezone: PER, timezone: PER }), 'Asia/Singapore');
    expect(report).toMatchObject({ ok: true, slotsRemoved: 0, slotsAdded: 0, requiresConfirmation: false });
  });
  it('the review flags windows that land on a nonexistent or repeated local time in the NEW zone', () => {
    const rules = [offeringRule('o', 0, '01:30', '03:00')];
    const report = compareAvailabilityAcrossTimezones(input({ timezone: PER, authoredTimezone: PER, fromDate: '2026-03-29', toDate: '2026-03-29', offeringRules: rules }), LON);
    expect(report).toMatchObject({ ok: true, requiresConfirmation: true });
    if (report.ok) expect(report.adjustmentsUnderNewZone.map(a => a.kind)).toEqual(['start_in_gap']);
  });
  it('the review changes nothing: reading in the old zone afterwards gives the same answer as before', () => {
    const before = computeAvailability(base({ authoredTimezone: ADL, timezone: ADL }));
    compareAvailabilityAcrossTimezones(base({ authoredTimezone: ADL, timezone: ADL }), LON);
    expect(computeAvailability(base({ authoredTimezone: ADL, timezone: ADL }))).toEqual(before);
  });
  it('a review of an invalid input reports the problem instead of a report', () => {
    expect(compareAvailabilityAcrossTimezones(base({ fromDate: 'bad' }), PER)).toMatchObject({ ok: false });
  });
});

describe('input validation', () => {
  it('refuses an unknown zone, bad dates, a reversed or over-long range and bad slot sizes', () => {
    const rules = [offeringRule('o', 4, '09:00', '12:00')];
    expect(computeAvailability(input({ timezone: 'Mars/Olympus', offeringRules: rules })).ok).toBe(false);
    expect(computeAvailability(input({ fromDate: '2026-02-30', offeringRules: rules })).ok).toBe(false);
    expect(computeAvailability(input({ fromDate: '2026-01-16', toDate: '2026-01-15', offeringRules: rules })).ok).toBe(false);
    expect(computeAvailability(input({ fromDate: '2026-01-01', toDate: '2026-04-05', offeringRules: rules })).ok).toBe(false); // 95 days
    expect(computeAvailability(input({ fromDate: '2026-01-01', toDate: '2026-04-03', offeringRules: rules })).ok).toBe(true); // exactly 93
    expect(MAX_AVAILABILITY_QUERY_DAYS).toBe(93);
    for (const slot of [{ durationMinutes: 0, stepMinutes: 15 }, { durationMinutes: 60, stepMinutes: 0 }, { durationMinutes: 1.5, stepMinutes: 15 }, { durationMinutes: 60, stepMinutes: -5 }, { durationMinutes: 2000, stepMinutes: 15 }]) {
      expect(computeAvailability(input({ offeringRules: rules, slot })).ok, JSON.stringify(slot)).toBe(false);
    }
    expect(computeAvailability(input({ offeringRules: rules, notBefore: 'soon' })).ok).toBe(false);
  });
  it('refuses overlapping rules, duplicate resources and bad rules from the caller', () => {
    expect(computeAvailability(input({ offeringRules: [offeringRule('a', 4, '09:00', '12:00'), offeringRule('b', 4, '11:00', '13:00')] })).ok).toBe(false);
    expect(computeAvailability(input({ offeringRules: [offeringRule('a', 4, '09:00', '12:00')], resources: [res('a', []), res('a', [])] })).ok).toBe(false);
    expect(computeAvailability(input({ offeringRules: [offeringRule('a', 4, '12:00', '09:00')] })).ok).toBe(false);
  });
  it('invalid input is reported with its problems and no partial result', () => {
    const r = computeAvailability(input({ timezone: 'nope', offeringRules: [offeringRule('a', 4, '12:00', '09:00')] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_input');
      expect(r.problems.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('notBefore drops earlier slots but keeps the free intervals', () => {
    const r = ok({ timezone: PER, offeringRules: [offeringRule('a', 4, '09:00', '12:00')], notBefore: '2026-01-15T02:00:00Z' });
    expect(starts(r.slots)).toEqual(['2026-01-15T02:00:00Z', '2026-01-15T03:00:00Z']);
    expect(r.free[0].intervals).toHaveLength(1);
  });
});

describe('determinism and purity', () => {
  const offeringRules = [offeringRule('o1', 4, '09:00', '12:00'), offeringRule('o2', 4, '13:00', '17:00'), offeringRule('o3', 5, '09:00', '12:00')];
  const resources = [
    res('b', [resourceRule('b', 'rb1', 4, '10:00', '16:00')], { holds: [hold('b', '2026-01-15T03:00:00Z', '2026-01-15T04:00:00Z')] }),
    res('a', [resourceRule('a', 'ra1', 4, '09:00', '17:00')]),
  ];
  const build = (): AvailabilityInput => input({ timezone: ADL, fromDate: '2026-01-12', toDate: '2026-01-18', offeringRules, resources, slot: { durationMinutes: 45, stepMinutes: 15 } });
  const deepFreeze = <T,>(v: T): T => {
    if (v && typeof v === 'object') {
      Object.values(v as object).forEach(deepFreeze);
      Object.freeze(v);
    }
    return v;
  };

  it('repeated calculations on the same input are identical', () => {
    const first = computeAvailability(build());
    for (let i = 0; i < 5; i++) expect(computeAvailability(build())).toEqual(first);
  });
  it('the order of the input lists never changes the result', () => {
    const a = computeAvailability(build());
    const shuffled = build();
    const reversed = { ...shuffled, offeringRules: [...shuffled.offeringRules].reverse(), resources: [...shuffled.resources].reverse().map(r => ({ ...r, rules: [...r.rules].reverse() })) };
    expect(computeAvailability(reversed)).toEqual(a);
  });
  it('a deeply frozen input is read without error and is never modified (the computation writes nothing it was given)', () => {
    const frozen = deepFreeze(build());
    const snapshot = JSON.stringify(frozen);
    const r = computeAvailability(frozen);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
  it('the result is plain data: it holds no function, so there is nothing in it that could write a reservation or a hold', () => {
    const json = JSON.stringify(computeAvailability(build()));
    expect(JSON.parse(json)).toEqual(computeAvailability(build()));
  });
});
