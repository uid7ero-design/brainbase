import {
  AvailabilityNotReadyError,
  SchedulingError,
  isLocalDate,
  validateAvailabilityException,
  validateAvailabilityRuleForSet,
  validateExpectedUpdatedAt,
  type AvailabilityOwner,
  type AvailabilityWriteFailure,
  type AvailabilityWriteResult,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
  type SchedulingAvailabilityRepository,
  type StoredAvailabilityException,
  type StoredAvailabilityRule,
  type StoredExceptionPatch,
  type StoredRulePatch,
  type TenantContext,
} from '@scheduling/core';
import { mapPgError, sqlstateOf } from './errors';
import type { SqlExecutor } from './executor';
import { newId as defaultNewId } from './support';

// SchedulingAvailabilityRepository on raw SQL (Phase 2B.3b). Reads need `scheduling.view`, writes `scheduling.manage`; a self-service
// actor can do neither. The tenant is always tenant.organisationId; no method accepts an organisation id.
//
// Every operation is ONE statement (the package's standing rule). The checks that span rows or need a lock (no overlap per owner, no
// availability on an archived offering or inactive resource, the owner never changes) are enforced by the triggers of
// packages/scheduling/sql/034_availability_integrity.sql, which take the owner's lock BEFORE reading. Their refusals arrive here as
// SCOVL / SCARC / SCRES and become the `reason` of the result. The version token is updated_at at microsecond precision; an edit or
// delete names it and is refused (stale_write) when the row has moved. When a statement changes no row, a second READ-ONLY statement
// only classifies why (missing or stale); it never writes.
//
// Until 034 is applied the new column does not exist: every statement here then fails with undefined_column, which is reported as
// AvailabilityNotReadyError (the host answers 503, nothing having been written). Every WRITE therefore names updated_at itself (in its
// WHERE or its RETURNING): a statement that does not would insert before a later read-back noticed the missing column.

const VERSION = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const STAMP = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
// '24:00' (a valid PostgreSQL time) must round-trip as '24:00', so the time is formatted explicitly.
const HHMM = (col: string) => `CASE WHEN ${col} = '24:00:00'::time THEN '24:00' ELSE to_char(${col}, 'HH24:MI') END`;

const RULE_COLUMNS = `r.id, r.resource_id, r.offering_id, r.kind, r.label, r.day_of_week, ${HHMM('r.start_time')} AS start_time, ${HHMM('r.end_time')} AS end_time,
  r.valid_from::text AS valid_from, r.valid_to::text AS valid_to, ${STAMP('r.created_at')} AS created_at, ${VERSION('r.updated_at')} AS updated_at`;
