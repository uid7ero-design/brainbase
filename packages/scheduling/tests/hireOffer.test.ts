import { describe, expect, it } from 'vitest';
import {
  HIRE_OFFER_MAX_DAYS,
  addLocalDays,
  evaluateSlotBooking,
  groupOfferedStarts,
  offeredHireStarts,
  resolveLocalTime,
  validateHireOfferRange,
  type AvailabilityRule,
  type IanaTimezone,
  type ResourceHold,
  type SlotBookingContext,
} from '../src';
import { rule as ruleFixture } from './support/availabilityFixtures';

// Phase 2C.3c-B: the starts a staff member is offered are exactly the starts the shared engine accepts (evaluateSlotBooking), on the offering's configured-duration grid, never in the
// past, never held, never in a daylight-saving gap, and a repeated fall-back hour once.

const ADL = 'Australia/Adelaide' as IanaTimezone;
const OFF = 'off-1';
const COURT = 'court-1';
const allWeek = (make: (id: string, day: number) => AvailabilityRule) => [0, 1, 2, 3, 4, 5, 6].map(d => make(`r${d}`, d));
const offeringRules = (startTime: string, endTime: string) => allWeek((id, d) => ruleFixture(id, { offeringId: OFF, resourceId: null, dayOfWeek: d, startTime, endTime }));
const resourceRules = (startTime: string, endTime: string) => allWeek((id, d) => ruleFixture(`c${id}`, { offeringId: null, resourceId: COURT, dayOfWeek: d, startTime, endTime }));
const hold = (startsAt: string, endsAt: string): ResourceHold => ({ id: `h-${startsAt}`, resourceId: COURT, startsAt, endsAt, reservationId: 'r', occurrenceId: null, releasedAt: null }) as ResourceHold;

function context(over: { hours?: [string, string]; duration?: number; now?: string; holds?: ResourceHold[]; zone?: IanaTimezone } = {}): SlotBookingContext {
  const [from, to] = over.hours ?? ['09:00', '17:00'];
  const zone = over.zone ?? ADL;
  return {
    timezone: zone,
    offering: { id: OFF, archivedAt: null },
    offeringRules: offeringRules(from, to),
    offeringExceptions: [],
    resources: [{ resource: { id: COURT, active: true }, timezone: zone, rules: resourceRules(from, to), exceptions: [], holds: over.holds ?? [] }],
    stepMinutes: over.duration ?? 60,
    now: over.now ?? '2026-11-01T00:00:00Z',
    presetKey: 'resource_hire',
    resourceDetails: new Map([[COURT, { capacity: 4, kind: 'court' as never }]]),
    requirePinnedZones: true,
  };
}
const offer = (ctx: SlotBookingContext, fromDate: string, toDate: string, durationMinutes = ctx.stepMinutes) => {
  const r = offeredHireStarts(ctx, { resourceId: COURT, durationMinutes, fromDate, toDate });
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.starts;
};

describe('range validation', () => {
  it('accepts one day and the longest range; refuses bad dates, a reversed range and a range over the limit, by field NAME', () => {
    expect(validateHireOfferRange('2026-11-16', '2026-11-16')).toEqual([]);
    expect(validateHireOfferRange('2026-11-16', addLocalDays('2026-11-16', HIRE_OFFER_MAX_DAYS - 1))).toEqual([]);
    expect(validateHireOfferRange('2026-11-16', addLocalDays('2026-11-16', HIRE_OFFER_MAX_DAYS))).toEqual(['range']);
    expect(validateHireOfferRange('2026-11-17', '2026-11-16')).toEqual(['to']);
    expect(validateHireOfferRange('2026-02-30', '2026-03-01')).toEqual(['from']);
    expect(validateHireOfferRange('16/11/2026', undefined)).toEqual(['from', 'to']);
    expect(validateHireOfferRange(42, null)).toEqual(['from', 'to']);
  });
});

