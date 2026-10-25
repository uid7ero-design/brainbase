import {
  AvailabilityNotReadyError,
  AvailabilityZonesNotReadyError,
  isIanaTimezone,
  MAX_RULE_BATCH,
  PartialClosuresNotReadyError,
  SchedulingError,
  isLocalDate,
  validateAvailabilityException,
  validateAvailabilityRuleForSet,
  validateExpectedUpdatedAt,
  type AvailabilityCapabilities,
  type AvailabilityOwner,
  type AvailabilityWriteFailure,
  type AvailabilityWriteResult,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
  type OvernightHalfRef,
  type SchedulingAvailabilityRepository,
  type StoredAvailabilityException,
  type StoredAvailabilityZone,
  type IanaTimezone,
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
// start_time / end_time exist only after migration 035, so they are read through to_jsonb: the SAME read works before and after it (a
// missing column is simply null, i.e. a full-day closure). '24:00' survives as the text '24:00:00'.
const EXCEPTION_COLUMNS = `e.id, e.resource_id, e.offering_id, e.from_date::text AS from_date, e.to_date::text AS to_date, e.kind, e.reason,
  left(to_jsonb(e) ->> 'start_time', 5) AS start_time, left(to_jsonb(e) ->> 'end_time', 5) AS end_time,
  ${STAMP('e.created_at')} AS created_at, ${VERSION('e.updated_at')} AS updated_at`;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toRule = (r: Row): StoredAvailabilityRule => ({
  id: r.id, resourceId: r.resource_id, offeringId: r.offering_id, kind: r.kind, label: r.label, dayOfWeek: r.day_of_week,
  startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toException = (r: Row): StoredAvailabilityException => ({
  id: r.id, resourceId: r.resource_id, offeringId: r.offering_id, fromDate: r.from_date, toDate: r.to_date, kind: r.kind, reason: r.reason,
  startTime: r.start_time ?? null, endTime: r.end_time ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

const denied = (what: string) => new SchedulingError('permission_denied', `${what} is required`);
const invalid = (problems: string[]) => new SchedulingError('invalid_input', problems.join('; '));

// 42703 on the exceptions table naming start_time or end_time means migration 035 is missing (a partial-day closure was asked for);
// any other undefined column means 034 is missing. Both are "not ready": nothing was written.
function notReady(err: unknown): Error {
  const message = String((err as { message?: unknown })?.message ?? '');
  // 42P01 on the zones table: migration 036 is missing, so a create (which pins in the same statement) fails at analysis time with nothing written.
  if (sqlstateOf(err) === '42P01' && /scheduling_availability_zones/.test(message)) return new AvailabilityZonesNotReadyError();
  return /(start_time|end_time)/.test(message) && /scheduling_availability_exceptions/.test(message) ? new PartialClosuresNotReadyError() : new AvailabilityNotReadyError();
}

const SQLSTATE_FAILURE: Record<string, AvailabilityWriteFailure> = { SCOVL: 'overlap', SCARC: 'owner_archived', SCRES: 'owner_inactive' };

type TableName = 'scheduling_availability_rules' | 'scheduling_availability_exceptions';
type Written = { ok: true; id: string; pinned: number } | { ok: false; reason: AvailabilityWriteFailure } | { ok: 'none' };

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
      if (sqlstateOf(err) === '42703' || sqlstateOf(err) === '42P01') throw notReady(err);
      throw err;
    }
  }

  /** One write statement that RETURNs the written row's id. The triggers' refusals become a result; other schema errors a SchedulingError. */
  private async write(text: string, params: unknown[]): Promise<Written> {
    try {
      const rows = await this.sql.query<Row>(text, params);
      return rows.length > 0 ? { ok: true, id: rows[0].id as string, pinned: Number(rows[0].pinned ?? 0) } : { ok: 'none' };
    } catch (err) {
      const code = sqlstateOf(err);
      if (code === '42703' || code === '42P01') throw notReady(err);
      const failure = code ? SQLSTATE_FAILURE[code] : undefined;
      if (failure) return { ok: false, reason: failure };
      throw mapPgError(err) ?? err;
    }
  }

  /** Like write(), for a statement that RETURNs several full rows (deleteOvernightWindow): the rows, or the guard's refusal. */
  private async writeRowsFull(text: string, params: unknown[]): Promise<{ ok: true; rows: Row[] } | { ok: false; reason: AvailabilityWriteFailure }> {
    try {
      return { ok: true, rows: await this.sql.query<Row>(text, params) };
    } catch (err) {
      const code = sqlstateOf(err);
      if (code === '42703' || code === '42P01') throw notReady(err);
      const failure = code ? SQLSTATE_FAILURE[code] : undefined;
      if (failure) return { ok: false, reason: failure };
      throw mapPgError(err) ?? err;
    }
  }

  /** Like write(), for a statement that RETURNs several rows (createRules): the ids of all of them, or the guard's refusal. */
  private async writeRows(text: string, params: unknown[]): Promise<{ ok: true; ids: string[]; pinned: number } | { ok: false; reason: AvailabilityWriteFailure }> {
    try {
      const rows = await this.sql.query<Row>(text, params);
      return { ok: true, ids: rows.map(r => r.id as string), pinned: Number(rows[0]?.pinned ?? 0) };
    } catch (err) {
      const code = sqlstateOf(err);
      if (code === '42703' || code === '42P01') throw notReady(err);
      const failure = code ? SQLSTATE_FAILURE[code] : undefined;
      if (failure) return { ok: false, reason: failure };
      throw mapPgError(err) ?? err;
    }
  }

  private ownerColumn =(owner: AvailabilityOwner) => (owner.kind === 'resource' ? 'resource_id' : 'offering_id');
  private ownerTable = (owner: AvailabilityOwner) => (owner.kind === 'resource' ? 'scheduling_resources' : 'scheduling_offerings');

  private checkZone(zone: IanaTimezone): void {
    if (!isIanaTimezone(zone)) throw invalid(['zone must be a valid IANA timezone']);
  }
  private actorId(tenant: TenantContext): string | null {
    return tenant.actor.kind === 'staff' ? tenant.actor.userId : null;
  }

  /**
   * The CTE every create starts with: pins the owner's zone if it has none (ON CONFLICT DO NOTHING: an existing pin is never changed, and two
   * racing first writes cannot disagree, the loser's pin insert is a no-op) and forces that insert to run BEFORE the rule or closure is
   * produced (the 'forced' CTE), so the BEFORE INSERT trigger of migration 036, which refuses availability whose owner has no pin, sees it. The
   * owner row is the source of the insert: a missing or other-tenant owner pins and inserts nothing. Without migration 036 the statement does
   * not analyse (undefined_table) and nothing at all is written.
   */
  private pinCte(owner: AvailabilityOwner, source: 'first_rule' | 'first_closure', refs: { org: string; owner: string; zone: string; by: string }): string {
    const column = owner.kind === 'resource' ? 'resource_id' : 'offering_id';
    return `WITH pin AS (
         INSERT INTO scheduling_availability_zones (organisation_id, ${column}, timezone, source, pinned_by)
         SELECT z.organisation_id, z.id, ${refs.zone}::text, '${source}', ${refs.by}::text
           FROM ${this.ownerTable(owner)} z WHERE z.organisation_id = ${refs.org} AND z.id = ${refs.owner}
         ON CONFLICT DO NOTHING RETURNING timezone),
       forced AS (SELECT count(*) AS n FROM pin)`;
  }

  /** The owner's pinned zone, or null when it has none (or migration 036 is not applied). Read-only. */
  async getZone(tenant: TenantContext, owner: AvailabilityOwner): Promise<StoredAvailabilityZone | null> {
    this.view(tenant);
    try {
      const rows = await this.read(
        `SELECT timezone, source, pinned_by, ${STAMP('pinned_at')} AS pinned_at FROM scheduling_availability_zones
          WHERE organisation_id = $1 AND owner_kind = $2 AND owner_id = $3`,
        [tenant.organisationId, owner.kind, owner.id],
      );
      const r = rows[0];
      return r ? { timezone: r.timezone, source: r.source, pinnedBy: r.pinned_by, pinnedAt: r.pinned_at } : null;
    } catch (err) {
      if (err instanceof AvailabilityZonesNotReadyError) return null;
      throw err;
    }
  }

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

  async createRule(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredRuleInput, zone: IanaTimezone = tenant.timezone): Promise<AvailabilityWriteResult<StoredAvailabilityRule>> {
    this.manage(tenant);
    this.checkZone(zone);
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
    // The owner's zone is pinned in the SAME statement as the rule (see pinCte): both commit or neither does. Without migration 036 the statement
    // fails at analysis time (undefined_table) with nothing written -> AvailabilityZonesNotReadyError.
    const res = await this.write(
      `${this.pinCte(owner, 'first_rule', { org: '$2', owner: '$3', zone: '$11', by: '$12' })}
       INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, offering_id, kind, label, day_of_week, start_time, end_time, valid_from, valid_to)
       SELECT $1, o.organisation_id, ${owner.kind === 'resource' ? 'o.id, NULL' : 'NULL, o.id'}, $4, $5, $6, $7::time, $8::time, $9::date, $10::date
         FROM ${this.ownerTable(owner)} o CROSS JOIN forced WHERE o.organisation_id = $2 AND o.id = $3
       RETURNING id, updated_at, (SELECT n FROM forced)::int AS pinned`, // updated_at here makes the statement fail BEFORE writing when 034 is absent
      [id, tenant.organisationId, owner.id, input.kind, input.label, input.dayOfWeek, input.startTime, input.endTime, input.validFrom, input.validTo, zone, this.actorId(tenant)],
    );
    if (res.ok === 'none') return { ok: false, reason: 'not_found' };
    if (res.ok === false) return res;
    const stored = await this.getRule(tenant, res.id);
    if (!stored) return { ok: false, reason: 'not_found' };
    return { ok: true, value: stored, pinned: res.pinned > 0 ? await this.getZone(tenant, owner) : null };
  }

  async createRules(tenant: TenantContext, owner: AvailabilityOwner, inputs: readonly NewStoredRuleInput[], zone: IanaTimezone = tenant.timezone): Promise<AvailabilityWriteResult<StoredAvailabilityRule[]>> {
    this.manage(tenant);
    this.checkZone(zone);
    const problems: string[] = [];
    if (inputs.length === 0) problems.push('at least one rule is required');
    if (inputs.length > MAX_RULE_BATCH) problems.push(`at most ${MAX_RULE_BATCH} rules can be created together`);
    inputs.forEach((input, i) => {
      const own = validateAvailabilityRuleForSet({
        id: 'candidate', organisationId: tenant.organisationId,
        resourceId: owner.kind === 'resource' ? owner.id : null, offeringId: owner.kind === 'offering' ? owner.id : null,
        dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime as string, validFrom: input.validFrom, validTo: input.validTo,
      });
      if (input.kind !== 'hours' && input.kind !== 'service_period') own.push("kind must be 'hours' or 'service_period'");
      problems.push(...own.map(p => `rule ${i + 1}: ${p}`));
    });
    if (problems.length > 0) throw invalid(problems);

    // ONE statement, so all of the rules or none: a refusal of any tuple (overlap with an existing rule, with another tuple of this very
    // statement, an archived offering, an inactive resource) rolls the whole statement back. The owner's guard (034) takes the owner lock on
    // the first tuple and holds it to the end of the statement, and a volatile BEFORE ROW trigger sees the rows the same statement
    // inserted before it, so tuples are checked against each other as well as against the stored rules.
    const params: unknown[] = [tenant.organisationId, owner.id];
    const arg = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const zoneRef = arg(zone);
    const byRef = arg(this.actorId(tenant));
    const tuples = inputs.map(input => {
      const p = [this.newId(), input.kind, input.label, input.dayOfWeek, input.startTime, input.endTime, input.validFrom, input.validTo].map(arg);
      return `(${p[0]}::text, ${p[1]}::text, ${p[2]}::text, ${p[3]}::smallint, ${p[4]}::time, ${p[5]}::time, ${p[6]}::date, ${p[7]}::date)`;
    });
    // The pin (if the owner has none) is the first thing the statement does, so the batch and its zone commit together or not at all.
    const written = await this.writeRows(
      `${this.pinCte(owner, 'first_rule', { org: '$1', owner: '$2', zone: zoneRef, by: byRef })}
       INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, offering_id, kind, label, day_of_week, start_time, end_time, valid_from, valid_to)
       SELECT v.id, o.organisation_id, ${owner.kind === 'resource' ? 'o.id, NULL' : 'NULL, o.id'}, v.kind, v.label, v.dow, v.s, v.e, v.vf, v.vt
         FROM ${this.ownerTable(owner)} o CROSS JOIN forced
        CROSS JOIN (VALUES ${tuples.join(', ')}) AS v(id, kind, label, dow, s, e, vf, vt)
        WHERE o.organisation_id = $1 AND o.id = $2
       RETURNING id, updated_at, (SELECT n FROM forced)::int AS pinned`, // updated_at here makes the statement fail BEFORE writing when 034 is absent
      params,
    );
    if (written.ok === false) return written;
    if (written.ids.length === 0) return { ok: false, reason: 'not_found' };
    const readParams: unknown[] = [tenant.organisationId, ...written.ids];
    const rows = await this.read(
      `SELECT ${RULE_COLUMNS} FROM scheduling_availability_rules r WHERE r.organisation_id = $1 AND r.id IN (${written.ids.map((_, i) => `$${i + 2}`).join(', ')}) ORDER BY r.day_of_week, r.start_time, r.id`,
      readParams,
    );
    return { ok: true, value: rows.map(toRule), pinned: written.pinned > 0 ? await this.getZone(tenant, owner) : null };
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

  async deleteOvernightWindow(tenant: TenantContext, halves: readonly [OvernightHalfRef, OvernightHalfRef]): Promise<AvailabilityWriteResult<StoredAvailabilityRule[]>> {
    this.manage(tenant);
    const problems: string[] = [];
    if (!Array.isArray(halves) || halves.length !== 2) problems.push('an overnight window is exactly two rules');
    else {
      if (halves[0].id === halves[1].id) problems.push('the two rules must be different rules');
      halves.forEach((h, i) => problems.push(...validateExpectedUpdatedAt(h.expectedUpdatedAt).map(p => `rule ${i + 1}: ${p}`)));
    }
    if (problems.length > 0) throw invalid(problems);
    const [a, b] = halves;
    const params = [tenant.organisationId, a.id, a.expectedUpdatedAt, b.id, b.expectedUpdatedAt];

    // ONE statement, all or none:
    //   want  the two rules and the version token the caller holds for each;
    //   cur   the rules that exist in THIS organisation AND still carry that token, locked FOR UPDATE in id order. The fixed order means
    //         two windows removed (or a removal and an edit) in opposite orders queue instead of deadlocking; under READ COMMITTED a row
    //         that was edited or deleted while we waited for its lock is re-checked against its new version and drops out of cur;
    //   chk   true only when BOTH are in cur and they are the two halves of one overnight window of one owner (the evening ends at 24:00,
    //         the morning starts at 00:00 on the next weekday, same owner and kind, validity shifted by one day: isOvernightWindowPair);
    //   the DELETE removes cur only if chk, and RETURNs the rows as they were, so the audit trail describes what was actually deleted.
    // Deletes take no owner lock (034 guards inserts and updates only), so this cannot wait on, or be waited on by, an owner's writers
    // except through the row locks above. Naming updated_at makes the statement fail BEFORE writing when 034 is absent.
    const written = await this.writeRowsFull(
      `WITH want(id, tok) AS (VALUES ($2::text, $3::timestamptz), ($4::text, $5::timestamptz)),
            cur AS (
              SELECT r.id, r.resource_id, r.offering_id, r.kind, r.day_of_week, r.start_time, r.end_time, r.valid_from, r.valid_to
                FROM scheduling_availability_rules r JOIN want w ON w.id = r.id
               WHERE r.organisation_id = $1 AND r.updated_at = w.tok
               ORDER BY r.id FOR UPDATE OF r),
            chk AS (
              SELECT (SELECT count(*) FROM cur) = 2 AND EXISTS (
                SELECT 1 FROM cur e JOIN cur m ON m.id <> e.id
                 WHERE e.end_time = '24:00'::time AND e.start_time <> '00:00'::time
                   AND m.start_time = '00:00'::time AND m.end_time <> '24:00'::time
                   AND m.day_of_week = (e.day_of_week + 1) % 7
                   AND m.kind = e.kind
                   AND m.resource_id IS NOT DISTINCT FROM e.resource_id AND m.offering_id IS NOT DISTINCT FROM e.offering_id
                   AND m.valid_from IS NOT DISTINCT FROM (e.valid_from + 1) AND m.valid_to IS NOT DISTINCT FROM (e.valid_to + 1)) AS ok)
       DELETE FROM scheduling_availability_rules r USING cur
        WHERE r.id = cur.id AND r.organisation_id = $1 AND (SELECT ok FROM chk)
       RETURNING ${RULE_COLUMNS}`,
      params,
    );
    if (written.ok === false) return written;
    if (written.rows.length === 2) return { ok: true, value: written.rows.map(toRule).sort((x, y) => x.dayOfWeek - y.dayOfWeek || x.startTime.localeCompare(y.startTime)) };

    // Nothing was deleted. A second READ-ONLY statement says why.
    const why = await this.read(
      `SELECT w.id, r.id IS NOT NULL AS found, COALESCE(r.updated_at = w.tok, false) AS fresh
         FROM (VALUES ($2::text, $3::timestamptz), ($4::text, $5::timestamptz)) AS w(id, tok)
         LEFT JOIN scheduling_availability_rules r ON r.id = w.id AND r.organisation_id = $1`,
      params,
    );
    if (why.length !== 2 || why.some(row => !row.found)) return { ok: false, reason: 'not_found' };
    if (why.some(row => !row.fresh)) return { ok: false, reason: 'stale_write' };
    return { ok: false, reason: 'not_overnight_window' };
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

  async createException(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredExceptionInput, zone: IanaTimezone = tenant.timezone): Promise<AvailabilityWriteResult<StoredAvailabilityException>> {
    this.manage(tenant);
    this.checkZone(zone);
    const problems = validateAvailabilityException({
      id: 'candidate', organisationId: tenant.organisationId,
      resourceId: owner.kind === 'resource' ? owner.id : null, offeringId: owner.kind === 'offering' ? owner.id : null,
      fromDate: input.fromDate, toDate: input.toDate, kind: input.kind, reason: input.reason,
      windows: input.startTime != null && input.endTime != null ? [{ startTime: input.startTime, endTime: input.endTime }] : [],
    });
    // An override needs hours and the table has no column for them (see the Phase 2B.3b doc): only closures are stored for now.
    if (input.kind === 'override') problems.splice(0, problems.length, 'override exceptions are not stored yet: only closures can be created');
    if ((input.startTime == null) !== (input.endTime == null)) problems.push('startTime and endTime must be given together (a partial-day closure), or both left out (a full-day closure)');
    if (problems.length > 0) throw invalid(problems);
    const id = this.newId();
    // A full-day closure names neither window column, so it is stored identically before and after migration 035. A partial-day closure
    // names them, and before 035 that fails at analysis time (undefined_column -> PartialClosuresNotReadyError) with nothing written.
    const partial = input.startTime != null && input.endTime != null;
    const extra = partial ? [input.startTime, input.endTime] : [];
    const zoneRef = `$${8 + extra.length}`;
    const byRef = `$${9 + extra.length}`;
    const res = await this.write(
      `${this.pinCte(owner, 'first_closure', { org: '$2', owner: '$3', zone: zoneRef, by: byRef })}
       INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, offering_id, from_date, to_date, kind, reason${partial ? ', start_time, end_time' : ''})
       SELECT $1, o.organisation_id, ${owner.kind === 'resource' ? 'o.id, NULL' : 'NULL, o.id'}, $4::date, $5::date, $6, $7${partial ? ', $8::time, $9::time' : ''}
         FROM ${this.ownerTable(owner)} o CROSS JOIN forced WHERE o.organisation_id = $2 AND o.id = $3
       RETURNING id, updated_at, (SELECT n FROM forced)::int AS pinned`, // updated_at here makes the statement fail BEFORE writing when 034 is absent
      [id, tenant.organisationId, owner.id, input.fromDate, input.toDate, input.kind, input.reason, ...extra, zone, this.actorId(tenant)],
    );
    if (res.ok === 'none') return { ok: false, reason: 'not_found' };
    if (res.ok === false) return res;
    const stored = await this.getException(tenant, res.id);
    if (!stored) return { ok: false, reason: 'not_found' };
    return { ok: true, value: stored, pinned: res.pinned > 0 ? await this.getZone(tenant, owner) : null };
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
    // The window is replaced as a pair: both given (partial-day) or both null (full-day). Naming the columns needs migration 035.
    if (changes.startTime !== undefined || changes.endTime !== undefined) {
      if ((changes.startTime == null) !== (changes.endTime == null)) problems.push('startTime and endTime must be changed together');
      sets.push(`start_time = ${arg(changes.startTime ?? null)}::time`, `end_time = ${arg(changes.endTime ?? null)}::time`);
    }
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

  /** Read-only: which optional parts of the schema exist. Lets the API (and so the screen) say "partial-day closures are not installed" up front. */
  async capabilities(tenant: TenantContext): Promise<AvailabilityCapabilities> {
    this.view(tenant);
    const rows = await this.read(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'scheduling_availability_exceptions' AND column_name IN ('start_time', 'end_time')`,
      [],
    );
    const zones = await this.read(`SELECT to_regclass('scheduling_availability_zones') IS NOT NULL AS present`, []);
    return { partialClosures: Number(rows[0]?.n ?? 0) === 2, zones: zones[0]?.present === true };
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
