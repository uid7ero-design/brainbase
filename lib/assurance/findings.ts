import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { incidentVisibleSql, investigationVisibleSql, findingVisibleSql, actionVisibleSql, evidenceVisibleSql } from './access';
import { listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import { auditFromCte, type AssuranceTimestamp } from './sqlHelpers';
import { assertSameOrgUsers } from './users';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import { assertIncidentVisible } from './incidents';
import { assertInvestigationVisible } from './investigations';
import { assertInspectionExists } from './inspections';
import type { EvidenceLinkRow } from './incidents';
import { FINDING_STATUSES, FINDING_TYPES, type FindingStatus, type FindingType } from './domain';
import {
  isUuid, optionalDateTime, optionalText, optionalUserId, optionalUuid, requiredEnum, requiredText, searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Findings reuse the A0.1C primitive (assurance_findings) and connect to
// their sources ONLY through the explicit link tables:
//   assurance_incident_findings / assurance_investigation_findings /
//   assurance_inspection_findings
// Never through a generic entity_type/entity_id pair.

export type FindingListFilters = {
  q?: string;
  status?: string;
  state?: 'open' | 'closed' | 'overdue' | 'all';
  findingType?: string;
  riskLevelId?: string;
  source?: 'incident' | 'investigation' | 'inspection' | 'none';
};

export type SourceRef = { kind: 'incident' | 'investigation' | 'inspection'; id: string; reference: string };

export type FindingListRow = {
  id: string; finding_reference: string; title: string; finding_type: FindingType; status: FindingStatus;
  identified_at: AssuranceTimestamp; risk_name: string | null; responsible_name: string | null;
  due_at: AssuranceTimestamp | null; sources: SourceRef[]; action_count: number; open_action_count: number;
};

export async function listFindings(viewer: AssuranceViewer, filters: FindingListFilters = {}): Promise<FindingListRow[]> {
  const pattern = searchPattern(filters.q);
  const status = FINDING_STATUSES.includes(filters.status as FindingStatus) ? filters.status! : null;
  const type = FINDING_TYPES.includes(filters.findingType as FindingType) ? filters.findingType! : null;
  const riskLevelId = isUuid(filters.riskLevelId) ? filters.riskLevelId : null;
  const state = filters.state && ['open', 'closed', 'overdue'].includes(filters.state) ? filters.state : 'all';
  const source = filters.source && ['incident', 'investigation', 'inspection', 'none'].includes(filters.source) ? filters.source : null;

  return (await sql`
    SELECT f.id, f.finding_reference, f.title, f.finding_type, f.status, f.identified_at,
           rl.name AS risk_name, ru.name AS responsible_name, tf.current_due_at AS due_at,
           ${findingSourcesSql(viewer)} AS sources,
           (SELECT count(*) FROM assurance_action_findings af
             WHERE af.organisation_id = f.organisation_id AND af.finding_id = f.id)::int AS action_count,
           (SELECT count(*) FROM assurance_action_findings af
             JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
             WHERE af.organisation_id = f.organisation_id AND af.finding_id = f.id
               AND a.status NOT IN ('CLOSED', 'CANCELLED'))::int AS open_action_count
    FROM assurance_findings f
    LEFT JOIN assurance_risk_levels rl ON rl.organisation_id = f.organisation_id AND rl.id = f.risk_level_id
    LEFT JOIN users ru ON ru.id = f.responsible_user_id AND ru.organisation_id = f.organisation_id
    LEFT JOIN LATERAL (
      SELECT t.current_due_at FROM assurance_timeframes t
      WHERE t.organisation_id = f.organisation_id AND t.finding_id = f.id AND t.status IN ('ACTIVE', 'OVERDUE')
      ORDER BY t.current_due_at ASC LIMIT 1
    ) tf ON true
    WHERE f.organisation_id = ${viewer.organisationId}
      AND ${findingVisibleSql(viewer)}
      AND (${status}::text IS NULL OR f.status = ${status})
      AND (${type}::text IS NULL OR f.finding_type = ${type})
      AND (${riskLevelId}::uuid IS NULL OR f.risk_level_id = ${riskLevelId}::uuid)
      AND (${state}::text NOT IN ('open', 'overdue') OR f.status NOT IN ('CLOSED', 'CANCELLED'))
      AND (${state}::text <> 'closed' OR f.status IN ('CLOSED', 'CANCELLED'))
      AND (${state}::text <> 'overdue' OR tf.current_due_at < now())
      AND (${source}::text IS NULL
           OR (${source}::text = 'incident' AND EXISTS (SELECT 1 FROM assurance_incident_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id))
           OR (${source}::text = 'investigation' AND EXISTS (SELECT 1 FROM assurance_investigation_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id))
           OR (${source}::text = 'inspection' AND EXISTS (SELECT 1 FROM assurance_inspection_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id))
           OR (${source}::text = 'none'
               AND NOT EXISTS (SELECT 1 FROM assurance_incident_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)
               AND NOT EXISTS (SELECT 1 FROM assurance_investigation_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)
               AND NOT EXISTS (SELECT 1 FROM assurance_inspection_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)))
      AND (${pattern}::text IS NULL OR f.finding_reference ILIKE ${pattern} OR f.title ILIKE ${pattern})
    ORDER BY CASE WHEN f.status IN ('CLOSED', 'CANCELLED') THEN 1 ELSE 0 END, tf.current_due_at ASC NULLS LAST, f.identified_at DESC
    LIMIT 200
  `) as FindingListRow[];
}

/** JSON array of the finding's (visible) sources. Expects the finding aliased `f`. */
function findingSourcesSql(viewer: AssuranceViewer) {
  return sql`(
    SELECT COALESCE(json_agg(src ORDER BY src->>'reference'), '[]'::json) FROM (
      SELECT json_build_object('kind', 'incident', 'id', inc.id, 'reference', inc.incident_reference)::jsonb AS src
      FROM assurance_incident_findings s
      JOIN assurance_incidents inc ON inc.organisation_id = s.organisation_id AND inc.id = s.incident_id
      WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id AND ${incidentVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'investigation', 'id', inv.id, 'reference', inv.investigation_reference)::jsonb
      FROM assurance_investigation_findings s
      JOIN assurance_investigations inv ON inv.organisation_id = s.organisation_id AND inv.id = s.investigation_id
      WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id AND ${investigationVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'inspection', 'id', ins.id, 'reference', ins.inspection_reference)::jsonb
      FROM assurance_inspection_findings s
      JOIN assurance_inspections ins ON ins.organisation_id = s.organisation_id AND ins.id = s.inspection_id
      WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id
    ) q
  )`;
}

export type FindingDetail = {
  finding: {
    id: string; finding_reference: string; title: string; description: string; finding_type: FindingType;
    status: FindingStatus; identified_at: AssuranceTimestamp; closed_at: AssuranceTimestamp | null;
    risk_name: string | null; responsible_name: string | null; responsible_external_organisation_name: string | null;
    closed_by_name: string | null; location_name: string | null; asset_name: string | null;
    created_by_name: string | null; created_at: AssuranceTimestamp;
  };
  sources: SourceRef[];
  actions: {
    id: string; action_reference: string; title: string; action_type: string; priority: string; status: string;
    owner_name: string | null; due_at: AssuranceTimestamp | null; verification_required: boolean;
    evidence_required: boolean; active_evidence_count: number; latest_verification_result: string | null;
  }[];
  timeframes: { id: string; timeframe_type: string; original_due_at: AssuranceTimestamp; current_due_at: AssuranceTimestamp; status: string }[];
  evidence: EvidenceLinkRow[];
  history: AssuranceHistoryEntry[];
};

export async function getFindingDetail(viewer: AssuranceViewer, id: string): Promise<FindingDetail | null> {
  if (!isUuid(id)) return null;
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT f.id, f.finding_reference, f.title, f.description, f.finding_type, f.status, f.identified_at, f.closed_at,
           rl.name AS risk_name, ru.name AS responsible_name, xo.name AS responsible_external_organisation_name,
           cu.name AS closed_by_name, loc.name AS location_name, ast.name AS asset_name,
           cr.name AS created_by_name, f.created_at,
           ${findingSourcesSql(viewer)} AS sources
    FROM assurance_findings f
    LEFT JOIN assurance_risk_levels rl ON rl.organisation_id = f.organisation_id AND rl.id = f.risk_level_id
    LEFT JOIN users ru ON ru.id = f.responsible_user_id AND ru.organisation_id = f.organisation_id
    LEFT JOIN users cu ON cu.id = f.closed_by AND cu.organisation_id = f.organisation_id
    LEFT JOIN users cr ON cr.id = f.created_by AND cr.organisation_id = f.organisation_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = f.organisation_id AND xo.id = f.responsible_external_organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = f.organisation_id AND loc.id = f.location_id
    LEFT JOIN assets ast ON ast.organisation_id = f.organisation_id AND ast.id = f.asset_id
    WHERE f.organisation_id = ${org} AND f.id = ${id}::uuid
      AND ${findingVisibleSql(viewer)}
  `) as (FindingDetail['finding'] & { sources: SourceRef[] })[];
  const row = rows[0];
  if (!row) return null;
  const { sources, ...finding } = row;

  const [actions, timeframes, evidence, history] = await Promise.all([
    sql`
      SELECT a.id, a.action_reference, a.title, a.action_type, a.priority, a.status, ou.name AS owner_name,
             a.verification_required, a.evidence_required,
             (SELECT count(*) FROM assurance_evidence_actions ea
               WHERE ea.organisation_id = a.organisation_id AND ea.action_id = a.id AND ea.removed_at IS NULL)::int AS active_evidence_count,
             (SELECT t.current_due_at FROM assurance_timeframes t
               WHERE t.organisation_id = a.organisation_id AND t.action_id = a.id AND t.status IN ('ACTIVE', 'OVERDUE')
               ORDER BY t.current_due_at ASC LIMIT 1) AS due_at,
             (SELECT v.result FROM assurance_verifications v
               WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id
               ORDER BY v.attempt_number DESC LIMIT 1) AS latest_verification_result
      FROM assurance_action_findings af
      JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE af.organisation_id = ${org} AND af.finding_id = ${id}::uuid
        AND ${actionVisibleSql(viewer)}
      ORDER BY a.created_at ASC
    `,
    sql`
      SELECT id, timeframe_type, original_due_at, current_due_at, status
      FROM assurance_timeframes
      WHERE organisation_id = ${org} AND finding_id = ${id}::uuid
      ORDER BY created_at ASC
    `,
    sql`
      SELECT l.id AS link_id, e.id AS evidence_id, e.evidence_reference, e.evidence_type, e.title,
             l.purpose, l.created_at AS linked_at, l.removed_at, l.removal_reason,
             cu.name AS linked_by_name, ru.name AS removed_by_name
      FROM assurance_evidence_findings l
      JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
      LEFT JOIN users cu ON cu.id = l.created_by AND cu.organisation_id = l.organisation_id
      LEFT JOIN users ru ON ru.id = l.removed_by AND ru.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.finding_id = ${id}::uuid
        AND ${evidenceVisibleSql(viewer)}
      ORDER BY l.removed_at NULLS FIRST, l.created_at DESC
    `,
    listAssuranceHistory(org, 'assurance_finding', id),
  ]);

  return {
    finding,
    sources,
    actions: actions as FindingDetail['actions'],
    timeframes: timeframes as FindingDetail['timeframes'],
    evidence: evidence as EvidenceLinkRow[],
    history,
  };
}

/** Visible, open findings for pickers. */
export async function listOpenFindingOptions(viewer: AssuranceViewer): Promise<{ id: string; label: string }[]> {
  const rows = (await sql`
    SELECT f.id, f.finding_reference, f.title
    FROM assurance_findings f
    WHERE f.organisation_id = ${viewer.organisationId}
      AND f.status NOT IN ('CLOSED', 'CANCELLED')
      AND ${findingVisibleSql(viewer)}
    ORDER BY f.identified_at DESC
    LIMIT 300
  `) as { id: string; finding_reference: string; title: string }[];
  return rows.map(r => ({ id: r.id, label: `${r.finding_reference} — ${r.title}` }));
}

export async function assertFindingsVisible(viewer: AssuranceViewer, ids: string[]): Promise<{ id: string; status: FindingStatus }[]> {
  if (ids.length === 0) return [];
  const rows = (await sql`
    SELECT f.id, f.status FROM assurance_findings f
    WHERE f.organisation_id = ${viewer.organisationId} AND f.id = ANY(${ids}::uuid[])
      AND ${findingVisibleSql(viewer)}
  `) as { id: string; status: FindingStatus }[];
  if (rows.length !== ids.length) throw new AssuranceNotFoundError('Finding');
  return rows;
}

/**
 * Raises a Finding, optionally linked to ONE source record (Incident,
 * Investigation or Inspection — and, for an Inspection, the checklist
 * item it came from). The source must be visible to the viewer.
 */
export async function createFinding(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; finding_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const input = {
    findingType: requiredEnum(FINDING_TYPES, raw.findingType, 'Finding type'),
    title: requiredText(raw.title, 'Title', 200),
    description: requiredText(raw.description, 'Description', 8000),
    riskLevelId: optionalUuid(raw.riskLevelId, 'Risk level'),
    responsibleUserId: optionalUserId(raw.responsibleUserId, 'Responsible person'),
    responsibleExternalOrganisationId: optionalUuid(raw.responsibleExternalOrganisationId, 'Responsible external organisation'),
    locationId: optionalUuid(raw.locationId, 'Location'),
    assetId: optionalUuid(raw.assetId, 'Asset'),
    identifiedAt: optionalDateTime(raw.identifiedAt, 'Identified') ?? new Date().toISOString(),
    dueAt: optionalDateTime(raw.dueAt, 'Due date'),
    incidentId: optionalUuid(raw.incidentId, 'Incident'),
    investigationId: optionalUuid(raw.investigationId, 'Investigation'),
    inspectionId: optionalUuid(raw.inspectionId, 'Inspection'),
    inspectionItemKey: optionalText(raw.inspectionItemKey, 'Checklist item', 120),
  };
  const sourceCount = [input.incidentId, input.investigationId, input.inspectionId].filter(Boolean).length;
  if (sourceCount > 1) throw new AssuranceValidationError('Raise a finding from one source at a time; link further sources afterwards.');
  if (input.inspectionItemKey && !input.inspectionId) throw new AssuranceValidationError('A checklist item needs its inspection.');
  if (input.dueAt && new Date(input.dueAt).getTime() < Date.now() - 24 * 3600_000) {
    throw new AssuranceValidationError('Due date cannot be in the past.');
  }

  await Promise.all([
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Responsible person', userId: input.responsibleUserId }]),
    assertContextRefsInOrg(viewer.organisationId, {
      riskLevelId: input.riskLevelId, locationId: input.locationId, assetId: input.assetId,
      externalOrganisationId: input.responsibleExternalOrganisationId,
    }),
    input.incidentId ? assertIncidentVisible(viewer, input.incidentId) : null,
    input.investigationId ? assertInvestigationVisible(viewer, input.investigationId) : null,
    input.inspectionId ? assertInspectionExists(viewer, input.inspectionId) : null,
  ]);
  if (input.inspectionId && input.inspectionItemKey) {
    const r = (await sql`
      SELECT outcome FROM assurance_inspection_responses
      WHERE organisation_id = ${viewer.organisationId} AND inspection_id = ${input.inspectionId}::uuid AND item_key = ${input.inspectionItemKey}
    `) as { outcome: string | null }[];
    if (!r[0]) throw new AssuranceValidationError('That checklist item has no recorded response on this inspection.');
  }

  const id = crypto.randomUUID();
  return withFreshReference('finding', async reference => {
    const statements = [
      sql`
        INSERT INTO assurance_findings (
          id, organisation_id, finding_reference, finding_type, title, description, status, risk_level_id,
          responsible_user_id, responsible_external_organisation_id, identified_at, location_id, asset_id, created_by
        ) VALUES (
          ${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.findingType}, ${input.title}, ${input.description},
          'OPEN', ${input.riskLevelId}::uuid, ${input.responsibleUserId}, ${input.responsibleExternalOrganisationId}::uuid,
          ${input.identifiedAt}::timestamptz, ${input.locationId}::uuid, ${input.assetId}::uuid, ${viewer.userId}
        )
      `,
    ];
    if (input.incidentId) statements.push(sql`
      INSERT INTO assurance_incident_findings (organisation_id, incident_id, finding_id, created_by)
      VALUES (${viewer.organisationId}, ${input.incidentId}::uuid, ${id}::uuid, ${viewer.userId})
    `);
    if (input.investigationId) statements.push(sql`
      INSERT INTO assurance_investigation_findings (organisation_id, investigation_id, finding_id, created_by)
      VALUES (${viewer.organisationId}, ${input.investigationId}::uuid, ${id}::uuid, ${viewer.userId})
    `);
    if (input.inspectionId) statements.push(sql`
      INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, created_by)
      VALUES (${viewer.organisationId}, ${input.inspectionId}::uuid, ${id}::uuid, ${viewer.userId})
    `);
    if (input.dueAt) statements.push(sql`
      INSERT INTO assurance_timeframes (organisation_id, finding_id, timeframe_type, original_due_at, current_due_at, created_by)
      VALUES (${viewer.organisationId}, ${id}::uuid, 'CLOSURE', ${input.dueAt}::timestamptz, ${input.dueAt}::timestamptz, ${viewer.userId})
    `);
    statements.push(sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES (gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_finding.created', 'assurance_finding', ${id},
              NULL, ${JSON.stringify({
                finding_reference: reference, finding_type: input.findingType, status: 'OPEN',
                incident_id: input.incidentId, investigation_id: input.investigationId,
                inspection_id: input.inspectionId, inspection_item_key: input.inspectionItemKey,
              })}::jsonb)
    `);
    await sql.transaction(statements);
    return { id, finding_reference: reference };
  });
}

