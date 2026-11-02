import { describe, expect, it, vi } from 'vitest';

// CPU-bound property checks: well inside 5 s alone, but over it when the whole suite runs in parallel. A budget, not a retry.
vi.setConfig({ testTimeout: 30_000 });
import {
  addLocalDays,
  computeAvailability,
  intersectIntervals,
  normaliseIntervals,
  subtractIntervals,
  type AvailabilityInput,
  type AvailabilityRule,
  type ResourceAvailabilityInput,
  type ResourceHold,
} from '../src';
import { rule } from './support/availabilityFixtures';

// Property tests over seeded pseudo-random inputs. The generator is a fixed-seed PRNG, so every run checks exactly the same cases
// (deterministic, reproducible from the seed in a failure message) without adding a dependency to a package that has none.

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

const ZONES = ['Australia/Adelaide', 'Australia/Perth', 'Europe/London', 'America/New_York', 'Pacific/Auckland', 'Australia/Lord_Howe'] as const;
// Dates on and around daylight-saving changes in those zones (2026), plus ordinary dates.
const ANCHORS = ['2026-03-26', '2026-04-02', '2026-09-26', '2026-10-01', '2026-10-22', '2026-03-05', '2026-10-30', '2026-01-10', '2026-07-10', '2026-04-03'] as const;

/** Random non-overlapping rules for one owner: per weekday, sorted distinct boundaries paired up (some touching). */
function randomRules(r: () => number, owner: { offeringId: string | null; resourceId: string | null }, prefix: string): AvailabilityRule[] {
  const out: AvailabilityRule[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (r() < 0.35) continue;
    const cuts = new Set<number>();
    const n = int(r, 1, 4) * 2;
    while (cuts.size < n) cuts.add(int(r, 0, 96) * 15); // 0..1440 in quarter hours
    const sorted = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      out.push(rule(`${prefix}-${dow}-${i}`, { ...owner, dayOfWeek: dow, startTime: hhmm(sorted[i]), endTime: sorted[i + 1] === 1440 ? '24:00' : hhmm(sorted[i + 1]) }));
    }
  }
  return out;
}

function randomInput(seed: number): AvailabilityInput {
  const r = prng(seed);
  const timezone = pick(r, ZONES);
  const fromDate = addLocalDays(pick(r, ANCHORS), -int(r, 0, 3));
  const span = int(r, 0, 9);
  const toDate = addLocalDays(fromDate, span);
  const resourceCount = int(r, 0, 3);
  const resources: ResourceAvailabilityInput[] = [];
  for (let i = 0; i < resourceCount; i++) {
    const id = `res-${i}`;
    const holds: ResourceHold[] = [];
    const base = Date.parse(`${fromDate}T00:00:00Z`) - 86400000;
    for (let h = 0; h < int(r, 0, 5); h++) {
      const s = base + int(r, 0, 12 * 24 * 4) * 15 * 60000;
      holds.push({ id: `h${i}-${h}`, resourceId: id, startsAt: new Date(s).toISOString().replace('.000Z', 'Z'), endsAt: new Date(s + int(r, 1, 16) * 15 * 60000).toISOString().replace('.000Z', 'Z'), reservationId: 'rv', occurrenceId: null, releasedAt: r() < 0.2 ? '2026-01-01T00:00:00Z' : null });
    }
    resources.push({ resource: { id, active: r() < 0.9 }, rules: randomRules(r, { offeringId: null, resourceId: id }, `rr${i}`), exceptions: [], holds });
  }
  return {
    timezone,
    fromDate,
    toDate,
    offering: { id: 'off-1', archivedAt: r() < 0.05 ? '2026-01-01T00:00:00Z' : null },
    offeringRules: randomRules(r, { offeringId: 'off-1', resourceId: null }, 'or'),
    offeringExceptions: r() < 0.5 ? [{ id: 'x1', organisationId: 'org-1', resourceId: null, offeringId: 'off-1', fromDate: addLocalDays(fromDate, int(r, 0, span)), toDate, kind: 'closed', reason: null }] : [],
    resources,
    slot: { durationMinutes: pick(r, [15, 30, 45, 60, 90, 120]), stepMinutes: pick(r, [5, 15, 30, 60]) },
  };
}

const CASES = 300;
const ms = (iso: string) => Date.parse(iso);

