import { describe, expect, it } from 'vitest';
import {
  BOOKING_REFUSAL_CODES,
  HIRE_FAILURE_CODES,
  HIRE_KEY_PATTERN,
  hireFailure,
  hireFailureFromRefusal,
  hireRequestMatches,
  normaliseHireCustomer,
  sameHireBasis,
  validateHireRequest,
  type HireRequest,
  type Reservation,
} from '../src';

const base: HireRequest = {
  idempotencyKey: 'hire-key-000001-abcdefgh',
  offeringId: 'off-1',
  resourceId: 'court-1',
  start: { date: '2026-11-16', time: '10:00' },
  partySize: 2,
  customer: { name: 'Pat Hirer', email: 'Pat@Example.com', phone: '0400 000 000' },
  notes: 'bring own balls',
};

const stored = (over: Partial<Reservation> = {}): Reservation =>
  ({
    id: 'r1', organisationId: 'org', scheduleId: 's1', presetKey: 'resource_hire', presetVersion: 1, offeringId: 'off-1', resourceId: 'court-1', customerId: null,
    customerSnapshot: { displayName: 'Pat Hirer', email: 'Pat@Example.com', emailNormalised: 'pat@example.com', phone: '0400 000 000' },
    timezone: 'Australia/Adelaide', instants: { startsAt: '2026-11-16T23:30:00Z', endsAt: '2026-11-17T00:30:00Z' }, participants: [], partySize: 2,
    span: { kind: 'slot', date: '2026-11-16', startTime: '10:00', durationMinutes: 60 }, status: 'confirmed', attendance: null, paymentStatus: 'unpaid',
    price: { amountCents: 5000, currency: 'AUD' }, seriesId: null, notes: 'bring own balls', ...over,
  }) as Reservation;

describe('validateHireRequest', () => {
  it('accepts the minimum (a name only) and the full request', () => {
    expect(validateHireRequest(base)).toEqual([]);
    expect(validateHireRequest({ ...base, customer: { name: 'Sam' }, notes: undefined })).toEqual([]);
    expect(validateHireRequest({ ...base, customer: { name: 'Sam', email: null, phone: null }, notes: null })).toEqual([]);
  });
  it('names every wrong field and never the value', () => {
    const bad = { ...base, idempotencyKey: 'x', offeringId: '', partySize: 0, customer: { name: ' ', email: 'nope', phone: 'abc' }, start: { date: '2026-13-01', time: '99:00' }, notes: 'a\u0000' };
    const problems = validateHireRequest(bad as HireRequest);
    expect(problems).toEqual(expect.arrayContaining(['idempotencyKey', 'offeringId', 'partySize', 'customer.name', 'customer.email', 'customer.phone', 'start.date', 'start.time', 'notes']));
    expect(problems.join(' ')).not.toMatch(/nope|abc/);
  });
  it('bounds: name 120, phone 32, notes 1000, party 1000, step at least 5', () => {
    expect(validateHireRequest({ ...base, customer: { name: 'x'.repeat(120) } })).toEqual([]);
    expect(validateHireRequest({ ...base, customer: { name: 'x'.repeat(121) } })).toContain('customer.name');
    expect(validateHireRequest({ ...base, notes: 'n'.repeat(1000) })).toEqual([]);
    expect(validateHireRequest({ ...base, notes: 'n'.repeat(1001) })).toContain('notes');
    expect(validateHireRequest({ ...base, partySize: 1000 })).toEqual([]);
    expect(validateHireRequest({ ...base, partySize: 1001 })).toContain('partySize');
    expect(validateHireRequest({ ...base, stepMinutes: 5 })).toEqual([]);
    expect(validateHireRequest({ ...base, stepMinutes: 4 })).toContain('stepMinutes');
  });
  it('keys: 16-80 of [A-Za-z0-9_-]', () => {
    for (const ok of ['a'.repeat(16), 'a'.repeat(80), 'AB-cd_12-34567890']) expect(HIRE_KEY_PATTERN.test(ok)).toBe(true);
    for (const bad of ['a'.repeat(15), 'a'.repeat(81), 'has space 1234567890', 'unicode-é-1234567890', '']) expect(HIRE_KEY_PATTERN.test(bad)).toBe(false);
  });
  it('a body that carries an organisation is not a different request: the type has no such field, and the validator reads none', () => {
    const sneaky = { ...base, organisationId: 'someone-else' } as unknown as HireRequest;
    expect(validateHireRequest(sneaky)).toEqual([]);
    expect(Object.keys(normaliseHireCustomer(sneaky))).not.toContain('organisationId');
  });
});

