import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { listAssuranceHistory, type AssuranceAuditResource, type AssuranceHistoryEntry } from './audit';
import type { AssuranceTimestamp } from './sqlHelpers';
import { withFreshReference } from './references';
import {
  AUDIT_RESPONSE_TYPES, AUDIT_TYPES, INSPECTION_RESPONSE_TYPES, INSPECTION_TYPES, TEMPLATE_KINDS,
  checklistKeyFromLabel, parseChecklist, parseCriteria,
  type AuditCriterion, type ChecklistItem, type TemplateKind, type TemplateVersionStatus,
} from './domain';
import { isUuid, optionalBoolean, optionalText, requiredEnum, requiredText } from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Assurance templates (Inspection and Audit) — A0.1F lifecycle.
//
//   template identity ──< versions:  DRAFT ──publish──> PUBLISHED ──> RETIRED
//
// * A template has at most one DRAFT and at most one PUBLISHED version
//   (A0.1F partial unique indexes). Publishing a draft retires the previous
//   PUBLISHED version in the same statement (A0.1F trigger).
// * Only a DRAFT is ever edited. PUBLISHED and RETIRED content is immutable
//   in the database; "Create new version" copies the current version into a
//   new DRAFT.
// * Inspections and Audits bind to one exact PUBLISHED version (A0.1F binding
//   trigger) and render that version's wording forever after.
// * Every mutation locks the template row in its own statement, then runs ONE
//   guarded statement that writes the change and its audit row together
//   (lock-then-guard: the guarded statement gets a fresh snapshot). Draft
//   edits and publishes are additionally guarded on lock_version, so a stale
//   editor gets a conflict instead of silently overwriting someone's work.
// * Template name/type/description are editable only until the template is
//   first published, so a record never shows renamed template wording.

type KindConfig = {
  templates: string;
  versions: string;
  records: string;
  typeColumn: string;
  itemsColumn: string;
  resource: AssuranceAuditResource;
  reference: 'template' | 'auditTemplate';
  types: readonly string[];
  responseTypes: readonly string[];
  defaultResponseType: string;
  multiOptionTypes: readonly string[];
  itemNoun: string;
  label: string;
};

const KINDS: Record<TemplateKind, KindConfig> = {
  inspection: {
    templates: 'assurance_inspection_templates',
    versions: 'assurance_inspection_template_versions',
    records: 'assurance_inspections',
    typeColumn: 'inspection_type',
    itemsColumn: 'checklist',
    resource: 'assurance_inspection_template',
    reference: 'template',
    types: INSPECTION_TYPES,
    responseTypes: INSPECTION_RESPONSE_TYPES,
    defaultResponseType: 'PASS_FAIL',
    multiOptionTypes: ['CHOICE', 'MULTI_CHOICE'],
    itemNoun: 'Checklist item',
    label: 'Inspection',
  },
  audit: {
    templates: 'assurance_audit_templates',
    versions: 'assurance_audit_template_versions',
    records: 'assurance_audits',
    typeColumn: 'audit_type',
    itemsColumn: 'criteria',
    resource: 'assurance_audit_template',
    reference: 'auditTemplate',
    types: AUDIT_TYPES,
    responseTypes: AUDIT_RESPONSE_TYPES,
    defaultResponseType: 'COMPLIANCE_RATING',
    multiOptionTypes: ['CHOICE'],
    itemNoun: 'Criterion',
    label: 'Audit',
  },
};

// Table/column names are a fixed allow-list interpolated via sql.unsafe();
// no caller-supplied text is ever passed to sql.unsafe().
const ALLOWED_IDENTIFIERS = new Set(
  Object.values(KINDS).flatMap(k => [k.templates, k.versions, k.records, k.typeColumn, k.itemsColumn]),
);
function ident(name: string) {
  if (!ALLOWED_IDENTIFIERS.has(name)) throw new Error(`assurance templates: identifier "${name}" is not allow-listed`);
  return sql.unsafe(name);
}

export const TEMPLATE_ITEM_LIMIT = 200;

export function parseTemplateKind(value: unknown): TemplateKind {
  return requiredEnum(TEMPLATE_KINDS, value, 'Template kind');
}

function assertAdmin(viewer: AssuranceViewer): void {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage Assurance templates.');
}

