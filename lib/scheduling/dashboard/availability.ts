import { addLocalDays, expandOwnerAvailability, type AvailabilityAdjustment, type AvailabilityExceptionInput, type AvailabilityRule } from '@scheduling/core';
import type { AvailabilityClosureView, AvailabilityRuleView } from './types';

// Phase 2B.3c: everything the availability screens decide, as PURE functions (no I/O, no clock unless passed in): how the week is laid
// out, how an overnight window (two stored rules) is recognised and shown as one, how a form becomes a request, which daylight-saving
// notices apply, and how a timezone is described. Client components import this file, so it imports only the pure shared core.
//
// Stored model recap. A weekly rule is one local window on one weekday (0 = Sunday); `endTime` may be '24:00'. Hours that run past
// midnight are TWO rules (22:00-24:00 on the day, 00:00-02:00 on the next) and the API writes the pair in one statement. A closure is a
// range of local dates; with startTime and endTime it removes only those times (a partial-day closure), otherwise the whole day.
// Times carry no zone: they are read in the schedule's (else the organisation's) timezone, which the screen always shows.

/** Monday first, the Australian week. The API's numbering (0 = Sunday) is unchanged. */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
export const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const MAX_LABEL = 80;
export const MAX_REASON = 200;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (v: string): boolean => CLOCK.test(v);
const toMinutes = (t: string): number => (t === '24:00' ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));

// ── Wording ────────────────────────────────────────────────────────────────

