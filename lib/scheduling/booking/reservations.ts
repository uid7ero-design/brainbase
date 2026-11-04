import { HireNotReadyError, SchedulingError, validateHireRequest, type HireBasis, type HireFailure, type HireFailureCode, type HireRequest, type Reservation } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { recordSchedulingAudit } from '../audit';
import { idParam, notFound, readBody } from '../config/http';

// Phase 2C.3b: the HTTP layer of STAFF FACILITY HIRE. Everything here runs INSIDE the central guard (lib/scheduling/route.ts) with feature 'staff_booking' and permission
// 'scheduling.reserve': the kill switch is on, the session's organisation holds the capability, the caller is staff with the reserve permission, and `context.tenant` is built from
// the session. Nothing in this file reads a session, a cookie or an organisation from the request, and no booking rule is decided here: the decision, the lock order and the
// atomic reservation-and-hold write are PostgresHireRepository.createHire (Phase 2C.3a), called unchanged.
//
// Contract (docs/architecture/scheduling-phase2c3-facility-hire-design.md section 5):
//   POST /api/scheduling/reservations              201 created | 200 replayed | stable { error, code } refusals
//   GET  /api/scheduling/reservations?idempotencyKey=   the reservation created under a key (the lost-response check); not a list
//   GET  /api/scheduling/reservations/{id}         one reservation
//   POST /api/scheduling/reservations/{id}/cancel  200 cancelled (also 200 when it already was)
//
// PRIVACY. Error bodies are fixed sentences per code: they never echo a request field, a customer detail or repository text. Customer details appear ONLY in the success body of a
// caller holding scheduling.reserve. The audit entry and the request log carry ids, a local window, counts and a source tag, never a name, a contact detail or a note.

const SOURCE = 'staff_form';
const BODY_FIELDS = ['offeringId', 'resourceId', 'start', 'durationMinutes', 'partySize', 'customer', 'notes', 'basis'] as const;
const START_FIELDS = ['date', 'time'] as const;
const CUSTOMER_FIELDS = ['name', 'email', 'phone'] as const;
const BASIS_FIELDS = ['offeringVersion', 'resourceVersion', 'offeringToken', 'scheduleToken'] as const;
const CANCEL_FIELDS = ['reason'] as const;
const CANCEL_REASON_MAX = 200;
const KEY_HEADER = 'idempotency-key';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const extraKeys = (o: Json, allowed: readonly string[], prefix: string): string[] => Object.keys(o).filter(k => !allowed.includes(k)).map(k => `${prefix}${k}`);

const invalid = (problems: string[]): Response => schedulingJson({ error: 'The request is not valid.', code: 'VALIDATION', problems }, { status: 400 });

// ── the stable vocabulary ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Mapped {
  status: number;
  code: string;
  error: string;
}
const FAILURES: Readonly<Record<HireFailureCode, Mapped>> = {
  validation: { status: 400, code: 'VALIDATION', error: 'The request is not valid.' },
  duration_not_allowed: { status: 422, code: 'DURATION_NOT_ALLOWED', error: 'Only the duration configured for this offering can be booked.' },
  preset_not_supported: { status: 422, code: 'OFFERING_NOT_BOOKABLE', error: 'This offering cannot be booked as a facility hire.' },
  nonexistent_local_time: { status: 422, code: 'NONEXISTENT_LOCAL_TIME', error: 'That local time does not exist on that date.' },
  resource_not_eligible: { status: 422, code: 'RESOURCE_NOT_ELIGIBLE', error: 'That resource is not offered for this offering.' },
  idempotency_conflict: { status: 409, code: 'IDEMPOTENCY_CONFLICT', error: 'This idempotency key was already used for a different booking.' },
  not_found: { status: 404, code: 'NOT_FOUND', error: 'Not found.' },
  offering_unavailable: { status: 409, code: 'OFFERING_UNAVAILABLE', error: 'This offering is not available for booking.' },
  resource_inactive: { status: 409, code: 'RESOURCE_INACTIVE', error: 'That resource is not active.' },
  outside_availability: { status: 409, code: 'OUTSIDE_AVAILABILITY', error: 'That time is outside the available hours.' },
  off_grid: { status: 409, code: 'OFF_GRID', error: 'That is not one of the start times offered.' },
  in_the_past: { status: 422, code: 'IN_THE_PAST', error: 'That time has already started or passed.' },
  resource_conflict: { status: 409, code: 'RESOURCE_CONFLICT', error: 'That resource is already booked for part of that time.' },
  party_exceeds_resource: { status: 422, code: 'PARTY_NOT_ALLOWED', error: 'The party is larger than the resource allows.' },
  availability_changed: { status: 409, code: 'AVAILABILITY_CHANGED', error: 'The available times changed. Reload them and choose again.' },
  contention_timeout: { status: 503, code: 'CONTENTION_TIMEOUT', error: 'The system was busy and nothing was booked. Please try again.' },
  outcome_unknown: { status: 504, code: 'OUTCOME_UNKNOWN', error: 'The result of this booking is not known. Repeat the request with the same idempotency key, or look the booking up by that key.' },
};

