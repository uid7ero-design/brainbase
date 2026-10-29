import { describe, it, expect } from 'vitest';
import {
  addDays,
  clipToDay,
  clockAt,
  columnHeight,
  dayHeading,
  dayNote,
  describeZoneAt,
  isDate,
  offsetText,
  place,
  rangeFor,
  rangeHeading,
  reasonText,
  slotsInDay,
  stepDate,
  utcOffsetAt,
  weekStart,
  weekday,
  windowText,
} from '@/lib/scheduling/dashboard/calendar';

// Phase 2B.3d: the pure helpers behind the calendar screen. Reference calendar: Adelaide is +10:30 in summer and +09:30 in winter; its clocks go
// forward on Sun 2026-10-04 (a 23-hour day) and back on Sun 2027-04-04 (a 25-hour day). 2027-01-11 is a Monday.

const ADL = 'Australia/Adelaide';

describe('dates are calendar dates, never shifted by a timezone', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('the week starts on Monday', () => {
    expect(weekday('2027-01-11')).toBe(1);
    expect(weekStart('2027-01-11')).toBe('2027-01-11');
    expect(weekStart('2027-01-13')).toBe('2027-01-11');
    expect(weekStart('2027-01-17')).toBe('2027-01-11'); // a Sunday belongs to the week that began the Monday before
    expect(weekStart('2027-01-18')).toBe('2027-01-18');
  });

  it('a day range is one day and a week range is Monday to Sunday', () => {
    expect(rangeFor('day', '2027-01-13')).toEqual({ from: '2027-01-13', to: '2027-01-13' });
    expect(rangeFor('week', '2027-01-13')).toEqual({ from: '2027-01-11', to: '2027-01-17' });
  });

  it('previous and next move by a day or a week', () => {
    expect(stepDate('day', '2027-01-31', 1)).toBe('2027-02-01');
    expect(stepDate('day', '2027-01-01', -1)).toBe('2026-12-31');
    expect(stepDate('week', '2027-01-13', 1)).toBe('2027-01-18');
    expect(stepDate('week', '2027-01-13', -1)).toBe('2027-01-04');
  });

  it('isDate accepts only real dates', () => {
    expect(isDate('2027-01-11')).toBe(true);
    for (const bad of ['2027-02-29', '2027-13-01', '2027-1-1', 'tomorrow', '', null, undefined]) expect(isDate(bad as string | null | undefined)).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
  });

  it('headings name the day without changing it', () => {
    expect(dayHeading('2027-01-11')).toBe('Mon 11 Jan');
    expect(rangeHeading('2027-01-11', '2027-01-11')).toContain('Monday');
    expect(rangeHeading('2027-01-11', '2027-01-17')).toBe('11 Jan to 17 Jan 2027');
  });
});

describe('wall-clock labels in a named zone', () => {
  it('reads an instant as the local time in the zone, whatever the device zone is', () => {
    expect(clockAt('2027-01-10T22:30:00Z', ADL)).toBe('09:00'); // +10:30
    expect(clockAt('2027-07-01T23:30:00Z', ADL)).toBe('09:00'); // +09:30
    expect(clockAt('2027-01-11T01:00:00Z', 'Australia/Perth')).toBe('09:00');
    expect(clockAt('2027-01-11T09:00:00Z', 'UTC')).toBe('09:00');
  });

  it('a window is "start to end", and a window that ends at local midnight reads 24:00, never 00:00', () => {
    expect(windowText({ startsAt: '2027-01-10T22:30:00Z', endsAt: '2027-01-11T06:30:00Z' }, ADL)).toBe('09:00 to 17:00');
    expect(windowText({ startsAt: '2027-01-11T11:30:00Z', endsAt: '2027-01-11T13:30:00Z' }, ADL)).toBe('22:00 to 24:00');
    expect(windowText({ startsAt: '2027-01-11T11:30:00Z', endsAt: '2027-01-11T15:30:00Z' }, ADL)).toBe('22:00 to 02:00'); // overnight
  });

  it('offsets are written the way people write them', () => {
    expect([offsetText(630), offsetText(570), offsetText(480), offsetText(0), offsetText(-180), offsetText(-210)]).toEqual(['UTC+10:30', 'UTC+9:30', 'UTC+8', 'UTC', 'UTC-3', 'UTC-3:30']);
  });

  it('the zone offset follows daylight saving: +10:30 in summer, +9:30 in winter, none in Perth', () => {
    expect(utcOffsetAt('2027-01-11T00:00:00Z', ADL)).toBe(630);
    expect(utcOffsetAt('2027-07-01T00:00:00Z', ADL)).toBe(570);
    expect(utcOffsetAt('2027-01-11T00:00:00Z', 'Australia/Perth')).toBe(480);
    expect(utcOffsetAt('2027-01-11T00:00:00Z', 'UTC')).toBe(0);
    expect(describeZoneAt(ADL, '2027-01-11T00:00:00Z')).toBe('Australia/Adelaide (UTC+10:30)');
    expect(describeZoneAt(ADL, '2027-07-01T00:00:00Z')).toBe('Australia/Adelaide (UTC+9:30)');
  });
});

