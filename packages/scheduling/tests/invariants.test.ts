import { describe, it, expect } from 'vitest';
import {
  assertSameTenant,
  isLocalDate,
  isLocalTime,
  minutesOfDay,
  TenantIsolationError,
  validateAvailabilityRule,
  validateCancellationPolicy,
  validateRecurrence,
  validateTimeSpan,
  type AvailabilityRule,
  type Recurrence,
} from '../src';

describe('local date and time', () => {
  it('accepts real calendar dates only', () => {
    expect(isLocalDate('2026-10-21')).toBe(true);
    expect(isLocalDate('2028-02-29')).toBe(true); // leap year
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-1-1')).toBe(false);
    expect(isLocalDate('2026-10-21T00:00:00Z')).toBe(false);
    expect(isLocalDate(20261021)).toBe(false);
    expect(isLocalDate(null)).toBe(false);
  });

  it('accepts HH:MM 24-hour times only', () => {
    expect(isLocalTime('00:00')).toBe(true);
    expect(isLocalTime('23:59')).toBe(true);
    expect(isLocalTime('24:00')).toBe(false);
    expect(isLocalTime('7:30')).toBe(false);
    expect(isLocalTime('07:60')).toBe(false);
    expect(isLocalTime('07:30:00')).toBe(false);
    expect(minutesOfDay('01:30')).toBe(90);
    expect(() => minutesOfDay('nope')).toThrow();
  });
});

describe('recurrence invariants', () => {
  const weekly = (over: Partial<Extract<Recurrence, { kind: 'weekly' }>> = {}): Recurrence => ({
    kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-02', end: { mode: 'ongoing' }, ...over,
  });

  it('none is always valid; a plain ongoing weekly series is valid', () => {
    expect(validateRecurrence({ kind: 'none' })).toEqual([]);
    expect(validateRecurrence(weekly())).toEqual([]);
  });

  it('a legacy series with no start date is valid while ongoing or on_date (production treats it as "from today")', () => {
    expect(validateRecurrence(weekly({ startDate: null }))).toEqual([]);
    expect(validateRecurrence(weekly({ startDate: null, end: { mode: 'on_date', date: '2026-12-01' } }))).toEqual([]);
  });

  it('after_occurrences needs a positive integer count and a start date', () => {
    expect(validateRecurrence(weekly({ end: { mode: 'after_occurrences', count: 10 } }))).toEqual([]);
    expect(validateRecurrence(weekly({ end: { mode: 'after_occurrences', count: 0 } }))).not.toEqual([]);
    expect(validateRecurrence(weekly({ end: { mode: 'after_occurrences', count: 2.5 } }))).not.toEqual([]);
    expect(validateRecurrence(weekly({ startDate: null, end: { mode: 'after_occurrences', count: 4 } }))).not.toEqual([]);
  });

  it('on_date needs a real date that is not before the start', () => {
    expect(validateRecurrence(weekly({ end: { mode: 'on_date', date: '2026-12-31' } }))).toEqual([]);
    expect(validateRecurrence(weekly({ end: { mode: 'on_date', date: '2026-11-01' } }))).not.toEqual([]);
    expect(validateRecurrence(weekly({ end: { mode: 'on_date', date: '2026-02-30' } }))).not.toEqual([]);
  });

  it('day of week must be 0..6 and a start date, when present, must be real', () => {
    expect(validateRecurrence(weekly({ dayOfWeek: 7 }))).not.toEqual([]);
    expect(validateRecurrence(weekly({ dayOfWeek: -1 }))).not.toEqual([]);
    expect(validateRecurrence(weekly({ dayOfWeek: 1.5 }))).not.toEqual([]);
    expect(validateRecurrence(weekly({ startDate: '2026-02-30' }))).not.toEqual([]);
  });
});

