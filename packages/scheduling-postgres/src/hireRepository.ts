import {
  SchedulingError,
  calendarExceptions,
  calendarRules,
  evaluateSlotBooking,
  hireFailure,
  hireFailureFromRefusal,
  hireRequestMatches,
  HireNotReadyError,
  normaliseHireCustomer,
  resolveLocalTime,
  sameHireBasis,
  validateHireRequest,
  HIRE_KEY_PATTERN,
  type Clock,
  type HireBasis,
  type HireFailure,
  type HireRepository,
  type HireRequest,
  type HireResult,
  type IanaTimezone,
  type Reservation,
  type TenantContext,
} from '@scheduling/core';
import { PostgresAvailabilityRepository } from './availabilityRepository';
import { PostgresSchedulingConfigRepository } from './configRepository';
import { sqlstateOf } from './errors';
import type { SqlExecutor } from './executor';
import { RESERVATION_COLUMNS, toReservation } from './reservationRepository';
import { newId as defaultNewId } from './support';

// PostgresHireRepository: the staff facility-hire booking (Phase 2C.3a). One method that matters, createHire; see docs/architecture/scheduling-phase2c3-facility-hire-design.md and
// scheduling-phase2c3-createhire-implementation.md.
//
// THE ORDER THAT MAKES IT SAFE. (1) read the BASIS (versions, edit tokens, state) in ONE statement; (2) read every input the decision uses (rules, closures, live holds) AFTERWARDS;
// (3) decide with the shared pure engine; (4) write with ONE guarded batch that locks and re-checks exactly what (1) read. Anything that changes availability between (1) and (4)
// moves a version or a token, and the guarded statement then inserts nothing. A decision can therefore only be stale in ways the statement detects.
//
// LOCK ORDER (the deadlock-freedom argument; docs/architecture/scheduling-phase2c3a-createhire.md section 4 and the stress test in hireRepository.integration.test.ts):
//   schedule row -> offering row -> resource row -> the resource's advisory lock -> offering version row -> resource version row -> (insert triggers: the advisory lock again, re-entrant).
// The first three and the advisory lock are the order 030-032 document for every other writer. The version rows come LAST because every writer that bumps one holds the advisory lock
// (resource and link writers) or the resource row (deactivation) first and takes the version row exclusively only afterwards. The earlier shape of this statement (versions first) was
// the other half of a cycle with all of them and the stress test found it (40P01 within seconds). Rows are FOR SHARE: hires do not block each other on them, a configuration writer
// waits for an in-flight hire and a hire that waited for a writer re-checks the writer's new row. Hires of one resource do serialise on its advisory lock, as they always did.
//
// TENANT SAFETY. Every statement here is scoped `organisation_id = $1` with $1 the session's organisation, on every table it touches, and the composite foreign keys make another
// organisation's row unreachable. A foreign id answers `not_found`, indistinguishable from an absent one.
//
// BOUNDED WAITING. The booking runs as a non-interactive transaction `[set_config(lock_timeout), set_config(statement_timeout), booking]`: the settings are transaction-local, so they
// cannot leak to another request and no (shared) role is altered. A lock wait that times out (55P03) wrote nothing and is retried a bounded number of times, each retry re-reading
// the basis from the start (the wait was most likely a configuration writer, so the old basis is probably stale). A statement timeout (57014) wrote nothing and is not retried.

