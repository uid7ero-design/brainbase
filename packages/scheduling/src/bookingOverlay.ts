import type { StoredOccurrence } from './persistence';
import type { InstantWindow, LocalDate, LocalTime, OccurrenceStatus, Reservation } from './types';

// Phase 2C.2: the READ side of bookings. Pure data shapes and functions: no clock, no database, no host. A repository reads rows, these functions bound the request, reduce
// what a viewer may see, and arrange committed bookings for an operational calendar.
//
// TWO LAYERS, NEVER MERGED. The availability calculation (open hours, closures, bookable starts) is computed by availability.ts / availabilityCalendar.ts. The overlay built
// here shows what is COMMITTED: dated occurrences, slot bookings and the resource holds they own. A calendar screen draws both, one over the other; nothing here feeds
// bookings back into availability and nothing in availability reads a booking.
//
// WHAT A VIEWER MAY SEE. Never a customer name, email, phone, customer id, note, party composition, payment, attendance, series, cancellation reason, creator or idempotency
// key. The reduction is by WHITELIST (toViewerReservation builds a new object from named fields), the SQL behind a viewer read never selects those columns, and
// findIdentityLeaks is the last line: a host runs it on a body before sending it to anyone without scheduling.reserve and answers with an error instead if it finds anything.
// The overlay itself carries no customer data for ANY role (the calendar is the same for a viewer and a manager); full reservation detail is a separate read.

export const BOOKING_READ_LIMITS = {
  /** Longest range one read accepts (calendar-day arithmetic; DST changes make a day 23 or 25 hours, so the check allows an hour of slack). */
  maxRangeDays: 31,
  /** Most resources one read accepts a filter for. */
  maxResources: 100,
  defaultPageSize: 200,
  maxPageSize: 500,
} as const;

const HOUR_MS = 3_600_000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export interface BookingRange {
  /** Inclusive start instant, ISO-8601 ending in Z. */
  fromInstant: string;
  /** Exclusive end instant. A thing is in range when it overlaps the half-open [fromInstant, toInstant). */
  toInstant: string;
}

export interface BookingReadQuery extends BookingRange {
  /** Restrict to one offering. */
  offeringId?: string | null;
  /** Restrict resource-bound items to these resources (at most BOOKING_READ_LIMITS.maxResources). Absent = all. */
  resourceIds?: readonly string[] | null;
  /** Cancelled things are returned only when asked for. */
  includeCancelled?: boolean;
  /** Page size, 1..maxPageSize. */
  limit?: number | null;
  /** Opaque cursor from the previous page. */
  after?: string | null;
}

export function validateBookingRange(range: BookingRange, resourceIds?: readonly string[] | null): string[] {
  const problems: string[] = [];
  const from = typeof range.fromInstant === 'string' && ISO_INSTANT.test(range.fromInstant) ? Date.parse(range.fromInstant) : Number.NaN;
  const to = typeof range.toInstant === 'string' && ISO_INSTANT.test(range.toInstant) ? Date.parse(range.toInstant) : Number.NaN;
  if (Number.isNaN(from)) problems.push('fromInstant must be an ISO instant ending in Z');
  if (Number.isNaN(to)) problems.push('toInstant must be an ISO instant ending in Z');
  if (!Number.isNaN(from) && !Number.isNaN(to)) {
    if (to <= from) problems.push('toInstant must be after fromInstant');
    else if (to - from > BOOKING_READ_LIMITS.maxRangeDays * 24 * HOUR_MS + HOUR_MS) problems.push(`the range must be at most ${BOOKING_READ_LIMITS.maxRangeDays} days`);
  }
  if (resourceIds && resourceIds.length > BOOKING_READ_LIMITS.maxResources) problems.push(`at most ${BOOKING_READ_LIMITS.maxResources} resources can be asked for at once`);
  if (resourceIds && resourceIds.some(id => typeof id !== 'string' || id === '' || id.length > 128)) problems.push('resource ids must be non-empty strings of at most 128 characters');
  return problems;
}

/** The page size to use: the default when absent, otherwise a whole number from 1 to the maximum (anything else is a problem, not silently clamped). */
export function resolvePageSize(limit: number | null | undefined): { ok: true; size: number } | { ok: false; problem: string } {
  if (limit === null || limit === undefined) return { ok: true, size: BOOKING_READ_LIMITS.defaultPageSize };
  if (!Number.isInteger(limit) || limit < 1 || limit > BOOKING_READ_LIMITS.maxPageSize) return { ok: false, problem: `limit must be a whole number from 1 to ${BOOKING_READ_LIMITS.maxPageSize}` };
  return { ok: true, size: limit };
}

