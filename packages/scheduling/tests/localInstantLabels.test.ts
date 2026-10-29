import { describe, expect, it } from 'vitest';
import { computeAvailability, formatUtcOffset, labelLocalInstant, offsetMinutesAt, type AvailabilityInput } from '../src';
import { rule as ruleFixture } from './support/availabilityFixtures';

// Repeated-hour presentation for FUTURE availability slots (the calendar is not built yet). When the clocks go back, a local time happens
// twice, so the time alone cannot name the instant: labelLocalInstant gives such a time (and only such a time) its UTC offset, for example
// "02:30 UTC+10:30" and "02:30 UTC+09:30". The offsets in that example belong to Australia/Adelaide on 2027-04-04; they are NOT assumed for any
// other zone, so every expectation below was taken from the zone database (Intl / ICU) for that zone and year, not from the example:
//   Australia/Adelaide  2027-04-04 02:00-03:00 repeats, +10:30 then +09:30      (scripts: node probe of Intl, 2026-10-25)
//   Australia/Sydney    2027-04-04 02:00-03:00 repeats, +11:00 then +10:00
//   Australia/Lord_Howe 2027-04-04 01:30-02:00 repeats (HALF an hour), +11:00 then +10:30
//   Pacific/Auckland    2027-04-04 02:00-03:00 repeats, +13:00 then +12:00
//   Europe/London       2027-10-31 01:00-02:00 repeats, +01:00 then +00:00
//   Australia/Perth, Australia/Darwin: no daylight saving, nothing repeats.

const label = (instant: string, zone: string) => labelLocalInstant(instant, zone);

describe('formatUtcOffset', () => {
  it.each([[630, 'UTC+10:30'], [570, 'UTC+09:30'], [0, 'UTC+00:00'], [-180, 'UTC-03:00'], [-570, 'UTC-09:30'], [765, 'UTC+12:45'], [840, 'UTC+14:00']])('%i minutes is %s', (minutes, text) => {
    expect(formatUtcOffset(minutes)).toBe(text);
  });
});

describe('the repeated hour is told apart by the offset (Australia/Adelaide, Sunday 2027-04-04)', () => {
  it('02:30 happens twice: 16:00Z is 02:30 UTC+10:30 and 17:00Z is 02:30 UTC+09:30', () => {
    const first = label('2027-04-03T16:00:00Z', 'Australia/Adelaide');
    const second = label('2027-04-03T17:00:00Z', 'Australia/Adelaide');
    expect([first.date, first.time, first.offset, first.repeated, first.text]).toEqual(['2027-04-04', '02:30', 'UTC+10:30', true, '02:30 UTC+10:30']);
    expect([second.date, second.time, second.offset, second.repeated, second.text]).toEqual(['2027-04-04', '02:30', 'UTC+09:30', true, '02:30 UTC+09:30']);
  });

  it('only the repeated hour carries an offset: 01:30 and 03:00 are plain, 02:00 on either pass is not', () => {
    expect(label('2027-04-03T15:00:00Z', 'Australia/Adelaide').text).toBe('01:30'); // +10:30
    expect(label('2027-04-03T15:30:00Z', 'Australia/Adelaide').text).toBe('02:00 UTC+10:30');
    expect(label('2027-04-03T16:30:00Z', 'Australia/Adelaide').text).toBe('02:00 UTC+09:30'); // the repeat begins
    expect(label('2027-04-03T17:30:00Z', 'Australia/Adelaide').text).toBe('03:00'); // +09:30, the hour is over
    expect(label('2027-04-03T17:29:00Z', 'Australia/Adelaide').text).toBe('02:59 UTC+09:30');
  });

  it('an ordinary day has no offsets at all, in either offset period', () => {
    for (const instant of ['2027-01-15T01:00:00Z', '2027-07-15T01:00:00Z', '2027-04-02T20:30:00Z']) expect(label(instant, 'Australia/Adelaide').repeated).toBe(false);
  });
});

