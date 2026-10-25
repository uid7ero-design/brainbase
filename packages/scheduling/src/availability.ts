import type { ResourceHold } from './persistence';
import type { AvailabilityRule, IanaTimezone, InstantWindow, LocalDate, LocalTime, Offering, Resource } from './types';
import {
  END_OF_DAY,
  addLocalDays,
  localDayOfWeek,
  subtractLocalWindows,
  validateAvailabilityExceptionSet,
  validateAvailabilityRuleSet,
  type AvailabilityExceptionInput,
  type LocalWindow,
  type WindowEnd,
} from './availabilityRules';
import { offsetMinutesAt, resolveLocalTime } from './time';
import { isIanaTimezone, isLocalDate } from './validation';

// Phase 2B.3a: the availability computation. Pure and standalone: it reads only its arguments, calls no clock and no database, and
// returns values. It cannot create a reservation, an occurrence or a resource hold, and it is ADVISORY: the database's resource-hold
// exclusion constraint stays the only authority on whether a booking may be written.
//
// SEMANTICS (the contract the later stages build on)
//  1. Everything is a half-open instant interval [start, end). Adjacent intervals touch but never overlap, so back-to-back bookings
//     are legal and a boundary instant belongs to the later interval only.
//  2. Weekly rules are local wall-clock windows. They are turned into instants per local date in one explicit timezone, through
//     resolveLocalTime (time.ts), so 09:00 stays 09:00 across a daylight-saving change while its UTC hour moves.
//  3. Daylight saving, for a window boundary: a time that does not exist (spring forward) resolves to the instant the clock jumps,
//     so a window 02:30-05:00 on the changeover day opens at the jump, not 30 minutes late; a window that lies wholly inside the gap
//     is dropped; a time that happens twice (fall back) resolves to the EARLIER instant, the same rule as resolveLocalTime. A window
//     that spans the repeated hour keeps its true elapsed length. Each of these is reported in `adjustments`.
//  4. An owner's availability = its weekly rules for the dates they are valid on, then its exceptions: a 'closed' exception removes
//     the date entirely (and wins over any override on that date); an 'override' replaces the weekly windows for the date with its
//     own windows. An override that carries no windows counts as closed.
//  5. Missing rules mean NO availability, for offerings and resources alike. "Open whenever the offering is" is stated by giving the
//     resource explicit rules (a 00:00-24:00 rule for each weekday); nothing is implied.
//  6. Owners. A rule or exception belongs to exactly one owner (an offering OR a resource, mirroring the table's CHECK). "Both" is
//     expressed at computation time: for an offering that uses resources, a resource can offer a slot only where the OFFERING's
//     availability intersects THAT resource's availability, minus the resource's active holds. An offering that needs no resource
//     (an empty resources list) is decided by its own availability alone.
//  7. Inactive resources and archived offerings have no availability. Holds that are released are ignored.
//  8. Slots start on a grid anchored at the start of each continuous offering interval and advance by `stepMinutes`; a slot is kept
//     only if its whole [start, start + duration) lies inside the resource's free intervals. Holds and resource hours therefore
//     remove slots but never shift the others. Participant capacity (Offering.capacity) and resource capacity play no part: this is
//     time availability only, and the two capacities stay separate concepts.
// 10. Owner-pinned zones (Phase 2B.3d groundwork). The OFFERING's rules and exceptions are read in `timezone`; each RESOURCE's rules and
//     exceptions are read in the resource's own pinned zone (`ResourceAvailabilityInput.timezone`, which defaults to `timezone` so a caller
//     that supplies no per-resource zone behaves exactly as before). Each owner's windows are expanded to instants in ITS zone and the
//     instants are intersected, so a resource shared by offerings of different zones keeps the same instants whoever asks, and a
//     resource in Perth can serve an offering in Adelaide. Dates in the request are the OFFERING's local dates; a resource in another
//     zone is expanded over a two-day wider range and clipped by the intersection, so no window at the edge of the range is lost.
//  9. Timezone changes are never applied silently. Rules carry no zone, so when the caller supplies the zone the rules were
//     authored in and it differs from the zone being computed, the computation refuses unless the caller confirms the
//     reinterpretation; compareAvailabilityAcrossTimezones produces the report to confirm against.

