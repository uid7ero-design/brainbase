import type { TenantContext } from './contracts';
import { bookingRefusal, type BookingRefusalCode } from './bookingErrors';
import { isLocalDate, isLocalTime, normaliseEmail } from './validation';
import type { LocalDate, LocalTime, Reservation } from './types';

// Phase 2C.3a: the contract of a STAFF FACILITY HIRE. Pure data and pure functions, no I/O: a standalone host implements `HireRepository` over its own database.
//
// WHAT A HIRE IS. One reservation of one linked, active resource, for the offering's configured duration, starting on a time the shared availability engine offers, created
// together with its exclusive hold. Nothing here is a route, a screen or a feature flag: those are 2C.3b and later and are host code.
//
// THREE WAYS A CALL CAN END, and a caller must never confuse them:
//   * `ok: true`            the reservation exists (created now, or an earlier call with the same key and the same request created it: `replayed`).
//   * a DEFINITE failure    nothing was written. `family` says whether the request was wrong ('invalid'), the answer is "no" ('refusal'), or the database was busy ('transient':
//                           nothing was decided; the same request may be repeated).
//   * `outcome_unknown`     the connection failed after the write was sent, so the booking may or may not exist. It is NEVER reported as "failed" or "unavailable". The caller asks
//                           again with the SAME idempotency key (or reads by key): that is the only thing that distinguishes the two possibilities.

/** A key is generated once per form and kept across retries. 16-80 characters of [A-Za-z0-9_-]; unique per organisation, so two organisations may reuse a value. */
export const HIRE_KEY_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
export const HIRE_NAME_MAX = 120;
export const HIRE_PHONE_MAX = 32;
export const HIRE_EMAIL_MAX = 254;
export const HIRE_NOTES_MAX = 1000;
export const HIRE_PARTY_MAX = 1000;

/**
 * What the booking decision was made on. Opaque to a caller: read it, hand it back. The four values are exactly the four things the database checks at commit
 * (docs/architecture/scheduling-phase2c-availability-at-commit.md and scheduling-phase2c3-offering-config-at-commit.md); if any has moved the booking is refused.
 */
export interface HireBasis {
  /** Availability version of the offering (rules, closures, links, archive state move it). */
  offeringVersion: string;
  /** Availability version of the resource. */
  resourceVersion: string;
  /** The offering's edit token (duration, price, capacity, name, ... : any edit moves it). */
  offeringToken: string;
  /** The schedule's edit token (preset, zone, cancellation policy, name ... : any edit moves it). */
  scheduleToken: string;
}

export interface HireRequest {
  /** Required: this is what makes a retry and a lost response safe. See HIRE_KEY_PATTERN. */
  idempotencyKey: string;
  offeringId: string;
  resourceId: string;
  /** Wall-clock start in the offering's pinned zone. Instants are derived by the repository (a DST gap is refused; an ambiguous time takes the earlier instant). */
  start: { date: LocalDate; time: LocalTime };
  /** Optional. When present it must equal the offering's configured duration: there is no manual duration override. */
  durationMinutes?: number;
  /** Optional spacing of the start-time grid; defaults to the duration. Must divide the duration and be at least 5: it can only refine the calendar's grid, never leave it. */
  stepMinutes?: number;
  partySize: number;
  customer: { name: string; email?: string | null; phone?: string | null };
  notes?: string | null;
  /** Optional. What the staff member saw. When it differs from the database now, the call is refused with `availability_changed` and a fresh basis. */
  basis?: HireBasis | null;
}

export const HIRE_FAILURE_CODES = [
  // the request is wrong (never retried)
  'validation',
  'duration_not_allowed',
  'preset_not_supported',
  'nonexistent_local_time',
  'resource_not_eligible',
  'idempotency_conflict',
  'not_found',
  // the answer is no (nothing wrong; offer other times)
  'offering_unavailable',
  'resource_inactive',
  'outside_availability',
  'off_grid',
  'in_the_past',
  'resource_conflict',
  'party_exceeds_resource',
  'availability_changed',
  // nothing was decided
  'contention_timeout',
  // may or may not have been written
  'outcome_unknown',
] as const;
export type HireFailureCode = (typeof HIRE_FAILURE_CODES)[number];
export type HireFailureFamily = 'invalid' | 'refusal' | 'transient' | 'unknown';