describe('time span invariants', () => {
  it('slot needs a real date, a time and a positive duration', () => {
    expect(validateTimeSpan({ kind: 'slot', date: '2026-11-01', startTime: '09:00', durationMinutes: 30 })).toEqual([]);
    expect(validateTimeSpan({ kind: 'slot', date: '2026-11-01', startTime: '9am', durationMinutes: 30 })).not.toEqual([]);
    expect(validateTimeSpan({ kind: 'slot', date: '2026-11-01', startTime: '09:00', durationMinutes: 0 })).not.toEqual([]);
  });

  it('a stay must end after it starts', () => {
    expect(validateTimeSpan({ kind: 'stay', checkIn: '2026-11-01', checkOut: '2026-11-02' })).toEqual([]);
    expect(validateTimeSpan({ kind: 'stay', checkIn: '2026-11-02', checkOut: '2026-11-01' })).not.toEqual([]);
    expect(validateTimeSpan({ kind: 'stay', checkIn: '2026-11-01', checkOut: '2026-11-01' })).not.toEqual([]);
  });

  it('an occurrence span needs an occurrence id', () => {
    expect(validateTimeSpan({ kind: 'occurrence', occurrenceId: 'x' })).toEqual([]);
    expect(validateTimeSpan({ kind: 'occurrence', occurrenceId: '' })).not.toEqual([]);
  });
});

describe('cancellation policy invariants', () => {
  it('accepts sensible policies', () => {
    expect(validateCancellationPolicy({ customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } })).toEqual([]);
    expect(validateCancellationPolicy({ customerCanCancel: true, freeCancellationHoursBefore: null, lateCancellationCharge: { kind: 'none' } })).toEqual([]);
    expect(validateCancellationPolicy({ customerCanCancel: true, freeCancellationHoursBefore: 0, lateCancellationCharge: { kind: 'percent', percent: 100 } })).toEqual([]);
  });

  it('rejects negative or fractional hours, out-of-range percent, fractional cents and a charge with cancellation disabled', () => {
    const ok = { customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } } as const;
    expect(validateCancellationPolicy({ ...ok, freeCancellationHoursBefore: -1 })).not.toEqual([]);
    expect(validateCancellationPolicy({ ...ok, freeCancellationHoursBefore: 1.5 })).not.toEqual([]);
    expect(validateCancellationPolicy({ ...ok, lateCancellationCharge: { kind: 'percent', percent: 101 } })).not.toEqual([]);
    expect(validateCancellationPolicy({ ...ok, lateCancellationCharge: { kind: 'percent', percent: -5 } })).not.toEqual([]);
    expect(validateCancellationPolicy({ ...ok, lateCancellationCharge: { kind: 'fixed', amountCents: 10.5 } })).not.toEqual([]);
    expect(validateCancellationPolicy({ ...ok, customerCanCancel: false, lateCancellationCharge: { kind: 'fixed', amountCents: 500 } })).not.toEqual([]);
  });
});

describe('availability rule invariants', () => {
  const rule: AvailabilityRule = {
    id: 'a', organisationId: 'org-1', resourceId: 'r1', offeringId: null,
    dayOfWeek: 2, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null,
  };

  it('accepts a normal weekly window', () => {
    expect(validateAvailabilityRule(rule)).toEqual([]);
  });
  it('rejects an end at or before the start, bad times, bad day, no owner and inverted validity', () => {
    expect(validateAvailabilityRule({ ...rule, endTime: '09:00' })).not.toEqual([]);
    expect(validateAvailabilityRule({ ...rule, endTime: '08:00' })).not.toEqual([]);
    expect(validateAvailabilityRule({ ...rule, startTime: '25:00' })).not.toEqual([]);
    expect(validateAvailabilityRule({ ...rule, dayOfWeek: 9 })).not.toEqual([]);
    expect(validateAvailabilityRule({ ...rule, resourceId: null, offeringId: null })).not.toEqual([]);
    expect(validateAvailabilityRule({ ...rule, validFrom: '2026-12-01', validTo: '2026-11-01' })).not.toEqual([]);
  });
});

describe('tenant isolation guard', () => {
  it('passes for the same organisation and throws a typed error for another', () => {
    expect(() => assertSameTenant({ organisationId: 'org-a' }, 'org-a')).not.toThrow();
    expect(() => assertSameTenant({ organisationId: 'org-a' }, 'org-b')).toThrow(TenantIsolationError);
  });
  it('is exact: a prefix, a case difference or an empty id is a different tenant', () => {
    expect(() => assertSameTenant({ organisationId: 'org-a' }, 'org-a2')).toThrow(TenantIsolationError);
    expect(() => assertSameTenant({ organisationId: 'org-a' }, 'ORG-A')).toThrow(TenantIsolationError);
    expect(() => assertSameTenant({ organisationId: 'org-a' }, '')).toThrow(TenantIsolationError);
  });
});
