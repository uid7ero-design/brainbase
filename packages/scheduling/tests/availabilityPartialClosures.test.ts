import { describe, expect, it } from 'vitest';
import {
  END_OF_DAY,
  checkExceptionWrite,
  checkRuleBatch,
  computeAvailability,
  expandOwnerAvailability,
  minutesToWindowTime,
  subtractLocalWindows,
  validateAvailabilityException,
  validateAvailabilityExceptionSet,
  type AvailabilityExceptionInput,
  type AvailabilityOwner,
  type LocalWindow,
  type NewStoredRuleInput,
  type StoredAvailabilityException,
  type StoredAvailabilityRule,
} from '../src';
import { rule as ruleFixture } from './support/availabilityFixtures';

// Phase 2B.3c: PARTIAL-DAY CLOSURES in the core. A closure without windows closes the whole day (unchanged); a closure with windows
// removes only those local times. Everything else about exceptions is unchanged (override, closed-beats-override, same-kind overlap).

const ADL = 'Australia/Adelaide';
const OFF = 'off-1';
const mondayRule = (start: string, end: string, id = 'r1') => ruleFixture(id, { offeringId: OFF, resourceId: null, dayOfWeek: 1, startTime: start, endTime: end });
const closure = (id: string, extra: Partial<AvailabilityExceptionInput> = {}): AvailabilityExceptionInput => ({
  id, organisationId: 'org-1', resourceId: null, offeringId: OFF, fromDate: '2027-03-01', toDate: '2027-03-01', kind: 'closed', reason: null, ...extra,
});
const w = (startTime: string, endTime: string): LocalWindow => ({ startTime: startTime as LocalWindow['startTime'], endTime: endTime as LocalWindow['endTime'] });
const MONDAY = '2027-03-01'; // a Monday, +10:30 (summer time) in Adelaide
const hours = (iv: { startsAt: string; endsAt: string }[]) => iv.map(i => [new Date(i.startsAt).toISOString().slice(11, 16), new Date(i.endsAt).toISOString().slice(11, 16)]);
const expand = (rules: ReturnType<typeof mondayRule>[], exceptions: AvailabilityExceptionInput[], date = MONDAY, to = date) => expandOwnerAvailability({ rules, exceptions }, date, to, ADL);

describe('validation of a closure with windows', () => {
  it('accepts a partial-day closure, with 24:00 as its end', () => {
    expect(validateAvailabilityException(closure('c', { windows: [w('12:00', '13:00')] }))).toEqual([]);
    expect(validateAvailabilityException(closure('c', { windows: [w('22:00', END_OF_DAY)] }))).toEqual([]);
    expect(validateAvailabilityException(closure('c'))).toEqual([]); // whole day, as before
    expect(validateAvailabilityException(closure('c', { windows: [] }))).toEqual([]);
  });
  it('refuses a malformed, backwards or self-overlapping window', () => {
    expect(validateAvailabilityException(closure('c', { windows: [w('13:00', '12:00')] }))).not.toEqual([]);
    expect(validateAvailabilityException(closure('c', { windows: [w('12:00', '12:00')] }))).not.toEqual([]);
    expect(validateAvailabilityException(closure('c', { windows: [w('9am', '10:00')] }))).not.toEqual([]);
    expect(validateAvailabilityException(closure('c', { windows: [w('09:00', '12:00'), w('11:00', '13:00')] }))).not.toEqual([]);
  });
});

