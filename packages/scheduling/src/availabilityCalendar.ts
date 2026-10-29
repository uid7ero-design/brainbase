import type { StoredAvailabilityException, StoredAvailabilityRule } from './availabilityPersistence';
import type { TenantContext } from './contracts';
import type { ResourceHold } from './persistence';
import type { AvailabilityRule, IanaTimezone, InstantWindow, LocalDate, Offering } from './types';
import {
  computeAvailability,
  expandOwnerAvailability,
  hasUnsupportedRuleKind,
  intersectIntervals,
  localWindowOnDate,
  normaliseIntervals,
  subtractIntervals,
  type FreeSlot,
  type OwnedAdjustment,
  type ResourceAvailabilityInput,
} from './availability';
import { addLocalDays, localDayOfWeek, type AvailabilityExceptionInput } from './availabilityRules';
import { offsetMinutesAt } from './time';
import { isIanaTimezone, isLocalDate } from './validation';

// Phase 2B.3d: the READ-ONLY availability calendar view model. Pure and standalone like availability.ts: it reads only its arguments, calls
// no clock and no database, and returns plain JSON-safe values. It cannot create a reservation, an occurrence or a resource hold, and it
// computes nothing the shared engine does not already decide: free intervals and slots come from computeAvailability, and each owner's
// weekly hours are expanded with expandOwnerAvailability. This file only arranges them for a calendar:
//   - DAYS are the local days of the viewing zone, each with its true length (23, 24 or 25 hours across a daylight-saving change) and the
//     instants of its local whole hours, so a grid can be drawn without guessing at offsets in the browser.
//   - A LANE is one owner (the offering, or one resource): the hours it is open after its weekly rules and closures, the time its closures
//     removed from its weekly hours, the time actually free (the offering's hours intersected with the resource's, minus holds) and the
//     time held by live reservations or scheduled sessions ("occupied").
//   - Everything is clipped to the requested range, which is half-open [first day start, last day end) in the VIEWING zone. The offering's
//     zone views an offering; a resource's own pinned zone views a resource. A resource in another zone keeps its true instants.
// Missing hours mean no availability (never implied), exactly as in the engine.

export const CALENDAR_MAX_DAYS = 14;
const MINUTE = 60_000;

export interface CalendarTick {
  /** The instant of a whole local hour. */
  at: string;
  /** The local hour of day, 0-23 (on a repeated hour it is the same number twice, at two instants). */
  hour: number;
}

export interface CalendarDay {
  date: LocalDate;
  /** 0 = Sunday. */
  dayOfWeek: number;
  /** Local midnight to the next local midnight, as instants. */
  startsAt: string;
  endsAt: string;
  /** The true length of the day: 1380 on the day clocks go forward, 1500 on the day they go back, otherwise 1440. */
  minutes: number;
  /** The zone's UTC offset at the start of the day, in minutes. */
  offsetMinutes: number;
  ticks: CalendarTick[];
}

export type CalendarLaneState =
  | 'open' // it has hours in the range
  | 'no_hours' // it has no hours in the range (never saved, or all closed): unavailable
  | 'unsupported' // it has a rule of a kind that is not supported yet: unavailable until that rule is removed
  | 'inactive' // a resource that is switched off: it takes no availability
  | 'archived'; // an archived offering: it takes no availability

export interface CalendarOccupied extends InstantWindow {
  /** 'reservation' = held by a live reservation; 'session' = held by a scheduled session. Nothing identifying is carried. */
  kind: 'reservation' | 'session';
}

export interface CalendarLane {
  kind: 'offering' | 'resource';
  id: string;
  name: string;
  /** The zone this owner's hours are read in (its pin, or the zone a first save would pin). */
  timezone: IanaTimezone;
  pinned: boolean;
  state: CalendarLaneState;
  /** Open hours after the weekly rules and closures. */
  hours: InstantWindow[];
  /** Weekly-hours time that a closure removed. */
  closed: InstantWindow[];
  /** Resource lanes: offering hours intersected with the resource's, minus its holds. The no-resource offering lane: its own hours. Else empty. */
  free: InstantWindow[];
  /** Resource lanes: live holds, clipped to the range. */
  occupied: CalendarOccupied[];
}

export interface CalendarView {
  ok: true;
  /** The zone the days are drawn in. */
  timezone: IanaTimezone;
  fromDate: LocalDate;
  toDate: LocalDate;
  days: CalendarDay[];
  lanes: CalendarLane[];
  /** Offering views only: bookable starts on the offering's window-anchored grid (advisory; the database stays the authority on booking). */
  slots: FreeSlot[];
  slot: { durationMinutes: number; stepMinutes: number } | null;
  /** Daylight-saving adjustments made to a window boundary, with whose window it was. */
  adjustments: OwnedAdjustment[];
  /** Why availability is empty, where it is (same codes as computeAvailability, plus 'no_duration'). */
  reasons: string[];
}