const FAMILY: Readonly<Record<HireFailureCode, HireFailureFamily>> = {
  validation: 'invalid',
  duration_not_allowed: 'invalid',
  preset_not_supported: 'invalid',
  nonexistent_local_time: 'invalid',
  resource_not_eligible: 'invalid',
  idempotency_conflict: 'invalid',
  not_found: 'invalid',
  offering_unavailable: 'refusal',
  resource_inactive: 'refusal',
  outside_availability: 'refusal',
  off_grid: 'refusal',
  in_the_past: 'refusal',
  resource_conflict: 'refusal',
  party_exceeds_resource: 'refusal',
  availability_changed: 'refusal',
  contention_timeout: 'transient',
  outcome_unknown: 'unknown',
};

export interface HireFailure {
  ok: false;
  code: HireFailureCode;
  family: HireFailureFamily;
  /** True when repeating the SAME request (same key) is the right next step: a busy database, or an unknown outcome. Never true for a refusal. */
  retryable: boolean;
  /** Safe to show staff: built from times, ids and counts, never from customer details. */
  message: string;
  /** Fields that failed validation (`validation` only). Names only, never values. */
  problems?: string[];
  /** The database's state now, for `availability_changed`: re-read the offered times and submit again with it. */
  basis?: HireBasis;
  /** How many times the repository tried (1 unless a lock wait timed out and it retried). */
  attempts?: number;
}

export interface HireCreated {
  ok: true;
  reservation: Reservation;
  /** True when this call found a reservation an earlier call with the same key had already created (nothing was written now). */
  replayed: boolean;
  /** True when the first attempt's outcome was unknown and a read by key then showed the booking had committed. */
  recovered?: boolean;
  attempts?: number;
}

export type HireResult = HireCreated | HireFailure;

export function hireFailure(code: HireFailureCode, message: string, extra: Partial<Pick<HireFailure, 'problems' | 'basis' | 'attempts'>> = {}): HireFailure {
  return { ok: false, code, family: FAMILY[code], retryable: code === 'contention_timeout' || code === 'outcome_unknown', message, ...extra };
}

/** Maps the answer of the pure booking evaluator (`evaluateSlotBooking`) onto the stable hire vocabulary. */
export function hireFailureFromRefusal(code: BookingRefusalCode, message: string): HireFailure {
  switch (code) {
    case 'preset_not_supported':
    case 'nonexistent_local_time':
    case 'offering_unavailable':
    case 'resource_inactive':
    case 'outside_availability':
    case 'off_grid':
    case 'in_the_past':
    case 'resource_conflict':
    case 'party_exceeds_resource':
    case 'resource_not_eligible':
      return hireFailure(code, message);
    case 'resource_required':
      return hireFailure('resource_not_eligible', message);
    case 'timezone_changed': // the owner's zone moved since the hours were written: the hours must be re-read
      return hireFailure('availability_changed', message);
    default:
      return hireFailure('validation', bookingRefusal(code, message).message, { problems: ['request'] });
  }
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_SHAPE = /^[0-9+()\-.\s]{3,32}$/;
const ID_SHAPE = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Field names that are wrong, or []. Values are never echoed. */
export function validateHireRequest(request: HireRequest): string[] {
  const problems: string[] = [];
  const bad = (field: string) => problems.push(field);
  if (typeof request.idempotencyKey !== 'string' || !HIRE_KEY_PATTERN.test(request.idempotencyKey)) bad('idempotencyKey');
  if (typeof request.offeringId !== 'string' || !ID_SHAPE.test(request.offeringId)) bad('offeringId');
  if (typeof request.resourceId !== 'string' || !ID_SHAPE.test(request.resourceId)) bad('resourceId');
  if (!request.start || !isLocalDate(request.start.date)) bad('start.date');
  if (!request.start || !isLocalTime(request.start.time)) bad('start.time');
  if (request.durationMinutes !== undefined && (!Number.isInteger(request.durationMinutes) || request.durationMinutes < 1 || request.durationMinutes > 24 * 60)) bad('durationMinutes');
  if (request.stepMinutes !== undefined && (!Number.isInteger(request.stepMinutes) || request.stepMinutes < 5 || request.stepMinutes > 24 * 60)) bad('stepMinutes');
  if (!Number.isInteger(request.partySize) || request.partySize < 1 || request.partySize > HIRE_PARTY_MAX) bad('partySize');
  const customer = request.customer;
  const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
  if (name === '' || name.length > HIRE_NAME_MAX || CONTROL.test(name)) bad('customer.name');
  const email = customer?.email;
  if (email !== undefined && email !== null) {
    const normalised = typeof email === 'string' ? normaliseEmail(email) : null;
    if (normalised === null || normalised.length > HIRE_EMAIL_MAX || !EMAIL_SHAPE.test(normalised) || CONTROL.test(normalised)) bad('customer.email');
  }
  const phone = customer?.phone;
  if (phone !== undefined && phone !== null && (typeof phone !== 'string' || !PHONE_SHAPE.test(phone.trim()) || !/[0-9]/.test(phone))) bad('customer.phone');
  const notes = request.notes;
  if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > HIRE_NOTES_MAX || CONTROL.test(notes))) bad('notes');
  const basis = request.basis;
  if (basis !== undefined && basis !== null) {
    for (const k of ['offeringVersion', 'resourceVersion', 'offeringToken', 'scheduleToken'] as const) if (typeof basis[k] !== 'string' || basis[k].length === 0 || basis[k].length > 64) bad(`basis.${k}`);
  }
  return problems;
}