/** '09:00' -> '9:00 am', '12:00' -> '12:00 pm', '00:00' -> '12:00 am', '24:00' -> 'midnight'. */
export function formatClock(t: string): string {
  if (t === '24:00') return 'midnight';
  if (!isClock(t)) return t;
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

/** '09:00','17:00' -> '9:00 am to 5:00 pm'; the whole day -> 'All day'. */
export function formatWindow(start: string, end: string): string {
  return start === '00:00' && end === '24:00' ? 'All day' : `${formatClock(start)} to ${formatClock(end)}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** '2027-04-02' -> 'Fri 2 Apr 2027' (a calendar date: no timezone is involved). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DATE_FORMAT.format(new Date(Date.UTC(y, m - 1, d))).replace(',', '');
}
export const formatDateRange = (from: string, to: string): string => (from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`);

export function validityNote(r: Pick<AvailabilityRuleView, 'validFrom' | 'validTo'>): string | null {
  if (r.validFrom && r.validTo) return `Only from ${formatDate(r.validFrom)} to ${formatDate(r.validTo)}`;
  if (r.validFrom) return `From ${formatDate(r.validFrom)}`;
  if (r.validTo) return `Until ${formatDate(r.validTo)}`;
  return null;
}

// ── The week, with overnight windows shown as one ──────────────────────────

export interface OvernightPair {
  /** The evening half: ends at 24:00. */
  first: AvailabilityRuleView;
  /** The morning half, on the next weekday: starts at 00:00. */
  second: AvailabilityRuleView;
}

export type DayItem =
  | { type: 'window'; rule: AvailabilityRuleView }
  | { type: 'overnight'; pair: OvernightPair }
  | { type: 'continued'; pair: OvernightPair };

const shiftDate = (d: string | null): string | null => (d === null ? null : addLocalDays(d, 1));

/**
 * Two stored rules that together are ONE overnight window: the evening half ends at midnight (and does not start at it), the morning
 * half starts at midnight on the next weekday (and does not run all day), same kind, validity shifted by one day. Anything else is
 * shown as the separate windows it is. Each rule belongs to at most one pair.
 */
export function findOvernightPairs(rules: readonly AvailabilityRuleView[]): OvernightPair[] {
  const used = new Set<string>();
  const pairs: OvernightPair[] = [];
  const ordered = [...rules].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  for (const first of ordered) {
    if (used.has(first.id) || first.endTime !== '24:00' || first.startTime === '00:00') continue;
    const second = ordered.find(
      r =>
        !used.has(r.id) && r.id !== first.id && r.dayOfWeek === (first.dayOfWeek + 1) % 7 && r.startTime === '00:00' && r.endTime !== '24:00' &&
        r.kind === first.kind && r.validFrom === shiftDate(first.validFrom) && r.validTo === shiftDate(first.validTo),
    );
    if (!second) continue;
    used.add(first.id);
    used.add(second.id);
    pairs.push({ first, second });
  }
  return pairs;
}

/** Each weekday's items in time order. An overnight window is listed on the day it starts, and noted as continuing on the next. */
export function weekItems(rules: readonly AvailabilityRuleView[]): Record<number, DayItem[]> {
  const week: Record<number, DayItem[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const pairs = findOvernightPairs(rules);
  const inPair = new Set(pairs.flatMap(p => [p.first.id, p.second.id]));
  for (const rule of rules) if (!inPair.has(rule.id)) week[rule.dayOfWeek].push({ type: 'window', rule });
  for (const pair of pairs) {
    week[pair.first.dayOfWeek].push({ type: 'overnight', pair });
    week[pair.second.dayOfWeek].push({ type: 'continued', pair });
  }
  const start = (i: DayItem) => (i.type === 'window' ? i.rule.startTime : i.type === 'overnight' ? i.pair.first.startTime : '00:00');
  for (const day of Object.keys(week)) week[Number(day)].sort((a, b) => start(a).localeCompare(start(b)));
  return week;
}

export const overnightText = (pair: OvernightPair): string => `${formatClock(pair.first.startTime)} to ${formatClock(pair.second.endTime)} the next day`;

// ── Forms: hours ───────────────────────────────────────────────────────────

export interface HoursFormValues {
  days: number[];
  start: string;
  end: string;
  untilMidnight: boolean;
  label: string;
}
export type Built<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export const emptyHoursValues = (days: readonly number[] = WEEKDAYS): HoursFormValues => ({ days: [...days], start: '09:00', end: '17:00', untilMidnight: false, label: '' });
export const valuesFromRule = (r: AvailabilityRuleView): HoursFormValues => ({
  days: [r.dayOfWeek], start: r.startTime, end: r.endTime === '24:00' ? '17:00' : r.endTime, untilMidnight: r.endTime === '24:00', label: r.label ?? '',
});

/** The end the form means: 'midnight' when ticked, otherwise the time, with a typed 00:00 end read as midnight too. */
export function effectiveEnd(v: Pick<HoursFormValues, 'start' | 'end' | 'untilMidnight'>): string {
  if (v.untilMidnight) return '24:00';
  return v.end === '00:00' && v.start !== '00:00' ? '24:00' : v.end;
}

/** Does this window run past midnight (it ends before it starts)? Then it is stored as two rules, together. */
export function runsPastMidnight(v: Pick<HoursFormValues, 'start' | 'end' | 'untilMidnight'>): boolean {
  const end = effectiveEnd(v);
  return isClock(v.start) && (isClock(end) || end === '24:00') && end !== '24:00' && toMinutes(end) < toMinutes(v.start);
}

function hoursProblems(v: HoursFormValues): string[] {
  const problems: string[] = [];
  if (!isClock(v.start)) problems.push('Choose a start time.');
  const end = effectiveEnd(v);
  if (end !== '24:00' && !isClock(end)) problems.push('Choose an end time, or tick "Until midnight".');
  if (isClock(v.start) && (isClock(end) || end === '24:00') && toMinutes(end) === toMinutes(v.start)) problems.push('The end time must be different from the start time.');
  if (v.label.trim().length > MAX_LABEL) problems.push(`The note can be at most ${MAX_LABEL} characters.`);
  return problems;
}

/** The request that adds these hours on every chosen day. Hours that run past midnight ask for `overnight`, so both halves are stored together. */
export function buildHoursCreate(v: HoursFormValues): Built<{ body: Record<string, unknown>; overnight: boolean }> {
  const problems = hoursProblems(v);
  if (v.days.length === 0) problems.unshift('Choose at least one day.');
  if (problems.length > 0) return { ok: false, problems };
  const overnight = runsPastMidnight(v);
  const days = [...new Set(v.days)].sort((a, b) => a - b);
  const label = v.label.trim();
  const body: Record<string, unknown> = {
    ...(days.length === 1 ? { dayOfWeek: days[0] } : { daysOfWeek: days }),
    startTime: v.start,
    endTime: effectiveEnd(v),
    ...(overnight ? { overnight: true } : {}),
    ...(label ? { label } : {}),
  };
  return { ok: true, value: { body, overnight } };
}

/** An edit of one stored window: only what changed. Hours cannot be edited INTO an overnight window (that needs two rules): remove and add again. */
export function buildHoursEdit(v: HoursFormValues, original: AvailabilityRuleView): Built<Record<string, unknown>> {
  const problems = hoursProblems(v);
  if (problems.length === 0 && runsPastMidnight(v)) problems.push('To run past midnight, remove this window and add it again with an end time after midnight.');
  if (problems.length > 0) return { ok: false, problems };
  const change: Record<string, unknown> = {};
  const end = effectiveEnd(v);
  if (v.start !== original.startTime) change.startTime = v.start;
  if (end !== original.endTime) change.endTime = end;
  const label = v.label.trim();
  if (label !== (original.label ?? '')) change.label = label === '' ? null : label;
  return Object.keys(change).length === 0 ? { ok: false, problems: ['Nothing has changed.'] } : { ok: true, value: change };
}

// ── Forms: closures ────────────────────────────────────────────────────────

export interface ClosureFormValues {
  scope: 'full' | 'partial';
  fromDate: string;
  toDate: string;
  start: string;
  end: string;
  untilMidnight: boolean;
  reason: string;
}
export const emptyClosureValues = (date = ''): ClosureFormValues => ({ scope: 'full', fromDate: date, toDate: date, start: '12:00', end: '13:00', untilMidnight: false, reason: '' });
export const valuesFromClosure = (c: AvailabilityClosureView): ClosureFormValues => ({
  scope: c.startTime !== null && c.endTime !== null ? 'partial' : 'full',
  fromDate: c.fromDate, toDate: c.toDate, start: c.startTime ?? '12:00', end: c.endTime && c.endTime !== '24:00' ? c.endTime : '13:00', untilMidnight: c.endTime === '24:00', reason: c.reason ?? '',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isCalendarDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function closureProblems(v: ClosureFormValues): { problems: string[]; toDate: string } {
  const problems: string[] = [];
  const toDate = v.toDate === '' ? v.fromDate : v.toDate; // a single day: leave "to" empty
  if (!isCalendarDate(v.fromDate)) problems.push('Choose the first date.');
  else if (!isCalendarDate(toDate)) problems.push('Choose a valid last date, or leave it empty for a single day.');
  else if (toDate < v.fromDate) problems.push('The last date cannot be before the first date.');
  if (v.scope === 'partial') {
    const end = effectiveEnd(v);
    if (!isClock(v.start)) problems.push('Choose when the closure starts.');
    if (end !== '24:00' && !isClock(end)) problems.push('Choose when the closure ends, or tick "Until midnight".');
    else if (isClock(v.start) && toMinutes(end) <= toMinutes(v.start)) problems.push('The closure must end after it starts. For a closure that runs past midnight, add one closure for each day.');
  }
  if (v.reason.trim().length > MAX_REASON) problems.push(`The reason can be at most ${MAX_REASON} characters.`);
  return { problems, toDate };
}

export function buildClosureCreate(v: ClosureFormValues): Built<Record<string, unknown>> {
  const { problems, toDate } = closureProblems(v);
  if (problems.length > 0) return { ok: false, problems };
  const reason = v.reason.trim();
  return {
    ok: true,
    value: { fromDate: v.fromDate, toDate, ...(v.scope === 'partial' ? { startTime: v.start, endTime: effectiveEnd(v) } : {}), ...(reason ? { reason } : {}) },
  };
}

/** An edit: only what changed. Changing between whole days and part of a day replaces the window as a pair. */
export function buildClosureEdit(v: ClosureFormValues, original: AvailabilityClosureView): Built<Record<string, unknown>> {
  const { problems, toDate } = closureProblems(v);
  if (problems.length > 0) return { ok: false, problems };
  const change: Record<string, unknown> = {};
  if (v.fromDate !== original.fromDate) change.fromDate = v.fromDate;
  if (toDate !== original.toDate) change.toDate = toDate;
  const reason = v.reason.trim();
  if (reason !== (original.reason ?? '')) change.reason = reason === '' ? null : reason;
  const wasPartial = original.startTime !== null && original.endTime !== null;
  if (v.scope === 'partial') {
    const end = effectiveEnd(v);
    if (!wasPartial || v.start !== original.startTime || end !== original.endTime) Object.assign(change, { startTime: v.start, endTime: end });
  } else if (wasPartial) {
    Object.assign(change, { startTime: null, endTime: null });
  }
  return Object.keys(change).length === 0 ? { ok: false, problems: ['Nothing has changed.'] } : { ok: true, value: change };
}

export const closureTimesText = (c: Pick<AvailabilityClosureView, 'startTime' | 'endTime'>): string =>
  c.startTime !== null && c.endTime !== null ? `${formatClock(c.startTime)} to ${formatClock(c.endTime)}` : 'Whole day';

/** Upcoming first, then past ones, each in date order. `today` is a local date in the schedule's zone. */
export function splitClosures(closures: readonly AvailabilityClosureView[], today: string): { upcoming: AvailabilityClosureView[]; past: AvailabilityClosureView[] } {
  const byDate = (a: AvailabilityClosureView, b: AvailabilityClosureView) => a.fromDate.localeCompare(b.fromDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id);
  return {
    upcoming: closures.filter(c => c.toDate >= today).sort(byDate),
    past: closures.filter(c => c.toDate < today).sort((a, b) => byDate(b, a)),
  };
}

// ── Timezone ───────────────────────────────────────────────────────────────

/** Today's local date (YYYY-MM-DD) in a zone. */
export function localToday(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** 'Australia/Adelaide (UTC+10:30)': the zone and its offset right now, so daylight saving is visible. */
export function describeTimezone(timezone: string, now: Date = new Date()): string {
  try {
    const raw = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? '';
    const offset = raw.replace('GMT', 'UTC');
    return `${timezone} (${offset === 'UTC' || offset === '' ? 'UTC' : offset})`;
  } catch {
    return timezone;
  }
}

export interface TimezoneInfo {
  /** The zone the hours are read in. */
  zone: string;
  /** Where it comes from, in words. */
  source: string;
}

export function effectiveTimezone(args: { kind: 'offering' | 'resource'; scheduleTimezone: string | null; organisationTimezone: string | null; organisationSource: 'organisation' | 'fallback' | null }): TimezoneInfo | null {
  if (args.kind === 'offering' && args.scheduleTimezone) return { zone: args.scheduleTimezone, source: 'This schedule’s timezone' };
  if (args.organisationTimezone) {
    return { zone: args.organisationTimezone, source: args.organisationSource === 'fallback' ? 'The system default: your organisation has no timezone set' : 'Your organisation’s timezone' };
  }
  return null;
}

// ── Daylight saving ────────────────────────────────────────────────────────

export interface DaylightNotice {
  date: string;
  text: string;
}

const asCoreRule = (r: AvailabilityRuleView): AvailabilityRule => ({
  id: r.id, organisationId: 'screen', resourceId: r.resourceId, offeringId: r.offeringId, dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, validFrom: r.validFrom, validTo: r.validTo,
});
const asCoreException = (c: AvailabilityClosureView): AvailabilityExceptionInput => ({
  id: c.id, organisationId: 'screen', resourceId: c.resourceId, offeringId: c.offeringId, fromDate: c.fromDate, toDate: c.toDate, kind: c.kind, reason: null,
  ...(c.startTime !== null && c.endTime !== null ? { windows: [{ startTime: c.startTime, endTime: c.endTime }] } : {}),
});

function noticeText(a: AvailabilityAdjustment): string {
  const when = formatDate(a.date);
  const win = formatWindow(a.startTime, a.endTime);
  switch (a.kind) {
    case 'start_ambiguous':
      return `${when}: clocks go back, so the hour around ${formatClock(a.startTime)} happens twice. Hours starting at ${formatClock(a.startTime)} (${win}) start the first time it comes round.`;
    case 'end_ambiguous':
      return `${when}: clocks go back, so the hour around ${formatClock(a.endTime)} happens twice. Hours ending at ${formatClock(a.endTime)} (${win}) end the first time it comes round.`;
    case 'start_in_gap':
      return `${when}: clocks go forward and the hour around ${formatClock(a.startTime)} does not exist. Hours starting at ${formatClock(a.startTime)} (${win}) open when the clocks jump.`;
    case 'end_in_gap':
      return `${when}: clocks go forward and the hour around ${formatClock(a.endTime)} does not exist. Hours ending at ${formatClock(a.endTime)} (${win}) end when the clocks jump.`;
    case 'dropped_in_gap':
      return `${when}: ${win} falls entirely in the hour skipped when clocks go forward, so nothing is open then.`;
  }
}

/**
 * The next daylight-saving changes that actually touch these hours, in words (at most `limit`, earliest first). Hours that avoid
 * the changeover hour produce nothing. Pure: `today` is passed in; an unknown zone yields no notices.
 */
export function daylightSavingNotices(
  rules: readonly AvailabilityRuleView[],
  closures: readonly AvailabilityClosureView[],
  timezone: string,
  today: string,
  options: { days?: number; limit?: number } = {},
): DaylightNotice[] {
  const days = options.days ?? 366;
  const limit = options.limit ?? 3;
  if (rules.length === 0 || !isCalendarDate(today)) return [];
  try {
    const { adjustments } = expandOwnerAvailability({ rules: rules.map(asCoreRule), exceptions: closures.map(asCoreException) }, today, addLocalDays(today, days - 1), timezone);
    const seen = new Set<string>();
    const notices: DaylightNotice[] = [];
    for (const a of [...adjustments].sort((x, y) => x.date.localeCompare(y.date) || x.startTime.localeCompare(y.startTime))) {
      const key = `${a.date}|${a.kind}|${a.startTime}|${a.endTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notices.push({ date: a.date, text: noticeText(a) });
    }
    return notices.slice(0, limit);
  } catch {
    return [];
  }
}