export type TemplateItem = ChecklistItem | AuditCriterion;

/** A template's status is derived from its versions and its active flag. */
export type TemplateStatus = TemplateVersionStatus;

function deriveStatus(row: { is_active: boolean; published_version_id: string | null; released_count: number }): TemplateStatus {
  if (row.published_version_id && row.is_active) return 'PUBLISHED';
  return row.released_count === 0 ? 'DRAFT' : 'RETIRED';
}

// ── Items ────────────────────────────────────────────────────────────────

/**
 * Parses UI-submitted items into the governed stored shape. Drafts may be
 * incomplete (no items, a choice item still missing options); publishing
 * applies publishProblems() on top.
 */
export function buildTemplateItems(kind: TemplateKind, raw: unknown): TemplateItem[] {
  const k = KINDS[kind];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AssuranceValidationError(`${k.itemNoun}s must be a list.`);
  if (raw.length > TEMPLATE_ITEM_LIMIT) throw new AssuranceValidationError(`A template can have at most ${TEMPLATE_ITEM_LIMIT} ${k.itemNoun.toLowerCase()}s.`);
  return raw.map((entry, index) => {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const n = `${k.itemNoun} ${index + 1}`;
    const label = requiredText(e.label, n, kind === 'audit' ? 500 : 300);
    const responseType = requiredEnum(k.responseTypes, e.responseType ?? k.defaultResponseType, `${n} type`);
    const options = Array.isArray(e.options)
      ? e.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map(o => o.trim().slice(0, 100)).slice(0, 20)
      : [];
    return {
      key: checklistKeyFromLabel(label, index),
      label,
      responseType,
      guidance: optionalText(e.guidance, `${n} guidance`, 1000),
      required: optionalBoolean(e.required, true),
      options: k.multiOptionTypes.includes(responseType) ? options : [],
      section: optionalText(e.section, `${n} section`, 120),
    } as TemplateItem;
  });
}

/** Server-side publish validation. Returns user-facing problems; empty = publishable. */
export function publishProblems(kind: TemplateKind, version: { title: string | null; items: readonly TemplateItem[]; invalidCount: number }): string[] {
  const k = KINDS[kind];
  const problems: string[] = [];
  if (!version.title || !version.title.trim()) problems.push('Add a version title.');
  if (version.invalidCount > 0) problems.push(`${version.invalidCount} ${k.itemNoun.toLowerCase()}(s) cannot be read. Re-save the draft.`);
  if (version.items.length === 0) problems.push(`Add at least one ${k.itemNoun.toLowerCase()}.`);
  if (version.items.length > TEMPLATE_ITEM_LIMIT) problems.push(`A template can have at most ${TEMPLATE_ITEM_LIMIT} ${k.itemNoun.toLowerCase()}s.`);
  const labels = new Set<string>();
  const closedSections = new Set<string>();
  let current: string | null = null;
  version.items.forEach((it, i) => {
    const n = `${k.itemNoun} ${i + 1}`;
    const norm = it.label.trim().toLowerCase();
    if (labels.has(norm)) problems.push(`${n} repeats the wording of an earlier ${k.itemNoun.toLowerCase()}.`);
    labels.add(norm);
    if (k.multiOptionTypes.includes(it.responseType) && it.options.length < 2) problems.push(`${n} needs at least two options.`);
    if (it.section !== current) {
      if (current !== null) closedSections.add(current);
      if (it.section !== null && closedSections.has(it.section)) problems.push(`Section "${it.section}" is split; keep its ${k.itemNoun.toLowerCase()}s together.`);
      current = it.section;
    }
  });
  return problems;
}

function parseItems(kind: TemplateKind, raw: unknown): { items: TemplateItem[]; invalidCount: number } {
  return kind === 'audit' ? parseCriteria(raw) : parseChecklist(raw);
}

function draftContent(kind: TemplateKind, raw: Record<string, unknown>, fallbackTitle: string) {
  return {
    title: optionalText(raw.title, 'Version title', 200) ?? fallbackTitle,
    instructions: optionalText(raw.instructions, 'Instructions', 4000),
    standardReference: kind === 'audit' ? optionalText(raw.standardReference, 'Standard / reference', 300) : null,
    items: buildTemplateItems(kind, raw.items),
  };
}

// ── Reads ────────────────────────────────────────────────────────────────

