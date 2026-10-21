import {
  SchedulingError,
  isIanaTimezone,
  isLocalDate,
  isLocalTime,
  normaliseEmail,
  validateAvailabilityRule,
  validateRecurrence,
  validateSettings,
  validateScheduleConfig,
  type AvailabilityException,
  type AvailabilityRule,
  type CreateOccurrenceResult,
  type NewAvailabilityExceptionInput,
  type NewAvailabilityRuleInput,
  type NewOccurrenceInput,
  type NewOfferingInput,
  type NewResourceInput,
  type NewScheduleInput,
  type NewSeriesInput,
  type Recurrence,
  type Resource,
  type ResourceHold,
  type ResourceKind,
  type SchedulingConfigRepository,
  type SchedulingSettings,
  type SeriesPause,
  type SettingsInput,
  type StoredOccurrence,
  type StoredOffering,
  type StoredSchedule,
  type StoredSeries,
  type TenantContext,
} from '@scheduling/core';
import { translating } from './errors';
import type { SqlExecutor } from './executor';
import { isSelfService, newId as defaultNewId } from './support';

// SchedulingConfigRepository on raw SQL. Reads need `scheduling.view`, writes need
// `scheduling.manage`. A self-service actor (public booking page, signed-in customer) may read
// only PUBLISHED schedules and what hangs off them; it can write nothing here. The tenant is
// always tenant.organisationId, supplied by the host after authentication: no method accepts an
// organisation id in its input.

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const HHMM = (col: string) => `to_char(${col}, 'HH24:MI')`;

const SCHEDULE_COLUMNS = `s.id, s.organisation_id, s.name, s.preset_key, s.preset_version, s.public_slug,
  s.terminology, s.cancellation_policy, s.timezone, ${ISO('s.archived_at')} AS archived_at`;
const OFFERING_COLUMNS = `f.id, f.organisation_id, f.schedule_id, f.name, f.type_key, f.colour_key,
  f.duration_minutes, f.capacity, f.price_cents, f.currency, ${HHMM('f.start_time')} AS start_time,
  f.recurrence_kind, f.recurrence_day_of_week, f.recurrence_start_date::text AS recurrence_start_date,
  f.recurrence_end_mode, f.recurrence_end_count, f.recurrence_end_date::text AS recurrence_end_date,
  ${ISO('f.archived_at')} AS archived_at,
  COALESCE((SELECT array_agg(DISTINCT r.kind ORDER BY r.kind) FROM scheduling_offering_resources l
             JOIN scheduling_resources r ON r.id = l.resource_id AND r.organisation_id = l.organisation_id
            WHERE l.offering_id = f.id AND l.organisation_id = f.organisation_id), ARRAY[]::text[]) AS resource_kinds`;
const OCCURRENCE_COLUMNS = `o.id, o.organisation_id, o.offering_id, o.resource_id, o.local_date::text AS local_date,
  ${HHMM('o.local_start_time')} AS local_start_time, o.timezone, ${ISO('o.starts_at')} AS starts_at,
  ${ISO('o.ends_at')} AS ends_at, o.capacity, o.status,
  (extract(epoch FROM (o.ends_at - o.starts_at)) / 60)::int AS duration_minutes`;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toSchedule(r: Row): StoredSchedule {
  return {
    id: r.id,
    organisationId: r.organisation_id,
    name: r.name,
    presetKey: r.preset_key,
    presetVersion: r.preset_version,
    terminology: r.terminology ?? {},
    cancellationPolicy: r.cancellation_policy,
    timezone: r.timezone,
    publicSlug: r.public_slug,
    archivedAt: r.archived_at,
  };
}