export const MAX_AVAILABILITY_QUERY_DAYS = 93;
const MAX_EXPAND_DAYS = 400;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Ms = { s: number; e: number };

// ─── Interval algebra (half-open, on instants) ──────────────────────────────

function normaliseMs(list: readonly Ms[]): Ms[] {
  const sorted = list.filter(i => i.e > i.s).sort((a, b) => a.s - b.s || a.e - b.e);
  const out: Ms[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ s: i.s, e: i.e });
  }
  return out;
}

function intersectMs(a: readonly Ms[], b: readonly Ms[]): Ms[] {
  const out: Ms[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i].s, b[j].s);
    const e = Math.min(a[i].e, b[j].e);
    if (e > s) out.push({ s, e });
    if (a[i].e < b[j].e) i++;
    else j++;
  }
  return out;
}

function subtractMs(a: readonly Ms[], cut: readonly Ms[]): Ms[] {
  const out: Ms[] = [];
  for (const base of a) {
    let s = base.s;
    for (const c of cut) {
      if (c.e <= s) continue;
      if (c.s >= base.e) break;
      if (c.s > s) out.push({ s, e: c.s });
      s = Math.max(s, c.e);
      if (s >= base.e) break;
    }
    if (s < base.e) out.push({ s, e: base.e });
  }
  return out;
}

const toIso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const toWindow = (i: Ms): InstantWindow => ({ startsAt: toIso(i.s), endsAt: toIso(i.e) });
const fromWindow = (w: InstantWindow): Ms => ({ s: Date.parse(w.startsAt), e: Date.parse(w.endsAt) });

/** Sorts, drops empty intervals and merges overlapping or touching ones. */
export function normaliseIntervals(intervals: readonly InstantWindow[]): InstantWindow[] {
  return normaliseMs(intervals.map(fromWindow)).map(toWindow);
}
export function intersectIntervals(a: readonly InstantWindow[], b: readonly InstantWindow[]): InstantWindow[] {
  return intersectMs(normaliseMs(a.map(fromWindow)), normaliseMs(b.map(fromWindow))).map(toWindow);
}
export function subtractIntervals(a: readonly InstantWindow[], cut: readonly InstantWindow[]): InstantWindow[] {
  return subtractMs(normaliseMs(a.map(fromWindow)), normaliseMs(cut.map(fromWindow))).map(toWindow);
}

/** Free intervals of one resource after its ACTIVE holds (released holds and other resources' holds are ignored). */
export function subtractHolds(intervals: readonly InstantWindow[], holds: readonly ResourceHold[], resourceId: string): InstantWindow[] {
  const cut = holds.filter(h => h.resourceId === resourceId && h.releasedAt === null).map(h => ({ s: Date.parse(h.startsAt), e: Date.parse(h.endsAt) }));
  return subtractMs(normaliseMs(intervals.map(fromWindow)), normaliseMs(cut)).map(toWindow);
}

// ─── Local windows to instants (daylight saving) ────────────────────────────

export type AvailabilityAdjustmentKind = 'start_in_gap' | 'end_in_gap' | 'start_ambiguous' | 'end_ambiguous' | 'dropped_in_gap';

/** A window whose wall-clock boundary fell on a nonexistent or repeated local time, and what the computation did about it. */
export interface AvailabilityAdjustment {
  date: LocalDate;
  startTime: LocalTime;
  endTime: WindowEnd;
  kind: AvailabilityAdjustmentKind;
}

/** First instant at which the zone's offset equals `afterOffset`, searching back from an instant known to be after the jump. */
function gapEndMs(shifted: number, afterOffset: number, timezone: IanaTimezone): number {
  let lo = shifted - DAY;
  let hi = shifted;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / MINUTE / 2) * MINUTE;
    if (offsetMinutesAt(mid, timezone) === afterOffset) hi = mid;
    else lo = mid;
  }
  return hi;
}

