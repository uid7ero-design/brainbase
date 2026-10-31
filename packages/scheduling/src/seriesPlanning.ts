import { bookingRefusal, type BookingRefusal } from './bookingErrors';
import type { LocalDate, LocalTime, OccurrenceStatus, ReservationStatus } from './types';
import { isLocalDate } from './validation';

// Phase 2C.1: which occurrences a customer's standing enrolment (a series) should be enrolled on. Pure: no clock, no database.
//
// A series is a customer's standing place in a recurring class (scheduling_series); the offering's own recurrence generates the occurrences
// (planOccurrences). This function decides, for the occurrences that already exist, which still need a reservation for the series.
//
// RULES
//  1. Only an ACTIVE series enrols. An ended or cancelled series enrols nothing.
//  2. Only occurrences that are still open ('scheduled') and not in the past (local date on or after `today`) are enrolled.
//  3. A pause is an inclusive local date range; an occurrence whose local date falls inside one is not enrolled.
//  4. A date the series already holds a LIVE reservation for is left alone (idempotent re-planning creates nothing).
//  5. A date the series holds a CANCELLED reservation for is a deliberate skip and STAYS skipped. The database's duplicate guards ignore cancelled rows, so without this
//     rule a top-up would quietly re-enrol a date a manager had skipped. This rule is the application half of that protection (migration 037 proposes the database half).
//  6. Bounded, deterministic (by date, then start time), earliest first; `truncated` says the cap bit.

export const DEFAULT_MAX_ENROLMENTS_PER_RUN = 100;

export interface SeriesForPlanning {
  id: string;
  status: 'active' | 'ended' | 'cancelled';
}

export interface OccurrenceForSeries {
  id: string;
  date: LocalDate;
  startTime: LocalTime;
  status: OccurrenceStatus;
}

export interface SeriesPauseWindow {
  pauseFrom: LocalDate;
  pauseUntil: LocalDate;
}

export interface SeriesReservationRef {
  occurrenceId: string;
  status: ReservationStatus;
}

export type SeriesSkipReason = 'series_not_active' | 'occurrence_closed' | 'in_the_past' | 'paused' | 'already_enrolled' | 'previously_skipped';

export interface SeriesEnrolmentPlan {
  ok: true;
  enrol: Array<{ occurrenceId: string; date: LocalDate; startTime: LocalTime }>;
  skipped: Array<{ occurrenceId: string; date: LocalDate; reason: SeriesSkipReason }>;
  truncated: boolean;
}

export interface PlanSeriesInput {
  series: SeriesForPlanning;
  occurrences: readonly OccurrenceForSeries[];
  pauses: readonly SeriesPauseWindow[];
  /** Every reservation this series already has, whatever its status. */
  reservations: readonly SeriesReservationRef[];
  today: LocalDate;
  maxEnrolments?: number;
}

/** The refusal a host reports when a single skipped date is requested explicitly (as opposed to being passed over by the planner). */
export const seriesDateSkippedRefusal = (): BookingRefusal => bookingRefusal('series_date_skipped', 'this date was skipped for the series and is not enrolled again automatically');

export function planSeriesEnrolments(input: PlanSeriesInput): SeriesEnrolmentPlan | { ok: false; refusal: BookingRefusal } {
  if (!isLocalDate(input.today)) return { ok: false, refusal: bookingRefusal('invalid_request', 'today must be a valid date') };
  const cap = input.maxEnrolments ?? DEFAULT_MAX_ENROLMENTS_PER_RUN;
  if (!Number.isInteger(cap) || cap < 1) return { ok: false, refusal: bookingRefusal('invalid_request', 'maxEnrolments must be a whole number of at least 1') };
  for (const p of input.pauses) {
    if (!isLocalDate(p.pauseFrom) || !isLocalDate(p.pauseUntil) || p.pauseUntil < p.pauseFrom) return { ok: false, refusal: bookingRefusal('invalid_request', 'a pause needs valid dates with the end not before the start') };
  }

  const live = new Set<string>();
  const skippedBefore = new Set<string>();
  for (const r of input.reservations) {
    if (r.status === 'cancelled') skippedBefore.add(r.occurrenceId);
    else live.add(r.occurrenceId);
  }

  const ordered = [...input.occurrences].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.id < b.id ? -1 : 1));
  const enrol: SeriesEnrolmentPlan['enrol'] = [];
  const skipped: SeriesEnrolmentPlan['skipped'] = [];
  let truncated = false;
  for (const o of ordered) {
    const skip = (reason: SeriesSkipReason) => skipped.push({ occurrenceId: o.id, date: o.date, reason });
    if (input.series.status !== 'active') skip('series_not_active');
    else if (o.status !== 'scheduled') skip('occurrence_closed');
    else if (o.date < input.today) skip('in_the_past');
    else if (input.pauses.some(p => p.pauseFrom <= o.date && o.date <= p.pauseUntil)) skip('paused');
    else if (live.has(o.id)) skip('already_enrolled');
    else if (skippedBefore.has(o.id)) skip('previously_skipped');
    else if (enrol.length >= cap) {
      truncated = true;
      break;
    } else enrol.push({ occurrenceId: o.id, date: o.date, startTime: o.startTime });
  }
  return { ok: true, enrol, skipped, truncated };
}
