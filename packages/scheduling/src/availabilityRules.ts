import type { AvailabilityException, AvailabilityRule, LocalDate, LocalTime } from './types';
import { isLocalDate, isLocalTime, minutesOfDay, validateAvailabilityRule } from './validation';

// Phase 2B.3a: validation of availability rules and exceptions as SETS, plus the small date helpers and the overnight splitter the
// availability computation (availability.ts) builds on. Pure: no I/O, no clock, no database.
//
// Reused, not replaced: validateAvailabilityRule (validation.ts) still checks each rule on its own and isLocalTime still rejects
// '24:00'. This file adds only what a single-rule check cannot see: overlaps, ownership, exceptions, and the end-of-day sentinel.
//
// END OF DAY. A window is a half-open [start, end) inside ONE local day, so "open until midnight" needs an end that is not a valid
// HH:MM. '24:00' is that end, accepted only by the availability validators in this file (PostgreSQL's `time` and the table's
// end_time > start_time check already allow it, so no SQL change is needed). Cross-midnight opening is stored as two rules, one
// ending at '24:00' and one starting at '00:00' on the next weekday; splitOvernightRule builds the pair and the computation merges
// them back into one continuous instant interval.

export const END_OF_DAY = '24:00' as const;
export type WindowEnd = LocalTime | typeof END_OF_DAY;

/** A local wall-clock window on one day, half-open [startTime, endTime). */
export interface LocalWindow {
  startTime: LocalTime;
  endTime: WindowEnd;
}

/**
 * An exception to the weekly rules for one owner, over inclusive local dates.
 *   closed   - no availability on those dates (wins over any override covering the same date). A closure WITHOUT windows closes the
 *              whole day; a closure WITH windows is a PARTIAL-DAY closure: only those local times are removed on those dates
 *              (Phase 2B.3c; migration 035 stores the one window of a stored row as start_time/end_time).
 *   override - the owner's weekly rules are REPLACED on those dates by `windows`.
 * The stored override has no hours, so `windows` is the core's addition: an override without windows is refused by
 * validateAvailabilityException and, if one reaches the computation anyway, is treated as closed (fail closed).
 */
export type AvailabilityExceptionInput = AvailabilityException & { windows?: readonly LocalWindow[] | null };

export const AVAILABILITY_WEEKDAYS = 7;

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday, the same numbering as AvailabilityRule.dayOfWeek and Date.getDay(). */
export function localDayOfWeek(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function windowEndMinutes(end: WindowEnd): number {
  return end === END_OF_DAY ? 24 * 60 : minutesOfDay(end);
}

export function validateLocalWindow(w: LocalWindow): string[] {
  const problems: string[] = [];
  if (!isLocalTime(w.startTime)) problems.push('startTime must be HH:MM');
  if (w.endTime !== END_OF_DAY && !isLocalTime(w.endTime)) problems.push('endTime must be HH:MM or 24:00');
  if (problems.length === 0 && windowEndMinutes(w.endTime) <= minutesOfDay(w.startTime)) problems.push('endTime must be after startTime');
  return problems;
}

const ownerKey = (e: { resourceId: string | null; offeringId: string | null }) => (e.resourceId !== null ? `resource:${e.resourceId}` : `offering:${e.offeringId}`);
const hasOneOwner = (e: { resourceId: string | null; offeringId: string | null }) => (e.resourceId === null) !== (e.offeringId === null);

/** One rule on its own: validateAvailabilityRule, plus the '24:00' end and exclusive ownership. */
export function validateAvailabilityRuleForSet(r: AvailabilityRule): string[] {
  const problems: string[] = [];
  if (r.endTime === END_OF_DAY) {
    if (!isLocalTime(r.startTime)) problems.push('startTime must be HH:MM');
    // Every other check of the established validator still applies; the times are substituted only so that it does not reject '24:00'.
    problems.push(...validateAvailabilityRule({ ...r, startTime: '00:00', endTime: '23:59' }));
  } else {
    problems.push(...validateAvailabilityRule(r));
  }
  if (r.resourceId !== null && r.offeringId !== null) problems.push('a rule must belong to exactly one owner: a resource or an offering');
  return problems;
}

const spansOverlap = (aFrom: string | null, aTo: string | null, bFrom: string | null, bTo: string | null) =>
  (aFrom ?? '0000-00-00') <= (bTo ?? '9999-99-99') && (bFrom ?? '0000-00-00') <= (aTo ?? '9999-99-99');

/**
 * A set of rules. Beyond each rule's own validity: ids are unique, and two rules of the same owner may not overlap (same weekday,
 * overlapping [start, end) and overlapping validity dates). Rules that merely touch (09:00-12:00 and 12:00-17:00) are allowed.
 */
export function validateAvailabilityRuleSet(rules: readonly AvailabilityRule[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const valid: AvailabilityRule[] = [];
  for (const r of rules) {
    if (seen.has(r.id)) problems.push(`rule ${r.id}: duplicate id`);
    seen.add(r.id);
    const own = validateAvailabilityRuleForSet(r);
    for (const p of own) problems.push(`rule ${r.id}: ${p}`);
    if (own.length === 0) valid.push(r);
  }
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      if (ownerKey(a) !== ownerKey(b) || a.dayOfWeek !== b.dayOfWeek) continue;
      if (!spansOverlap(a.validFrom, a.validTo, b.validFrom, b.validTo)) continue;
      if (minutesOfDay(a.startTime) < windowEndMinutes(b.endTime) && minutesOfDay(b.startTime) < windowEndMinutes(a.endTime)) {
        problems.push(`rules ${a.id} and ${b.id} overlap on weekday ${a.dayOfWeek}`);
      }
    }
  }
  return problems;
}