export interface HireRepositoryOptions {
  sql: SqlExecutor;
  clock: Clock;
  newId?: () => string;
  /** Attempts per call when a lock wait times out. Default 3, never more than 5. */
  maxAttempts?: number;
  /** Server-side bounds, transaction-local. Defaults 2000 ms (lock) and 5000 ms (statement). */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  /** Test seam for the pause between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_HIRE_LOCK_TIMEOUT_MS = 2000;
export const DEFAULT_HIRE_STATEMENT_TIMEOUT_MS = 5000;
export const DEFAULT_HIRE_ATTEMPTS = 3;
const HOUR_MS = 3_600_000;
const token = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type ReservationRow = Parameters<typeof toReservation>[0];

// (1) The basis: ONE statement, so one snapshot, so the values are consistent with each other. $1 organisation, $2 offering, $3 resource.
export const HIRE_BASIS_SQL = `
SELECT o.id AS offering_id, o.schedule_id, o.duration_minutes, o.price_cents, o.currency,
       o.archived_at IS NOT NULL AS offering_archived, ${token('o.updated_at')} AS offering_token,
       s.preset_key, s.archived_at IS NOT NULL AS schedule_archived, s.timezone AS schedule_timezone, ${token('s.updated_at')} AS schedule_token,
       r.id AS resource_id, r.kind AS resource_kind, r.capacity AS resource_capacity, r.active AS resource_active,
       EXISTS (SELECT 1 FROM scheduling_offering_resources l WHERE l.organisation_id = o.organisation_id AND l.offering_id = o.id AND l.resource_id = r.id) AS linked,
       (SELECT v.version::text FROM scheduling_availability_versions v WHERE v.organisation_id = o.organisation_id AND v.owner_kind = 'offering' AND v.owner_id = o.id) AS offering_version,
       (SELECT v.version::text FROM scheduling_availability_versions v WHERE v.organisation_id = o.organisation_id AND v.owner_kind = 'resource' AND v.owner_id = r.id) AS resource_version,
       (SELECT z.timezone FROM scheduling_availability_zones z WHERE z.organisation_id = o.organisation_id AND z.offering_id = o.id) AS offering_zone,
       (SELECT z.timezone FROM scheduling_availability_zones z WHERE z.organisation_id = o.organisation_id AND z.resource_id = r.id) AS resource_zone
  FROM scheduling_offerings o
  JOIN scheduling_schedules s ON s.organisation_id = o.organisation_id AND s.id = o.schedule_id
  LEFT JOIN scheduling_resources r ON r.organisation_id = o.organisation_id AND r.id = $3::text
 WHERE o.organisation_id = $1::text AND o.id = $2::text`;

// (4) The guarded booking. One statement. An empty CTE anywhere in the chain makes the statement insert nothing (zero rows, no error): the caller then classifies why.
// $1 organisation, $2 offering, $3 offering version, $4 offering token, $5 schedule token, $6 resource, $7 resource version, $8 reservation id, $9 hold id, $10 starts, $11 ends,
// $12 zone, $13 party size, $14 name, $15 email, $16 normalised email, $17 phone, $18 notes, $19 idempotency key, $20 created by, $21 configured duration (minutes), $22 schedule id.
export const HIRE_GUARDED_SQL = `
WITH ls AS (
  SELECT s.id, s.preset_key, s.preset_version FROM scheduling_schedules s
   WHERE s.organisation_id = $1::text AND s.id = $22::text AND s.archived_at IS NULL AND s.updated_at = $5::timestamptz AND s.preset_key = 'resource_hire'
     FOR SHARE OF s
), lo AS (
  SELECT o.id, o.organisation_id, o.schedule_id, o.price_cents, o.currency FROM scheduling_offerings o, ls
   WHERE o.organisation_id = $1::text AND o.id = $2::text AND o.schedule_id = ls.id AND o.archived_at IS NULL AND o.updated_at = $4::timestamptz AND o.duration_minutes = $21::int
     FOR SHARE OF o
), lr AS (
  SELECT r.id FROM scheduling_resources r, lo
   WHERE r.organisation_id = $1::text AND r.id = $6::text AND r.active
     FOR SHARE OF r
), lk AS (
  SELECT pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || $1::text || ':' || $6::text, 0)) AS held FROM lr
), lov AS (
  SELECT 1 FROM scheduling_availability_versions v, lk
   WHERE v.organisation_id = $1::text AND v.owner_kind = 'offering' AND v.owner_id = $2::text AND v.version = $3::bigint
     FOR SHARE OF v
), lrv AS (
  SELECT 1 FROM scheduling_availability_versions v, lov
   WHERE v.organisation_id = $1::text AND v.owner_kind = 'resource' AND v.owner_id = $6::text AND v.version = $7::bigint
     FOR SHARE OF v
), res AS (
  INSERT INTO scheduling_reservations (
    id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind,
    occurrence_id, resource_id, series_id, customer_id, customer_name, customer_email,
    customer_email_normalised, customer_phone, contact_link, timezone,
    local_start_date, local_start_time, local_end_date, local_end_time,
    starts_at, ends_at, party_size, price_cents, currency, notes, idempotency_key, created_by)
  SELECT $8::text, lo.organisation_id, lo.schedule_id, ls.preset_key, ls.preset_version, lo.id, 'slot',
         NULL, lr.id, NULL, NULL, $14::text, $15::text,
         $16::text, $17::text, 'none', $12::text,
         ($10::timestamptz AT TIME ZONE $12::text)::date, ($10::timestamptz AT TIME ZONE $12::text)::time,
         ($11::timestamptz AT TIME ZONE $12::text)::date, ($11::timestamptz AT TIME ZONE $12::text)::time,
         $10::timestamptz, $11::timestamptz, $13::int, lo.price_cents, lo.currency, $18::text, $19::text, $20::text
    FROM ls, lo, lr, lrv
  ON CONFLICT (organisation_id, idempotency_key) DO NOTHING
  RETURNING *
), hold AS (
  INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
  SELECT $9::text, r.organisation_id, r.resource_id, tstzrange(r.starts_at, r.ends_at, '[)'), r.id FROM res r
  RETURNING id
)
SELECT ${RESERVATION_COLUMNS} FROM res r`;

const TIMEOUTS_SQL = `SELECT set_config('lock_timeout', $1, true) AS lock_timeout, set_config('statement_timeout', $2, true) AS statement_timeout`;

type Failure = HireFailure & { retry?: boolean };
type Attempt = HireResult | Failure;
type WriteError = { kind: 'failure'; failure: Failure } | { kind: 'resolve' } | { kind: 'unknown' } | { kind: 'throw' };

export class PostgresHireRepository implements HireRepository {
  private readonly sql: SqlExecutor;
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly availability: PostgresAvailabilityRepository;
  private readonly config: PostgresSchedulingConfigRepository;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HireRepositoryOptions) {
    this.sql = options.sql;
    this.clock = options.clock;
    this.newId = options.newId ?? defaultNewId;
    this.availability = new PostgresAvailabilityRepository({ sql: options.sql });
    this.config = new PostgresSchedulingConfigRepository({ sql: options.sql });
    this.maxAttempts = Math.min(5, Math.max(1, Math.trunc(options.maxAttempts ?? DEFAULT_HIRE_ATTEMPTS)));
    this.lockTimeoutMs = Math.max(1, Math.trunc(options.lockTimeoutMs ?? DEFAULT_HIRE_LOCK_TIMEOUT_MS));
    this.statementTimeoutMs = Math.max(1, Math.trunc(options.statementTimeoutMs ?? DEFAULT_HIRE_STATEMENT_TIMEOUT_MS));
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** Staff only, with the permission to book and to read what the decision reads. A customer or the public cannot hire through this method, whatever permissions they carry. */
  private authorise(tenant: TenantContext): void {
    if (tenant.actor.kind !== 'staff') throw new SchedulingError('permission_denied', 'a facility hire is made by staff');
    if (!tenant.can('scheduling.reserve')) throw new SchedulingError('permission_denied', 'scheduling.reserve is required');
    if (!tenant.can('scheduling.view')) throw new SchedulingError('permission_denied', 'scheduling.view is required');
  }