function boundaryMs(date: LocalDate, time: WindowEnd, timezone: IanaTimezone): { ms: number; kind: 'ok' | 'ambiguous' | 'gap' } {
  const day = time === END_OF_DAY ? addLocalDays(date, 1) : date;
  const r = resolveLocalTime(day, time === END_OF_DAY ? '00:00' : time, timezone);
  if (r.kind === 'gap') return { ms: gapEndMs(Date.parse(r.instant), r.offsetMinutes, timezone), kind: 'gap' };
  return { ms: Date.parse(r.instant), kind: r.kind };
}

/** One local window on one date as an instant interval, or null when it lies wholly inside a nonexistent stretch. */
export function localWindowOnDate(date: LocalDate, local: LocalWindow, timezone: IanaTimezone): { interval: InstantWindow | null; adjustments: AvailabilityAdjustment[] } {
  const start = boundaryMs(date, local.startTime, timezone);
  const end = boundaryMs(date, local.endTime, timezone);
  const adjustments: AvailabilityAdjustment[] = [];
  const note = (kind: AvailabilityAdjustmentKind) => adjustments.push({ date, startTime: local.startTime, endTime: local.endTime, kind });
  if (start.kind === 'gap') note('start_in_gap');
  if (start.kind === 'ambiguous') note('start_ambiguous');
  if (end.kind === 'gap') note('end_in_gap');
  if (end.kind === 'ambiguous') note('end_ambiguous');
  if (end.ms <= start.ms) {
    note('dropped_in_gap');
    return { interval: null, adjustments };
  }
  return { interval: toWindow({ s: start.ms, e: end.ms }), adjustments };
}

// ─── One owner's availability ───────────────────────────────────────────────

export interface OwnerAvailabilityInput {
  rules: readonly AvailabilityRule[];
  exceptions: readonly AvailabilityExceptionInput[];
}

function windowsForDate(owner: OwnerAvailabilityInput, date: LocalDate): LocalWindow[] {
  const covering = owner.exceptions.filter(e => e.fromDate <= date && date <= e.toDate);
  const closures = covering.filter(e => e.kind !== 'override');
  const overrides = covering.filter(e => e.kind === 'override');
  // A whole-day closure closes the date, and so does an unknown kind (fail closed). A closure with windows is partial-day: it only cuts
  // those local times out of whatever the day would otherwise offer (the weekly rules, or an override's windows).
  if (closures.some(e => e.kind !== 'closed' || (e.windows ?? []).length === 0)) return [];
  const dow = localDayOfWeek(date);
  const base: LocalWindow[] =
    overrides.length > 0
      ? overrides.flatMap(e => [...(e.windows ?? [])])
      : owner.rules
          .filter(r => r.dayOfWeek === dow && (r.validFrom === null || r.validFrom <= date) && (r.validTo === null || date <= r.validTo))
          .map(r => ({ startTime: r.startTime, endTime: r.endTime as WindowEnd }));
  const cuts = closures.flatMap(e => [...(e.windows ?? [])]);
  return cuts.length > 0 ? subtractLocalWindows(base, cuts) : base;
}

/**
 * The instant intervals one owner is available over inclusive local dates, plus the daylight-saving adjustments made. The inputs
 * are assumed valid (computeAvailability validates them first); an invalid date, zone or an over-long range throws.
 */