describe('the offered starts ARE the starts the booking evaluator accepts', () => {
  it('every start on a 15-minute probe of three days is offered if and only if evaluateSlotBooking accepts it (60-minute hire, 09:00-17:00)', () => {
    const ctx = context({ holds: [hold('2026-11-16T00:30:00Z', '2026-11-16T01:30:00Z')] }); // 11:00-12:00 on Monday 16 Nov (+10:30) is held
    const offered = new Set(offer(ctx, '2026-11-16', '2026-11-18').map(s => s.startsAt));
    expect(offered.size).toBeGreaterThan(0);
    let accepted = 0;
    const first = Date.parse('2026-11-15T13:30:00Z'); // local Monday midnight
    for (let ms = first; ms < first + 3 * 24 * 3_600_000; ms += 15 * 60_000) {
      const startsAt = new Date(ms).toISOString().replace('.000Z', 'Z');
      const endsAt = new Date(ms + 3_600_000).toISOString().replace('.000Z', 'Z');
      const decision = evaluateSlotBooking(ctx, { interval: { startsAt, endsAt }, resourceId: COURT, partySize: 1 });
      const isOffered = [...offered].some(o => Date.parse(o) === ms);
      expect(isOffered, startsAt).toBe(decision.ok);
      if (decision.ok) accepted += 1;
    }
    expect(accepted).toBe(offered.size);
  });

  it('the grid is the configured duration: a 90-minute hire is offered at 09:00, 10:30, 12:00 ... not at the hour', () => {
    const times = offer(context({ duration: 90 }), '2026-11-16', '2026-11-16').map(s => s.time);
    expect(times).toEqual(['09:00', '10:30', '12:00', '13:30', '15:00']);
  });

  it('a held window is not offered, nor any start that would overlap it; the neighbours are', () => {
    const times = offer(context({ holds: [hold('2026-11-16T00:30:00Z', '2026-11-16T01:30:00Z')] }), '2026-11-16', '2026-11-16').map(s => s.time);
    expect(times).not.toContain('11:00');
    expect(times).toContain('10:00');
    expect(times).toContain('12:00');
  });

  it('nothing before "now" is offered', () => {
    const times = offer(context({ now: '2026-11-16T01:00:00Z' }), '2026-11-16', '2026-11-16').map(s => s.time); // 11:30 local
    expect(times[0]).toBe('12:00');
  });

  it('a day with no hours is listed with no starts, so a date picker can grey it out', () => {
    const ctx = context();
    const days = groupOfferedStarts(offer(ctx, '2026-11-16', '2026-11-18'), '2026-11-16', '2026-11-20');
    expect(days.map(d => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    expect(days[0].starts.length).toBeGreaterThan(0);
    expect(days[3].starts).toEqual([]);
  });

  it('a single day offers the same starts whatever the range around it', () => {
    const ctx = context({ hours: ['00:00', '24:00'] });
    const narrow = offer(ctx, '2026-11-17', '2026-11-17').map(s => s.startsAt);
    const wide = offer(ctx, '2026-11-15', '2026-11-25').filter(s => s.date === '2026-11-17').map(s => s.startsAt);
    expect(wide).toEqual(narrow);
  });
});

describe('daylight saving: only starts the booking can reproduce', () => {
  it('spring forward (Adelaide, Sunday 2026-10-04): no start in the 02:00-03:00 gap; every offered (date, time) resolves back to its own instant', () => {
    const starts = offer(context({ hours: ['00:00', '24:00'], now: '2026-09-01T00:00:00Z' }), '2026-10-04', '2026-10-04');
    expect(starts.some(s => s.time >= '02:00' && s.time < '03:00')).toBe(false);
    expect(starts.length).toBe(23); // a 23-hour day of 60-minute hires on a 60-minute grid anchored at midnight
    for (const s of starts) expect(Date.parse(resolveLocalTime(s.date, s.time, ADL).instant)).toBe(Date.parse(s.startsAt));
  });

  it('fall back (Adelaide, Sunday 2027-04-04): the repeated 02:00-03:00 hour is offered ONCE, at the earlier instant that createHire would take', () => {
    const starts = offer(context({ hours: ['00:00', '24:00'], now: '2027-03-01T00:00:00Z' }), '2027-04-04', '2027-04-04');
    const twos = starts.filter(s => s.time === '02:00');
    expect(twos).toHaveLength(1);
    const resolved = resolveLocalTime('2027-04-04', '02:00', ADL);
    expect(Date.parse(twos[0].startsAt)).toBe(Date.parse(resolved.instant));
    for (const s of starts) expect(Date.parse(resolveLocalTime(s.date, s.time, ADL).instant)).toBe(Date.parse(s.startsAt));
    // the duplicate local times are gone, so a form keyed by time has no collision
    expect(new Set(starts.map(s => s.time)).size).toBe(starts.length);
  });
});

describe('failure is the engine\'s own, never a guess', () => {
  it('an unsupported rule kind makes nothing offerable (fail closed), not an exception', () => {
    const ctx = context();
    const bad = { ...ctx, offeringRules: ctx.offeringRules.map(r => ({ ...r, kind: 'service_period' as never })) };
    expect(offer(bad, '2026-11-16', '2026-11-16')).toEqual([]);
  });
});