  async findHireByKey(tenant: TenantContext, idempotencyKey: string): Promise<Reservation | null> {
    this.authorise(tenant);
    if (typeof idempotencyKey !== 'string' || !HIRE_KEY_PATTERN.test(idempotencyKey)) return null;
    return this.findByKey(tenant, idempotencyKey);
  }

  async readHireBasis(tenant: TenantContext, offeringId: string, resourceId: string): Promise<HireBasis | null> {
    this.authorise(tenant);
    return basisOf(await this.readBasisRow(tenant, offeringId, resourceId));
  }

  async createHire(tenant: TenantContext, request: HireRequest): Promise<HireResult> {
    this.authorise(tenant);
    const problems = validateHireRequest(request);
    if (problems.length > 0) return hireFailure('validation', 'the request is not valid', { problems });
    if (typeof this.sql.transaction !== 'function') {
      // Running without the transaction-local timeouts would let a booking wait on a lock as long as the platform allows. Refuse; nothing was written.
      throw new HireNotReadyError('this SQL executor cannot run a transaction, which createHire needs to bound its own waiting');
    }
    let attempts = 0;
    for (;;) {
      attempts += 1;
      const result = await this.attempt(tenant, request);
      if (!result.ok && (result as Failure).retry && attempts < this.maxAttempts) {
        // Deterministic jitter from the key (this package reads no clock or random source): requests with different keys spread out, a retry of one key is repeatable.
        const jitter = [...request.idempotencyKey].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 40, 7);
        await this.sleep(40 * attempts + jitter);
        continue;
      }
      const clean = { ...result, attempts } as HireResult & { retry?: boolean };
      delete clean.retry;
      return clean;
    }
  }

  // ── one attempt: basis → inputs → decision → guarded write ─────────────────────────────────────────────────────────────────────────

  private async attempt(tenant: TenantContext, request: HireRequest): Promise<Attempt> {
    // An earlier call with this key (a retry, a double click, a lost response) is answered before anything else is read.
    const earlier = await this.findByKey(tenant, request.idempotencyKey);
    if (earlier) return this.replayOrConflict(earlier, request);

    // (1) basis
    const row = await this.readBasisRow(tenant, request.offeringId, request.resourceId);
    if (!row || !row.resource_id) return hireFailure('not_found', 'the offering or the resource was not found');
    const basis = basisOf(row);
    if (!basis) throw new HireNotReadyError('the availability version rows are missing for this offering or resource');
    if (request.basis && !sameHireBasis(request.basis, basis)) return hireFailure('availability_changed', 'the offered times changed since they were read', { basis });

    if (row.preset_key !== 'resource_hire') return hireFailure('preset_not_supported', 'this offering is not a facility hire');
    if (row.offering_archived || row.schedule_archived) return hireFailure('offering_unavailable', 'the offering is archived');
    if (!row.linked) return hireFailure('resource_not_eligible', 'the resource is not linked to this offering');
    if (!row.resource_active) return hireFailure('resource_inactive', 'the resource is not active');

    // Decision 7: only the offering's configured duration, and only starts on a grid the engine generates.
    const duration: number | null = row.duration_minutes === null ? null : Number(row.duration_minutes);
    if (duration === null || duration < 1) return hireFailure('duration_not_allowed', 'the offering has no configured duration');
    if (request.durationMinutes !== undefined && request.durationMinutes !== duration) return hireFailure('duration_not_allowed', `only the configured duration of ${duration} minutes can be booked`);
    const step = request.stepMinutes ?? duration;
    if (duration % step !== 0) return hireFailure('validation', 'stepMinutes must divide the duration', { problems: ['stepMinutes'] });

    const offeringZone = (row.offering_zone ?? row.schedule_timezone ?? tenant.timezone) as IanaTimezone;
    const resourceZone = (row.resource_zone ?? tenant.timezone) as IanaTimezone;
    let start: ReturnType<typeof resolveLocalTime>;
    try {
      start = resolveLocalTime(request.start.date, request.start.time, offeringZone);
    } catch {
      return hireFailure('validation', 'the start time or the offering zone is not valid', { problems: ['start'] });
    }
    if (start.kind === 'gap') return hireFailure('nonexistent_local_time', `${request.start.date} ${request.start.time} does not exist in ${offeringZone}`);
    const startsAt = start.instant;
    const endsAt = new Date(Date.parse(startsAt) + duration * 60000).toISOString().replace('.000Z', 'Z');

    // (2) inputs, read AFTER the basis
    const day = Date.parse(`${request.start.date}T00:00:00Z`);
    const [offeringRules, offeringExceptions, resourceRules, resourceExceptions, holds] = await Promise.all([
      this.availability.listRulesForOwners(tenant, 'offering', [request.offeringId]),
      this.availability.listExceptionsForOwners(tenant, 'offering', [request.offeringId]),
      this.availability.listRulesForOwners(tenant, 'resource', [request.resourceId]),
      this.availability.listExceptionsForOwners(tenant, 'resource', [request.resourceId]),
      this.config.listLiveHoldsForResources(tenant, [request.resourceId], new Date(day - 48 * HOUR_MS).toISOString(), new Date(day + 96 * HOUR_MS).toISOString()),
    ]);

    // (3) decision, by the same pure engine the calendar uses
    const decision = evaluateSlotBooking(
      {
        timezone: offeringZone,
        offering: { id: request.offeringId, archivedAt: null },
        offeringRules: calendarRules(tenant, offeringRules),
        offeringExceptions: calendarExceptions(tenant, offeringExceptions),
        resources: [
          {
            resource: { id: request.resourceId, active: true },
            timezone: resourceZone,
            rules: calendarRules(tenant, resourceRules),
            exceptions: calendarExceptions(tenant, resourceExceptions),
            holds,
          },
        ],
        stepMinutes: step,
        now: this.clock.now().toISOString(),
        presetKey: 'resource_hire',
        resourceDetails: new Map([[request.resourceId, { capacity: Number(row.resource_capacity), kind: row.resource_kind }]]),
        requirePinnedZones: true,
      },
      { interval: { startsAt, endsAt }, resourceId: request.resourceId, partySize: request.partySize },
    );
    if (!decision.ok) {
      // A hold-dependent refusal can be this very request's own booking: a concurrent call with the SAME key committed after the key was first looked up and before the holds
      // were read, so the engine sees the winner's hold and says "taken". The key is therefore asked again before that answer is given.
      if (decision.refusal.code === 'resource_conflict') {
        const winner = await this.findByKey(tenant, request.idempotencyKey);
        if (winner) return this.replayOrConflict(winner, request);
      }
      return hireFailureFromRefusal(decision.refusal.code, decision.refusal.message);
    }

    // (4) guarded write
    const customer = normaliseHireCustomer(request);
    const creator = `staff:${tenant.actor.kind === 'staff' ? tenant.actor.userId : 'unknown'}`;
    let rows: Array<Record<string, unknown>> = [];
    try {
      const out = await this.sql.transaction!([
        { text: TIMEOUTS_SQL, params: [`${this.lockTimeoutMs}ms`, `${this.statementTimeoutMs}ms`] },
        {
          text: HIRE_GUARDED_SQL,
          params: [
            tenant.organisationId, request.offeringId, basis.offeringVersion, basis.offeringToken, basis.scheduleToken, request.resourceId, basis.resourceVersion,
            this.newId(), this.newId(), startsAt, endsAt, offeringZone, request.partySize, customer.name, customer.email, customer.emailNormalised, customer.phone,
            customer.notes, request.idempotencyKey, creator, duration, String(row.schedule_id),
          ],
        },
      ]);
      rows = out[out.length - 1] ?? [];
    } catch (err) {
      const handled = classifyWriteError(err);
      if (handled.kind === 'throw') throw err;
      if (handled.kind === 'failure') {
        if (handled.failure.code === 'resource_conflict') return this.resolveByKey(tenant, request, false, handled.failure); // the hold it collided with may be its own twin's
        return handled.failure;
      }
      return this.resolveByKey(tenant, request, handled.kind === 'unknown');
    }

    if (rows.length === 1) return { ok: true, reservation: toReservation(rows[0] as unknown as ReservationRow), replayed: false };

    // Zero rows: the key already exists (a concurrent call with the same key won), or the basis went stale between the read and the lock. The key is checked first.
    const winner = await this.findByKey(tenant, request.idempotencyKey);
    if (winner) return this.replayOrConflict(winner, request);
    const fresh = basisOf(await this.readBasisRow(tenant, request.offeringId, request.resourceId));
    if (!fresh) return hireFailure('not_found', 'the offering or the resource was not found');
    return hireFailure('availability_changed', 'the offered times changed while the booking was being made', { basis: fresh });
  }

  /** A write that ended without an answer ('unknown') or with a duplicate key ('resolve'): ask the database what the key now says. */
  private async resolveByKey(tenant: TenantContext, request: HireRequest, unknown: boolean, otherwise?: Failure): Promise<Attempt> {
    let found: Reservation | null;
    try {
      found = await this.findByKey(tenant, request.idempotencyKey);
    } catch {
      return otherwise ?? hireFailure('outcome_unknown', 'the booking may or may not have been saved; ask again with the same key');
    }
    if (found) {
      const result = this.replayOrConflict(found, request);
      return result.ok && unknown ? { ...result, replayed: false, recovered: true } : result;
    }
    if (otherwise) return otherwise;
    return unknown ? hireFailure('outcome_unknown', 'the booking may or may not have been saved; ask again with the same key') : hireFailure('availability_changed', 'the offered times changed while the booking was being made');
  }

  private replayOrConflict(existing: Reservation, request: HireRequest): HireResult {
    return hireRequestMatches(existing, request)
      ? { ok: true, reservation: existing, replayed: true }
      : hireFailure('idempotency_conflict', 'this idempotency key was already used for a different request');
  }

  // ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async findByKey(tenant: TenantContext, key: string): Promise<Reservation | null> {
    const rows = await this.sql.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM scheduling_reservations r WHERE r.organisation_id = $1 AND r.idempotency_key = $2`,
      [tenant.organisationId, key],
    );
    return rows[0] ? toReservation(rows[0]) : null;
  }

  private async readBasisRow(tenant: TenantContext, offeringId: string, resourceId: string): Promise<Row | null> {
    try {
      const rows = await this.sql.query<Row>(HIRE_BASIS_SQL, [tenant.organisationId, offeringId, resourceId]);
      return rows[0] ?? null;
    } catch (err) {
      const code = sqlstateOf(err);
      if (code === '42P01' || code === '42703') throw new HireNotReadyError();
      throw err;
    }
  }
}

function basisOf(row: Row | null): HireBasis | null {
  if (!row || row.offering_version === null || row.offering_version === undefined || row.resource_version === null || row.resource_version === undefined) return null;
  return { offeringVersion: String(row.offering_version), resourceVersion: String(row.resource_version), offeringToken: String(row.offering_token), scheduleToken: String(row.schedule_token) };
}

/**
 * What a database error from the guarded batch means for the booking. The distinction that matters is certainty:
 *  - an error the SERVER raised (it has a SQLSTATE of its own) rolled the transaction back: nothing was written, so it is a definite failure or a defect;
 *  - connection loss, a crashed or restarted server, or an error with no SQLSTATE at all (a dropped response, an aborted request, a timeout in the client) says nothing about whether
 *    the COMMIT happened: unknown. The caller resolves it by key and never reports it as "failed".
 */
export function classifyWriteError(err: unknown): WriteError {
  const code = sqlstateOf(err);
  if (code === null) return { kind: 'unknown' };
  if (code.startsWith('08') || code.startsWith('57P') || code === '40003') return { kind: 'unknown' };
  const fail = (failure: HireFailure, retry = false): WriteError => ({ kind: 'failure', failure: { ...failure, ...(retry ? { retry: true } : {}) } });
  switch (code) {
    case '55P03': // lock_timeout: a configuration writer (or another request) held a row too long. Nothing decided, nothing written; retry re-reads the basis.
      return fail(hireFailure('contention_timeout', 'the database was busy; nothing was saved, try again'), true);
    case '57014': // statement_timeout: the same, but it already waited the full statement budget; not retried
      return fail(hireFailure('contention_timeout', 'the booking took too long; nothing was saved, try again'));
    case '23P01':
      return fail(hireFailure('resource_conflict', 'the resource is already held for part of that time'));
    case 'SCPTY':
    case 'SCCAP':
      return fail(hireFailure('party_exceeds_resource', 'the party does not fit the resource'));
    case 'SCRES':
      return fail(hireFailure('resource_inactive', 'the resource is not active'));
    case 'SCARC':
      return fail(hireFailure('offering_unavailable', 'the offering is archived'));
    case 'SCLNK':
    case 'SCKND':
      return fail(hireFailure('resource_not_eligible', 'the resource is not linked to this offering'));
    case '23503':
      return fail(hireFailure('not_found', 'the offering or the resource was not found'));
    case '23505':
      return { kind: 'resolve' };
    case '42P01':
    case '42703':
      throw new HireNotReadyError();
    default:
      // 40P01 (deadlock) included: the lock order is built so it cannot happen, and if it ever does it is a defect to surface, not to retry around.
      return { kind: 'throw' };
  }
}
