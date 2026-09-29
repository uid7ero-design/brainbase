import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { auditInsert, listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import type { AssuranceTimestamp } from './sqlHelpers';
import { withFreshReference } from './references';
import {
  INSPECTION_RESPONSE_TYPES, INSPECTION_TYPES, checklistKeyFromLabel, parseChecklist,
  type ChecklistItem, type InspectionType,
} from './domain';
import { isUuid, optionalBoolean, optionalText, requiredEnum, requiredText } from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Inspection templates and their IMMUTABLE versions.
//
// assurance_inspection_template_versions rejects UPDATE and DELETE at the
// database level (A0.1D-3 trigger). This service never attempts either:
// changing a checklist always means inserting version N+1. Inspections
// reference the exact version they were run against, so history is
// preserved by construction.

export type TemplateListRow = {
  id: string; template_reference: string; name: string; inspection_type: InspectionType; description: string | null;
  is_active: boolean; latest_version_id: string | null; latest_version_number: number | null;
  latest_item_count: number | null; version_count: number; inspection_count: number; updated_at: AssuranceTimestamp;
};

export async function listTemplates(viewer: AssuranceViewer, opts: { activeOnly?: boolean } = {}): Promise<TemplateListRow[]> {
  const activeOnly = opts.activeOnly === true;
  return (await sql`
    SELECT t.id, t.template_reference, t.name, t.inspection_type, t.description, t.is_active, t.updated_at,
           lv.id AS latest_version_id, lv.version_number AS latest_version_number,
           jsonb_array_length(lv.checklist) AS latest_item_count,
           (SELECT count(*) FROM assurance_inspection_template_versions v
             WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id)::int AS version_count,
           (SELECT count(*) FROM assurance_inspections i
             JOIN assurance_inspection_template_versions v
               ON v.organisation_id = i.organisation_id AND v.id = i.template_version_id
             WHERE i.organisation_id = t.organisation_id AND v.template_id = t.id)::int AS inspection_count
    FROM assurance_inspection_templates t
    LEFT JOIN LATERAL (
      SELECT v.id, v.version_number, v.checklist
      FROM assurance_inspection_template_versions v
      WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id
      ORDER BY v.version_number DESC
      LIMIT 1
    ) lv ON true
    WHERE t.organisation_id = ${viewer.organisationId}
      AND (${activeOnly}::boolean = false OR t.is_active = true)
    ORDER BY t.is_active DESC, t.name ASC
  `) as TemplateListRow[];
}

export type TemplateVersionView = {
  id: string; version_number: number; title: string; instructions: string | null;
  items: ChecklistItem[]; invalid_item_count: number; created_at: AssuranceTimestamp; created_by_name: string | null;
  inspection_count: number;
};

export type TemplateDetail = {
  template: {
    id: string; template_reference: string; name: string; inspection_type: InspectionType;
    description: string | null; is_active: boolean; created_at: AssuranceTimestamp;
  };
  versions: TemplateVersionView[];
  history: AssuranceHistoryEntry[];
};

type RawVersionRow = Omit<TemplateVersionView, 'items' | 'invalid_item_count'> & { checklist: unknown };

export async function getTemplateDetail(viewer: AssuranceViewer, id: string): Promise<TemplateDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT id, template_reference, name, inspection_type, description, is_active, created_at
    FROM assurance_inspection_templates
    WHERE organisation_id = ${org} AND id = ${id}::uuid
  `) as TemplateDetail['template'][];
  if (!rows[0]) return null;

  const [versions, history] = await Promise.all([
    sql`
      SELECT v.id, v.version_number, v.title, v.instructions, v.checklist, v.created_at, u.name AS created_by_name,
             (SELECT count(*) FROM assurance_inspections i
               WHERE i.organisation_id = v.organisation_id AND i.template_version_id = v.id)::int AS inspection_count
      FROM assurance_inspection_template_versions v
      LEFT JOIN users u ON u.id = v.created_by AND u.organisation_id = v.organisation_id
      WHERE v.organisation_id = ${org} AND v.template_id = ${id}::uuid
      ORDER BY v.version_number DESC
    `,
    listAssuranceHistory(org, 'assurance_inspection_template', id),
  ]);

  return {
    template: rows[0],
    versions: (versions as RawVersionRow[]).map(v => {
      const parsed = parseChecklist(v.checklist);
      return {
        id: v.id, version_number: v.version_number, title: v.title, instructions: v.instructions,
        items: parsed.items, invalid_item_count: parsed.invalidCount, created_at: v.created_at,
        created_by_name: v.created_by_name, inspection_count: v.inspection_count,
      };
    }),
    history,
  };
}

/** Parses UI-submitted checklist items into the governed stored shape. */
export function buildChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AssuranceValidationError('Add at least one checklist item.');
  if (raw.length > 200) throw new AssuranceValidationError('A checklist can have at most 200 items.');
  return raw.map((entry, index) => {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const label = requiredText(e.label, `Checklist item ${index + 1}`, 300);
    const responseType = requiredEnum(INSPECTION_RESPONSE_TYPES, e.responseType ?? 'PASS_FAIL', `Checklist item ${index + 1} type`);
    const options = Array.isArray(e.options)
      ? e.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map(o => o.trim().slice(0, 100)).slice(0, 20)
      : [];
    if ((responseType === 'CHOICE' || responseType === 'MULTI_CHOICE') && options.length < 2) {
      throw new AssuranceValidationError(`Checklist item ${index + 1} needs at least two options.`);
    }
    return {
      key: checklistKeyFromLabel(label, index),
      label,
      responseType,
      guidance: optionalText(e.guidance, `Checklist item ${index + 1} guidance`, 1000),
      required: optionalBoolean(e.required, true),
      options,
    };
  });
}

export async function createTemplate(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; template_reference: string; version_id: string }> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage inspection templates.');
  const input = {
    name: requiredText(raw.name, 'Name', 200),
    inspectionType: requiredEnum(INSPECTION_TYPES, raw.inspectionType, 'Inspection type'),
    description: optionalText(raw.description, 'Description', 2000),
    instructions: optionalText(raw.instructions, 'Instructions', 4000),
    items: buildChecklist(raw.items),
  };
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  return withFreshReference('template', async reference => {
    await sql.transaction([
      sql`
        INSERT INTO assurance_inspection_templates (id, organisation_id, template_reference, name, inspection_type, description, created_by)
        VALUES (${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.name}, ${input.inspectionType}, ${input.description}, ${viewer.userId})
      `,
      sql`
        INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by)
        VALUES (${versionId}::uuid, ${viewer.organisationId}, ${id}::uuid, 1, ${input.name}, ${input.instructions},
                ${JSON.stringify(input.items)}::jsonb, now(), ${viewer.userId})
      `,
      auditInsert({
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_inspection_template',
        resourceId: id, verb: 'created', after: { template_reference: reference, version_number: 1, item_count: input.items.length },
      }),
    ]);
    return { id, template_reference: reference, version_id: versionId };
  });
}

/** Publishes version N+1. Earlier versions are untouched (and untouchable). */
export async function createTemplateVersion(viewer: AssuranceViewer, templateId: string, raw: Record<string, unknown>): Promise<{ id: string; version_number: number }> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage inspection templates.');
  if (!isUuid(templateId)) throw new AssuranceNotFoundError('Template');
  const input = {
    title: requiredText(raw.title, 'Version title', 200),
    instructions: optionalText(raw.instructions, 'Instructions', 4000),
    items: buildChecklist(raw.items),
  };
  const versionId = crypto.randomUUID();
  try {
    const rows = (await sql`
      WITH ins AS (
        INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by)
        SELECT ${versionId}::uuid, t.organisation_id, t.id,
               COALESCE((SELECT max(v.version_number) FROM assurance_inspection_template_versions v
                          WHERE v.organisation_id = t.organisation_id AND v.template_id = t.id), 0) + 1,
               ${input.title}, ${input.instructions}, ${JSON.stringify(input.items)}::jsonb, now(), ${viewer.userId}
        FROM assurance_inspection_templates t
        WHERE t.organisation_id = ${viewer.organisationId} AND t.id = ${templateId}::uuid
        RETURNING id, template_id, version_number
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_inspection_template.version_published',
               'assurance_inspection_template', ins.template_id::text, NULL,
               jsonb_build_object('version_id', ins.id, 'version_number', ins.version_number, 'item_count', ${input.items.length}::int)
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

export async function setTemplateActive(viewer: AssuranceViewer, templateId: string, active: boolean): Promise<void> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage inspection templates.');
  if (!isUuid(templateId)) throw new AssuranceNotFoundError('Template');
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_inspection_templates SET is_active = ${active}, updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid AND is_active <> ${active}
      RETURNING id
    ), aud AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId},
             ${active ? 'assurance_inspection_template.reactivated' : 'assurance_inspection_template.deactivated'},
             'assurance_inspection_template', upd.id::text, NULL, jsonb_build_object('is_active', ${active}::boolean)
      FROM upd
    )
    SELECT id FROM upd
  `) as { id: string }[];
  if (!rows[0]) {
    const exists = (await sql`SELECT 1 FROM assurance_inspection_templates WHERE organisation_id = ${viewer.organisationId} AND id = ${templateId}::uuid`) as unknown[];
    if (exists.length === 0) throw new AssuranceNotFoundError('Template');
  }
}