export const FINDING_TRANSITIONS: Record<FindingStatus, readonly FindingStatus[]> = {
  OPEN: ['UNDER_REVIEW', 'ACTION_REQUIRED', 'CANCELLED'],
  UNDER_REVIEW: ['ACTION_REQUIRED', 'CLOSED', 'CANCELLED'],
  ACTION_REQUIRED: ['ACTION_IN_PROGRESS', 'UNDER_REVIEW', 'CANCELLED'],
  ACTION_IN_PROGRESS: ['AWAITING_VERIFICATION', 'ACTION_REQUIRED'],
  AWAITING_VERIFICATION: ['CLOSED', 'ACTION_IN_PROGRESS'],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * Finding lifecycle. Closure is explicit and guarded: every linked Action
 * must itself be CLOSED or CANCELLED. Closing a finding never closes its
 * source Incident/Investigation/Inspection.
 */
export async function transitionFinding(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string; status: FindingStatus }> {
  const to = requiredEnum(FINDING_STATUSES, raw.status, 'Status');
  const closing = to === 'CLOSED';
  if (!viewerCan(viewer, closing || to === 'CANCELLED' ? 'close' : 'record')) throw new AssuranceForbiddenError();
  if (!isUuid(id)) throw new AssuranceNotFoundError('Finding');
  const [current] = await assertFindingsVisible(viewer, [id]);
  if (!FINDING_TRANSITIONS[current.status].includes(to)) {
    throw new AssuranceConflictError(`A finding that is ${current.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}.`);
  }
  if (closing) {
    const open = (await sql`
      SELECT count(*)::int AS n
      FROM assurance_action_findings af
      JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
      WHERE af.organisation_id = ${viewer.organisationId} AND af.finding_id = ${id}::uuid
        AND a.status NOT IN ('CLOSED', 'CANCELLED')
    `) as { n: number }[];
    if (open[0].n > 0) {
      throw new AssuranceConflictError(`This finding cannot be closed yet: ${open[0].n} linked action${open[0].n === 1 ? ' is' : 's are'} still open.`);
    }
  }
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_findings
      SET status = ${to}, updated_at = now(),
          closed_at = CASE WHEN ${closing}::boolean THEN now() ELSE NULL END,
          closed_by = CASE WHEN ${closing}::boolean THEN ${viewer.userId} ELSE NULL END
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${current.status}
      RETURNING id, status
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_finding',
        verb: closing ? 'closed' : 'status_changed', before: { status: current.status }, after: { status: to },
      })}
    )
    SELECT id, status FROM upd
  `) as { id: string; status: FindingStatus }[];
  if (!rows[0]) throw new AssuranceConflictError('This finding was changed by someone else. Refresh and try again.');
  return rows[0];
}