export function expandOwnerAvailability(owner: OwnerAvailabilityInput, fromDate: LocalDate, toDate: LocalDate, timezone: IanaTimezone): { intervals: InstantWindow[]; adjustments: AvailabilityAdjustment[] } {
  if (!isLocalDate(fromDate) || !isLocalDate(toDate) || toDate < fromDate) throw new RangeError('fromDate and toDate must be valid dates, fromDate first');
  if (!isIanaTimezone(timezone)) throw new RangeError(`Invalid timezone: ${timezone}`);
  const collected: Ms[] = [];
  const adjustments: AvailabilityAdjustment[] = [];
  let days = 0;
  for (let date = fromDate; date <= toDate; date = addLocalDays(date, 1)) {
    if (++days > MAX_EXPAND_DAYS) throw new RangeError(`The range is longer than ${MAX_EXPAND_DAYS} days`);
    for (const w of windowsForDate(owner, date)) {
      const r = localWindowOnDate(date, w, timezone);
      adjustments.push(...r.adjustments);
      if (r.interval) collected.push(fromWindow(r.interval));
    }
  }
  return { intervals: normaliseMs(collected).map(toWindow), adjustments };
}

// ─── Slots ──────────────────────────────────────────────────────────────────

export interface SlotRequest {
  durationMinutes: number;
  /** Distance between slot starts on the grid. */
  stepMinutes: number;
}

export interface FreeSlot {
  startsAt: string;
  endsAt: string;
  /** null for an offering that needs no resource. */
  resourceId: string | null;
}

function containedIn(within: readonly Ms[], s: number, e: number): boolean {
  let lo = 0;
  let hi = within.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (within[mid].e <= s) lo = mid + 1;
    else if (within[mid].s > s) hi = mid - 1;
    else return within[mid].s <= s && e <= within[mid].e;
  }
  return false;
}

/** Slot starts on the grid of each anchor interval, kept where the whole slot lies inside `within`. Sorted, unique, always positive length. */
export function generateSlots(anchors: readonly InstantWindow[], within: readonly InstantWindow[], slot: SlotRequest, resourceId: string | null): FreeSlot[] {
  const inside = normaliseMs(within.map(fromWindow));
  const out: FreeSlot[] = [];
  const duration = slot.durationMinutes * MINUTE;
  const step = slot.stepMinutes * MINUTE;
  for (const a of normaliseMs(anchors.map(fromWindow))) {
    for (let s = a.s; s + duration <= a.e; s += step) {
      if (containedIn(inside, s, s + duration)) out.push({ startsAt: toIso(s), endsAt: toIso(s + duration), resourceId });
    }
  }
  return out;
}

// ─── The computation ────────────────────────────────────────────────────────

export interface ResourceAvailabilityInput extends OwnerAvailabilityInput {
  resource: Pick<Resource, 'id' | 'active'>;
  holds: readonly ResourceHold[];
  /**
   * The zone this RESOURCE's rules and exceptions are read in (its pinned zone). Absent or null: the offering's `timezone`, the behaviour
   * before owner-pinned zones. Never taken from the browser, the organisation or the schedule at this level: the caller passes what is pinned.
   */
  timezone?: IanaTimezone | null;
  /** The zone this resource's rules were authored in, if recorded; a difference from the zone being read refuses unless reinterpretation is confirmed. */
  authoredTimezone?: IanaTimezone | null;
}

export interface AvailabilityInput {
  /** The zone the OFFERING's rules and exceptions are read in, and the zone of the result (its pinned zone). Required: there is no default. */
  timezone: IanaTimezone;
  /** Inclusive local dates, at most MAX_AVAILABILITY_QUERY_DAYS apart. */
  fromDate: LocalDate;
  toDate: LocalDate;
  offering: Pick<Offering, 'id' | 'archivedAt'>;
  offeringRules: readonly AvailabilityRule[];
  offeringExceptions: readonly AvailabilityExceptionInput[];
  /** Candidate resources. An empty list means the offering needs no resource. */
  resources: readonly ResourceAvailabilityInput[];
  slot: SlotRequest;
  /** Slots starting before this instant are dropped (the caller supplies "now": the core has no clock). */
  notBefore?: string | null;
  /** The zone the rules were authored in, if the host recorded it. */
  authoredTimezone?: IanaTimezone | null;
  /** Set only after the user has confirmed the report from compareAvailabilityAcrossTimezones. */
  allowTimezoneReinterpretation?: boolean;
  /**
   * Fail closed on a resource that has rules or exceptions but no pinned `timezone` (invalid_input), instead of reading them in the
   * offering's zone. Hosts that pin zones (migration 036) set this, so an unpinned resource can never be read in a guessed zone.
   */
  requirePinnedZones?: boolean;
}