export type TemplateListRow = {
  kind: TemplateKind;
  id: string; template_reference: string; name: string; template_type: string; description: string | null;
  status: TemplateStatus;
  published_version_id: string | null; published_version_number: number | null; published_item_count: number | null;
  draft_version_number: number | null; version_count: number; record_count: number;
  updated_at: AssuranceTimestamp;
};

type RawListRow = Omit<TemplateListRow, 'kind' | 'status'> & { is_active: boolean; released_count: number };

async function listKind(viewer: AssuranceViewer, kind: TemplateKind): Promise<TemplateListRow[]> {
  const k = KINDS[kind];
  const rows = (await sql`
    SELECT t.id, t.template_reference, t.name, t.${ident(k.typeColumn)} AS template_type, t.description, t.is_active,
           pv.id AS published_version_id, pv.version_number AS published_version_number,
           jsonb_array_length(pv.${ident(k.itemsColumn)}) AS published_item_count,
           dv.version_number AS draft_version_number,
           (SELECT count(*) FROM ${ident(k.versions)} v WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id)::int AS version_count,
           (SELECT count(*) FROM ${ident(k.versions)} v
             WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id AND v.status <> 'DRAFT')::int AS released_count,
           (SELECT count(*) FROM ${ident(k.records)} r
             JOIN ${ident(k.versions)} v ON v.organisation_id = r.organisation_id AND v.id = r.template_version_id
             WHERE r.organisation_id = t.organisation_id AND v.template_id = t.id)::int AS record_count,
           GREATEST(t.updated_at, (SELECT max(v.updated_at) FROM ${ident(k.versions)} v
             WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id)) AS updated_at
    FROM ${ident(k.templates)} t
    LEFT JOIN ${ident(k.versions)} pv ON pv.organisation_id = t.organisation_id AND pv.template_id = t.id AND pv.status = 'PUBLISHED'
    LEFT JOIN ${ident(k.versions)} dv ON dv.organisation_id = t.organisation_id AND dv.template_id = t.id AND dv.status = 'DRAFT'
    WHERE t.organisation_id = ${viewer.organisationId}
    ORDER BY t.name ASC
  `) as RawListRow[];
  return rows.map(({ is_active, released_count, ...r }) => ({
    ...r, kind, status: deriveStatus({ is_active, published_version_id: r.published_version_id, released_count }),
  }));
}

export async function listAssuranceTemplates(
  viewer: AssuranceViewer,
  opts: { kind?: TemplateKind | null; status?: TemplateStatus | null } = {},
): Promise<TemplateListRow[]> {
  const kinds = opts.kind ? [opts.kind] : [...TEMPLATE_KINDS];
  const lists = await Promise.all(kinds.map(kind => listKind(viewer, kind)));
  const order: Record<TemplateStatus, number> = { PUBLISHED: 0, DRAFT: 1, RETIRED: 2 };
  return lists.flat()
    .filter(r => !opts.status || r.status === opts.status)
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}

export type PublishedTemplateOption = {
  version_id: string; template_id: string; name: string; template_type: string; version_number: number;
  item_count: number; standard_reference: string | null;
};

/** Selector source for planning a new Inspection/Audit: PUBLISHED versions of active same-org templates only. */
export async function listPublishedTemplateOptions(viewer: AssuranceViewer, kind: TemplateKind): Promise<PublishedTemplateOption[]> {
  const k = KINDS[kind];
  return (await sql`
    SELECT v.id AS version_id, t.id AS template_id, t.name, t.${ident(k.typeColumn)} AS template_type, v.version_number,
           jsonb_array_length(v.${ident(k.itemsColumn)})::int AS item_count,
           ${kind === 'audit' ? sql`v.standard_reference` : sql`NULL::text`} AS standard_reference
    FROM ${ident(k.templates)} t
    JOIN ${ident(k.versions)} v ON v.organisation_id = t.organisation_id AND v.template_id = t.id AND v.status = 'PUBLISHED'
    WHERE t.organisation_id = ${viewer.organisationId} AND t.is_active = true
    ORDER BY t.name ASC
  `) as PublishedTemplateOption[];
}

