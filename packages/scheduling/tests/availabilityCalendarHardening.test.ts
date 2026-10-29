import { describe, expect, it } from 'vitest';
import {
  buildOfferingCalendar,
  calendarRules,
  type AvailabilityExceptionInput,
  type CalendarResourceInput,
  type CalendarView,
  type InstantWindow,
  type OfferingCalendarInput,
  type ResourceHold,
} from '../src';
import { rule } from './support/availabilityFixtures';

// Phase 2B.3e: hardening of the read-only calendar view model. Edge cases the 2B.3d suite does not pin (half-open boundaries on holds and closures,
// window anchoring under removals, the meaning of `service_period`, an overnight window across the repeated hour) and a seeded property check of the
// invariants every calendar must satisfy, over ranges that include both Adelaide daylight-saving changes.
//   Australia/Adelaide +09:30 winter / +10:30 summer. Clocks FORWARD Sun 2026-10-04 (23-hour day), BACK Sun 2027-04-04 (25-hour day; 02:00-03:00 twice).

const ADL = 'Australia/Adelaide';
const PER = 'Australia/Perth';
const win = (startsAt: string, endsAt: string): InstantWindow => ({ startsAt, endsAt });
const hold = (id: string, resourceId: string, startsAt: string, endsAt: string): ResourceHold => ({
  id, resourceId, startsAt, endsAt, reservationId: 'resv', occurrenceId: null, releasedAt: null,
});
const closure = (id: string, owner: { resourceId?: string | null; offeringId?: string | null }, fromDate: string, toDate: string, windows?: AvailabilityExceptionInput['windows']): AvailabilityExceptionInput => ({
  id, organisationId: 'org-1', resourceId: owner.resourceId ?? null, offeringId: owner.offeringId ?? null, fromDate, toDate, kind: 'closed', reason: null, ...(windows ? { windows } : {}),
});
const court = (id: string, over: Partial<CalendarResourceInput> = {}): CalendarResourceInput => ({
  resource: { id, active: true }, name: `Court ${id}`, rules: [], exceptions: [], holds: [], timezone: ADL, pinned: true, ...over,
});
const courtRule = (id: string, resourceId: string, dow: number, startTime: string, endTime: string) => rule(id, { resourceId, offeringId: null, dayOfWeek: dow, startTime, endTime });
const input = (over: Partial<OfferingCalendarInput> = {}): OfferingCalendarInput => ({
  timezone: ADL, pinned: true, fromDate: '2027-01-11', toDate: '2027-01-11',
  offering: { id: 'off-1', name: 'Junior Squad', archivedAt: null, durationMinutes: 60 }, offeringRules: [], offeringExceptions: [], resources: [], ...over,
});
function build(over: Partial<OfferingCalendarInput> = {}): CalendarView {
  const r = buildOfferingCalendar(input(over));
  if (!r.ok) throw new Error(`${r.reason}: ${r.problems.join('; ')}`);
  return r;
}
const lane = (v: CalendarView, id: string) => v.lanes.find(l => l.id === id)!;
const starts = (v: CalendarView) => v.slots.map(s => s.startsAt);

