import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  computeAvailability,
  expandOwnerAvailability,
  intersectIntervals,
  labelLocalInstant,
  normaliseIntervals,
  type AvailabilityExceptionInput,
  type AvailabilityInput,
  type AvailabilityRule,
  type InstantWindow,
  type ResourceAvailabilityInput,
} from '../src';
import { rule } from './support/availabilityFixtures';

// Owner-pinned zones in the shared availability computation. The OFFERING's rules and exceptions are read in `timezone`; each RESOURCE's in its
// own `timezone` (its pinned zone; absent = the offering's, which is the behaviour before this change). Each owner's windows become instants in
// ITS zone and the instants are intersected. Reference calendar (checked against the zone database, 2027):
//   Australia/Adelaide  +10:30 summer / +09:30 winter; DST ends Sun 2027-04-04 03:00 (02:00-03:00 repeats), starts Sun 2027-10-03 02:00 (02:00-03:00 absent)
//   Australia/Perth     +08:00 all year
//   Australia/Sydney    +11:00 summer / +10:00 winter; same Sundays as Adelaide
//   Europe/London       +00:00 winter / +01:00 summer; DST ends Sun 2027-10-31 02:00

const ADL = 'Australia/Adelaide';
const PER = 'Australia/Perth';
const SYD = 'Australia/Sydney';
const LON = 'Europe/London';

const offRule = (id: string, dow: number, startTime: string, endTime: string, extra: Partial<AvailabilityRule> = {}) => rule(id, { dayOfWeek: dow, startTime, endTime, ...extra });
const resRule = (id: string, resourceId: string, dow: number, startTime: string, endTime: string, extra: Partial<AvailabilityRule> = {}) =>
  rule(id, { resourceId, offeringId: null, dayOfWeek: dow, startTime, endTime, ...extra });
const closure = (id: string, owner: { resourceId?: string | null; offeringId?: string | null }, fromDate: string, toDate: string, windows?: AvailabilityExceptionInput['windows']): AvailabilityExceptionInput => ({
  id, organisationId: 'org-1', resourceId: owner.resourceId ?? null, offeringId: owner.offeringId ?? null, fromDate, toDate, kind: 'closed', reason: null, ...(windows ? { windows } : {}),
});
const resource = (id: string, over: Partial<ResourceAvailabilityInput> = {}): ResourceAvailabilityInput => ({
  resource: { id, active: true }, rules: [], exceptions: [], holds: [], ...over,
});

function input(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    timezone: ADL, fromDate: '2027-01-11', toDate: '2027-01-11', offering: { id: 'off-1', archivedAt: null },
    offeringRules: [], offeringExceptions: [], resources: [], slot: { durationMinutes: 60, stepMinutes: 60 }, ...over,
  };
}
function ok(over: Partial<AvailabilityInput> = {}) {
  const r = computeAvailability(input(over));
  if (!r.ok) throw new Error(`${r.reason}: ${r.problems.join('; ')}`);
  return r;
}
const win = (startsAt: string, endsAt: string): InstantWindow => ({ startsAt, endsAt });