export type TemplateVersionView = {
  id: string; version_number: number; status: TemplateVersionStatus; title: string; instructions: string | null;
  standard_reference: string | null; items: TemplateItem[]; invalid_item_count: number; lock_version: number;
  created_at: AssuranceTimestamp; created_by_name: string | null;
  updated_at: AssuranceTimestamp; updated_by_name: string | null;
  published_at: AssuranceTimestamp | null; published_by_name: string | null;
  retired_at: AssuranceTimestamp | null; retired_by_name: string | null;
  record_count: number;
};

export type TemplateDetail = {
  kind: TemplateKind;
  template: {
    id: string; template_reference: string; name: string; template_type: string; description: string | null;
    is_active: boolean; status: TemplateStatus; created_at: AssuranceTimestamp;
  };
  /** Newest first. */
  versions: TemplateVersionView[];
  draft: TemplateVersionView | null;
  published: TemplateVersionView | null;
  /** Name/type/description can still change (never published). */
  identityEditable: boolean;
  history: AssuranceHistoryEntry[];
};

type RawVersionRow = Omit<TemplateVersionView, 'items' | 'invalid_item_count'> & { items: unknown };

export async function getAssuranceTemplate(viewer: AssuranceViewer, kind: TemplateKind, id: string): Promise<TemplateDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs resource ids are stored lowercase
  const k = KINDS[kind];
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT id, template_reference, name, ${ident(k.typeColumn)} AS template_type, description, is_active, created_at
    FROM ${ident(k.templates)}
    WHERE organisation_id = ${org} AND id = ${id}::uuid
  `) as Omit<TemplateDetail['template'], 'status'>[];
  if (!rows[0]) return null;

  const [rawVersions, history] = await Promise.all([
    sql`
      SELECT v.id, v.version_number, v.status, v.title, v.instructions,
             ${kind === 'audit' ? sql`v.standard_reference` : sql`NULL::text`} AS standard_reference,
             v.${ident(k.itemsColumn)} AS items, v.lock_version,
             v.created_at, cu.name AS created_by_name, v.updated_at, uu.name AS updated_by_name,
             v.published_at, pu.name AS published_by_name, v.retired_at, ru.name AS retired_by_name,
             (SELECT count(*) FROM ${ident(k.records)} r
               WHERE r.organisation_id = v.organisation_id AND r.template_version_id = v.id)::int AS record_count
      FROM ${ident(k.versions)} v
      LEFT JOIN users cu ON cu.id = v.created_by AND cu.organisation_id = v.organisation_id
      LEFT JOIN users uu ON uu.id = v.updated_by AND uu.organisation_id = v.organisation_id
      LEFT JOIN users pu ON pu.id = v.published_by AND pu.organisation_id = v.organisation_id
      LEFT JOIN users ru ON ru.id = v.retired_by AND ru.organisation_id = v.organisation_id
      WHERE v.organisation_id = ${org} AND v.template_id = ${id}::uuid
      ORDER BY v.version_number DESC
    `,
    listAssuranceHistory(org, k.resource, id),
  ]);

  const versions = (rawVersions as RawVersionRow[]).map(({ items, ...v }) => {
    const parsed = parseItems(kind, items);
    return { ...v, items: parsed.items, invalid_item_count: parsed.invalidCount };
  });
  const published = versions.find(v => v.status === 'PUBLISHED') ?? null;
  const releasedCount = versions.filter(v => v.status !== 'DRAFT').length;
  return {
    kind,
    template: {
      ...rows[0],
      status: deriveStatus({ is_active: rows[0].is_active, published_version_id: published?.id ?? null, released_count: releasedCount }),
    },
    versions,
    draft: versions.find(v => v.status === 'DRAFT') ?? null,
    published,
    identityEditable: releasedCount === 0,
    history,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────

function lockTemplate(kind: TemplateKind, viewer: AssuranceViewer, templateId: string) {
  const k = KINDS[kind];
  return sql`SELECT id FROM ${ident(k.templates)} WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid FOR UPDATE`;
}

/** Maps A0.1F lifecycle trigger / index errors to user-facing conflicts. */
function mapLifecycleError(err: unknown): never {
  const code = (err as { code?: string }).code;
  if (code === 'AT001' || code === 'AT003') {
    throw new AssuranceConflictError('This template changed while you were working. Reload and try again.');
  }
  if (code === '23505' && /one_draft/.test(String((err as { constraint?: string; message?: string }).constraint ?? (err as Error).message))) {
    throw new AssuranceConflictError('This template already has a draft version.');
  }
  throw err;
}

/** Last statement result of a sql.transaction (neon returns one array per statement). */
function lastResult<T>(results: unknown): T[] {
  const all = results as unknown[][];
  return (all[all.length - 1] ?? []) as T[];
}

/** Creates the template identity and its version 1 as a DRAFT. Nothing is selectable until it is published. */
export async function createAssuranceTemplate(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ kind: TemplateKind; id: string; template_reference: string; version_id: string }> {
  assertAdmin(viewer);
  const kind = parseTemplateKind(raw.kind);
  const k = KINDS[kind];
  const name = requiredText(raw.name, 'Name', 200);
  const input = {
    name,
    templateType: requiredEnum(k.types, raw.templateType, `${k.label} type`),
    description: optionalText(raw.description, 'Description', 2000),
    ...draftContent(kind, raw, name),
  };
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  return withFreshReference(k.reference, async reference => {
    await sql.transaction([
      sql`
        INSERT INTO ${ident(k.templates)} (id, organisation_id, template_reference, name, ${ident(k.typeColumn)}, description, is_active, created_by)
        VALUES (${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.name}, ${input.templateType}, ${input.description}, false, ${viewer.userId})
      `,
      sql`
        INSERT INTO ${ident(k.versions)} (
          id, organisation_id, template_id, version_number, title, instructions,
          ${kind === 'audit' ? sql`standard_reference,` : sql``} ${ident(k.itemsColumn)},
          status, published_at, published_by, created_by, updated_by
        ) VALUES (
          ${versionId}::uuid, ${viewer.organisationId}, ${id}::uuid, 1, ${input.title}, ${input.instructions},
          ${kind === 'audit' ? sql`${input.standardReference},` : sql``} ${JSON.stringify(input.items)}::jsonb,
          'DRAFT', NULL, NULL, ${viewer.userId}, ${viewer.userId}
        )
      `,
      sql`
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        VALUES (${crypto.randomUUID()}, ${viewer.organisationId}, ${viewer.userId}, ${`${k.resource}.created`}, ${k.resource}, ${id},
                NULL, ${JSON.stringify({ template_reference: reference, version_id: versionId, version_number: 1, status: 'DRAFT', item_count: input.items.length })}::jsonb)
      `,
    ]);
    return { kind, id, template_reference: reference, version_id: versionId };
  });
}

type VersionState = { id: string; status: TemplateVersionStatus; lock_version: number; version_number: number };

async function readVersionState(kind: TemplateKind, viewer: AssuranceViewer, templateId: string, versionId: string): Promise<VersionState | null> {
  const k = KINDS[kind];
  const rows = (await sql`
    SELECT id, status, lock_version, version_number FROM ${ident(k.versions)}
    WHERE organisation_id = ${viewer.organisationId} AND template_id = ${templateId}::uuid AND id = ${versionId}::uuid
  `) as VersionState[];
  return rows[0] ?? null;
}

function requiredLockVersion(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new AssuranceValidationError('Reload the template and try again.');
  return n;
}

function explainStale(state: VersionState | null, lockVersion: number, label: string): never {
  if (!state) throw new AssuranceNotFoundError('Template version');
  if (state.status !== 'DRAFT') {
    throw new AssuranceConflictError(`Version ${state.version_number} is ${state.status.toLowerCase()} and can no longer change. Create a new version instead.`);
  }
  if (state.lock_version !== lockVersion) {
    throw new AssuranceConflictError(`Someone else saved this draft since you opened it. Reload to see their changes before ${label}.`);
  }
  throw new AssuranceConflictError('This template changed while you were working. Reload and try again.');
}

/** Saves a DRAFT version (and, until first publication, the template's name/type/description). */
export async function updateTemplateDraft(viewer: AssuranceViewer, templateId: string, raw: Record<string, unknown>): Promise<{ version_id: string; lock_version: number }> {
  assertAdmin(viewer);
  const kind = parseTemplateKind(raw.kind);
  const k = KINDS[kind];
  if (!isUuid(templateId) || !isUuid(raw.versionId)) throw new AssuranceNotFoundError('Template');
  const versionId = String(raw.versionId).toLowerCase();
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const content = draftContent(kind, raw, '');
  if (!content.title) throw new AssuranceValidationError('Version title is required.');
  const identity = raw.name !== undefined
    ? {
        name: requiredText(raw.name, 'Name', 200),
        templateType: requiredEnum(k.types, raw.templateType, `${k.label} type`),
        description: optionalText(raw.description, 'Description', 2000),
      }
    : null;
  const editIdentity = identity !== null;

  let results: unknown;
  try {
    results = await sql.transaction([
      lockTemplate(kind, viewer, templateId),
      sql`
        WITH upd AS (
          UPDATE ${ident(k.versions)} v
             SET title = ${content.title}, instructions = ${content.instructions},
                 ${kind === 'audit' ? sql`standard_reference = ${content.standardReference},` : sql``}
                 ${ident(k.itemsColumn)} = ${JSON.stringify(content.items)}::jsonb,
                 updated_by = ${viewer.userId}, lock_version = v.lock_version + 1
           WHERE v.organisation_id = ${viewer.organisationId} AND v.template_id = ${templateId}::uuid AND v.id = ${versionId}::uuid
             AND v.status = 'DRAFT' AND v.lock_version = ${lockVersion}::int
             AND (${editIdentity}::boolean = false OR NOT EXISTS (
               SELECT 1 FROM ${ident(k.versions)} x
               WHERE x.organisation_id = v.organisation_id AND x.template_id = v.template_id AND x.status <> 'DRAFT'))
          RETURNING v.id, v.template_id, v.version_number, v.lock_version
        ), tpl AS (
          UPDATE ${ident(k.templates)} t
             SET name = COALESCE(${identity?.name ?? null}::text, t.name),
                 ${ident(k.typeColumn)} = COALESCE(${identity?.templateType ?? null}::text, t.${ident(k.typeColumn)}),
                 description = CASE WHEN ${editIdentity}::boolean THEN ${identity?.description ?? null}::text ELSE t.description END,
                 updated_at = now()
            FROM upd
           WHERE t.organisation_id = ${viewer.organisationId} AND t.id = upd.template_id
          RETURNING t.id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${k.resource}.updated`}, ${k.resource},
                 upd.template_id::text, NULL,
                 jsonb_build_object('version_id', upd.id, 'version_number', upd.version_number, 'status', 'DRAFT',
                   'lock_version', upd.lock_version, 'item_count', ${content.items.length}::int, 'identity_updated', ${editIdentity}::boolean)
          FROM upd
        )
        SELECT upd.id, upd.lock_version FROM upd
      `,
    ]);
  } catch (err) {
    mapLifecycleError(err);
  }
  const row = lastResult<{ id: string; lock_version: number }>(results)[0];
  if (!row) {
    const state = await readVersionState(kind, viewer, templateId, versionId);
    if (state && state.status === 'DRAFT' && state.lock_version === lockVersion && editIdentity) {
      throw new AssuranceConflictError('The name and type are fixed once a template has been published.');
    }
    explainStale(state, lockVersion, 'saving');
  }
  return { version_id: row.id, lock_version: row.lock_version };
}