// 2027-01-11 is a Monday; Adelaide is +10:30, so 09:00 local = 2027-01-10T22:30Z.
const MON = [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' })];
const T = (hhmm: string) => `2027-01-10T${hhmm}:00Z`; // helper for the Monday morning: 22:30Z = 09:00

describe('half-open boundaries: a window [start, end) never touches the instant it ends on', () => {
  const base = { offeringRules: MON, resources: [court('c', { rules: [courtRule('r', 'c', 1, '09:00', '13:00')] })] };

  it('a hold that ENDS at a slot start does not remove that slot, and one that STARTS at a slot end does not either', () => {
    const none = build(base);
    expect(starts(none)).toEqual([T('22:30'), T('23:30'), '2027-01-11T00:30:00Z', '2027-01-11T01:30:00Z']);
    // 10:00-11:00 local = 23:30Z-00:30Z: only the 10:00 slot is taken; 09:00 (ends 10:00) and 11:00 (starts 11:00) are untouched
    const held = build({ ...base, resources: [court('c', { rules: base.resources[0].rules, holds: [hold('h', 'c', T('23:30'), '2027-01-11T00:30:00Z')] })] });
    expect(starts(held)).toEqual([T('22:30'), '2027-01-11T00:30:00Z', '2027-01-11T01:30:00Z']);
    // one minute of overlap at either end DOES remove the neighbour: 23:29-00:31 clips the 09:00, 10:00 and 11:00 slots
    const overlap = build({ ...base, resources: [court('c', { rules: base.resources[0].rules, holds: [hold('h', 'c', '2027-01-10T23:29:00Z', '2027-01-11T00:31:00Z')] })] });
    expect(starts(overlap)).toEqual(['2027-01-11T01:30:00Z']);
  });

  it('a closure that ends at 11:00 leaves the 11:00 slot; one that starts at 11:00 leaves the 10:00 slot', () => {
    const early = build({ ...base, offeringExceptions: [closure('x', { offeringId: 'off-1' }, '2027-01-11', '2027-01-11', [{ startTime: '09:00', endTime: '11:00' }])] });
    expect(starts(early)).toEqual(['2027-01-11T00:30:00Z', '2027-01-11T01:30:00Z']);
    const late = build({ ...base, offeringExceptions: [closure('x', { offeringId: 'off-1' }, '2027-01-11', '2027-01-11', [{ startTime: '11:00', endTime: '13:00' }])] });
    expect(starts(late)).toEqual([T('22:30'), T('23:30')]);
  });

  it('hours that end exactly on a day boundary do not leak into the next day', () => {
    const v = build({ offeringRules: [rule('o', { dayOfWeek: 1, startTime: '22:00', endTime: '24:00' })], fromDate: '2027-01-11', toDate: '2027-01-12' });
    const off = lane(v, 'off-1');
    expect(off.hours).toEqual([win('2027-01-11T11:30:00Z', '2027-01-11T13:30:00Z')]);
    expect(v.slots.every(s => s.endsAt <= '2027-01-11T13:30:00Z')).toBe(true);
  });
});

describe('window anchoring: removing time removes slots, it never moves the others', () => {
  it('a hold in the middle of the window leaves every other slot exactly where the unheld grid had it, at a 45-minute step', () => {
    const rules = [courtRule('r', 'c', 1, '09:00', '17:00')];
    const grid = (holds: ResourceHold[]) => starts(build({ offeringRules: [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })], resources: [court('c', { rules, holds })], stepMinutes: 45 }));
    const all = grid([]);
    expect(all.length).toBeGreaterThan(8);
    const without = grid([hold('h', 'c', '2027-01-11T00:00:00Z', '2027-01-11T01:00:00Z')]);
    expect(without.length).toBeLessThan(all.length);
    expect(without.every(s => all.includes(s))).toBe(true);
  });

  it('two separate offering windows on one day are each anchored at their own start', () => {
    const v = build({
      offeringRules: [rule('a', { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }), rule('b', { dayOfWeek: 1, startTime: '13:30', endTime: '15:30' })],
      resources: [court('c', { rules: [courtRule('r', 'c', 1, '08:00', '18:00')] })],
    });
    expect(starts(v)).toEqual([T('22:30'), T('23:30'), '2027-01-11T03:00:00Z', '2027-01-11T04:00:00Z']); // 09:00, 10:00, 13:30, 14:30 local
  });
});

describe('closures and the slot grid', () => {
  // PINS CURRENT (documented) BEHAVIOUR: the grid is anchored at the start of each continuous EFFECTIVE window, so a closure that removes the start of a
  // window moves the later start times. A 45-minute grid from 09:00 (09:00, 09:45, ...) becomes 10:00, 10:45 once 09:00-10:00 is closed.
  it('a closure that removes the start of a window re-anchors the grid at the new start', () => {
    const rules = [rule('o', { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })];
    const open = build({ offeringRules: rules, stepMinutes: 45 });
    const closed = build({ offeringRules: rules, stepMinutes: 45, offeringExceptions: [closure('x', { offeringId: 'off-1' }, '2027-01-11', '2027-01-11', [{ startTime: '09:00', endTime: '10:00' }])] });
    expect(starts(open)).toEqual(['2027-01-10T22:30:00Z', '2027-01-10T23:15:00Z', '2027-01-11T00:00:00Z']); // 60-minute sessions every 45 minutes: 09:00, 09:45, 10:30
    expect(starts(closed)).toEqual(['2027-01-10T23:30:00Z', '2027-01-11T00:15:00Z']);
  });
});