/** The request as it will be stored: trimmed and normalised, with absent optional fields made explicit. */
export interface NormalisedHireCustomer {
  name: string;
  email: string | null;
  emailNormalised: string | null;
  phone: string | null;
  notes: string | null;
}
export function normaliseHireCustomer(request: Pick<HireRequest, 'customer' | 'notes'>): NormalisedHireCustomer {
  const email = request.customer.email ?? null;
  const phone = request.customer.phone ?? null;
  const notes = request.notes ?? null;
  return {
    name: request.customer.name.trim(),
    email: email === null ? null : email.trim(),
    emailNormalised: normaliseEmail(email),
    phone: phone === null ? null : phone.trim(),
    notes: notes === null || notes.trim() === '' ? null : notes,
  };
}

/**
 * Does an existing reservation (found by the idempotency key) answer THIS request? Compares everything the caller chose: offering, resource, local start, party size, customer
 * details and notes, and the duration only when the caller stated one. The comparison is on what was STORED, so a retry still matches after the offering's duration or name has
 * since been edited. A different request under the same key is an `idempotency_conflict`, never a second booking.
 */
export function hireRequestMatches(existing: Reservation, request: HireRequest): boolean {
  const customer = normaliseHireCustomer(request);
  if (existing.offeringId !== request.offeringId || existing.resourceId !== request.resourceId) return false;
  if (existing.span.kind !== 'slot' || existing.span.date !== request.start.date || existing.span.startTime !== request.start.time) return false;
  if (request.durationMinutes !== undefined && existing.span.durationMinutes !== request.durationMinutes) return false;
  if (existing.partySize !== request.partySize) return false;
  const snap = existing.customerSnapshot;
  return snap.displayName === customer.name && snap.emailNormalised === customer.emailNormalised && (snap.phone ?? null) === customer.phone && (existing.notes ?? null) === customer.notes;
}

/** Equality of two bases, for the "what you saw is no longer true" check. */
export const sameHireBasis = (a: HireBasis, b: HireBasis): boolean =>
  a.offeringVersion === b.offeringVersion && a.resourceVersion === b.resourceVersion && a.offeringToken === b.offeringToken && a.scheduleToken === b.scheduleToken;

/** Thrown (never returned) when the database does not have what a hire needs, e.g. migration 037 is missing. Nothing was written; the host answers 503. */
export class HireNotReadyError extends Error {
  constructor(message = 'booking integrity (migration 037) is not available in this database') {
    super(message);
    this.name = 'HireNotReadyError';
  }
}

/** What a standalone host implements. Postgres is one implementation (`PostgresHireRepository`). */
export interface HireRepository {
  /** Needs `scheduling.reserve` and `scheduling.view` as staff; anything else throws `permission_denied`. */
  createHire(tenant: TenantContext, request: HireRequest): Promise<HireResult>;
  /** Resolution of an unknown outcome: the reservation created under this key in this organisation, or null. */
  findHireByKey(tenant: TenantContext, idempotencyKey: string): Promise<Reservation | null>;
  /** The state a booking decision would be based on now (a form hands it back). Null when the offering or the resource is missing in this organisation. */
  readHireBasis(tenant: TenantContext, offeringId: string, resourceId: string): Promise<HireBasis | null>;
}
