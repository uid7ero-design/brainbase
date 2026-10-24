import {
  SchedulingError,
  getPreset,
  isIanaTimezone,
  normaliseEmail,
  resolveLocalTime,
  validateReservationForPreset,
  validateReservationSnapshot,
  type AssignedReservationInput,
  type AttendanceStatus,
  type CancellationOutcome,
  type CancellationRequest,
  type Clock,
  type CreateAssignedReservationResult,
  type CreateReservationResult,
  type NewReservationInput,
  type Reservation,
  type ResourceAssigningReservationRepository,
  type TenantContext,
  type TimeSpan,
} from '@scheduling/core';
import { translating } from './errors';
import type { SqlExecutor } from './executor';
import { isSelfService, newId as defaultNewId } from './support';

// ReservationRepository on raw SQL.
//
// Atomicity without interactive transactions: create() is ONE statement (a CTE writing the
// reservation and its resource hold together), cancel() is ONE UPDATE (the database releases
// the holds in a trigger), and the capacity and overlap checks live in the database
// (packages/scheduling/sql/010_shared_schema.sql), so the Neon HTTP driver is sufficient.
// Domain validation (shape, preset rules, email normalisation, local time vs instants) runs
// first and in TypeScript, independent of SQL.

// Selected as text so no driver (pg Date parsing, Neon) can reinterpret a date or instant.
const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const RESERVATION_COLUMNS = `
  r.id, r.organisation_id, r.schedule_id, r.preset_key, r.preset_version, r.offering_id, r.span_kind,
  r.occurrence_id, r.resource_id, r.series_id, r.customer_id, r.customer_name, r.customer_email,
  r.customer_email_normalised, r.customer_phone, r.timezone,
  r.local_start_date::text AS local_start_date, to_char(r.local_start_time, 'HH24:MI') AS local_start_time,
  r.local_end_date::text AS local_end_date, to_char(r.local_end_time, 'HH24:MI') AS local_end_time,
  ${ISO('r.starts_at')} AS starts_at, ${ISO('r.ends_at')} AS ends_at,
  r.party_size, r.status, r.attendance, r.payment_status, r.price_cents, r.currency, r.notes`;

interface ReservationRow {
  id: string;
  organisation_id: string;
  schedule_id: string;
  preset_key: Reservation['presetKey'];
  preset_version: number;
  offering_id: string;
  span_kind: 'occurrence' | 'slot' | 'stay';
  occurrence_id: string | null;
  resource_id: string | null;
  series_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_email_normalised: string | null;
  customer_phone: string | null;
  timezone: string;
  local_start_date: string;
  local_start_time: string;
  local_end_date: string;
  local_end_time: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  status: Reservation['status'];
  attendance: AttendanceStatus | null;
  payment_status: Reservation['paymentStatus'];
  price_cents: number;
  currency: string;
  notes: string | null;
}

export function toReservation(row: ReservationRow): Reservation {
  let span: TimeSpan;
  if (row.span_kind === 'occurrence') {
    span = { kind: 'occurrence', occurrenceId: row.occurrence_id as string };
  } else if (row.span_kind === 'slot') {
    span = {
      kind: 'slot',
      date: row.local_start_date,
      startTime: row.local_start_time,
      durationMinutes: Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000),
    };
  } else {
    span = { kind: 'stay', checkIn: row.local_start_date, checkOut: row.local_end_date };
  }
  return {
    id: row.id,
    organisationId: row.organisation_id,
    scheduleId: row.schedule_id,
    presetKey: row.preset_key,
    presetVersion: row.preset_version,
    offeringId: row.offering_id,
    resourceId: row.resource_id,
    customerId: row.customer_id,
    customerSnapshot: {
      displayName: row.customer_name,
      email: row.customer_email,
      emailNormalised: row.customer_email_normalised,
      phone: row.customer_phone,
    },
    timezone: row.timezone,
    instants: { startsAt: row.starts_at, endsAt: row.ends_at },
    participants: [{ customerId: row.customer_id, displayName: row.customer_name, role: 'primary' }],
    partySize: row.party_size,
    span,
    status: row.status,
    attendance: row.attendance,
    paymentStatus: row.payment_status,
    price: { amountCents: row.price_cents, currency: row.currency },
    seriesId: row.series_id,
    notes: row.notes,
  };
}

