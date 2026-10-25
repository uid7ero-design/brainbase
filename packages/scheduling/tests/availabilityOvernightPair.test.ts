import { describe, expect, it } from 'vitest';
import { isOvernightWindowPair, splitOvernightRule, type OvernightPairRule } from '../src';

// isOvernightWindowPair: "are these two stored rules the two halves of ONE overnight window?" It is the rule the atomic removal
// (PostgresAvailabilityRepository.deleteOvernightWindow) states in SQL, and the screens' findOvernightPairs states in the browser. The
// PostgreSQL suite and the containment suite check those two agree with this one, case by case.

const rule = (over: Partial<OvernightPairRule> = {}): OvernightPairRule => ({
  resourceId: 'court-1', offeringId: null, kind: 'hours', dayOfWeek: 5, startTime: '22:00', endTime: '24:00', validFrom: null, validTo: null, ...over,
});
const evening = rule();
const morning = rule({ dayOfWeek: 6, startTime: '00:00', endTime: '02:00' });

describe('isOvernightWindowPair', () => {
  it('recognises what splitOvernightRule produces, on every weekday and with validity dates', () => {
    for (let day = 0; day < 7; day++) {
      for (const validity of [{ validFrom: null, validTo: null }, { validFrom: '2027-04-02', validTo: '2027-04-30' }, { validFrom: '2027-12-31', validTo: null }]) {
        const [first, second] = splitOvernightRule({ dayOfWeek: day, startTime: '22:00', endTime: '02:00', ...validity });
        expect(isOvernightWindowPair({ ...rule(), ...first }, { ...rule(), ...second })).toBe(true);
      }
    }
  });

  it('is directional: the evening first, the morning second', () => {
    expect(isOvernightWindowPair(evening, morning)).toBe(true);
    expect(isOvernightWindowPair(morning, evening)).toBe(false);
  });

  it.each<[string, Partial<OvernightPairRule>, Partial<OvernightPairRule>]>([
    ['the morning is two days later', {}, { dayOfWeek: 0 }],
    ['the morning is the same day', {}, { dayOfWeek: 5 }],
    ['the morning runs all day', {}, { endTime: '24:00' }],
    ['the evening is a whole day', { startTime: '00:00' }, {}],
    ['the evening stops before midnight', { endTime: '23:00' }, {}],
    ['the morning starts after midnight', {}, { startTime: '00:30' }],
    ['a different kind', {}, { kind: 'service_period' }],
    ['a different resource', {}, { resourceId: 'court-2' }],
    ['a resource and an offering', {}, { resourceId: null, offeringId: 'off-1' }],
    ['validity not shifted', { validFrom: '2027-04-02', validTo: '2027-04-30' }, { validFrom: '2027-04-02', validTo: '2027-04-30' }],
    ['only the evening is bounded', { validTo: '2027-04-30' }, {}],
    ['only the morning is bounded', {}, { validFrom: '2027-04-03' }],
  ])('is false when %s', (_name, e, m) => {
    expect(isOvernightWindowPair(rule(e), { ...morning, ...m })).toBe(false);
  });

  it('wraps the week: Saturday evening with Sunday morning, not with Monday morning', () => {
    const sat = rule({ dayOfWeek: 6 });
    expect(isOvernightWindowPair(sat, rule({ dayOfWeek: 0, startTime: '00:00', endTime: '03:00' }))).toBe(true);
    expect(isOvernightWindowPair(sat, rule({ dayOfWeek: 1, startTime: '00:00', endTime: '03:00' }))).toBe(false);
  });

  it('shifts validity across a month and a year end', () => {
    expect(isOvernightWindowPair(rule({ validFrom: '2027-02-28', validTo: '2027-12-31' }), { ...morning, validFrom: '2027-03-01', validTo: '2028-01-01' })).toBe(true);
  });
});
