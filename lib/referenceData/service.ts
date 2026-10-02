import 'server-only';
import sql from '@/lib/db';
import { roleGte, type Role } from '@/lib/session';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from '@/lib/assurance/errors';
import {
  REACTIVATABLE_STATUS, REFERENCE_CONFIG, normaliseReference, parseReferenceInput,
  type ReferenceKind,
} from './rules';

// BrainBase shared reference data — locations, assets and external
// organisations (A0.1B platform tables; no schema change, no duplicates).
//
// Ownership: these are BrainBase entities. Assurance consumes them (its
// workflow tables hold composite (organisation_id, id) FKs, ON DELETE NO
// ACTION) and Assurance → Settings → Reference data is currently the only
// screen that manages them — through THIS shared service, so a future
// platform-level screen reuses the same rules, audit and concurrency.
//
//   * Never deleted. A record is retired by status (ACTIVE → INACTIVE): it
//     disappears from selectors for NEW records and stays on every existing
//     record. There is no delete operation in this module.
//   * The reference is a stable identifier, immutable after creation.
//   * Every query is scoped to the actor's organisation (never a posted id).
//   * Every mutation is one guarded statement inside sql.transaction(): it
//     locks the target row (FOR UPDATE), re-checks the caller's revision
//     (stale edits refused), writes the change and its audit row — both or
//     neither. Concurrent creates of the same reference are serialised by
//     UNIQUE (organisation_id, reference) and reported as a conflict.
//
// sql.unsafe() is used ONLY for table / column / alias names from the fixed
// TABLES allow-list below; no caller-supplied text ever reaches it. Field
// values travel as one typed jsonb parameter (jsonb_to_record).
//
// Errors reuse the typed classes in lib/assurance/errors (zero-import,
// HTTP-mapped by the only current caller, the Assurance API).

// ── Actor & permission ───────────────────────────────────────────────────

export type ReferenceDataActor = {
  organisationId: string;
  userId: string;
  role: Role;
  /** Whether usage counts (across all, including restricted, records) may be shown. */
  canSeeUsage: boolean;
};

/**
 * Administering shared reference data is an organisation-admin capability.
 * No separate shared-entity permission exists in BrainBase; this is the
 * smallest correct rule and does not depend on any Assurance role, so an
 * Assurance grant can never widen it. (Assurance routes additionally
 * require the Assurance capability before calling in.)
 */
export const REFERENCE_DATA_ADMIN_ROLE: Role = 'admin';

export function canAdministerReferenceData(role: Role): boolean {
  return roleGte(role, REFERENCE_DATA_ADMIN_ROLE);
}

function requireAdmin(actor: ReferenceDataActor, kind: ReferenceKind) {
  if (!canAdministerReferenceData(actor.role)) {
    throw new AssuranceForbiddenError(`Only organisation admins can manage ${REFERENCE_CONFIG[kind].plural.toLowerCase()}.`);
  }
}

// ── Fixed table allow-list ───────────────────────────────────────────────

type TableSpec = {
  table: string;
  referenceColumn: string;
  typeColumn: string | null;
  /** Request field key → column (excludes multiselect 'roles'). */
  columns: Record<string, string>;
  resourceType: ReferenceKind;
  notFound: string;
  /** Count of Assurance records referencing r.id (r = the reference row alias). */
  usage: string;
};