function toOffering(r: Row): StoredOffering {
  const recurrence: Recurrence =
    r.recurrence_kind === 'weekly'
      ? {
          kind: 'weekly',
          dayOfWeek: r.recurrence_day_of_week,
          startDate: r.recurrence_start_date,
          end:
            r.recurrence_end_mode === 'after_occurrences'
              ? { mode: 'after_occurrences', count: r.recurrence_end_count }
              : r.recurrence_end_mode === 'on_date'
                ? { mode: 'on_date', date: r.recurrence_end_date }
                : { mode: 'ongoing' },
        }
      : { kind: 'none' };
  return {
    id: r.id,
    organisationId: r.organisation_id,
    scheduleId: r.schedule_id,
    name: r.name,
    typeKey: r.type_key,
    colourKey: r.colour_key,
    durationMinutes: r.duration_minutes,
    capacity: r.capacity,
    price: { amountCents: r.price_cents, currency: r.currency },
    recurrence,
    resourceKinds: (r.resource_kinds ?? []) as ResourceKind[],
    archivedAt: r.archived_at,
    startTime: r.start_time,
  };
}

function toResource(r: Row): Resource {
  return { id: r.id, organisationId: r.organisation_id, kind: r.kind, name: r.name, capacity: r.capacity, minParty: r.min_party, active: r.active };
}

function toOccurrence(r: Row): StoredOccurrence {
  return {
    id: r.id,
    organisationId: r.organisation_id,
    offeringId: r.offering_id,
    resourceId: r.resource_id,
    date: r.local_date,
    startTime: r.local_start_time,
    durationMinutes: r.duration_minutes,
    capacity: r.capacity,
    status: r.status,
    timezone: r.timezone,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
  };
}

function toSeries(r: Row): StoredSeries {
  return {
    id: r.id,
    organisationId: r.organisation_id,
    offeringId: r.offering_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    customerEmailNormalised: r.customer_email_normalised,
    customerPhone: r.customer_phone,
    timezone: r.timezone,
    status: r.status,
  };
}

const denied = (what: string) => new SchedulingError('permission_denied', `${what} is required`);
const invalid = (problems: string[]) => new SchedulingError('invalid_input', problems.join('; '));

export interface ConfigRepositoryOptions {
  sql: SqlExecutor;
  newId?: () => string;
}

export class PostgresSchedulingConfigRepository implements SchedulingConfigRepository {
  private readonly sql: SqlExecutor;
  private readonly newId: () => string;

  constructor(options: ConfigRepositoryOptions) {
    this.sql = options.sql;
    this.newId = options.newId ?? defaultNewId;
  }

  /** Writes: staff with scheduling.manage only. */
  private manage(tenant: TenantContext): void {
    if (!tenant.can('scheduling.manage')) throw denied('scheduling.manage');
  }

  /**
   * Reads: staff with scheduling.view see everything; self-service actors see published
   * schedules only; anyone else is refused.
   */
  private readScope(tenant: TenantContext): { publishedOnly: boolean } {
    if (tenant.can('scheduling.view')) return { publishedOnly: false };
    if (isSelfService(tenant)) return { publishedOnly: true };
    throw denied('scheduling.view');
  }

  // ── settings ───────────────────────────────────────────────────────────────

  async getSettings(tenant: TenantContext): Promise<SchedulingSettings | null> {
    this.readScope(tenant);
    const rows = await this.sql.query<Row>('SELECT organisation_id, currency FROM scheduling_settings WHERE organisation_id = $1', [tenant.organisationId]);
    // timezone is host-owned: the stored settings never carry one (no duplicate setting).
    return rows[0] ? { organisationId: rows[0].organisation_id, currency: rows[0].currency, timezone: null } : null;
  }

  async saveSettings(tenant: TenantContext, input: SettingsInput): Promise<SchedulingSettings> {
    this.manage(tenant);
    const problems = validateSettings({ organisationId: tenant.organisationId, timezone: null, currency: input.currency });
    if (problems.length > 0) throw invalid(problems);
    await translating(() =>
      this.sql.query(
        `INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)
         ON CONFLICT (organisation_id) DO UPDATE SET currency = EXCLUDED.currency`,
        [tenant.organisationId, input.currency],
      ),
    );
    return { organisationId: tenant.organisationId, currency: input.currency, timezone: null };
  }

  // ── schedules ──────────────────────────────────────────────────────────────

