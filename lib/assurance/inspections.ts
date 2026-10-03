import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { findingVisibleSql, evidenceVisibleSql } from './access';
import { auditInsert, listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import { auditFromCte, type AssuranceTimestamp } from './sqlHelpers';
import { assertSameOrgUsers } from './users';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import { rejectUnpublishedTemplate } from './templateLifecycle';
import type { EvidenceLinkRow } from './incidents';
import {
  INSPECTION_OUTCOMES, INSPECTION_RESPONSE_TYPES, INSPECTION_STATUSES, INSPECTION_TYPES, parseChecklist,
  type ChecklistItem, type InspectionOutcome, type InspectionResponseType, type InspectionStatus, type InspectionType,
} from './domain';
import {
  isUuid, optionalDateTime, optionalEnum, optionalText, optionalUserId, optionalUuid, requiredEnum, requiredText,
  searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Inspections: planned / in-progress / completed, template-based (bound
// to one immutable template version) or ad hoc (no template; items are
// defined as responses are recorded).
//
// Completing an inspection never creates or closes Findings. Findings are
// raised explicitly (lib/assurance/findings.ts) from failed/observation
// items and linked through assurance_inspection_findings.

export type InspectionListFilters = {
  q?: string;
  status?: string;
  view?: 'due' | 'planned' | 'in_progress' | 'completed' | 'all';
  inspectionType?: string;
  source?: 'template' | 'adhoc';
  locationId?: string;
};

export type InspectionListRow = {
  id: string; inspection_reference: string; title: string; inspection_type: InspectionType; status: InspectionStatus;
  scheduled_at: AssuranceTimestamp | null; started_at: AssuranceTimestamp | null; completed_at: AssuranceTimestamp | null;
  inspector_name: string | null; location_name: string | null;
  template_name: string | null; template_version_number: number | null;
  fail_count: number; observation_count: number; response_count: number; finding_count: number;
};

export async function listInspections(viewer: AssuranceViewer, filters: InspectionListFilters = {}): Promise<InspectionListRow[]> {
  const pattern = searchPattern(filters.q);
  const status = INSPECTION_STATUSES.includes(filters.status as InspectionStatus) ? filters.status! : null;
  const type = INSPECTION_TYPES.includes(filters.inspectionType as InspectionType) ? filters.inspectionType! : null;
  const view = filters.view && ['due', 'planned', 'in_progress', 'completed'].includes(filters.view) ? filters.view : 'all';
  const source = filters.source === 'template' || filters.source === 'adhoc' ? filters.source : null;
  const locationId = isUuid(filters.locationId) ? filters.locationId : null;

  return (await sql`
    SELECT i.id, i.inspection_reference, i.title, i.inspection_type, i.status, i.scheduled_at, i.started_at, i.completed_at,
           iu.name AS inspector_name, loc.name AS location_name,
           t.name AS template_name, v.version_number AS template_version_number,
           (SELECT count(*) FROM assurance_inspection_responses r
             WHERE r.organisation_id = i.organisation_id AND r.inspection_id = i.id AND r.outcome = 'FAIL')::int AS fail_count,
           (SELECT count(*) FROM assurance_inspection_responses r
             WHERE r.organisation_id = i.organisation_id AND r.inspection_id = i.id AND r.outcome = 'OBSERVATION')::int AS observation_count,
           (SELECT count(*) FROM assurance_inspection_responses r
             WHERE r.organisation_id = i.organisation_id AND r.inspection_id = i.id)::int AS response_count,
           (SELECT count(*) FROM assurance_inspection_findings xf
             WHERE xf.organisation_id = i.organisation_id AND xf.inspection_id = i.id)::int AS finding_count
    FROM assurance_inspections i
    LEFT JOIN users iu ON iu.id = i.inspector_user_id AND iu.organisation_id = i.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = i.organisation_id AND loc.id = i.location_id
    LEFT JOIN assurance_inspection_template_versions v ON v.organisation_id = i.organisation_id AND v.id = i.template_version_id
    LEFT JOIN assurance_inspection_templates t ON t.organisation_id = v.organisation_id AND t.id = v.template_id
    WHERE i.organisation_id = ${viewer.organisationId}
      AND (${status}::text IS NULL OR i.status = ${status})
      AND (${type}::text IS NULL OR i.inspection_type = ${type})
      AND (${view}::text <> 'due' OR (i.status = 'PLANNED' AND i.scheduled_at IS NOT NULL AND i.scheduled_at < now() + interval '7 days'))
      AND (${view}::text <> 'planned' OR i.status = 'PLANNED')
      AND (${view}::text <> 'in_progress' OR i.status = 'IN_PROGRESS')
      AND (${view}::text <> 'completed' OR i.status = 'COMPLETED')
      AND (${source}::text IS NULL OR (${source}::text = 'template') = (i.template_version_id IS NOT NULL))
      AND (${locationId}::uuid IS NULL OR i.location_id = ${locationId}::uuid)
      AND (${pattern}::text IS NULL OR i.inspection_reference ILIKE ${pattern} OR i.title ILIKE ${pattern})
    ORDER BY
      CASE i.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'PLANNED' THEN 1 WHEN 'COMPLETED' THEN 2 ELSE 3 END,
      COALESCE(i.scheduled_at, i.started_at, i.created_at) DESC
    LIMIT 200
  `) as InspectionListRow[];
}

export type InspectionResponseRow = {
  id: string; item_key: string; item_label: string; response_type: InspectionResponseType; response_value: unknown;
  outcome: InspectionOutcome | null; notes: string | null; responded_at: AssuranceTimestamp; responded_by_name: string | null;
};

export type InspectionDetail = {
  inspection: {
    id: string; inspection_reference: string; title: string; inspection_type: InspectionType; status: InspectionStatus;
    scheduled_at: AssuranceTimestamp | null; started_at: AssuranceTimestamp | null; completed_at: AssuranceTimestamp | null;
    summary: string | null; inspector_user_id: string | null; inspector_name: string | null;
    location_name: string | null; asset_name: string | null; external_organisation_name: string | null;
    template_id: string | null; template_name: string | null; template_version_id: string | null;
    template_version_number: number | null; template_version_title: string | null; template_instructions: string | null;
    latest_template_version_number: number | null;
    created_at: AssuranceTimestamp;
  };
  /** Items from the exact template version this inspection used (empty for ad hoc). */
  checklist: ChecklistItem[];
  invalidChecklistItems: number;
  responses: InspectionResponseRow[];
  findings: {
    id: string; finding_reference: string; title: string; finding_type: string; status: string;
    identified_at: AssuranceTimestamp; source_item_key: string | null;
  }[];
  hiddenFindingCount: number;
  evidence: EvidenceLinkRow[];
  history: AssuranceHistoryEntry[];
};

export async function getInspectionDetail(viewer: AssuranceViewer, id: string): Promise<InspectionDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT i.id, i.inspection_reference, i.title, i.inspection_type, i.status, i.scheduled_at, i.started_at, i.completed_at,
           i.summary, i.inspector_user_id, iu.name AS inspector_name, loc.name AS location_name, ast.name AS asset_name,
           xo.name AS external_organisation_name,
           t.id AS template_id, t.name AS template_name, v.id AS template_version_id, v.version_number AS template_version_number,
           v.title AS template_version_title, v.instructions AS template_instructions, v.checklist AS template_checklist,
           (SELECT max(v2.version_number) FROM assurance_inspection_template_versions v2
             WHERE v2.organisation_id = v.organisation_id AND v2.template_id = v.template_id AND v2.status <> 'DRAFT') AS latest_template_version_number,
           i.created_at
    FROM assurance_inspections i
    LEFT JOIN users iu ON iu.id = i.inspector_user_id AND iu.organisation_id = i.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = i.organisation_id AND loc.id = i.location_id
    LEFT JOIN assets ast ON ast.organisation_id = i.organisation_id AND ast.id = i.asset_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = i.organisation_id AND xo.id = i.external_organisation_id
    LEFT JOIN assurance_inspection_template_versions v ON v.organisation_id = i.organisation_id AND v.id = i.template_version_id
    LEFT JOIN assurance_inspection_templates t ON t.organisation_id = v.organisation_id AND t.id = v.template_id
    WHERE i.organisation_id = ${org} AND i.id = ${id}::uuid
  `) as (InspectionDetail['inspection'] & { template_checklist: unknown })[];
  const row = rows[0];
  if (!row) return null;
  const { template_checklist, ...inspection } = row;
  const parsed = parseChecklist(template_checklist);

  const [responses, findings, hidden, evidence, history] = await Promise.all([
    sql`
      SELECT r.id, r.item_key, r.item_label, r.response_type, r.response_value, r.outcome, r.notes, r.responded_at,
             u.name AS responded_by_name
      FROM assurance_inspection_responses r
      LEFT JOIN users u ON u.id = r.responded_by AND u.organisation_id = r.organisation_id
      WHERE r.organisation_id = ${org} AND r.inspection_id = ${id}::uuid
      ORDER BY r.item_key ASC
    `,
    // source_item_key: which checklist item a finding was raised from.
    // A0.1D-3 has no item-level link column, so the service records the
    // item key in the finding's creation audit entry; this is display
    // metadata only (the authoritative link is assurance_inspection_findings).
    sql`
      SELECT f.id, f.finding_reference, f.title, f.finding_type, f.status, f.identified_at,
             (SELECT l.after_state->>'inspection_item_key' FROM audit_logs l
               WHERE l.organisation_id = f.organisation_id AND l.resource_type = 'assurance_finding'
                 AND l.resource_id = f.id::text AND l.action = 'assurance_finding.created'
                 AND lower(l.after_state->>'inspection_id') = lower(${id})
               ORDER BY l.created_at ASC LIMIT 1) AS source_item_key
      FROM assurance_inspection_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.inspection_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)}
      ORDER BY f.identified_at DESC
    `,
    sql`
      SELECT count(*)::int AS n
      FROM assurance_inspection_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.inspection_id = ${id}::uuid
        AND NOT ${findingVisibleSql(viewer)}
    `,
    sql`
      SELECT l.id AS link_id, e.id AS evidence_id, e.evidence_reference, e.evidence_type, e.title,
             l.purpose, l.created_at AS linked_at, l.removed_at, l.removal_reason,
             cu.name AS linked_by_name, ru.name AS removed_by_name
      FROM assurance_evidence_inspections l
      JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
      LEFT JOIN users cu ON cu.id = l.created_by AND cu.organisation_id = l.organisation_id
      LEFT JOIN users ru ON ru.id = l.removed_by AND ru.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.inspection_id = ${id}::uuid
        AND ${evidenceVisibleSql(viewer)}
      ORDER BY l.removed_at NULLS FIRST, l.created_at DESC
    `,
    listAssuranceHistory(org, 'assurance_inspection', id),
  ]);

  return {
    inspection,
    checklist: parsed.items,
    invalidChecklistItems: parsed.invalidCount,
    responses: responses as InspectionResponseRow[],
    findings: findings as InspectionDetail['findings'],
    hiddenFindingCount: ((hidden as { n: number }[])[0]?.n) ?? 0,
    evidence: evidence as EvidenceLinkRow[],
    history,
  };
}

/** Ad hoc inspections define items as they go; bound the row set. */
const MAX_AD_HOC_ITEMS = 200;

async function getInspectionState(viewer: AssuranceViewer, id: string) {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Inspection');
  const rows = (await sql`
    SELECT i.id, i.status, i.template_version_id, v.checklist
    FROM assurance_inspections i
    LEFT JOIN assurance_inspection_template_versions v ON v.organisation_id = i.organisation_id AND v.id = i.template_version_id
    WHERE i.organisation_id = ${viewer.organisationId} AND i.id = ${id}::uuid
  `) as { id: string; status: InspectionStatus; template_version_id: string | null; checklist: unknown }[];
  if (!rows[0]) throw new AssuranceNotFoundError('Inspection');
  return rows[0];
}

export async function assertInspectionExists(viewer: AssuranceViewer, id: string): Promise<{ id: string; status: InspectionStatus }> {
  const s = await getInspectionState(viewer, id);
  return { id: s.id, status: s.status };
}

export async function createInspection(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; inspection_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const templateVersionId = optionalUuid(raw.templateVersionId, 'Template');
  const input = {
    title: requiredText(raw.title, 'Title', 200),
    inspectionType: optionalEnum(INSPECTION_TYPES, raw.inspectionType, 'Inspection type'),
    inspectorUserId: optionalUserId(raw.inspectorUserId, 'Inspector'),
    scheduledAt: optionalDateTime(raw.scheduledAt, 'Scheduled for'),
    locationId: optionalUuid(raw.locationId, 'Location'),
    assetId: optionalUuid(raw.assetId, 'Asset'),
    externalOrganisationId: optionalUuid(raw.externalOrganisationId, 'External organisation'),
  };

  let inspectionType = input.inspectionType;
  if (templateVersionId) {
    // Must be the PUBLISHED version of an active template in this
    // organisation (A0.1F also enforces this in the database, race-safely).
    // The inspection binds to this exact version forever.
    const v = (await sql`
      SELECT t.inspection_type
      FROM assurance_inspection_template_versions v
      JOIN assurance_inspection_templates t ON t.organisation_id = v.organisation_id AND t.id = v.template_id
      WHERE v.organisation_id = ${viewer.organisationId} AND v.id = ${templateVersionId}::uuid AND t.is_active = true AND v.status = 'PUBLISHED'
    `) as { inspection_type: InspectionType }[];
    if (!v[0]) throw new AssuranceValidationError('Template was not found in your organisation, or is not published.');
    inspectionType = inspectionType ?? v[0].inspection_type;
  }
  if (!inspectionType) throw new AssuranceValidationError('Inspection type is required for an ad hoc inspection.');

  await Promise.all([
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Inspector', userId: input.inspectorUserId }]),
    assertContextRefsInOrg(viewer.organisationId, {
      locationId: input.locationId, assetId: input.assetId, externalOrganisationId: input.externalOrganisationId,
    }),
  ]);

  const id = crypto.randomUUID();
  return withFreshReference('inspection', async reference => {
    await rejectUnpublishedTemplate(sql.transaction([
      sql`
        INSERT INTO assurance_inspections (
          id, organisation_id, inspection_reference, template_version_id, inspection_type, title, status,
          inspector_user_id, scheduled_at, location_id, asset_id, external_organisation_id, created_by
        ) VALUES (
          ${id}::uuid, ${viewer.organisationId}, ${reference}, ${templateVersionId}::uuid, ${inspectionType}, ${input.title},
          'PLANNED', ${input.inspectorUserId}, ${input.scheduledAt}::timestamptz, ${input.locationId}::uuid,
          ${input.assetId}::uuid, ${input.externalOrganisationId}::uuid, ${viewer.userId}
        )
      `,
      auditInsert({
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_inspection',
        resourceId: id, verb: 'created',
        after: { inspection_reference: reference, status: 'PLANNED', template_version_id: templateVersionId, inspection_type: inspectionType },
      }),
    ]));
    return { id, inspection_reference: reference };
  });
}

export async function startInspection(viewer: AssuranceViewer, id: string): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const state = await getInspectionState(viewer, id);
  if (state.status !== 'PLANNED') throw new AssuranceConflictError('Only a planned inspection can be started.');
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_inspections SET status = 'IN_PROGRESS', started_at = now(), updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = 'PLANNED'
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_inspection',
        verb: 'started', before: { status: 'PLANNED' }, after: { status: 'IN_PROGRESS' },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This inspection was changed by someone else. Refresh and try again.');
}

function normaliseResponseValue(type: InspectionResponseType, value: unknown, item: ChecklistItem | null): unknown {
  if (value === undefined || value === null || value === '') return null;
  switch (type) {
    case 'NUMBER': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new AssuranceValidationError('Enter a valid number.');
      return n;
    }
    case 'DATE': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AssuranceValidationError('Enter a valid date.');
      return value;
    }
    case 'BOOLEAN':
      if (value === true || value === 'true' || value === 'yes') return true;
      if (value === false || value === 'false' || value === 'no') return false;
      throw new AssuranceValidationError('Choose yes or no.');
    case 'CHOICE':
      if (typeof value !== 'string' || (item && item.options.length > 0 && !item.options.includes(value))) {
        throw new AssuranceValidationError('Choose one of the listed options.');
      }
      return value;
    case 'MULTI_CHOICE': {
      const list = Array.isArray(value) ? value : [value];
      if (!list.every(v => typeof v === 'string' && (!item || item.options.length === 0 || item.options.includes(v)))) {
        throw new AssuranceValidationError('Choose from the listed options.');
      }
      return list;
    }
    default:
      if (typeof value !== 'string') throw new AssuranceValidationError('Enter a text response.');
      return value.trim().slice(0, 2000);
  }
}

/**
 * Records (or revises, while the inspection is IN_PROGRESS) one checklist
 * response. For a template-based inspection, the item's label and
 * response type come from the bound template VERSION — never from the
 * request — so a response always describes exactly what was asked.
 * Every save writes an audit row carrying the previous outcome/value/notes
 * (inspection responses are operational observations, not personal data),
 * so a revision never loses what was recorded before. Once a finding has
 * been raised from an item, that item's response is frozen.
 */
export async function recordInspectionResponse(viewer: AssuranceViewer, inspectionId: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const state = await getInspectionState(viewer, inspectionId);
  inspectionId = state.id; // canonical (lowercase) id from the database — never the raw request form
  if (state.status !== 'IN_PROGRESS') throw new AssuranceConflictError('Responses can only be recorded while the inspection is in progress.');

  const itemKey = requiredText(raw.itemKey, 'Checklist item', 120);
  const previous = (await sql`
    SELECT item_label, response_type FROM assurance_inspection_responses
    WHERE organisation_id = ${viewer.organisationId} AND inspection_id = ${inspectionId}::uuid AND item_key = ${itemKey}
  `) as { item_label: string; response_type: InspectionResponseType }[];

  let item: ChecklistItem | null = null;
  let label: string;
  let responseType: InspectionResponseType;
  if (state.template_version_id) {
    item = parseChecklist(state.checklist).items.find(i => i.key === itemKey) ?? null;
    if (!item) throw new AssuranceValidationError('That item is not part of this inspection\'s checklist version.');
    label = item.label;
    responseType = item.responseType;
  } else if (previous[0]) {
    // An ad hoc item's label and type are fixed by its first save; a
    // revision is validated against them, never re-typed by the request.
    label = previous[0].item_label;
    responseType = previous[0].response_type;
  } else {
    if (!/^adhoc-[a-z0-9-]{1,80}$/.test(itemKey)) throw new AssuranceValidationError('Invalid ad hoc item key.');
    label = requiredText(raw.itemLabel, 'Item', 300);
    responseType = requiredEnum(INSPECTION_RESPONSE_TYPES, raw.responseType ?? 'PASS_FAIL', 'Response type');
    const count = (await sql`
      SELECT count(*)::int AS n FROM assurance_inspection_responses WHERE organisation_id = ${viewer.organisationId} AND inspection_id = ${inspectionId}::uuid
    `) as { n: number }[];
    if (count[0].n >= MAX_AD_HOC_ITEMS) throw new AssuranceValidationError(`An inspection can have at most ${MAX_AD_HOC_ITEMS} items.`);
  }
  const outcome = optionalEnum(INSPECTION_OUTCOMES, raw.outcome, 'Outcome');
  const value = normaliseResponseValue(responseType, raw.value, item);
  const notes = optionalText(raw.notes, 'Notes', 2000);
  if (!outcome && value === null) throw new AssuranceValidationError('Choose an outcome or enter a response.');
  if (outcome === 'FAIL' && !notes) throw new AssuranceValidationError('Add a note describing why this item failed.');

  // "A finding was raised from this item" — the freeze predicate. Ids are
  // compared case-insensitively as text, so no textual form dodges it.
  const raisedFromSql = sql`EXISTS (
    SELECT 1 FROM audit_logs l
    WHERE l.organisation_id = ${viewer.organisationId} AND l.resource_type = 'assurance_finding'
      AND l.action = 'assurance_finding.created'
      AND lower(l.after_state->>'inspection_id') = lower(${inspectionId})
      AND l.after_state->>'inspection_item_key' = ${itemKey}
  )`;
  if (((await sql`SELECT ${raisedFromSql} AS frozen`) as { frozen: boolean }[])[0].frozen) {
    throw new AssuranceConflictError('A finding has been raised from this item, so its response can no longer be changed.');
  }

  const responseId = crypto.randomUUID();
  // Lock the inspection FOR UPDATE (raising a finding from an item takes the
  // same lock; completion/cancellation update the row), then re-check "in
  // progress" and "not frozen" inside the write. The previous value for the
  // audit trail is read inside the same statement, so it is never stale.
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_inspections WHERE organisation_id = ${viewer.organisationId} AND id = ${inspectionId}::uuid FOR UPDATE`,
    sql`
    WITH prev AS (
      SELECT outcome, response_value, notes FROM assurance_inspection_responses
      WHERE organisation_id = ${viewer.organisationId} AND inspection_id = ${inspectionId}::uuid AND item_key = ${itemKey}
    ), ins AS (
      INSERT INTO assurance_inspection_responses (
        id, organisation_id, inspection_id, item_key, item_label, response_type, response_value, outcome, notes, responded_by, responded_at
      )
      SELECT ${responseId}::uuid, i.organisation_id, i.id, ${itemKey}, ${label}, ${responseType},
             ${value === null ? null : JSON.stringify(value)}::jsonb, ${outcome}, ${notes}, ${viewer.userId}, now()
      FROM assurance_inspections i
      WHERE i.organisation_id = ${viewer.organisationId} AND i.id = ${inspectionId}::uuid AND i.status = 'IN_PROGRESS'
        AND NOT ${raisedFromSql}
      ON CONFLICT (organisation_id, inspection_id, item_key) DO UPDATE
        SET response_value = EXCLUDED.response_value,
            outcome = EXCLUDED.outcome,
            notes = EXCLUDED.notes,
            responded_by = EXCLUDED.responded_by,
            responded_at = EXCLUDED.responded_at
      RETURNING id, inspection_id
    ), aud AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_inspection.response_recorded',
             'assurance_inspection', ins.inspection_id::text,
             (SELECT jsonb_build_object('outcome', prev.outcome, 'value', prev.response_value, 'notes', prev.notes) FROM prev),
             jsonb_build_object('item_key', ${itemKey}::text, 'outcome', ${outcome}::text, 'response_id', ins.id,
                                'value', ${value === null ? null : JSON.stringify(value)}::jsonb, 'notes', ${notes}::text)
      FROM ins
    )
    SELECT id FROM ins
  `,
  ]);
  const rows = results[1] as { id: string }[];
  if (!rows[0]) {
    throw new AssuranceConflictError('This response could not be saved: the inspection is no longer in progress, or a finding has just been raised from this item.');
  }
  return rows[0];
}

