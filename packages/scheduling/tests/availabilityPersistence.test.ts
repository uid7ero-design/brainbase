import { describe, expect, it } from 'vitest';
import {
  AvailabilityNotReadyError,
  checkExceptionWrite,
  checkRuleWrite,
  type AvailabilityOwner,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
  type StoredAvailabilityException,
  type StoredAvailabilityRule,
} from '../src';

// Phase 2B.3b: the advisory checks the API runs before the database (which stays the authority). Pure: no I/O.

const owner: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
const input = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '12:00', validFrom: null, validTo: null, ...over });
const stored = (id: string, over: Partial<NewStoredRuleInput> = {}): StoredAvailabilityRule => ({
  id, resourceId: 'court-1', offeringId: null, ...input(over), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00.000000Z',
});
const closure = (over: Partial<NewStoredExceptionInput> = {}): NewStoredExceptionInput => ({ fromDate: '2026-12-24', toDate: '2026-12-26', kind: 'closed', reason: null, ...over });
const storedClosure = (id: string, over: Partial<NewStoredExceptionInput> = {}): StoredAvailabilityException => ({
  id, resourceId: 'court-1', offeringId: null, ...closure(over), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00.000000Z',
});

describe('checkRuleWrite', () => {
  it('accepts a rule alone, and one that merely touches an existing rule', () => {
    expect(checkRuleWrite(owner, [], input())).toEqual({ problems: [], overlaps: false });
    expect(checkRuleWrite(owner, [stored('a')], input({ startTime: '12:00', endTime: '17:00' }))).toEqual({ problems: [], overlaps: false });
  });

  it('reports an overlap with the same owner and weekday, but not on another weekday', () => {
    expect(checkRuleWrite(owner, [stored('a')], input({ startTime: '11:00', endTime: '13:00' })).overlaps).toBe(true);
    expect(checkRuleWrite(owner, [stored('a')], input({ dayOfWeek: 2, startTime: '11:00', endTime: '13:00' })).overlaps).toBe(false);
  });

  it('treats 24:00 as the end of the day', () => {
    expect(checkRuleWrite(owner, [stored('a', { startTime: '22:00', endTime: '24:00' })], input({ startTime: '23:00', endTime: '24:00' })).overlaps).toBe(true);
    expect(checkRuleWrite(owner, [], input({ startTime: '22:00', endTime: '24:00' })).problems).toEqual([]);
  });

  it('respects validity dates', () => {
    const existing = [stored('a', { validFrom: '2026-01-01', validTo: '2026-06-30' })];
    expect(checkRuleWrite(owner, existing, input({ validFrom: '2026-07-01' })).overlaps).toBe(false);
    expect(checkRuleWrite(owner, existing, input({ validFrom: '2026-06-30' })).overlaps).toBe(true);
  });

  it('an edit is not an overlap with the rule it replaces', () => {
    const existing = [stored('a'), stored('b', { startTime: '13:00', endTime: '15:00' })];
    expect(checkRuleWrite(owner, existing, input({ endTime: '12:30' }), 'a').overlaps).toBe(false);
    expect(checkRuleWrite(owner, existing, input({ startTime: '12:00', endTime: '14:00' }), 'a').overlaps).toBe(true);
  });

  it('reports malformed rules as problems, not as overlaps', () => {
    for (const bad of [input({ dayOfWeek: 7 }), input({ startTime: '9am' }), input({ startTime: '12:00', endTime: '09:00' }), input({ endTime: '24:01' as never }), input({ kind: 'night' as never }), input({ validFrom: '2026-06-01', validTo: '2026-05-01' })]) {
      const r = checkRuleWrite(owner, [stored('a')], bad);
      expect(r.problems.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(r.overlaps).toBe(false);
    }
  });

  it('does not modify its inputs and is deterministic', () => {
    const existing = [stored('a'), stored('b', { dayOfWeek: 3 })];
    const before = JSON.stringify(existing);
    const a = checkRuleWrite(owner, existing, input({ startTime: '10:00' }));
    expect(JSON.stringify(existing)).toBe(before);
    expect(checkRuleWrite(owner, existing, input({ startTime: '10:00' }))).toEqual(a);
  });
});

describe('checkExceptionWrite', () => {
  it('accepts disjoint closures and reports a common date (inclusive) as an overlap', () => {
    expect(checkExceptionWrite(owner, [storedClosure('a')], closure({ fromDate: '2026-12-27', toDate: '2026-12-28' }))).toEqual({ problems: [], overlaps: false });
    expect(checkExceptionWrite(owner, [storedClosure('a')], closure({ fromDate: '2026-12-26', toDate: '2026-12-28' })).overlaps).toBe(true);
  });

  it('an edit is not an overlap with the closure it replaces', () => {
    expect(checkExceptionWrite(owner, [storedClosure('a')], closure({ toDate: '2026-12-27' }), 'a').overlaps).toBe(false);
  });

  it('reports malformed closures as problems', () => {
    for (const bad of [closure({ fromDate: '2026-12-26', toDate: '2026-12-25' }), closure({ fromDate: 'x' }), closure({ toDate: '2026-02-30' })]) {
      const r = checkExceptionWrite(owner, [], bad);
      expect(r.problems.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe('AvailabilityNotReadyError', () => {
  it('carries a stable code and no database detail', () => {
    const e = new AvailabilityNotReadyError();
    expect(e.code).toBe('AVAILABILITY_NOT_READY');
    expect(e.message).not.toMatch(/column|relation|updated_at/i);
  });
});
