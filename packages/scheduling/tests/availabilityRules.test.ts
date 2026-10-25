import { describe, expect, it } from 'vitest';
import {
  END_OF_DAY,
  addLocalDays,
  isLocalTime,
  localDayOfWeek,
  splitOvernightRule,
  validateAvailabilityException,
  validateAvailabilityExceptionSet,
  validateAvailabilityRule,
  validateAvailabilityRuleForSet,
  validateAvailabilityRuleSet,
  type AvailabilityExceptionInput,
  type AvailabilityRule,
} from '../src';

const rule = (id: string, extra: Partial<AvailabilityRule> = {}): AvailabilityRule => ({
  id,
  organisationId: 'org-1',
  resourceId: null,
  offeringId: 'off-1',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '17:00',
  validFrom: null,
  validTo: null,
  ...extra,
});
const exception = (id: string, extra: Partial<AvailabilityExceptionInput> = {}): AvailabilityExceptionInput => ({
  id,
  organisationId: 'org-1',
  resourceId: null,
  offeringId: 'off-1',
  fromDate: '2026-12-24',
  toDate: '2026-12-26',
  kind: 'closed',
  reason: null,
  ...extra,
});

describe('date helpers', () => {
  it('addLocalDays crosses month, year and leap-day boundaries', () => {
    expect(addLocalDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('localDayOfWeek is 0 = Sunday, the same numbering as the rules', () => {
    expect(localDayOfWeek('2026-04-05')).toBe(0); // a Sunday
    expect(localDayOfWeek('2026-01-15')).toBe(4); // a Thursday
    expect(localDayOfWeek('2026-01-17')).toBe(6); // a Saturday
  });
});

describe('the established single-rule validator is unchanged', () => {
  it('still rejects 24:00 as a time and an end that is not after the start', () => {
    expect(isLocalTime('24:00')).toBe(false);
    expect(validateAvailabilityRule(rule('r', { endTime: '24:00' }))).not.toEqual([]);
    expect(validateAvailabilityRule(rule('r', { endTime: '09:00' }))).not.toEqual([]);
  });
});

describe('validateAvailabilityRuleForSet', () => {
  it('accepts 24:00 as the end of the day and nothing else that is not HH:MM', () => {
    expect(validateAvailabilityRuleForSet(rule('r', { startTime: '22:00', endTime: END_OF_DAY }))).toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { startTime: '23:59', endTime: END_OF_DAY }))).toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { startTime: '00:00', endTime: END_OF_DAY }))).toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { endTime: '24:01' }))).not.toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { endTime: '25:00' }))).not.toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { startTime: '24:00', endTime: END_OF_DAY }))).not.toEqual([]);
  });
  it('keeps every other check on a 24:00 rule', () => {
    expect(validateAvailabilityRuleForSet(rule('r', { endTime: END_OF_DAY, dayOfWeek: 9 }))).not.toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { endTime: END_OF_DAY, validFrom: '2026-12-01', validTo: '2026-11-01' }))).not.toEqual([]);
  });
  it('requires exactly one owner: neither and both are refused', () => {
    expect(validateAvailabilityRuleForSet(rule('r', { offeringId: null, resourceId: null }))).not.toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { offeringId: 'o', resourceId: 'x' }))).not.toEqual([]);
    expect(validateAvailabilityRuleForSet(rule('r', { offeringId: null, resourceId: 'x' }))).toEqual([]);
  });
});

describe('validateAvailabilityRuleSet', () => {
  it('accepts touching rules, different weekdays, different owners and disjoint validity ranges', () => {
    expect(validateAvailabilityRuleSet([rule('a', { endTime: '12:00' }), rule('b', { startTime: '12:00' })])).toEqual([]); // touching
    expect(validateAvailabilityRuleSet([rule('a'), rule('b', { dayOfWeek: 2 })])).toEqual([]);
    expect(validateAvailabilityRuleSet([rule('a'), rule('b', { offeringId: null, resourceId: 'res-1' })])).toEqual([]);
    expect(validateAvailabilityRuleSet([rule('a', { validTo: '2026-06-30' }), rule('b', { validFrom: '2026-07-01' })])).toEqual([]);
  });
  it('refuses overlapping rules of the same owner and weekday, naming both', () => {
    const problems = validateAvailabilityRuleSet([rule('a', { endTime: '13:00' }), rule('b', { startTime: '12:59' })]);
    expect(problems).toEqual(['rules a and b overlap on weekday 1']);
  });
  it('refuses an overlap that is only on the validity dates, and one that involves an open-ended range', () => {
    expect(validateAvailabilityRuleSet([rule('a', { validTo: '2026-07-01' }), rule('b', { validFrom: '2026-07-01' })])).not.toEqual([]); // share 1 July
    expect(validateAvailabilityRuleSet([rule('a'), rule('b', { validFrom: '2030-01-01' })])).not.toEqual([]); // a is open-ended
  });
  it('treats a window that reaches 24:00 as overlapping what follows its start', () => {
    expect(validateAvailabilityRuleSet([rule('a', { startTime: '22:00', endTime: END_OF_DAY }), rule('b', { startTime: '23:00', endTime: '23:30' })])).not.toEqual([]);
    expect(validateAvailabilityRuleSet([rule('a', { startTime: '22:00', endTime: END_OF_DAY }), rule('b', { dayOfWeek: 2, startTime: '00:00', endTime: '02:00' })])).toEqual([]);
  });
  it('refuses duplicate ids and reports an invalid rule without crashing the overlap check', () => {
    expect(validateAvailabilityRuleSet([rule('a'), rule('a', { dayOfWeek: 2 })])).toContain('rule a: duplicate id');
    expect(validateAvailabilityRuleSet([rule('a', { startTime: 'nope' }), rule('b')]).length).toBeGreaterThan(0);
  });
});

