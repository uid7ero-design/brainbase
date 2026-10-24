import {
  OCCURRENCE_WRITING_PRESETS,
  SchedulingError,
  isIanaTimezone,
  isLocalDate,
  isLocalTime,
  getPreset,
  normaliseEmail,
  validateAvailabilityRule,
  validateExpectedUpdatedAt,
  validateOfferingPatch,
  validateRecurrence,
  validateResourcePatch,
  validateSchedulePatch,
  validateSettings,
  validateScheduleConfig,
  type AvailabilityException,
  type AvailabilityRule,
  type ConfigWriteResult,
  type CreateOccurrenceResult,
  type NewAvailabilityExceptionInput,
  type NewAvailabilityRuleInput,
  type NewOccurrenceInput,
  type NewOfferingInput,
  type NewResourceInput,
  type NewScheduleInput,
  type NewSeriesInput,
  type OfferingPatch,
  type Recurrence,
  type ResourceHold,
  type ResourceKind,
  type ResourcePatch,
  type SchedulePatch,
  type SchedulingConfigRepository,
  type SchedulingSettings,
  type SeriesPause,
  type SettingsInput,
  type StoredOccurrence,
  type StoredOffering,
  type StoredResource,
  type StoredSchedule,
  type StoredSeries,
  type TenantContext,
} from '@scheduling/core';
import { SCHEDULING_SQLSTATE, mapPgError, sqlstateOf, translating } from './errors';
import type { SqlExecutor } from './executor';
import { isSelfService, newId as defaultNewId } from './support';

// SchedulingConfigRepository on raw SQL. Reads need `scheduling.view`, writes need
// `scheduling.manage`. A self-service actor (public booking page, signed-in customer) may read
// only PUBLISHED schedules and what hangs off them; it can write nothing here. The tenant is
// always tenant.organisationId, supplied by the host after authentication: no method accepts an
// organisation id in its input.

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const HHMM = (col: string) => `to_char(${col}, 'HH24:MI')`;

// The version token: updated_at with MICROSECOND precision (ISO() above drops the fraction). Exact round trip: the value read
// here is compared with `updated_at = $n::timestamptz` on the next write.
const VERSION = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const SCHEDULE_COLUMNS = `s.id, s.organisation_id, s.name, s.preset_key, s.preset_version, s.public_slug,
  s.terminology, s.cancellation_policy, s.timezone, ${ISO('s.archived_at')} AS archived_at, ${VERSION('s.updated_at')} AS updated_at`;