describe('offering and resource are each read in their own zone (Monday 2027-01-11, summer)', () => {
  // Adelaide summer +10:30: Mon 09:00-17:00 = Sun 22:30Z - Mon 06:30Z. Perth +08:00: Mon 09:00-17:00 = Mon 01:00Z - 09:00Z.
  it('offering 09:00-17:00 Adelaide and resource 09:00-17:00 Perth intersect where both are open: 01:00Z to 06:30Z', () => {
    const r = ok({ offeringRules: [offRule('o', 1, '09:00', '17:00')], resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    expect(r.free).toEqual([{ resourceId: 'court', timezone: PER, intervals: [win('2027-01-11T01:00:00Z', '2027-01-11T06:30:00Z')] }]);
    expect(r.timezone).toBe(ADL);
    // slots follow the window-anchored grid of the OFFERING (anchored at its 22:30Z start), kept only where the whole slot fits the shared time
    expect(r.slots.map(s => s.startsAt)).toEqual(['2027-01-11T01:30:00Z', '2027-01-11T02:30:00Z', '2027-01-11T03:30:00Z', '2027-01-11T04:30:00Z', '2027-01-11T05:30:00Z']);
  });

  it('read in the SAME zone the two would give a different answer: the zones are what separates them', () => {
    const rules = { offeringRules: [offRule('o', 1, '09:00', '17:00')] };
    const both = ok({ ...rules, resources: [resource('court', { rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] }); // no resource zone: Adelaide
    expect(both.free[0].intervals).toEqual([win('2027-01-10T22:30:00Z', '2027-01-11T06:30:00Z')]);
    const pinned = ok({ ...rules, resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    expect(pinned.free[0].intervals).not.toEqual(both.free[0].intervals);
  });

  it('a resource without its own zone is read in the offering zone, exactly as before (backward compatible)', () => {
    const base = input({ offeringRules: [offRule('o', 1, '09:00', '17:00')], resources: [resource('court', { rules: [resRule('r', 'court', 1, '10:00', '15:00')] })] });
    const explicit = input({ ...base, resources: [resource('court', { timezone: ADL, rules: [resRule('r', 'court', 1, '10:00', '15:00')] })] });
    const a = computeAvailability(base);
    const b = computeAvailability(explicit);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.slots).toEqual(a.slots);
      expect(b.free).toEqual(a.free);
      expect(b.adjustments).toEqual(a.adjustments);
    }
  });

  it('a window just inside the range edge of ANOTHER zone is not lost: Sunday 23:00-24:00 Perth is Monday 01:30-02:30 Adelaide', () => {
    // Resource windows are read two days wider for another zone: a request for Monday alone still sees Perth's Sunday evening.
    const r = ok({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 0, '23:00', '24:00')] })], slot: { durationMinutes: 30, stepMinutes: 30 } });
    expect(r.free[0].intervals).toEqual([win('2027-01-10T15:00:00Z', '2027-01-10T16:00:00Z')]);
    // the offering's Monday starts at 13:30Z, so its half-hour grid has 15:00Z and 15:30Z
    expect(r.slots.map(s => s.startsAt)).toEqual(['2027-01-10T15:00:00Z', '2027-01-10T15:30:00Z']);
  });

  it('availability outside the requested offering dates never leaks in: the intersection clips the wider read', () => {
    const r = ok({
      offeringRules: [offRule('o', 1, '00:00', '24:00'), offRule('o2', 2, '00:00', '24:00')],
      resources: [resource('court', { timezone: PER, rules: [resRule('r1', 'court', 1, '00:00', '24:00'), resRule('r2', 'court', 2, '00:00', '24:00')] })],
    });
    // Monday 2027-01-11 only is requested. The offering's Monday is Jan 10 13:30Z to Jan 11 13:30Z. Perth's Monday is Jan 10 16:00Z to Jan 11 16:00Z
    // and its Tuesday follows it; neither the Tuesday nor Perth's Monday beyond 13:30Z may appear.
    expect(r.free[0].intervals).toEqual([win('2027-01-10T16:00:00Z', '2027-01-11T13:30:00Z')]);
  });
});