export interface ResourceFreeIntervals {
  resourceId: string | null;
  /** The zone this entry's own hours were read in (the resource's zone; the offering's for the no-resource entry). */
  timezone: IanaTimezone;
  intervals: InstantWindow[];
}

/** A daylight-saving adjustment, with the owner whose wall-clock window it concerns (each owner is read in its own zone). */
export interface OwnedAdjustment extends AvailabilityAdjustment {
  owner: { kind: 'offering' | 'resource'; id: string };
}

export type AvailabilityComputation =
  | {
      ok: true;
      timezone: IanaTimezone;
      /** Free intervals per resource (offering hours intersected with the resource's, minus holds), advisory only. */
      free: ResourceFreeIntervals[];
      slots: FreeSlot[];
      adjustments: OwnedAdjustment[];
      /** Why availability is empty, where it is: 'offering_archived', 'no_offering_availability', 'resource_inactive:<id>', 'resource_no_availability:<id>'. */
      reasons: string[];
    }
  | { ok: false; reason: 'invalid_input' | 'timezone_changed'; problems: string[] };

function validateInput(input: AvailabilityInput): string[] {
  const problems: string[] = [];
  if (!isIanaTimezone(input.timezone)) problems.push('timezone must be a valid IANA zone');
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate)) problems.push('fromDate and toDate must be valid dates');
  else if (input.toDate < input.fromDate) problems.push('toDate must not be before fromDate');
  else if (addLocalDays(input.fromDate, MAX_AVAILABILITY_QUERY_DAYS - 1) < input.toDate) problems.push(`the range must be at most ${MAX_AVAILABILITY_QUERY_DAYS} days`);
  const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;
  if (!isPositiveInt(input.slot?.durationMinutes) || input.slot.durationMinutes > 24 * 60) problems.push('slot.durationMinutes must be a whole number of minutes from 1 to 1440');
  if (!isPositiveInt(input.slot?.stepMinutes) || input.slot.stepMinutes > 24 * 60) problems.push('slot.stepMinutes must be a whole number of minutes from 1 to 1440');
  if (input.notBefore !== undefined && input.notBefore !== null && Number.isNaN(Date.parse(input.notBefore))) problems.push('notBefore must be an ISO instant');
  if (input.authoredTimezone !== undefined && input.authoredTimezone !== null && !isIanaTimezone(input.authoredTimezone)) problems.push('authoredTimezone must be a valid IANA zone');
  for (const r of input.resources) {
    if (r.timezone !== undefined && r.timezone !== null && !isIanaTimezone(r.timezone)) problems.push(`resource ${r.resource.id}: timezone must be a valid IANA zone`);
    if (r.authoredTimezone !== undefined && r.authoredTimezone !== null && !isIanaTimezone(r.authoredTimezone)) problems.push(`resource ${r.resource.id}: authoredTimezone must be a valid IANA zone`);
    if (input.requirePinnedZones && !r.timezone && (r.rules.length > 0 || r.exceptions.length > 0)) problems.push(`resource ${r.resource.id} has availability but no pinned timezone`);
  }

  const ownedBy = (items: ReadonlyArray<{ id: string; resourceId: string | null; offeringId: string | null }>, kind: 'offering' | 'resource', id: string, label: string) => {
    for (const i of items) {
      const mine = kind === 'offering' ? i.offeringId === id && i.resourceId === null : i.resourceId === id && i.offeringId === null;
      if (!mine) problems.push(`${label} ${i.id} does not belong to ${kind} ${id}`);
    }
  };
  problems.push(...validateAvailabilityRuleSet(input.offeringRules), ...validateAvailabilityExceptionSet(input.offeringExceptions));
  ownedBy(input.offeringRules, 'offering', input.offering.id, 'rule');
  ownedBy(input.offeringExceptions, 'offering', input.offering.id, 'exception');
  const seen = new Set<string>();
  for (const r of input.resources) {
    if (seen.has(r.resource.id)) problems.push(`resource ${r.resource.id} is listed twice`);
    seen.add(r.resource.id);
    problems.push(...validateAvailabilityRuleSet(r.rules), ...validateAvailabilityExceptionSet(r.exceptions));
    ownedBy(r.rules, 'resource', r.resource.id, 'rule');
    ownedBy(r.exceptions, 'resource', r.resource.id, 'exception');
    for (const h of r.holds) {
      if (Number.isNaN(Date.parse(h.startsAt)) || Number.isNaN(Date.parse(h.endsAt)) || Date.parse(h.endsAt) <= Date.parse(h.startsAt)) problems.push(`hold ${h.id} is not a valid half-open interval`);
    }
  }
  return problems;
}