describe('the example offsets are not assumed for other zones: each is read from the zone', () => {
  it.each<[string, string, string, string]>([
    ['Australia/Sydney', '2027-04-03T15:30:00Z', '02:30 UTC+11:00', '2027-04-03T16:30:00Z'],
    ['Pacific/Auckland', '2027-04-03T13:30:00Z', '02:30 UTC+13:00', '2027-04-03T14:30:00Z'],
    ['Europe/London', '2027-10-31T00:30:00Z', '01:30 UTC+01:00', '2027-10-31T01:30:00Z'],
  ])('%s: the two passes of the same local time', (zone, firstInstant, firstText, secondInstant) => {
    const first = label(firstInstant, zone);
    const second = label(secondInstant, zone);
    expect(first.text).toBe(firstText);
    expect(second.time).toBe(first.time);
    expect(second.offset).not.toBe(first.offset);
    expect(second.text).toBe(`${first.time} ${second.offset}`);
  });

  it('Sydney repeats 02:30 at +11:00 and +10:00, not at the Adelaide offsets', () => {
    expect([label('2027-04-03T15:30:00Z', 'Australia/Sydney').offset, label('2027-04-03T16:30:00Z', 'Australia/Sydney').offset]).toEqual(['UTC+11:00', 'UTC+10:00']);
  });

  it('Lord Howe shifts by HALF an hour: only 01:30-02:00 repeats (+11:00 then +10:30), 02:00 does not', () => {
    expect(label('2027-04-03T14:45:00Z', 'Australia/Lord_Howe').text).toBe('01:45 UTC+11:00');
    expect(label('2027-04-03T15:15:00Z', 'Australia/Lord_Howe').text).toBe('01:45 UTC+10:30');
    expect(label('2027-04-03T14:15:00Z', 'Australia/Lord_Howe').repeated).toBe(false); // 01:15, before the repeat
    expect(label('2027-04-03T15:30:00Z', 'Australia/Lord_Howe').text).toBe('02:00'); // after it
  });

  it('a zone without daylight saving never repeats an hour', () => {
    for (const zone of ['Australia/Perth', 'Australia/Darwin']) {
      for (let h = 0; h < 24 * 365; h += 7) expect(label(new Date(Date.UTC(2027, 0, 1) + h * 3_600_000).toISOString(), zone).repeated).toBe(false);
    }
  });

  it('the offset is read at the instant, in a zone with a different offset at either end of the year', () => {
    expect(label('2027-01-15T01:00:00Z', 'Australia/Adelaide').offset).toBe('UTC+10:30');
    expect(label('2027-07-15T01:00:00Z', 'Australia/Adelaide').offset).toBe('UTC+09:30');
    expect(label('2027-07-15T01:00:00Z', 'Europe/London').offset).toBe('UTC+01:00');
    expect(label('2027-12-15T01:00:00Z', 'Europe/London').offset).toBe('UTC+00:00');
  });
});

describe('every instant of a transition day has its own text', () => {
  // Five-minute steps over 36 hours either side of each 2027 transition: no two instants in a zone share (date, text), and the number of
  // instants that carry an offset is exactly twice the repeated length.
  const zones: Array<[string, number]> = [['Australia/Adelaide', 60], ['Australia/Sydney', 60], ['Australia/Lord_Howe', 30], ['Pacific/Auckland', 60], ['Europe/London', 60]];
  it.each(zones)('%s', (zone, repeatedMinutes) => {
    let transitions = 0;
    let repeatedInstants = 0;
    for (let probe = Date.UTC(2027, 0, 1); probe < Date.UTC(2028, 0, 1); probe += 6 * 3_600_000) {
      if (offsetMinutesAt(probe, zone) === offsetMinutesAt(probe + 6 * 3_600_000, zone)) continue;
      transitions++;
      const seen = new Map<string, string>();
      for (let t = probe - 36 * 3_600_000; t <= probe + 42 * 3_600_000; t += 5 * 60_000) {
        const l = labelLocalInstant(new Date(t).toISOString(), zone);
        const key = `${l.date} ${l.text}`;
        expect([key, seen.get(key)]).toEqual([key, undefined]);
        seen.set(key, new Date(t).toISOString());
        if (l.repeated) repeatedInstants++;
      }
    }
    expect(transitions).toBe(2);
    expect(repeatedInstants).toBe((repeatedMinutes / 5) * 2);
  });
});

describe('with the deterministic, window-anchored slot grid', () => {
  const ADL = 'Australia/Adelaide';
  const sunday = (start: string, end: string) => ruleFixture('r', { offeringId: 'off-1', resourceId: null, dayOfWeek: 0, startTime: start, endTime: end });
  const compute = (date: string, start: string, end: string, durationMinutes = 60, stepMinutes = 60) => {
    const input: AvailabilityInput = {
      timezone: ADL, fromDate: date, toDate: date, offering: { id: 'off-1', archivedAt: null }, offeringRules: [sunday(start, end)],
      offeringExceptions: [], resources: [], slot: { durationMinutes, stepMinutes },
    };
    const r = computeAvailability(input);
    if (!r.ok) throw new Error(r.problems.join('; '));
    return r.slots.map(s => label(s.startsAt, ADL).text);
  };

  it('fall-back day: hourly slots read 00:00 01:00 02:00 UTC+10:30 02:00 UTC+09:30 03:00 04:00 05:00', () => {
    expect(compute('2027-04-04', '00:00', '06:00')).toEqual(['00:00', '01:00', '02:00 UTC+10:30', '02:00 UTC+09:30', '03:00', '04:00', '05:00']);
  });

  it('half-hour slots anchored at 00:15: the two passes of 02:15 and 02:45 are told apart, the others are plain', () => {
    expect(compute('2027-04-04', '00:15', '04:15', 30, 30)).toEqual([
      '00:15', '00:45', '01:15', '01:45', '02:15 UTC+10:30', '02:45 UTC+10:30', '02:15 UTC+09:30', '02:45 UTC+09:30', '03:15', '03:45',
    ]);
  });

  it('spring-forward day: the hour that does not exist is skipped and nothing is labelled as repeated', () => {
    expect(compute('2027-10-03', '00:00', '06:00')).toEqual(['00:00', '01:00', '03:00', '04:00', '05:00']);
  });

  it('the same input gives the same labels every time (no clock, no locale of the machine)', () => {
    expect(compute('2027-04-04', '00:00', '06:00')).toEqual(compute('2027-04-04', '00:00', '06:00'));
  });
});
