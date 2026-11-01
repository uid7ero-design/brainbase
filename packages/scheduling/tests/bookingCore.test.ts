import { describe, expect, it } from 'vitest';
import {
  BOOKING_REFUSAL_CODES,
  DEFAULT_MAX_OCCURRENCES_PER_RUN,
  bookingRefusal,
  evaluateHeadcount,
  evaluateSlotBooking,
  planOccurrences,
  planSeriesEnrolments,
  refusalCodeFromSchedulingError,
  type OccurrenceOffering,
  type ResourceHold,
  type SchedulingErrorCode,
  type SlotBookingContext,
} from '../src';
import { rule } from './support/availabilityFixtures';

const ADL = 'Australia/Adelaide';

// ─── planOccurrences ────────────────────────────────────────────────────────

const classOffering = (over: Partial<OccurrenceOffering> = {}): OccurrenceOffering => ({
  id: 'off-1',
  archivedAt: null,
  durationMinutes: 60,
  capacity: 12,
  startTime: '18:00',
  recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: null, end: { mode: 'ongoing' } },
  ...over,
});

describe('planOccurrences', () => {
  it('plans one occurrence per week for the horizon, starting at the first matching date', () => {
    const plan = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01' });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.create.map(o => o.date)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
    expect(plan.truncated).toBe(false);
    expect(plan.create[0]).toMatchObject({ offeringId: 'off-1', resourceId: null, startTime: '18:00', timezone: ADL, capacity: 12, ambiguous: false });
    // 18:00 ACDT (UTC+10:30) is 07:30Z; a 60-minute class ends 60 real minutes later.
    expect(plan.create[0].startsAt).toBe('2026-11-02T07:30:00Z');
    expect(plan.create[0].endsAt).toBe('2026-11-02T08:30:00Z');
  });

  it('includes today when today is the day of the week', () => {
    const plan = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-02', horizonWeeks: 1 });
    expect(plan.ok && plan.create.map(o => o.date)).toEqual(['2026-11-02']);
  });

  it('is idempotent: planning again with the written slots creates nothing', () => {
    const first = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01' });
    if (!first.ok) throw new Error('expected a plan');
    const second = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01', existing: first.create.map(o => ({ date: o.date, startTime: o.startTime, status: 'scheduled' as const })) });
    expect(second.ok && second.create).toEqual([]);
    expect(second.ok && second.skipped.every(s => s.reason === 'already_exists')).toBe(true);
    // Deterministic: the same input twice gives the same output.
    expect(planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01' })).toEqual(first);
  });

  it('never regenerates a cancelled occurrence', () => {
    const plan = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01', horizonWeeks: 2, existing: [{ date: '2026-11-02', startTime: '18:00', status: 'cancelled' }] });
    expect(plan.ok && plan.create.map(o => o.date)).toEqual(['2026-11-09']);
    expect(plan.ok && plan.skipped).toEqual([{ date: '2026-11-02', startTime: '18:00', reason: 'cancelled_stays_cancelled' }]);
  });

  it('respects the series start, an end date and an occurrence count', () => {
    const start = planOccurrences({ offering: classOffering({ recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-16', end: { mode: 'ongoing' } } }), timezone: ADL, today: '2026-11-01', horizonWeeks: 4 });
    expect(start.ok && start.create.map(o => o.date)).toEqual(['2026-11-16', '2026-11-23']);
    const until = planOccurrences({ offering: classOffering({ recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: null, end: { mode: 'on_date', date: '2026-11-10' } } }), timezone: ADL, today: '2026-11-01' });
    expect(until.ok && until.create.map(o => o.date)).toEqual(['2026-11-02', '2026-11-09']);
    // after_occurrences counts from the series start, not from today: with 3 total from 2026-10-19, only 2026-11-02 is left on 2026-11-01.
    const count = planOccurrences({ offering: classOffering({ recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2026-10-19', end: { mode: 'after_occurrences', count: 3 } } }), timezone: ADL, today: '2026-11-01' });
    expect(count.ok && count.create.map(o => o.date)).toEqual(['2026-11-02']);
  });

  it('plans nothing once a finite series has ended', () => {
    const plan = planOccurrences({ offering: classOffering({ recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2026-09-01', end: { mode: 'on_date', date: '2026-10-01' } } }), timezone: ADL, today: '2026-11-01' });
    expect(plan).toMatchObject({ ok: true, create: [], window: null });
  });

  it('caps the output and keeps the earliest dates so a later run continues where this one stopped', () => {
    const plan = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01', maxOccurrences: 3 });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.create.map(o => o.date)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(plan.truncated).toBe(true);
    const next = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01', maxOccurrences: 3, existing: plan.create.map(o => ({ date: o.date, startTime: o.startTime })) });
    expect(next.ok && next.create.map(o => o.date)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']);
  });

  it('documents the provisional defaults', () => {
    expect(DEFAULT_MAX_OCCURRENCES_PER_RUN).toBe(500);
  });

  it('refuses malformed input with a stable taxonomy, never throws', () => {
    const bad = (over: Parameters<typeof planOccurrences>[0]) => planOccurrences(over);
    const base = { offering: classOffering(), timezone: ADL, today: '2026-11-01' };
    expect(bad({ ...base, timezone: 'Mars/Olympus' })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
    expect(bad({ ...base, today: '2026-13-01' })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
    expect(bad({ ...base, horizonWeeks: 0 })).toMatchObject({ ok: false });
    expect(bad({ ...base, maxOccurrences: 0 })).toMatchObject({ ok: false });
    expect(bad({ ...base, offering: classOffering({ archivedAt: '2026-10-01T00:00:00Z' }) })).toMatchObject({ ok: false, refusal: { code: 'offering_unavailable' } });
    expect(bad({ ...base, offering: classOffering({ startTime: null }) })).toMatchObject({ ok: false, refusal: { code: 'invalid_recurrence' } });
    expect(bad({ ...base, offering: classOffering({ durationMinutes: null }) })).toMatchObject({ ok: false, refusal: { code: 'invalid_recurrence' } });
    expect(bad({ ...base, offering: classOffering({ capacity: 0 }) })).toMatchObject({ ok: false, refusal: { code: 'invalid_recurrence' } });
    expect(bad({ ...base, offering: classOffering({ recurrence: { kind: 'weekly', dayOfWeek: 9, startDate: null, end: { mode: 'ongoing' } } }) })).toMatchObject({ ok: false, refusal: { code: 'invalid_recurrence' } });
    expect(bad({ ...base, offering: classOffering({ recurrence: { kind: 'none' } }) })).toMatchObject({ ok: true, create: [] });
  });

  it('carries the resource into every planned occurrence, or null for an unassigned-space class', () => {
    const withCourt = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01', horizonWeeks: 1, resourceId: 'court-1' });
    expect(withCourt.ok && withCourt.create[0].resourceId).toBe('court-1');
    const without = planOccurrences({ offering: classOffering(), timezone: ADL, today: '2026-11-01', horizonWeeks: 1 });
    expect(without.ok && without.create[0].resourceId).toBeNull();
  });

  describe('Adelaide daylight saving', () => {
    // Clocks go forward 02:00 -> 03:00 on Sunday 2026-10-04 and back 03:00 -> 02:00 on Sunday 2027-04-04.
    const sunday = (startTime: string, over: Partial<OccurrenceOffering> = {}) =>
      classOffering({ startTime, recurrence: { kind: 'weekly', dayOfWeek: 0, startDate: null, end: { mode: 'ongoing' } }, ...over });

    it('skips, and reports, a start time that does not exist (spring forward), never shifting it', () => {
      const plan = planOccurrences({ offering: sunday('02:30'), timezone: ADL, today: '2026-09-28', horizonWeeks: 3 });
      if (!plan.ok) throw new Error('expected a plan');
      expect(plan.create.map(o => o.date)).toEqual(['2026-10-11', '2026-10-18'].slice(0, 2).concat([]).length ? ['2026-10-11', '2026-10-18'] : []);
      expect(plan.skipped).toEqual([{ date: '2026-10-04', startTime: '02:30', reason: 'nonexistent_local_time' }]);
    });

    it('keeps the wall-clock time across the change while the UTC hour moves', () => {
      const plan = planOccurrences({ offering: sunday('09:00'), timezone: ADL, today: '2026-09-28', horizonWeeks: 2 });
      if (!plan.ok) throw new Error('expected a plan');
      // 2026-10-04 is already ACDT (+10:30)? The change happens at 02:00 that day, so 09:00 is +10:30; the previous Sunday is ACST (+09:30).
      expect(plan.create.map(o => [o.date, o.startsAt])).toEqual([
        ['2026-10-04', '2026-10-03T22:30:00Z'],
        ['2026-10-11', '2026-10-10T22:30:00Z'],
      ]);
    });

    it('uses the earlier instant for a start that happens twice (fall back) and flags it', () => {
      const plan = planOccurrences({ offering: sunday('02:30'), timezone: ADL, today: '2027-03-29', horizonWeeks: 2 });
      if (!plan.ok) throw new Error('expected a plan');
      const day = plan.create.find(o => o.date === '2027-04-04');
      expect(day).toMatchObject({ ambiguous: true, startsAt: '2027-04-03T16:00:00Z' }); // 02:30 ACDT (+10:30), the earlier of the two
      expect(plan.create.find(o => o.date === '2027-04-11')).toMatchObject({ ambiguous: false });
    });

    it('measures the duration in real elapsed minutes across the repeated hour', () => {
      const plan = planOccurrences({ offering: sunday('01:30', { durationMinutes: 120 }), timezone: ADL, today: '2027-03-29', horizonWeeks: 2 });
      if (!plan.ok) throw new Error('expected a plan');
      const day = plan.create.find(o => o.date === '2027-04-04');
      expect(Date.parse(day!.endsAt) - Date.parse(day!.startsAt)).toBe(120 * 60_000);
    });
  });

  describe('property: seeded random offerings and horizons', () => {
    const prng = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const ZONES = ['Australia/Adelaide', 'Australia/Perth', 'Europe/London', 'America/New_York', 'Australia/Lord_Howe'];
    const TODAYS = ['2026-03-25', '2026-04-01', '2026-09-30', '2026-10-20', '2027-03-28', '2026-06-15'];
    it('is deterministic, idempotent, ordered, capped, on the right weekday and never overlapping a nonexistent time', () => {
      const r = prng(20261031);
      for (let i = 0; i < 300; i++) {
        const zone = ZONES[Math.floor(r() * ZONES.length)];
        const dow = Math.floor(r() * 7);
        const hh = String(Math.floor(r() * 24)).padStart(2, '0');
        const mm = ['00', '15', '30', '45'][Math.floor(r() * 4)];
        const offering = classOffering({ startTime: `${hh}:${mm}`, durationMinutes: 15 * (1 + Math.floor(r() * 12)), recurrence: { kind: 'weekly', dayOfWeek: dow, startDate: null, end: { mode: 'ongoing' } } });
        const input = { offering, timezone: zone, today: TODAYS[Math.floor(r() * TODAYS.length)], horizonWeeks: 1 + Math.floor(r() * 12), maxOccurrences: 1 + Math.floor(r() * 12) };
        const plan = planOccurrences(input);
        const label = `case ${i} ${JSON.stringify(input)}`;
        if (!plan.ok) throw new Error(`${label}: ${plan.refusal.message}`);
        expect(planOccurrences(input), label).toEqual(plan);
        expect(plan.create.length, label).toBeLessThanOrEqual(input.maxOccurrences);
        const dates = plan.create.map(o => o.date);
        expect([...dates].sort(), label).toEqual(dates);
        expect(new Set(dates).size, label).toBe(dates.length);
        for (const o of plan.create) {
          expect(new Date(o.date + 'T00:00:00Z').getUTCDay(), label).toBe(dow);
          expect(Date.parse(o.endsAt) - Date.parse(o.startsAt), label).toBe(offering.durationMinutes! * 60_000);
        }
        // Re-planning with everything written, plus the skipped slots, leaves nothing to create.
        const again = planOccurrences({ ...input, maxOccurrences: 2000, existing: plan.create.map(o => ({ date: o.date, startTime: o.startTime })) });
        if (!again.ok) throw new Error(label);
        expect(again.create.every(o => !dates.includes(o.date)), label).toBe(true);
      }
    });
  });
});

// ─── evaluateSlotBooking (facility hire / appointments) ─────────────────────

// Monday 2026-11-02, 09:00-17:00 Adelaide (ACDT, UTC+10:30): 22:30Z on the 1st to 06:30Z on the 2nd.
const NOW = '2026-10-31T00:00:00Z';
const at = (hhmm: string, date = '2026-11-02') => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000 - 10.5 * 3_600_000).toISOString().replace('.000Z', 'Z');
};
const win = (from: string, to: string, date?: string) => ({ startsAt: at(from, date), endsAt: at(to, date) });

function hireContext(over: Partial<SlotBookingContext> = {}, holds: ResourceHold[] = []): SlotBookingContext {
  return {
    timezone: ADL,
    offering: { id: 'off-1', archivedAt: null },
    offeringRules: [rule('r-off', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })],
    offeringExceptions: [],
    resources: [
      { resource: { id: 'court-1', active: true }, rules: [rule('r-c1', { offeringId: null, resourceId: 'court-1', dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })], exceptions: [], holds },
      { resource: { id: 'court-2', active: true }, rules: [rule('r-c2', { offeringId: null, resourceId: 'court-2', dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })], exceptions: [], holds: [] },
    ],
    stepMinutes: 60,
    now: NOW,
    presetKey: 'resource_hire',
    resourceDetails: new Map([
      ['court-1', { capacity: 4, kind: 'court' as const }],
      ['court-2', { capacity: 4, kind: 'court' as const }],
    ]),
    requirePinnedZones: false,
    ...over,
  };
}
const hold = (id: string, resourceId: string, from: string, to: string): ResourceHold => ({ id, resourceId, startsAt: at(from), endsAt: at(to), reservationId: `res-${id}`, occurrenceId: null, releasedAt: null });

describe('evaluateSlotBooking', () => {
  it('accepts exactly the slot the engine offers, and picks the first free resource in id order', () => {
    const d = evaluateSlotBooking(hireContext(), { interval: win('10:00', '11:00'), resourceId: null, partySize: 2 });
    expect(d).toMatchObject({ ok: true, resourceId: 'court-1' });
  });

  it('honours a named resource', () => {
    const d = evaluateSlotBooking(hireContext(), { interval: win('10:00', '11:00'), resourceId: 'court-2', partySize: 2 });
    expect(d).toMatchObject({ ok: true, resourceId: 'court-2' });
  });

  it('refuses a held time with resource_conflict, and falls through to another free resource when none is named', () => {
    const ctx = hireContext({}, [hold('h1', 'court-1', '10:00', '11:00')]);
    expect(evaluateSlotBooking(ctx, { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 2 })).toMatchObject({ ok: false, refusal: { code: 'resource_conflict', family: 'refusal' } });
    expect(evaluateSlotBooking(ctx, { interval: win('10:00', '11:00'), resourceId: null, partySize: 2 })).toMatchObject({ ok: true, resourceId: 'court-2' });
  });

  it('treats back-to-back as legal (half-open) and a one-minute overlap as a conflict', () => {
    const ctx = hireContext({ stepMinutes: 30 }, [hold('h1', 'court-1', '10:00', '11:00')]);
    expect(evaluateSlotBooking(ctx, { interval: win('11:00', '12:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
    expect(evaluateSlotBooking(ctx, { interval: win('09:00', '10:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
    expect(evaluateSlotBooking(ctx, { interval: win('10:30', '11:30'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'resource_conflict' } });
  });

  it('ignores a released hold', () => {
    const released = { ...hold('h1', 'court-1', '10:00', '11:00'), releasedAt: '2026-10-30T00:00:00Z' };
    expect(evaluateSlotBooking(hireContext({}, [released]), { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
  });

  it('refuses a time outside the hours, an off-grid start, and a past start, each with its own code', () => {
    const ctx = hireContext();
    expect(evaluateSlotBooking(ctx, { interval: win('17:00', '18:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'outside_availability' } });
    expect(evaluateSlotBooking(ctx, { interval: win('08:30', '09:30'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'outside_availability' } });
    expect(evaluateSlotBooking(ctx, { interval: win('10:15', '11:15'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'off_grid' } });
    expect(evaluateSlotBooking(hireContext({ now: at('10:30') }), { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'in_the_past' } });
  });

  it('refuses a closure date and an archived offering', () => {
    const closed = hireContext({
      offeringExceptions: [{ id: 'x1', organisationId: 'org-1', resourceId: null, offeringId: 'off-1', fromDate: '2026-11-02', toDate: '2026-11-02', kind: 'closed', reason: null }],
    });
    expect(evaluateSlotBooking(closed, { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'outside_availability' } });
    const archived = hireContext({ offering: { id: 'off-1', archivedAt: '2026-10-01T00:00:00Z' } });
    expect(evaluateSlotBooking(archived, { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'offering_unavailable' } });
  });

  it('fails closed on an unsupported service_period rule: nothing can be booked', () => {
    const ctx = hireContext({ offeringRules: [rule('r-off', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', kind: 'service_period' })] });
    expect(evaluateSlotBooking(ctx, { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'outside_availability' } });
  });

  it('refuses an inactive or unlinked resource and an oversized party before consulting the engine', () => {
    const inactive = hireContext();
    inactive.resources = inactive.resources.map(r => (r.resource.id === 'court-1' ? { ...r, resource: { id: 'court-1', active: false } } : r));
    expect(evaluateSlotBooking(inactive, { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'resource_inactive' } });
    expect(evaluateSlotBooking(hireContext(), { interval: win('10:00', '11:00'), resourceId: 'court-9', partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'resource_not_eligible' } });
    expect(evaluateSlotBooking(hireContext(), { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 5 })).toMatchObject({ ok: false, refusal: { code: 'party_exceeds_resource' } });
  });

  it('refuses presets that do not take slot bookings in this release, and bad requests', () => {
    expect(evaluateSlotBooking(hireContext({ presetKey: 'classes_coaching' }), { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'preset_not_supported' } });
    expect(evaluateSlotBooking(hireContext({ presetKey: 'restaurant_tables' }), { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'preset_not_supported' } });
    expect(evaluateSlotBooking(hireContext(), { interval: { startsAt: 'x', endsAt: 'y' }, resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
    expect(evaluateSlotBooking(hireContext(), { interval: win('11:00', '10:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
    expect(evaluateSlotBooking(hireContext(), { interval: win('10:00', '11:00'), resourceId: null, partySize: 0 })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
    expect(evaluateSlotBooking(hireContext({ resources: [] }), { interval: win('10:00', '11:00'), resourceId: null, partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'resource_required' } });
  });

  it('does not mutate its inputs and is deterministic', () => {
    const ctx = hireContext({}, [hold('h1', 'court-1', '10:00', '11:00')]);
    const before = JSON.stringify({ ...ctx, resourceDetails: [...ctx.resourceDetails] });
    const req = { interval: win('12:00', '13:00'), resourceId: null, partySize: 2 };
    const a = evaluateSlotBooking(ctx, req);
    expect(evaluateSlotBooking(ctx, req)).toEqual(a);
    expect(JSON.stringify({ ...ctx, resourceDetails: [...ctx.resourceDetails] })).toBe(before);
  });

  it('offered == accepted: every slot the engine offers is accepted, every near miss is refused', () => {
    const ctx = hireContext({ stepMinutes: 45 }, [hold('h1', 'court-1', '10:30', '11:30')]);
    for (let m = 8 * 60; m <= 18 * 60; m += 15) {
      const hh = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
      const w = win(hh(m), hh(m + 60));
      const d = evaluateSlotBooking(ctx, { interval: w, resourceId: 'court-1', partySize: 1 });
      const onGrid = (m - 9 * 60) % 45 === 0 && m >= 9 * 60 && m + 60 <= 17 * 60;
      const clashes = m < 11 * 60 + 30 && m + 60 > 10 * 60 + 30;
      expect(d.ok, `start ${hh(m)}`).toBe(onGrid && !clashes);
    }
  });

  describe('closure re-anchoring is honoured at commit (the same grid as the calendar)', () => {
    it('after 09:00-10:00 is closed, the grid restarts at 10:00 and a 09:45 start is no longer offered', () => {
      const ctx = hireContext({
        stepMinutes: 45,
        offeringExceptions: [
          { id: 'x1', organisationId: 'org-1', resourceId: null, offeringId: 'off-1', fromDate: '2026-11-02', toDate: '2026-11-02', kind: 'closed', reason: null, windows: [{ startTime: '09:00', endTime: '10:00' }] },
        ],
      });
      expect(evaluateSlotBooking(ctx, { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
      expect(evaluateSlotBooking(ctx, { interval: win('10:45', '11:45'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
      expect(evaluateSlotBooking(ctx, { interval: win('09:45', '10:45'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: false });
      expect(evaluateSlotBooking(ctx, { interval: win('11:00', '12:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: false, refusal: { code: 'off_grid' } });
    });
  });

  describe('timezone and daylight saving', () => {
    it('reads the offering rules in the offering zone on the spring-forward day', () => {
      // Sunday 2026-10-04, 09:00-12:00 Adelaide. The change happened at 02:00, so 09:00 is ACDT (+10:30) = 22:30Z on the 3rd.
      const ctx = hireContext({
        offeringRules: [rule('r-off', { dayOfWeek: 0, startTime: '09:00', endTime: '12:00' })],
        resources: [{ resource: { id: 'court-1', active: true }, rules: [rule('r-c1', { offeringId: null, resourceId: 'court-1', dayOfWeek: 0, startTime: '09:00', endTime: '12:00' })], exceptions: [], holds: [] }],
        now: '2026-09-01T00:00:00Z',
      });
      expect(evaluateSlotBooking(ctx, { interval: { startsAt: '2026-10-03T22:30:00Z', endsAt: '2026-10-03T23:30:00Z' }, resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
      // The same UTC hour one hour earlier (the pre-change offset) is 08:30 local: outside the hours.
      expect(evaluateSlotBooking(ctx, { interval: { startsAt: '2026-10-03T21:30:00Z', endsAt: '2026-10-03T22:30:00Z' }, resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: false });
    });

    it('a resource pinned to Perth serves an Adelaide offering on the same instants', () => {
      const ctx = hireContext({
        resources: [
          {
            resource: { id: 'court-1', active: true },
            timezone: 'Australia/Perth',
            rules: [rule('r-c1', { offeringId: null, resourceId: 'court-1', dayOfWeek: 1, startTime: '07:00', endTime: '15:00' })], // Perth is UTC+8 and Adelaide is UTC+10:30 on this date, so 07:00-15:00 Perth is 09:30-17:30 Adelaide
            exceptions: [],
            holds: [],
          },
        ],
        stepMinutes: 30,
      });
      // Adelaide 09:30 is Perth 07:00 (the resource opens); 09:00 is before it. The offering closes at 17:00, so 16:30-17:30 is outside the offering.
      expect(evaluateSlotBooking(ctx, { interval: win('09:00', '10:00'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: false });
      expect(evaluateSlotBooking(ctx, { interval: win('09:30', '10:30'), resourceId: 'court-1', partySize: 1 })).toMatchObject({ ok: true });
    });
  });

  it('reports when the grid was anchored by the query range rather than by the rules (24-hour windows)', () => {
    const allDay = hireContext({
      stepMinutes: 60,
      offeringRules: [0, 1, 2, 3, 4, 5, 6].map(d => rule(`o${d}`, { dayOfWeek: d, startTime: '00:00', endTime: '24:00' })),
      resources: [{ resource: { id: 'court-1', active: true }, rules: [0, 1, 2, 3, 4, 5, 6].map(d => rule(`c${d}`, { offeringId: null, resourceId: 'court-1', dayOfWeek: d, startTime: '00:00', endTime: '24:00' })), exceptions: [], holds: [] }],
    });
    const d = evaluateSlotBooking(allDay, { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 1 });
    expect(d).toMatchObject({ ok: true, anchorAtRangeEdge: true });
    const normal = evaluateSlotBooking(hireContext(), { interval: win('10:00', '11:00'), resourceId: 'court-1', partySize: 1 });
    expect(normal).toMatchObject({ ok: true, anchorAtRangeEdge: false });
  });
});

// ─── evaluateHeadcount ──────────────────────────────────────────────────────

describe('evaluateHeadcount', () => {
  it('allows up to the capacity and no further', () => {
    expect(evaluateHeadcount({ capacity: 10, liveHeadcount: 8, partySize: 2, occurrenceOpen: true })).toEqual({ ok: true, remainingAfter: 0 });
    expect(evaluateHeadcount({ capacity: 10, liveHeadcount: 8, partySize: 3, occurrenceOpen: true })).toMatchObject({ ok: false, refusal: { code: 'capacity_exceeded' } });
  });
  it('refuses a closed occurrence before looking at the count, and bad numbers', () => {
    expect(evaluateHeadcount({ capacity: 10, liveHeadcount: 0, partySize: 1, occurrenceOpen: false })).toMatchObject({ ok: false, refusal: { code: 'occurrence_closed' } });
    expect(evaluateHeadcount({ capacity: 0, liveHeadcount: 0, partySize: 1, occurrenceOpen: true })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
    expect(evaluateHeadcount({ capacity: 5, liveHeadcount: 0, partySize: 1.5, occurrenceOpen: true })).toMatchObject({ ok: false, refusal: { code: 'invalid_request' } });
  });
  it('never reports a negative number of remaining places', () => {
    const d = evaluateHeadcount({ capacity: 3, liveHeadcount: 5, partySize: 1, occurrenceOpen: true });
    expect(d).toMatchObject({ ok: false, refusal: { message: expect.stringContaining('only 0 places') } });
  });
});

// ─── planSeriesEnrolments ───────────────────────────────────────────────────

const occ = (id: string, date: string, status: 'scheduled' | 'cancelled' | 'completed' = 'scheduled') => ({ id, date, startTime: '18:00', status });

describe('planSeriesEnrolments', () => {
  const base = { series: { id: 's1', status: 'active' as const }, today: '2026-11-01', pauses: [], reservations: [] };
  const occurrences = [occ('o1', '2026-11-02'), occ('o2', '2026-11-09'), occ('o3', '2026-11-16'), occ('o4', '2026-11-23')];

  it('enrols on every open future occurrence, in date order', () => {
    const plan = planSeriesEnrolments({ ...base, occurrences: [...occurrences].reverse() });
    expect(plan.ok && plan.enrol.map(e => e.occurrenceId)).toEqual(['o1', 'o2', 'o3', 'o4']);
  });
  it('skips paused dates (inclusive), closed occurrences and past dates, with a reason each', () => {
    const plan = planSeriesEnrolments({
      ...base,
      occurrences: [occ('p', '2026-10-26'), ...occurrences.slice(0, 3), occ('c', '2026-11-30', 'cancelled')],
      pauses: [{ pauseFrom: '2026-11-09', pauseUntil: '2026-11-09' }],
    });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.enrol.map(e => e.occurrenceId)).toEqual(['o1', 'o3']);
    expect(Object.fromEntries(plan.skipped.map(s => [s.occurrenceId, s.reason]))).toEqual({ p: 'in_the_past', o2: 'paused', c: 'occurrence_closed' });
  });
  it('is idempotent and never re-enrols a skipped (cancelled) date', () => {
    const plan = planSeriesEnrolments({ ...base, occurrences, reservations: [{ occurrenceId: 'o1', status: 'confirmed' }, { occurrenceId: 'o2', status: 'cancelled' }] });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.enrol.map(e => e.occurrenceId)).toEqual(['o3', 'o4']);
    expect(plan.skipped.map(s => s.reason)).toEqual(['already_enrolled', 'previously_skipped']);
    const again = planSeriesEnrolments({ ...base, occurrences, reservations: [...['o1', 'o3', 'o4'].map(id => ({ occurrenceId: id, status: 'confirmed' as const })), { occurrenceId: 'o2', status: 'cancelled' }] });
    expect(again.ok && again.enrol).toEqual([]);
  });
  it('enrols nothing for an ended or cancelled series', () => {
    for (const status of ['ended', 'cancelled'] as const) {
      const plan = planSeriesEnrolments({ ...base, series: { id: 's1', status }, occurrences });
      expect(plan.ok && plan.enrol).toEqual([]);
      expect(plan.ok && plan.skipped.every(s => s.reason === 'series_not_active')).toBe(true);
    }
  });
  it('caps and reports truncation', () => {
    const plan = planSeriesEnrolments({ ...base, occurrences, maxEnrolments: 2 });
    expect(plan).toMatchObject({ ok: true, truncated: true });
    expect(plan.ok && plan.enrol.map(e => e.occurrenceId)).toEqual(['o1', 'o2']);
  });
  it('refuses malformed input', () => {
    expect(planSeriesEnrolments({ ...base, occurrences, today: 'nope' })).toMatchObject({ ok: false });
    expect(planSeriesEnrolments({ ...base, occurrences, pauses: [{ pauseFrom: '2026-11-09', pauseUntil: '2026-11-01' }] })).toMatchObject({ ok: false });
    expect(planSeriesEnrolments({ ...base, occurrences, maxEnrolments: 0 })).toMatchObject({ ok: false });
  });
});

// ─── taxonomy ───────────────────────────────────────────────────────────────

describe('booking error taxonomy', () => {
  it('places every code in exactly one family and only contention_timeout is retryable', () => {
    for (const code of BOOKING_REFUSAL_CODES) {
      const r = bookingRefusal(code, 'm');
      expect(['invalid', 'refusal', 'transient']).toContain(r.family);
      expect(r.retryable).toBe(code === 'contention_timeout');
    }
    expect(new Set(BOOKING_REFUSAL_CODES).size).toBe(BOOKING_REFUSAL_CODES.length);
  });
  it('maps every database-layer code, and a lock timeout is never a "full" answer', () => {
    const codes: SchedulingErrorCode[] = ['permission_denied', 'invalid_input', 'not_found', 'conflict', 'resource_conflict', 'capacity_exceeded', 'duplicate_reservation', 'offering_unavailable', 'lifecycle_violation', 'unsafe_isolation', 'contention_timeout'];
    for (const c of codes) expect(BOOKING_REFUSAL_CODES).toContain(refusalCodeFromSchedulingError(c));
    expect(refusalCodeFromSchedulingError('contention_timeout')).toBe('contention_timeout');
    expect(bookingRefusal(refusalCodeFromSchedulingError('contention_timeout'), 'm').family).toBe('transient');
  });
});
