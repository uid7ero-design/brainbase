import {
  CALENDAR_MAX_DAYS,
  addLocalDays,
  buildOfferingCalendar,
  calendarExceptions,
  calendarRules,
  buildResourceCalendar,
  isIanaTimezone,
  isLocalDate,
  type AvailabilityOwner,
  type CalendarView,
  type IanaTimezone,
  type ResourceHold,
} from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { badRequest, idParam, notFound } from './http';
import { guardedAvailability } from './availability';

// Phase 2B.3d — the READ-ONLY availability calendar API. Two GET routes, both behind scheduling.view (a manager and a viewer see the same calendar):
//   GET /api/scheduling/offerings/{offeringId}/calendar?from=YYYY-MM-DD[&to=YYYY-MM-DD][&step=MINUTES]
//   GET /api/scheduling/resources/{resourceId}/calendar?from=YYYY-MM-DD[&to=YYYY-MM-DD]
// `from` and `to` are inclusive LOCAL dates in the zone the calendar is drawn in (the offering's pinned zone, or the resource's), at most
// CALENDAR_MAX_DAYS apart. Nothing here writes: it reads the owner, its weekly hours and closures, each linked resource's hours and closures
// (each in its OWN pinned zone), the live holds of those resources, and hands them to the pure shared view model. It creates no reservation,
// occurrence or hold, saves no hours and pins no zone, writes no audit entry, and takes no organisation from the request (the caller's session
// decides it, in the central guard). tests/containment/schedulingPhase2b3dCalendarContainment.test.ts keeps it that way.
//
// Error contract: 400 INVALID_INPUT (a bad or unknown query parameter), 404 NOT_FOUND (missing, or another organisation's row), 422
// CALENDAR_UNAVAILABLE (the stored hours cannot be drawn as a valid calendar: nothing is guessed), 503 AVAILABILITY_NOT_READY /
// AVAILABILITY_ZONES_NOT_READY (migration 034 / 036 not applied). 401/403/503 for access and configuration come from the guard.

const ALLOWED = ['from', 'to', 'step'] as const;
const MAX_STEP_MINUTES = 24 * 60;
const HOUR_MS = 3_600_000;

type Query = { ok: true; from: string; to: string; step: number | null } | { ok: false; problems: string[] };

function readQuery(request: Request, allowStep: boolean): Query {
  const params = new URL(request.url).searchParams;
  const problems: string[] = [];
  for (const key of new Set(params.keys())) if (!(ALLOWED as readonly string[]).includes(key) || (key === 'step' && !allowStep)) problems.push(`unknown parameter: ${key}`);
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
  let step: number | null = null;
  if (allowStep && params.has('step')) {
    const raw = params.get('step') as string;
    step = /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(step) || step < 1 || step > MAX_STEP_MINUTES) problems.push(`step must be a whole number of minutes from 1 to ${MAX_STEP_MINUTES}`);
  }
  return problems.length > 0 || from === null || to === null ? { ok: false, problems } : { ok: true, from, to, step };
}

/** Holds are fetched over the viewing range widened by two days either side (the same margin the engine reads another zone with); the view clips them. */
function holdWindow(from: string, to: string): { fromInstant: string; toInstant: string } {
  return { fromInstant: new Date(Date.parse(`${from}T00:00:00Z`) - 48 * HOUR_MS).toISOString(), toInstant: new Date(Date.parse(`${to}T00:00:00Z`) + 72 * HOUR_MS).toISOString() };
}

/** What the screens are told about an owner's zone: the pin if there is one, else what the first write WOULD pin (nothing is pinned by a read). */
type OwnerZone = { timezone: string; pinned: boolean; source: string | null };

/**
 * The hours, closures and zones of MANY owners of one kind, in three statements whatever the number of owners (rules, closures, pins), each tenant scoped.
 * `fallbackZone` is the zone a not-yet-pinned owner would be pinned to by its first save (the caller already holds the schedule, so nothing is looked up
 * here). Every id in `ids` is present in the result, with empty rules and closures when it has none.
 */