describe(`availability properties over ${CASES} seeded random inputs (DST edges in six zones)`, () => {
  for (let seed = 1; seed <= CASES; seed++) {
    it(`seed ${seed}: invariants hold`, () => {
      const inputA = randomInput(seed);
      const before = JSON.stringify(inputA);
      const a = computeAvailability(inputA);
      if (!a.ok) throw new Error(`seed ${seed} generated invalid input: ${a.problems.join('; ')}`);

      // Pure: input untouched, identical on repeat.
      expect(JSON.stringify(inputA)).toBe(before);
      expect(computeAvailability(randomInput(seed))).toEqual(a);

      // Free intervals: sorted, positive length, disjoint and non-touching (so maximal).
      for (const f of a.free) {
        for (let i = 0; i < f.intervals.length; i++) {
          expect(ms(f.intervals[i].endsAt), `seed ${seed} negative or empty interval`).toBeGreaterThan(ms(f.intervals[i].startsAt));
          if (i > 0) expect(ms(f.intervals[i].startsAt), `seed ${seed} overlapping or touching intervals`).toBeGreaterThan(ms(f.intervals[i - 1].endsAt));
        }
      }

      const seen = new Set<string>();
      let previous = '';
      for (const s of a.slots) {
        // Positive, exact length; no duplicates; sorted.
        expect(ms(s.endsAt) - ms(s.startsAt), `seed ${seed} slot length`).toBe(inputA.slot.durationMinutes * 60000);
        const key = `${s.startsAt}|${s.resourceId ?? ''}`;
        expect(seen.has(key), `seed ${seed} duplicate slot ${key}`).toBe(false);
        seen.add(key);
        const order = `${s.startsAt}|${s.resourceId ?? ''}`;
        expect(order >= previous, `seed ${seed} slots out of order`).toBe(true);
        previous = order;

        // Inside the owner's free intervals for that resource, and clear of that resource's active holds.
        const free = a.free.find(f => f.resourceId === s.resourceId);
        expect(free, `seed ${seed} slot for an unlisted resource`).toBeTruthy();
        expect(free!.intervals.some(i => ms(i.startsAt) <= ms(s.startsAt) && ms(s.endsAt) <= ms(i.endsAt)), `seed ${seed} slot outside free intervals`).toBe(true);
        const res = inputA.resources.find(x => x.resource.id === s.resourceId);
        for (const h of res?.holds ?? []) {
          if (h.releasedAt !== null) continue;
          expect(ms(s.endsAt) <= ms(h.startsAt) || ms(h.endsAt) <= ms(s.startsAt), `seed ${seed} slot overlaps a hold`).toBe(true);
        }
        if (res) expect(res.resource.active, `seed ${seed} slot on an inactive resource`).toBe(true);
      }
      if (inputA.offering.archivedAt !== null) expect(a.slots).toEqual([]);
    });
  }
});

describe('interval algebra properties', () => {
  const randomSet = (r: () => number) => {
    const out = [];
    for (let i = 0; i < int(r, 0, 6); i++) {
      const s = int(r, 0, 200);
      out.push({ startsAt: new Date(Date.UTC(2026, 0, 1) + s * 60000).toISOString(), endsAt: new Date(Date.UTC(2026, 0, 1) + (s + int(r, 0, 60)) * 60000).toISOString() });
    }
    return out;
  };
  const total = (xs: Array<{ startsAt: string; endsAt: string }>) => normaliseIntervals(xs).reduce((n, i) => n + ms(i.endsAt) - ms(i.startsAt), 0);

  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed}: (a minus c) plus (a and c) is a, and the parts are disjoint`, () => {
      const r = prng(seed * 7919);
      const a = randomSet(r);
      const c = randomSet(r);
      const minus = subtractIntervals(a, c);
      const both = intersectIntervals(a, c);
      expect(normaliseIntervals([...minus, ...both])).toEqual(normaliseIntervals(a));
      expect(intersectIntervals(minus, c)).toEqual([]);
      expect(total(minus) + total(both)).toBe(total(a));
      expect(intersectIntervals(a, c)).toEqual(intersectIntervals(c, a));
      expect(normaliseIntervals(normaliseIntervals(a))).toEqual(normaliseIntervals(a));
    });
  }
});

describe('continuity across daylight saving', () => {
  // A rule covering every local day 00:00-24:00 must produce ONE interval from the first local midnight to the last, in every zone
  // and over every changeover, however long or short the local days are.
  for (const zone of ZONES) {
    for (const anchor of ANCHORS) {
      it(`${zone} from ${anchor}: all-day rules are one unbroken interval`, () => {
        const rules = Array.from({ length: 7 }, (_, dow) => rule(`d${dow}`, { dayOfWeek: dow, startTime: '00:00', endTime: '24:00' }));
        const r = computeAvailability({
          timezone: zone,
          fromDate: anchor,
          toDate: addLocalDays(anchor, 6),
          offering: { id: 'off-1', archivedAt: null },
          offeringRules: rules,
          offeringExceptions: [],
          resources: [],
          slot: { durationMinutes: 60, stepMinutes: 60 },
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.free[0].intervals).toHaveLength(1);
          // The interval runs from local midnight of the first date to local midnight after the last: its length is the sum of the real days.
          const elapsedHours = (ms(r.free[0].intervals[0].endsAt) - ms(r.free[0].intervals[0].startsAt)) / 3600000;
          expect(elapsedHours).toBeGreaterThanOrEqual(7 * 24 - 2);
          expect(elapsedHours).toBeLessThanOrEqual(7 * 24 + 2);
        }
      });
    }
  }
});

describe('the generator exercises the interesting cases (it is not vacuous)', () => {
  it('produces slots, daylight-saving adjustments, holds that remove slots and inactive or archived cases', () => {
    let withSlots = 0;
    let withAdjustments = 0;
    let withResources = 0;
    let archived = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const input = randomInput(seed);
      const r = computeAvailability(input);
      if (!r.ok) continue;
      if (r.slots.length > 0) withSlots++;
      if (r.adjustments.length > 0) withAdjustments++;
      if (input.resources.length > 0) withResources++;
      if (input.offering.archivedAt !== null) archived++;
    }
    expect(withSlots).toBeGreaterThan(CASES / 3);
    expect(withAdjustments).toBeGreaterThan(3);
    expect(withResources).toBeGreaterThan(CASES / 3);
    expect(archived).toBeGreaterThan(0);
  });
});