const RESOURCE_COLUMNS = `r.id, r.organisation_id, r.kind, r.name, r.capacity, r.min_party, r.active, ${VERSION('r.updated_at')} AS updated_at`;
const OFFERING_COLUMNS = `f.id, f.organisation_id, f.schedule_id, f.name, f.type_key, f.colour_key,
  f.duration_minutes, f.capacity, f.price_cents, f.currency, ${HHMM('f.start_time')} AS start_time,
  f.recurrence_kind, f.recurrence_day_of_week, f.recurrence_start_date::text AS recurrence_start_date,
  f.recurrence_end_mode, f.recurrence_end_count, f.recurrence_end_date::text AS recurrence_end_date,
  ${ISO('f.archived_at')} AS archived_at, ${VERSION('f.updated_at')} AS updated_at,
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
    updatedAt: r.updated_at,
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
    updatedAt: r.updated_at,
  };
}

function toResource(r: Row): StoredResource {
  return { id: r.id, organisationId: r.organisation_id, kind: r.kind, name: r.name, capacity: r.capacity, minParty: r.min_party, active: r.active, updatedAt: r.updated_at };
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

  async createResource(tenant: TenantContext, input: NewResourceInput): Promise<StoredResource> {
    this.manage(tenant);
    const problems: string[] = [];
    if (input.name.trim() === '') problems.push('name is required');
    if (!Number.isInteger(input.capacity) || input.capacity < 1) problems.push('capacity must be a positive integer');
    if (input.minParty !== null && (!Number.isInteger(input.minParty) || input.minParty < 1 || input.minParty > input.capacity)) problems.push('minParty must be between 1 and capacity');
    if (problems.length > 0) throw invalid(problems);
    const rows = await translating(() =>
      this.sql.query<Row>(
        `WITH r AS (
           INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, min_party, active, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *)
         SELECT ${RESOURCE_COLUMNS} FROM r`,
        [this.newId(), tenant.organisationId, input.kind, input.name.trim(), input.capacity, input.minParty, input.active, createdBy(tenant)],
      ),
    );
    return toResource(rows[0]);
  }

  async listResources(tenant: TenantContext): Promise<StoredResource[]> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const rows = await this.sql.query<Row>(
      `SELECT ${RESOURCE_COLUMNS} FROM scheduling_resources r WHERE r.organisation_id = $1 ORDER BY r.name, r.id`,
      [tenant.organisationId],
    );
    return rows.map(toResource);
  }

  async setResourceActive(tenant: TenantContext, resourceId: string, active: boolean): Promise<boolean> {
    this.manage(tenant);
    const rows = await translating(() => this.sql.query<Row>('UPDATE scheduling_resources SET active = $3 WHERE organisation_id = $1 AND id = $2 RETURNING id', [tenant.organisationId, resourceId, active]));
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
        // The schedule's own row is written first (its version changes) and the offering is inserted from that row. This is what
        // makes "a preset is locked once an offering exists" and "an archived schedule takes no new offering" race-free over
        // single-statement writes: a concurrent updateSchedule / archiveSchedule and this statement contend for the SAME row,
        // so one of them observes the other (the loser's version check or archived check fails) instead of both passing.
        `WITH sch AS (
           UPDATE scheduling_schedules SET updated_at = now() WHERE id = $3 AND organisation_id = $2 AND archived_at IS NULL
           RETURNING id, organisation_id
         ), f AS (
           INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, type_key, colour_key, duration_minutes, capacity,
              price_cents, currency, start_time, recurrence_kind, recurrence_day_of_week, recurrence_start_date,
              recurrence_end_mode, recurrence_end_count, recurrence_end_date, created_by)
           SELECT $1, s.organisation_id, s.id, $4, $5, $6, $7, $8, $9, $10, $11::time, $12, $13, $14::date, $15, $16, $17::date, $18
             FROM sch s
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
    // The resource's own row is written first (its version changes), as in createOffering: a concurrent updateResource that
    // changes the resource's kind and this link contend for the same row, so a resource cannot change kind under a new link.
    const rows = await translating(() =>
      this.sql.query<Row>(
        `WITH r AS (
           UPDATE scheduling_resources SET updated_at = now() WHERE id = $3 AND organisation_id = $1 RETURNING id, organisation_id
         ), l AS (
           INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id)
           SELECT r.organisation_id, $2, r.id FROM r
           ON CONFLICT (organisation_id, offering_id, resource_id) DO NOTHING
           RETURNING 1)
         SELECT (SELECT count(*) FROM r)::int AS resource_found`,
        [tenant.organisationId, offeringId, resourceId],
      ),
    );
    if (rows[0]?.resource_found === 0) throw new SchedulingError('not_found', 'resource not found');
  }

  // ── configuration edits (Phase 2B.2a) ───────────────────────────────────────
  //
  // Each edit is ONE write statement that carries its own guards (tenant, version, archived, and the booking rules below), so
  // the check and the write cannot be separated by another writer, and nothing needs an interactive transaction. When the
  // statement changes no row, a second, read-only statement only CLASSIFIES why (missing, archived, stale, rule): it never
  // writes. A row of another tenant matches nothing, so it classifies as not_found and is never touched or described.
  //
  // Version token: updated_at at microsecond precision. The row's trigger changes it on every update, and createOffering /
  // linkOfferingResource write the parent row first, so a change to what hangs off a row also changes the row's version.
  // Contract: each call is its own statement (the repository's standing rule). Inside one outer transaction now() is frozen,
  // so two edits there would share a version; hosts must not wrap these calls in one.

  async archiveOffering(tenant: TenantContext, offeringId: string): Promise<boolean> {
    this.manage(tenant);
    const rows = await this.sql.query<Row>(
      'UPDATE scheduling_offerings SET archived_at = now() WHERE organisation_id = $1 AND id = $2 AND archived_at IS NULL RETURNING id',
      [tenant.organisationId, offeringId],
    );
    return rows.length > 0;
  }

  async updateSchedule(tenant: TenantContext, scheduleId: string, expectedUpdatedAt: string, changes: SchedulePatch): Promise<ConfigWriteResult<StoredSchedule>> {
    this.manage(tenant);
    const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...validateSchedulePatch(changes)];
    if (problems.length > 0) throw invalid(problems);

    const params: unknown[] = [tenant.organisationId, scheduleId, expectedUpdatedAt];
    const arg = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const sets: string[] = [];
    let presetGuard = '';
    if (changes.name !== undefined) sets.push(`name = ${arg(changes.name.trim())}`);
    if (changes.terminology !== undefined) sets.push(`terminology = ${arg(JSON.stringify(changes.terminology))}::jsonb`);
    if (changes.cancellationPolicy !== undefined) sets.push(`cancellation_policy = ${arg(JSON.stringify(changes.cancellationPolicy))}::jsonb`);
    if (changes.timezone !== undefined) sets.push(`timezone = ${arg(changes.timezone)}`);
    if (changes.presetKey !== undefined) {
      const key = arg(changes.presetKey);
      sets.push(`preset_key = ${key}::text`, `preset_version = ${arg(getPreset(changes.presetKey).version)}::int`);
      // The preset may change only while the schedule has no offerings at all (archived ones count: reservations may refer to them).
      presetGuard = `AND (s.preset_key = ${key}::text OR NOT EXISTS (SELECT 1 FROM scheduling_offerings o WHERE o.organisation_id = s.organisation_id AND o.schedule_id = s.id))`;
    }

    const rows = await translating(() =>
      this.sql.query<Row>(
        `WITH u AS (
           UPDATE scheduling_schedules s SET ${sets.join(', ')}
            WHERE s.organisation_id = $1 AND s.id = $2 AND s.updated_at = $3::timestamptz AND s.archived_at IS NULL ${presetGuard}
           RETURNING s.*)
         SELECT ${SCHEDULE_COLUMNS} FROM u s`,
        params,
      ),
    );
    if (rows[0]) return { ok: true, value: toSchedule(rows[0]) };

    const why = await this.sql.query<Row>(
      `SELECT s.updated_at = $3::timestamptz AS token_matches, s.archived_at IS NOT NULL AS archived, s.preset_key,
              EXISTS (SELECT 1 FROM scheduling_offerings o WHERE o.organisation_id = s.organisation_id AND o.schedule_id = s.id) AS has_offerings
         FROM scheduling_schedules s WHERE s.organisation_id = $1 AND s.id = $2`,
      [tenant.organisationId, scheduleId, expectedUpdatedAt],
    );
    const w = why[0];
    if (!w) return { ok: false, reason: 'not_found' };
    if (w.archived) return { ok: false, reason: 'archived' };
    if (!w.token_matches) return { ok: false, reason: 'stale_write' };
    if (changes.presetKey !== undefined && changes.presetKey !== w.preset_key && w.has_offerings) {
      return { ok: false, reason: 'preset_locked', detail: 'the schedule already has offerings' };
    }
    return { ok: false, reason: 'stale_write' }; // changed between the write and this read
  }

  async updateOffering(tenant: TenantContext, offeringId: string, expectedUpdatedAt: string, changes: OfferingPatch): Promise<ConfigWriteResult<StoredOffering>> {
    this.manage(tenant);
    const tokenProblems = validateExpectedUpdatedAt(expectedUpdatedAt);
    if (tokenProblems.length > 0) throw invalid(tokenProblems);

    // The preset of an offering's schedule cannot change once the offering exists (updateSchedule refuses), so reading it
    // before the write is safe. A missing or other-tenant offering ends here as not_found.
    const owner = await this.sql.query<Row>(
      `SELECT s.preset_key FROM scheduling_offerings f JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
        WHERE f.organisation_id = $1 AND f.id = $2`,
      [tenant.organisationId, offeringId],
    );
    if (owner.length === 0) return { ok: false, reason: 'not_found' };
    const problems = validateOfferingPatch(changes, owner[0].preset_key);
    if (problems.length > 0) throw invalid(problems);

    const params: unknown[] = [tenant.organisationId, offeringId, expectedUpdatedAt];
    const arg = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const sets: string[] = [];
    if (changes.name !== undefined) sets.push(`name = ${arg(changes.name.trim())}`);
    if (changes.typeKey !== undefined) sets.push(`type_key = ${arg(changes.typeKey)}`);
    if (changes.colourKey !== undefined) sets.push(`colour_key = ${arg(changes.colourKey)}`);
    if (changes.durationMinutes !== undefined) sets.push(`duration_minutes = ${arg(changes.durationMinutes)}`);
    if (changes.capacity !== undefined) sets.push(`capacity = ${arg(changes.capacity)}`);
    if (changes.priceCents !== undefined) sets.push(`price_cents = ${arg(changes.priceCents)}`);
    if (changes.startTime !== undefined) sets.push(`start_time = ${arg(changes.startTime)}::time`);
    if (changes.recurrence !== undefined) {
      const rec = changes.recurrence;
      const weekly = rec.kind === 'weekly';
      sets.push(
        `recurrence_kind = ${arg(rec.kind)}`,
        `recurrence_day_of_week = ${arg(weekly ? rec.dayOfWeek : null)}`,
        `recurrence_start_date = ${arg(weekly ? rec.startDate : null)}::date`,
        `recurrence_end_mode = ${arg(weekly ? rec.end.mode : null)}`,
        `recurrence_end_count = ${arg(weekly && rec.end.mode === 'after_occurrences' ? rec.end.count : null)}`,
        `recurrence_end_date = ${arg(weekly && rec.end.mode === 'on_date' ? rec.end.date : null)}::date`,
      );
    }

    const rows = await translating(() =>
      this.sql.query<Row>(
        `WITH u AS (
           UPDATE scheduling_offerings f SET ${sets.join(', ')}
             FROM scheduling_schedules s
            WHERE f.organisation_id = $1 AND f.id = $2 AND f.updated_at = $3::timestamptz AND f.archived_at IS NULL
              AND s.id = f.schedule_id AND s.organisation_id = f.organisation_id AND s.archived_at IS NULL
           RETURNING f.*)
         SELECT ${OFFERING_COLUMNS} FROM u f`,
        params,
      ),
    );
    if (rows[0]) return { ok: true, value: toOffering(rows[0]) };

    const why = await this.sql.query<Row>(
      `SELECT f.updated_at = $3::timestamptz AS token_matches, (f.archived_at IS NOT NULL OR s.archived_at IS NOT NULL) AS archived
         FROM scheduling_offerings f JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
        WHERE f.organisation_id = $1 AND f.id = $2`,
      [tenant.organisationId, offeringId, expectedUpdatedAt],
    );
    const w = why[0];
    if (!w) return { ok: false, reason: 'not_found' };
    if (w.archived) return { ok: false, reason: 'archived' };
    return { ok: false, reason: 'stale_write' };
  }

  async updateResource(tenant: TenantContext, resourceId: string, expectedUpdatedAt: string, changes: ResourcePatch): Promise<ConfigWriteResult<StoredResource>> {
    this.manage(tenant);
    const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...validateResourcePatch(changes)];
    if (problems.length > 0) throw invalid(problems);

    const params: unknown[] = [tenant.organisationId, resourceId, expectedUpdatedAt];
    const arg = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const sets: string[] = [];
    const guards: string[] = [];
    // Live = not released and not yet ended: a booking that still matters. Past or released holds are history and never block.
    const liveHold = `h.organisation_id = r.organisation_id AND h.resource_id = r.id AND h.released_at IS NULL AND upper(h.during) > now()`;

    if (changes.name !== undefined) sets.push(`name = ${arg(changes.name.trim())}`);
    if (changes.kind !== undefined) {
      const kind = arg(changes.kind);
      sets.push(`kind = ${kind}::text`);
      // A kind change is a change of what the resource IS: refused once any offering uses it or any booking has ever held it.
      guards.push(
        `(r.kind = ${kind}::text OR (NOT EXISTS (SELECT 1 FROM scheduling_offering_resources l WHERE l.organisation_id = r.organisation_id AND l.resource_id = r.id)
           AND NOT EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE h.organisation_id = r.organisation_id AND h.resource_id = r.id)))`,
      );
    }
    let capRef = 'r.capacity';
    let minRef = 'r.min_party';
    if (changes.capacity !== undefined) {
      capRef = `${arg(changes.capacity)}::int`;
      sets.push(`capacity = ${capRef}`);
    }
    if (changes.minParty !== undefined) {
      minRef = `${arg(changes.minParty)}::int`;
      sets.push(`min_party = ${minRef}`);
    }
    if (changes.capacity !== undefined || changes.minParty !== undefined) {
      // A live reservation's party must still fit the resource after the change.
      guards.push(
        `NOT EXISTS (SELECT 1 FROM scheduling_resource_holds h JOIN scheduling_reservations v ON v.organisation_id = h.organisation_id AND v.id = h.reservation_id
          WHERE ${liveHold} AND (v.party_size > ${capRef} OR v.party_size < COALESCE(${minRef}, 0)))`,
      );
    }
    if (changes.active !== undefined) {
      sets.push(`active = ${arg(changes.active)}::boolean`);
      if (changes.active === false) guards.push(`(r.active = false OR NOT EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE ${liveHold}))`);
    }

    let rows: Row[];
    try {
      rows = await this.sql.query<Row>(
        `WITH u AS (
           UPDATE scheduling_resources r SET ${sets.join(', ')}
            WHERE r.organisation_id = $1 AND r.id = $2 AND r.updated_at = $3::timestamptz ${guards.map(g => `AND ${g}`).join(' ')}
           RETURNING r.*)
         SELECT ${RESOURCE_COLUMNS} FROM u r`,
        params,
      );
    } catch (err) {
      // 030_resource_concurrency.sql: a booking or a link committed while this statement ran, which its own guards could not see.
      if (sqlstateOf(err) === SCHEDULING_SQLSTATE.resourceInUse) return { ok: false, reason: 'resource_in_use', detail: 'a reservation or a link was created for this resource at the same moment' };
      throw mapPgError(err) ?? err;
    }
    if (rows[0]) return { ok: true, value: toResource(rows[0]) };

    const why = await this.sql.query<Row>(
      `SELECT r.updated_at = $3::timestamptz AS token_matches, r.kind, r.active,
              EXISTS (SELECT 1 FROM scheduling_offering_resources l WHERE l.organisation_id = r.organisation_id AND l.resource_id = r.id) AS linked,
              EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE h.organisation_id = r.organisation_id AND h.resource_id = r.id) AS ever_held,
              EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE ${liveHold}) AS live_hold,
              EXISTS (SELECT 1 FROM scheduling_resource_holds h JOIN scheduling_reservations v ON v.organisation_id = h.organisation_id AND v.id = h.reservation_id
                       WHERE ${liveHold} AND (v.party_size > COALESCE($4::int, r.capacity) OR v.party_size < COALESCE(CASE WHEN $6::boolean THEN $5::int ELSE r.min_party END, 0))) AS party_conflict
         FROM scheduling_resources r WHERE r.organisation_id = $1 AND r.id = $2`,
      [tenant.organisationId, resourceId, expectedUpdatedAt, changes.capacity ?? null, changes.minParty ?? null, changes.minParty !== undefined],
    );
    const w = why[0];
    if (!w) return { ok: false, reason: 'not_found' };
    if (!w.token_matches) return { ok: false, reason: 'stale_write' };
    if (changes.kind !== undefined && changes.kind !== w.kind && (w.linked || w.ever_held)) {
      return { ok: false, reason: 'resource_in_use', detail: 'the kind of a resource that is linked to an offering or has been booked cannot change' };
    }
    if (changes.active === false && w.active && w.live_hold) {
      return { ok: false, reason: 'resource_in_use', detail: 'the resource has live reservations and cannot be deactivated' };
    }
    if ((changes.capacity !== undefined || changes.minParty !== undefined) && w.party_conflict) {
      return { ok: false, reason: 'resource_in_use', detail: 'a live reservation would no longer fit the new capacity' };
    }
    return { ok: false, reason: 'stale_write' };
  }

  async unlinkOfferingResource(tenant: TenantContext, offeringId: string, resourceId: string): Promise<ConfigWriteResult<{ removed: boolean }>> {
    this.manage(tenant);
    // The link row is the ONLY thing deleted. Reservations, occurrences and holds are never touched, so booking history stays intact.
    const liveForThisOffering = `h.organisation_id = l.organisation_id AND h.resource_id = l.resource_id AND h.released_at IS NULL AND upper(h.during) > now()
      AND (EXISTS (SELECT 1 FROM scheduling_reservations v WHERE v.organisation_id = h.organisation_id AND v.id = h.reservation_id AND v.offering_id = l.offering_id)
        OR EXISTS (SELECT 1 FROM scheduling_occurrences o WHERE o.organisation_id = h.organisation_id AND o.id = h.occurrence_id AND o.offering_id = l.offering_id))`;
    let deleted: Row[];
    try {
      deleted = await this.sql.query<Row>(
      `DELETE FROM scheduling_offering_resources l
        WHERE l.organisation_id = $1 AND l.offering_id = $2 AND l.resource_id = $3
          AND NOT EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE ${liveForThisOffering})
       RETURNING 1 AS gone`,
      [tenant.organisationId, offeringId, resourceId],
      );
    } catch (err) {
      // 030_resource_concurrency.sql: a reservation holding this resource committed while the delete ran.
      if (sqlstateOf(err) === SCHEDULING_SQLSTATE.allocationInUse) return { ok: false, reason: 'allocation_in_use', detail: 'a live reservation holds this resource for this offering' };
      throw mapPgError(err) ?? err;
    }
    if (deleted.length > 0) return { ok: true, value: { removed: true } };

    const why = await this.sql.query<Row>(
      `SELECT EXISTS (SELECT 1 FROM scheduling_offerings f WHERE f.organisation_id = $1 AND f.id = $2) AS offering_found,
              EXISTS (SELECT 1 FROM scheduling_offering_resources l WHERE l.organisation_id = $1 AND l.offering_id = $2 AND l.resource_id = $3) AS linked`,
      [tenant.organisationId, offeringId, resourceId],
    );
    const w = why[0];
    if (!w?.offering_found) return { ok: false, reason: 'not_found' };
    if (!w.linked) return { ok: true, value: { removed: false } };
    return { ok: false, reason: 'allocation_in_use', detail: 'a live reservation holds this resource for this offering' };
  }

  async listOfferingResources(tenant: TenantContext, offeringId: string): Promise<StoredResource[]> {
    if (!tenant.can('scheduling.view')) throw denied('scheduling.view');
    const rows = await this.sql.query<Row>(
      `SELECT ${RESOURCE_COLUMNS} FROM scheduling_offering_resources l
         JOIN scheduling_resources r ON r.id = l.resource_id AND r.organisation_id = l.organisation_id
        WHERE l.organisation_id = $1 AND l.offering_id = $2 ORDER BY r.name, r.id`,
      [tenant.organisationId, offeringId],
    );
    return rows.map(toResource);
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
                AND s.preset_key = ANY($13::text[])
             RETURNING *
           ), h AS (
             INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
             SELECT $12, o.organisation_id, o.resource_id, tstzrange(o.starts_at, o.ends_at, '[)'), o.id FROM o WHERE o.resource_id IS NOT NULL
             RETURNING id)
           SELECT ${OCCURRENCE_COLUMNS} FROM o`,
          [this.newId(), tenant.organisationId, input.offeringId, input.resourceId, input.date, input.startTime, input.timezone, input.startsAt, input.endsAt, input.capacity, createdBy(tenant), this.newId(), [...OCCURRENCE_WRITING_PRESETS]],
        ),
      );
    } catch (err) {
      if (err instanceof SchedulingError) {
        if (err.code === 'resource_conflict') return { ok: false, reason: 'resource_conflict' };
        if (err.code === 'conflict' && err.constraint === 'scheduling_occurrences_slot_uk') return { ok: false, reason: 'duplicate_occurrence' };
        if (err.code === 'not_found') return { ok: false, reason: 'not_found' };
        // 033: an archive committed between this statement's snapshot and the guard's locks
        if (err.code === 'offering_unavailable') return { ok: false, reason: 'offering_unavailable' };
      }
      throw err;
    }
    if (rows.length === 0) {
      const exists = await this.sql.query<Row>(
        `SELECT s.preset_key FROM scheduling_offerings f JOIN scheduling_schedules s ON s.id = f.schedule_id AND s.organisation_id = f.organisation_id
          WHERE f.organisation_id = $1 AND f.id = $2`,
        [tenant.organisationId, input.offeringId],
      );
      if (exists.length === 0) return { ok: false, reason: 'not_found' };
      return { ok: false, reason: OCCURRENCE_WRITING_PRESETS.includes(exists[0].preset_key) ? 'offering_unavailable' : 'preset_not_supported' };
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