export async function completeInspection(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const state = await getInspectionState(viewer, id);
  if (state.status !== 'IN_PROGRESS') throw new AssuranceConflictError('Only an in-progress inspection can be completed.');
  const summary = optionalText(raw.summary, 'Summary', 4000);

  const answered = (await sql`
    SELECT item_key FROM assurance_inspection_responses
    WHERE organisation_id = ${viewer.organisationId} AND inspection_id = ${id}::uuid
  `) as { item_key: string }[];
  const answeredKeys = new Set(answered.map(r => r.item_key));
  if (state.template_version_id) {
    const missing = parseChecklist(state.checklist).items.filter(i => i.required && !answeredKeys.has(i.key));
    if (missing.length > 0) {
      throw new AssuranceConflictError(`${missing.length} required checklist item${missing.length === 1 ? ' has' : 's have'} no response yet.`);
    }
  } else if (answeredKeys.size === 0) {
    throw new AssuranceConflictError('Record at least one item before completing an ad hoc inspection.');
  }

  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_inspections
      SET status = 'COMPLETED', completed_at = now(), updated_at = now(), summary = COALESCE(${summary}, summary)
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = 'IN_PROGRESS'
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_inspection',
        verb: 'completed', before: { status: 'IN_PROGRESS' }, after: { status: 'COMPLETED', response_count: answeredKeys.size },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This inspection was changed by someone else. Refresh and try again.');
}

/**
 * Cancels a planned or in-progress inspection. The reason is required and
 * kept in the audit trail (the same pattern as cancelAudit / cancelAction —
 * no dedicated column); it is shown in the inspection's history.
 */
export async function cancelInspection(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'close')) throw new AssuranceForbiddenError();
  const reason = requiredText(raw.reason, 'Reason', 2000);
  const state = await getInspectionState(viewer, id);
  if (state.status !== 'PLANNED' && state.status !== 'IN_PROGRESS') {
    throw new AssuranceConflictError('Only a planned or in-progress inspection can be cancelled.');
  }
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_inspections SET status = 'CANCELLED', updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${state.status}
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_inspection',
        verb: 'cancelled', before: { status: state.status }, after: { status: 'CANCELLED', reason },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This inspection was changed by someone else. Refresh and try again.');
}
