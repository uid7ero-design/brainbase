import { HireNotReadyError, SchedulingError, type HireOfferFailureCode } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';

// Phase 2C.3c-B: GET /api/scheduling/reservations/basis — what the staff booking form may offer, and the basis to hand back with the booking.
//
// Runs INSIDE the central guard with feature 'staff_booking' and permission 'scheduling.reserve' (route file): the kill switch is on, the session's organisation holds the capability,
// the caller is staff with the reserve permission, and `context.tenant` is built from the session. It reads no session, cookie or organisation from the request and decides no rule: the
// basis and the starts come from PostgresHireRepository.readHireOffer, which uses the same basis reader and the same pure availability engine as createHire.
//
// READ-ONLY. It writes nothing (no reservation, hold, audit entry or log of the content). It is a different surface from the viewer-level calendar API (scheduling.view), which is untouched.
//
// THE BROWSER NEVER AUTHORS THE BASIS. The basis is returned here and only echoed back by the form; createHire re-reads the same values at commit under locks, so a forged or stale basis
// can only be REFUSED (AVAILABILITY_CHANGED, with a fresh basis), never accepted. There is no `step` parameter: the grid is the offering's configured duration.
//
// PRIVACY. No customer data exists in this response. It names ids, the configured duration, the resource capacity and the price of the offering, and never an organisation.

const ALLOWED = ['offeringId', 'resourceId', 'from', 'to'] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

const invalid = (problems: string[]): Response => schedulingJson({ error: 'The request is not valid.', code: 'VALIDATION', problems }, { status: 400 });

const REFUSALS: Readonly<Record<Exclude<HireOfferFailureCode, 'validation'>, { status: number; code: string; error: string }>> = {
  not_found: { status: 404, code: 'NOT_FOUND', error: 'Not found.' },
  preset_not_supported: { status: 422, code: 'OFFERING_NOT_BOOKABLE', error: 'This offering cannot be booked as a facility hire.' },
  offering_unavailable: { status: 409, code: 'OFFERING_UNAVAILABLE', error: 'This offering is not available for booking.' },
  resource_not_eligible: { status: 422, code: 'RESOURCE_NOT_ELIGIBLE', error: 'That resource is not offered for this offering.' },
  resource_inactive: { status: 409, code: 'RESOURCE_INACTIVE', error: 'That resource is not active.' },
  duration_not_allowed: { status: 422, code: 'DURATION_NOT_ALLOWED', error: 'This offering has no configured duration to book.' },
  range_too_large: { status: 422, code: 'RANGE_TOO_LARGE', error: 'There are too many start times in that range. Ask for fewer days.' },
  availability_unreadable: { status: 422, code: 'AVAILABILITY_UNREADABLE', error: 'The stored hours cannot be turned into start times. Nothing can be offered until they are fixed.' },
};

export async function readReservationBasis(context: SchedulingRouteContext): Promise<Response> {
  const params = new URL(context.request.url).searchParams;
  const problems: string[] = [];
  for (const key of new Set(params.keys())) if (!(ALLOWED as readonly string[]).includes(key)) problems.push(key); // e.g. step, organisationId: refused by NAME, never echoed as a value
  for (const key of ALLOWED) {
    const all = params.getAll(key);
    if (all.length === 0 || all[0] === '') problems.push(key);
    else if (all.length > 1) problems.push(key);
  }
  const offeringId = params.get('offeringId') ?? '';
  const resourceId = params.get('resourceId') ?? '';
  if (offeringId !== '' && !ID.test(offeringId)) problems.push('offeringId');
  if (resourceId !== '' && !ID.test(resourceId)) problems.push('resourceId');
  if (problems.length > 0) return invalid([...new Set(problems)]);

  let result;
  try {
    result = await context.hire.readHireOffer(context.tenant, { offeringId, resourceId, from: params.get('from') as string, to: params.get('to') as string });
  } catch (err) {
    if (err instanceof HireNotReadyError) return schedulingJson({ error: 'Booking is not available right now.', code: 'BOOKING_NOT_READY' }, { status: 503 });
    if (err instanceof SchedulingError && err.code === 'permission_denied') return schedulingJson({ error: 'Forbidden.', code: 'FORBIDDEN' }, { status: 403 });
    throw err; // a read: the guard answers a generic 500 with no detail, and nothing was written
  }
  if (!result.ok) {
    if (result.code === 'validation') return invalid(result.problems ?? []);
    const m = REFUSALS[result.code];
    return schedulingJson({ error: m.error, code: m.code }, { status: m.status });
  }

  const o = result.offer;
  return schedulingJson({
    basis: o.basis,
    offering: { id: o.offeringId, durationMinutes: o.durationMinutes, price: o.price },
    resource: { id: o.resourceId, capacity: o.resourceCapacity },
    timezone: o.timezone,
    range: o.range,
    generatedAt: o.generatedAt,
    days: o.days,
  });
}