describe('exceptions use their OWNER\'s pinned zone', () => {
  it('a resource closure on 2027-01-11 closes PERTH\'s Monday (Jan 10 16:00Z to Jan 11 16:00Z), not Adelaide\'s Monday', () => {
    // The Perth court opens Sunday and Monday all day. The closure is for the date 2027-01-11 and is the court's, so it is read in Perth.
    const court = resource('court', {
      timezone: PER,
      rules: [resRule('r0', 'court', 0, '00:00', '24:00'), resRule('r1', 'court', 1, '00:00', '24:00')],
      exceptions: [closure('x', { resourceId: 'court' }, '2027-01-11', '2027-01-11')],
    });
    const r = ok({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [court] }); // the offering's Monday: Jan 10 13:30Z to Jan 11 13:30Z
    // Only Perth's Sunday evening (Jan 10 13:30Z to 16:00Z) survives. Read in Adelaide the same closure would have closed the whole offering Monday.
    expect(r.free[0].intervals).toEqual([win('2027-01-10T13:30:00Z', '2027-01-10T16:00:00Z')]);
  });

  it('a resource closed by an exception on every open day reports no availability for it, like a resource with no rules', () => {
    const court = resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '00:00', '24:00')], exceptions: [closure('x', { resourceId: 'court' }, '2027-01-11', '2027-01-11')] });
    const r = ok({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [court] });
    expect(r.free[0].intervals).toEqual([]);
    expect(r.reasons).toEqual(['resource_no_availability:court']);
  });

  it('a partial-day closure on the resource removes its wall-clock hour in ITS zone', () => {
    const court = resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')], exceptions: [closure('x', { resourceId: 'court' }, '2027-01-11', '2027-01-11', [{ startTime: '12:00', endTime: '13:00' }])] });
    const r = ok({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [court] });
    // Perth 09:00-12:00 = 01:00Z-04:00Z and 13:00-17:00 = 05:00Z-09:00Z; the offering is open all of Adelaide's Monday (until 13:30Z), so both survive.
    expect(r.free[0].intervals).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T04:00:00Z'), win('2027-01-11T05:00:00Z', '2027-01-11T09:00:00Z')]);
  });

  it('an offering closure is read in the offering zone while the resource stays open in its own', () => {
    const r = ok({
      offeringRules: [offRule('o', 1, '00:00', '24:00')],
      offeringExceptions: [closure('c', { offeringId: 'off-1' }, '2027-01-11', '2027-01-11', [{ startTime: '09:00', endTime: '12:00' }])],
      resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '00:00', '24:00')] })],
    });
    // Offering closed 09:00-12:00 Adelaide = Jan 10 22:30Z to Jan 11 01:30Z. Perth's Monday = Jan 10 16:00Z to Jan 11 16:00Z, within the offering's
    // Monday (to 13:30Z). Free = that minus the closure: two pieces, 16:00Z-22:30Z and 01:30Z-13:30Z.
    expect(r.free[0].intervals).toEqual([win('2027-01-10T16:00:00Z', '2027-01-10T22:30:00Z'), win('2027-01-11T01:30:00Z', '2027-01-11T13:30:00Z')]);
  });
});

describe('a shared resource keeps its hours in one zone whichever schedule asks', () => {
  const court = () => resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] });
  const shared = (zone: string, rules: AvailabilityRule[]) => ok({ timezone: zone, offeringRules: rules, resources: [court()] });

  it('an Adelaide offering and a Sydney offering open all day see the SAME instants of the Perth court (01:00Z-09:00Z)', () => {
    const adl = shared(ADL, [offRule('o', 1, '00:00', '24:00')]);
    const syd = shared(SYD, [offRule('o', 1, '00:00', '24:00')]);
    expect(adl.free[0].intervals).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T09:00:00Z')]);
    expect(syd.free[0].intervals).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T09:00:00Z')]);
    expect(adl.free[0].timezone).toBe(PER);
    expect(syd.free[0].timezone).toBe(PER);
  });

  it('moving the OFFERING\'s zone never moves the resource\'s own hours', () => {
    const own = (zone: string) => expandOwnerAvailability({ rules: [resRule('r', 'court', 1, '09:00', '17:00')], exceptions: [] }, '2027-01-11', '2027-01-11', zone === 'resource' ? PER : zone).intervals;
    expect(own('resource')).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T09:00:00Z')]);
    for (const zone of [ADL, SYD, LON]) {
      const r = shared(zone, [offRule('o', 1, '00:00', '24:00'), offRule('o0', 0, '00:00', '24:00'), offRule('o2', 2, '00:00', '24:00')]);
      // whatever the offering zone, the resource's UTC hours inside the offering's date are a subset of the same Perth interval
      for (const i of r.free[0].intervals) expect(Date.parse(i.startsAt) >= Date.parse('2027-01-11T01:00:00Z') && Date.parse(i.endsAt) <= Date.parse('2027-01-11T09:00:00Z')).toBe(true);
    }
  });

  it('the offering\'s own hours differ by zone (that is the point of the offering zone), the resource\'s do not', () => {
    const adl = shared(ADL, [offRule('o', 1, '09:00', '12:00')]);
    const syd = shared(SYD, [offRule('o', 1, '09:00', '12:00')]);
    expect(adl.free[0].intervals).toEqual([win('2027-01-11T01:00:00Z', '2027-01-11T01:30:00Z')]); // Adelaide 09:00-12:00 = 22:30Z-01:30Z, Perth open from 01:00Z
    expect(syd.free[0].intervals).toEqual([]); // Sydney 09:00-12:00 = 22:00Z-01:00Z: ends exactly when Perth opens
  });
});

