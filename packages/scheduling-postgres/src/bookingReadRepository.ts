import {
  BOOKING_READ_LIMITS,
  SchedulingError,
  buildBookingOverlay,
  decodeBookingCursor,
  resolvePageSize,
  toPage,
  validateBookingRange,
  type BookingOverlay,
  type BookingReadQuery,
  type OccurrenceWithHeadcount,
  type OverlayHoldInput,
  type Page,
  type Reservation,
  type TenantContext,
  type ViewerReservation,
} from '@scheduling/core';
import type { SqlExecutor } from './executor';
import { RESERVATION_COLUMNS, toReservation } from './reservationRepository';

// Phase 2C.2: the READ side of bookings. Every method here is a single SELECT, tenant scoped before anything else, bounded in range, resource count and page size, and
// never writes. Nothing in this file contains INSERT, UPDATE, DELETE or a function call that writes; tests/bookingReads.integration.test.ts runs every method on a
// connection that is READ ONLY at the server, so a write would fail there, and compares a content hash of every Scheduling table before and after.
//
// WHO SEES WHAT
//   scheduling.view     occurrences (with headcount), VIEWER-REDUCED reservations (no customer column is selected at all), live holds, and the overlay built from them.
//   scheduling.reserve  additionally the full reservation detail (customer snapshot, notes, payment). A different method, so a viewer path cannot reach it by accident.
// The tenant is only ever the one the host authenticated (tenant.organisationId); no argument carries an organisation.
//
// SEMANTICS
//   * "in range" = overlaps the half-open instant range [fromInstant, toInstant) (a thing that ends exactly at fromInstant, or starts exactly at toInstant, is not in it);
//   * order = (start instant, id); a page's cursor is the last row's (start, id) at microsecond precision, so rows added or cancelled between pages cannot make a
//     boundary skip or repeat a row;
//   * a session with no resource is returned like any other (resourceId null): a resource filter narrows resource-bound things and never hides it;
//   * cancelled things are returned only when asked for; a live hold is returned only while it is live (a released hold is not occupied time).

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const MICRO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const denied = (what: string) => new SchedulingError('permission_denied', `${what} is required`);
const invalid = (problems: string[]) => new SchedulingError('invalid_input', problems.join('; '));

export interface BookingReadRepositoryOptions {
  sql: SqlExecutor;
}

interface PreparedQuery {
  from: string;
  to: string;
  offeringId: string | null;
  resourceIds: string[] | null;
  includeCancelled: boolean;
  size: number;
  after: { startsAt: string; id: string } | null;
}

function prepare(query: BookingReadQuery): PreparedQuery {
  const problems = validateBookingRange(query, query.resourceIds);
  const page = resolvePageSize(query.limit);
  if (!page.ok) problems.push(page.problem);
  let after: PreparedQuery['after'] = null;
  if (query.after !== null && query.after !== undefined) {
    after = decodeBookingCursor(query.after);
    if (!after) problems.push('after is not a valid cursor');
  }
  if (query.offeringId !== undefined && query.offeringId !== null && (typeof query.offeringId !== 'string' || query.offeringId === '' || query.offeringId.length > 128)) problems.push('offeringId must be a non-empty string of at most 128 characters');
  if (problems.length > 0 || !page.ok) throw invalid(problems);
  return {
    from: query.fromInstant,
    to: query.toInstant,
    offeringId: query.offeringId ?? null,
    resourceIds: query.resourceIds && query.resourceIds.length > 0 ? [...new Set(query.resourceIds)] : null,
    includeCancelled: query.includeCancelled === true,
    size: page.size,
    after,
  };
}

interface OccurrenceRow {
  id: string;
  offering_id: string;
  offering_name: string;
  resource_id: string | null;
  local_date: string;
  start_time: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  cursor_at: string;
  capacity: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  live_headcount: number;
}

interface ViewerReservationRow {
  id: string;
  offering_id: string;
  offering_name: string;
  span_kind: 'occurrence' | 'slot' | 'stay';
  occurrence_id: string | null;
  resource_id: string | null;
  timezone: string;
  starts_at: string;
  ends_at: string;
  cursor_at: string;
  cancelled: boolean;
}

interface HoldRow {
  id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  cursor_at: string;
  reservation_id: string | null;
  occurrence_id: string | null;
}

export type ReducedReservation = ViewerReservation & { offeringName: string };

export class PostgresBookingReadRepository {
  private readonly sql: SqlExecutor;

  constructor(options: BookingReadRepositoryOptions) {
    this.sql = options.sql;
  }

  private view(tenant: TenantContext): void {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
  }