describe('normaliseHireCustomer', () => {
  it('trims, normalises the email, makes absent fields explicit, and treats blank notes as absent', () => {
    expect(normaliseHireCustomer({ customer: { name: '  Pat  ', email: ' Pat@Example.com ', phone: ' 0400 ' }, notes: '  ' })).toEqual({ name: 'Pat', email: 'Pat@Example.com', emailNormalised: 'pat@example.com', phone: '0400', notes: null });
    expect(normaliseHireCustomer({ customer: { name: 'Sam' } })).toEqual({ name: 'Sam', email: null, emailNormalised: null, phone: null, notes: null });
  });
});

describe('hireRequestMatches (idempotency payload comparison)', () => {
  it('the same request matches, whatever the letter case of the email or the padding of the name', () => {
    expect(hireRequestMatches(stored(), base)).toBe(true);
    expect(hireRequestMatches(stored(), { ...base, customer: { name: '  Pat Hirer ', email: 'PAT@example.COM', phone: '0400 000 000' } })).toBe(true);
  });
  it('anything the caller chose, if different, does not match', () => {
    const cases: Array<Partial<HireRequest>> = [
      { offeringId: 'off-2' }, { resourceId: 'court-2' }, { start: { date: '2026-11-17', time: '10:00' } }, { start: { date: '2026-11-16', time: '11:00' } }, { partySize: 3 },
      { customer: { ...base.customer, name: 'Someone' } }, { customer: { ...base.customer, email: 'x@example.com' } }, { customer: { ...base.customer, phone: '1' } }, { notes: 'other' }, { notes: null }, { durationMinutes: 90 },
    ];
    for (const c of cases) expect(hireRequestMatches(stored(), { ...base, ...c })).toBe(false);
  });
  it('a stated duration is compared to what was stored, an omitted one is not compared at all', () => {
    expect(hireRequestMatches(stored(), { ...base, durationMinutes: 60 })).toBe(true);
    expect(hireRequestMatches(stored(), { ...base, durationMinutes: undefined })).toBe(true);
  });
  it('a reservation that is not a slot never matches', () => {
    expect(hireRequestMatches(stored({ span: { kind: 'occurrence', occurrenceId: 'o' } }), base)).toBe(false);
  });
});

describe('the failure taxonomy', () => {
  it('has a unique, closed set of codes and a family for each', () => {
    expect(new Set(HIRE_FAILURE_CODES).size).toBe(HIRE_FAILURE_CODES.length);
    for (const code of HIRE_FAILURE_CODES) expect(['invalid', 'refusal', 'transient', 'unknown']).toContain(hireFailure(code, 'm').family);
  });
  it('only a busy database and an unknown outcome are retryable; a refusal never is', () => {
    expect(HIRE_FAILURE_CODES.filter(c => hireFailure(c, 'm').retryable).sort()).toEqual(['contention_timeout', 'outcome_unknown']);
    expect(hireFailure('contention_timeout', 'm').family).toBe('transient');
    expect(hireFailure('outcome_unknown', 'm').family).toBe('unknown');
    expect(hireFailure('resource_conflict', 'm').family).toBe('refusal');
    expect(hireFailure('validation', 'm').family).toBe('invalid');
  });
  it('every code the booking evaluator can produce maps to a hire code (or to validation), never to something unlisted', () => {
    for (const code of BOOKING_REFUSAL_CODES) {
      const f = hireFailureFromRefusal(code, 'm');
      expect(HIRE_FAILURE_CODES).toContain(f.code);
      expect(f.ok).toBe(false);
    }
    expect(hireFailureFromRefusal('timezone_changed', 'm').code).toBe('availability_changed');
    expect(hireFailureFromRefusal('resource_required', 'm').code).toBe('resource_not_eligible');
    expect(hireFailureFromRefusal('invalid_request', 'm').code).toBe('validation');
    expect(hireFailureFromRefusal('off_grid', 'm').code).toBe('off_grid');
  });
  it('a refusal from the evaluator is never reported as a transient failure', () => {
    for (const code of BOOKING_REFUSAL_CODES) if (code !== 'contention_timeout') expect(hireFailureFromRefusal(code, 'm').family).not.toBe('transient');
  });
});

describe('sameHireBasis', () => {
  const b = { offeringVersion: '3', resourceVersion: '5', offeringToken: '2026-11-02T00:00:00.000001Z', scheduleToken: '2026-11-01T00:00:00.000002Z' };
  it('is equal only when all four values are', () => {
    expect(sameHireBasis(b, { ...b })).toBe(true);
    for (const k of Object.keys(b) as Array<keyof typeof b>) expect(sameHireBasis(b, { ...b, [k]: 'x' })).toBe(false);
  });
});