describe('daylight saving stays deterministic per owner zone (fall-back Sunday 2027-04-04 Adelaide)', () => {
  const sundayInput = (resourceZone: string | undefined, rules: AvailabilityRule[]) =>
    input({ fromDate: '2027-04-04', toDate: '2027-04-04', offeringRules: [offRule('o', 0, '00:00', '06:00')], resources: [resource('court', { timezone: resourceZone, rules })] });

  it('the offering repeats its 02:00 hour; the Perth resource has no repeat; the shared instants are exact', () => {
    // Adelaide Sunday 00:00-06:00 = 2027-04-03T13:30Z - 20:30Z (7 real hours). Perth Sunday 00:00-24:00 = 04-03T16:00Z - 04-04T16:00Z.
    const r = computeAvailability(sundayInput(PER, [resRule('r', 'court', 0, '00:00', '24:00')]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.free[0].intervals).toEqual([win('2027-04-03T16:00:00Z', '2027-04-03T20:30:00Z')]);
    expect(r.adjustments).toEqual([]);
  });

  it('a resource window starting in the REPEATED hour of its own zone takes the first pass, and the adjustment names the resource', () => {
    // A Sydney-zone resource also repeats 02:00-03:00 on 2027-04-04, at +11:00 then +10:00.
    const r = computeAvailability(sundayInput(SYD, [resRule('r', 'court', 0, '02:30', '04:00')]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adjustments).toEqual([{ date: '2027-04-04', startTime: '02:30', endTime: '04:00', kind: 'start_ambiguous', owner: { kind: 'resource', id: 'court' } }]);
    // Sydney 02:30 first pass (+11:00) = 15:30Z; 04:00 (+10:00) = 18:00Z. The Adelaide offering is open until 20:30Z, so all of it is free.
    expect(r.free[0].intervals).toEqual([win('2027-04-03T15:30:00Z', '2027-04-03T18:00:00Z')]);
  });

  it('a resource window wholly inside a skipped hour of ITS zone is dropped, and says so, while the offering is unaffected', () => {
    // 2027-10-03: Adelaide and Sydney skip 02:00-03:00 (Sydney at 02:00 +10:00 -> 03:00 +11:00).
    const r = computeAvailability(input({ fromDate: '2027-10-03', toDate: '2027-10-03', offeringRules: [offRule('o', 0, '00:00', '24:00')], resources: [resource('court', { timezone: SYD, rules: [resRule('r', 'court', 0, '02:10', '02:50')] })] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.free[0].intervals).toEqual([]);
    expect(r.adjustments.map(a => [a.kind, a.owner.kind])).toContainEqual(['dropped_in_gap', 'resource']);
    expect(r.reasons).toEqual(['resource_no_availability:court']);
  });

  it('repeated local times are told apart by their UTC offset when labelled in the offering zone', () => {
    const r = ok({ fromDate: '2027-04-04', toDate: '2027-04-04', offeringRules: [offRule('o', 0, '00:00', '06:00')], resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 0, '00:00', '24:00')] })], slot: { durationMinutes: 60, stepMinutes: 60 } });
    expect(r.slots.map(s => labelLocalInstant(s.startsAt, ADL).text)).toEqual(['02:00 UTC+09:30', '03:00', '04:00', '05:00']); // the Perth court opens 16:00Z; the grid is anchored at 13:30Z so the first slot is 16:30Z, the SECOND pass of 02:00
  });
});