export type CalendarFailure = { ok: false; reason: 'invalid_input' | 'timezone_changed'; problems: string[] };

export interface CalendarResourceInput extends ResourceAvailabilityInput {
  name: string;
  /** Whether `timezone` is the resource's stored pin (true) or only the zone a first save would pin (false). */
  pinned: boolean;
  /** Stored resources have no zone of their own until pinned; the caller always supplies the zone this resource is read in. */
  timezone: IanaTimezone;
}

export interface OfferingCalendarInput {
  /** The offering's zone: its pin, or the zone a first save would pin. The calendar is drawn in it. */
  timezone: IanaTimezone;
  pinned: boolean;
  fromDate: LocalDate;
  toDate: LocalDate;
  offering: Pick<Offering, 'id' | 'name' | 'archivedAt' | 'durationMinutes'>;
  offeringRules: readonly AvailabilityRule[];
  offeringExceptions: readonly AvailabilityExceptionInput[];
  resources: readonly CalendarResourceInput[];
  /** Distance between slot starts. Default: the offering's duration. */
  stepMinutes?: number | null;
}

export interface ResourceCalendarInput {
  timezone: IanaTimezone;
  pinned: boolean;
  fromDate: LocalDate;
  toDate: LocalDate;
  resource: { id: string; name: string; active: boolean };
  rules: readonly AvailabilityRule[];
  exceptions: readonly AvailabilityExceptionInput[];
  holds: readonly ResourceHold[];
}

// ─── Stored rows to the engine's input ──────────────────────────────────────

/** Stored weekly rules as the engine reads them. The organisation is the TENANT's: a stored row never carries one to a caller. */
export function calendarRules(tenant: Pick<TenantContext, 'organisationId'>, rules: readonly StoredAvailabilityRule[]): AvailabilityRule[] {
  return rules.map(r => ({
    id: r.id, organisationId: tenant.organisationId, resourceId: r.resourceId, offeringId: r.offeringId, dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, validFrom: r.validFrom, validTo: r.validTo,
    kind: r.kind, // carried so the engine can refuse a kind it does not support (fail closed); it is never read as hours
  }));
}

/** Stored closures as the engine reads them: a partial-day closure carries its one window; a whole-day closure carries none. */
export function calendarExceptions(tenant: Pick<TenantContext, 'organisationId'>, exceptions: readonly StoredAvailabilityException[]): AvailabilityExceptionInput[] {
  return exceptions.map(e => ({
    id: e.id, organisationId: tenant.organisationId, resourceId: e.resourceId, offeringId: e.offeringId, fromDate: e.fromDate, toDate: e.toDate, kind: e.kind, reason: e.reason,
    ...(e.startTime !== null && e.endTime !== null ? { windows: [{ startTime: e.startTime, endTime: e.endTime }] } : {}),
  }));
}

// ─── Range and days ─────────────────────────────────────────────────────────

function validateRange(timezone: IanaTimezone, fromDate: LocalDate, toDate: LocalDate): string[] {
  const problems: string[] = [];
  if (!isIanaTimezone(timezone)) problems.push('timezone must be a valid IANA zone');
  if (!isLocalDate(fromDate) || !isLocalDate(toDate)) problems.push('fromDate and toDate must be valid dates');
  else if (toDate < fromDate) problems.push('toDate must not be before fromDate');
  else if (addLocalDays(fromDate, CALENDAR_MAX_DAYS - 1) < toDate) problems.push(`the range must be at most ${CALENDAR_MAX_DAYS} days`);
  return problems;
}

const toIso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** The instants of the whole local hours inside [startsAt, endsAt): found by walking half hours, so a zone with a half-hour offset or change is right. */
function hourTicks(startsAt: string, endsAt: string, timezone: IanaTimezone): CalendarTick[] {
  const ticks: CalendarTick[] = [];
  const end = Date.parse(endsAt);
  for (let ms = Date.parse(startsAt); ms < end; ms += 30 * MINUTE) {
    const local = Math.floor(ms / MINUTE) + offsetMinutesAt(ms, timezone);
    const minuteOfDay = ((local % 1440) + 1440) % 1440;
    if (minuteOfDay % 60 === 0) ticks.push({ at: toIso(ms), hour: minuteOfDay / 60 });
  }
  return ticks;
}

