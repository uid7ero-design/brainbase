import { bookingRefusal, type BookingRefusal, type BookingRefusalCode } from './bookingErrors';
import { addLocalDays } from './availabilityRules';
import { computeAvailability, expandOwnerAvailability, type AvailabilityInput, type FreeSlot, type ResourceAvailabilityInput } from './availability';
import { getPreset } from './presets';
import { offsetMinutesAt, resolveLocalTime } from './time';
import type { InstantWindow, LocalDate, PresetKey, Resource } from './types';
import { isLocalDate } from './validation';

// Phase 2C.1: "may this booking be made, as far as the read-only availability says?". Pure: it calls computeAvailability (it does NOT reimplement it), so a slot
// the calendar offers is exactly a slot this accepts: same engine, same slot grid, same owner-pinned zones, same fail-closed rules.
//
// WHAT THIS IS NOT. It is advisory, like the engine it wraps. The database's resource-hold exclusion constraint and capacity guard stay the only authority on
// double booking and overbooking; a host runs this immediately before the write and then lets the database have the final word. The gap between the two (a rule edit
// or closure landing after this runs) is bounded and is the subject of docs/architecture/scheduling-phase2c-availability-at-commit.md.
//
// THE QUERY RANGE. The engine anchors the slot grid at the start of each continuous effective window, and the window is read over a date range, so for a window
// that is continuous across the whole range (a 24-hour rule) the anchor is the start of the range. The evaluator therefore reads a canonical range, derived from
// the requested local date alone (the day before to the day after), never from a caller's view. `anchorAtRangeEdge` reports when that matters.

export const COMMIT_RANGE_DAYS_BEFORE = 1;
export const COMMIT_RANGE_DAYS_AFTER = 1;

export interface SlotBookingRequest {
  /** The requested interval as instants (an exclusive slot is [startsAt, endsAt)). */
  interval: InstantWindow;
  /** The resource the booking names, or null to let the caller choose among those free. */
  resourceId: string | null;
  partySize: number;
}

/** Everything the engine needs, minus the range and slot, which the evaluator derives from the request. */
export type SlotBookingContext = Omit<AvailabilityInput, 'fromDate' | 'toDate' | 'slot' | 'notBefore'> & {
  /** Distance between slot starts on the grid, as the calendar uses it. */
  stepMinutes: number;
  /** "Now", supplied by the caller (no clock in the core). Starts before this are refused. */
  now: string;
  presetKey: PresetKey;
  /** The resources' participant capacity and kind (the engine's `resource` field carries only id and active). */
  resourceDetails: ReadonlyMap<string, Pick<Resource, 'capacity' | 'kind'>>;
};

export type SlotBookingDecision =
  | {
      ok: true;
      /** The resource chosen (the named one, or the first free in resource_id order). Null only when the preset needs none. */
      resourceId: string | null;
      slot: FreeSlot;
      /** The slot grid was anchored by the query range, not by the rules (see anchoredAtRangeEdge); surfaced so a host can log it. */
      anchorAtRangeEdge: boolean;
    }
  | { ok: false; refusal: BookingRefusal };

const refuse = (code: BookingRefusalCode, message: string): SlotBookingDecision => ({ ok: false, refusal: bookingRefusal(code, message) });

function localDateOf(instant: string, timezone: string): LocalDate {
  const ms = Date.parse(instant);
  const local = new Date(Math.floor(ms / 60000) * 60000 + offsetMinutesAt(ms, timezone) * 60000).toISOString();
  return local.slice(0, 10);
}

/** True when `target` lies wholly inside one of the (normalised, sorted) intervals. */
function containedInAny(intervals: readonly InstantWindow[], target: InstantWindow): boolean {
  const s = Date.parse(target.startsAt);
  const e = Date.parse(target.endsAt);
  return intervals.some(i => Date.parse(i.startsAt) <= s && e <= Date.parse(i.endsAt));
}

/**
 * True when the offering's effective window around the request begins exactly at the start of the canonical range, i.e. the slot grid was anchored by the range
 * rather than by the rules (a window continuous across the whole range, such as a 24-hour rule). The grid is then only as stable as the range is canonical.
 */
function anchoredAtRangeEdge(context: SlotBookingContext, interval: InstantWindow, fromDate: LocalDate, toDate: LocalDate): boolean {
  const offering = expandOwnerAvailability({ rules: context.offeringRules, exceptions: context.offeringExceptions }, fromDate, toDate, context.timezone);
  const s = Date.parse(interval.startsAt);
  const around = offering.intervals.find(i => Date.parse(i.startsAt) <= s && s < Date.parse(i.endsAt));
  if (!around) return false;
  return Date.parse(around.startsAt) === Date.parse(resolveLocalTime(fromDate, '00:00', context.timezone).instant);
}

/** Resource policy for a slot preset. Exclusive presets (appointments from v2, facility hire) need a resource; the others are refused here. */
export function slotPresetResourcePolicy(presetKey: PresetKey): { slotBookable: boolean; resourceRequired: boolean } {
  const preset = getPreset(presetKey);
  return { slotBookable: preset.timeModel === 'bookable_slot' && (presetKey === 'appointments' || presetKey === 'resource_hire'), resourceRequired: preset.resources.requirement === 'required' };
}

/**
 * Evaluates a slot booking (facility hire, appointments) against the availability engine at the moment of commit.
 * Order of refusals (the first that applies wins, so the answer is stable and explains the most fundamental cause):
 *   invalid request, preset not supported, resource policy, offering/resource state, in the past, outside availability, off the slot grid, already held.
 */
