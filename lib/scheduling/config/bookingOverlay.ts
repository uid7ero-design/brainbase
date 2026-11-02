import { BOOKING_READ_LIMITS, CALENDAR_MAX_DAYS, SchedulingError, addLocalDays, findIdentityKeyLeaks, isLocalDate, resolveLocalTime } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { badRequest } from './http';

// Phase 2C.2 — the READ-ONLY booking overlay API: what is COMMITTED in a calendar window (dated sessions, slot bookings, the resource holds they own), arranged for the
// operational calendar. One GET route behind scheduling.view (a manager and a viewer receive the same body):
//   GET /api/scheduling/calendar-overlay?from=YYYY-MM-DD[&to=YYYY-MM-DD][&offeringId=ID][&resourceIds=ID,ID][&includeCancelled=1][&limit=N]
// `from` and `to` are inclusive LOCAL dates in the organisation's timezone, at most CALENDAR_MAX_DAYS apart (the same bound as the availability calendar). They are turned
// into the half-open instant range [00:00 of from, 00:00 of the day after to) with resolveLocalTime, so a daylight-saving day is 23 or 25 hours long, not 24.
//
// This is the second of the calendar's two layers and it stays apart from the first: it never calls the availability computation and availability never reads it.
// It creates no reservation, occurrence, hold or series, writes no audit entry, and takes no organisation from the request (the caller's session decides it, in the
// central guard). Nothing in the body identifies a customer, for any role: the shapes are built from named fields (see bookingOverlay.ts in the core), and as a last
// line the finished body is checked for any identity-bearing property and answered with a generic 500, nothing else, if one is ever found.
// tests/containment/schedulingPhase2c2Containment.test.ts keeps it that way.
//
// Error contract: 400 INVALID_INPUT (a bad, repeated or unknown query parameter, or a bound exceeded). 401/403/503 for access and configuration come from the guard,
// 504 SCHEDULING_TIMEOUT from its deadline. A truncated view says so (`overlay.truncated`); it is never presented as complete.

const ALLOWED = ['from', 'to', 'offeringId', 'resourceIds', 'includeCancelled', 'limit'] as const;
const ID_MAX = 128;

type Query = { ok: true; from: string; to: string; offeringId: string | null; resourceIds: string[] | null; includeCancelled: boolean; limit: number | null } | { ok: false; problems: string[] };

function readQuery(request: Request): Query {
  const params = new URL(request.url).searchParams;
  const problems: string[] = [];
  for (const key of new Set(params.keys())) if (!(ALLOWED as readonly string[]).includes(key)) problems.push(`unknown parameter: ${key}`);
  for (const key of ALLOWED) if (params.getAll(key).length > 1) problems.push(`${key} must be given once`);

  const from = params.get('from');
  const to = params.get('to') ?? from;
  if (from === null) problems.push('from is required (YYYY-MM-DD)');
  else if (!isLocalDate(from)) problems.push('from must be a valid date (YYYY-MM-DD)');
  if (to !== null && !isLocalDate(to)) problems.push('to must be a valid date (YYYY-MM-DD)');
  if (from !== null && to !== null && isLocalDate(from) && isLocalDate(to)) {
    if (to < from) problems.push('to must not be before from');
    else if (addLocalDays(from, CALENDAR_MAX_DAYS - 1) < to) problems.push(`the range must be at most ${CALENDAR_MAX_DAYS} days`);
  }

  const offeringId = params.get('offeringId');
  if (offeringId !== null && (offeringId === '' || offeringId.length > ID_MAX)) problems.push(`offeringId must be a non-empty id of at most ${ID_MAX} characters`);

  let resourceIds: string[] | null = null;
  if (params.has('resourceIds')) {
    const parts = (params.get('resourceIds') as string).split(',');
    if (parts.length > BOOKING_READ_LIMITS.maxResources) problems.push(`at most ${BOOKING_READ_LIMITS.maxResources} resources can be asked for at once`);
    else if (parts.some(p => p === '' || p.length > ID_MAX)) problems.push(`resourceIds must be a comma-separated list of non-empty ids of at most ${ID_MAX} characters`);
    else resourceIds = [...new Set(parts)];
  }

  let includeCancelled = false;
  if (params.has('includeCancelled')) {
    const raw = params.get('includeCancelled');
    if (raw === '1' || raw === 'true') includeCancelled = true;
    else if (raw !== '0' && raw !== 'false') problems.push('includeCancelled must be 1, 0, true or false');
  }

  let limit: number | null = null;
  if (params.has('limit')) {
    const raw = params.get('limit') as string;
    limit = /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > BOOKING_READ_LIMITS.maxPageSize) problems.push(`limit must be a whole number from 1 to ${BOOKING_READ_LIMITS.maxPageSize}`);
  }

  return problems.length > 0 || from === null || to === null ? { ok: false, problems } : { ok: true, from, to, offeringId, resourceIds, includeCancelled, limit };
}

export async function bookingOverlay(context: SchedulingRouteContext): Promise<Response> {
  const query = readQuery(context.request);
  if (!query.ok) return badRequest(query.problems);
  const timezone = context.tenant.timezone;
  const fromInstant = resolveLocalTime(query.from, '00:00', timezone).instant;
  const toInstant = resolveLocalTime(addLocalDays(query.to, 1), '00:00', timezone).instant;

  let overlay;
  try {
    overlay = await context.bookingReads.readBookingOverlay(context.tenant, {
      fromInstant,
      toInstant,
      offeringId: query.offeringId,
      resourceIds: query.resourceIds,
      includeCancelled: query.includeCancelled,
      limit: query.limit,
    });
  } catch (err) {
    if (err instanceof SchedulingError && err.code === 'invalid_input') return badRequest(err.message.split('; '));
    throw err; // the guard answers a generic 500; nothing internal is sent
  }

  const body = { zone: timezone, range: { from: query.from, to: query.to, fromInstant, toInstant }, overlay };
  // Last line of defence: no identity-bearing property may reach any caller. This never inspects free text (an offering named by staff is configuration), only structure.
  if (findIdentityKeyLeaks(body).length > 0) {
    console.error('[scheduling] booking overlay refused: identity-bearing property in the body');
    return schedulingJson({ error: 'Internal error.' }, { status: 500 });
  }
  return schedulingJson(body);
}
