import { describe, expect, it } from 'vitest';
import {
  buildClosureCreate,
  buildClosureEdit,
  buildHoursCreate,
  buildHoursEdit,
  closureTimesText,
  daylightSavingNotices,
  describeTimezone,
  effectiveEnd,
  effectiveTimezone,
  emptyClosureValues,
  emptyHoursValues,
  findOvernightPairs,
  formatClock,
  formatDate,
  formatWindow,
  localToday,
  runsPastMidnight,
  splitClosures,
  valuesFromClosure,
  valuesFromRule,
  weekItems,
} from '@/lib/scheduling/dashboard/availability';
import type { AvailabilityClosureView, AvailabilityRuleView } from '@/lib/scheduling/dashboard/types';

// Phase 2B.3c: the pure decisions behind the availability screens (lib/scheduling/dashboard/availability.ts): how a form becomes a request
// (and which requests are refused before they are sent), how the week is laid out, how an overnight window is recognised, the daylight-saving
// notices (Australia/Adelaide), and how the timezone is described. No browser, no network.

let n = 0;
const rule = (over: Partial<AvailabilityRuleView> = {}): AvailabilityRuleView => ({
  id: `r${++n}`, resourceId: 'res-1', offeringId: null, kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null,
  createdAt: '2027-01-01T00:00:00Z', updatedAt: '2027-01-01T00:00:00.000000Z', ...over,
});
const closure = (over: Partial<AvailabilityClosureView> = {}): AvailabilityClosureView => ({
  id: `c${++n}`, resourceId: 'res-1', offeringId: null, fromDate: '2027-04-02', toDate: '2027-04-02', kind: 'closed', reason: null, startTime: null, endTime: null,
  createdAt: '2027-01-01T00:00:00Z', updatedAt: '2027-01-01T00:00:00.000000Z', ...over,
});

describe('wording', () => {
  it('formats clock times and windows in plain 12-hour language, with midnight named', () => {
    expect(['00:00', '00:30', '09:00', '12:00', '12:30', '13:05', '23:59', '24:00'].map(formatClock)).toEqual(['12:00 am', '12:30 am', '9:00 am', '12:00 pm', '12:30 pm', '1:05 pm', '11:59 pm', 'midnight']);
    expect(formatWindow('09:00', '17:00')).toBe('9:00 am to 5:00 pm');
    expect(formatWindow('22:00', '24:00')).toBe('10:00 pm to midnight');
    expect(formatWindow('00:00', '24:00')).toBe('All day');
  });
  it('formats a calendar date without any timezone shift', () => {
    expect(formatDate('2027-04-04')).toBe('Sun 4 Apr 2027');
    expect(formatDate('2027-12-31')).toBe('Fri 31 Dec 2027');
  });
  it('names a closure\'s times', () => {
    expect(closureTimesText(closure())).toBe('Whole day');
    expect(closureTimesText(closure({ startTime: '12:00', endTime: '13:30' }))).toBe('12:00 pm to 1:30 pm');
  });
});