describe('validateAvailabilityException and the set', () => {
  it('accepts a closure and an override with windows', () => {
    expect(validateAvailabilityException(exception('c'))).toEqual([]);
    expect(validateAvailabilityException(exception('o', { kind: 'override', windows: [{ startTime: '10:00', endTime: '14:00' }] }))).toEqual([]);
    expect(validateAvailabilityException(exception('o', { kind: 'override', windows: [{ startTime: '10:00', endTime: END_OF_DAY }] }))).toEqual([]);
  });
  it('refuses an override with no windows (it would silently mean closed)', () => {
    expect(validateAvailabilityException(exception('o', { kind: 'override' }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('o', { kind: 'override', windows: [] }))).not.toEqual([]);
  });
  it('a closure that carries windows is a PARTIAL-DAY closure (Phase 2B.3c, a deliberate change: it was refused in 2B.3a); a bad window in it is still refused', () => {
    expect(validateAvailabilityException(exception('c', { windows: [{ startTime: '10:00', endTime: '11:00' }] }))).toEqual([]);
    expect(validateAvailabilityException(exception('c', { windows: [{ startTime: '11:00', endTime: '10:00' }] }))).not.toEqual([]);
  });
  it('refuses bad dates, reversed ranges, bad kinds, bad or overlapping windows and a missing or double owner', () => {
    expect(validateAvailabilityException(exception('c', { fromDate: '2026-02-30' }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('c', { fromDate: '2026-12-26', toDate: '2026-12-24' }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('c', { kind: 'maybe' as never }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('o', { kind: 'override', windows: [{ startTime: '12:00', endTime: '11:00' }] }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('o', { kind: 'override', windows: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' }] }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('c', { offeringId: null, resourceId: null }))).not.toEqual([]);
    expect(validateAvailabilityException(exception('c', { offeringId: 'o', resourceId: 'r' }))).not.toEqual([]);
  });
  it('a single-day exception (from = to) is valid', () => {
    expect(validateAvailabilityException(exception('c', { fromDate: '2026-12-25', toDate: '2026-12-25' }))).toEqual([]);
  });
  it('refuses two exceptions of the same owner and kind that share a date, but allows a closure inside an override', () => {
    expect(validateAvailabilityExceptionSet([exception('a'), exception('b', { fromDate: '2026-12-26', toDate: '2026-12-31' })])).not.toEqual([]);
    expect(validateAvailabilityExceptionSet([exception('a'), exception('b', { fromDate: '2026-12-27', toDate: '2026-12-31' })])).toEqual([]);
    const wide = exception('o', { kind: 'override', fromDate: '2026-12-20', toDate: '2027-01-05', windows: [{ startTime: '10:00', endTime: '14:00' }] });
    expect(validateAvailabilityExceptionSet([wide, exception('c', { fromDate: '2026-12-25', toDate: '2026-12-25' })])).toEqual([]);
    expect(validateAvailabilityExceptionSet([wide, { ...wide, id: 'o2', fromDate: '2027-01-05', toDate: '2027-01-09' }])).not.toEqual([]);
    expect(validateAvailabilityExceptionSet([exception('a'), exception('b', { offeringId: null, resourceId: 'r' })])).toEqual([]); // other owner
  });
});

describe('splitOvernightRule', () => {
  it('splits Friday 22:00 to 02:00 into Friday 22:00-24:00 and Saturday 00:00-02:00', () => {
    const parts = splitOvernightRule({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null });
    expect(parts).toEqual([
      { dayOfWeek: 5, startTime: '22:00', endTime: '24:00', validFrom: null, validTo: null },
      { dayOfWeek: 6, startTime: '00:00', endTime: '02:00', validFrom: null, validTo: null },
    ]);
  });
  it('wraps Saturday into Sunday and moves the second half validity dates forward a day', () => {
    const parts = splitOvernightRule({ dayOfWeek: 6, startTime: '23:00', endTime: '01:00', validFrom: '2026-12-31', validTo: '2027-01-31' });
    expect(parts[1]).toEqual({ dayOfWeek: 0, startTime: '00:00', endTime: '01:00', validFrom: '2027-01-01', validTo: '2027-02-01' });
    expect(parts[0].validFrom).toBe('2026-12-31');
  });
  it('an end equal to the start is a full overnight window; an end of 00:00 is "until midnight"; an ordinary rule is unchanged', () => {
    expect(splitOvernightRule({ dayOfWeek: 1, startTime: '09:00', endTime: '09:00', validFrom: null, validTo: null })).toHaveLength(2);
    expect(splitOvernightRule({ dayOfWeek: 1, startTime: '20:00', endTime: '00:00', validFrom: null, validTo: null })).toEqual([{ dayOfWeek: 1, startTime: '20:00', endTime: '24:00', validFrom: null, validTo: null }]);
    expect(splitOvernightRule({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null })).toEqual([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null }]);
  });
  it('the parts it produces are valid, storable rules that do not overlap', () => {
    const parts = splitOvernightRule({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null }).map((p, i) => rule(`p${i}`, p));
    expect(validateAvailabilityRuleSet(parts)).toEqual([]);
  });
  it('refuses malformed input', () => {
    expect(() => splitOvernightRule({ dayOfWeek: 9, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null })).toThrow();
    expect(() => splitOvernightRule({ dayOfWeek: 1, startTime: '22:00', endTime: '24:00', validFrom: null, validTo: null })).toThrow();
  });
});