  /** Dated occurrences in range, each with its live headcount (the sum of party sizes of its non-cancelled reservations). Needs scheduling.view. */
  async listOccurrencesInRange(tenant: TenantContext, query: BookingReadQuery): Promise<Page<OccurrenceWithHeadcount>> {
    this.view(tenant);
    const q = prepare(query);
    const rows = await this.sql.query<OccurrenceRow>(
      `SELECT o.id, o.offering_id, f.name AS offering_name, o.resource_id, o.local_date::text AS local_date, to_char(o.local_start_time, 'HH24:MI') AS start_time, o.timezone,
              ${ISO('o.starts_at')} AS starts_at, ${ISO('o.ends_at')} AS ends_at, ${MICRO('o.starts_at')} AS cursor_at, o.capacity, o.status,
              COALESCE((SELECT SUM(r.party_size) FROM scheduling_reservations r
                         WHERE r.organisation_id = o.organisation_id AND r.occurrence_id = o.id AND r.status <> 'cancelled'), 0)::int AS live_headcount
         FROM scheduling_occurrences o
         JOIN scheduling_offerings f ON f.id = o.offering_id AND f.organisation_id = o.organisation_id
        WHERE o.organisation_id = $1
          AND o.starts_at < $3::timestamptz AND o.ends_at > $2::timestamptz
          AND ($4::text IS NULL OR o.offering_id = $4)
          AND ($5::text[] IS NULL OR o.resource_id IS NULL OR o.resource_id = ANY($5::text[]))
          AND ($6::boolean OR o.status <> 'cancelled')
          AND ($7::timestamptz IS NULL OR (o.starts_at, o.id) > ($7::timestamptz, $8::text))
        ORDER BY o.starts_at, o.id
        LIMIT $9`,
      [tenant.organisationId, q.from, q.to, q.offeringId, q.resourceIds, q.includeCancelled, q.after?.startsAt ?? null, q.after?.id ?? null, q.size + 1],
    );
    const cursors = new Map(rows.map(r => [r.id, r.cursor_at]));
    return toPage<OccurrenceWithHeadcount>(
      rows.map(r => ({
        id: r.id,
        organisationId: tenant.organisationId,
        offeringId: r.offering_id,
        offeringName: r.offering_name,
        resourceId: r.resource_id,
        date: r.local_date,
        startTime: r.start_time,
        timezone: r.timezone,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        durationMinutes: Math.round((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60000),
        capacity: r.capacity,
        status: r.status,
        liveHeadcount: r.live_headcount,
      })),
      q.size,
      r => ({ startsAt: cursors.get(r.id) as string, id: r.id }),
    );
  }

  /**
   * Reservations in range reduced to what ANY viewer may see (ViewerReservation). The statement selects no customer column at all, so there is nothing to redact: the
   * name, email, phone, customer id, notes, payment, attendance, series and creator are never read from the table. Needs scheduling.view.
   */
  async listReservationsInRange(tenant: TenantContext, query: BookingReadQuery & { kind?: 'enrolment' | 'booking' | null }): Promise<Page<ReducedReservation>> {
    this.view(tenant);
    const q = prepare(query);
    const kind = query.kind ?? null;
    if (kind !== null && kind !== 'enrolment' && kind !== 'booking') throw invalid(['kind must be enrolment or booking']);
    const rows = await this.sql.query<ViewerReservationRow>(
      `SELECT r.id, r.offering_id, f.name AS offering_name, r.span_kind, r.occurrence_id, r.resource_id, r.timezone,
              ${ISO('r.starts_at')} AS starts_at, ${ISO('r.ends_at')} AS ends_at, ${MICRO('r.starts_at')} AS cursor_at, (r.status = 'cancelled') AS cancelled
         FROM scheduling_reservations r
         JOIN scheduling_offerings f ON f.id = r.offering_id AND f.organisation_id = r.organisation_id
        WHERE r.organisation_id = $1
          AND r.starts_at < $3::timestamptz AND r.ends_at > $2::timestamptz
          AND ($4::text IS NULL OR r.offering_id = $4)
          AND ($5::text[] IS NULL OR r.resource_id IS NULL OR r.resource_id = ANY($5::text[]))
          AND ($6::boolean OR r.status <> 'cancelled')
          AND ($10::text IS NULL OR (CASE WHEN r.span_kind = 'occurrence' THEN 'enrolment' ELSE 'booking' END) = $10)
          AND ($7::timestamptz IS NULL OR (r.starts_at, r.id) > ($7::timestamptz, $8::text))
        ORDER BY r.starts_at, r.id
        LIMIT $9`,
      [tenant.organisationId, q.from, q.to, q.offeringId, q.resourceIds, q.includeCancelled, q.after?.startsAt ?? null, q.after?.id ?? null, q.size + 1, kind],
    );
    const cursors = new Map(rows.map(r => [r.id, r.cursor_at]));
    return toPage<ReducedReservation>(
      rows.map(r => ({
        id: r.id,
        offeringId: r.offering_id,
        offeringName: r.offering_name,
        kind: r.occurrence_id !== null ? ('enrolment' as const) : ('booking' as const),
        occurrenceId: r.occurrence_id,
        resourceId: r.resource_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        timezone: r.timezone,
        state: r.cancelled ? ('cancelled' as const) : ('booked' as const),
      })),
      q.size,
      r => ({ startsAt: cursors.get(r.id) as string, id: r.id }),
    );
  }

  /**
   * FULL reservation detail in range (customer snapshot, notes, payment). Staff who may reserve only: a viewer is refused before any SQL runs. The same bounds, order
   * and cursor as the reduced read.
   */
  async listReservationDetailsInRange(tenant: TenantContext, query: BookingReadQuery): Promise<Page<Reservation>> {
    this.view(tenant);
    if (!tenant.can('scheduling.reserve')) throw denied('scheduling.reserve');
    const q = prepare(query);
    const rows = await this.sql.query<Parameters<typeof toReservation>[0] & { cursor_at: string }>(
      `SELECT ${RESERVATION_COLUMNS}, ${MICRO('r.starts_at')} AS cursor_at
         FROM scheduling_reservations r
        WHERE r.organisation_id = $1
          AND r.starts_at < $3::timestamptz AND r.ends_at > $2::timestamptz
          AND ($4::text IS NULL OR r.offering_id = $4)
          AND ($5::text[] IS NULL OR r.resource_id IS NULL OR r.resource_id = ANY($5::text[]))
          AND ($6::boolean OR r.status <> 'cancelled')
          AND ($7::timestamptz IS NULL OR (r.starts_at, r.id) > ($7::timestamptz, $8::text))
        ORDER BY r.starts_at, r.id
        LIMIT $9`,
      [tenant.organisationId, q.from, q.to, q.offeringId, q.resourceIds, q.includeCancelled, q.after?.startsAt ?? null, q.after?.id ?? null, q.size + 1],
    );
    const cursors = new Map(rows.map(r => [r.id, r.cursor_at]));
    return toPage(rows.map(toReservation), q.size, r => ({ startsAt: cursors.get(r.id) as string, id: r.id }));
  }

  /** LIVE holds in range (occupied time), optionally for some resources. Needs scheduling.view. Carries no customer data: only ids and instants. */
  async listLiveHoldsInRange(tenant: TenantContext, query: BookingReadQuery): Promise<Page<OverlayHoldInput>> {
    this.view(tenant);
    const q = prepare(query);
    const rows = await this.sql.query<HoldRow>(
      `SELECT h.id, h.resource_id, ${ISO('lower(h.during)')} AS starts_at, ${ISO('upper(h.during)')} AS ends_at, ${MICRO('lower(h.during)')} AS cursor_at, h.reservation_id, h.occurrence_id
         FROM scheduling_resource_holds h
        WHERE h.organisation_id = $1 AND h.released_at IS NULL
          AND h.during && tstzrange($2::timestamptz, $3::timestamptz, '[)')
          AND ($4::text[] IS NULL OR h.resource_id = ANY($4::text[]))
          AND ($5::timestamptz IS NULL OR (lower(h.during), h.id) > ($5::timestamptz, $6::text))
        ORDER BY lower(h.during), h.id
        LIMIT $7`,
      [tenant.organisationId, q.from, q.to, q.resourceIds, q.after?.startsAt ?? null, q.after?.id ?? null, q.size + 1],
    );
    const cursors = new Map(rows.map(r => [r.id, r.cursor_at]));
    return toPage<OverlayHoldInput>(
      rows.map(r => ({ id: r.id, resourceId: r.resource_id, startsAt: r.starts_at, endsAt: r.ends_at, reservationId: r.reservation_id, occurrenceId: r.occurrence_id })),
      q.size,
      r => ({ startsAt: cursors.get(r.id) as string, id: r.id }),
    );
  }

  /**
   * The committed-bookings overlay for a calendar window: occurrences, slot bookings and live holds, arranged by buildBookingOverlay. THREE statements, however many
   * resources there are, run together. Not paginated: each part is capped at `limit` (default and maximum from BOOKING_READ_LIMITS) and `truncated` says so when a cap
   * cut something off. Carries no customer data for any role. Needs scheduling.view. It never writes, and it never calls the availability computation: the two layers stay apart.
   */
  async readBookingOverlay(tenant: TenantContext, query: Omit<BookingReadQuery, 'after'>): Promise<BookingOverlay> {
    this.view(tenant);
    prepare({ ...query, after: null }); // validate once, before three statements are sent
    const base = { ...query, after: null };
    const [occurrences, slots, holds] = await Promise.all([
      this.listOccurrencesInRange(tenant, base),
      this.listReservationsInRange(tenant, { ...base, kind: 'booking' }),
      this.listLiveHoldsInRange(tenant, base),
    ]);
    return buildBookingOverlay({
      range: { fromInstant: query.fromInstant, toInstant: query.toInstant },
      occurrences: occurrences.items,
      slotBookings: slots.items,
      holds: holds.items,
      truncated: { occurrences: occurrences.nextCursor !== null, slotBookings: slots.nextCursor !== null, holds: holds.nextCursor !== null },
    });
  }
}

export { BOOKING_READ_LIMITS };