const windowsOverlap = (a: LocalWindow, b: LocalWindow) => minutesOfDay(a.startTime) < windowEndMinutes(b.endTime) && minutesOfDay(b.startTime) < windowEndMinutes(a.endTime);

/** Do two closures' time ranges overlap? A closure with no windows covers the whole day, so it overlaps every other closure on a shared date. */
function closureWindowsOverlap(a: readonly LocalWindow[] | null | undefined, b: readonly LocalWindow[] | null | undefined): boolean {
  if (!a || a.length === 0 || !b || b.length === 0) return true;
  return a.some(x => b.some(y => windowsOverlap(x, y)));
}

export function validateAvailabilityException(e: AvailabilityExceptionInput): string[] {
  const problems: string[] = [];
  if (!isLocalDate(e.fromDate)) problems.push('fromDate must be a valid date');
  if (!isLocalDate(e.toDate)) problems.push('toDate must be a valid date');
  if (isLocalDate(e.fromDate) && isLocalDate(e.toDate) && e.toDate < e.fromDate) problems.push('toDate must not be before fromDate');
  if (!hasOneOwner(e)) problems.push('an exception must belong to exactly one owner: a resource or an offering');
  if (e.kind !== 'closed' && e.kind !== 'override') problems.push("kind must be 'closed' or 'override'");
  const windows = e.windows ?? [];
  if (e.kind === 'override' && windows.length === 0) problems.push('an override must define at least one window (an override with no hours would silently mean closed)');
  // A closure's windows are a partial-day closure; an override's are its opening hours. Either way each must be a real window and they may not overlap.
  const ok: LocalWindow[] = [];
  windows.forEach((w, i) => {
    const own = validateLocalWindow(w);
    for (const p of own) problems.push(`window ${i + 1}: ${p}`);
    if (own.length === 0) ok.push(w);
  });
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      if (windowsOverlap(ok[i], ok[j])) problems.push(`windows ${i + 1} and ${j + 1} overlap`);
    }
  }
  return problems;
}

/**
 * A set of exceptions. Two exceptions of the same owner and the same kind may not cover a common date. A closure inside an override
 * range is allowed (closed wins), so "open longer hours over the holidays, except Christmas Day" can be expressed.
 */
