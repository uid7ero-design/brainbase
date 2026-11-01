import type { SchedulingErrorCode } from './persistence';

// Phase 2C.1: one vocabulary for "why a booking was not made". Pure data: every pure booking function in this package, and every host that maps a database
// failure, speaks these codes, so a screen or an API never has to guess from message text.
//
// Three families, kept apart on purpose because the caller reacts differently:
//   * a REFUSAL is a business answer ("that time is taken"). Nothing is wrong; the caller shows it and offers other times;
//   * a TRANSIENT failure ("contention_timeout") means nothing was decided and nothing was written; it may be repeated a bounded number of times and is NEVER
//     reported to a customer as "full" or "taken";
//   * an INVALID request is the caller's bug or tampering; it is never retried.

export const BOOKING_REFUSAL_CODES = [
  // invalid request
  'invalid_request',
  'invalid_recurrence',
  'preset_not_supported',
  'timezone_changed',
  // availability (the read-only computation said no)
  'offering_unavailable',
  'outside_availability',
  'off_grid',
  'in_the_past',
  'nonexistent_local_time',
  // resources
  'resource_required',
  'resource_not_eligible',
  'resource_inactive',
  'resource_conflict',
  'party_exceeds_resource',
  // headcount
  'capacity_exceeded',
  'occurrence_closed',
  'duplicate_reservation',
  // series
  'series_date_skipped',
  'series_paused',
  // not a decision at all
  'contention_timeout',
] as const;
export type BookingRefusalCode = (typeof BOOKING_REFUSAL_CODES)[number];

export type BookingRefusalFamily = 'invalid' | 'refusal' | 'transient';

const FAMILY: Readonly<Record<BookingRefusalCode, BookingRefusalFamily>> = {
  invalid_request: 'invalid',
  invalid_recurrence: 'invalid',
  preset_not_supported: 'invalid',
  timezone_changed: 'invalid',
  offering_unavailable: 'refusal',
  outside_availability: 'refusal',
  off_grid: 'refusal',
  in_the_past: 'refusal',
  nonexistent_local_time: 'invalid',
  resource_required: 'invalid',
  resource_not_eligible: 'invalid',
  resource_inactive: 'refusal',
  resource_conflict: 'refusal',
  party_exceeds_resource: 'refusal',
  capacity_exceeded: 'refusal',
  occurrence_closed: 'refusal',
  duplicate_reservation: 'refusal',
  series_date_skipped: 'refusal',
  series_paused: 'refusal',
  contention_timeout: 'transient',
};

export interface BookingRefusal {
  readonly code: BookingRefusalCode;
  readonly family: BookingRefusalFamily;
  /** Safe to show staff. Never contains customer details: refusals are built from times, ids and counts only. */
  readonly message: string;
  /** True only for a transient failure: nothing was written and the same request may be repeated (bounded by the caller). */
  readonly retryable: boolean;
}

export function bookingRefusal(code: BookingRefusalCode, message: string): BookingRefusal {
  return Object.freeze({ code, family: FAMILY[code], message, retryable: code === 'contention_timeout' });
}

export const isBookingRefusalCode = (value: unknown): value is BookingRefusalCode => typeof value === 'string' && (BOOKING_REFUSAL_CODES as readonly string[]).includes(value);

/**
 * The database layer's domain codes (SchedulingErrorCode) in booking terms. Total: every code maps, and a code added later is a compile error here until it is
 * placed in a family, so a new failure can never fall through to "unknown".
 */
export function refusalCodeFromSchedulingError(code: SchedulingErrorCode): BookingRefusalCode {
  switch (code) {
    case 'resource_conflict':
      return 'resource_conflict';
    case 'capacity_exceeded':
      return 'capacity_exceeded';
    case 'duplicate_reservation':
      return 'duplicate_reservation';
    case 'offering_unavailable':
      return 'offering_unavailable';
    case 'contention_timeout':
      return 'contention_timeout';
    case 'permission_denied':
    case 'invalid_input':
    case 'not_found':
    case 'conflict':
    case 'lifecycle_violation':
    case 'unsafe_isolation':
      return 'invalid_request';
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