const emptyOk = (timezone: IanaTimezone, reasons: string[], free: ResourceFreeIntervals[] = [], adjustments: OwnedAdjustment[] = []): AvailabilityComputation => ({
  ok: true,
  timezone,
  free,
  slots: [],
  adjustments,
  reasons,
});

/**
 * Free intervals and bookable slots for one offering over a local date range. Pure and deterministic: the same input always gives
 * the same output, the input is never modified, and nothing is written anywhere.
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityComputation {
  const problems = validateInput(input);
  if (problems.length > 0) return { ok: false, reason: 'invalid_input', problems };
  if (input.authoredTimezone && input.authoredTimezone !== input.timezone && !input.allowTimezoneReinterpretation) {
    return {
      ok: false,
      reason: 'timezone_changed',
      problems: [`the rules were authored in ${input.authoredTimezone} but are being read in ${input.timezone}; review the change (compareAvailabilityAcrossTimezones) and confirm it explicitly`],
    };
  }
  for (const r of input.resources) {
    const zone = r.timezone ?? input.timezone;
    if (r.authoredTimezone && r.authoredTimezone !== zone && !input.allowTimezoneReinterpretation) {
      return { ok: false, reason: 'timezone_changed', problems: [`resource ${r.resource.id}: the rules were authored in ${r.authoredTimezone} but are being read in ${zone}; review the change and confirm it explicitly`] };
    }
  }
  const { timezone, fromDate, toDate } = input;
  if (input.offering.archivedAt !== null) return emptyOk(timezone, ['offering_archived']);

  const offering = expandOwnerAvailability({ rules: input.offeringRules, exceptions: input.offeringExceptions }, fromDate, toDate, timezone);
  const ownedBy = (kind: 'offering' | 'resource', id: string) => (a: AvailabilityAdjustment): OwnedAdjustment => ({ ...a, owner: { kind, id } });
  const adjustments: OwnedAdjustment[] = offering.adjustments.map(ownedBy('offering', input.offering.id));
  if (offering.intervals.length === 0) return emptyOk(timezone, ['no_offering_availability'], [], adjustments);

  const notBefore = input.notBefore ? Date.parse(input.notBefore) : Number.NEGATIVE_INFINITY;
  const reasons: string[] = [];
  const free: ResourceFreeIntervals[] = [];
  const slots: FreeSlot[] = [];

  if (input.resources.length === 0) {
    free.push({ resourceId: null, timezone, intervals: offering.intervals });
    slots.push(...generateSlots(offering.intervals, offering.intervals, input.slot, null));
  } else {
    for (const r of [...input.resources].sort((a, b) => (a.resource.id < b.resource.id ? -1 : a.resource.id > b.resource.id ? 1 : 0))) {
      if (!r.resource.active) {
        reasons.push(`resource_inactive:${r.resource.id}`);
        free.push({ resourceId: r.resource.id, timezone: r.timezone ?? timezone, intervals: [] });
        continue;
      }
      const resourceZone = r.timezone ?? timezone;
      // The same zone: exactly the offering's range. Another zone: the same INSTANTS are needed, so read two days either side (the offsets of
      // any two zones differ by less than a day) and let the intersection clip; adjustments are kept for dates inside the requested range.
      const own =
        resourceZone === timezone
          ? expandOwnerAvailability(r, fromDate, toDate, timezone)
          : expandOwnerAvailability(r, addLocalDays(fromDate, -2), addLocalDays(toDate, 2), resourceZone);
      adjustments.push(...own.adjustments.filter(a => a.date >= fromDate && a.date <= toDate).map(ownedBy('resource', r.resource.id)));
      if (own.intervals.length === 0) reasons.push(`resource_no_availability:${r.resource.id}`);
      const both = intersectIntervals(offering.intervals, own.intervals);
      const open = subtractHolds(both, r.holds, r.resource.id);
      free.push({ resourceId: r.resource.id, timezone: resourceZone, intervals: open });
      slots.push(...generateSlots(offering.intervals, open, input.slot, r.resource.id));
    }
  }

  const kept = slots
    .filter(s => Date.parse(s.startsAt) >= notBefore)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : (a.resourceId ?? '') < (b.resourceId ?? '') ? -1 : (a.resourceId ?? '') > (b.resourceId ?? '') ? 1 : 0));
  return { ok: true, timezone, free, slots: kept, adjustments, reasons };
}

// ─── Timezone change review ─────────────────────────────────────────────────

export interface TimezoneChangeReport {
  ok: true;
  from: IanaTimezone;
  to: IanaTimezone;
  /** UTC offset of each zone at local noon on the first and last date, in minutes. */
  offsetMinutes: { from: { first: number; last: number }; to: { first: number; last: number } };
  /** Slots that exist only under the old zone, only under the new zone, and under both. */
  slotsRemoved: number;
  slotsAdded: number;
  slotsUnchanged: number;
  /** Windows that land on a nonexistent or repeated local time under the NEW zone. */
  adjustmentsUnderNewZone: AvailabilityAdjustment[];
  /** True whenever the change moves any availability instant or hits a daylight-saving edge: the host must show this and confirm. */
  requiresConfirmation: boolean;
}

