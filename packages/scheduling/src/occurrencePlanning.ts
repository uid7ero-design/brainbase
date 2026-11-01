import { bookingRefusal, type BookingRefusal, type BookingRefusalCode } from './bookingErrors';
import type { NewOccurrenceInput } from './persistence';
import { addLocalDays, localDayOfWeek } from './availabilityRules';
import { resolveLocalTime } from './time';
import type { IanaTimezone, LocalDate, LocalTime, OccurrenceStatus, Recurrence } from './types';
import { isIanaTimezone, isLocalDate, isLocalTime, validateRecurrence } from './validation';

// Phase 2C.1: planning dated occurrences from a weekly recurrence. Pure: it reads its arguments only (no clock, no database, no host), returns values, and writes
// nothing. A host turns the plan into rows; the database's slot unique key (organisation, offering, local date, local start time) makes inserting a plan twice harmless.
//
// RULES
//  1. The local date and wall-clock start are the source of truth. Instants are derived through resolveLocalTime, in the offering's pinned zone, so 18:00 stays
//     18:00 across a daylight-saving change while its UTC hour moves.
//  2. Daylight saving. A start time that does not exist (spring forward) is SKIPPED and reported ('nonexistent_local_time'); it is never shifted, because a
//     class advertised at 02:30 that quietly runs at 03:30 is a surprise to the people booked on it. A start time that happens twice (fall back) uses the EARLIER
//     instant and is flagged `ambiguous` so staff can see it. The end is start + duration in real elapsed minutes: a 60-minute class is 60 real minutes.
//  3. Idempotent. The plan depends only on its arguments. Every slot in `existing` (ANY status, including cancelled) is left alone, so planning again after a
//     plan was written returns nothing to create, and a CANCELLED occurrence is never regenerated.
//  4. Bounded. The look-ahead is at most MAX_HORIZON_WEEKS and the output at most `maxOccurrences`; when the cap bites, `truncated` is true and the EARLIEST dates
//     are kept, so a later run continues exactly where this one stopped.
//  5. Deterministic order: by local date, then start time.

/** Provisional defaults (approved as defaults, to be reconfirmed): eight weeks ahead, at most 500 occurrences per run. */
export const DEFAULT_HORIZON_WEEKS = 8;
export const DEFAULT_MAX_OCCURRENCES_PER_RUN = 500;
export const MAX_HORIZON_WEEKS = 26;
export const MAX_OCCURRENCES_HARD_LIMIT = 2000;

export interface OccurrenceOffering {
  id: string;
  archivedAt: string | null;
  durationMinutes: number | null;
  /** Headcount for each generated occurrence. */
  capacity: number | null;
  recurrence: Recurrence;
  /** Wall-clock start of each occurrence. */
  startTime: LocalTime | null;
}

export interface ExistingOccurrenceSlot {
  date: LocalDate;
  startTime: LocalTime;
  /** Any status counts as taken: a cancelled occurrence stays cancelled. */
  status?: OccurrenceStatus;
}

export type OccurrenceSkipReason = 'already_exists' | 'cancelled_stays_cancelled' | 'nonexistent_local_time';

export interface SkippedOccurrence {
  date: LocalDate;
  startTime: LocalTime;
  reason: OccurrenceSkipReason;
}

export interface PlannedOccurrence extends NewOccurrenceInput {
  /** The wall-clock start happens twice on this date; the earlier instant was used. */
  ambiguous: boolean;
}

export interface PlanOccurrencesInput {
  offering: OccurrenceOffering;
  /** The offering's pinned zone. Required: there is no default. */
  timezone: IanaTimezone;
  /** Today in `timezone`. The caller supplies it; the core has no clock. */
  today: LocalDate;
  horizonWeeks?: number;
  maxOccurrences?: number;
  existing?: readonly ExistingOccurrenceSlot[];
  /** A court or room every generated occurrence holds, or null for none (an "unassigned space" occurrence). */
  resourceId?: string | null;
}

export type OccurrencePlan =
  | {
      ok: true;
      create: PlannedOccurrence[];
      skipped: SkippedOccurrence[];
      /** The cap stopped the plan early; a later run continues from the first date not planned. */
      truncated: boolean;
      /** The inclusive local date range that was considered. Null when the offering generates nothing (no recurrence, or already ended). */
      window: { fromDate: LocalDate; toDate: LocalDate } | null;
    }
  | { ok: false; refusal: BookingRefusal; problems: string[] };

const fail = (code: BookingRefusalCode, problems: string[]): OccurrencePlan => ({
  ok: false,
  refusal: bookingRefusal(code, problems[0] ?? code),
  problems,
});

/** The first date on or after `from` that falls on `dayOfWeek`. */
function firstOnOrAfter(from: LocalDate, dayOfWeek: number): LocalDate {
  const delta = (dayOfWeek - localDayOfWeek(from) + 7) % 7;
  return addLocalDays(from, delta);
}