export function evaluateSlotBooking(context: SlotBookingContext, request: SlotBookingRequest): SlotBookingDecision {
  const startMs = Date.parse(request.interval.startsAt);
  const endMs = Date.parse(request.interval.endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return refuse('invalid_request', 'the window must be valid instants with the end after the start');
  if (!Number.isInteger(request.partySize) || request.partySize < 1) return refuse('invalid_request', 'partySize must be a whole number of at least 1');
  const durationMs = endMs - startMs;
  if (durationMs % 60000 !== 0) return refuse('invalid_request', 'the window must be a whole number of minutes');
  const durationMinutes = durationMs / 60000;
  if (!Number.isInteger(context.stepMinutes) || context.stepMinutes < 1) return refuse('invalid_request', 'stepMinutes must be a whole number of at least 1');
  if (Number.isNaN(Date.parse(context.now))) return refuse('invalid_request', 'now must be an ISO instant');

  const policy = slotPresetResourcePolicy(context.presetKey);
  if (!policy.slotBookable) return refuse('preset_not_supported', `${context.presetKey} does not take slot bookings in this release`);
  if (policy.resourceRequired && request.resourceId === null && context.resources.length === 0) return refuse('resource_required', 'this offering needs a resource and none is linked');

  const named = request.resourceId;
  if (named !== null) {
    const r = context.resources.find(x => x.resource.id === named);
    if (!r) return refuse('resource_not_eligible', 'the resource is not linked to this offering');
    if (!r.resource.active) return refuse('resource_inactive', 'the resource is not active');
  }

  if (startMs < Date.parse(context.now)) return refuse('in_the_past', 'the start is in the past');

  const day = localDateOf(request.interval.startsAt, context.timezone);
  if (!isLocalDate(day)) return refuse('invalid_request', 'the start could not be placed on a local date');
  const fromDate = addLocalDays(day, -COMMIT_RANGE_DAYS_BEFORE);
  const toDate = addLocalDays(day, COMMIT_RANGE_DAYS_AFTER);

  const candidates: ResourceAvailabilityInput[] = named === null ? [...context.resources] : context.resources.filter(r => r.resource.id === named);
  // A party that cannot fit a resource never reaches the engine: it is a different answer from "unavailable".
  const fitting = candidates.filter(r => {
    const d = context.resourceDetails.get(r.resource.id);
    return d === undefined || d.capacity >= request.partySize;
  });
  if (candidates.length > 0 && fitting.length === 0) return refuse('party_exceeds_resource', 'the party is larger than the resource allows');

  const base = { ...context, resources: fitting, fromDate, toDate, slot: { durationMinutes, stepMinutes: context.stepMinutes }, notBefore: context.now };
  const computed = computeAvailability(base);
  if (!computed.ok) {
    return refuse(computed.reason === 'timezone_changed' ? 'timezone_changed' : 'invalid_request', computed.problems[0] ?? 'the availability inputs are invalid');
  }
  const match = computed.slots.find(s => s.startsAt === request.interval.startsAt && s.endsAt === request.interval.endsAt);
  if (match) return { ok: true, resourceId: match.resourceId, slot: match, anchorAtRangeEdge: anchoredAtRangeEdge(context, request.interval, fromDate, toDate) };

  // Why not: re-ask with every hold removed, so "taken" is told apart from "outside hours" and "off the grid".
  const unheld = computeAvailability({ ...base, resources: fitting.map(r => ({ ...r, holds: [] })), notBefore: null });
  if (!unheld.ok) return refuse('invalid_request', unheld.problems[0] ?? 'the availability inputs are invalid');
  if (computed.reasons.includes('offering_archived')) return refuse('offering_unavailable', 'the offering is archived');
  if (computed.reasons.includes('unsupported_rule_kind') || computed.reasons.some(r => r.startsWith('resource_unsupported_rule_kind'))) {
    return refuse('outside_availability', 'availability rules of an unsupported kind are in force; nothing can be booked until they are removed');
  }
  if (unheld.slots.some(s => s.startsAt === request.interval.startsAt && s.endsAt === request.interval.endsAt)) return refuse('resource_conflict', 'the resource is already held for part of that time');
  const insideHours = unheld.free.some(f => containedInAny(f.intervals, request.interval));
  if (insideHours) return refuse('off_grid', 'that start time is not one of the offered start times');
  return refuse('outside_availability', 'that time is outside the available hours');
}

// ─── Headcount policy (classes) ─────────────────────────────────────────────

export type CapacityDecision = { ok: true; remainingAfter: number } | { ok: false; refusal: BookingRefusal };

/**
 * Participant capacity for a headcount booking. Advisory, like everything here: the database's per-occurrence advisory lock and live-headcount count decide. This tells
 * a screen how many places remain and why a request is refused before it is sent.
 */
export function evaluateHeadcount(args: { capacity: number; liveHeadcount: number; partySize: number; occurrenceOpen: boolean }): CapacityDecision {
  const { capacity, liveHeadcount, partySize, occurrenceOpen } = args;
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
  if (!whole(capacity) || capacity < 1 || !whole(liveHeadcount) || liveHeadcount < 0 || !whole(partySize) || partySize < 1) {
    return { ok: false, refusal: bookingRefusal('invalid_request', 'capacity, headcount and party size must be whole numbers (capacity and party at least 1)') };
  }
  if (!occurrenceOpen) return { ok: false, refusal: bookingRefusal('occurrence_closed', 'the session is cancelled or finished') };
  if (liveHeadcount + partySize > capacity) return { ok: false, refusal: bookingRefusal('capacity_exceeded', `only ${Math.max(0, capacity - liveHeadcount)} places remain`) };
  return { ok: true, remainingAfter: capacity - liveHeadcount - partySize };
}