async function readOwners(context: SchedulingRouteContext, kind: AvailabilityOwner['kind'], ids: readonly string[], fallbackZone: (id: string) => IanaTimezone) {
  const [rules, exceptions, zones] = await Promise.all([
    context.availability.listRulesForOwners(context.tenant, kind, ids),
    context.availability.listExceptionsForOwners(context.tenant, kind, ids),
    context.availability.listZonesForOwners(context.tenant, kind, ids),
  ]);
  const ownerOf = (row: { resourceId: string | null; offeringId: string | null }) => (kind === 'resource' ? row.resourceId : row.offeringId);
  const pinned = new Map(zones.map(z => [z.ownerId, z]));
  return new Map(
    ids.map(id => {
      const pin = pinned.get(id);
      const zone: OwnerZone = pin ? { timezone: pin.timezone, pinned: true, source: pin.source } : { timezone: fallbackZone(id), pinned: false, source: null };
      return [
        id,
        {
          rules: calendarRules(context.tenant, rules.filter(r => ownerOf(r) === id)),
          exceptions: calendarExceptions(context.tenant, exceptions.filter(e => ownerOf(e) === id)),
          zone,
        },
      ] as const;
    }),
  );
}

/** The zone an offering's first save would pin: its schedule's zone, else the organisation's (the same rule as the hours screen). */
const offeringFallback = (context: SchedulingRouteContext, scheduleTimezone: string | null | undefined): IanaTimezone =>
  scheduleTimezone && isIanaTimezone(scheduleTimezone) ? scheduleTimezone : context.tenant.timezone;

/**
 * How long a calendar request may run before it is answered 504 SCHEDULING_TIMEOUT: 8 seconds, tunable with SCHEDULING_CALENDAR_DEADLINE_MS and always kept between
 * 250 ms and 25 s (a bad value falls back to the default, never to "no limit"). It bounds what the REQUEST waits for (the database statements stop waiting); the Neon
 * HTTP protocol has no per-session statement_timeout, and the reads are indexed and bounded (14 days, 100 resources) so the server-side statements end on their own.
 */
export const CALENDAR_DEADLINE_DEFAULT_MS = 8_000;
export function calendarDeadlineMs(): number {
  const raw = Number(process.env.SCHEDULING_CALENDAR_DEADLINE_MS);
  return Number.isFinite(raw) && raw >= 250 && raw <= 25_000 ? Math.round(raw) : CALENDAR_DEADLINE_DEFAULT_MS;
}

/** More linked resources than one calendar will draw. The cap keeps a request's cost and the page's size bounded; narrow the offering's resources to see it. */
export const CALENDAR_MAX_RESOURCES = 100;
const tooManyResources = (count: number): Response =>
  schedulingJson(
    { error: `This offering has ${count} linked resources; a calendar shows at most ${CALENDAR_MAX_RESOURCES}. Nothing was changed.`, code: 'CALENDAR_TOO_LARGE', limit: CALENDAR_MAX_RESOURCES },
    { status: 422 },
  );

const unavailable = (problems: string[]): Response =>
  schedulingJson({ error: 'These hours cannot be drawn as a calendar. Nothing was changed.', code: 'CALENDAR_UNAVAILABLE', problems }, { status: 422 });

/** What goes to the browser: the view model without its internal `ok`. */
function publicView(view: CalendarView): Omit<CalendarView, 'ok'> {
  const copy: Partial<CalendarView> = { ...view };
  delete copy.ok;
  return copy as Omit<CalendarView, 'ok'>;
}