const EXCEPTION_COLUMNS = `e.id, e.resource_id, e.offering_id, e.from_date::text AS from_date, e.to_date::text AS to_date, e.kind, e.reason,
  ${STAMP('e.created_at')} AS created_at, ${VERSION('e.updated_at')} AS updated_at`;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toRule = (r: Row): StoredAvailabilityRule => ({
  id: r.id, resourceId: r.resource_id, offeringId: r.offering_id, kind: r.kind, label: r.label, dayOfWeek: r.day_of_week,
  startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toException = (r: Row): StoredAvailabilityException => ({
  id: r.id, resourceId: r.resource_id, offeringId: r.offering_id, fromDate: r.from_date, toDate: r.to_date, kind: r.kind, reason: r.reason,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const denied = (what: string) => new SchedulingError('permission_denied', `${what} is required`);
const invalid = (problems: string[]) => new SchedulingError('invalid_input', problems.join('; '));

const SQLSTATE_FAILURE: Record<string, AvailabilityWriteFailure> = { SCOVL: 'overlap', SCARC: 'owner_archived', SCRES: 'owner_inactive' };

type TableName = 'scheduling_availability_rules' | 'scheduling_availability_exceptions';
type Written = { ok: true; id: string } | { ok: false; reason: AvailabilityWriteFailure } | { ok: 'none' };

export interface AvailabilityRepositoryOptions {
  sql: SqlExecutor;
  newId?: () => string;
}

export class PostgresAvailabilityRepository implements SchedulingAvailabilityRepository {
  private readonly sql: SqlExecutor;
  private readonly newId: () => string;

  constructor(options: AvailabilityRepositoryOptions) {
    this.sql = options.sql;
    this.newId = options.newId ?? defaultNewId;
  }

  private view(tenant: TenantContext): void {
    if (tenant.actor.kind !== 'staff' || !tenant.can('scheduling.view')) throw denied('scheduling.view');
  }
  private manage(tenant: TenantContext): void {
    if (tenant.actor.kind !== 'staff' || !tenant.can('scheduling.manage')) throw denied('scheduling.manage');
  }

  /** One read: a missing 034 becomes AvailabilityNotReadyError. */
  private async read(text: string, params: unknown[]): Promise<Row[]> {
    try {
      return await this.sql.query<Row>(text, params);
    } catch (err) {
      if (sqlstateOf(err) === '42703') throw new AvailabilityNotReadyError();
      throw err;
    }
  }

  /** One write statement that RETURNs the written row's id. The triggers' refusals become a result; other schema errors a SchedulingError. */
  private async write(text: string, params: unknown[]): Promise<Written> {
    try {
      const rows = await this.sql.query<Row>(text, params);
      return rows.length > 0 ? { ok: true, id: rows[0].id as string } : { ok: 'none' };
    } catch (err) {
      const code = sqlstateOf(err);
      if (code === '42703') throw new AvailabilityNotReadyError();
      const failure = code ? SQLSTATE_FAILURE[code] : undefined;
      if (failure) return { ok: false, reason: failure };
      throw mapPgError(err) ?? err;
    }
  }

  private ownerColumn = (owner: AvailabilityOwner) => (owner.kind === 'resource' ? 'resource_id' : 'offering_id');
  private ownerTable = (owner: AvailabilityOwner) => (owner.kind === 'resource' ? 'scheduling_resources' : 'scheduling_offerings');

  /** A write that changed no row: read-only, says whether the row is missing (or another tenant's) or has simply moved on. */
  private async classify(tenant: TenantContext, table: TableName, id: string): Promise<{ ok: false; reason: 'not_found' | 'stale_write' }> {
    const rows = await this.read(`SELECT 1 AS found FROM ${table} WHERE organisation_id = $1 AND id = $2`, [tenant.organisationId, id]);
    return { ok: false, reason: rows.length > 0 ? 'stale_write' : 'not_found' };
  }

  // ── rules ────────────────────────────────────────────────────────────────

  async listRules(tenant: TenantContext, owner: AvailabilityOwner): Promise<StoredAvailabilityRule[]> {
    this.view(tenant);
    const rows = await this.read(
      `SELECT ${RULE_COLUMNS} FROM scheduling_availability_rules r WHERE r.organisation_id = $1 AND r.${this.ownerColumn(owner)} = $2 ORDER BY r.day_of_week, r.start_time, r.id`,
      [tenant.organisationId, owner.id],
    );
    return rows.map(toRule);
  }

  async getRule(tenant: TenantContext, ruleId: string): Promise<StoredAvailabilityRule | null> {
    this.view(tenant);
    const rows = await this.read(`SELECT ${RULE_COLUMNS} FROM scheduling_availability_rules r WHERE r.organisation_id = $1 AND r.id = $2`, [tenant.organisationId, ruleId]);
    return rows[0] ? toRule(rows[0]) : null;
  }

  async createRule(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredRuleInput): Promise<AvailabilityWriteResult<StoredAvailabilityRule>> {
    this.manage(tenant);
    const problems = validateAvailabilityRuleForSet({
      id: 'candidate', organisationId: tenant.organisationId,
      resourceId: owner.kind === 'resource' ? owner.id : null, offeringId: owner.kind === 'offering' ? owner.id : null,
      dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime as string, validFrom: input.validFrom, validTo: input.validTo,
    });
    if (input.kind !== 'hours' && input.kind !== 'service_period') problems.push("kind must be 'hours' or 'service_period'");
    if (problems.length > 0) throw invalid(problems);
    const id = this.newId();
    // The owner row is the SELECT source: a missing or other-tenant owner inserts nothing (not_found), and the INSERT carries the
    // owner's own organisation, never a caller-supplied one.
    const res = await this.write(
      `INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, offering_id, kind, label, day_of_week, start_time, end_time, valid_from, valid_to)
       SELECT $1, o.organisation_id, ${owner.kind === 'resource' ? 'o.id, NULL' : 'NULL, o.id'}, $4, $5, $6, $7::time, $8::time, $9::date, $10::date
         FROM ${this.ownerTable(owner)} o WHERE o.organisation_id = $2 AND o.id = $3
       RETURNING id, updated_at`, // updated_at here makes the statement fail BEFORE writing when 034 is absent
      [id, tenant.organisationId, owner.id, input.kind, input.label, input.dayOfWeek, input.startTime, input.endTime, input.validFrom, input.validTo],
    );
    if (res.ok === 'none') return { ok: false, reason: 'not_found' };
    if (res.ok === false) return res;
    const stored = await this.getRule(tenant, res.id);
    return stored ? { ok: true, value: stored } : { ok: false, reason: 'not_found' };
  }

  async updateRule(tenant: TenantContext, ruleId: string, expectedUpdatedAt: string, changes: StoredRulePatch): Promise<AvailabilityWriteResult<StoredAvailabilityRule>> {
    this.manage(tenant);
    const problems = validateExpectedUpdatedAt(expectedUpdatedAt);
    const params: unknown[] = [tenant.organisationId, ruleId, expectedUpdatedAt];
    const arg = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const sets: string[] = [];
    if (changes.kind !== undefined) sets.push(`kind = ${arg(changes.kind)}`);
    if (changes.label !== undefined) sets.push(`label = ${arg(changes.label)}`);
    if (changes.dayOfWeek !== undefined) sets.push(`day_of_week = ${arg(changes.dayOfWeek)}::smallint`);
    if (changes.startTime !== undefined) sets.push(`start_time = ${arg(changes.startTime)}::time`);
    if (changes.endTime !== undefined) sets.push(`end_time = ${arg(changes.endTime)}::time`);
    if (changes.validFrom !== undefined) sets.push(`valid_from = ${arg(changes.validFrom)}::date`);
    if (changes.validTo !== undefined) sets.push(`valid_to = ${arg(changes.validTo)}::date`);
    if (sets.length === 0) problems.push('nothing to change');
    if (problems.length > 0) throw invalid(problems);

    const res = await this.write(
      `UPDATE scheduling_availability_rules SET ${sets.join(', ')} WHERE organisation_id = $1 AND id = $2 AND updated_at = $3::timestamptz RETURNING id`,
      params,
    );
    if (res.ok === 'none') return this.classify(tenant, 'scheduling_availability_rules', ruleId);
    if (res.ok === false) return res;
    const stored = await this.getRule(tenant, res.id);
    return stored ? { ok: true, value: stored } : { ok: false, reason: 'not_found' };
  }

  async deleteRule(tenant: TenantContext, ruleId: string, expectedUpdatedAt: string): Promise<AvailabilityWriteResult<{ id: string }>> {
    this.manage(tenant);
    const problems = validateExpectedUpdatedAt(expectedUpdatedAt);
    if (problems.length > 0) throw invalid(problems);
    const res = await this.write('DELETE FROM scheduling_availability_rules WHERE organisation_id = $1 AND id = $2 AND updated_at = $3::timestamptz RETURNING id', [tenant.organisationId, ruleId, expectedUpdatedAt]);
    if (res.ok === 'none') return this.classify(tenant, 'scheduling_availability_rules', ruleId);
    return res.ok === true ? { ok: true, value: { id: res.id } } : res;
  }

  // ── exceptions ───────────────────────────────────────────────────────────

  async listExceptions(tenant: TenantContext, owner: AvailabilityOwner): Promise<StoredAvailabilityException[]> {
    this.view(tenant);
    const rows = await this.read(
      `SELECT ${EXCEPTION_COLUMNS} FROM scheduling_availability_exceptions e WHERE e.organisation_id = $1 AND e.${this.ownerColumn(owner)} = $2 ORDER BY e.from_date, e.to_date, e.id`,
      [tenant.organisationId, owner.id],
    );
    return rows.map(toException);
  }

  async getException(tenant: TenantContext, exceptionId: string): Promise<StoredAvailabilityException | null> {
    this.view(tenant);
    const rows = await this.read(`SELECT ${EXCEPTION_COLUMNS} FROM scheduling_availability_exceptions e WHERE e.organisation_id = $1 AND e.id = $2`, [tenant.organisationId, exceptionId]);
    return rows[0] ? toException(rows[0]) : null;
  }

  async createException(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredExceptionInput): Promise<AvailabilityWriteResult<StoredAvailabilityException>> {
    this.manage(tenant);
    const problems = validateAvailabilityException({
      id: 'candidate', organisationId: tenant.organisationId,
      resourceId: owner.kind === 'resource' ? owner.id : null, offeringId: owner.kind === 'offering' ? owner.id : null,
      fromDate: input.fromDate, toDate: input.toDate, kind: input.kind, reason: input.reason,
    });
    // An override needs hours and the table has no column for them (see the Phase 2B.3b doc): only closures are stored for now.
    if (input.kind === 'override') problems.splice(0, problems.length, 'override exceptions are not stored yet: only closures can be created');
    if (problems.length > 0) throw invalid(problems);
    const id = this.newId();
    const res = await this.write(
      `INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, offering_id, from_date, to_date, kind, reason)
       SELECT $1, o.organisation_id, ${owner.kind === 'resource' ? 'o.id, NULL' : 'NULL, o.id'}, $4::date, $5::date, $6, $7
         FROM ${this.ownerTable(owner)} o WHERE o.organisation_id = $2 AND o.id = $3
       RETURNING id, updated_at`, // updated_at here makes the statement fail BEFORE writing when 034 is absent
      [id, tenant.organisationId, owner.id, input.fromDate, input.toDate, input.kind, input.reason],
    );
    if (res.ok === 'none') return { ok: false, reason: 'not_found' };
    if (res.ok === false) return res;
    const stored = await this.getException(tenant, res.id);
    return stored ? { ok: true, value: stored } : { ok: false, reason: 'not_found' };
  }

  async updateException(tenant: TenantContext, exceptionId: string, expectedUpdatedAt: string, changes: StoredExceptionPatch): Promise<AvailabilityWriteResult<StoredAvailabilityException>> {
    this.manage(tenant);
    const problems = validateExpectedUpdatedAt(expectedUpdatedAt);
    const params: unknown[] = [tenant.organisationId, exceptionId, expectedUpdatedAt];
    const arg = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const sets: string[] = [];
    if (changes.fromDate !== undefined) {
      if (!isLocalDate(changes.fromDate)) problems.push('fromDate must be a valid date');
      sets.push(`from_date = ${arg(changes.fromDate)}::date`);
    }
    if (changes.toDate !== undefined) {
      if (!isLocalDate(changes.toDate)) problems.push('toDate must be a valid date');
      sets.push(`to_date = ${arg(changes.toDate)}::date`);
    }
    if (changes.kind !== undefined) {
      if (changes.kind !== 'closed') problems.push('override exceptions are not stored yet: only closures are supported');
      sets.push(`kind = ${arg(changes.kind)}`);
    }
    if (changes.reason !== undefined) sets.push(`reason = ${arg(changes.reason)}`);
    if (sets.length === 0) problems.push('nothing to change');
    if (problems.length > 0) throw invalid(problems);

    const res = await this.write(
      `UPDATE scheduling_availability_exceptions SET ${sets.join(', ')} WHERE organisation_id = $1 AND id = $2 AND updated_at = $3::timestamptz RETURNING id`,
      params,
    );
    if (res.ok === 'none') return this.classify(tenant, 'scheduling_availability_exceptions', exceptionId);
    if (res.ok === false) return res;
    const stored = await this.getException(tenant, res.id);
    return stored ? { ok: true, value: stored } : { ok: false, reason: 'not_found' };
  }

  async deleteException(tenant: TenantContext, exceptionId: string, expectedUpdatedAt: string): Promise<AvailabilityWriteResult<{ id: string }>> {
    this.manage(tenant);
    const problems = validateExpectedUpdatedAt(expectedUpdatedAt);
    if (problems.length > 0) throw invalid(problems);
    const res = await this.write('DELETE FROM scheduling_availability_exceptions WHERE organisation_id = $1 AND id = $2 AND updated_at = $3::timestamptz RETURNING id', [tenant.organisationId, exceptionId, expectedUpdatedAt]);
    if (res.ok === 'none') return this.classify(tenant, 'scheduling_availability_exceptions', exceptionId);
    return res.ok === true ? { ok: true, value: { id: res.id } } : res;
  }
}