describe('service_period: the calendar does not read the rule kind', () => {
  // PINS CURRENT BEHAVIOUR so a future change is deliberate (what service_period MEANS is a separate product decision). The engine's rule type has no
  // `kind` at all: the conversion from a stored rule drops it, so a service_period window is drawn and bookable exactly like an hours window.
  const stored = (kind: 'hours' | 'service_period') => ({
    id: 'o', resourceId: null, offeringId: 'off-1', kind, label: kind === 'service_period' ? 'Dinner' : null, dayOfWeek: 1, startTime: '09:00', endTime: '13:00', validFrom: null, validTo: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  });
  const tenant = { organisationId: 'org-1' } as never;

  it('a stored service_period rule converts to the same engine rule as an hours rule, and the calendar built from it is identical', () => {
    expect(calendarRules(tenant, [stored('service_period')])).toEqual(calendarRules(tenant, [stored('hours')]));
    const asHours = build({ offeringRules: calendarRules(tenant, [stored('hours')]) });
    const asService = build({ offeringRules: calendarRules(tenant, [stored('service_period')]) });
    expect(asService.lanes).toEqual(asHours.lanes);
    expect(asService.slots).toEqual(asHours.slots);
    expect(asService.slots.length).toBeGreaterThan(0); // i.e. a service_period window currently makes start times bookable
  });
});

describe('overnight hours across the repeated hour', () => {
  it('Saturday 22:00 to Sunday 06:00 on the fall-back weekend lasts 9 hours: the repeated 02:00-03:00 counts twice', () => {
    // 2027-04-03 is a Saturday; clocks go back early on Sunday 2027-04-04. Stored as two halves (Sat 22:00-24:00, Sun 00:00-06:00).
    const v = build({
      offeringRules: [rule('a', { dayOfWeek: 6, startTime: '22:00', endTime: '24:00' }), rule('b', { dayOfWeek: 0, startTime: '00:00', endTime: '06:00' })],
      fromDate: '2027-04-03', toDate: '2027-04-04',
    });
    const hours = lane(v, 'off-1').hours;
    // 22:00 at +10:30 is 11:30Z; 06:00 at +09:30 is 20:30Z of the same UTC day: nine hours of elapsed time for eight on the wall clock
    expect(hours).toEqual([win('2027-04-03T11:30:00Z', '2027-04-03T20:30:00Z')]);
  });
});

// ── seeded property check ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A small deterministic generator (mulberry32): the same seed always draws the same calendars. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const inside = (list: InstantWindow[], w: InstantWindow) => list.some(x => x.startsAt <= w.startsAt && w.endsAt <= x.endsAt);
const sortedDisjoint = (list: InstantWindow[]) => list.every((w, i) => w.startsAt < w.endsAt && (i === 0 || list[i - 1].endsAt <= w.startsAt));
const overlaps = (a: InstantWindow, b: InstantWindow) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