  async createSchedule(tenant: TenantContext, input: NewScheduleInput): Promise<StoredSchedule> {
    this.manage(tenant);
    const id = this.newId();
    const problems = validateScheduleConfig({
      id,
      organisationId: tenant.organisationId,
      name: input.name,
      presetKey: input.presetKey,
      presetVersion: input.presetVersion,
      terminology: input.terminology,
      cancellationPolicy: input.cancellationPolicy,
      timezone: input.timezone,
    });
    if (input.publicSlug !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.publicSlug)) problems.push('publicSlug must be lower-case words joined by hyphens');
    if (problems.length > 0) throw invalid(problems);
    const rows = await translating(() =>
      this.sql.query<Row>(
        `WITH s AS (
           INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10) RETURNING *)
         SELECT ${SCHEDULE_COLUMNS} FROM s`,
        [id, tenant.organisationId, input.name.trim(), input.presetKey, input.presetVersion, input.publicSlug, JSON.stringify(input.terminology), JSON.stringify(input.cancellationPolicy), input.timezone, createdBy(tenant)],
      ),
    );
    return toSchedule(rows[0]);
  }

  async getSchedule(tenant: TenantContext, scheduleId: string): Promise<StoredSchedule | null> {
    const { publishedOnly } = this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${SCHEDULE_COLUMNS} FROM scheduling_schedules s WHERE s.organisation_id = $1 AND s.id = $2${publishedOnly ? PUBLISHED : ''}`,
      [tenant.organisationId, scheduleId],
    );
    return rows[0] ? toSchedule(rows[0]) : null;
  }

  async findScheduleByPublicSlug(tenant: TenantContext, slug: string): Promise<StoredSchedule | null> {
    this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${SCHEDULE_COLUMNS} FROM scheduling_schedules s WHERE s.organisation_id = $1 AND s.public_slug = $2 AND s.archived_at IS NULL`,
      [tenant.organisationId, slug],
    );
    return rows[0] ? toSchedule(rows[0]) : null;
  }

  async listSchedules(tenant: TenantContext): Promise<StoredSchedule[]> {
    const { publishedOnly } = this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${SCHEDULE_COLUMNS} FROM scheduling_schedules s WHERE s.organisation_id = $1${publishedOnly ? PUBLISHED : ''} ORDER BY s.name, s.id`,
      [tenant.organisationId],
    );
    return rows.map(toSchedule);
  }

  async archiveSchedule(tenant: TenantContext, scheduleId: string): Promise<boolean> {
    this.manage(tenant);
    const rows = await this.sql.query<Row>(
      'UPDATE scheduling_schedules SET archived_at = now() WHERE organisation_id = $1 AND id = $2 AND archived_at IS NULL RETURNING id',
      [tenant.organisationId, scheduleId],
    );
    return rows.length > 0;
  }

  // ── resources ──────────────────────────────────────────────────────────────

  async createResource(tenant: TenantContext, input: NewResourceInput): Promise<Resource> {
    this.manage(tenant);
    const problems: string[] = [];
    if (input.name.trim() === '') problems.push('name is required');
    if (!Number.isInteger(input.capacity) || input.capacity < 1) problems.push('capacity must be a positive integer');
    if (input.minParty !== null && (!Number.isInteger(input.minParty) || input.minParty < 1 || input.minParty > input.capacity)) problems.push('minParty must be between 1 and capacity');
    if (problems.length > 0) throw invalid(problems);
    const rows = await translating(() =>
      this.sql.query<Row>(
        `INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, min_party, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, organisation_id, kind, name, capacity, min_party, active`,
        [this.newId(), tenant.organisationId, input.kind, input.name.trim(), input.capacity, input.minParty, input.active, createdBy(tenant)],
      ),
    );
    return toResource(rows[0]);
  }

  async listResources(tenant: TenantContext): Promise<Resource[]> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const rows = await this.sql.query<Row>(
      'SELECT id, organisation_id, kind, name, capacity, min_party, active FROM scheduling_resources WHERE organisation_id = $1 ORDER BY name, id',
      [tenant.organisationId],
    );
    return rows.map(toResource);
  }

  async setResourceActive(tenant: TenantContext, resourceId: string, active: boolean): Promise<boolean> {
    this.manage(tenant);
    const rows = await this.sql.query<Row>('UPDATE scheduling_resources SET active = $3 WHERE organisation_id = $1 AND id = $2 RETURNING id', [tenant.organisationId, resourceId, active]);
    return rows.length > 0;
  }

  // ── offerings ──────────────────────────────────────────────────────────────

  async createOffering(tenant: TenantContext, scheduleId: string, input: NewOfferingInput): Promise<StoredOffering> {
    this.manage(tenant);
    const problems = [...validateRecurrence(input.recurrence)];
    if (input.name.trim() === '') problems.push('name is required');
    if (input.startTime !== null && !isLocalTime(input.startTime)) problems.push('startTime must be HH:MM');
    if (input.recurrence.kind === 'weekly' && input.startTime === null) problems.push('a weekly offering needs a startTime');
    if (input.recurrence.kind === 'weekly' && input.recurrence.startDate !== null && !isLocalDate(input.recurrence.startDate)) problems.push('recurrence startDate is invalid');
    if (!Number.isInteger(input.price.amountCents) || input.price.amountCents < 0) problems.push('price must be a non-negative integer number of cents');
    if (problems.length > 0) throw invalid(problems);

    const rec = input.recurrence;
    const weekly = rec.kind === 'weekly';
    const rows = await translating(() =>
      this.sql.query<Row>(
        `WITH f AS (
           INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, type_key, colour_key, duration_minutes, capacity,
              price_cents, currency, start_time, recurrence_kind, recurrence_day_of_week, recurrence_start_date,
              recurrence_end_mode, recurrence_end_count, recurrence_end_date, created_by)
           SELECT $1, s.organisation_id, s.id, $4, $5, $6, $7, $8, $9, $10, $11::time, $12, $13, $14::date, $15, $16, $17::date, $18
             FROM scheduling_schedules s WHERE s.id = $3 AND s.organisation_id = $2 AND s.archived_at IS NULL
           RETURNING *)
         SELECT ${OFFERING_COLUMNS} FROM f`,
        [
          this.newId(), tenant.organisationId, scheduleId, input.name.trim(), input.typeKey, input.colourKey, input.durationMinutes, input.capacity,
          input.price.amountCents, input.price.currency, input.startTime, rec.kind,
          weekly ? rec.dayOfWeek : null, weekly ? rec.startDate : null,
          weekly ? rec.end.mode : null,
          weekly && rec.end.mode === 'after_occurrences' ? rec.end.count : null,
          weekly && rec.end.mode === 'on_date' ? rec.end.date : null,
          createdBy(tenant),
        ],
      ),
    );
    if (rows.length === 0) throw new SchedulingError('not_found', 'schedule not found or archived');
    return toOffering(rows[0]);
  }

  async getOffering(tenant: TenantContext, offeringId: string): Promise<StoredOffering | null> {
    const { publishedOnly } = this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${OFFERING_COLUMNS} FROM scheduling_offerings f
         JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
        WHERE f.organisation_id = $1 AND f.id = $2${publishedOnly ? PUBLISHED : ''}`,
      [tenant.organisationId, offeringId],
    );
    return rows[0] ? toOffering(rows[0]) : null;
  }

  async listOfferings(tenant: TenantContext, scheduleId: string): Promise<StoredOffering[]> {
    const { publishedOnly } = this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${OFFERING_COLUMNS} FROM scheduling_offerings f
         JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
        WHERE f.organisation_id = $1 AND f.schedule_id = $2${publishedOnly ? PUBLISHED : ''} ORDER BY f.name, f.id`,
      [tenant.organisationId, scheduleId],
    );
    return rows.map(toOffering);
  }

  async linkOfferingResource(tenant: TenantContext, offeringId: string, resourceId: string): Promise<void> {
    this.manage(tenant);
    await translating(() =>
      this.sql.query(
        `INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)
         ON CONFLICT (organisation_id, offering_id, resource_id) DO NOTHING`,
        [tenant.organisationId, offeringId, resourceId],
      ),
    );
  }

  // ── availability ───────────────────────────────────────────────────────────

  async addAvailabilityRule(tenant: TenantContext, ownerKind: 'resource' | 'offering', ownerId: string, input: NewAvailabilityRuleInput): Promise<AvailabilityRule> {
    this.manage(tenant);
    const rule: AvailabilityRule = {
      id: 'candidate',
      organisationId: tenant.organisationId,
      resourceId: ownerKind === 'resource' ? ownerId : null,
      offeringId: ownerKind === 'offering' ? ownerId : null,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      validFrom: input.validFrom,
      validTo: input.validTo,
    };
    const problems = validateAvailabilityRule(rule);
    if (problems.length > 0) throw invalid(problems);
    const id = this.newId();
    await translating(() =>
      this.sql.query(
        `INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, offering_id, kind, label, day_of_week, start_time, end_time, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::time, $9::time, $10::date, $11::date)`,
        [id, tenant.organisationId, rule.resourceId, rule.offeringId, input.kind, input.label, input.dayOfWeek, input.startTime, input.endTime, input.validFrom, input.validTo],
      ),
    );
    return { ...rule, id };
  }

  async addAvailabilityException(tenant: TenantContext, ownerKind: 'resource' | 'offering', ownerId: string, input: NewAvailabilityExceptionInput): Promise<AvailabilityException> {
    this.manage(tenant);
    const problems: string[] = [];
    if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate)) problems.push('fromDate and toDate must be YYYY-MM-DD');
    else if (input.toDate < input.fromDate) problems.push('toDate must not be before fromDate');
    if (problems.length > 0) throw invalid(problems);
    const id = this.newId();
    const resourceId = ownerKind === 'resource' ? ownerId : null;
    const offeringId = ownerKind === 'offering' ? ownerId : null;
    await translating(() =>
      this.sql.query(
        `INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, offering_id, from_date, to_date, kind, reason)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8)`,
        [id, tenant.organisationId, resourceId, offeringId, input.fromDate, input.toDate, input.kind, input.reason],
      ),
    );
    return { id, organisationId: tenant.organisationId, resourceId, offeringId, fromDate: input.fromDate, toDate: input.toDate, kind: input.kind, reason: input.reason };
  }

  async listAvailabilityRules(tenant: TenantContext, ownerKind: 'resource' | 'offering', ownerId: string): Promise<AvailabilityRule[]> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const col = ownerKind === 'resource' ? 'resource_id' : 'offering_id';
    const rows = await this.sql.query<Row>(
      `SELECT id, organisation_id, resource_id, offering_id, day_of_week, ${HHMM('start_time')} AS start_time, ${HHMM('end_time')} AS end_time,
              valid_from::text AS valid_from, valid_to::text AS valid_to
         FROM scheduling_availability_rules WHERE organisation_id = $1 AND ${col} = $2 ORDER BY day_of_week, start_time, id`,
      [tenant.organisationId, ownerId],
    );
    return rows.map(r => ({
      id: r.id, organisationId: r.organisation_id, resourceId: r.resource_id, offeringId: r.offering_id,
      dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to,
    }));
  }

  // ── occurrences ────────────────────────────────────────────────────────────

  async createOccurrence(tenant: TenantContext, input: NewOccurrenceInput): Promise<CreateOccurrenceResult> {
    this.manage(tenant);
    const problems: string[] = [];
    if (!isLocalDate(input.date)) problems.push('date must be YYYY-MM-DD');
    if (!isLocalTime(input.startTime)) problems.push('startTime must be HH:MM');
    if (!isIanaTimezone(input.timezone)) problems.push('timezone must be a valid IANA timezone');
    if (!Number.isInteger(input.capacity) || input.capacity < 1) problems.push('capacity must be a positive integer');
    if (!(Date.parse(input.endsAt) > Date.parse(input.startsAt))) problems.push('endsAt must be after startsAt');
    if (problems.length > 0) throw invalid(problems);

    let rows: Row[];
    try {
      rows = await translating(() =>
        this.sql.query<Row>(
          `WITH o AS (
             INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity, created_by)
             SELECT $1, f.organisation_id, f.id, $4, $5::date, $6::time, $7, $8::timestamptz, $9::timestamptz, $10::int, $11
               FROM scheduling_offerings f JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
              WHERE f.id = $3 AND f.organisation_id = $2 AND f.archived_at IS NULL AND s.archived_at IS NULL
             RETURNING *
           ), h AS (
             INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
             SELECT $12, o.organisation_id, o.resource_id, tstzrange(o.starts_at, o.ends_at, '[)'), o.id FROM o WHERE o.resource_id IS NOT NULL
             RETURNING id)
           SELECT ${OCCURRENCE_COLUMNS} FROM o`,
          [this.newId(), tenant.organisationId, input.offeringId, input.resourceId, input.date, input.startTime, input.timezone, input.startsAt, input.endsAt, input.capacity, createdBy(tenant), this.newId()],
        ),
      );
    } catch (err) {
      if (err instanceof SchedulingError) {
        if (err.code === 'resource_conflict') return { ok: false, reason: 'resource_conflict' };
        if (err.code === 'conflict' && err.constraint === 'scheduling_occurrences_slot_uk') return { ok: false, reason: 'duplicate_occurrence' };
        if (err.code === 'not_found') return { ok: false, reason: 'not_found' };
      }
      throw err;
    }
    if (rows.length === 0) {
      const exists = await this.sql.query<Row>('SELECT 1 FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2', [tenant.organisationId, input.offeringId]);
      return { ok: false, reason: exists.length === 0 ? 'not_found' : 'offering_unavailable' };
    }
    return { ok: true, occurrence: toOccurrence(rows[0]) };
  }

  async getOccurrence(tenant: TenantContext, occurrenceId: string): Promise<StoredOccurrence | null> {
    const { publishedOnly } = this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${OCCURRENCE_COLUMNS} FROM scheduling_occurrences o
         JOIN scheduling_offerings f ON f.id = o.offering_id AND f.organisation_id = o.organisation_id
         JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
        WHERE o.organisation_id = $1 AND o.id = $2${publishedOnly ? PUBLISHED : ''}`,
      [tenant.organisationId, occurrenceId],
    );
    return rows[0] ? toOccurrence(rows[0]) : null;
  }

  async listOccurrences(tenant: TenantContext, offeringId: string, fromInstant: string, toInstant: string): Promise<StoredOccurrence[]> {
    const { publishedOnly } = this.readScope(tenant);
    const rows = await this.sql.query<Row>(
      `SELECT ${OCCURRENCE_COLUMNS} FROM scheduling_occurrences o
         JOIN scheduling_offerings f ON f.id = o.offering_id AND f.organisation_id = o.organisation_id
         JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
        WHERE o.organisation_id = $1 AND o.offering_id = $2 AND o.starts_at >= $3::timestamptz AND o.starts_at < $4::timestamptz${publishedOnly ? PUBLISHED : ''}
        ORDER BY o.starts_at, o.id`,
      [tenant.organisationId, offeringId, fromInstant, toInstant],
    );
    return rows.map(toOccurrence);
  }

  async cancelOccurrence(tenant: TenantContext, occurrenceId: string, reason: string | null): Promise<{ cancelledReservationIds: string[] } | null> {
    this.manage(tenant);
    const rows = await translating(() =>
      this.sql.query<{ ids: string[] | null }>('SELECT scheduling_cancel_occurrence($1, $2, $3) AS ids', [tenant.organisationId, occurrenceId, reason]),
    );
    const ids = rows[0]?.ids ?? null;
    return ids === null ? null : { cancelledReservationIds: ids };
  }

  // ── series ─────────────────────────────────────────────────────────────────

  async createSeries(tenant: TenantContext, input: NewSeriesInput): Promise<StoredSeries> {
    this.manage(tenant);
    const problems: string[] = [];
    if (input.customerName.trim() === '') problems.push('customerName is required');
    if (input.customerEmail !== null && normaliseEmail(input.customerEmail) === null) problems.push('customerEmail is not a valid email address');
    if (!isIanaTimezone(input.timezone)) problems.push('timezone must be a valid IANA timezone');
    if (problems.length > 0) throw invalid(problems);
    const rows = await translating(() =>
      this.sql.query<Row>(
        `INSERT INTO scheduling_series (id, organisation_id, offering_id, customer_id, customer_name, customer_email, customer_email_normalised, customer_phone, timezone, created_by)
         SELECT $1, f.organisation_id, f.id, $4, $5, $6, $7, $8, $9, $10 FROM scheduling_offerings f WHERE f.id = $3 AND f.organisation_id = $2
         RETURNING id, organisation_id, offering_id, customer_id, customer_name, customer_email, customer_email_normalised, customer_phone, timezone, status`,
        [this.newId(), tenant.organisationId, input.offeringId, input.customerId, input.customerName.trim(), input.customerEmail, normaliseEmail(input.customerEmail), input.customerPhone, input.timezone, createdBy(tenant)],
      ),
    );
    if (rows.length === 0) throw new SchedulingError('not_found', 'offering not found');
    return toSeries(rows[0]);
  }

  async getSeries(tenant: TenantContext, seriesId: string): Promise<StoredSeries | null> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const rows = await this.sql.query<Row>(
      `SELECT id, organisation_id, offering_id, customer_id, customer_name, customer_email, customer_email_normalised, customer_phone, timezone, status
         FROM scheduling_series WHERE organisation_id = $1 AND id = $2`,
      [tenant.organisationId, seriesId],
    );
    return rows[0] ? toSeries(rows[0]) : null;
  }

  async addSeriesPause(tenant: TenantContext, seriesId: string, pause: { pauseFrom: string; pauseUntil: string; reason: string | null }): Promise<SeriesPause | null> {
    this.manage(tenant);
    if (!isLocalDate(pause.pauseFrom) || !isLocalDate(pause.pauseUntil)) throw invalid(['pauseFrom and pauseUntil must be YYYY-MM-DD']);
    if (pause.pauseUntil < pause.pauseFrom) throw invalid(['pauseUntil must not be before pauseFrom']);
    const id = this.newId();
    const rows = await translating(() =>
      this.sql.query<Row>(
        `INSERT INTO scheduling_series_pauses (id, organisation_id, series_id, pause_from, pause_until, reason, created_by)
         SELECT $1, s.organisation_id, s.id, $4::date, $5::date, $6, $7 FROM scheduling_series s WHERE s.id = $3 AND s.organisation_id = $2
         RETURNING id`,
        [id, tenant.organisationId, seriesId, pause.pauseFrom, pause.pauseUntil, pause.reason, createdBy(tenant)],
      ),
    );
    return rows.length === 0 ? null : { id, seriesId, pauseFrom: pause.pauseFrom, pauseUntil: pause.pauseUntil, reason: pause.reason };
  }

  async listSeriesPauses(tenant: TenantContext, seriesId: string): Promise<SeriesPause[]> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const rows = await this.sql.query<Row>(
      `SELECT id, series_id, pause_from::text AS pause_from, pause_until::text AS pause_until, reason
         FROM scheduling_series_pauses WHERE organisation_id = $1 AND series_id = $2 ORDER BY pause_from, id`,
      [tenant.organisationId, seriesId],
    );
    return rows.map(r => ({ id: r.id, seriesId: r.series_id, pauseFrom: r.pause_from, pauseUntil: r.pause_until, reason: r.reason }));
  }

  // ── holds (read-only view for staff and tests) ─────────────────────────────

  async listHoldsForReservation(tenant: TenantContext, reservationId: string): Promise<ResourceHold[]> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const rows = await this.sql.query<Row>(
      `SELECT id, resource_id, ${ISO('lower(during)')} AS starts_at, ${ISO('upper(during)')} AS ends_at, reservation_id, occurrence_id, ${ISO('released_at')} AS released_at
         FROM scheduling_resource_holds WHERE organisation_id = $1 AND reservation_id = $2 ORDER BY created_at, id`,
      [tenant.organisationId, reservationId],
    );
    return rows.map(r => ({ id: r.id, resourceId: r.resource_id, startsAt: r.starts_at, endsAt: r.ends_at, reservationId: r.reservation_id, occurrenceId: r.occurrence_id, releasedAt: r.released_at }));
  }
}

// Condition appended to queries that join the schedule alias `s`: self-service sees published only.
const PUBLISHED = ' AND s.public_slug IS NOT NULL AND s.archived_at IS NULL';

function createdBy(tenant: TenantContext): string {
  const a = tenant.actor;
  return a.kind === 'staff' ? `staff:${a.userId}` : a.kind === 'customer' ? `customer:${a.customerId}` : a.kind;
}