describe('missing availability fails closed, and nothing is created', () => {
  it('a resource with no rules is not available (and the reason names it)', () => {
    const r = ok({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { timezone: PER })] });
    expect(r.slots).toEqual([]);
    expect(r.reasons).toEqual(['resource_no_availability:court']);
    expect(r.free).toEqual([{ resourceId: 'court', timezone: PER, intervals: [] }]);
  });

  it('an offering with no rules is not available whatever the resource offers', () => {
    const r = ok({ resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '00:00', '24:00')] })] });
    expect(r.slots).toEqual([]);
    expect(r.reasons).toEqual(['no_offering_availability']);
  });

  it('requirePinnedZones refuses a resource that has availability but no pinned zone, and allows one that has none', () => {
    const unpinned = computeAvailability(input({ requirePinnedZones: true, offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] }));
    expect(unpinned.ok).toBe(false);
    if (!unpinned.ok) expect(unpinned.problems).toEqual(['resource court has availability but no pinned timezone']);
    const closedOnly = computeAvailability(input({ requirePinnedZones: true, offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court')] }));
    expect(closedOnly.ok).toBe(true);
    const pinned = computeAvailability(input({ requirePinnedZones: true, offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] }));
    expect(pinned.ok).toBe(true);
  });

  it('an invalid resource zone is invalid_input, never silently replaced', () => {
    const r = computeAvailability(input({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { timezone: 'Not/AZone', rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(' ')).toMatch(/resource court: timezone must be a valid IANA zone/);
  });

  it('a resource authored in one zone but read in another refuses until reinterpretation is confirmed', () => {
    const base = input({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { timezone: SYD, authoredTimezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    const refused = computeAvailability(base);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('timezone_changed');
    expect(computeAvailability({ ...base, allowTimezoneReinterpretation: true }).ok).toBe(true);
  });

  it('the computation neither mutates its input nor produces anything that could be a reservation or a hold', () => {
    const i = input({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    const before = JSON.stringify(i);
    const r = computeAvailability(i);
    expect(JSON.stringify(i)).toBe(before);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r).sort()).toEqual(['adjustments', 'free', 'ok', 'reasons', 'slots', 'timezone']);
  });

  it('an inactive resource has no availability in any zone', () => {
    const r = ok({ offeringRules: [offRule('o', 1, '00:00', '24:00')], resources: [resource('court', { resource: { id: 'court', active: false }, timezone: PER, rules: [resRule('r', 'court', 1, '09:00', '17:00')] })] });
    expect(r.slots).toEqual([]);
    expect(r.reasons).toEqual(['resource_inactive:court']);
    expect(r.free[0].timezone).toBe(PER);
  });
});

// ─── Property tests (fixed seed: every run checks the same cases) ───────────────────────────────────────────

function prng(seed: number) {
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
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ZONES = [ADL, PER, SYD, LON, 'America/New_York', 'Pacific/Auckland', 'Australia/Lord_Howe'] as const;
const DATES = ['2027-01-11', '2027-04-02', '2027-04-04', '2027-10-01', '2027-10-03', '2027-10-30', '2027-03-26', '2027-03-27'] as const;

function randomRules(r: () => number, owner: { offeringId: string | null; resourceId: string | null }, prefix: string): AvailabilityRule[] {
  const out: AvailabilityRule[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (r() < 0.3) continue;
    const cuts = [...new Set([int(r, 0, 23) * 60 + pick(r, [0, 15, 30, 45]), int(r, 0, 23) * 60 + pick(r, [0, 15, 30, 45]), int(r, 0, 23) * 60, int(r, 1, 24) * 60])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      out.push(rule(`${prefix}${dow}-${i}`, { ...owner, dayOfWeek: dow, startTime: hhmm(cuts[i]), endTime: cuts[i + 1] >= 1440 ? '24:00' : hhmm(cuts[i + 1]) } as Partial<AvailabilityRule>));
    }
  }
  return out;
}

describe('property: expanding each owner in its own zone and intersecting instants (seeded)', () => {
  it('free intervals equal an independent expansion of both owners intersected, for random zones, rules and dates; slots lie inside them; deterministic', () => {
    const r = prng(20271);
    let nonEmpty = 0;
    let crossZone = 0;
    for (let n = 0; n < 220; n++) {
      const offeringZone = pick(r, ZONES);
      const resourceZone = pick(r, ZONES);
      if (offeringZone !== resourceZone) crossZone++;
      const fromDate = pick(r, DATES);
      const toDate = addLocalDays(fromDate, int(r, 0, 3));
      const offeringRules = randomRules(r, { offeringId: 'off-1', resourceId: null }, 'o');
      const resourceRules = randomRules(r, { offeringId: null, resourceId: 'court' }, 'c');
      const i: AvailabilityInput = {
        timezone: offeringZone, fromDate, toDate, offering: { id: 'off-1', archivedAt: null }, offeringRules, offeringExceptions: [],
        resources: [resource('court', { timezone: resourceZone, rules: resourceRules })], slot: { durationMinutes: pick(r, [30, 60, 90]), stepMinutes: pick(r, [15, 30, 60]) },
      };
      const a = computeAvailability(i);
      expect(a.ok, `seed case ${n}`).toBe(true);
      if (!a.ok) continue;
      // the independent expectation: the offering over its dates in its zone; the resource over a generous range in ITS zone; their intersection
      const offering = expandOwnerAvailability({ rules: offeringRules, exceptions: [] }, fromDate, toDate, offeringZone).intervals;
      const own = expandOwnerAvailability({ rules: resourceRules, exceptions: [] }, addLocalDays(fromDate, -3), addLocalDays(toDate, 3), resourceZone).intervals;
      const expected = intersectIntervals(offering, own);
      const entry = a.free.find(f => f.resourceId === 'court');
      if (!entry) expect(offering, `case ${n}: no resource entry only when the offering itself has no availability`).toEqual([]);
      const got = entry?.intervals ?? [];
      expect(got, `case ${n}: ${offeringZone} / ${resourceZone} ${fromDate}..${toDate}`).toEqual(expected);
      if (expected.length > 0) nonEmpty++;
      // every slot lies wholly inside the shared free time, and the grid is anchored to the offering's intervals
      for (const s of a.slots) {
        const [st, en] = [Date.parse(s.startsAt), Date.parse(s.endsAt)];
        expect(got.some(w => Date.parse(w.startsAt) <= st && en <= Date.parse(w.endsAt)), `slot ${s.startsAt} in case ${n}`).toBe(true);
        expect(offering.some(w => Date.parse(w.startsAt) <= st && en <= Date.parse(w.endsAt))).toBe(true);
      }
      // deterministic
      expect(computeAvailability(i)).toEqual(a);
      // normalised output
      expect(normaliseIntervals(got)).toEqual(got);
    }
    expect(nonEmpty).toBeGreaterThan(60); // the cases are not vacuous
    expect(crossZone).toBeGreaterThan(150);
  });

  it('a resource pinned to the offering\'s own zone gives exactly the result of giving it no zone', () => {
    const r = prng(777);
    for (let n = 0; n < 80; n++) {
      const zone = pick(r, ZONES);
      const fromDate = pick(r, DATES);
      const rulesO = randomRules(r, { offeringId: 'off-1', resourceId: null }, 'o');
      const rulesC = randomRules(r, { offeringId: null, resourceId: 'court' }, 'c');
      const base = { timezone: zone, fromDate, toDate: addLocalDays(fromDate, 2), offering: { id: 'off-1', archivedAt: null }, offeringRules: rulesO, offeringExceptions: [], slot: { durationMinutes: 60, stepMinutes: 30 } };
      const without = computeAvailability({ ...base, resources: [resource('court', { rules: rulesC })] });
      const withZone = computeAvailability({ ...base, resources: [resource('court', { timezone: zone, rules: rulesC })] });
      expect(withZone, `case ${n}`).toEqual(without);
    }
  });

  it('the resource\'s UTC hours do not depend on the offering zone: swapping the offering zone keeps every instant the resource offers', () => {
    const r = prng(4242);
    for (let n = 0; n < 60; n++) {
      const resourceZone = pick(r, ZONES);
      const fromDate = pick(r, DATES);
      const resourceRules = randomRules(r, { offeringId: null, resourceId: 'court' }, 'c');
      const allDay = [0, 1, 2, 3, 4, 5, 6].map(d => rule(`o${d}`, { dayOfWeek: d, startTime: '00:00', endTime: '24:00' }));
      const results = ZONES.map(offeringZone =>
        computeAvailability({ timezone: offeringZone, fromDate, toDate: addLocalDays(fromDate, 1), offering: { id: 'off-1', archivedAt: null }, offeringRules: allDay, offeringExceptions: [], resources: [resource('court', { timezone: resourceZone, rules: resourceRules })], slot: { durationMinutes: 60, stepMinutes: 60 } }),
      );
      const own = expandOwnerAvailability({ rules: resourceRules, exceptions: [] }, addLocalDays(fromDate, -3), addLocalDays(fromDate, 4), resourceZone).intervals;
      for (const res of results) {
        expect(res.ok).toBe(true);
        if (!res.ok) continue;
        for (const w of res.free[0].intervals) expect(own.some(o => Date.parse(o.startsAt) <= Date.parse(w.startsAt) && Date.parse(w.endsAt) <= Date.parse(o.endsAt)), `case ${n}`).toBe(true);
      }
    }
  });
});