function buildDays(fromDate: LocalDate, toDate: LocalDate, timezone: IanaTimezone): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let date = fromDate; date <= toDate; date = addLocalDays(date, 1)) {
    // A whole local day always has an instant interval (a daylight-saving gap is an hour, never a day).
    const bounds = localWindowOnDate(date, { startTime: '00:00', endTime: '24:00' }, timezone).interval as InstantWindow;
    days.push({
      date,
      dayOfWeek: localDayOfWeek(date),
      startsAt: bounds.startsAt,
      endsAt: bounds.endsAt,
      minutes: Math.round((Date.parse(bounds.endsAt) - Date.parse(bounds.startsAt)) / MINUTE),
      offsetMinutes: offsetMinutesAt(Date.parse(bounds.startsAt), timezone),
      ticks: hourTicks(bounds.startsAt, bounds.endsAt, timezone),
    });
  }
  return days;
}

const rangeOf = (days: readonly CalendarDay[]): InstantWindow => ({ startsAt: days[0].startsAt, endsAt: days[days.length - 1].endsAt });
const clip = (windows: readonly InstantWindow[], range: InstantWindow): InstantWindow[] => intersectIntervals(normaliseIntervals(windows), [range]);

// ─── Lanes ──────────────────────────────────────────────────────────────────

interface OwnerHours {
  hours: InstantWindow[];
  closed: InstantWindow[];
}

/** One owner's open hours and what its closures removed, read in ITS zone over the viewing range (a wider range for another zone, then clipped). */
function ownerHours(rules: readonly AvailabilityRule[], exceptions: readonly AvailabilityExceptionInput[], zone: IanaTimezone, viewZone: IanaTimezone, fromDate: LocalDate, toDate: LocalDate, range: InstantWindow): OwnerHours {
  const [from, to] = zone === viewZone ? [fromDate, toDate] : [addLocalDays(fromDate, -2), addLocalDays(toDate, 2)];
  const weekly = expandOwnerAvailability({ rules, exceptions: [] }, from, to, zone).intervals;
  const effective = expandOwnerAvailability({ rules, exceptions }, from, to, zone).intervals;
  return { hours: clip(effective, range), closed: clip(subtractIntervals(weekly, effective), range) };
}

function occupiedOf(holds: readonly ResourceHold[], resourceId: string, range: InstantWindow): CalendarOccupied[] {
  const out: CalendarOccupied[] = [];
  for (const h of holds) {
    if (h.resourceId !== resourceId || h.releasedAt !== null) continue;
    const kind: CalendarOccupied['kind'] = h.reservationId !== null ? 'reservation' : 'session';
    for (const piece of clip([{ startsAt: h.startsAt, endsAt: h.endsAt }], range)) out.push({ ...piece, kind });
  }
  return out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.endsAt < b.endsAt ? -1 : a.endsAt > b.endsAt ? 1 : 0));
}

// ─── The offering calendar ──────────────────────────────────────────────────

/**
 * The calendar of one offering over local dates in its zone: its own hours, each linked resource's hours (read in the resource's pinned zone),
 * what is free and what is held, and the bookable slots. Pure: the same input always gives the same output and nothing is written.
 */
export function buildOfferingCalendar(input: OfferingCalendarInput): CalendarView | CalendarFailure {
  const problems = validateRange(input.timezone, input.fromDate, input.toDate);
  const step = input.stepMinutes ?? input.offering.durationMinutes;
  const slot = input.offering.durationMinutes !== null && step !== null && step !== undefined ? { durationMinutes: input.offering.durationMinutes, stepMinutes: step } : null;
  if (problems.length > 0) return { ok: false, reason: 'invalid_input', problems };

  // The slot request is only validated by the engine when there is one; without a duration the engine still runs with a nominal one so its
  // validation of rules, zones and ranges applies, and the slots it returns are dropped.
  const computation = computeAvailability({
    timezone: input.timezone,
    fromDate: input.fromDate,
    toDate: input.toDate,
    offering: { id: input.offering.id, archivedAt: input.offering.archivedAt },
    offeringRules: input.offeringRules,
    offeringExceptions: input.offeringExceptions,
    resources: input.resources.map(r => ({ resource: r.resource, rules: r.rules, exceptions: r.exceptions, holds: r.holds, timezone: r.timezone, authoredTimezone: r.authoredTimezone })),
    slot: slot ?? { durationMinutes: 60, stepMinutes: 60 },
    requirePinnedZones: false,
  });
  if (!computation.ok) return computation;

  const days = buildDays(input.fromDate, input.toDate, input.timezone);
  const range = rangeOf(days);
  const archived = input.offering.archivedAt !== null;
  const own = archived ? { hours: [], closed: [] } : ownerHours(input.offeringRules, input.offeringExceptions, input.timezone, input.timezone, input.fromDate, input.toDate, range);
  const reasons = [...computation.reasons];
  if (slot === null && !reasons.includes('no_duration')) reasons.push('no_duration');

  const offeringFree = input.resources.length === 0 ? clip(computation.free.find(f => f.resourceId === null)?.intervals ?? [], range) : [];
  const lanes: CalendarLane[] = [
    {
      kind: 'offering',
      id: input.offering.id,
      name: input.offering.name,
      timezone: input.timezone,
      pinned: input.pinned,
      state: archived ? 'archived' : hasUnsupportedRuleKind(input.offeringRules) ? 'unsupported' : own.hours.length > 0 ? 'open' : 'no_hours',
      hours: own.hours,
      closed: own.closed,
      free: offeringFree,
      occupied: [],
    },
  ];
  for (const r of [...input.resources].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.resource.id < b.resource.id ? -1 : 1))) {
    const mine = r.resource.active ? ownerHours(r.rules, r.exceptions, r.timezone, input.timezone, input.fromDate, input.toDate, range) : { hours: [], closed: [] };
    const free = clip(computation.free.find(f => f.resourceId === r.resource.id)?.intervals ?? [], range);
    lanes.push({
      kind: 'resource',
      id: r.resource.id,
      name: r.name,
      timezone: r.timezone,
      pinned: r.pinned,
      state: !r.resource.active ? 'inactive' : hasUnsupportedRuleKind(r.rules) ? 'unsupported' : mine.hours.length > 0 ? 'open' : 'no_hours',
      hours: mine.hours,
      closed: mine.closed,
      free,
      occupied: occupiedOf(r.holds, r.resource.id, range),
    });
  }

  return {
    ok: true,
    timezone: input.timezone,
    fromDate: input.fromDate,
    toDate: input.toDate,
    days,
    lanes,
    slots: slot === null || archived ? [] : computation.slots.filter(s => Date.parse(s.endsAt) <= Date.parse(range.endsAt) && Date.parse(s.startsAt) >= Date.parse(range.startsAt)),
    slot,
    adjustments: computation.adjustments,
    reasons,
  };
}

