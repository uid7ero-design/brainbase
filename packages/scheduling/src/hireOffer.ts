import { computeAvailability } from './availability';
import { addLocalDays } from './availabilityRules';
import type { SlotBookingContext } from './bookingEvaluation';
import type { HireBasis } from './hire';
import { labelLocalInstant, resolveLocalTime } from './time';
import type { IanaTimezone, LocalDate, LocalTime } from './types';
import { isLocalDate } from './validation';

// Phase 2C.3c-B: WHAT A STAFF MEMBER MAY BE OFFERED for a facility hire, derived by the same pure engine that decides a booking. Nothing here reads a database or a clock.
//
// An offered start is exactly a start for which `evaluateSlotBooking` says yes under the same context (same step: the offering's configured duration; same `now`; same holds): both call
// `computeAvailability` with the same inputs, and a test proves that every offered start is accepted by the evaluator and that no other start on the grid is. On top of that, a start is
// offered only if `createHire` would resolve its local time to that very instant, so the repeated hour of a daylight-saving fall-back is offered once (the earlier instant, as the booking
// takes) and never as a local time the booking cannot reproduce.

/** The longest range one request may ask for (inclusive local dates). */
export const HIRE_OFFER_MAX_DAYS = 14;
/** The most starts one response may hold. A range that would exceed it is refused (422), never silently cut: a truncated list would read as "nothing later is free". */
export const HIRE_OFFER_MAX_STARTS = 1500;

export interface OfferedStart {
  date: LocalDate;
  time: LocalTime;
  startsAt: string;
  endsAt: string;
}

/** The staff-facing offer for one (offering, resource) pair. Opaque `basis`: read it, hand it back with the booking. */
export interface HireOffer {
  basis: HireBasis;
  offeringId: string;
  resourceId: string;
  durationMinutes: number;
  /** The offering's pinned zone: every date and time below is in it. */
  timezone: IanaTimezone;
  resourceCapacity: number;
  price: { amountCents: number; currency: string } | null;
  range: { from: LocalDate; to: LocalDate };
  /** The server's "now" the offer was computed at; starts before it are not offered. */
  generatedAt: string;
  /** Every date in the range, in order; `starts` is empty when nothing is offered that day. */
  days: Array<{ date: LocalDate; starts: Array<{ time: LocalTime; startsAt: string }> }>;
}

export type HireOfferFailureCode =
  | 'validation'
  | 'not_found'
  | 'preset_not_supported'
  | 'offering_unavailable'
  | 'resource_not_eligible'
  | 'resource_inactive'
  | 'duration_not_allowed'
  | 'range_too_large'
  | 'availability_unreadable';

export type HireOfferResult = { ok: true; offer: HireOffer } | { ok: false; code: HireOfferFailureCode; message: string; problems?: string[] };

export interface HireOfferRequest {
  offeringId: string;
  resourceId: string;
  from: LocalDate;
  to: LocalDate;
}

/** Problems with a requested range, as field names. Pure. */
export function validateHireOfferRange(from: unknown, to: unknown): string[] {
  const problems: string[] = [];
  if (typeof from !== 'string' || !isLocalDate(from)) problems.push('from');
  if (typeof to !== 'string' || !isLocalDate(to)) problems.push('to');
  if (problems.length === 0) {
    if ((to as string) < (from as string)) problems.push('to');
    else if (addLocalDays(from as string, HIRE_OFFER_MAX_DAYS - 1) < (to as string)) problems.push('range');
  }
  return problems;
}

/**
 * The starts offered for one resource over an inclusive range of local dates. `context` is the SAME context `createHire` builds for a decision (the offering's rules and closures, the
 * resource's rules and closures and live holds, `stepMinutes` = the configured duration, `now`, the resource's capacity). Returns the starts in order, or the engine's own problems.
 */
export function offeredHireStarts(
  context: SlotBookingContext,
  args: { resourceId: string; durationMinutes: number; fromDate: LocalDate; toDate: LocalDate },
): { ok: true; starts: OfferedStart[] } | { ok: false; problems: string[] } {
  const resources = context.resources.filter(r => r.resource.id === args.resourceId);
  const computed = computeAvailability({
    ...context,
    resources,
    fromDate: args.fromDate,
    toDate: args.toDate,
    slot: { durationMinutes: args.durationMinutes, stepMinutes: context.stepMinutes },
    notBefore: context.now,
  });
  if (!computed.ok) return { ok: false, problems: computed.problems };

  const starts: OfferedStart[] = [];
  for (const slot of computed.slots) {
    if (slot.resourceId !== args.resourceId) continue;
    const label = labelLocalInstant(slot.startsAt, context.timezone);
    if (label.date < args.fromDate || label.date > args.toDate) continue;
    // createHire resolves (date, time) in the offering's zone and takes the EARLIER instant of a repeated time; offer only what it would reproduce.
    const resolved = resolveLocalTime(label.date, label.time, context.timezone);
    if (resolved.kind === 'gap' || Date.parse(resolved.instant) !== Date.parse(slot.startsAt)) continue;
    starts.push({ date: label.date, time: label.time, startsAt: slot.startsAt, endsAt: slot.endsAt });
  }
  starts.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { ok: true, starts };
}

/** Groups starts by local date for every date of the range (empty days included, so a date picker can grey them out). */
export function groupOfferedStarts(starts: readonly OfferedStart[], from: LocalDate, to: LocalDate): HireOffer['days'] {
  const days: HireOffer['days'] = [];
  for (let d = from; d <= to; d = addLocalDays(d, 1)) days.push({ date: d, starts: starts.filter(s => s.date === d).map(s => ({ time: s.time, startsAt: s.startsAt })) });
  return days;
}
