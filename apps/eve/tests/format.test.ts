import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDateTimeRange } from '@/lib/format';

// ICU may join time and day-period with a narrow/no-break space; compare on
// plain spaces so the assertions pin the wording, not the codepoint.
const n = (s: string) => s.replace(/[  ]/g, ' ');
const ADL = 'Australia/Adelaide';

describe('formatDateTimeRange', () => {
  it('same local day: one date and a time range in the event zone (Riverlights)', () => {
    expect(n(formatDateTimeRange('2027-03-20T01:30:00Z', '2027-03-20T12:30:00Z', ADL)))
      .toBe('Sat, 20 Mar 2027, 12:00 pm – 11:00 pm ACDT');
  });

  it('same local day even when the UTC dates differ', () => {
    // 9 am–5 pm ACDT on 22 Oct 2026 starts on 21 Oct in UTC.
    expect(n(formatDateTimeRange('2026-10-21T22:30:00Z', '2026-10-22T06:30:00Z', ADL)))
      .toBe('Thu, 22 Oct 2026, 9:00 am – 5:00 pm ACDT');
  });

  it('overnight: both local dates, so the end is unambiguous', () => {
    expect(n(formatDateTimeRange('2027-03-20T09:30:00Z', '2027-03-20T15:30:00Z', ADL)))
      .toBe('Sat, 20 Mar 2027, 8:00 pm – Sun, 21 Mar 2027, 2:00 am ACDT');
  });

  it('DST ends during the event (Adelaide, 4 Apr 2027): each end keeps its own zone', () => {
    expect(n(formatDateTimeRange('2027-04-03T09:30:00Z', '2027-04-03T17:00:00Z', ADL)))
      .toBe('Sat, 3 Apr 2027, 8:00 pm ACDT – Sun, 4 Apr 2027, 2:30 am ACST');
  });

  it('standard time (winter) uses ACST', () => {
    // en-AU ICU abbreviates June as "June" in some builds ("Jun" in others).
    expect(n(formatDateTimeRange('2027-06-15T00:30:00Z', '2027-06-15T02:30:00Z', ADL)))
      .toMatch(/^Tue, 15 June? 2027, 10:00 am – 12:00 pm ACST$/);
  });

  it('uses the stored zone, not the runtime one (Perth)', () => {
    expect(n(formatDateTimeRange('2027-03-20T04:00:00Z', '2027-03-20T15:00:00Z', 'Australia/Perth')))
      .toBe('Sat, 20 Mar 2027, 12:00 pm – 11:00 pm AWST');
  });

  it('no end time: unchanged start-only text', () => {
    const start = '2027-03-20T01:30:00Z';
    for (const end of [null, undefined, '', 'not-a-date']) {
      expect(formatDateTimeRange(start, end, ADL)).toBe(formatDateTime(start, ADL));
    }
    expect(n(formatDateTimeRange(start, null, ADL))).toBe('Sat, 20 Mar 2027, 12:00 pm ACDT');
  });

  it('an end not after the start falls back to the start alone', () => {
    const start = '2027-03-20T01:30:00Z';
    expect(formatDateTimeRange(start, start, ADL)).toBe(formatDateTime(start, ADL));
    expect(formatDateTimeRange(start, '2027-03-20T00:00:00Z', ADL)).toBe(formatDateTime(start, ADL));
  });

  it('no start: empty, as formatDateTime', () => {
    expect(formatDateTimeRange(null, '2027-03-20T12:30:00Z', ADL)).toBe('');
  });
});