function failureResponse(failure: HireFailure): Response {
  const m = FAILURES[failure.code];
  const body: Json = { error: m.error, code: m.code };
  if (failure.code === 'validation' && failure.problems) body.problems = failure.problems; // field NAMES only (the repository never puts a value in them)
  if (failure.code === 'availability_changed' && failure.basis) body.basis = failure.basis; // the fresh version stamps, so the form can re-render without another read
  if (failure.retryable) body.retryable = true;
  const response = schedulingJson(body, { status: m.status });
  if (failure.code === 'contention_timeout') response.headers.set('Retry-After', '1');
  return response;
}

/** What a staff member with scheduling.reserve may read. An explicit allow-list: a field added to Reservation later is NOT exposed until it is added here. */
export function staffReservationView(r: Reservation) {
  const slot = r.span.kind === 'slot' ? r.span : null;
  return {
    id: r.id,
    status: r.status,
    offeringId: r.offeringId,
    resourceId: r.resourceId,
    timezone: r.timezone,
    start: slot ? { date: slot.date, time: slot.startTime } : null,
    durationMinutes: slot ? slot.durationMinutes : null,
    startsAt: r.instants.startsAt,
    endsAt: r.instants.endsAt,
    partySize: r.partySize,
    customer: { name: r.customerSnapshot.displayName, email: r.customerSnapshot.email, phone: r.customerSnapshot.phone },
    notes: r.notes,
    price: r.price,
    paymentStatus: r.paymentStatus,
  };
}

/** Only a facility-hire booking is reachable here: the same organisation's class or coaching bookings are a different surface and answer 404. */
const isHire = (r: Reservation | null): r is Reservation => r !== null && r.presetKey === 'resource_hire' && r.span.kind === 'slot';

async function audit(context: SchedulingRouteContext, action: 'scheduling.reservation.created' | 'scheduling.reservation.cancelled', r: Reservation, extra: Json = {}): Promise<void> {
  const slot = r.span.kind === 'slot' ? r.span : null;
  // After the commit, best effort, and NEVER with `identity`: no name, contact detail or note is written. recordSchedulingAudit does not throw; the catch is belt and braces.
  try {
    await recordSchedulingAudit({
      tenant: context.tenant,
      action,
      resourceType: 'reservation',
      resourceId: r.id,
      summary: {
        offering_id: r.offeringId,
        resource_id: r.resourceId,
        local_date: slot?.date ?? null,
        local_start_time: slot?.startTime ?? null,
        duration_minutes: slot?.durationMinutes ?? null,
        party_size: r.partySize,
        source: SOURCE,
        ...extra,
      } as never,
    });
  } catch {
    /* a failed audit entry never changes the outcome of a committed operation */
  }
}