describe('the exception set: closures may share a date when they remove different times', () => {
  const lunch = closure('lunch', { windows: [w('12:00', '13:00')] });
  const arvo = closure('arvo', { windows: [w('15:00', '17:00')] });
  it('two disjoint partial closures on one date, or touching ones, are fine', () => {
    expect(validateAvailabilityExceptionSet([lunch, arvo])).toEqual([]);
    expect(validateAvailabilityExceptionSet([lunch, closure('next', { windows: [w('13:00', '14:00')] })])).toEqual([]);
  });
  it('overlapping times on a shared date are refused; so is a whole-day closure with any closure on a shared date', () => {
    expect(validateAvailabilityExceptionSet([lunch, closure('x', { windows: [w('12:30', '14:00')] })])).not.toEqual([]);
    expect(validateAvailabilityExceptionSet([lunch, closure('whole')])).not.toEqual([]);
    expect(validateAvailabilityExceptionSet([closure('whole'), lunch])).not.toEqual([]);
    expect(validateAvailabilityExceptionSet([closure('a'), closure('b')])).not.toEqual([]); // two whole-day closures: unchanged
  });
  it('different dates never conflict, and a date range shares each of its dates', () => {
    expect(validateAvailabilityExceptionSet([lunch, closure('other', { fromDate: '2027-03-02', toDate: '2027-03-02', windows: [w('12:00', '13:00')] })])).toEqual([]);
    expect(validateAvailabilityExceptionSet([lunch, closure('range', { fromDate: '2027-02-27', toDate: '2027-03-03', windows: [w('12:30', '13:30')] })])).not.toEqual([]);
  });
  it('a partial closure inside an override range is allowed, as a whole-day closure is', () => {
    const wide = closure('o', { kind: 'override', fromDate: '2027-02-20', toDate: '2027-03-10', windows: [w('10:00', '14:00')] });
    expect(validateAvailabilityExceptionSet([wide, lunch])).toEqual([]);
  });
});

describe('the computation removes only the closed times', () => {
  it('a lunch closure splits the day in two', () => {
    const r = expand([mondayRule('09:00', '17:00')], [closure('c', { windows: [w('12:00', '13:00')] })]);
    expect(hours(r.intervals)).toEqual([['22:30', '01:30'], ['02:30', '06:30']]); // 09:00-12:00 and 13:00-17:00 at +10:30
  });
  it('a closure at either edge trims the day; one that covers it removes it; one outside it changes nothing', () => {
    expect(hours(expand([mondayRule('09:00', '17:00')], [closure('c', { windows: [w('08:00', '10:00')] })]).intervals)).toEqual([['23:30', '06:30']]);
    expect(hours(expand([mondayRule('09:00', '17:00')], [closure('c', { windows: [w('16:00', END_OF_DAY)] })]).intervals)).toEqual([['22:30', '05:30']]);
    expect(expand([mondayRule('09:00', '17:00')], [closure('c', { windows: [w('08:00', '18:00')] })]).intervals).toEqual([]);
    expect(hours(expand([mondayRule('09:00', '17:00')], [closure('c', { windows: [w('18:00', '19:00')] })]).intervals)).toEqual([['22:30', '06:30']]);
  });
  it('several closures of one day, and one closure over several days', () => {
    const r = expand(
      [mondayRule('08:00', '20:00')],
      [closure('a', { windows: [w('10:00', '11:00')] }), closure('b', { windows: [w('14:00', '15:00')] })],
    );
    expect(r.intervals).toHaveLength(3);
    const week = expand([mondayRule('09:00', '17:00')], [closure('c', { fromDate: '2027-03-01', toDate: '2027-03-15', windows: [w('12:00', '13:00')] })], '2027-03-01', '2027-03-15');
    expect(week.intervals).toHaveLength(6); // Mondays 1, 8, 15 x two halves
  });
  it('a whole-day closure still removes the whole day, and wins over a partial one elsewhere in the range', () => {
    expect(expand([mondayRule('09:00', '17:00')], [closure('c')]).intervals).toEqual([]);
    const mixed = expand([mondayRule('09:00', '17:00')], [closure('whole', { fromDate: '2027-03-01', toDate: '2027-03-01' }), closure('part', { fromDate: '2027-03-08', toDate: '2027-03-08', windows: [w('12:00', '13:00')] })], '2027-03-01', '2027-03-08');
    expect(mixed.intervals).toHaveLength(2); // Monday 1 gone; Monday 8 in two halves
  });
  it('cuts an override\'s windows too, and the closure still beats nothing else', () => {
    const r = expand(
      [mondayRule('09:00', '17:00')],
      [closure('o', { kind: 'override', windows: [w('10:00', '14:00')] }), closure('c', { windows: [w('12:00', '13:00')] })],
    );
    expect(hours(r.intervals)).toEqual([['23:30', '01:30'], ['02:30', '03:30']]); // 10-12 and 13-14
  });
  it('an unknown kind still fails closed', () => {
    expect(expand([mondayRule('09:00', '17:00')], [closure('x', { kind: 'maybe' as never, windows: [w('12:00', '13:00')] })]).intervals).toEqual([]);
  });
  it('slots disappear only where the closure is, and the grid does not shift', () => {
    const r = computeAvailability({
      timezone: ADL, fromDate: MONDAY, toDate: MONDAY, offering: { id: OFF, archivedAt: null },
      offeringRules: [mondayRule('09:00', '17:00')], offeringExceptions: [closure('c', { windows: [w('12:00', '13:00')] })], resources: [], slot: { durationMinutes: 60, stepMinutes: 60 },
    });
    if (!r.ok) throw new Error(r.problems.join());
    const local = r.slots.map(s => Number(new Date(Date.parse(s.startsAt) + 10.5 * 3600_000).toISOString().slice(11, 13)));
    expect(local).toEqual([9, 10, 11, 13, 14, 15, 16]);
  });
});

