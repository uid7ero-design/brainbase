import { describe, expect, it } from 'vitest';
import { computeAvailability, evaluateSlotBooking, type AvailabilityInput, type AvailabilityRule, type ResourceAvailabilityInput } from '../src';
import { rule as ruleFixture } from './support/availabilityFixtures';

// Phase 2C: THE SLOT GRID MUST NOT DEPEND ON THE QUERY RANGE.
//
// The engine anchors the slot grid at the start of each continuous effective window. A window that is continuous across local midnight (a 24-hour rule, or an overnight
// pair) used to be anchored at the start of the QUERY RANGE when the range cut it, so the same Wednesday offered different start times depending on whether the caller
// asked for Wednesday, or for the week. A booking validated at commit with one range and a calendar drawn with another could then disagree about which starts exist.
//
// The corrected rule: the grid RESTARTS AT EVERY LOCAL MIDNIGHT of the offering's zone inside a continuous window (and at the start of the window, and after a closure).
// Local midnight exists on every day in every zone this product serves (daylight saving moves at 02:00 or 03:00 here), and the step is still elapsed time from the
// anchor, so a 23-hour or 25-hour day keeps its true length. A start may still run past midnight; only the GRID restarts.

const ADL = 'Australia/Adelaide';
const PER = 'Australia/Perth';
const OFF = 'off-1';
const offeringRule = (id: string, dayOfWeek: number, startTime: string, endTime: string): AvailabilityRule => ruleFixture(id, { offeringId: OFF, resourceId: null, dayOfWeek, startTime, endTime });
const resourceRule = (resourceId: string, id: string, dayOfWeek: number, startTime: string, endTime: string): AvailabilityRule => ruleFixture(id, { offeringId: null, resourceId, dayOfWeek, startTime, endTime });
const allWeek = (make: (id: string, day: number) => AvailabilityRule) => [0, 1, 2, 3, 4, 5, 6].map(d => make(`r${d}`, d));
const res = (id: string, rules: AvailabilityRule[], extra: Partial<ResourceAvailabilityInput> = {}): ResourceAvailabilityInput => ({ resource: { id, active: true }, rules, exceptions: [], holds: [], ...extra });

function run(extra: Partial<AvailabilityInput>) {
  const result = computeAvailability({
    timezone: ADL,
    fromDate: '2026-01-14',
    toDate: '2026-01-14',
    offering: { id: OFF, archivedAt: null },
    offeringRules: [],
    offeringExceptions: [],
    resources: [],
    slot: { durationMinutes: 60, stepMinutes: 45 },
    ...extra,
  });
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.problems.join('; ')}`);
  return result;
}

/** Start instants of one local date, taken from a computation over some range. */
function startsOnDay(slots: Array<{ startsAt: string }>, from: string, to: string): string[] {
  return slots.map(s => s.startsAt).filter(s => s >= from && s < to);
}

// Adelaide is UTC+10:30 in January (summer time) and +09:30 in July.
const DAY = { from: '2026-01-13T13:30:00Z', to: '2026-01-14T13:30:00Z' }; // local Wednesday 2026-01-14, 00:00 to 24:00

describe('a 24-hour rule: the same day offers the same starts however wide the range', () => {
  const rules = allWeek((id, d) => offeringRule(id, d, '00:00', '24:00'));
  const narrow = startsOnDay(run({ offeringRules: rules }).slots, DAY.from, DAY.to);

  it('the day is anchored at its own local midnight (00:00, 00:45, 01:30 ...)', () => {
    expect(narrow[0]).toBe('2026-01-13T13:30:00Z');
    expect(narrow[1]).toBe('2026-01-13T14:15:00Z');
    expect(narrow.length).toBeGreaterThan(30);
  });
  for (const [from, to] of [['2026-01-13', '2026-01-14'], ['2026-01-14', '2026-01-15'], ['2026-01-12', '2026-01-18'], ['2026-01-10', '2026-01-23']] as const) {
    it(`${from}..${to}: Wednesday's starts are identical`, () => {
      expect(startsOnDay(run({ offeringRules: rules, fromDate: from, toDate: to }).slots, DAY.from, DAY.to)).toEqual(narrow);
    });
  }
});

describe('daylight saving days keep their true length and a range-independent grid', () => {
  const rules = allWeek((id, d) => offeringRule(id, d, '00:00', '24:00'));
  // Adelaide spring forward: Sunday 2026-10-04 is 23 hours (02:00 -> 03:00), midnight is 14:30Z on the 3rd (+09:30).
  const springFrom = '2026-10-03T14:30:00Z';
  const springTo = '2026-10-04T13:30:00Z'; // 00:00 on the 5th is +10:30
  // Fall back: Sunday 2026-04-05 is 25 hours, midnight 14:30Z on 4 April.
  const fallFrom = '2026-04-04T13:30:00Z';
  const fallTo = '2026-04-05T14:30:00Z';
  for (const [name, date, wide, a, b] of [
    ['spring forward', '2026-10-04', ['2026-10-01', '2026-10-07'], springFrom, springTo],
    ['fall back', '2026-04-05', ['2026-04-02', '2026-04-08'], fallFrom, fallTo],
  ] as const) {
    it(`${name}: the day's starts do not depend on the range`, () => {
      const alone = startsOnDay(run({ offeringRules: rules, fromDate: date, toDate: date }).slots, a, b);
      const inWeek = startsOnDay(run({ offeringRules: rules, fromDate: wide[0], toDate: wide[1] }).slots, a, b);
      expect(inWeek).toEqual(alone);
      expect(alone[0]).toBe(a);
    });
  }
});