export function validateAvailabilityExceptionSet(exceptions: readonly AvailabilityExceptionInput[]): string[] {
  const problems: string[] = [];
  const valid: Array<{ index: number; e: AvailabilityExceptionInput }> = [];
  exceptions.forEach((e, index) => {
    const own = validateAvailabilityException(e);
    for (const p of own) problems.push(`exception ${e.id}: ${p}`);
    if (own.length === 0) valid.push({ index, e });
  });
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i].e;
      const b = valid[j].e;
      if (ownerKey(a) !== ownerKey(b) || a.kind !== b.kind || !spansOverlap(a.fromDate, a.toDate, b.fromDate, b.toDate)) continue;
      // Two overrides may never share a date. Two closures may, provided they remove different times of it (a lunch break and an
      // afternoon off); a whole-day closure shares every time of its dates.
      if (a.kind !== 'closed' || closureWindowsOverlap(a.windows, b.windows)) {
        problems.push(`exceptions ${a.id} and ${b.id} are both '${a.kind}' and cover a common date`);
      }
    }
  }
  return problems;
}

/** Minutes after local midnight (0-1440) back to a window boundary: 1440 is the end-of-day sentinel '24:00'. */
export function minutesToWindowTime(minutes: number): WindowEnd {
  if (minutes >= 24 * 60) return END_OF_DAY;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` as LocalTime;
}

/** The local windows left after cutting `cuts` out of `base` (wall-clock minutes; half-open). Never returns an empty window. */
export function subtractLocalWindows(base: readonly LocalWindow[], cuts: readonly LocalWindow[]): LocalWindow[] {
  const cutRanges = cuts.map(c => ({ s: minutesOfDay(c.startTime), e: windowEndMinutes(c.endTime) })).sort((x, y) => x.s - y.s || x.e - y.e);
  const out: LocalWindow[] = [];
  for (const w of base) {
    let s = minutesOfDay(w.startTime);
    const e = windowEndMinutes(w.endTime);
    for (const c of cutRanges) {
      if (c.e <= s) continue;
      if (c.s >= e) break;
      if (c.s > s) out.push({ startTime: minutesToWindowTime(s) as LocalTime, endTime: minutesToWindowTime(c.s) });
      s = Math.max(s, c.e);
      if (s >= e) break;
    }
    if (s < e) out.push({ startTime: minutesToWindowTime(s) as LocalTime, endTime: minutesToWindowTime(e) });
  }
  return out;
}

export type OvernightRuleShape = Pick<AvailabilityRule, 'dayOfWeek' | 'startTime' | 'validFrom' | 'validTo'> & { endTime: LocalTime };

/**
 * Splits a rule written as "Friday 22:00 to 02:00" (end at or before the start) into the two storable single-day rules: Friday
 * 22:00-24:00 and Saturday 00:00-02:00. The second part's validity dates move forward one day with it. A rule whose end is after
 * its start is returned unchanged; an end of '00:00' means "until midnight" and yields the single rule start-24:00.
 */
export function splitOvernightRule(rule: OvernightRuleShape): Array<Pick<AvailabilityRule, 'dayOfWeek' | 'startTime' | 'validFrom' | 'validTo'> & { endTime: WindowEnd }> {
  if (!isLocalTime(rule.startTime) || !isLocalTime(rule.endTime)) throw new Error('startTime and endTime must be HH:MM');
  if (!Number.isInteger(rule.dayOfWeek) || rule.dayOfWeek < 0 || rule.dayOfWeek > 6) throw new Error('dayOfWeek must be 0-6');
  const start = minutesOfDay(rule.startTime);
  const end = minutesOfDay(rule.endTime);
  if (end > start) return [{ ...rule }];
  if (end === 0) return [{ ...rule, endTime: END_OF_DAY }];
  const shift = (d: LocalDate | null) => (d === null ? null : addLocalDays(d, 1));
  return [
    { dayOfWeek: rule.dayOfWeek, startTime: rule.startTime, endTime: END_OF_DAY, validFrom: rule.validFrom, validTo: rule.validTo },
    { dayOfWeek: (rule.dayOfWeek + 1) % AVAILABILITY_WEEKDAYS, startTime: '00:00', endTime: rule.endTime, validFrom: shift(rule.validFrom), validTo: shift(rule.validTo) },
  ];
}