describe('subtractLocalWindows and minutesToWindowTime', () => {
  it('formats minutes, with 1440 as 24:00', () => {
    expect([0, 59, 600, 1439, 1440].map(minutesToWindowTime)).toEqual(['00:00', '00:59', '10:00', '23:59', '24:00']);
  });
  it('is exact on touching, containing and disjoint cuts', () => {
    expect(subtractLocalWindows([w('09:00', '17:00')], [w('09:00', '10:00'), w('10:00', '11:00')])).toEqual([w('11:00', '17:00')]);
    expect(subtractLocalWindows([w('09:00', '17:00')], [w('00:00', '24:00')])).toEqual([]);
    expect(subtractLocalWindows([w('09:00', '17:00')], [])).toEqual([w('09:00', '17:00')]);
    expect(subtractLocalWindows([w('09:00', '10:00'), w('11:00', '12:00')], [w('09:30', '11:30')])).toEqual([w('09:00', '09:30'), w('11:30', '12:00')]);
  });
  it('seeded property: the result never overlaps a cut, and keeps exactly the minutes outside every cut', () => {
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const win = () => {
      const s = next(1380);
      const e = s + 1 + next(1440 - s);
      return w(minutesToWindowTime(s) as string, minutesToWindowTime(e) as string);
    };
    const mins = (x: LocalWindow) => [Number(x.startTime.slice(0, 2)) * 60 + Number(x.startTime.slice(3)), x.endTime === END_OF_DAY ? 1440 : Number(x.endTime.slice(0, 2)) * 60 + Number(x.endTime.slice(3))] as const;
    for (let i = 0; i < 300; i++) {
      const base = [win()];
      const cuts = Array.from({ length: next(4) }, win);
      const out = subtractLocalWindows(base, cuts);
      const covered = new Set<number>();
      const [bs, be] = mins(base[0]);
      for (let m = bs; m < be; m++) if (!cuts.some(c => mins(c)[0] <= m && m < mins(c)[1])) covered.add(m);
      const got = new Set<number>();
      for (const o of out) {
        const [s, e] = mins(o);
        expect(e).toBeGreaterThan(s);
        for (let m = s; m < e; m++) {
          expect(got.has(m), 'no minute twice').toBe(false);
          got.add(m);
        }
      }
      expect([...got].sort((a, b) => a - b)).toEqual([...covered].sort((a, b) => a - b));
    }
  });
});