// ─── Keyset pagination ──────────────────────────────────────────────────────

export interface BookingCursor {
  startsAt: string;
  id: string;
}

const CURSOR_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** (start instant, id) is a total order, so a page boundary is stable while rows are added or cancelled between requests. */
export function encodeBookingCursor(cursor: BookingCursor): string {
  return `${cursor.startsAt}~${cursor.id}`;
}

/** null for anything that is not exactly an encoded cursor: a tampered cursor is a bad request, never a guess. */
export function decodeBookingCursor(raw: string | null | undefined): BookingCursor | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const at = raw.indexOf('~');
  if (at < 0) return null;
  const startsAt = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!ISO_INSTANT.test(startsAt) || Number.isNaN(Date.parse(startsAt)) || !CURSOR_ID.test(id)) return null;
  return { startsAt, id };
}

export interface Page<T> {
  items: T[];
  /** Present when more rows exist after this page. */
  nextCursor: string | null;
}

/**
 * Turns "limit + 1 rows" into a page. The extra row is never returned; it only proves there is a next page. `cursorOf` gives the (start instant, id) of a row at the
 * database's full precision, so a boundary inside one second cannot skip or repeat a row.
 */
export function toPage<T>(rows: readonly T[], size: number, cursorOf: (row: T) => BookingCursor): Page<T> {
  if (rows.length <= size) return { items: [...rows], nextCursor: null };
  const items = rows.slice(0, size);
  return { items, nextCursor: encodeBookingCursor(cursorOf(items[items.length - 1])) };
}

// ─── What is read ───────────────────────────────────────────────────────────

/** A dated occurrence with its current headcount (the sum of party sizes of its non-cancelled reservations). */
export interface OccurrenceWithHeadcount extends StoredOccurrence {
  offeringName: string;
  liveHeadcount: number;
}

/** A reservation reduced to what any viewer may see. */
export interface ViewerReservation {
  id: string;
  offeringId: string;
  /** 'enrolment' joins a dated occurrence; 'booking' holds a resource for a slot or stay. */
  kind: 'enrolment' | 'booking';
  occurrenceId: string | null;
  resourceId: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** Everything not cancelled is "booked": pending, confirmed, completed and no-show are staff detail. */
  state: 'booked' | 'cancelled';
}

/** Builds a ViewerReservation from named fields only. Nothing is copied wholesale, so a column added to Reservation later cannot leak through here. */
export function toViewerReservation(r: Reservation): ViewerReservation {
  const occurrenceId = r.span.kind === 'occurrence' ? r.span.occurrenceId : null;
  return {
    id: r.id,
    offeringId: r.offeringId,
    kind: occurrenceId !== null ? 'enrolment' : 'booking',
    occurrenceId,
    resourceId: r.resourceId,
    startsAt: r.instants.startsAt,
    endsAt: r.instants.endsAt,
    timezone: r.timezone,
    state: r.status === 'cancelled' ? 'cancelled' : 'booked',
  };
}

// ─── Identity guard ─────────────────────────────────────────────────────────

/** Property names that identify a customer or describe how a booking was handled. A viewer body must contain none of them, at any depth. */
export const IDENTITY_KEYS: readonly string[] = [
  'customerId', 'customerSnapshot', 'customerName', 'customerEmail', 'customerPhone', 'displayName', 'email', 'emailNormalised', 'phone', 'notes', 'participants', 'guestNames',
  'seriesId', 'paymentStatus', 'attendance', 'price', 'priceCents', 'cancelReason', 'cancelledBy', 'createdBy', 'idempotencyKey', 'contactLink', 'rescheduledFromId', 'partySize',
];

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function walkIdentity(value: unknown, path: string, depth: number, emailText: boolean, seen: WeakSet<object>): string[] {
  if (depth > 12) return [`${path} (too deep)`];
  if (typeof value === 'string') return emailText && EMAIL_LIKE.test(value) ? [`${path} (email-like text)`] : [];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [`${path} (cycle)`];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v, i) => walkIdentity(v, `${path}[${i}]`, depth + 1, emailText, seen));
  const leaks: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_KEYS.includes(key)) leaks.push(`${path}.${key}`);
    leaks.push(...walkIdentity(v, `${path}.${key}`, depth + 1, emailText, seen));
  }
  return leaks;
}

