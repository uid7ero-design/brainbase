import { describe, expect, it } from 'vitest';
import { localWindowToInstants, offsetMinutesAt, resolveLocalTime } from '../src';

// Australia/Adelaide in 2026: DST ends Sunday 5 April at 03:00 (clocks back to 02:00, +10:30 -> +09:30)
// and starts Sunday 4 October at 02:00 (clocks forward to 03:00, +09:30 -> +10:30).
const ADL = 'Australia/Adelaide';

describe('resolveLocalTime (Adelaide)', () => {
  it('an ordinary summer time is unambiguous at +10:30', () => {
    expect(resolveLocalTime('2026-01-15', '16:00', ADL)).toEqual({ kind: 'ok', instant: '2026-01-15T05:30:00Z', offsetMinutes: 630 });
  });

  it('an ordinary winter time is unambiguous at +09:30', () => {
    expect(resolveLocalTime('2026-07-15', '16:00', ADL)).toEqual({ kind: 'ok', instant: '2026-07-15T06:30:00Z', offsetMinutes: 570 });
  });

  it('a weekly 16:00 class stays 16:00 locally across both changeovers while its UTC hour moves', () => {
    const before = resolveLocalTime('2026-03-29', '16:00', ADL); // the Sunday before DST ends
    const after = resolveLocalTime('2026-04-12', '16:00', ADL); // after DST ended
    expect(before.instant).toBe('2026-03-29T05:30:00Z');
    expect(after.instant).toBe('2026-04-12T06:30:00Z');
    const springBefore = resolveLocalTime('2026-09-27', '16:00', ADL);
    const springAfter = resolveLocalTime('2026-10-11', '16:00', ADL);
    expect(springBefore.instant).toBe('2026-09-27T06:30:00Z');
    expect(springAfter.instant).toBe('2026-10-11T05:30:00Z');
  });

  it('fall back: 02:30 on 5 April happens twice; the earlier instant wins and the later one is reported', () => {
    const r = resolveLocalTime('2026-04-05', '02:30', ADL);
    expect(r).toEqual({ kind: 'ambiguous', instant: '2026-04-04T16:00:00Z', offsetMinutes: 630, laterInstant: '2026-04-04T17:00:00Z' });
  });

  it('spring forward: 02:30 on 4 October does not exist; it resolves forward by the gap to 03:30', () => {
    const r = resolveLocalTime('2026-10-04', '02:30', ADL);
    expect(r.kind).toBe('gap');
    expect(r.instant).toBe('2026-10-03T17:00:00Z'); // 03:30 local at +10:30
  });

  it('the minute either side of each changeover is unambiguous', () => {
    expect(resolveLocalTime('2026-10-04', '01:59', ADL).kind).toBe('ok');
    expect(resolveLocalTime('2026-10-04', '03:00', ADL).kind).toBe('ok');
    expect(resolveLocalTime('2026-04-05', '01:59', ADL).kind).toBe('ok');
    expect(resolveLocalTime('2026-04-05', '03:00', ADL).kind).toBe('ok');
  });

  it('works for a zone with no DST (Perth) and a zone west of UTC (New York)', () => {
    expect(resolveLocalTime('2026-10-04', '02:30', 'Australia/Perth')).toEqual({ kind: 'ok', instant: '2026-10-03T18:30:00Z', offsetMinutes: 480 });
    expect(resolveLocalTime('2026-07-01', '09:00', 'America/New_York')).toEqual({ kind: 'ok', instant: '2026-07-01T13:00:00Z', offsetMinutes: -240 });
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => resolveLocalTime('2026-02-30', '10:00', ADL)).toThrow();
    expect(() => resolveLocalTime('2026-02-10', '25:00', ADL)).toThrow();
    expect(() => resolveLocalTime('2026-02-10', '10:00', 'Mars/Olympus')).toThrow();
  });
});

describe('offsetMinutesAt', () => {
  it('reports the offset in force at an instant', () => {
    expect(offsetMinutesAt(Date.parse('2026-01-01T00:00:00Z'), ADL)).toBe(630);
    expect(offsetMinutesAt(Date.parse('2026-07-01T00:00:00Z'), ADL)).toBe(570);
  });
});

describe('localWindowToInstants', () => {
  it('durations are measured on instants: 01:30 to 03:30 on the day clocks go back is 3 real hours, not 2', () => {
    const w = localWindowToInstants({ date: '2026-04-05', time: '01:30' }, { date: '2026-04-05', time: '03:30' }, ADL);
    expect(w.ok).toBe(true);
    if (w.ok) expect((Date.parse(w.instants.endsAt) - Date.parse(w.instants.startsAt)) / 3600000).toBe(3); // two wall-clock hours plus the repeated 02:00-03:00 hour
  });

  it('strict mode rejects a staff-entered slot that starts in the spring-forward gap', () => {
    const w = localWindowToInstants({ date: '2026-10-04', time: '02:30' }, { date: '2026-10-04', time: '03:30' }, ADL);
    expect(w).toEqual({ ok: false, problem: expect.stringContaining('does not exist') });
  });

  it('non-strict mode (generated recurrence) accepts the gap, resolves forward and reports it', () => {
    const w = localWindowToInstants({ date: '2026-10-04', time: '02:30' }, { date: '2026-10-04', time: '04:00' }, ADL, { strict: false });
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.startKind).toBe('gap');
      expect(w.instants.startsAt).toBe('2026-10-03T17:00:00Z');
    }
  });

  it('rejects a window that ends before it starts', () => {
    expect(localWindowToInstants({ date: '2026-03-01', time: '10:00' }, { date: '2026-03-01', time: '09:00' }, ADL).ok).toBe(false);
  });

  it('a hotel stay is local calendar dates: 2 nights across the DST end is 45 real hours, not 44', () => {
    const w = localWindowToInstants({ date: '2026-04-04', time: '14:00' }, { date: '2026-04-06', time: '10:00' }, ADL);
    expect(w.ok).toBe(true);
    if (w.ok) expect((Date.parse(w.instants.endsAt) - Date.parse(w.instants.startsAt)) / 3600000).toBe(45); // 44h wall-clock + the repeated hour
  });
});