export async function offeringCalendar(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'offeringId');
  if (!id) return notFound();
  const query = readQuery(context.request, true);
  if (!query.ok) return badRequest(query.problems);
  const offering = await context.persistence.config.getOffering(context.tenant, id);
  if (!offering) return notFound();
  const schedule = await context.persistence.config.getSchedule(context.tenant, offering.scheduleId);
  if (!schedule) return notFound();

  const read = await guardedAvailability(async () => {
    const linked = await context.persistence.config.listOfferingResources(context.tenant, id);
    if (linked.length > CALENDAR_MAX_RESOURCES) return { tooMany: linked.length } as const;
    const window = holdWindow(query.from, query.to);
    const resourceIds = linked.map(r => r.id);
    // the offering's own hours, every linked resource's hours and the live holds: independent reads, started together
    const [ownOwners, resourceOwners, holds] = await Promise.all([
      readOwners(context, 'offering', [id], () => offeringFallback(context, schedule.timezone)),
      readOwners(context, 'resource', resourceIds, () => context.tenant.timezone),
      context.persistence.config.listLiveHoldsForResources(context.tenant, resourceIds, window.fromInstant, window.toInstant) as Promise<ResourceHold[]>,
    ]);
    const own = ownOwners.get(id)!;
    const perResource = linked.map(r => ({ stored: r, ...resourceOwners.get(r.id)! }));
    return { own, perResource, holds };
  });
  if (!read.ok) return read.response;
  if ('tooMany' in read.value) return tooManyResources((read.value as { tooMany: number }).tooMany);
  const { own, perResource, holds } = read.value;

  const view = buildOfferingCalendar({
    timezone: own.zone.timezone as IanaTimezone,
    pinned: own.zone.pinned,
    fromDate: query.from,
    toDate: query.to,
    // An offering whose schedule is archived takes no availability, like an archived offering.
    offering: { id: offering.id, name: offering.name, archivedAt: offering.archivedAt ?? schedule.archivedAt, durationMinutes: offering.durationMinutes },
    offeringRules: own.rules,
    offeringExceptions: own.exceptions,
    resources: perResource.map(r => ({
      resource: { id: r.stored.id, active: r.stored.active },
      name: r.stored.name,
      rules: r.rules,
      exceptions: r.exceptions,
      holds: holds.filter(h => h.resourceId === r.stored.id),
      timezone: r.zone.timezone as IanaTimezone,
      pinned: r.zone.pinned,
    })),
    stepMinutes: query.step,
  });
  if (!view.ok) return unavailable(view.problems);
  return schedulingJson({
    offering: { id: offering.id, name: offering.name, scheduleId: offering.scheduleId, durationMinutes: offering.durationMinutes, archived: offering.archivedAt !== null || schedule.archivedAt !== null },
    ...publicView(view),
    zone: { value: own.zone.timezone, pinned: own.zone.pinned, source: own.zone.source },
  });
}

export async function resourceCalendar(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'resourceId');
  if (!id) return notFound();
  const query = readQuery(context.request, false);
  if (!query.ok) return badRequest(query.problems);
  const resource = (await context.persistence.config.listResources(context.tenant)).find(r => r.id === id);
  if (!resource) return notFound();

  const read = await guardedAvailability(async () => {
    const window = holdWindow(query.from, query.to);
    const [owners, holds] = await Promise.all([
      readOwners(context, 'resource', [id], () => context.tenant.timezone),
      context.persistence.config.listLiveHoldsForResources(context.tenant, [id], window.fromInstant, window.toInstant),
    ]);
    return { own: owners.get(id)!, holds };
  });
  if (!read.ok) return read.response;
  const { own, holds } = read.value;

  const view = buildResourceCalendar({
    timezone: own.zone.timezone as IanaTimezone,
    pinned: own.zone.pinned,
    fromDate: query.from,
    toDate: query.to,
    resource: { id: resource.id, name: resource.name, active: resource.active },
    rules: own.rules,
    exceptions: own.exceptions,
    holds,
  });
  if (!view.ok) return unavailable(view.problems);
  return schedulingJson({
    resource: { id: resource.id, name: resource.name, kind: resource.kind, active: resource.active },
    ...publicView(view),
    zone: { value: own.zone.timezone, pinned: own.zone.pinned, source: own.zone.source },
  });
}