const TABLES: Record<ReferenceKind, TableSpec> = {
  location: {
    table: 'locations',
    referenceColumn: 'location_reference',
    typeColumn: 'location_type',
    columns: {
      locationType: 'location_type', description: 'description', addressLine1: 'address_line_1', addressLine2: 'address_line_2',
      suburb: 'suburb', state: 'state', postcode: 'postcode', countryCode: 'country_code',
    },
    resourceType: 'location',
    notFound: 'Location',
    usage: `(
        (SELECT count(*) FROM assurance_incidents x WHERE x.organisation_id = r.organisation_id AND x.location_id = r.id)
      + (SELECT count(*) FROM assurance_inspections x WHERE x.organisation_id = r.organisation_id AND x.location_id = r.id)
      + (SELECT count(*) FROM assurance_audits x WHERE x.organisation_id = r.organisation_id AND x.location_id = r.id)
      + (SELECT count(*) FROM assurance_findings x WHERE x.organisation_id = r.organisation_id AND x.location_id = r.id)
      + (SELECT count(*) FROM assurance_evidence x WHERE x.organisation_id = r.organisation_id AND x.location_id = r.id)
      + (SELECT count(*) FROM assurance_cases x WHERE x.organisation_id = r.organisation_id AND x.location_id = r.id)
    )::int`,
  },
  asset: {
    table: 'assets',
    referenceColumn: 'asset_reference',
    typeColumn: 'asset_type',
    columns: { assetType: 'asset_type', description: 'description', externalIdentifier: 'external_identifier' },
    resourceType: 'asset',
    notFound: 'Asset',
    usage: `(
        (SELECT count(*) FROM assurance_incidents x WHERE x.organisation_id = r.organisation_id AND x.asset_id = r.id)
      + (SELECT count(*) FROM assurance_inspections x WHERE x.organisation_id = r.organisation_id AND x.asset_id = r.id)
      + (SELECT count(*) FROM assurance_audits x WHERE x.organisation_id = r.organisation_id AND x.asset_id = r.id)
      + (SELECT count(*) FROM assurance_findings x WHERE x.organisation_id = r.organisation_id AND x.asset_id = r.id)
      + (SELECT count(*) FROM assurance_cases x WHERE x.organisation_id = r.organisation_id AND x.asset_id = r.id)
    )::int`,
  },
  external_organisation: {
    table: 'external_organisations',
    referenceColumn: 'reference',
    typeColumn: null,
    columns: { legalName: 'legal_name', businessIdentifier: 'business_identifier', email: 'email', phone: 'phone', website: 'website' },
    resourceType: 'external_organisation',
    notFound: 'External organisation',
    usage: `(
        (SELECT count(*) FROM assurance_incidents x WHERE x.organisation_id = r.organisation_id AND x.external_organisation_id = r.id)
      + (SELECT count(*) FROM assurance_inspections x WHERE x.organisation_id = r.organisation_id AND x.external_organisation_id = r.id)
      + (SELECT count(*) FROM assurance_audits x WHERE x.organisation_id = r.organisation_id AND x.external_organisation_id = r.id)
      + (SELECT count(*) FROM assurance_cases x WHERE x.organisation_id = r.organisation_id AND x.external_organisation_id = r.id)
      + (SELECT count(*) FROM assurance_findings x WHERE x.organisation_id = r.organisation_id AND x.responsible_external_organisation_id = r.id)
      + (SELECT count(*) FROM assurance_actions x WHERE x.organisation_id = r.organisation_id AND x.responsible_external_organisation_id = r.id)
    )::int`,
  },
};

const u = (s: string) => sql.unsafe(s);
const columnList = (spec: TableSpec) => Object.values(spec.columns).join(', ');
const recordDef = (spec: TableSpec) => Object.values(spec.columns).map(c => `${c} text`).join(', ');
const selectCols = (spec: TableSpec, alias: string) => Object.values(spec.columns).map(c => `${alias}.${c}`).join(', ');