function drawCalendar(seed: number): { make: (extra?: { hold?: ResourceHold; closure?: AvailabilityExceptionInput }) => CalendarView; range: [string, string] } {
  const r = rng(seed);
  const from = pick(r, ['2026-10-01', '2026-10-03', '2026-10-04', '2027-04-01', '2027-04-03', '2027-04-04', '2027-01-09']);
  const to = addDays(from, Math.floor(r() * 7));
  const window = (): [string, string] => {
    const s = 30 * Math.floor(r() * 44); // 00:00 .. 21:30
    return [hhmm(s), hhmm(Math.min(1440, s + 30 * (1 + Math.floor(r() * 12))))];
  };
  const ownerRules = (owner: 'off-1' | string) => {
    const out: ReturnType<typeof rule>[] = [];
    for (let dow = 0; dow < 7; dow++) {
      if (r() < 0.55) continue;
      const [s, e] = window();
      out.push(owner === 'off-1' ? rule(`o${dow}`, { dayOfWeek: dow, startTime: s, endTime: e }) : courtRule(`${owner}${dow}`, owner, dow, s, e));
    }
    return out;
  };
  const resources = ['c1', 'c2', 'c3'].slice(0, 1 + Math.floor(r() * 3)).map(id => {
    const holds: ResourceHold[] = [];
    for (let i = 0; i < Math.floor(r() * 4); i++) {
      const start = Date.parse(`${addDays(from, i * 2 - 1)}T00:00:00Z`) + Math.floor(r() * 80) * 15 * 60_000; // one hold per two days: live holds on a resource never overlap (exclusion constraint)
      holds.push(hold(`${id}h${i}`, id, new Date(start).toISOString().replace('.000Z', 'Z'), new Date(start + (1 + Math.floor(r() * 8)) * 30 * 60_000).toISOString().replace('.000Z', 'Z')));
    }
    return court(id, { rules: ownerRules(id), holds, timezone: pick(r, [ADL, PER]) });
  });
  const duration = pick(r, [30, 45, 60, 90]);
  const offeringRules = ownerRules('off-1');
  const base = (extra?: { hold?: ResourceHold; closure?: AvailabilityExceptionInput }): OfferingCalendarInput => ({
    timezone: ADL, pinned: true, fromDate: from, toDate: to,
    offering: { id: 'off-1', name: 'O', archivedAt: null, durationMinutes: duration },
    offeringRules,
    offeringExceptions: extra?.closure ? [extra.closure] : [],
    resources: extra?.hold ? resources.map(c => (c.resource.id === extra.hold!.resourceId ? { ...c, holds: [...c.holds, extra.hold!] } : c)) : resources,
  });
  return {
    range: [from, to],
    make: extra => {
      const v = buildOfferingCalendar(base(extra));
      if (!v.ok) throw new Error(`seed ${seed}: ${v.reason}: ${v.problems.join('; ')}`);
      return v;
    },
  };
}

describe('property check over seeded calendars (400 + 150; both Adelaide daylight-saving changes, Adelaide and Perth resources)', () => {
  it('every lane is well formed, free time sits inside hours and outside holds, and every slot is inside both the offering and its resource', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const { make } = drawCalendar(seed);
      const v = make();
      const off = lane(v, 'off-1');
      for (const l of v.lanes) {
        for (const list of [l.hours, l.free, l.occupied, l.closed]) expect(sortedDisjoint(list), `seed ${seed} lane ${l.id}`).toBe(true);
        for (const f of l.free) expect(inside(l.hours, f), `seed ${seed} free ⊆ hours (${l.id})`).toBe(true);
        for (const f of l.free) for (const o of l.occupied) expect(overlaps(f, o), `seed ${seed} free ∩ occupied (${l.id})`).toBe(false);
      }
      for (const s of v.slots) {
        const w = win(s.startsAt, s.endsAt);
        expect(inside(off.hours, w), `seed ${seed} slot ⊆ offering hours`).toBe(true);
        expect(inside(lane(v, s.resourceId!).free, w), `seed ${seed} slot ⊆ resource free`).toBe(true);
      }
      expect(new Set(v.slots.map(s => `${s.resourceId}|${s.startsAt}`)).size, `seed ${seed} no duplicate slot`).toBe(v.slots.length);
    }
  });

  it('adding a hold never creates a slot, adding a closure never creates time, and the calendar is deterministic', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { make, range } = drawCalendar(seed);
      const before = make();
      expect(JSON.stringify(make())).toBe(JSON.stringify(before));
      const day = addDays(range[0], 0);
      const extraHold = hold('extra', 'c1', `${day}T00:00:00Z`, `${addDays(day, 2)}T00:00:00Z`);
      const held = make({ hold: extraHold });
      const closed = make({ closure: closure('x', { offeringId: 'off-1' }, day, addDays(day, 1), [{ startTime: '08:00', endTime: '20:00' }]) });
      const key = (s: (typeof before.slots)[number]) => `${s.resourceId}|${s.startsAt}`;
      const was = new Set(before.slots.map(key));
      expect(held.slots.every(s => was.has(key(s))), `seed ${seed} hold`).toBe(true);
      // a closure may MOVE later slots (the grid is anchored at the start of each remaining window, see below) but never adds open time
      const openBefore = lane(before, 'off-1').hours.reduce((n, w) => n + Date.parse(w.endsAt) - Date.parse(w.startsAt), 0);
      const openAfter = lane(closed, 'off-1').hours.reduce((n, w) => n + Date.parse(w.endsAt) - Date.parse(w.startsAt), 0);
      expect(openAfter, `seed ${seed} closure`).toBeLessThanOrEqual(openBefore);
      expect(held.slots.length).toBeLessThanOrEqual(before.slots.length);
    }
  }, 60_000);
});
