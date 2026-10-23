import { SchedulingError } from '@scheduling/core';

// Maps Postgres errors raised by the scheduling schema onto domain errors, so callers never
// pattern-match SQLSTATEs. Unknown errors are returned untouched (the caller rethrows).
//
// Three failures are deliberately NOT business refusals:
//   55P03 lock_not_available  -> 'contention_timeout' (retryable). The 5-second lock_timeout on the
//         waiting functions fired: nothing was written, and the place or resource may well be free.
//         Reporting it as "full" or "unavailable" would turn a busy database into lost bookings.
//   40P01 deadlock_detected   -> unmapped. The schema is built so this cannot happen (per-resource
//         advisory lock, disjoint lock families); if it ever does it is a defect to surface, and a
//         generic retry would hide it.
//   40001 / 57014 / connection errors -> unmapped: outcome or cause unknown.

/** Custom SQLSTATEs raised by packages/scheduling/sql/010_shared_schema.sql. */
export const SCHEDULING_SQLSTATE = {
  capacity: 'SCCAP',
  isolation: 'SCISO',
  occurrenceClosed: 'SCCLS',
  windowMismatch: 'SCWIN',
  resourceInactive: 'SCRES',
  lifecycle: 'SCLIF',
  immutable: 'SCIMM',
  holdReactivation: 'SCREA',
  missingHold: 'SCHLD',
  /** 030_resource_concurrency.sql: a resource that is booked / linked cannot be deactivated or change kind. */
  resourceInUse: 'SCRIU',
  /** 030: a link cannot be removed while a live reservation of that offering holds the resource. */
  allocationInUse: 'SCALU',
  /** 030: a resource cannot be linked when it is inactive or its kind does not fit the offering's preset. */
  linkRefused: 'SCKND',
  /** 031: a reservation's party size does not fit the resource (capacity / minimum party). */
  partyFit: 'SCPTY',
  /** 031: the resource is not assigned to the offering (any actor). */
  notAssigned: 'SCLNK',
  /** 031: the reservation's preset is not the preset of its schedule. */
  presetMismatch: 'SCPRE',
  /** 031: the offering (or its schedule) is archived. */
  archived: 'SCARC',
  /** Raised by the migration only (an older install must be rolled back first); never at runtime. */
  staleInstall: 'SCVER',
} as const;

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
}

const asPg = (err: unknown): PgErrorLike | null => (typeof err === 'object' && err !== null ? (err as PgErrorLike) : null);

/** The SQLSTATE of a database error, or null when it is not one. */
export function sqlstateOf(err: unknown): string | null {
  const code = asPg(err)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

export function constraintOf(err: unknown): string | null {
  const c = asPg(err)?.constraint;
  return typeof c === 'string' ? c : null;
}

/**
 * True when a 55P03 is the lock_timeout expiring inside a scheduling statement. 55P03 is also what
 * NOWAIT and other lock failures raise, which this schema never issues, so those stay unmapped.
 * The server's message for a lock_timeout is "canceling statement due to lock timeout"; the
 * PL/pgSQL context ("where") names the scheduling_* function when the driver supplies it.
 */
export function isSchedulingLockTimeout(err: unknown): boolean {
  if (sqlstateOf(err) !== '55P03') return false;
  const e = asPg(err) as { message?: unknown; where?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const where = typeof e?.where === 'string' ? e.where : '';
  return /lock timeout/i.test(message) || /scheduling_/i.test(where);
}

const DUPLICATE_RESERVATION_CONSTRAINTS = new Set([
  'scheduling_reservations_dup_customer_uk',
  'scheduling_reservations_dup_email_uk',
  'scheduling_reservations_dup_series_uk',
  'scheduling_reservations_idem_uk',
]);

/**
 * Returns the SchedulingError for a database error raised by the scheduling schema, or null
 * when the error is not one this schema knows (the caller must rethrow it unchanged).
 */
export function mapPgError(err: unknown): SchedulingError | null {
  const code = sqlstateOf(err);
  if (code === null) return null;
  const constraint = constraintOf(err);
  const message = typeof asPg(err)?.message === 'string' ? (asPg(err)!.message as string) : code;
  const make = (domain: ConstructorParameters<typeof SchedulingError>[0]) => new SchedulingError(domain, message, constraint);

  switch (code) {
    case SCHEDULING_SQLSTATE.capacity:
    case SCHEDULING_SQLSTATE.partyFit:
      return make('capacity_exceeded');
    case SCHEDULING_SQLSTATE.isolation:
      return make('unsafe_isolation');
    case SCHEDULING_SQLSTATE.occurrenceClosed:
    case SCHEDULING_SQLSTATE.resourceInactive:
    case SCHEDULING_SQLSTATE.notAssigned:
    case SCHEDULING_SQLSTATE.archived:
      return make('offering_unavailable');
    case SCHEDULING_SQLSTATE.windowMismatch:
      return make('invalid_input');
    case SCHEDULING_SQLSTATE.lifecycle:
    case SCHEDULING_SQLSTATE.immutable:
    case SCHEDULING_SQLSTATE.holdReactivation:
    case SCHEDULING_SQLSTATE.missingHold:
    case SCHEDULING_SQLSTATE.resourceInUse:
    case SCHEDULING_SQLSTATE.allocationInUse:
      return make('lifecycle_violation');
    case SCHEDULING_SQLSTATE.linkRefused:
    case SCHEDULING_SQLSTATE.presetMismatch:
      return make('invalid_input');
    case '55P03': // lock_not_available: only a lock wait that timed out under OUR lock_timeout
      return isSchedulingLockTimeout(err) ? make('contention_timeout') : null;
    case '23P01': // exclusion_violation: the resource is already held for an overlapping range
      return make('resource_conflict');
    case '23505': // unique_violation
      return make(constraint !== null && DUPLICATE_RESERVATION_CONSTRAINTS.has(constraint) ? 'duplicate_reservation' : 'conflict');
    case '23503': // foreign_key_violation: missing row, or another tenant's row (indistinguishable on purpose)
      return make('not_found');
    case '23502': // not_null_violation
    case '23514': // check_violation
    case '22P02': // invalid_text_representation
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
    case '22023': // invalid_parameter_value
      return make('invalid_input');
    default:
      return null;
  }
}

/** Runs a database call and converts schema errors to SchedulingError; anything else propagates. */
export async function translating<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw mapPgError(err) ?? err;
  }
}