describe('days of a true length', () => {
  it('a normal day has no note; the short and long days say why', () => {
    expect(dayNote({ minutes: 1440 })).toBeNull();
    expect(dayNote({ minutes: 1380 })).toBe('23-hour day: the clocks go forward');
    expect(dayNote({ minutes: 1500 })).toBe('25-hour day: the clocks go back');
    expect(dayNote({ minutes: 1410 })).toBe('1410-minute day: the clocks go forward'); // a half-hour change (Lord Howe)
  });

  it('a column is as tall as its day is long', () => {
    expect(columnHeight({ minutes: 1440 })).toBe(864);
    expect(columnHeight({ minutes: 1380 })).toBeLessThan(864);
    expect(columnHeight({ minutes: 1500 })).toBeGreaterThan(864);
  });

  const spring = { startsAt: '2026-10-03T14:30:00Z', endsAt: '2026-10-04T13:30:00Z' }; // the 23-hour day

  it('positions are fractions of the TRUE day: 01:00-05:00 on the short day starts 1 hour in and lasts 3 of 23 hours', () => {
    const p = place(spring, { startsAt: '2026-10-03T15:30:00Z', endsAt: '2026-10-03T18:30:00Z' });
    expect(p.top).toBeCloseTo((60 / 1380) * 100, 6);
    expect(p.height).toBeCloseTo((180 / 1380) * 100, 6);
  });

  it('a window is clipped to the day it is drawn in, and one outside it disappears', () => {
    const day = { startsAt: '2027-01-10T13:30:00Z', endsAt: '2027-01-11T13:30:00Z' };
    const clipped = clipToDay(day, [
      { startsAt: '2027-01-10T00:00:00Z', endsAt: '2027-01-10T20:00:00Z', kind: 'a' },
      { startsAt: '2027-01-11T12:00:00Z', endsAt: '2027-01-12T20:00:00Z', kind: 'b' },
      { startsAt: '2027-01-12T00:00:00Z', endsAt: '2027-01-12T01:00:00Z', kind: 'c' },
      { startsAt: '2027-01-10T10:00:00Z', endsAt: '2027-01-10T13:30:00Z', kind: 'd' }, // ends exactly when the day starts: not in it
    ]);
    expect(clipped).toEqual([
      { startsAt: '2027-01-10T13:30:00Z', endsAt: '2027-01-10T20:00:00Z', kind: 'a' },
      { startsAt: '2027-01-11T12:00:00Z', endsAt: '2027-01-11T13:30:00Z', kind: 'b' },
    ]);
  });

  it('a slot belongs to the day it STARTS in, and to the resource asked for (null = the offering itself)', () => {
    const day = { startsAt: '2027-01-10T13:30:00Z', endsAt: '2027-01-11T13:30:00Z' };
    const slots = [
      { startsAt: '2027-01-10T22:30:00Z', endsAt: '2027-01-10T23:30:00Z', resourceId: null },
      { startsAt: '2027-01-11T13:00:00Z', endsAt: '2027-01-11T14:00:00Z', resourceId: 'court' },
      { startsAt: '2027-01-11T13:30:00Z', endsAt: '2027-01-11T14:30:00Z', resourceId: 'court' },
    ];
    expect(slotsInDay(day, slots).map(s => s.startsAt)).toEqual(['2027-01-10T22:30:00Z', '2027-01-11T13:00:00Z']);
    expect(slotsInDay(day, slots, null)).toHaveLength(1);
    expect(slotsInDay(day, slots, 'court')).toHaveLength(1);
  });
});

describe('words', () => {
  it('says why availability is empty, naming the resource, and says nothing for an unknown code', () => {
    expect(reasonText('no_offering_availability', {})).toMatch(/no hours/i);
    expect(reasonText('resource_no_availability:r1', { r1: 'Court 1' })).toBe('Court 1 has no hours in this period, so it is unavailable.');
    expect(reasonText('resource_inactive:r1', { r1: 'Court 1' })).toBe('Court 1 is inactive, so it takes no availability.');
    expect(reasonText('offering_archived', {})).toMatch(/archived/);
    expect(reasonText('something_else', {})).toBe('');
  });
});