// ─── The resource calendar ──────────────────────────────────────────────────

/** The calendar of one resource over local dates in ITS zone: its hours, closures and holds. No offering is involved, so there are no slots. */
export function buildResourceCalendar(input: ResourceCalendarInput): CalendarView | CalendarFailure {
  const problems = validateRange(input.timezone, input.fromDate, input.toDate);
  if (problems.length > 0) return { ok: false, reason: 'invalid_input', problems };
  // Validate the resource's own rules and closures with the engine's input checks (an invalid set is refused, not drawn): an offering that
  // owns nothing, so only the resource's sets are in play.
  const checked = computeAvailability({
    timezone: input.timezone,
    fromDate: input.fromDate,
    toDate: input.toDate,
    offering: { id: '__resource_calendar__', archivedAt: null },
    offeringRules: [],
    offeringExceptions: [],
    resources: [{ resource: { id: input.resource.id, active: input.resource.active }, rules: input.rules, exceptions: input.exceptions, holds: input.holds, timezone: input.timezone }],
    slot: { durationMinutes: 60, stepMinutes: 60 },
  });
  if (!checked.ok) return checked;

  const days = buildDays(input.fromDate, input.toDate, input.timezone);
  const range = rangeOf(days);
  const mine = input.resource.active ? ownerHours(input.rules, input.exceptions, input.timezone, input.timezone, input.fromDate, input.toDate, range) : { hours: [], closed: [] };
  const adjustments: OwnedAdjustment[] = input.resource.active
    ? expandOwnerAvailability({ rules: input.rules, exceptions: input.exceptions }, input.fromDate, input.toDate, input.timezone).adjustments.map(a => ({ ...a, owner: { kind: 'resource' as const, id: input.resource.id } }))
    : [];
  return {
    ok: true,
    timezone: input.timezone,
    fromDate: input.fromDate,
    toDate: input.toDate,
    days,
    lanes: [
      {
        kind: 'resource',
        id: input.resource.id,
        name: input.resource.name,
        timezone: input.timezone,
        pinned: input.pinned,
        state: !input.resource.active ? 'inactive' : hasUnsupportedRuleKind(input.rules) ? 'unsupported' : mine.hours.length > 0 ? 'open' : 'no_hours',
        hours: mine.hours,
        closed: mine.closed,
        free: subtractIntervals(mine.hours, clip(input.holds.filter(h => h.resourceId === input.resource.id && h.releasedAt === null).map(h => ({ startsAt: h.startsAt, endsAt: h.endsAt })), range)),
        occupied: occupiedOf(input.holds, input.resource.id, range),
      },
    ],
    slots: [],
    slot: null,
    adjustments,
    reasons: !input.resource.active ? [`resource_inactive:${input.resource.id}`] : hasUnsupportedRuleKind(input.rules) ? [`resource_unsupported_rule_kind:${input.resource.id}`] : mine.hours.length === 0 ? ['no_resource_availability'] : [],
  };
}
