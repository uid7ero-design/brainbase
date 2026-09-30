import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { auditInsert, listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import type { AssuranceTimestamp } from './sqlHelpers';
import { withFreshReference } from './references';
import {
  AUDIT_RESPONSE_TYPES, AUDIT_TYPES, checklistKeyFromLabel, parseCriteria, type AuditCriterion, type AuditType,
} from './domain';
import { isUuid, optionalBoolean, optionalDateTime, optionalText, requiredEnum, requiredText } from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Audit templates and their IMMUTABLE versions (A0.1E-1).
//
// assurance_audit_template_versions rejects UPDATE and DELETE at the
// database level. "Editing" a template always publishes version N+1; an
// Audit keeps the exact version it was created with. Same shape as
// lib/assurance/templates.ts (inspection templates) on purpose.

export type AuditTemplateListRow = {
  id: string; template_reference: string; name: string; audit_type: AuditType; description: string | null;
  is_active: boolean; latest_version_id: string | null; latest_version_number: number | null;
  latest_standard_reference: string | null; latest_criteria_count: number | null;
  version_count: number; audit_count: number; updated_at: AssuranceTimestamp;
};

export async function listAuditTemplates(viewer: AssuranceViewer, opts: { activeOnly?: boolean } = {}): Promise<AuditTemplateListRow[]> {
  const activeOnly = opts.activeOnly === true;
  return (await sql`
    SELECT t.id, t.template_reference, t.name, t.audit_type, t.description, t.is_active, t.updated_at,
           lv.id AS latest_version_id, lv.version_number AS latest_version_number,
           lv.standard_reference AS latest_standard_reference,
           jsonb_array_length(lv.criteria) AS latest_criteria_count,
           (SELECT count(*) FROM assurance_audit_template_versions v
             WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id)::int AS version_count,
           (SELECT count(*) FROM assurance_audits a
             JOIN assurance_audit_template_versions v ON v.organisation_id = a.organisation_id AND v.id = a.template_version_id
             WHERE a.organisation_id = t.organisation_id AND v.template_id = t.id)::int AS audit_count
    FROM assurance_audit_templates t
    LEFT JOIN LATERAL (
      SELECT v.id, v.version_number, v.standard_reference, v.criteria
      FROM assurance_audit_template_versions v
      WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id
      ORDER BY v.version_number DESC
      LIMIT 1
    ) lv ON true
    WHERE t.organisation_id = ${viewer.organisationId}
      AND (${activeOnly}::boolean = false OR t.is_active = true)
    ORDER BY t.is_active DESC, t.name ASC
  `) as AuditTemplateListRow[];
}

export type AuditTemplateVersionView = {
  id: string; version_number: number; title: string; standard_reference: string | null; instructions: string | null;
  effective_from: AssuranceTimestamp | null; criteria: AuditCriterion[]; invalid_criteria_count: number;
  created_at: AssuranceTimestamp; created_by_name: string | null; audit_count: number;
};

export type AuditTemplateDetail = {
  template: {
    id: string; template_reference: string; name: string; audit_type: AuditType;
    description: string | null; is_active: boolean; created_at: AssuranceTimestamp;
  };
  versions: AuditTemplateVersionView[];
  history: AssuranceHistoryEntry[];
};

type RawVersionRow = Omit<AuditTemplateVersionView, 'criteria' | 'invalid_criteria_count'> & { criteria: unknown };

export async function getAuditTemplateDetail(viewer: AssuranceViewer, id: string): Promise<AuditTemplateDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT id, template_reference, name, audit_type, description, is_active, created_at
    FROM assurance_audit_templates
    WHERE organisation_id = ${org} AND id = ${id}::uuid
  `) as AuditTemplateDetail['template'][];
  if (!rows[0]) return null;

  const [versions, history] = await Promise.all([
    sql`
      SELECT v.id, v.version_number, v.title, v.standard_reference, v.instructions, v.effective_from, v.criteria,
             v.created_at, u.name AS created_by_name,
             (SELECT count(*) FROM assurance_audits a
               WHERE a.organisation_id = v.organisation_id AND a.template_version_id = v.id)::int AS audit_count
      FROM assurance_audit_template_versions v
      LEFT JOIN users u ON u.id = v.created_by AND u.organisation_id = v.organisation_id
      WHERE v.organisation_id = ${org} AND v.template_id = ${id}::uuid
      ORDER BY v.version_number DESC
    `,
    listAssuranceHistory(org, 'assurance_audit_template', id),
  ]);

  return {
    template: rows[0],
    versions: (versions as RawVersionRow[]).map(v => {
      const parsed = parseCriteria(v.criteria);
      return {
        id: v.id, version_number: v.version_number, title: v.title, standard_reference: v.standard_reference,
        instructions: v.instructions, effective_from: v.effective_from, criteria: parsed.items,
        invalid_criteria_count: parsed.invalidCount, created_at: v.created_at, created_by_name: v.created_by_name,
        audit_count: v.audit_count,
      };
    }),
    history,
  };
}

/** Parses UI-submitted criteria into the governed stored shape. */
export function buildCriteria(raw: unknown): AuditCriterion[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AssuranceValidationError('Add at least one criterion.');
  if (raw.length > 200) throw new AssuranceValidationError('An audit can have at most 200 criteria.');
  return raw.map((entry, index) => {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const label = requiredText(e.label, `Criterion ${index + 1}`, 500);
    const responseType = requiredEnum(AUDIT_RESPONSE_TYPES, e.responseType ?? 'COMPLIANCE_RATING', `Criterion ${index + 1} type`);
    const options = Array.isArray(e.options)
      ? e.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map(o => o.trim().slice(0, 100)).slice(0, 20)
      : [];
    if (responseType === 'CHOICE' && options.length < 2) {
      throw new AssuranceValidationError(`Criterion ${index + 1} needs at least two options.`);
    }
    return {
      key: checklistKeyFromLabel(label, index),
      label,
      responseType,
      guidance: optionalText(e.guidance, `Criterion ${index + 1} guidance`, 1000),
      required: optionalBoolean(e.required, true),
      options,
    };
  });
}

function assertAdmin(viewer: AssuranceViewer): void {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage audit templates.');
}

export async function createAuditTemplate(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; template_reference: string; version_id: string }> {
  assertAdmin(viewer);
  const input = {
    name: requiredText(raw.name, 'Name', 200),
    auditType: requiredEnum(AUDIT_TYPES, raw.auditType, 'Audit type'),
    description: optionalText(raw.description, 'Description', 2000),
    standardReference: optionalText(raw.standardReference, 'Standard / reference', 300),
    instructions: optionalText(raw.instructions, 'Instructions', 4000),
    effectiveFrom: optionalDateTime(raw.effectiveFrom, 'Effective from'),
    criteria: buildCriteria(raw.criteria),
  };
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  return withFreshReference('auditTemplate', async reference => {
    await sql.transaction([
      sql`
        INSERT INTO assurance_audit_templates (id, organisation_id, template_reference, name, audit_type, description, created_by)
        VALUES (${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.name}, ${input.auditType}, ${input.description}, ${viewer.userId})
      `,
      sql`
        INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, standard_reference, instructions, criteria, effective_from, created_by)
        VALUES (${versionId}::uuid, ${viewer.organisationId}, ${id}::uuid, 1, ${input.name}, ${input.standardReference}, ${input.instructions},
                ${JSON.stringify(input.criteria)}::jsonb, COALESCE(${input.effectiveFrom}::timestamptz, now()), ${viewer.userId})
      `,
      auditInsert({
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_audit_template',
        resourceId: id, verb: 'created', after: { template_reference: reference, version_number: 1, criteria_count: input.criteria.length },
      }),
    ]);
    return { id, template_reference: reference, version_id: versionId };
  });
}

/** Publishes version N+1. Earlier versions are untouched (and untouchable). */
export async function createAuditTemplateVersion(viewer: AssuranceViewer, templateId: string, raw: Record<string, unknown>): Promise<{ id: string; version_number: number }> {
  assertAdmin(viewer);
  if (!isUuid(templateId)) throw new AssuranceNotFoundError('Template');
  const input = {
    title: requiredText(raw.title, 'Version title', 200),
    standardReference: optionalText(raw.standardReference, 'Standard / reference', 300),
    instructions: optionalText(raw.instructions, 'Instructions', 4000),
    effectiveFrom: optionalDateTime(raw.effectiveFrom, 'Effective from'),
    criteria: buildCriteria(raw.criteria),
  };
  const versionId = crypto.randomUUID();
  try {
    const rows = (await sql`
      WITH ins AS (
        INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, standard_reference, instructions, criteria, effective_from, created_by)
        SELECT ${versionId}::uuid, t.organisation_id, t.id,
               COALESCE((SELECT max(v.version_number) FROM assurance_audit_template_versions v
                          WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id), 0) + 1,
               ${input.title}, ${input.standardReference}, ${input.instructions}, ${JSON.stringify(input.criteria)}::jsonb,
               COALESCE(${input.effectiveFrom}::timestamptz, now()), ${viewer.userId}
        FROM assurance_audit_templates t
        WHERE t.organisation_id = ${viewer.organisationId} AND t.id = ${templateId}::uuid
        RETURNING id, template_id, version_number
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_audit_template.version_published',
               'assurance_audit_template', ins.template_id::text, NULL,
               jsonb_build_object('version_id', ins.id, 'version_number', ins.version_number, 'criteria_count', ${input.criteria.length}::int)
        FROM ins
      )
      SELECT id, version_number FROM ins
    `) as { id: string; version_number: number }[];
    if (!rows[0]) throw new AssuranceNotFoundError('Template');
    return rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AssuranceConflictError('Another version was published at the same time. Refresh and try again.');
    }
    throw err;
  }
}

export async function setAuditTemplateActive(viewer: AssuranceViewer, templateId: string, active: boolean): Promise<void> {
  assertAdmin(viewer);
  if (!isUuid(templateId)) throw new AssuranceNotFoundError('Template');
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_audit_templates SET is_active = ${active}, updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid AND is_active <> ${active}
      RETURNING id
    ), aud AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId},
             ${active ? 'assurance_audit_template.reactivated' : 'assurance_audit_template.deactivated'},
             'assurance_audit_template', upd.id::text, NULL, jsonb_build_object('is_active', ${active}::boolean)
      FROM upd
    )
    SELECT id FROM upd
  `) as { id: string }[];
  if (!rows[0]) {
    const exists = (await sql`SELECT 1 FROM assurance_audit_templates WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid`) as unknown[];
    if (exists.length === 0) throw new AssuranceNotFoundError('Template');
  }
}
