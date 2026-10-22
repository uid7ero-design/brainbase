import type { PresetKey, Recurrence, ReservationStatus } from '@scheduling/core';

// Pure translation between LD Tennis's live vocabulary (sessions /
// session_instances / bookings, as used by lib/tennisSchedule.ts and
// lib/tennisRecurrence.ts) and the scheduling core's neutral vocabulary.
//
// Phase 1 contract: this module is READ-ONLY with respect to the live system.
// It imports types only from the tennis modules (never their values, which
// would pull in the database client), it is imported by nothing in the
// running application, and the existing tables, routes and logic are
// untouched. Its job is to pin, with tests, that the legacy rules map onto
// the core without loss, so the later migration has a verified bridge.

/** LD Tennis is a classes-and-coaching business. */
export const TENNIS_PRESET_KEY: PresetKey = 'classes_coaching';

/** Shape of lib/tennisSchedule.ts ScheduleRules (declared here to avoid a runtime import). */
export interface TennisScheduleRules {
  day_of_week: number;
  start_date: string | null;
  end_mode: 'ongoing' | 'after_weeks' | 'on_date';
  end_after_weeks: number | null;
  end_date: string | null;
}

/**
 * sessions schedule-rule columns -> core Recurrence.
 *
 * Mirrors computeExpectedOccurrences(): 'after_weeks' only takes effect when
 * end_after_weeks > 0 AND a start_date exists; 'on_date' only when end_date
 * is set; anything else behaves as ongoing. The mapping reproduces that
 * effective behaviour rather than the raw column values, so a malformed
 * legacy row maps to what production actually does with it.
 */
export function tennisRulesToRecurrence(rules: TennisScheduleRules): Recurrence {
  const base = { kind: 'weekly' as const, dayOfWeek: rules.day_of_week, startDate: rules.start_date };
  if (rules.end_mode === 'after_weeks' && rules.end_after_weeks != null && rules.end_after_weeks > 0 && rules.start_date) {
    return { ...base, end: { mode: 'after_occurrences', count: rules.end_after_weeks } };
  }
  if (rules.end_mode === 'on_date' && rules.end_date) {
    return { ...base, end: { mode: 'on_date', date: rules.end_date } };
  }
  return { ...base, end: { mode: 'ongoing' } };
}

/** Inverse of tennisRulesToRecurrence for weekly series. */
export function recurrenceToTennisRules(recurrence: Recurrence): TennisScheduleRules {
  if (recurrence.kind !== 'weekly') {
    throw new Error('LD Tennis sessions are always weekly templates');
  }
  const base = { day_of_week: recurrence.dayOfWeek, start_date: recurrence.startDate };
  switch (recurrence.end.mode) {
    case 'ongoing':
      return { ...base, end_mode: 'ongoing', end_after_weeks: null, end_date: null };
    case 'after_occurrences':
      return { ...base, end_mode: 'after_weeks', end_after_weeks: recurrence.end.count, end_date: null };
    case 'on_date':
      return { ...base, end_mode: 'on_date', end_after_weeks: null, end_date: recurrence.end.date };
  }
}

/**
 * bookings.status -> core ReservationStatus.
 *
 * Statuses the codebase declares for bookings (app/admin/pipeline/page.tsx,
 * app/portal/page.tsx): 'confirmed' (dashboard enrolments), 'pending_confirmation'
 * (the column default; one-off appointment requests in app/api/bookings),
 * 'reschedule_requested' (portal appointment flow) and 'cancelled'.
 * 'reschedule_requested' has no core equivalent and returns null, as does any
 * unknown value: the mapping refuses to guess, so a legacy status the core
 * cannot represent is surfaced during a migration rather than silently
 * coerced. (bookings.attendance_status is an unconstrained client-supplied
 * string and is deliberately not mapped in Phase 1.)
 */
export function tennisBookingStatusToReservationStatus(status: string): ReservationStatus | null {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'pending_confirmation':
      return 'pending';
    case 'cancelled':
      return 'cancelled';
    default:
      return null;
  }
}