describe('adding hours', () => {
  it('weekdays 09:00-17:00 is one request for five days', () => {
    const r = buildHoursCreate(emptyHoursValues());
    expect(r).toEqual({ ok: true, value: { body: { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }, overnight: false } });
  });
  it('one day uses dayOfWeek; a note is trimmed and only sent when there is one', () => {
    expect(buildHoursCreate({ ...emptyHoursValues([3]), label: '  Peak  ' })).toEqual({ ok: true, value: { body: { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', label: 'Peak' }, overnight: false } });
  });
  it('days are de-duplicated and sorted', () => {
    const r = buildHoursCreate({ ...emptyHoursValues(), days: [5, 1, 5, 3] });
    expect(r.ok && r.value.body.daysOfWeek).toEqual([1, 3, 5]);
  });
  it('"Until midnight" is end 24:00 whatever the end box says; a typed 00:00 end also means midnight', () => {
    expect(effectiveEnd({ start: '09:00', end: '03:00', untilMidnight: true })).toBe('24:00');
    expect(effectiveEnd({ start: '09:00', end: '00:00', untilMidnight: false })).toBe('24:00');
    expect(effectiveEnd({ start: '00:00', end: '00:00', untilMidnight: false })).toBe('00:00');
    const r = buildHoursCreate({ ...emptyHoursValues([1]), start: '08:00', untilMidnight: true });
    expect(r.ok && r.value.body).toMatchObject({ startTime: '08:00', endTime: '24:00' });
  });
  it('an end before the start runs past midnight: it asks for overnight, in the same single request', () => {
    const values = { ...emptyHoursValues([5]), start: '22:00', end: '02:00' };
    expect(runsPastMidnight(values)).toBe(true);
    expect(buildHoursCreate(values)).toEqual({ ok: true, value: { body: { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true }, overnight: true } });
    expect(runsPastMidnight({ start: '22:00', end: '23:00', untilMidnight: false })).toBe(false);
    expect(runsPastMidnight({ start: '22:00', end: '00:00', untilMidnight: false })).toBe(false); // until midnight, not past it
  });
  it('overnight on several nights is still one request', () => {
    const r = buildHoursCreate({ ...emptyHoursValues(), start: '22:00', end: '06:00' });
    expect(r.ok && r.value.body).toEqual({ daysOfWeek: [1, 2, 3, 4, 5], startTime: '22:00', endTime: '06:00', overnight: true });
  });
  it.each([
    [{ days: [] }, /at least one day/],
    [{ start: '' }, /start time/],
    [{ end: '' }, /end time/],
    [{ start: '09:00', end: '09:00' }, /different/],
    [{ start: '00:00', end: '00:00' }, /different/],
    [{ label: 'x'.repeat(81) }, /80 characters/],
  ])('refuses %j before sending anything', (over, message) => {
    const r = buildHoursCreate({ ...emptyHoursValues(), ...over });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.join(' ')).toMatch(message);
  });
});

describe('editing hours', () => {
  const original = rule({ dayOfWeek: 2, startTime: '09:00', endTime: '17:00', label: 'Day' });
  it('sends only what changed', () => {
    expect(buildHoursEdit({ ...valuesFromRule(original), end: '18:00' }, original)).toEqual({ ok: true, value: { endTime: '18:00' } });
    expect(buildHoursEdit({ ...valuesFromRule(original), label: '' }, original)).toEqual({ ok: true, value: { label: null } });
    expect(buildHoursEdit({ ...valuesFromRule(original), untilMidnight: true }, original)).toEqual({ ok: true, value: { endTime: '24:00' } });
  });
  it('says so when nothing changed', () => {
    expect(buildHoursEdit(valuesFromRule(original), original)).toEqual({ ok: false, problems: ['Nothing has changed.'] });
  });
  it('cannot be edited into an overnight window: that is two rules, so it is remove and add again', () => {
    const r = buildHoursEdit({ ...valuesFromRule(original), start: '22:00', end: '02:00' }, original);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.join(' ')).toMatch(/remove this window and add it again/);
  });
  it('a window that ends at midnight reads back as "until midnight" and edits cleanly', () => {
    const late = rule({ startTime: '18:00', endTime: '24:00' });
    expect(valuesFromRule(late)).toMatchObject({ untilMidnight: true, start: '18:00' });
    expect(buildHoursEdit({ ...valuesFromRule(late), start: '19:00' }, late)).toEqual({ ok: true, value: { startTime: '19:00' } });
  });
});

describe('overnight windows in the week', () => {
  const friEvening = rule({ dayOfWeek: 5, startTime: '22:00', endTime: '24:00' });
  const satMorning = rule({ dayOfWeek: 6, startTime: '00:00', endTime: '02:00' });

  it('two rules that meet at midnight are ONE overnight window, listed on the day it starts and noted on the next', () => {
    const week = weekItems([friEvening, satMorning]);
    expect(week[5].map(i => i.type)).toEqual(['overnight']);
    expect(week[6].map(i => i.type)).toEqual(['continued']);
    expect(findOvernightPairs([friEvening, satMorning])).toHaveLength(1);
  });
  it('Saturday night wraps to Sunday', () => {
    const pairs = findOvernightPairs([rule({ dayOfWeek: 6, startTime: '23:00', endTime: '24:00' }), rule({ dayOfWeek: 0, startTime: '00:00', endTime: '01:00' })]);
    expect(pairs).toHaveLength(1);
  });
  it('rules that merely sit near each other are NOT paired: other days, a gap, an all-day rule, different kind or validity', () => {
    expect(findOvernightPairs([friEvening, rule({ dayOfWeek: 0, startTime: '00:00', endTime: '02:00' })])).toEqual([]);
    expect(findOvernightPairs([rule({ dayOfWeek: 5, startTime: '22:00', endTime: '23:00' }), satMorning])).toEqual([]);
    expect(findOvernightPairs([rule({ dayOfWeek: 5, startTime: '00:00', endTime: '24:00' }), rule({ dayOfWeek: 6, startTime: '00:00', endTime: '24:00' })])).toEqual([]);
    expect(findOvernightPairs([friEvening, { ...satMorning, kind: 'service_period' }])).toEqual([]);
    expect(findOvernightPairs([{ ...friEvening, validFrom: '2027-01-01' }, satMorning])).toEqual([]);
  });
  it('validity dates shift by one day with the morning half, as the API stores them', () => {
    const a = { ...friEvening, validFrom: '2027-01-01', validTo: '2027-06-30' };
    const b = { ...satMorning, validFrom: '2027-01-02', validTo: '2027-07-01' };
    expect(findOvernightPairs([a, b])).toHaveLength(1);
  });
  it('each rule belongs to at most one pair', () => {
    const second = rule({ dayOfWeek: 5, startTime: '23:00', endTime: '24:00' });
    expect(findOvernightPairs([friEvening, second, satMorning])).toHaveLength(1);
  });
  it('items sort by start time within a day', () => {
    const week = weekItems([rule({ dayOfWeek: 1, startTime: '13:00', endTime: '17:00' }), rule({ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })]);
    expect(week[1].map(i => (i.type === 'window' ? i.rule.startTime : ''))).toEqual(['09:00', '13:00']);
  });
});

describe('closures', () => {
  it('a whole-day closure: one date, or a range, with an optional reason', () => {
    expect(buildClosureCreate({ ...emptyClosureValues('2027-04-02'), reason: ' Good Friday ' })).toEqual({ ok: true, value: { fromDate: '2027-04-02', toDate: '2027-04-02', reason: 'Good Friday' } });
    expect(buildClosureCreate({ ...emptyClosureValues('2027-04-02'), toDate: '2027-04-05' })).toEqual({ ok: true, value: { fromDate: '2027-04-02', toDate: '2027-04-05' } });
  });
  it('a partial-day closure sends both times; "until midnight" is 24:00', () => {
    expect(buildClosureCreate({ ...emptyClosureValues('2027-04-02'), scope: 'partial' })).toEqual({ ok: true, value: { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00' } });
    const r = buildClosureCreate({ ...emptyClosureValues('2027-04-02'), scope: 'partial', start: '20:00', untilMidnight: true });
    expect(r.ok && r.value).toMatchObject({ startTime: '20:00', endTime: '24:00' });
  });
  it.each([
    [{ fromDate: '' }, /first date/],
    [{ fromDate: '2027-02-30' }, /first date/],
    [{ toDate: '2027-04-01' }, /cannot be before/],
    [{ toDate: 'soon' }, /valid last date/],
    [{ scope: 'partial' as const, start: '13:00', end: '12:00' }, /end after it starts/],
    [{ scope: 'partial' as const, start: '12:00', end: '12:00' }, /end after it starts/],
    [{ scope: 'partial' as const, start: '' }, /starts/],
    [{ reason: 'x'.repeat(201) }, /200 characters/],
  ])('refuses %j before sending anything', (over, message) => {
    const r = buildClosureCreate({ ...emptyClosureValues('2027-04-02'), ...over });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.join(' ')).toMatch(message);
  });
  it('editing sends only the changes, and switches between whole days and part of a day as a pair', () => {
    const whole = closure({ reason: 'Easter' });
    expect(buildClosureEdit({ ...valuesFromClosure(whole), toDate: '2027-04-05' }, whole)).toEqual({ ok: true, value: { toDate: '2027-04-05' } });
    expect(buildClosureEdit({ ...valuesFromClosure(whole), scope: 'partial' }, whole)).toEqual({ ok: true, value: { startTime: '12:00', endTime: '13:00' } });
    const part = closure({ startTime: '12:00', endTime: '13:00' });
    expect(buildClosureEdit({ ...valuesFromClosure(part), scope: 'full' }, part)).toEqual({ ok: true, value: { startTime: null, endTime: null } });
    expect(buildClosureEdit({ ...valuesFromClosure(part), end: '14:00' }, part)).toEqual({ ok: true, value: { startTime: '12:00', endTime: '14:00' } });
    expect(buildClosureEdit({ ...valuesFromClosure(part), reason: '' }, closure({ startTime: '12:00', endTime: '13:00', reason: 'x' }))).toEqual({ ok: true, value: { reason: null } });
    expect(buildClosureEdit(valuesFromClosure(part), part)).toEqual({ ok: false, problems: ['Nothing has changed.'] });
  });
  it('splits upcoming from past by date in the hours\' zone, upcoming first and oldest-first, past newest-first', () => {
    const list = [closure({ fromDate: '2027-03-01', toDate: '2027-03-01' }), closure({ fromDate: '2027-05-01', toDate: '2027-05-01' }), closure({ fromDate: '2027-04-10', toDate: '2027-04-12' }), closure({ fromDate: '2027-04-01', toDate: '2027-04-10' }), closure({ fromDate: '2027-02-01', toDate: '2027-02-03' })];
    const { upcoming, past } = splitClosures(list, '2027-04-10');
    expect(upcoming.map(c => c.fromDate)).toEqual(['2027-04-01', '2027-04-10', '2027-05-01']); // a closure that ends today is still upcoming
    expect(past.map(c => c.fromDate)).toEqual(['2027-03-01', '2027-02-01']);
  });
});

describe('timezone', () => {
  it('describes Adelaide with its offset: +10:30 in summer, +09:30 in winter; UTC for zero', () => {
    expect(describeTimezone('Australia/Adelaide', new Date('2027-01-15T00:00:00Z'))).toBe('Australia/Adelaide (UTC+10:30)');
    expect(describeTimezone('Australia/Adelaide', new Date('2027-07-15T00:00:00Z'))).toBe('Australia/Adelaide (UTC+09:30)');
    expect(describeTimezone('UTC', new Date('2027-07-15T00:00:00Z'))).toBe('UTC (UTC+00:00)');
    expect(describeTimezone('Not/AZone')).toBe('Not/AZone');
  });
  it('knows today\'s date in the zone, not in UTC', () => {
    const instant = new Date('2027-04-03T15:00:00Z'); // 01:30 on Sunday 4 April in Adelaide, still Saturday in UTC
    expect(localToday('Australia/Adelaide', instant)).toBe('2027-04-04');
    expect(localToday('UTC', instant)).toBe('2027-04-03');
  });
  it('picks the schedule\'s zone for an offering, the organisation\'s otherwise, and says where it came from', () => {
    expect(effectiveTimezone({ kind: 'offering', scheduleTimezone: 'Australia/Perth', organisationTimezone: 'Australia/Adelaide', organisationSource: 'organisation' })).toEqual({ zone: 'Australia/Perth', source: 'This schedule’s timezone' });
    expect(effectiveTimezone({ kind: 'resource', scheduleTimezone: 'Australia/Perth', organisationTimezone: 'Australia/Adelaide', organisationSource: 'organisation' })?.zone).toBe('Australia/Adelaide');
    expect(effectiveTimezone({ kind: 'offering', scheduleTimezone: null, organisationTimezone: 'Australia/Adelaide', organisationSource: 'fallback' })?.source).toMatch(/system default/);
    expect(effectiveTimezone({ kind: 'offering', scheduleTimezone: null, organisationTimezone: null, organisationSource: null })).toBeNull();
  });
});

describe('daylight-saving notices (Australia/Adelaide, 2027)', () => {
  const ADL = 'Australia/Adelaide';
  const notices = (rules: AvailabilityRuleView[], today = '2027-03-20', closures: AvailabilityClosureView[] = []) => daylightSavingNotices(rules, closures, ADL, today);

  it('hours that avoid the changeover hour produce no notice', () => {
    expect(notices([rule({ dayOfWeek: 0, startTime: '09:00', endTime: '17:00' })])).toEqual([]);
    expect(notices([])).toEqual([]);
  });
  it('an end inside the repeated hour on 4 April says clocks go back and that the hours end the first time round', () => {
    const [n] = notices([rule({ dayOfWeek: 0, startTime: '00:00', endTime: '02:30' })]);
    expect(n.date).toBe('2027-04-04');
    expect(n.text).toMatch(/Sun 4 Apr 2027: clocks go back/);
    expect(n.text).toMatch(/end the first time/);
  });
  it('a start inside the repeated hour starts the first time round', () => {
    expect(notices([rule({ dayOfWeek: 0, startTime: '02:30', endTime: '05:00' })])[0].text).toMatch(/start the first time/);
  });
  it('a start in the skipped hour on 3 October opens when the clocks jump; one wholly inside it opens nothing', () => {
    expect(notices([rule({ dayOfWeek: 0, startTime: '02:30', endTime: '05:00' })], '2027-09-20')[0].text).toMatch(/Sun 3 Oct 2027: clocks go forward.*open when the clocks jump/);
    expect(notices([rule({ dayOfWeek: 0, startTime: '02:10', endTime: '02:50' })], '2027-09-20').map(x => x.text).join(' ')).toMatch(/nothing is open then/);
  });
  it('an end in the skipped hour ends when the clocks jump', () => {
    expect(notices([rule({ dayOfWeek: 0, startTime: '00:00', endTime: '02:30' })], '2027-09-20')[0].text).toMatch(/end when the clocks jump/);
  });
  it('a partial-day closure is taken into account: closing the changeover hour leaves nothing to adjust', () => {
    const hours = [rule({ dayOfWeek: 0, startTime: '00:00', endTime: '06:00' })];
    expect(notices(hours, '2027-03-20')).toEqual([]); // 00:00-06:00 spans the repeated hour without a boundary in it
    const edge = [rule({ dayOfWeek: 0, startTime: '00:00', endTime: '02:30' })];
    const closed = [closure({ fromDate: '2027-04-04', toDate: '2027-04-04', startTime: '01:00', endTime: '03:00' })];
    expect(daylightSavingNotices(edge, [], ADL, '2027-03-20', { days: 30 })).toHaveLength(1); // 2:30 am ends in the repeated hour on 4 April...
    expect(daylightSavingNotices(edge, closed, ADL, '2027-03-20', { days: 30 })).toEqual([]); // ...unless that hour is closed
    expect(daylightSavingNotices(edge, [], ADL, '2027-03-20', { days: 30, limit: 3 })[0].date).toBe('2027-04-04');
  });
  it('lists the earliest changes first, at most three, each once', () => {
    const sundayAll = [rule({ dayOfWeek: 0, startTime: '00:00', endTime: '02:30' }), rule({ dayOfWeek: 0, startTime: '02:30', endTime: '05:00', id: 'second' })];
    const list = daylightSavingNotices(sundayAll, [], ADL, '2027-03-20', { days: 400, limit: 10 });
    expect(list.map(x => x.date)).toEqual([...list.map(x => x.date)].sort());
    expect(daylightSavingNotices(sundayAll, [], ADL, '2027-03-20', { days: 400, limit: 2 })).toHaveLength(2);
  });
  it('looks only one year ahead, and an unknown zone or date gives no notices rather than an error', () => {
    expect(daylightSavingNotices([rule({ dayOfWeek: 0, startTime: '00:00', endTime: '02:30' })], [], ADL, '2027-04-05', { days: 100 })).toEqual([]);
    expect(daylightSavingNotices([rule()], [], 'Not/AZone', '2027-03-20')).toEqual([]);
    expect(daylightSavingNotices([rule()], [], ADL, 'yesterday')).toEqual([]);
  });
});