// ── request parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function parseCreate(body: Json, idempotencyKey: string): { ok: true; request: HireRequest } | { ok: false; problems: string[] } {
  const problems = extraKeys(body, BODY_FIELDS, '');
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string') problems.push(name);
    return typeof v === 'string' ? v : '';
  };
  const offeringId = str(body.offeringId, 'offeringId');
  const resourceId = str(body.resourceId, 'resourceId');

  let start = { date: '', time: '' };
  if (!isObject(body.start)) problems.push('start');
  else {
    problems.push(...extraKeys(body.start, START_FIELDS, 'start.'));
    start = { date: str(body.start.date, 'start.date'), time: str(body.start.time, 'start.time') };
  }

  let customer: HireRequest['customer'] = { name: '' };
  if (!isObject(body.customer)) problems.push('customer');
  else {
    problems.push(...extraKeys(body.customer, CUSTOMER_FIELDS, 'customer.'));
    const c = body.customer;
    const optional = (v: unknown, name: string): string | null | undefined => {
      if (v === undefined || v === null) return v as null | undefined;
      if (typeof v !== 'string') problems.push(name);
      return typeof v === 'string' ? v : undefined;
    };
    customer = { name: str(c.name, 'customer.name'), email: optional(c.email, 'customer.email'), phone: optional(c.phone, 'customer.phone') };
  }

  if (typeof body.partySize !== 'number') problems.push('partySize');
  if (body.durationMinutes !== undefined && typeof body.durationMinutes !== 'number') problems.push('durationMinutes');
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') problems.push('notes');

  let basis: HireBasis | null | undefined;
  if (body.basis !== undefined && body.basis !== null) {
    if (!isObject(body.basis)) problems.push('basis');
    else {
      problems.push(...extraKeys(body.basis, BASIS_FIELDS, 'basis.'));
      basis = {
        offeringVersion: str(body.basis.offeringVersion, 'basis.offeringVersion'),
        resourceVersion: str(body.basis.resourceVersion, 'basis.resourceVersion'),
        offeringToken: str(body.basis.offeringToken, 'basis.offeringToken'),
        scheduleToken: str(body.basis.scheduleToken, 'basis.scheduleToken'),
      };
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const request: HireRequest = {
    idempotencyKey,
    offeringId,
    resourceId,
    start: start as HireRequest['start'],
    partySize: body.partySize as number,
    customer,
    ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes as number } : {}),
    ...(body.notes !== undefined ? { notes: body.notes as string | null } : {}),
    ...(basis !== undefined ? { basis } : {}),
  };
  const rule = validateHireRequest(request);
  return rule.length > 0 ? { ok: false, problems: rule } : { ok: true, request };
}

// ── POST /api/scheduling/reservations ───────────────────────────────────────────────────────────────────────────────────────────────

export async function createReservation(context: SchedulingRouteContext): Promise<Response> {
  const key = context.request.headers.get(KEY_HEADER);
  if (key === null) return invalid(['Idempotency-Key']);
  const parsedBody = await readBody(context.request);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = parseCreate(parsedBody.body, key.trim());
  if (!parsed.ok) return invalid(parsed.problems);

  let result;
  try {
    result = await context.hire.createHire(context.tenant, parsed.request);
  } catch (err) {
    if (err instanceof HireNotReadyError) return schedulingJson({ error: 'Booking is not available right now. Nothing was booked.', code: 'BOOKING_NOT_READY' }, { status: 503 });
    if (err instanceof SchedulingError && err.code === 'permission_denied') return schedulingJson({ error: 'Forbidden.', code: 'FORBIDDEN' }, { status: 403 });
    throw err; // anything else: the guard answers a generic 500 with no detail; a client treats it like a lost response and repeats the SAME key
  }
  if (!result.ok) return failureResponse(result);

  // Audit only the call that created the booking: a pure replay wrote nothing now. A recovered booking was created by THIS call's earlier attempt, so it is audited once.
  if (!result.replayed) await audit(context, 'scheduling.reservation.created', result.reservation);
  const body: Json = { reservation: staffReservationView(result.reservation), replayed: result.replayed };
  if (result.recovered) body.recovered = true;
  return schedulingJson(body, { status: result.replayed ? 200 : 201 });
}