export interface ReservationRepositoryOptions {
  sql: SqlExecutor;
  clock: Clock;
  /** Id generator; defaults to crypto.randomUUID(). Injected so tests can be deterministic. */
  newId?: () => string;
}

export class PostgresReservationRepository implements ResourceAssigningReservationRepository {
  private readonly sql: SqlExecutor;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(options: ReservationRepositoryOptions) {
    this.sql = options.sql;
    this.clock = options.clock;
    this.newId = options.newId ?? defaultNewId;
  }

  private canRead(tenant: TenantContext): boolean {
    return tenant.can('scheduling.view');
  }

  async getById(tenant: TenantContext, reservationId: string): Promise<Reservation | null> {
    const rows = await this.sql.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM scheduling_reservations r WHERE r.organisation_id = $1 AND r.id = $2`,
      [tenant.organisationId, reservationId],
    );
    const found = rows[0] ? toReservation(rows[0]) : null;
    if (!found) return null;
    if (this.canRead(tenant)) return found;
    // A customer actor may read only their own reservation; anyone else sees "not found".
    if (tenant.actor.kind === 'customer' && found.customerId === tenant.actor.customerId) return found;
    return null;
  }

  async listForOccurrence(tenant: TenantContext, occurrenceId: string): Promise<Reservation[]> {
    if (!this.canRead(tenant)) throw new SchedulingError('permission_denied', 'scheduling.view is required');
    const rows = await this.sql.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM scheduling_reservations r
        WHERE r.organisation_id = $1 AND r.occurrence_id = $2 ORDER BY r.created_at, r.id`,
      [tenant.organisationId, occurrenceId],
    );
    return rows.map(toReservation);
  }

  async listForCustomer(tenant: TenantContext, customerId: string): Promise<Reservation[]> {
    const own = tenant.actor.kind === 'customer' && tenant.actor.customerId === customerId;
    if (!this.canRead(tenant) && !own) throw new SchedulingError('permission_denied', 'scheduling.view is required');
    const rows = await this.sql.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM scheduling_reservations r
        WHERE r.organisation_id = $1 AND r.customer_id = $2 ORDER BY r.starts_at, r.id`,
      [tenant.organisationId, customerId],
    );
    return rows.map(toReservation);
  }

  async create(tenant: TenantContext, input: NewReservationInput): Promise<CreateReservationResult> {
    const selfService = isSelfService(tenant);
    if (!tenant.can('scheduling.reserve') && !selfService) {
      throw new SchedulingError('permission_denied', 'scheduling.reserve is required');
    }
    const problems = this.validateInput(tenant, input);
    if (problems.length > 0) throw new SchedulingError('invalid_input', problems.join('; '));

    const key = input.idempotencyKey ?? null;
    if (key !== null) {
      const existing = await this.findByKey(tenant, key);
      if (existing) return this.replayOrConflict(existing, input);
    }

    const snap = input.customerSnapshot;
    const contactLink = input.contactLink ?? (input.customerId === null ? 'none' : 'matched');
    const occurrenceId = input.span.kind === 'occurrence' ? input.span.occurrenceId : null;
    const resourceId = occurrenceId === null ? input.resourceId : null;

    let rows: ReservationRow[];
    try {
      rows = await translating(() =>
        this.sql.query<ReservationRow>(CREATE_SQL, [
          tenant.organisationId, // $1
          this.newId(), // $2
          input.scheduleId, // $3
          input.presetKey, // $4
          input.presetVersion, // $5
          input.offeringId, // $6
          input.span.kind, // $7
          occurrenceId, // $8
          resourceId, // $9
          input.seriesId, // $10
          input.customerId, // $11
          snap.displayName.trim(), // $12
          snap.email, // $13
          snap.emailNormalised, // $14
          snap.phone, // $15
          contactLink, // $16
          input.timezone, // $17
          input.instants.startsAt, // $18
          input.instants.endsAt, // $19
          input.partySize, // $20
          input.price.amountCents, // $21
          input.price.currency, // $22
          input.notes, // $23
          key, // $24
          actorLabel(tenant), // $25
          selfService, // $26
          this.newId(), // $27 (hold id)
          getPreset(input.presetKey).resources.kinds, // $28 (resource kinds the preset accepts)
        ]),
      );
    } catch (err) {
      // A concurrent create with the same key may have won (the unique key or the capacity
      // check can fire for the loser); if the key now exists this is a replay, not a failure.
      if (key !== null && err instanceof SchedulingError) {
        const existing = await this.findByKey(tenant, key);
        if (existing) return this.replayOrConflict(existing, input);
      }
      if (err instanceof SchedulingError && ['capacity_exceeded', 'resource_conflict', 'duplicate_reservation', 'offering_unavailable', 'not_found'].includes(err.code)) {
        return { ok: false, reason: err.code as Extract<CreateReservationResult, { ok: false }>['reason'] };
      }
      throw err;
    }

    if (rows.length === 0) {
      // The INSERT selected nothing: the offering is missing, in another tenant, archived, or
      // (for self-service) its schedule is not published. Say "not found" only when it is absent.
      // A resource that does not exist in this tenant is "not found" (the same answer for another
      // tenant's resource); one that exists but is the wrong kind, inactive or not offered to a
      // customer is "offering_unavailable".
      const known = await this.sql.query<{ offering: boolean; resource: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2 AND schedule_id = $3) AS offering,
                ($4::text IS NULL OR EXISTS (SELECT 1 FROM scheduling_resources WHERE organisation_id = $1 AND id = $4)) AS resource`,
        [tenant.organisationId, input.offeringId, input.scheduleId, resourceId],
      );
      return { ok: false, reason: known[0]?.offering && known[0]?.resource ? 'offering_unavailable' : 'not_found' };
    }
    return { ok: true, reservation: toReservation(rows[0]) };
  }

  /**
   * Books an exclusive-resource preset, resolving the resource when the caller did not choose one.
   *
   * - With `resourceId`: that resource is used as given (create() still enforces tenant, the
   *   preset's resource kinds and, for customers, the offering link).
   * - Without: candidates are the offering's LINKED, ACTIVE resources of a kind the preset accepts
   *   that are free for the window right now, least-booked first. Each is tried in turn; a
   *   candidate lost to a concurrent booking (resource_conflict) wrote nothing, so the next is
   *   simply tried. At most MAX_ASSIGNMENT_ATTEMPTS are made, so it cannot loop.
   * - A resource is never created here. No linked resource at all is `offering_unavailable`
   *   (a configuration gap); linked resources that are all busy is `resource_conflict`.
   *
   * A repeated call with the same idempotencyKey returns the original reservation whichever
   * resource it was assigned, so a retry can never take a second one.
   */
  async createAssigned(tenant: TenantContext, input: AssignedReservationInput): Promise<CreateAssignedReservationResult> {
    const preset = getPreset(input.presetKey);
    if (preset.resources.requirement !== 'required' || input.span.kind === 'occurrence') {
      throw new SchedulingError('invalid_input', `${preset.key} reservations are not assigned a resource`);
    }
    const selfService = isSelfService(tenant);
    if (!tenant.can('scheduling.reserve') && !selfService) {
      throw new SchedulingError('permission_denied', 'scheduling.reserve is required');
    }
    const requested = input.resourceId ?? null;
    const problems = this.validateInput(tenant, { ...input, resourceId: requested ?? PENDING_ASSIGNMENT });
    if (problems.length > 0) throw new SchedulingError('invalid_input', problems.join('; '));

    const key = input.idempotencyKey ?? null;
    if (key !== null) {
      const existing = await this.findByKey(tenant, key);
      if (existing) {
        const same =
          existing.offeringId === input.offeringId &&
          existing.instants.startsAt === input.instants.startsAt &&
          existing.instants.endsAt === input.instants.endsAt &&
          existing.customerSnapshot.emailNormalised === input.customerSnapshot.emailNormalised &&
          (requested === null || existing.resourceId === requested);
        return same ? { ok: true, reservation: existing, replayed: true, assigned: requested === null } : { ok: false, reason: 'duplicate_reservation' };
      }
    }

    if (requested !== null) {
      const result = await this.create(tenant, { ...input, resourceId: requested });
      return result.ok ? { ...result, assigned: false } : result;
    }

    const candidates = await this.sql.query<{ id: string; busy: boolean }>(CANDIDATES_SQL, [
      tenant.organisationId,
      input.offeringId,
      input.scheduleId,
      preset.resources.kinds,
      input.instants.startsAt,
      input.instants.endsAt,
    ]);
    if (candidates.length === 0) return { ok: false, reason: 'offering_unavailable' };
    for (const candidate of candidates.filter(c => !c.busy).slice(0, MAX_ASSIGNMENT_ATTEMPTS)) {
      const result = await this.create(tenant, { ...input, resourceId: candidate.id });
      if (result.ok) return { ...result, assigned: true };
      if (result.reason !== 'resource_conflict') return result;
    }
    return { ok: false, reason: 'resource_conflict' };
  }

  async cancel(tenant: TenantContext, request: CancellationRequest): Promise<CancellationOutcome> {
    const rows = await this.sql.query<{
      id: string;
      status: string;
      customer_id: string | null;
      series_id: string | null;
      starts_at: string;
      can_cancel: boolean;
    }>(
      `SELECT r.id, r.status, r.customer_id, r.series_id, ${ISO('r.starts_at')} AS starts_at,
              COALESCE((s.cancellation_policy ->> 'customerCanCancel')::boolean, false) AS can_cancel
         FROM scheduling_reservations r
         JOIN scheduling_schedules s ON s.id = r.schedule_id AND s.organisation_id = r.organisation_id
        WHERE r.organisation_id = $1 AND r.id = $2`,
      [tenant.organisationId, request.reservationId],
    );
    const target = rows[0];
    const staff = tenant.can('scheduling.reserve');
    const owner = tenant.actor.kind === 'customer' && target?.customer_id === tenant.actor.customerId;
    if (!target || (!staff && !owner)) return { status: 'rejected', reason: 'not_found' };
    if (!staff && !target.can_cancel) return { status: 'rejected', reason: 'not_permitted' };
    if (target.status === 'cancelled') return { status: 'rejected', reason: 'already_cancelled' };
    if (!staff && Date.parse(target.starts_at) <= this.clock.now().getTime()) return { status: 'rejected', reason: 'in_the_past' };

    // Only still-live rows match, so two concurrent cancels cannot both "win". The database
    // trigger releases the resource holds in this same statement.
    const cancelled = await translating(() =>
      this.sql.query<{ id: string }>(
        `UPDATE scheduling_reservations u
            SET status = 'cancelled', cancelled_by = $3, cancel_reason = $4
          WHERE u.organisation_id = $1 AND u.status IN ('pending', 'confirmed')
            AND (u.id = $2
                 OR ($5 = 'this_and_future' AND u.series_id IS NOT NULL
                     AND u.series_id = (SELECT x.series_id FROM scheduling_reservations x WHERE x.organisation_id = $1 AND x.id = $2)
                     AND u.starts_at >= (SELECT x.starts_at FROM scheduling_reservations x WHERE x.organisation_id = $1 AND x.id = $2)))
        RETURNING u.id`,
        [tenant.organisationId, request.reservationId, request.cancelledBy, request.reason, request.scope],
      ),
    );
    if (cancelled.length === 0) return { status: 'rejected', reason: 'already_cancelled' };
    // Late-cancellation charges are pricing policy (Phase 2D), so 2A reports no charge.
    return { status: 'cancelled', cancelledReservationIds: cancelled.map(r => r.id).sort(), charge: null };
  }

  async setAttendance(tenant: TenantContext, reservationId: string, attendance: AttendanceStatus | null): Promise<Reservation | null> {
    if (!tenant.can('scheduling.attendance')) throw new SchedulingError('permission_denied', 'scheduling.attendance is required');
    const rows = await translating(() =>
      this.sql.query<{ id: string }>(
        `UPDATE scheduling_reservations SET attendance = $3
          WHERE organisation_id = $1 AND id = $2 AND status <> 'cancelled' RETURNING id`,
        [tenant.organisationId, reservationId, attendance],
      ),
    );
    if (rows.length === 0) return null;
    return this.getById(tenant, reservationId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async findByKey(tenant: TenantContext, key: string): Promise<Reservation | null> {
    const rows = await this.sql.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM scheduling_reservations r WHERE r.organisation_id = $1 AND r.idempotency_key = $2`,
      [tenant.organisationId, key],
    );
    return rows[0] ? toReservation(rows[0]) : null;
  }

  /** Same key and same request -> the original reservation. Same key, different request -> refuse. */
  private replayOrConflict(existing: Reservation, input: NewReservationInput): CreateReservationResult {
    const sameTarget =
      existing.offeringId === input.offeringId &&
      existing.instants.startsAt === input.instants.startsAt &&
      existing.instants.endsAt === input.instants.endsAt &&
      existing.resourceId === (input.span.kind === 'occurrence' ? null : input.resourceId) &&
      existing.customerSnapshot.emailNormalised === input.customerSnapshot.emailNormalised;
    return sameTarget ? { ok: true, reservation: existing, replayed: true } : { ok: false, reason: 'duplicate_reservation' };
  }

  /** Domain validation, independent of SQL. Returns every problem found. */
  private validateInput(tenant: TenantContext, input: NewReservationInput): string[] {
    const candidate: Reservation = {
      id: 'candidate',
      organisationId: tenant.organisationId,
      scheduleId: input.scheduleId,
      presetKey: input.presetKey,
      presetVersion: input.presetVersion,
      offeringId: input.offeringId,
      resourceId: input.resourceId,
      customerId: input.customerId,
      customerSnapshot: input.customerSnapshot,
      timezone: input.timezone,
      instants: input.instants,
      participants: [],
      partySize: input.partySize,
      span: input.span,
      status: 'confirmed',
      attendance: null,
      paymentStatus: 'unpaid',
      price: input.price,
      seriesId: input.seriesId,
      notes: input.notes,
    };
    const problems = [...validateReservationSnapshot(candidate)];
    if (problems.length > 0) return problems; // later checks assume a well-formed candidate
    problems.push(...validateReservationForPreset(candidate, getPreset(input.presetKey)));

    const snap = input.customerSnapshot;
    if (snap.email !== null && normaliseEmail(snap.email) === null) problems.push('customerSnapshot.email is not a valid email address');
    if (!/^[A-Z]{3}$/.test(input.price.currency)) problems.push('price.currency must be a 3-letter ISO 4217 code');
    if (input.span.kind !== 'occurrence' && input.resourceId === null) problems.push('a slot or stay reservation needs a resourceId');
    if (input.span.kind === 'occurrence' && input.resourceId !== null) problems.push('an occurrence reservation holds the occurrence, not a resource');
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && input.idempotencyKey.trim() === '') problems.push('idempotencyKey must not be blank');

    // The local wall-clock span must agree with the instants in the stated timezone, and a
    // staff-entered slot must not sit in a DST gap (the database would resolve it silently).
    if (isIanaTimezone(input.timezone)) {
      if (input.span.kind === 'slot') {
        const start = resolveLocalTime(input.span.date, input.span.startTime, input.timezone);
        if (start.kind === 'gap') problems.push(`${input.span.date} ${input.span.startTime} does not exist in ${input.timezone}`);
        else if (start.instant !== input.instants.startsAt) problems.push('span start does not match instants.startsAt in the stated timezone');
        const minutes = (Date.parse(input.instants.endsAt) - Date.parse(input.instants.startsAt)) / 60000;
        if (minutes !== input.span.durationMinutes) problems.push('span durationMinutes does not match the instants');
      } else if (input.span.kind === 'stay') {
        const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
        if (localDate(input.instants.startsAt) !== input.span.checkIn) problems.push('stay checkIn does not match instants.startsAt in the stated timezone');
        if (localDate(input.instants.endsAt) !== input.span.checkOut) problems.push('stay checkOut does not match instants.endsAt in the stated timezone');
      }
    }
    return problems;
  }
}

function actorLabel(tenant: TenantContext): string {
  const a = tenant.actor;
  switch (a.kind) {
    case 'staff':
      return `staff:${a.userId}`;
    case 'customer':
      return `customer:${a.customerId}`;
    default:
      return a.kind;
  }
}

/** A placeholder that satisfies "a slot needs a resourceId" while the real one is still being chosen. */
const PENDING_ASSIGNMENT = 'pending-assignment';
/** Upper bound on candidates tried for one booking; far above any realistic provider count. */
const MAX_ASSIGNMENT_ATTEMPTS = 25;

// The offering's linked, active resources of a permitted kind, with whether each is already held
// during the window. Tenant-scoped on every table. A soft filter only: the exclusion constraint at
// insert time is what decides, so a stale "free" costs one more attempt, never a double booking.
// Ordered by how booked the resource is in the 12 hours either side (spreads load), then id.
const CANDIDATES_SQL = `
SELECT rs.id,
       EXISTS (SELECT 1 FROM scheduling_resource_holds h
                WHERE h.organisation_id = rs.organisation_id AND h.resource_id = rs.id AND h.released_at IS NULL
                  AND h.during && tstzrange($5::timestamptz, $6::timestamptz, '[)')) AS busy
  FROM scheduling_offerings o
  JOIN scheduling_offering_resources l ON l.organisation_id = o.organisation_id AND l.offering_id = o.id
  JOIN scheduling_resources rs ON rs.organisation_id = l.organisation_id AND rs.id = l.resource_id
 WHERE o.organisation_id = $1::text AND o.id = $2::text AND o.schedule_id = $3::text
   AND o.archived_at IS NULL AND rs.active AND rs.kind = ANY($4::text[])
 ORDER BY (SELECT count(*) FROM scheduling_resource_holds h2
            WHERE h2.organisation_id = rs.organisation_id AND h2.resource_id = rs.id AND h2.released_at IS NULL
              AND h2.during && tstzrange($5::timestamptz - interval '12 hours', $5::timestamptz + interval '12 hours', '[)')),
          rs.id`;

// One statement: the reservation and its resource hold are written together, so there is no
// instant at which one exists without the other, and every capacity / overlap / tenant check
// fires inside this statement. Local wall-clock columns are derived from the instants and the
// timezone, so they cannot disagree with them. Self-service actors (public, customer) can only
// book a PUBLISHED schedule. `RETURNING` is read back through the formatting select below.
const CREATE_SQL = `
WITH res AS (
  INSERT INTO scheduling_reservations (
    id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind,
    occurrence_id, resource_id, series_id, customer_id, customer_name, customer_email,
    customer_email_normalised, customer_phone, contact_link, timezone,
    local_start_date, local_start_time, local_end_date, local_end_time,
    starts_at, ends_at, party_size, price_cents, currency, notes, idempotency_key, created_by)
  SELECT $2::text, o.organisation_id, o.schedule_id, $4::text, $5::int, o.id, $7::text,
         $8::text, $9::text, $10::text, $11::text, $12::text, $13::text,
         $14::text, $15::text, $16::text, $17::text,
         ($18::timestamptz AT TIME ZONE $17::text)::date, ($18::timestamptz AT TIME ZONE $17::text)::time,
         ($19::timestamptz AT TIME ZONE $17::text)::date, ($19::timestamptz AT TIME ZONE $17::text)::time,
         $18::timestamptz, $19::timestamptz, $20::int, $21::int, $22::text, $23::text, $24::text, $25::text
    FROM scheduling_offerings o
    JOIN scheduling_schedules s ON s.id = o.schedule_id AND s.organisation_id = o.organisation_id
   WHERE o.id = $6::text AND o.organisation_id = $1::text AND o.schedule_id = $3::text
     AND o.archived_at IS NULL AND s.archived_at IS NULL
     AND ($26::boolean = false OR s.public_slug IS NOT NULL)
     -- The resource, when there is one, must be of a kind the preset accepts; a customer or the
     -- public may additionally use only an active resource the offering is linked to.
     AND ($9::text IS NULL OR EXISTS (
           SELECT 1 FROM scheduling_resources rs
            WHERE rs.organisation_id = o.organisation_id AND rs.id = $9::text AND rs.kind = ANY($28::text[])
              AND ($26::boolean = false OR (rs.active AND EXISTS (
                     SELECT 1 FROM scheduling_offering_resources l
                      WHERE l.organisation_id = o.organisation_id AND l.offering_id = o.id AND l.resource_id = rs.id
                      FOR SHARE)))))
  RETURNING *
), hold AS (
  INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
  SELECT $27::text, r.organisation_id, r.resource_id, tstzrange(r.starts_at, r.ends_at, '[)'), r.id
    FROM res r WHERE r.resource_id IS NOT NULL
  RETURNING id
)
SELECT ${RESERVATION_COLUMNS} FROM res r`;