const slotKey = (date: LocalDate, time: LocalTime) => `${date}|${time}`;

export function planOccurrences(input: PlanOccurrencesInput): OccurrencePlan {
  const { offering, timezone, today } = input;
  const problems: string[] = [];
  if (!isIanaTimezone(timezone)) problems.push('timezone must be a valid IANA zone');
  if (!isLocalDate(today)) problems.push('today must be a valid date');
  const horizonWeeks = input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS;
  if (!Number.isInteger(horizonWeeks) || horizonWeeks < 1 || horizonWeeks > MAX_HORIZON_WEEKS) problems.push(`horizonWeeks must be a whole number from 1 to ${MAX_HORIZON_WEEKS}`);
  const cap = input.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES_PER_RUN;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_OCCURRENCES_HARD_LIMIT) problems.push(`maxOccurrences must be a whole number from 1 to ${MAX_OCCURRENCES_HARD_LIMIT}`);
  if (problems.length > 0) return fail('invalid_request', problems);

  if (offering.archivedAt !== null) return fail('offering_unavailable', ['the offering is archived']);
  const recurrence = offering.recurrence;
  if (recurrence.kind === 'none') return { ok: true, create: [], skipped: [], truncated: false, window: null };

  const recurrenceProblems = validateRecurrence(recurrence);
  if (recurrenceProblems.length > 0) return fail('invalid_recurrence', recurrenceProblems);
  if (!offering.startTime || !isLocalTime(offering.startTime)) return fail('invalid_recurrence', ['a recurring offering needs a start time']);
  if (offering.durationMinutes === null || !Number.isInteger(offering.durationMinutes) || offering.durationMinutes < 1 || offering.durationMinutes > 24 * 60) {
    return fail('invalid_recurrence', ['a recurring offering needs a duration of 1 to 1440 minutes']);
  }
  if (offering.capacity === null || !Number.isInteger(offering.capacity) || offering.capacity < 1) return fail('invalid_recurrence', ['a recurring offering needs a capacity of at least 1']);

  // The considered window: from today (or the series start, if later) for `horizonWeeks`, clipped by the series end.
  const horizonEnd = addLocalDays(today, horizonWeeks * 7 - 1);
  const seriesStart = recurrence.startDate;
  const fromDate = seriesStart !== null && seriesStart > today ? seriesStart : today;
  let toDate = horizonEnd;
  if (recurrence.end.mode === 'on_date' && recurrence.end.date < toDate) toDate = recurrence.end.date;
  if (toDate < fromDate) return { ok: true, create: [], skipped: [], truncated: false, window: null };

  // after_occurrences counts from the series start (validateRecurrence guarantees one): the Nth date counted from there is the last.
  if (recurrence.end.mode === 'after_occurrences' && seriesStart !== null) {
    const lastAllowed = addLocalDays(firstOnOrAfter(seriesStart, recurrence.dayOfWeek), (recurrence.end.count - 1) * 7);
    if (lastAllowed < toDate) toDate = lastAllowed;
    if (toDate < fromDate) return { ok: true, create: [], skipped: [], truncated: false, window: null };
  }

  const taken = new Map<string, OccurrenceStatus | undefined>();
  for (const e of input.existing ?? []) taken.set(slotKey(e.date, e.startTime), e.status);

  const create: PlannedOccurrence[] = [];
  const skipped: SkippedOccurrence[] = [];
  let truncated = false;
  const startTime = offering.startTime;
  const durationMs = offering.durationMinutes * 60_000;

  for (let date = firstOnOrAfter(fromDate, recurrence.dayOfWeek); date <= toDate; date = addLocalDays(date, 7)) {
    const key = slotKey(date, startTime);
    if (taken.has(key)) {
      skipped.push({ date, startTime, reason: taken.get(key) === 'cancelled' ? 'cancelled_stays_cancelled' : 'already_exists' });
      continue;
    }
    const start = resolveLocalTime(date, startTime, timezone);
    if (start.kind === 'gap') {
      skipped.push({ date, startTime, reason: 'nonexistent_local_time' });
      continue;
    }
    if (create.length >= cap) {
      truncated = true;
      break;
    }
    const startMs = Date.parse(start.instant);
    create.push({
      offeringId: offering.id,
      resourceId: input.resourceId ?? null,
      date,
      startTime,
      timezone,
      startsAt: start.instant,
      endsAt: new Date(startMs + durationMs).toISOString().replace('.000Z', 'Z'),
      capacity: offering.capacity,
      ambiguous: start.kind === 'ambiguous',
    });
  }
  return { ok: true, create, skipped, truncated, window: { fromDate, toDate } };
}
