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
import { assertAuditExists } from './audits';
import type { EvidenceLinkRow } from './incidents';
import { FINDING_STATUSES, FINDING_TYPES, type FindingStatus, type FindingType } from './domain';
import {
  isUuid, optionalDateTime, optionalText, optionalUserId, optionalUuid, requiredEnum, requiredText, requiredUuid, searchPattern,
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
  source?: 'incident' | 'investigation' | 'inspection' | 'audit' | 'none';
};

export type SourceRef = { kind: 'incident' | 'investigation' | 'inspection' | 'audit'; id: string; reference: string };

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
  const source = filters.source && ['incident', 'investigation', 'inspection', 'audit', 'none'].includes(filters.source) ? filters.source : null;

  return (await sql`
    SELECT f.id, f.finding_reference, f.title, f.finding_type, f.status, f.identified_at,
           rl.name AS risk_name, ru.name AS responsible_name, tf.current_due_at AS due_at,
           ${findingSourcesSql(viewer)} AS sources,
           (SELECT count(*) FROM assurance_action_findings af
             JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
             WHERE af.organisation_id = f.organisation_id AND af.finding_id = f.id
               AND ${actionVisibleSql(viewer)})::int AS action_count,
           (SELECT count(*) FROM assurance_action_findings af
             JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
             WHERE af.organisation_id = f.organisation_id AND af.finding_id = f.id
               AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)})::int AS open_action_count
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
           OR (${source}::text = 'audit' AND EXISTS (SELECT 1 FROM assurance_audit_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id))
           OR (${source}::text = 'none'
               AND NOT EXISTS (SELECT 1 FROM assurance_incident_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)
               AND NOT EXISTS (SELECT 1 FROM assurance_investigation_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)
               AND NOT EXISTS (SELECT 1 FROM assurance_inspection_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)
               AND NOT EXISTS (SELECT 1 FROM assurance_audit_findings s WHERE s.organisation_id = f.organisation_id AND s.finding_id = f.id)))
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
      UNION ALL
      SELECT json_build_object('kind', 'audit', 'id', au.id, 'reference', au.audit_reference)::jsonb
      FROM assurance_audit_findings s
      JOIN assurance_audits au ON au.organisation_id = s.organisation_id AND au.id = s.audit_id
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
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
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
             e.verification_status,
             (SELECT s.status FROM assurance_requirement_submissions s WHERE s.organisation_id = e.organisation_id AND s.evidence_id = e.id) AS contractor_status,
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
    auditId: optionalUuid(raw.auditId, 'Audit'),
    auditCriterionKey: optionalText(raw.auditCriterionKey, 'Audit criterion', 120),
    requirementAssignmentId: optionalUuid(raw.requirementAssignmentId, 'Requirement assignment'),
  };
  const sourceCount = [input.incidentId, input.investigationId, input.inspectionId, input.auditId, input.requirementAssignmentId].filter(Boolean).length;
  if (sourceCount > 1) throw new AssuranceValidationError('Raise a finding from one source at a time; link further sources afterwards.');
  if (input.inspectionItemKey && !input.inspectionId) throw new AssuranceValidationError('A checklist item needs its inspection.');
  if (input.auditCriterionKey && !input.auditId) throw new AssuranceValidationError('An audit criterion needs its audit.');
  if (input.dueAt && new Date(input.dueAt).getTime() < Date.now() - 24 * 3600_000) {
    throw new AssuranceValidationError('Due date cannot be in the past.');
  }

  if (input.requirementAssignmentId) {
    // Contractor assurance (A0.1G): an explicit Finding about a requirement
    // gap. The Finding names the assignment's external organisation as the
    // responsible party; nothing here is automatic.
    const a = (await sql`
      SELECT external_organisation_id FROM assurance_requirement_assignments
      WHERE organisation_id = ${viewer.organisationId} AND id = ${input.requirementAssignmentId}::uuid
    `) as { external_organisation_id: string }[];
    if (!a[0]) throw new AssuranceNotFoundError('Requirement assignment');
    if (input.responsibleExternalOrganisationId && input.responsibleExternalOrganisationId !== a[0].external_organisation_id) {
      throw new AssuranceValidationError('A finding raised from a requirement must name the external organisation that requirement is assigned to.');
    }
    input.responsibleExternalOrganisationId = a[0].external_organisation_id;
  }

  const [, , incident, investigation, inspection, auditRec] = await Promise.all([
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Responsible person', userId: input.responsibleUserId }]),
    assertContextRefsInOrg(viewer.organisationId, {
      riskLevelId: input.riskLevelId, locationId: input.locationId, assetId: input.assetId,
      externalOrganisationId: input.responsibleExternalOrganisationId,
    }),
    input.incidentId ? assertIncidentVisible(viewer, input.incidentId) : null,
    input.investigationId ? assertInvestigationVisible(viewer, input.investigationId) : null,
    input.inspectionId ? assertInspectionExists(viewer, input.inspectionId) : null,
    input.auditId ? assertAuditExists(viewer, input.auditId) : null,
  ]);
  // A finished source cannot gain new findings (that would silently reopen
  // work behind a closed record). Enforced here, not only in the UI.
  if ((incident && (incident.status === 'CLOSED' || incident.status === 'CANCELLED'))
    || (investigation && (investigation.status === 'COMPLETED' || investigation.status === 'CANCELLED'))
    || (inspection && inspection.status === 'CANCELLED')
    || (auditRec && auditRec.status === 'CANCELLED')) {
    throw new AssuranceConflictError('Findings cannot be raised from a closed, completed or cancelled record.');
  }
  if (input.inspectionId && input.inspectionItemKey) {
    const r = (await sql`
      SELECT outcome FROM assurance_inspection_responses
      WHERE organisation_id = ${viewer.organisationId} AND inspection_id = ${input.inspectionId}::uuid AND item_key = ${input.inspectionItemKey}
    `) as { outcome: string | null }[];
    if (!r[0]) throw new AssuranceValidationError('That checklist item has no recorded response on this inspection.');
  }
  if (input.auditId && input.auditCriterionKey) {
    const r = (await sql`
      SELECT outcome FROM assurance_audit_responses
      WHERE organisation_id = ${viewer.organisationId} AND audit_id = ${input.auditId}::uuid AND criterion_key = ${input.auditCriterionKey}
    `) as { outcome: string | null }[];
    if (!r[0]) throw new AssuranceValidationError('That criterion has no recorded response on this audit.');
  }

  const id = crypto.randomUUID();
  const org = viewer.organisationId;
  // Lock the source first — FOR SHARE for incidents/investigations (their
  // closure takes FOR UPDATE), FOR UPDATE for inspections/audits (serialises
  // with checklist/criterion response saves, which freeze once a finding is
  // raised from them); each insert then re-checks the source is still open with a
  // fresh snapshot, so everything is written together or not at all.
  const lock = input.incidentId
    ? sql`SELECT id FROM assurance_incidents WHERE organisation_id = ${org} AND id = ${input.incidentId}::uuid FOR SHARE`
    : input.investigationId
      ? sql`SELECT id FROM assurance_investigations WHERE organisation_id = ${org} AND id = ${input.investigationId}::uuid FOR SHARE`
      : input.inspectionId
        ? sql`SELECT id FROM assurance_inspections WHERE organisation_id = ${org} AND id = ${input.inspectionId}::uuid FOR UPDATE`
        : input.auditId
          ? sql`SELECT id FROM assurance_audits WHERE organisation_id = ${org} AND id = ${input.auditId}::uuid FOR UPDATE`
          : input.requirementAssignmentId
            ? sql`SELECT id FROM assurance_requirement_assignments WHERE organisation_id = ${org} AND id = ${input.requirementAssignmentId}::uuid FOR SHARE`
            : sql`SELECT 1`;
  const sourceOpen = input.incidentId
    ? sql`EXISTS (SELECT 1 FROM assurance_incidents s WHERE s.organisation_id = ${org} AND s.id = ${input.incidentId}::uuid AND s.status NOT IN ('CLOSED', 'CANCELLED'))`
    : input.investigationId
      ? sql`EXISTS (SELECT 1 FROM assurance_investigations s WHERE s.organisation_id = ${org} AND s.id = ${input.investigationId}::uuid AND s.status NOT IN ('COMPLETED', 'CANCELLED'))`
      : input.inspectionId
        ? sql`EXISTS (SELECT 1 FROM assurance_inspections s WHERE s.organisation_id = ${org} AND s.id = ${input.inspectionId}::uuid AND s.status <> 'CANCELLED')`
        : input.auditId
          ? sql`EXISTS (SELECT 1 FROM assurance_audits s WHERE s.organisation_id = ${org} AND s.id = ${input.auditId}::uuid AND s.status <> 'CANCELLED')`
          : input.requirementAssignmentId
            ? sql`EXISTS (SELECT 1 FROM assurance_requirement_assignments s WHERE s.organisation_id = ${org} AND s.id = ${input.requirementAssignmentId}::uuid)`
            : sql`true`;
  return withFreshReference('finding', async reference => {
    const statements = [
      lock,
      sql`
        INSERT INTO assurance_findings (
          id, organisation_id, finding_reference, finding_type, title, description, status, risk_level_id,
          responsible_user_id, responsible_external_organisation_id, identified_at, location_id, asset_id, created_by
        )
        SELECT ${id}::uuid, ${org}, ${reference}, ${input.findingType}, ${input.title}, ${input.description},
               'OPEN', ${input.riskLevelId}::uuid, ${input.responsibleUserId}, ${input.responsibleExternalOrganisationId}::uuid,
               ${input.identifiedAt}::timestamptz, ${input.locationId}::uuid, ${input.assetId}::uuid, ${viewer.userId}
        WHERE ${sourceOpen}
        RETURNING id
      `,
    ];
    if (input.incidentId) statements.push(sql`
      INSERT INTO assurance_incident_findings (organisation_id, incident_id, finding_id, created_by)
      SELECT ${org}, ${input.incidentId}::uuid, ${id}::uuid, ${viewer.userId} WHERE ${sourceOpen}
    `);
    if (input.investigationId) statements.push(sql`
      INSERT INTO assurance_investigation_findings (organisation_id, investigation_id, finding_id, created_by)
      SELECT ${org}, ${input.investigationId}::uuid, ${id}::uuid, ${viewer.userId} WHERE ${sourceOpen}
    `);
    if (input.auditId) statements.push(sql`
      INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, created_by)
      SELECT ${org}, ${input.auditId}::uuid, ${id}::uuid, ${viewer.userId} WHERE ${sourceOpen}
    `);
    if (input.inspectionId) statements.push(sql`
      INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, created_by)
      SELECT ${org}, ${input.inspectionId}::uuid, ${id}::uuid, ${viewer.userId} WHERE ${sourceOpen}
    `);
    if (input.requirementAssignmentId) statements.push(sql`
      INSERT INTO assurance_requirement_assignment_findings (organisation_id, assignment_id, finding_id, created_by)
      SELECT ${org}, ${input.requirementAssignmentId}::uuid, ${id}::uuid, ${viewer.userId} WHERE ${sourceOpen}
    `);
    if (input.dueAt) statements.push(sql`
      INSERT INTO assurance_timeframes (organisation_id, finding_id, timeframe_type, original_due_at, current_due_at, created_by)
      SELECT ${org}, ${id}::uuid, 'CLOSURE', ${input.dueAt}::timestamptz, ${input.dueAt}::timestamptz, ${viewer.userId} WHERE ${sourceOpen}
    `);
    statements.push(sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_finding.created', 'assurance_finding', ${id},
             NULL, ${JSON.stringify({
               finding_reference: reference, finding_type: input.findingType, status: 'OPEN',
               incident_id: input.incidentId, investigation_id: input.investigationId,
               inspection_id: input.inspectionId, inspection_item_key: input.inspectionItemKey,
               audit_id: input.auditId, audit_criterion_key: input.auditCriterionKey,
               requirement_assignment_id: input.requirementAssignmentId,
             })}::jsonb
      WHERE ${sourceOpen}
    `);
    const results = await sql.transaction(statements);
    if ((results[1] as unknown[]).length === 0) {
      throw new AssuranceConflictError('The source record was closed while you were raising this finding. Nothing was saved.');
    }
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
      // Count deliberately not shown: it may include actions hidden from this viewer.
      throw new AssuranceConflictError('This finding cannot be closed yet: one or more linked actions are still open.');
    }
  }
  // Lock the finding FIRST (action creation share-locks it), then re-check
  // "no open actions" inside the UPDATE with a fresh snapshot.
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_findings WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid FOR UPDATE`,
    sql`
    WITH upd AS (
      UPDATE assurance_findings f
      SET status = ${to}, updated_at = now(),
          closed_at = CASE WHEN ${closing}::boolean THEN now() ELSE NULL END,
          closed_by = CASE WHEN ${closing}::boolean THEN ${viewer.userId} ELSE NULL END
      WHERE f.organisation_id = ${viewer.organisationId} AND f.id = ${id}::uuid AND f.status = ${current.status}
        AND (NOT ${closing}::boolean OR NOT EXISTS (
          SELECT 1 FROM assurance_action_findings af
          JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
          WHERE af.organisation_id = f.organisation_id AND af.finding_id = f.id AND a.status NOT IN ('CLOSED', 'CANCELLED')))
      RETURNING f.id, f.status
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_finding',
        verb: closing ? 'closed' : 'status_changed', before: { status: current.status }, after: { status: to },
      })}
    )
    SELECT id, status FROM upd
  `,
  ]);
  const rows = results[1] as { id: string; status: FindingStatus }[];
  if (!rows[0]) throw new AssuranceConflictError('This finding changed while you were updating it (for example, an action was added). Refresh and try again.');
  return rows[0];
}

// ── Linking an EXISTING finding to a further source ──────────────────────
//
// New findings are raised from a source with createFinding(); an existing
// finding (e.g. a repeat issue) can additionally be linked to another
// incident, investigation or inspection through the SAME explicit link
// tables. (Audits have the equivalent linkFindingToAudit() in audits.ts.)
// Only the link row and an audit row are written; no status changes.

export type FindingLinkSource = 'incident' | 'investigation' | 'inspection';

const SOURCE_NOUN: Record<FindingLinkSource, string> = { incident: 'incident', investigation: 'investigation', inspection: 'inspection' };

/** "Who could see this if they weren't personally involved?" (see evidence.ts). */
function publicViewerOf(viewer: AssuranceViewer): AssuranceViewer {
  return { organisationId: viewer.organisationId, userId: '', role: 'viewer', canViewAllRestricted: false };
}

export async function linkFindingToSource(
  viewer: AssuranceViewer,
  source: FindingLinkSource,
  sourceId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  // Only sources with an explicit finding link table (audits: linkFindingToAudit).
  if (!Object.prototype.hasOwnProperty.call(SOURCE_NOUN, source)) throw new AssuranceValidationError('Findings can only be linked to an incident, investigation, inspection or audit.');
  const findingId = requiredUuid(raw.findingId, 'Finding').toLowerCase();
  const org = viewer.organisationId;
  const pub = publicViewerOf(viewer);
  const noun = SOURCE_NOUN[source];

  // 1. The source: visible to the viewer (404 otherwise), still open, and
  //    whether it is restricted-scoped (hidden from uninvolved members).
  let sourceState: { id: string; finished: boolean; publicVisible: boolean };
  if (source === 'incident') {
    const s = await assertIncidentVisible(viewer, sourceId);
    const p = (await sql`SELECT ${incidentVisibleSql(pub)} AS v FROM assurance_incidents inc WHERE inc.organisation_id = ${org} AND inc.id = ${s.id}::uuid`) as { v: boolean }[];
    sourceState = { id: s.id, finished: s.status === 'CLOSED' || s.status === 'CANCELLED', publicVisible: p[0]?.v === true };
  } else if (source === 'investigation') {
    const s = await assertInvestigationVisible(viewer, sourceId);
    const p = (await sql`SELECT ${investigationVisibleSql(pub)} AS v FROM assurance_investigations inv WHERE inv.organisation_id = ${org} AND inv.id = ${s.id}::uuid`) as { v: boolean }[];
    sourceState = { id: s.id, finished: s.status === 'COMPLETED' || s.status === 'CANCELLED', publicVisible: p[0]?.v === true };
  } else {
    const s = await assertInspectionExists(viewer, sourceId);
    sourceState = { id: s.id, finished: s.status === 'CANCELLED', publicVisible: true };
  }
  if (sourceState.finished) {
    throw new AssuranceConflictError(source === 'inspection'
      ? 'Findings cannot be linked to a cancelled inspection.'
      : `Findings cannot be linked to a ${source === 'incident' ? 'closed or cancelled incident' : 'completed or cancelled investigation'}.`);
  }

  // 2. The finding: visible to the viewer and still open.
  const f = (await sql`
    SELECT f.id, f.status, ${findingVisibleSql(pub)} AS public_visible FROM assurance_findings f
    WHERE f.organisation_id = ${org} AND f.id = ${findingId}::uuid AND ${findingVisibleSql(viewer)}
  `) as { id: string; status: string; public_visible: boolean }[];
  if (!f[0]) throw new AssuranceNotFoundError('Finding');
  if (f[0].status === 'CLOSED' || f[0].status === 'CANCELLED') {
    throw new AssuranceConflictError('A closed or cancelled finding cannot be linked.');
  }
  // Restriction is inherited downward: linking a finding everyone can see to
  // a restricted incident/investigation would silently hide it — and its
  // actions and evidence — from everyone else. Refuse, as evidence does.
  if (!sourceState.publicVisible && f[0].public_visible === true) {
    throw new AssuranceConflictError(`This finding is visible to your whole organisation. Linking it to a restricted ${noun} would hide it, its actions and its evidence from everyone else — raise a new finding from the restricted ${noun} instead.`);
  }

  // 3. Write. Share-lock the source and the finding first (closing either
  //    takes FOR UPDATE), then re-check both are still open inside the insert.
  const id = sourceState.id;
  let lockSource;
  let insert;
  if (source === 'incident') {
    lockSource = sql`SELECT id FROM assurance_incidents WHERE organisation_id = ${org} AND id = ${id}::uuid FOR SHARE`;
    insert = sql`
      INSERT INTO assurance_incident_findings (organisation_id, incident_id, finding_id, created_by)
      SELECT ${org}, ${id}::uuid, ${findingId}::uuid, ${viewer.userId}
      WHERE EXISTS (SELECT 1 FROM assurance_incidents x WHERE x.organisation_id = ${org} AND x.id = ${id}::uuid AND x.status NOT IN ('CLOSED', 'CANCELLED'))
        AND EXISTS (SELECT 1 FROM assurance_findings g WHERE g.organisation_id = ${org} AND g.id = ${findingId}::uuid AND g.status NOT IN ('CLOSED', 'CANCELLED'))
      RETURNING incident_id AS id`;
  } else if (source === 'investigation') {
    lockSource = sql`SELECT id FROM assurance_investigations WHERE organisation_id = ${org} AND id = ${id}::uuid FOR SHARE`;
    insert = sql`
      INSERT INTO assurance_investigation_findings (organisation_id, investigation_id, finding_id, created_by)
      SELECT ${org}, ${id}::uuid, ${findingId}::uuid, ${viewer.userId}
      WHERE EXISTS (SELECT 1 FROM assurance_investigations x WHERE x.organisation_id = ${org} AND x.id = ${id}::uuid AND x.status NOT IN ('COMPLETED', 'CANCELLED'))
        AND EXISTS (SELECT 1 FROM assurance_findings g WHERE g.organisation_id = ${org} AND g.id = ${findingId}::uuid AND g.status NOT IN ('CLOSED', 'CANCELLED'))
      RETURNING investigation_id AS id`;
  } else {
    lockSource = sql`SELECT id FROM assurance_inspections WHERE organisation_id = ${org} AND id = ${id}::uuid FOR SHARE`;
    insert = sql`
      INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, created_by)
      SELECT ${org}, ${id}::uuid, ${findingId}::uuid, ${viewer.userId}
      WHERE EXISTS (SELECT 1 FROM assurance_inspections x WHERE x.organisation_id = ${org} AND x.id = ${id}::uuid AND x.status <> 'CANCELLED')
        AND EXISTS (SELECT 1 FROM assurance_findings g WHERE g.organisation_id = ${org} AND g.id = ${findingId}::uuid AND g.status NOT IN ('CLOSED', 'CANCELLED'))
      RETURNING inspection_id AS id`;
  }
  const resourceType = `assurance_${source}`;
  try {
    const results = await sql.transaction([
      lockSource,
      sql`SELECT id FROM assurance_findings WHERE organisation_id = ${org} AND id = ${findingId}::uuid FOR SHARE`,
      sql`
        WITH ins AS (${insert}), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, ${`${resourceType}.finding_linked`},
                 ${resourceType}, ins.id::text, NULL, jsonb_build_object('finding_id', ${findingId}::text)
          FROM ins
        )
        SELECT id FROM ins
      `,
    ]);
    if ((results[2] as unknown[]).length === 0) {
      throw new AssuranceConflictError(`This ${noun} has just been finished, or the finding has just been closed. Nothing was saved.`);
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new AssuranceConflictError(`That finding is already linked to this ${noun}.`);
    throw err;
  }
}