/** Copies the current (published, else latest retired) version into a new DRAFT N+1. */
export async function createTemplateVersion(viewer: AssuranceViewer, templateId: string, raw: Record<string, unknown>): Promise<{ id: string; version_number: number }> {
  assertAdmin(viewer);
  const kind = parseTemplateKind(raw.kind);
  const k = KINDS[kind];
  if (!isUuid(templateId)) throw new AssuranceNotFoundError('Template');
  const versionId = crypto.randomUUID();
  let results: unknown;
  try {
    results = await sql.transaction([
      lockTemplate(kind, viewer, templateId),
      sql`
        WITH src AS (
          SELECT v.* FROM ${ident(k.versions)} v
          WHERE v.organisation_id = ${viewer.organisationId} AND v.template_id = ${templateId}::uuid AND v.status <> 'DRAFT'
          ORDER BY (v.status = 'PUBLISHED') DESC, v.version_number DESC
          LIMIT 1
        ), ins AS (
          INSERT INTO ${ident(k.versions)} (
            id, organisation_id, template_id, version_number, title, instructions,
            ${kind === 'audit' ? sql`standard_reference,` : sql``} ${ident(k.itemsColumn)},
            status, published_at, published_by, created_by, updated_by
          )
          SELECT ${versionId}::uuid, src.organisation_id, src.template_id,
                 (SELECT max(x.version_number) FROM ${ident(k.versions)} x
                   WHERE x.organisation_id = src.organisation_id AND x.template_id = src.template_id) + 1,
                 src.title, src.instructions, ${kind === 'audit' ? sql`src.standard_reference,` : sql``} src.${ident(k.itemsColumn)},
                 'DRAFT', NULL, NULL, ${viewer.userId}, ${viewer.userId}
          FROM src
          WHERE NOT EXISTS (
            SELECT 1 FROM ${ident(k.versions)} d
            WHERE d.organisation_id = src.organisation_id AND d.template_id = src.template_id AND d.status = 'DRAFT')
          RETURNING id, template_id, version_number
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${k.resource}.version_created`}, ${k.resource},
                 ins.template_id::text, NULL,
                 jsonb_build_object('version_id', ins.id, 'version_number', ins.version_number, 'status', 'DRAFT',
                   'copied_from_version_number', (SELECT version_number FROM src))
          FROM ins
        )
        SELECT id, version_number FROM ins
      `,
    ]);
  } catch (err) {
    mapLifecycleError(err);
  }
  const row = lastResult<{ id: string; version_number: number }>(results)[0];
  if (row) return row;

  const state = (await sql`
    SELECT
      EXISTS (SELECT 1 FROM ${ident(k.templates)} WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid) AS template_exists,
      (SELECT version_number FROM ${ident(k.versions)} WHERE organisation_id = ${viewer.organisationId} AND template_id = ${templateId}::uuid AND status = 'DRAFT') AS draft_number
  `) as { template_exists: boolean; draft_number: number | null }[];
  if (!state[0]?.template_exists) throw new AssuranceNotFoundError('Template');
  if (state[0].draft_number !== null) throw new AssuranceConflictError(`Version ${state[0].draft_number} is already a draft. Edit or publish it first.`);
  throw new AssuranceConflictError('Publish the first draft before creating another version.');
}

/**
 * Publishes a DRAFT after server-side validation. The previously PUBLISHED
 * version (if any) is retired by the same statement; records already bound
 * to it keep it.
 */
export async function publishTemplateVersion(viewer: AssuranceViewer, templateId: string, raw: Record<string, unknown>): Promise<{ version_id: string; version_number: number; superseded_version_number: number | null }> {
  assertAdmin(viewer);
  const kind = parseTemplateKind(raw.kind);
  const k = KINDS[kind];
  if (!isUuid(templateId) || !isUuid(raw.versionId)) throw new AssuranceNotFoundError('Template');
  const versionId = String(raw.versionId).toLowerCase();
  const lockVersion = requiredLockVersion(raw.lockVersion);

  // Validate the exact content that will be published: the guarded write
  // below only succeeds if lock_version is still the one read here.
  const drafts = (await sql`
    SELECT v.status, v.lock_version, v.version_number, v.title, v.${ident(k.itemsColumn)} AS items
    FROM ${ident(k.versions)} v
    WHERE v.organisation_id = ${viewer.organisationId} AND v.template_id = ${templateId}::uuid AND v.id = ${versionId}::uuid
  `) as { status: TemplateVersionStatus; lock_version: number; version_number: number; title: string; items: unknown }[];
  const draft = drafts[0];
  if (!draft || draft.status !== 'DRAFT' || draft.lock_version !== lockVersion) {
    explainStale(draft ? { id: versionId, status: draft.status, lock_version: draft.lock_version, version_number: draft.version_number } : null, lockVersion, 'publishing');
  }
  const parsed = parseItems(kind, draft.items);
  const problems = publishProblems(kind, { title: draft.title, items: parsed.items, invalidCount: parsed.invalidCount });
  if (problems.length > 0) throw new AssuranceValidationError(`Version ${draft.version_number} cannot be published yet: ${problems.join(' ')}`);

  let results: unknown;
  try {
    results = await sql.transaction([
      lockTemplate(kind, viewer, templateId),
      sql`
        WITH prev AS (
          SELECT id, version_number FROM ${ident(k.versions)}
          WHERE organisation_id = ${viewer.organisationId} AND template_id = ${templateId}::uuid AND status = 'PUBLISHED'
        ), upd AS (
          UPDATE ${ident(k.versions)} v
             SET status = 'PUBLISHED', published_at = now(), published_by = ${viewer.userId},
                 updated_by = ${viewer.userId}, lock_version = v.lock_version + 1
           WHERE v.organisation_id = ${viewer.organisationId} AND v.template_id = ${templateId}::uuid AND v.id = ${versionId}::uuid
             AND v.status = 'DRAFT' AND v.lock_version = ${lockVersion}::int
          RETURNING v.id, v.template_id, v.version_number
        ), tpl AS (
          UPDATE ${ident(k.templates)} t SET is_active = true, updated_at = now()
            FROM upd
           WHERE t.organisation_id = ${viewer.organisationId} AND t.id = upd.template_id
          RETURNING t.id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${k.resource}.published`}, ${k.resource},
                 upd.template_id::text, NULL,
                 jsonb_build_object('version_id', upd.id, 'version_number', upd.version_number, 'status', 'PUBLISHED',
                   'item_count', ${parsed.items.length}::int,
                   'superseded_version_id', (SELECT id FROM prev), 'superseded_version_number', (SELECT version_number FROM prev))
          FROM upd
        )
        SELECT upd.id, upd.version_number, (SELECT version_number FROM prev) AS superseded_version_number
        FROM upd
      `,
    ]);
  } catch (err) {
    mapLifecycleError(err);
  }
  const row = lastResult<{ id: string; version_number: number; superseded_version_number: number | null }>(results)[0];
  if (!row) explainStale(await readVersionState(kind, viewer, templateId, versionId), lockVersion, 'publishing');
  return { version_id: row.id, version_number: row.version_number, superseded_version_number: row.superseded_version_number };
}