// Stable text form of updated_at (microsecond precision): the optimistic-concurrency revision.
const revisionOf = (alias: string) => sql`to_char(${u(alias)}.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

const ROLES_OF = (alias: string) => sql`(
  SELECT coalesce(array_agg(er.role ORDER BY er.role), '{}'::text[]) FROM external_organisation_roles er
  WHERE er.organisation_id = ${u(alias)}.organisation_id AND er.external_organisation_id = ${u(alias)}.id AND er.active = true
)`;

// ── Reads ────────────────────────────────────────────────────────────────

export type ReferenceAdminRow = {
  id: string;
  kind: ReferenceKind;
  reference: string;
  name: string;
  type: string | null;
  status: string;
  /** Field values keyed by the rules' field keys (roles as string[]). */
  fields: Record<string, string | null | string[]>;
  revision: string;
  created_at: string;
  updated_at: string;
  /** Assurance records referencing it; null when the actor may not see every record. */
  usage_count: number | null;
};

type RawRow = {
  id: string; reference: string; name: string; type: string | null; status: string; revision: string;
  created_at: string; updated_at: string; usage_count: number | null; data: Record<string, unknown>; roles: string[] | null;
};

function toAdminRow(kind: ReferenceKind, r: RawRow): ReferenceAdminRow {
  const spec = TABLES[kind];
  const fields: ReferenceAdminRow['fields'] = {};
  for (const [key, col] of Object.entries(spec.columns)) {
    const v = r.data[col];
    fields[key] = v === null || v === undefined ? null : String(v);
  }
  if (kind === 'external_organisation') fields.roles = r.roles ?? [];
  return {
    id: r.id, kind, reference: r.reference, name: r.name, type: r.type, status: r.status, fields,
    revision: r.revision, created_at: r.created_at, updated_at: r.updated_at, usage_count: r.usage_count,
  };
}

/** Every record of `kind` in the actor's organisation (all statuses), by name. */
export async function listReferenceRecords(actor: ReferenceDataActor, kind: ReferenceKind): Promise<ReferenceAdminRow[]> {
  const spec = TABLES[kind];
  const rows = (await sql`
    SELECT r.id, r.${u(spec.referenceColumn)} AS reference, r.name,
           ${spec.typeColumn ? sql`r.${u(spec.typeColumn)}` : sql`NULL::text`} AS type,
           r.status, ${revisionOf('r')} AS revision, r.created_at, r.updated_at,
           to_jsonb(r) AS data,
           ${kind === 'external_organisation' ? ROLES_OF('r') : sql`NULL::text[]`} AS roles,
           CASE WHEN ${actor.canSeeUsage}::boolean THEN ${u(spec.usage)} ELSE NULL END AS usage_count
    FROM ${u(spec.table)} r
    WHERE r.organisation_id = ${actor.organisationId}
    ORDER BY (r.status = 'ACTIVE') DESC, lower(r.name) ASC, r.${u(spec.referenceColumn)} ASC
    LIMIT 2000
  `) as RawRow[];
  return rows.map(r => toAdminRow(kind, r));
}

export type ReferenceSummary = { kind: ReferenceKind; total: number; active: number };

/** Counts per kind for the Settings landing cards. */
export async function summariseReferenceData(organisationId: string): Promise<ReferenceSummary[]> {
  const [row] = (await sql`
    SELECT
      (SELECT count(*) FROM locations WHERE organisation_id = ${organisationId})::int AS location_total,
      (SELECT count(*) FROM locations WHERE organisation_id = ${organisationId} AND status = 'ACTIVE')::int AS location_active,
      (SELECT count(*) FROM assets WHERE organisation_id = ${organisationId})::int AS asset_total,
      (SELECT count(*) FROM assets WHERE organisation_id = ${organisationId} AND status = 'ACTIVE')::int AS asset_active,
      (SELECT count(*) FROM external_organisations WHERE organisation_id = ${organisationId})::int AS external_organisation_total,
      (SELECT count(*) FROM external_organisations WHERE organisation_id = ${organisationId} AND status = 'ACTIVE')::int AS external_organisation_active
  `) as Record<string, number>[];
  return (['location', 'asset', 'external_organisation'] as const).map(kind => ({
    kind, total: row[`${kind}_total`], active: row[`${kind}_active`],
  }));
}

export type ReferenceHistoryRow = { id: string; action: string; created_at: string; user_name: string | null; reference: string | null; name: string | null };

/** Recent change history for one kind in the actor's organisation (newest first). */
export async function listReferenceHistory(actor: ReferenceDataActor, kind: ReferenceKind, limit = 30): Promise<ReferenceHistoryRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  return (await sql`
    SELECT l.id, l.action, l.created_at, u.name AS user_name,
           coalesce(l.after_state->>'reference', l.before_state->>'reference') AS reference,
           coalesce(l.after_state->>'name', l.before_state->>'name') AS name
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id AND u.organisation_id = l.organisation_id
    WHERE l.organisation_id = ${actor.organisationId} AND l.resource_type = ${TABLES[kind].resourceType}
    ORDER BY l.created_at DESC
    LIMIT ${capped}
  `) as ReferenceHistoryRow[];
}

// ── Write helpers ────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredRevision(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) {
    throw new AssuranceValidationError('This form is out of date. Refresh the page and try again.');
  }
  return value;
}

function parsed(kind: ReferenceKind, raw: Record<string, unknown>, create: boolean) {
  const r = parseReferenceInput(kind, raw, create);
  if (!r.ok) throw new AssuranceValidationError(r.error);
  return r.values;
}

/** "An asset", "An external organisation", "A location". */
function article(singular: string): string {
  return `${/^[aeiou]/i.test(singular) ? 'An' : 'A'} ${singular}`;
}

function mapDbError(kind: ReferenceKind, err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  const what = REFERENCE_CONFIG[kind].singular;
  if (e?.code === '23505') {
    if (`${e.constraint ?? ''} ${e.message ?? ''}`.includes('reference_key')) {
      throw new AssuranceConflictError(`Another ${what} already uses that reference. References must be unique, including inactive records.`);
    }
    throw new AssuranceConflictError(`That ${what} conflicts with an existing one. Refresh and try again.`);
  }
  if (e?.code === '23514') throw new AssuranceValidationError(`One of the values is not allowed for ${article(what).toLowerCase()}.`);
  throw err;
}

type CurrentState = { id: string; reference: string; name: string; status: string; revision: string; data: Record<string, unknown>; roles: string[] };

async function getState(actor: ReferenceDataActor, kind: ReferenceKind, id: string): Promise<CurrentState> {
  const spec = TABLES[kind];
  if (!UUID.test(id)) throw new AssuranceNotFoundError(spec.notFound);
  const [row] = (await sql`
    SELECT r.id, r.${u(spec.referenceColumn)} AS reference, r.name, r.status, ${revisionOf('r')} AS revision, to_jsonb(r) AS data,
           ${kind === 'external_organisation' ? ROLES_OF('r') : sql`'{}'::text[]`} AS roles
    FROM ${u(spec.table)} r
    WHERE r.organisation_id = ${actor.organisationId} AND r.id = ${id}::uuid
  `) as CurrentState[];
  if (!row) throw new AssuranceNotFoundError(spec.notFound);
  return row;
}

/** Audit payload: identifiers, names, type/roles and status only — never descriptions, addresses or contact details. */
function auditStateSql(kind: ReferenceKind, alias: string, rolesSql: ReturnType<typeof sql>) {
  const spec = TABLES[kind];
  return sql`jsonb_build_object(
    'id', ${u(alias)}.id, 'reference', ${u(alias)}.${u(spec.referenceColumn)}, 'name', ${u(alias)}.name, 'status', ${u(alias)}.status,
    'type', ${spec.typeColumn ? sql`${u(alias)}.${u(spec.typeColumn)}` : sql`NULL::text`},
    'roles', ${kind === 'external_organisation' ? sql`to_jsonb(${rolesSql})` : sql`NULL::jsonb`}
  )`;
}

/** Roles writes for an external organisation, gated on `gate` (a CTE that is empty when the guard fails). */
function rolesSyncSql(actor: ReferenceDataActor, gate: string, roles: string[]) {
  return sql`
    roles_on AS (
      INSERT INTO external_organisation_roles (organisation_id, external_organisation_id, role, active, created_by)
      SELECT ${actor.organisationId}, g.id, x.role, true, ${actor.userId}
      FROM ${u(gate)} g, unnest(${roles}::text[]) AS x(role)
      ON CONFLICT (organisation_id, external_organisation_id, role)
      DO UPDATE SET active = true, updated_at = now() WHERE external_organisation_roles.active = false
      RETURNING role
    ), roles_off AS (
      UPDATE external_organisation_roles er SET active = false, updated_at = now()
      FROM ${u(gate)} g
      WHERE er.organisation_id = ${actor.organisationId} AND er.external_organisation_id = g.id
        AND er.active = true AND NOT (er.role = ANY(${roles}::text[]))
      RETURNING er.role
    )`;
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function createReferenceRecord(
  actor: ReferenceDataActor, kind: ReferenceKind, raw: Record<string, unknown>,
): Promise<{ id: string; reference: string }> {
  requireAdmin(actor, kind);
  const spec = TABLES[kind];
  const v = parsed(kind, raw, true);
  const reference = v.reference!;
  const org = actor.organisationId;

  const dup = (await sql`SELECT 1 FROM ${u(spec.table)} WHERE organisation_id = ${org} AND ${u(spec.referenceColumn)} = ${reference}`) as unknown[];
  if (dup.length > 0) throw new AssuranceConflictError(`${article(REFERENCE_CONFIG[kind].singular)} with reference ${reference} already exists.`);

  const values: Record<string, string | null> = {};
  for (const [key, col] of Object.entries(spec.columns)) values[col] = (v.fields[key] as string | null) ?? null;
  const roles = kind === 'external_organisation' ? (v.fields.roles as string[]) : [];

  let rows: { id: string; reference: string }[];
  try {
    const [result] = await sql.transaction([
      sql`
        WITH ins AS (
          INSERT INTO ${u(spec.table)} (organisation_id, ${u(spec.referenceColumn)}, name, ${u(columnList(spec))}, status, created_by)
          SELECT ${org}, ${reference}, ${v.name}, ${u(selectCols(spec, 'x'))}, 'ACTIVE', ${actor.userId}
          FROM jsonb_to_record(${JSON.stringify(values)}::jsonb) AS x(${u(recordDef(spec))})
          RETURNING *
        )${kind === 'external_organisation' ? sql`, ${rolesSyncSql(actor, 'ins', roles)}` : sql``}, aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${org}, ${actor.userId}, ${`${spec.resourceType}.created`}, ${spec.resourceType}, ins.id::text,
                 NULL, ${auditStateSql(kind, 'ins', sql`${roles}::text[]`)}
          FROM ins
        )
        SELECT id, ${u(spec.referenceColumn)} AS reference FROM ins
      `,
    ]);
    rows = result as { id: string; reference: string }[];
  } catch (err) {
    mapDbError(kind, err);
  }
  return rows[0];
}

export async function updateReferenceRecord(
  actor: ReferenceDataActor, kind: ReferenceKind, id: string, raw: Record<string, unknown>,
): Promise<{ id: string }> {
  requireAdmin(actor, kind);
  const spec = TABLES[kind];
  const current = await getState(actor, kind, id);
  if (raw.reference !== undefined && raw.reference !== null && normaliseReference(raw.reference) !== current.reference) {
    throw new AssuranceValidationError('A reference cannot be changed after the record is created.');
  }
  const expectedRevision = requiredRevision(raw.expectedRevision);
  if (expectedRevision !== current.revision) {
    throw new AssuranceConflictError(`This ${REFERENCE_CONFIG[kind].singular} was changed by someone else. Refresh and try again.`);
  }
  const v = parsed(kind, raw, false);

  const name = raw.name === undefined ? current.name : v.name;
  const values: Record<string, string | null> = {};
  const changed: string[] = name !== current.name ? ['name'] : [];
  for (const [key, col] of Object.entries(spec.columns)) {
    const before = current.data[col] === null || current.data[col] === undefined ? null : String(current.data[col]);
    const next = key in v.fields ? (v.fields[key] as string | null) : before;
    values[col] = next;
    if (next !== before) changed.push(key);
  }
  const roles = kind === 'external_organisation' && 'roles' in v.fields ? (v.fields.roles as string[]) : current.roles;
  if (kind === 'external_organisation' && [...roles].sort().join(',') !== [...current.roles].sort().join(',')) changed.push('roles');
  if (changed.length === 0) throw new AssuranceValidationError('Nothing to save: no changes were made.');

  let rows: { id: string }[];
  try {
    const [result] = await sql.transaction([
      sql`
        WITH target AS (
          SELECT r.* FROM ${u(spec.table)} r
          WHERE r.organisation_id = ${actor.organisationId} AND r.id = ${current.id}::uuid AND ${revisionOf('r')} = ${expectedRevision}
          FOR UPDATE
        ), before_roles AS (
          SELECT ${kind === 'external_organisation' ? ROLES_OF('target') : sql`'{}'::text[]`} AS roles FROM target
        ), upd AS (
          UPDATE ${u(spec.table)} r
          SET name = ${name}, (${u(columnList(spec))}) = (SELECT ${u(selectCols(spec, 'x'))} FROM jsonb_to_record(${JSON.stringify(values)}::jsonb) AS x(${u(recordDef(spec))})),
              updated_at = now()
          FROM target t
          WHERE r.organisation_id = ${actor.organisationId} AND r.id = t.id
          RETURNING r.*
        )${kind === 'external_organisation' ? sql`, ${rolesSyncSql(actor, 'upd', roles)}` : sql``}, aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${actor.organisationId}, ${actor.userId}, ${`${spec.resourceType}.updated`}, ${spec.resourceType}, upd.id::text,
                 ${auditStateSql(kind, 't', sql`br.roles`)},
                 ${auditStateSql(kind, 'upd', sql`${roles}::text[]`)} || jsonb_build_object('changed_fields', ${JSON.stringify(changed)}::jsonb)
          FROM upd, target t, before_roles br
        )
        SELECT id FROM upd
      `,
    ]);
    rows = result as { id: string }[];
  } catch (err) {
    mapDbError(kind, err);
  }
  if (!rows[0]) throw new AssuranceConflictError(`This ${REFERENCE_CONFIG[kind].singular} was changed by someone else while you were saving. Refresh and try again.`);
  return rows[0];
}

async function setStatus(
  actor: ReferenceDataActor, kind: ReferenceKind, id: string, raw: Record<string, unknown>, activate: boolean,
): Promise<{ id: string }> {
  requireAdmin(actor, kind);
  const spec = TABLES[kind];
  const what = REFERENCE_CONFIG[kind].singular;
  const current = await getState(actor, kind, id);
  const expectedRevision = requiredRevision(raw.expectedRevision);
  if (expectedRevision !== current.revision) throw new AssuranceConflictError(`This ${what} was changed by someone else. Refresh and try again.`);

  const from = activate ? REACTIVATABLE_STATUS : 'ACTIVE';
  const to = activate ? 'ACTIVE' : 'INACTIVE';
  if (current.status !== from) {
    if (activate && current.status === 'ACTIVE') throw new AssuranceConflictError(`This ${what} is already active.`);
    if (!activate && current.status === 'INACTIVE') throw new AssuranceConflictError(`This ${what} is already inactive.`);
    throw new AssuranceConflictError(`This ${what} is ${current.status.toLowerCase()} and cannot be ${activate ? 'reactivated' : 'deactivated'} here.`);
  }
  // Reactivation re-validates the stored reference against today's rules.
  if (activate) {
    const problem = parseReferenceInput(kind, { reference: current.reference, name: current.name, ...requiredFieldsOf(kind, current) }, true);
    if (!problem.ok) throw new AssuranceConflictError(`This ${what} cannot be reactivated: ${problem.error}`);
  }

  const rolesNow = kind === 'external_organisation' ? sql`${current.roles}::text[]` : sql`'{}'::text[]`;
  const [result] = await sql.transaction([
    sql`
      WITH target AS (
        SELECT r.* FROM ${u(spec.table)} r
        WHERE r.organisation_id = ${actor.organisationId} AND r.id = ${current.id}::uuid
          AND ${revisionOf('r')} = ${expectedRevision} AND r.status = ${from}
        FOR UPDATE
      ), upd AS (
        UPDATE ${u(spec.table)} r SET status = ${to}, updated_at = now()
        FROM target t
        WHERE r.organisation_id = ${actor.organisationId} AND r.id = t.id
        RETURNING r.*
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${actor.organisationId}, ${actor.userId},
               ${`${spec.resourceType}.${activate ? 'reactivated' : 'deactivated'}`}, ${spec.resourceType}, upd.id::text,
               ${auditStateSql(kind, 't', rolesNow)}, ${auditStateSql(kind, 'upd', rolesNow)}
        FROM upd, target t
      )
      SELECT id FROM upd
    `,
  ]);
  const rows = result as { id: string }[];
  if (!rows[0]) throw new AssuranceConflictError(`This ${what} was changed by someone else while you were saving. Refresh and try again.`);
  return rows[0];
}

/** Current values of the required select fields, so reactivation re-validates them too. */
function requiredFieldsOf(kind: ReferenceKind, current: CurrentState): Record<string, unknown> {
  const spec = TABLES[kind];
  const out: Record<string, unknown> = {};
  for (const f of REFERENCE_CONFIG[kind].fields) {
    if (f.required && spec.columns[f.key]) out[f.key] = current.data[spec.columns[f.key]];
  }
  return out;
}

/** Retires a record: it stays on every existing Assurance record and is no longer offered for new ones. */
export async function deactivateReferenceRecord(actor: ReferenceDataActor, kind: ReferenceKind, id: string, raw: Record<string, unknown>) {
  return setStatus(actor, kind, id, raw, false);
}

export async function reactivateReferenceRecord(actor: ReferenceDataActor, kind: ReferenceKind, id: string, raw: Record<string, unknown>) {
  return setStatus(actor, kind, id, raw, true);
}