// ── GET ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** GET /api/scheduling/reservations?idempotencyKey=...: resolves a lost response. A lookup of ONE booking by its key, never a list. */
export async function findReservationByKey(context: SchedulingRouteContext): Promise<Response> {
  const url = new URL(context.request.url);
  const unknown = [...url.searchParams.keys()].filter(k => k !== 'idempotencyKey');
  const key = url.searchParams.get('idempotencyKey');
  if (unknown.length > 0 || key === null) return invalid(unknown.length > 0 ? unknown : ['idempotencyKey']);
  const found = await context.hire.findHireByKey(context.tenant, key.trim());
  return isHire(found) ? schedulingJson({ reservation: staffReservationView(found) }) : notFound();
}

export async function getReservation(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'reservationId');
  if (!id) return notFound();
  const found = await context.persistence.reservations.getById(context.tenant, id);
  return isHire(found) ? schedulingJson({ reservation: staffReservationView(found) }) : notFound();
}

// ── POST /api/scheduling/reservations/{id}/cancel ───────────────────────────────────────────────────────────────────────────────────

export async function cancelReservation(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'reservationId');
  if (!id) return notFound();

  // The body is optional; when present it must be a JSON object with only `reason`.
  let reason: string | null = null;
  const hasBody = (context.request.headers.get('content-length') ?? '0') !== '0' || context.request.headers.has('content-type');
  if (hasBody) {
    const parsedBody = await readBody(context.request);
    if (!parsedBody.ok) return parsedBody.response;
    const problems = extraKeys(parsedBody.body, CANCEL_FIELDS, '');
    const r = parsedBody.body.reason;
    if (r !== undefined && r !== null) {
      if (typeof r !== 'string' || r.length > CANCEL_REASON_MAX || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(r)) problems.push('reason');
      else if (r.trim() !== '') reason = r.trim();
    }
    if (problems.length > 0) return invalid(problems);
  }

  const before = await context.persistence.reservations.getById(context.tenant, id);
  if (!isHire(before)) return notFound();
  if (before.status === 'cancelled') return schedulingJson({ reservation: staffReservationView(before), alreadyCancelled: true });
  if (Date.parse(before.instants.startsAt) <= Date.now()) return schedulingJson({ error: FAILURES.in_the_past.error, code: 'IN_THE_PAST' }, { status: 422 });

  let outcome;
  try {
    outcome = await context.persistence.reservations.cancel(context.tenant, { reservationId: id, cancelledBy: 'staff', reason, scope: 'this_occurrence' });
  } catch {
    // The statement may or may not have committed. Ask the database; only a cancelled row proves it did.
    try {
      const now = await context.persistence.reservations.getById(context.tenant, id);
      if (isHire(now) && now.status === 'cancelled') {
        await audit(context, 'scheduling.reservation.cancelled', now, { has_reason: reason !== null, recovered: true });
        return schedulingJson({ reservation: staffReservationView(now), recovered: true });
      }
    } catch {
      /* fall through: the outcome is unknown */
    }
    return schedulingJson({ error: 'The result of this cancellation is not known. Look the booking up before trying again.', code: 'OUTCOME_UNKNOWN', retryable: true }, { status: 504 });
  }

  if (outcome.status === 'rejected') {
    if (outcome.reason === 'already_cancelled') {
      const now = await context.persistence.reservations.getById(context.tenant, id);
      return isHire(now) ? schedulingJson({ reservation: staffReservationView(now), alreadyCancelled: true }) : notFound();
    }
    if (outcome.reason === 'in_the_past') return schedulingJson({ error: FAILURES.in_the_past.error, code: 'IN_THE_PAST' }, { status: 422 });
    return outcome.reason === 'not_found' ? notFound() : schedulingJson({ error: 'Forbidden.', code: 'FORBIDDEN' }, { status: 403 });
  }

  const after = await context.persistence.reservations.getById(context.tenant, id);
  const view = isHire(after) ? after : { ...before, status: 'cancelled' as const };
  await audit(context, 'scheduling.reservation.cancelled', view, { has_reason: reason !== null });
  return schedulingJson({ reservation: staffReservationView(view) });
}