describe('the persistence checks understand windows', () => {
  const owner: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
  const stored = (id: string, extra: Partial<StoredAvailabilityException> = {}): StoredAvailabilityException => ({
    id, resourceId: 'court-1', offeringId: null, fromDate: '2027-03-01', toDate: '2027-03-01', kind: 'closed', reason: null, startTime: null, endTime: null, createdAt: '', updatedAt: '', ...extra,
  });
  const candidate = (over = {}) => ({ fromDate: '2027-03-01', toDate: '2027-03-01', kind: 'closed' as const, reason: null, ...over });

  it('a partial candidate against stored partial and whole-day closures', () => {
    const lunch = stored('l', { startTime: '12:00', endTime: '13:00' });
    expect(checkExceptionWrite(owner, [lunch], candidate({ startTime: '15:00', endTime: '16:00' }))).toEqual({ problems: [], overlaps: false });
    expect(checkExceptionWrite(owner, [lunch], candidate({ startTime: '12:30', endTime: '14:00' })).overlaps).toBe(true);
    expect(checkExceptionWrite(owner, [lunch], candidate()).overlaps).toBe(true);
    expect(checkExceptionWrite(owner, [stored('whole')], candidate({ startTime: '08:00', endTime: '09:00' })).overlaps).toBe(true);
  });
  it('an edit does not overlap the closure it replaces', () => {
    expect(checkExceptionWrite(owner, [stored('l', { startTime: '12:00', endTime: '13:00' })], candidate({ startTime: '12:15', endTime: '13:15' }), 'l').overlaps).toBe(false);
  });
  it('a one-sided or backwards window is a problem, not an overlap', () => {
    expect(checkExceptionWrite(owner, [], candidate({ startTime: '12:00' })).problems).not.toEqual([]);
    expect(checkExceptionWrite(owner, [], candidate({ startTime: '13:00', endTime: '12:00' })).problems).not.toEqual([]);
  });
});

describe('checkRuleBatch', () => {
  const owner: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
  const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });
  const stored = (id: string, over: Partial<NewStoredRuleInput> = {}): StoredAvailabilityRule => ({ id, resourceId: 'court-1', offeringId: null, ...rule(over), createdAt: '', updatedAt: '' });

  it('accepts disjoint rules, including an overnight pair and rules that touch', () => {
    expect(checkRuleBatch(owner, [], [rule({ dayOfWeek: 5, startTime: '22:00', endTime: '24:00' }), rule({ dayOfWeek: 6, startTime: '00:00', endTime: '02:00' })])).toEqual({ problems: [], overlaps: false });
    expect(checkRuleBatch(owner, [stored('a', { endTime: '12:00' })], [rule({ startTime: '12:00' })]).overlaps).toBe(false);
  });
  it('reports an overlap with a stored rule, or between two rules of the batch', () => {
    expect(checkRuleBatch(owner, [stored('a')], [rule({ dayOfWeek: 2 }), rule({ startTime: '16:00', endTime: '18:00' })]).overlaps).toBe(true);
    expect(checkRuleBatch(owner, [], [rule({ endTime: '12:00' }), rule({ startTime: '11:00' })]).overlaps).toBe(true);
  });
  it('reports malformed or too many rules as problems, with the rule number when there are several', () => {
    const bad = checkRuleBatch(owner, [], [rule(), rule({ dayOfWeek: 8 })]);
    expect(bad.overlaps).toBe(false);
    expect(bad.problems.join(' ')).toMatch(/rule 2/);
    expect(checkRuleBatch(owner, [], []).problems).not.toEqual([]);
    expect(checkRuleBatch(owner, [], Array.from({ length: 15 }, (_, i) => rule({ dayOfWeek: i % 7 }))).problems.join(' ')).toMatch(/at most 14/);
  });
});