/**
 * Retires the template: its PUBLISHED version becomes RETIRED and it is no
 * longer offered for new records. Existing records keep their version. A
 * pending draft is kept; publishing it later brings the template back.
 */
export async function retireAssuranceTemplate(viewer: AssuranceViewer, templateId: string, raw: Record<string, unknown>): Promise<{ version_number: number }> {
  assertAdmin(viewer);
  const kind = parseTemplateKind(raw.kind);
  const k = KINDS[kind];
  if (!isUuid(templateId)) throw new AssuranceNotFoundError('Template');
  let results: unknown;
  try {
    results = await sql.transaction([
      lockTemplate(kind, viewer, templateId),
      sql`
        WITH upd AS (
          UPDATE ${ident(k.versions)} v
             SET status = 'RETIRED', retired_at = now(), retired_by = ${viewer.userId},
                 updated_by = ${viewer.userId}, lock_version = v.lock_version + 1
           WHERE v.organisation_id = ${viewer.organisationId} AND v.template_id = ${templateId}::uuid AND v.status = 'PUBLISHED'
          RETURNING v.id, v.template_id, v.version_number
        ), tpl AS (
          UPDATE ${ident(k.templates)} t SET is_active = false, updated_at = now()
            FROM upd
           WHERE t.organisation_id = ${viewer.organisationId} AND t.id = upd.template_id
          RETURNING t.id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${k.resource}.retired`}, ${k.resource},
                 upd.template_id::text, NULL,
                 jsonb_build_object('version_id', upd.id, 'version_number', upd.version_number, 'status', 'RETIRED')
          FROM upd
        )
        SELECT upd.version_number FROM upd
      `,
    ]);
  } catch (err) {
    mapLifecycleError(err);
  }
  const row = lastResult<{ version_number: number }>(results)[0];
  if (row) return row;
  const exists = (await sql`SELECT 1 FROM ${ident(k.templates)} WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid`) as unknown[];
  if (exists.length === 0) throw new AssuranceNotFoundError('Template');
  throw new AssuranceConflictError('Only a published template can be retired.');
}

/**
 * Wraps the Inspection/Audit create transaction: the A0.1F binding trigger
 * (AT002) rejects a version that was retired or superseded after the
 * service's own check — the race the trigger's FOR SHARE lock closes.
 */
export async function rejectUnpublishedTemplate<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (err) {
    if ((err as { code?: string }).code === 'AT002') {
      throw new AssuranceConflictError('Template version is no longer published (it was retired or replaced). Choose the current template and try again.');
    }
    throw err;
  }
}