/**
 * The review that must precede any timezone change: the same rules, computed in the old and in the new zone, compared. It does not
 * change anything; the caller shows the result and, only once the change is confirmed, passes allowTimezoneReinterpretation.
 */
export function compareAvailabilityAcrossTimezones(input: AvailabilityInput, newTimezone: IanaTimezone): TimezoneChangeReport | Extract<AvailabilityComputation, { ok: false }> {
  const old = input.authoredTimezone ?? input.timezone;
  const confirmed = { allowTimezoneReinterpretation: true } as const;
  const before = computeAvailability({ ...input, ...confirmed, timezone: old, authoredTimezone: old });
  if (!before.ok) return before;
  const after = computeAvailability({ ...input, ...confirmed, timezone: newTimezone, authoredTimezone: old });
  if (!after.ok) return after;
  const key = (s: FreeSlot) => `${s.startsAt}|${s.endsAt}|${s.resourceId ?? ''}`;
  const oldKeys = new Set(before.slots.map(key));
  const newKeys = new Set(after.slots.map(key));
  const unchanged = [...newKeys].filter(k => oldKeys.has(k)).length;
  const noon = (zone: IanaTimezone, date: LocalDate) => offsetMinutesAt(Date.parse(resolveLocalTime(date, '12:00', zone).instant), zone);
  const report: TimezoneChangeReport = {
    ok: true,
    from: old,
    to: newTimezone,
    offsetMinutes: {
      from: { first: noon(old, input.fromDate), last: noon(old, input.toDate) },
      to: { first: noon(newTimezone, input.fromDate), last: noon(newTimezone, input.toDate) },
    },
    slotsRemoved: oldKeys.size - unchanged,
    slotsAdded: newKeys.size - unchanged,
    slotsUnchanged: unchanged,
    adjustmentsUnderNewZone: after.adjustments,
    requiresConfirmation: oldKeys.size !== unchanged || newKeys.size !== unchanged || after.adjustments.length > 0,
  };
  return report;
}