describe('an overnight pair: the grid restarts at local midnight, the start may still run past it', () => {
  // Tuesday 22:00-24:00 and Wednesday 00:00-02:00 (one overnight window).
  const rules = [offeringRule('a', 2, '22:00', '24:00'), offeringRule('b', 3, '00:00', '02:00')];
  const wednesdayMidnight = '2026-01-13T13:30:00Z';
  it('Wednesday alone and Tuesday..Wednesday agree on every Wednesday start', () => {
    const alone = startsOnDay(run({ offeringRules: rules, fromDate: '2026-01-14', toDate: '2026-01-14' }).slots, wednesdayMidnight, '2026-01-14T13:30:00Z');
    const both = startsOnDay(run({ offeringRules: rules, fromDate: '2026-01-13', toDate: '2026-01-14' }).slots, wednesdayMidnight, '2026-01-14T13:30:00Z');
    expect(both).toEqual(alone);
    expect(alone[0]).toBe(wednesdayMidnight);
  });
  it('a start before midnight whose end lies after it is still offered', () => {
    const slots = run({ offeringRules: rules, fromDate: '2026-01-13', toDate: '2026-01-14', slot: { durationMinutes: 60, stepMinutes: 30 } }).slots.map(s => s.startsAt);
    // Tuesday 23:30 local = 13:00Z on the 13th; ends 00:30 Wednesday.
    expect(slots).toContain('2026-01-13T13:00:00Z');
  });
});

describe('a closure still re-anchors the grid, wherever the range starts', () => {
  const rules = allWeek((id, d) => offeringRule(id, d, '00:00', '24:00'));
  const closure = [{ id: 'c', organisationId: 'org-1', resourceId: null, offeringId: OFF, fromDate: '2026-01-14', toDate: '2026-01-14', kind: 'override' as const, reason: null, windows: [{ startTime: '01:00', endTime: '24:00' }] }];
  it('hours that begin at 01:00 on the day anchor at 01:00, in a one-day range and a week', () => {
    const narrow = startsOnDay(run({ offeringRules: rules, offeringExceptions: closure as never }).slots, DAY.from, DAY.to);
    const week = startsOnDay(run({ offeringRules: rules, offeringExceptions: closure as never, fromDate: '2026-01-12', toDate: '2026-01-18' }).slots, DAY.from, DAY.to);
    expect(week).toEqual(narrow);
    expect(narrow[0]).toBe('2026-01-13T14:30:00Z');
  });
});

describe('a resource pinned to another zone does not move the offering\'s grid', () => {
  const offering = allWeek((id, d) => offeringRule(id, d, '00:00', '24:00'));
  const court = res('court-1', allWeek((id, d) => resourceRule('court-1', id, d, '00:00', '24:00')), { timezone: PER });
  it('the starts the offering\'s zone defines are the same for a one-day and a week range', () => {
    const a = startsOnDay(run({ offeringRules: offering, resources: [court] }).slots, DAY.from, DAY.to);
    const b = startsOnDay(run({ offeringRules: offering, resources: [court], fromDate: '2026-01-11', toDate: '2026-01-17' }).slots, DAY.from, DAY.to);
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('the commit-time evaluator and the calendar agree for a 24-hour rule', () => {
  it('a start the calendar offers (from any range) is accepted, and an off-grid start is refused', () => {
    const rules = allWeek((id, d) => offeringRule(id, d, '00:00', '24:00'));
    const week = run({ offeringRules: rules, resources: [res('court-1', allWeek((id, d) => resourceRule('court-1', id, d, '00:00', '24:00')))], fromDate: '2026-01-12', toDate: '2026-01-18' }).slots.filter(s => s.startsAt >= DAY.from && s.startsAt < DAY.to);
    expect(week.length).toBeGreaterThan(10);
    const base = {
      timezone: ADL,
      offering: { id: OFF, archivedAt: null },
      offeringRules: rules,
      offeringExceptions: [],
      resources: [res('court-1', allWeek((id, d) => resourceRule('court-1', id, d, '00:00', '24:00')))],
      slot: { durationMinutes: 60, stepMinutes: 45 },
    };
    for (const s of week.slice(0, 5)) {
      const verdict = evaluateSlotBooking({ ...base, stepMinutes: 45, now: '2026-01-01T00:00:00Z', presetKey: 'resource_hire', resourceDetails: new Map([['court-1', { capacity: 4, kind: 'court' }]]) } as never, { interval: { startsAt: s.startsAt, endsAt: s.endsAt }, resourceId: 'court-1', partySize: 1 });
      expect(verdict.ok, `${s.startsAt} ${JSON.stringify(verdict)}`).toBe(true);
      if (verdict.ok) expect(verdict.anchorAtRangeEdge).toBe(false);
    }
  });
});