/**
 * The paths of anything in `value` that identifies a customer: a forbidden property name, or a string that looks like an email address. Empty = clean. Pure; walks
 * arrays and objects to a bounded depth (a cycle or an absurdly deep value is reported as a leak: fail closed).
 */
export function findIdentityLeaks(value: unknown): string[] {
  return walkIdentity(value, '$', 0, true, new WeakSet());
}

/**
 * The same walk by STRUCTURE only: a forbidden property name, a cycle or an absurd depth. Free text is not inspected, because a name a member of staff typed for an
 * offering or a resource ("Book via info@club.example") is configuration, not a customer, and must not take a calendar down. A route uses this as its fail-closed
 * guard; tests use findIdentityLeaks (which also looks for email-like text) against bodies built from known customer data.
 */
export function findIdentityKeyLeaks(value: unknown): string[] {
  return walkIdentity(value, '$', 0, false, new WeakSet());
}

// ─── The overlay ────────────────────────────────────────────────────────────

/** The owner of a live hold, as the holds table records it. */
export interface OverlayHoldInput {
  id: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  reservationId: string | null;
  occurrenceId: string | null;
}

export interface OverlayOccurrence {
  kind: 'occurrence';
  id: string;
  offeringId: string;
  offeringName: string;
  date: LocalDate;
  startTime: LocalTime;
  timezone: string;
  startsAt: string;
  endsAt: string;
  status: OccurrenceStatus;
  capacity: number;
  liveHeadcount: number;
  /** Places left, never negative. */
  remaining: number;
  /** 'resource': drawn in that resource's lane. 'unassigned_space': a session with no court or room; it occupies no resource and is drawn in its own row. */
  placement: 'resource' | 'unassigned_space';
  resourceId: string | null;
  /** The live hold that occupies the resource for this session, or null (no resource, or cancelled so the hold is released). */
  holdId: string | null;
}

export interface OverlayBooking {
  kind: 'booking';
  id: string;
  offeringId: string;
  offeringName: string;
  resourceId: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  state: 'booked' | 'cancelled';
  holdId: string | null;
}

/** Occupied time with no session or booking in this read to explain it (its owner is cancelled, filtered out, or outside the page). */
export interface OverlayHold {
  kind: 'hold';
  id: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  owner: 'occurrence' | 'booking' | 'unknown';
  ownerId: string | null;
}

export type OverlayItem = OverlayOccurrence | OverlayBooking | OverlayHold;

export interface OverlayLane {
  resourceId: string;
  items: OverlayItem[];
}

export interface BookingOverlay {
  range: BookingRange;
  /** One lane per resource that has anything in range, in resource id order. */
  lanes: OverlayLane[];
  /** Sessions with no resource, so no lane. Their enrolments count towards their headcount and have no block of their own. */
  unassignedSpace: OverlayOccurrence[];
  counts: { occurrences: number; slotBookings: number; holds: number; cancelled: number; unassignedSpace: number };
  /** A page limit cut something off: the caller must say so rather than present the view as complete. */
  truncated: { occurrences: boolean; slotBookings: boolean; holds: boolean };
}

export interface BuildOverlayInput {
  range: BookingRange;
  occurrences: readonly OccurrenceWithHeadcount[];
  /** Slot/stay bookings only (an enrolment is not a block: it is part of its session's headcount). */
  slotBookings: readonly (ViewerReservation & { offeringName: string })[];
  /** LIVE holds only (released holds are not occupied time). */
  holds: readonly OverlayHoldInput[];
  truncated?: { occurrences?: boolean; slotBookings?: boolean; holds?: boolean };
}

const ORDER: Record<OverlayItem['kind'], number> = { occurrence: 0, booking: 1, hold: 2 };
const byTime = (a: { startsAt: string; kind: OverlayItem['kind']; id: string }, b: { startsAt: string; kind: OverlayItem['kind']; id: string }) =>
  a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : ORDER[a.kind] - ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Arranges committed things for a calendar. Deterministic and pure: the same input gives the same output, the input is not modified, and no item carries customer data.
 *  - a session with a resource goes in that resource's lane; a session with none goes in `unassignedSpace`, never in a lane;
 *  - a slot booking goes in its resource's lane;
 *  - a live hold whose owner is in the read is represented by that owner (its `holdId` says so) and is not drawn twice; a hold with no owner in the read becomes an `OverlayHold`;
 *  - a cancelled session or booking keeps its place (flagged), and is never backed by a hold: released holds are not occupied time.
 */
export function buildBookingOverlay(input: BuildOverlayInput): BookingOverlay {
  const holdByOccurrence = new Map<string, OverlayHoldInput>();
  const holdByReservation = new Map<string, OverlayHoldInput>();
  for (const h of input.holds) {
    if (h.occurrenceId !== null) holdByOccurrence.set(h.occurrenceId, h);
    if (h.reservationId !== null) holdByReservation.set(h.reservationId, h);
  }
  const explained = new Set<string>();
  const lanes = new Map<string, OverlayItem[]>();
  const lane = (resourceId: string) => {
    let l = lanes.get(resourceId);
    if (!l) lanes.set(resourceId, (l = []));
    return l;
  };

  const unassignedSpace: OverlayOccurrence[] = [];
  let cancelled = 0;
  for (const o of input.occurrences) {
    const hold = o.status === 'cancelled' ? undefined : holdByOccurrence.get(o.id);
    if (hold) explained.add(hold.id);
    const item: OverlayOccurrence = {
      kind: 'occurrence',
      id: o.id,
      offeringId: o.offeringId,
      offeringName: o.offeringName,
      date: o.date,
      startTime: o.startTime,
      timezone: o.timezone,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      status: o.status,
      capacity: o.capacity,
      liveHeadcount: o.liveHeadcount,
      remaining: Math.max(0, o.capacity - o.liveHeadcount),
      placement: o.resourceId === null ? 'unassigned_space' : 'resource',
      resourceId: o.resourceId,
      holdId: hold?.id ?? null,
    };
    if (o.status === 'cancelled') cancelled++;
    if (o.resourceId === null) unassignedSpace.push(item);
    else lane(o.resourceId).push(item);
  }

  let bookings = 0;
  for (const b of input.slotBookings) {
    if (b.kind !== 'booking' || b.resourceId === null) continue; // an enrolment is a headcount, not a block
    const hold = b.state === 'cancelled' ? undefined : holdByReservation.get(b.id);
    if (hold) explained.add(hold.id);
    if (b.state === 'cancelled') cancelled++;
    bookings++;
    lane(b.resourceId).push({
      kind: 'booking',
      id: b.id,
      offeringId: b.offeringId,
      offeringName: b.offeringName,
      resourceId: b.resourceId,
      timezone: b.timezone,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      state: b.state,
      holdId: hold?.id ?? null,
    });
  }

  let holds = 0;
  for (const h of input.holds) {
    if (explained.has(h.id)) continue;
    holds++;
    lane(h.resourceId).push({
      kind: 'hold',
      id: h.id,
      resourceId: h.resourceId,
      startsAt: h.startsAt,
      endsAt: h.endsAt,
      owner: h.occurrenceId !== null ? 'occurrence' : h.reservationId !== null ? 'booking' : 'unknown',
      ownerId: h.occurrenceId ?? h.reservationId,
    });
  }

  unassignedSpace.sort(byTime);
  const ordered: OverlayLane[] = [...lanes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([resourceId, items]) => ({ resourceId, items: items.sort(byTime) }));
  return {
    range: { fromInstant: input.range.fromInstant, toInstant: input.range.toInstant },
    lanes: ordered,
    unassignedSpace,
    counts: {
      occurrences: input.occurrences.length,
      slotBookings: bookings,
      holds,
      cancelled,
      unassignedSpace: unassignedSpace.length,
    },
    truncated: { occurrences: input.truncated?.occurrences ?? false, slotBookings: input.truncated?.slotBookings ?? false, holds: input.truncated?.holds ?? false },
  };
}

/** True when an instant window overlaps a half-open range. Shared by readers and tests so "in range" has one definition. */
export function overlapsRange(span: InstantWindow, range: BookingRange): boolean {
  return Date.parse(span.startsAt) < Date.parse(range.toInstant) && Date.parse(span.endsAt) > Date.parse(range.fromInstant);
}
