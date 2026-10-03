import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import {
  incidentVisibleSql, investigationVisibleSql, findingVisibleSql, actionVisibleSql, evidenceVisibleSql,
} from './access';
import type { AssuranceTimestamp } from './sqlHelpers';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import { EVIDENCE_LINK_TARGETS, EVIDENCE_TYPES, type EvidenceLinkTarget, type EvidenceType } from './domain';
import {
  EVIDENCE_DECISIONS, EVIDENCE_STATES, canCorrect, decisionConflicts, evidenceState, isReplaceableStatus,
  type ContractorSubmissionStatus, type EvidenceAuthority, type EvidenceState, type EvidenceVerificationStatus,
} from './evidenceRules';
import {
  isUuid, optionalBoolean, optionalDateTime, optionalText, optionalUuid, requiredEnum, requiredText, requiredUuid, searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Evidence is a first-class, reusable record (assurance_evidence) linked
// to its subjects ONLY through the explicit link tables. Links are never
// deleted: "unlinking" sets removed_at / removed_by / removal_reason (soft
// unlink), so evidence history is preserved. A removed link can be
// re-established as a NEW link row.
//
// A0.1H adds an evidence verification lifecycle, enforced in the database:
//   UNVERIFIED <-> AWAITING_VERIFICATION -> ACCEPTED | REJECTED, and
//   ACCEPTED -> SUPERSEDED only when an accepted replacement takes over.
//   * The decider is never the recorder or capturer (DB), nor the owner or
//     anyone who completed the work of an Action the evidence supports
//     (service). Nothing is claimed about an external supplier.
//   * Content can be corrected only before a decision; afterwards a
//     replacement is recorded and the original stays readable.
//   * Contractor Assurance submission evidence is decided ONLY there; this
//     module shows the submission's state and never changes that evidence.
//   * An evidence decision never changes an Action, Finding, Inspection,
//     Audit, Incident, Investigation, deadline or contractor requirement.
//     Action verification (lib/assurance/verifications.ts) still judges the
//     corrective work and is independent of evidence decisions.
//
// Evidence records METADATA (what the proof is, where the original is held,
// who captured it). Binary file storage is not implemented yet.

// Allow-listed link-table metadata. Table/column names are never taken
// from request data; `target` is validated against EVIDENCE_LINK_TARGETS
// before lookup, and the names below are constants.
const LINK_TABLES: Record<EvidenceLinkTarget, { table: string; column: string }> = {
  incident: { table: 'assurance_evidence_incidents', column: 'incident_id' },
  investigation: { table: 'assurance_evidence_investigations', column: 'investigation_id' },
  inspection: { table: 'assurance_evidence_inspections', column: 'inspection_id' },
  audit: { table: 'assurance_evidence_audits', column: 'audit_id' },
  finding: { table: 'assurance_evidence_findings', column: 'finding_id' },
  action: { table: 'assurance_evidence_actions', column: 'action_id' },
  verification: { table: 'assurance_evidence_verifications', column: 'verification_id' },
};

export const EVIDENCE_RELATED_FILTERS = ['action', 'finding', 'inspection', 'audit', 'incident', 'investigation', 'contractor', 'none'] as const;
export type EvidenceRelatedFilter = (typeof EVIDENCE_RELATED_FILTERS)[number];

export type EvidenceListFilters = { q?: string; evidenceType?: string; state?: string; related?: string };

export type EvidenceListRow = {
  id: string; evidence_reference: string; evidence_type: EvidenceType; title: string | null; captured_at: AssuranceTimestamp | null;
  captured_by_name: string | null; created_by_name: string | null; supplier_name: string | null; created_at: AssuranceTimestamp;
  verification_status: EvidenceVerificationStatus; state: EvidenceState; authority: EvidenceAuthority;
  replaces_evidence_id: string | null; superseded_by_evidence_id: string | null;
  contractor: { external_organisation_id: string; external_organisation_name: string; requirement_name: string; effective_from: string | null; expires_on: string | null } | null;
  active_link_count: number; removed_link_count: number;
  links: { kind: EvidenceLinkTarget; id: string; reference: string; item: string | null }[];
};

function relatedFilterSql(related: EvidenceRelatedFilter | null) {
  if (!related) return sql`true`;
  if (related === 'contractor') return sql`s.id IS NOT NULL`;
  if (related === 'none') return sql`(s.id IS NULL AND (b.counts->>'active')::int = 0)`;
  const t = LINK_TABLES[related];
  return sql`EXISTS (SELECT 1 FROM ${sql.unsafe(t.table)} x WHERE x.organisation_id = b.organisation_id AND x.evidence_id = b.id AND x.removed_at IS NULL)`;
}

export async function listEvidence(viewer: AssuranceViewer, filters: EvidenceListFilters = {}): Promise<EvidenceListRow[]> {
  const pattern = searchPattern(filters.q);
  const type = EVIDENCE_TYPES.includes(filters.evidenceType as EvidenceType) ? filters.evidenceType! : null;
  const state = EVIDENCE_STATES.includes(filters.state as EvidenceState) ? filters.state! : null;
  const related = EVIDENCE_RELATED_FILTERS.includes(filters.related as EvidenceRelatedFilter) ? filters.related as EvidenceRelatedFilter : null;

  const rows = (await sql`
    WITH base AS (
      SELECT e.*, ${activeLinksSql(viewer)} AS links, ${linkCountsSql()} AS counts
      FROM assurance_evidence e
      WHERE e.organisation_id = ${viewer.organisationId}
        AND ${evidenceVisibleSql(viewer)}
        AND (${type}::text IS NULL OR e.evidence_type = ${type})
        AND (${pattern}::text IS NULL OR e.evidence_reference ILIKE ${pattern} OR e.title ILIKE ${pattern})
    )
    SELECT b.id, b.evidence_reference, b.evidence_type, b.title, b.captured_at, b.created_at, b.verification_status,
           b.replaces_evidence_id, b.superseded_by_evidence_id,
           cu.name AS captured_by_name, cr.name AS created_by_name, sup.name AS supplier_name,
           (b.counts->>'active')::int AS active_link_count, (b.counts->>'removed')::int AS removed_link_count,
           b.links, s.status AS contractor_status,
           CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
             'external_organisation_id', eo.id, 'external_organisation_name', eo.name,
             'requirement_name', s.requirement_name_snapshot,
             'effective_from', s.effective_from::text, 'expires_on', s.expires_on::text) END AS contractor
    FROM base b
    LEFT JOIN assurance_requirement_submissions s ON s.organisation_id = b.organisation_id AND s.evidence_id = b.id
    LEFT JOIN assurance_requirement_assignments ra ON ra.organisation_id = s.organisation_id AND ra.id = s.assignment_id
    LEFT JOIN external_organisations eo ON eo.organisation_id = ra.organisation_id AND eo.id = ra.external_organisation_id
    LEFT JOIN users cu ON cu.id = b.captured_by AND cu.organisation_id = b.organisation_id
    LEFT JOIN users cr ON cr.id = b.created_by AND cr.organisation_id = b.organisation_id
    LEFT JOIN external_organisations sup ON sup.organisation_id = b.organisation_id AND sup.id = b.supplied_by_external_organisation_id
    WHERE (${state}::text IS NULL OR (CASE WHEN s.id IS NOT NULL THEN (CASE s.status WHEN 'SUBMITTED' THEN 'AWAITING_VERIFICATION' ELSE s.status END) ELSE b.verification_status END) = ${state})
      AND ${relatedFilterSql(related)}
    ORDER BY COALESCE(b.captured_at, b.created_at) DESC
    LIMIT 200
  `) as (Omit<EvidenceListRow, 'state' | 'authority'> & { contractor_status: ContractorSubmissionStatus | null })[];
  return rows.map(({ contractor_status, ...r }) => ({
    ...r,
    ...evidenceState({ verificationStatus: r.verification_status, contractorStatus: contractor_status }),
  }));
}

// ── Verification queue projections ─────────────────────────────────────────

export type EvidenceQueueRow = {
  id: string; evidence_reference: string; title: string | null; evidence_type: EvidenceType;
  recorded_by_name: string | null; requested_by_name: string | null; verification_requested_at: AssuranceTimestamp;
  lock_version: number; replaces_reference: string | null;
  links: EvidenceListRow['links'];
  can_decide: boolean;
};

/** Generic evidence awaiting an independent decision (eligibility is advisory; decideEvidence re-checks). */
export async function listEvidenceVerificationQueue(viewer: AssuranceViewer): Promise<EvidenceQueueRow[]> {
  return (await sql`
    SELECT e.id, e.evidence_reference, e.title, e.evidence_type, e.verification_requested_at, e.lock_version,
           cr.name AS recorded_by_name, rq.name AS requested_by_name, pr.evidence_reference AS replaces_reference,
           ${activeLinksSql(viewer)} AS links,
           (e.created_by IS DISTINCT FROM ${viewer.userId} AND e.captured_by IS DISTINCT FROM ${viewer.userId}
             AND NOT EXISTS (
               SELECT 1 FROM assurance_evidence_actions x
               JOIN assurance_actions ac ON ac.organisation_id = x.organisation_id AND ac.id = x.action_id
               WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL
                 AND (ac.owner_user_id = ${viewer.userId} OR ac.work_completed_by = ${viewer.userId}
                      OR EXISTS (SELECT 1 FROM audit_logs l
                                 WHERE l.organisation_id = ac.organisation_id AND l.resource_type = 'assurance_action'
                                   AND l.resource_id = ac.id::text AND l.action = 'assurance_action.work_completed'
                                   AND l.user_id = ${viewer.userId})))) AS can_decide
    FROM assurance_evidence e
    LEFT JOIN users cr ON cr.id = e.created_by AND cr.organisation_id = e.organisation_id
    LEFT JOIN users rq ON rq.id = e.verification_requested_by AND rq.organisation_id = e.organisation_id
    LEFT JOIN assurance_evidence pr ON pr.organisation_id = e.organisation_id AND pr.id = e.replaces_evidence_id
    WHERE e.organisation_id = ${viewer.organisationId} AND e.verification_status = 'AWAITING_VERIFICATION'
      AND ${evidenceVisibleSql(viewer)}
    ORDER BY e.verification_requested_at ASC
    LIMIT 200
  `) as EvidenceQueueRow[];
}

export type ContractorQueueRow = {
  submission_id: string; evidence_id: string; evidence_reference: string; title: string | null;
  external_organisation_id: string; external_organisation_name: string; requirement_name: string;
  recorded_by_name: string | null; recorded_at: AssuranceTimestamp; can_decide: boolean;
};

/** Contractor submission evidence awaiting review — decided in Contractor assurance, projected here. */
export async function listContractorEvidenceQueue(viewer: AssuranceViewer): Promise<ContractorQueueRow[]> {
  return (await sql`
    SELECT s.id AS submission_id, e.id AS evidence_id, e.evidence_reference, e.title,
           eo.id AS external_organisation_id, eo.name AS external_organisation_name, s.requirement_name_snapshot AS requirement_name,
           ru.name AS recorded_by_name, s.recorded_at, (s.recorded_by <> ${viewer.userId}) AS can_decide
    FROM assurance_requirement_submissions s
    JOIN assurance_evidence e ON e.organisation_id = s.organisation_id AND e.id = s.evidence_id
    JOIN assurance_requirement_assignments ra ON ra.organisation_id = s.organisation_id AND ra.id = s.assignment_id
    JOIN external_organisations eo ON eo.organisation_id = ra.organisation_id AND eo.id = ra.external_organisation_id
    LEFT JOIN users ru ON ru.id = s.recorded_by AND ru.organisation_id = s.organisation_id
    WHERE s.organisation_id = ${viewer.organisationId} AND s.status = 'SUBMITTED'
    ORDER BY s.recorded_at ASC
    LIMIT 200
  `) as ContractorQueueRow[];
}

export type EvidenceDecisionRow = {
  evidence_id: string; evidence_reference: string; title: string | null; authority: EvidenceAuthority;
  decision: 'ACCEPTED' | 'REJECTED'; decided_at: AssuranceTimestamp; decided_by_name: string | null; reason: string | null;
  external_organisation_id: string | null;
};

/** Recent evidence decisions from both workflows, newest first. */
export async function listRecentEvidenceDecisions(viewer: AssuranceViewer, limit = 50): Promise<EvidenceDecisionRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  return (await sql`
    SELECT * FROM (
      SELECT e.id AS evidence_id, e.evidence_reference, e.title, 'evidence' AS authority,
             CASE WHEN e.verification_status = 'REJECTED' THEN 'REJECTED' ELSE 'ACCEPTED' END AS decision,
             e.decided_at, du.name AS decided_by_name, e.decision_reason AS reason, NULL::uuid AS external_organisation_id
      FROM assurance_evidence e
      LEFT JOIN users du ON du.id = e.decided_by AND du.organisation_id = e.organisation_id
      WHERE e.organisation_id = ${viewer.organisationId} AND e.decided_at IS NOT NULL AND ${evidenceVisibleSql(viewer)}
      UNION ALL
      SELECT e.id, e.evidence_reference, e.title, 'contractor',
             CASE WHEN s.status = 'REJECTED' THEN 'REJECTED' ELSE 'ACCEPTED' END,
             s.decided_at, du.name, s.decision_reason, ra.external_organisation_id
      FROM assurance_requirement_submissions s
      JOIN assurance_evidence e ON e.organisation_id = s.organisation_id AND e.id = s.evidence_id
      JOIN assurance_requirement_assignments ra ON ra.organisation_id = s.organisation_id AND ra.id = s.assignment_id
      LEFT JOIN users du ON du.id = s.decided_by AND du.organisation_id = s.organisation_id
      WHERE s.organisation_id = ${viewer.organisationId} AND s.status IN ('ACCEPTED', 'REJECTED', 'SUPERSEDED') AND s.decided_at IS NOT NULL
    ) d
    ORDER BY d.decided_at DESC
    LIMIT ${capped}
  `) as EvidenceDecisionRow[];
}

/** Active links with references (evidence aliased `e`). Links to records hidden from the viewer are excluded. */
function activeLinksSql(viewer: AssuranceViewer) {
  return sql`(
    SELECT COALESCE(json_agg(l ORDER BY l->>'kind', l->>'reference'), '[]'::json) FROM (
      SELECT json_build_object('kind', 'incident', 'id', inc.id, 'reference', inc.incident_reference, 'item', NULL)::jsonb AS l
      FROM assurance_evidence_incidents x JOIN assurance_incidents inc ON inc.organisation_id = x.organisation_id AND inc.id = x.incident_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${incidentVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'investigation', 'id', inv.id, 'reference', inv.investigation_reference, 'item', NULL)::jsonb
      FROM assurance_evidence_investigations x JOIN assurance_investigations inv ON inv.organisation_id = x.organisation_id AND inv.id = x.investigation_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${investigationVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'inspection', 'id', i.id, 'reference', i.inspection_reference, 'item', r.item_label)::jsonb
      FROM assurance_evidence_inspections x JOIN assurance_inspections i ON i.organisation_id = x.organisation_id AND i.id = x.inspection_id
      LEFT JOIN assurance_inspection_responses r ON r.organisation_id = x.organisation_id AND r.inspection_id = x.inspection_id AND r.item_key = x.item_key
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL
      UNION ALL
      SELECT json_build_object('kind', 'audit', 'id', au.id, 'reference', au.audit_reference, 'item', r.criterion_label)::jsonb
      FROM assurance_evidence_audits x JOIN assurance_audits au ON au.organisation_id = x.organisation_id AND au.id = x.audit_id
      LEFT JOIN assurance_audit_responses r ON r.organisation_id = x.organisation_id AND r.audit_id = x.audit_id AND r.criterion_key = x.criterion_key
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL
      UNION ALL
      SELECT json_build_object('kind', 'finding', 'id', f.id, 'reference', f.finding_reference, 'item', NULL)::jsonb
      FROM assurance_evidence_findings x JOIN assurance_findings f ON f.organisation_id = x.organisation_id AND f.id = x.finding_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${findingVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'action', 'id', a.id, 'reference', a.action_reference, 'item', NULL)::jsonb
      FROM assurance_evidence_actions x JOIN assurance_actions a ON a.organisation_id = x.organisation_id AND a.id = x.action_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${actionVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'verification', 'id', a.id, 'reference', a.action_reference || ' #' || v.attempt_number, 'item', NULL)::jsonb
      FROM assurance_evidence_verifications x
      JOIN assurance_verifications v ON v.organisation_id = x.organisation_id AND v.id = x.verification_id
      JOIN assurance_actions a ON a.organisation_id = v.organisation_id AND a.id = v.action_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${actionVisibleSql(viewer)}
    ) q
  )`;
}

function linkCountsSql() {
  return sql`(
    SELECT jsonb_build_object('active', count(*) FILTER (WHERE removed_at IS NULL), 'removed', count(*) FILTER (WHERE removed_at IS NOT NULL))
    FROM (
      SELECT removed_at FROM assurance_evidence_incidents x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_investigations x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_inspections x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_audits x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_findings x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_actions x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_verifications x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
    ) c
  )`;
}

// ── Detail ────────────────────────────────────────────────────────────────

export type EvidenceLinkHistoryRow = {
  link_id: string; kind: EvidenceLinkTarget; target_id: string; reference: string; target_status: string | null;
  item_key: string | null; item_label: string | null; purpose: string | null;
  linked_at: AssuranceTimestamp; linked_by_name: string | null;
  removed_at: AssuranceTimestamp | null; removed_by_name: string | null; removal_reason: string | null;
};

export type EvidenceChainRow = {
  id: string; evidence_reference: string; title: string | null; verification_status: EvidenceVerificationStatus;
  replaces_evidence_id: string | null; created_at: AssuranceTimestamp; decided_at: AssuranceTimestamp | null;
};

export type EvidenceDetail = {
  evidence: {
    id: string; evidence_reference: string; evidence_type: EvidenceType; title: string | null; description: string | null;
    captured_at: AssuranceTimestamp | null; captured_by: string | null; captured_by_name: string | null; location_name: string | null;
    metadata: Record<string, unknown>; created_at: AssuranceTimestamp; created_by: string | null; created_by_name: string | null;
    supplied_by_external_organisation_id: string | null; supplier_name: string | null;
    verification_status: EvidenceVerificationStatus; lock_version: number;
    verification_requested_at: AssuranceTimestamp | null; requested_by_name: string | null;
    decided_at: AssuranceTimestamp | null; decided_by_name: string | null; decision_reason: string | null;
    replaces_evidence_id: string | null; superseded_by_evidence_id: string | null; superseded_at: AssuranceTimestamp | null;
  };
  state: EvidenceState;
  authority: EvidenceAuthority;
  contractor: {
    submission_id: string; status: ContractorSubmissionStatus; external_organisation_id: string; external_organisation_name: string;
    requirement_name: string; requirement_code: string; supplied_on: string; effective_from: string | null; expires_on: string | null;
    recorded_by_name: string | null; decided_by_name: string | null; decided_at: AssuranceTimestamp | null; decision_reason: string | null;
  } | null;
  chain: EvidenceChainRow[];
  actionVerifications: {
    verification_id: string; action_id: string; action_reference: string; action_title: string; action_status: string;
    attempt_number: number; result: string; verified_at: AssuranceTimestamp; verified_by_name: string | null;
  }[];
  links: EvidenceLinkHistoryRow[];
  history: { id: string; action: string; created_at: AssuranceTimestamp; user_name: string | null; after_state: Record<string, unknown> | null }[];
  /** Server-derived; the decision service re-checks everything. */
  decision: { conflicts: string[] };
  canReplace: boolean;
};

type CoreRow = {
  id: string; organisation_id: string; verification_status: EvidenceVerificationStatus; lock_version: number;
  created_by: string | null; captured_by: string | null; replaces_evidence_id: string | null; contractor: boolean;
};

async function loadEvidenceCore(viewer: AssuranceViewer, id: string): Promise<CoreRow> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Evidence');
  const rows = (await sql`
    SELECT e.id, e.organisation_id, e.verification_status, e.lock_version, e.created_by, e.captured_by, e.replaces_evidence_id,
           EXISTS (SELECT 1 FROM assurance_requirement_submissions s WHERE s.organisation_id = e.organisation_id AND s.evidence_id = e.id) AS contractor
    FROM assurance_evidence e
    WHERE e.organisation_id = ${viewer.organisationId} AND e.id = ${id.toLowerCase()}::uuid AND ${evidenceVisibleSql(viewer)}
  `) as CoreRow[];
  if (!rows[0]) throw new AssuranceNotFoundError('Evidence');
  return rows[0];
}

/** Every Action this evidence is actively linked to, with who must not decide it. */
async function linkedActionRoles(organisationId: string, evidenceId: string) {
  return (await sql`
    SELECT a.owner_user_id, a.work_completed_by,
           COALESCE((SELECT array_agg(DISTINCT l.user_id) FROM audit_logs l
                     WHERE l.organisation_id = a.organisation_id AND l.resource_type = 'assurance_action'
                       AND l.resource_id = a.id::text AND l.action = 'assurance_action.work_completed' AND l.user_id IS NOT NULL), '{}') AS ever_completed_by
    FROM assurance_evidence_actions x
    JOIN assurance_actions a ON a.organisation_id = x.organisation_id AND a.id = x.action_id
    WHERE x.organisation_id = ${organisationId} AND x.evidence_id = ${evidenceId}::uuid AND x.removed_at IS NULL
  `) as { owner_user_id: string | null; work_completed_by: string | null; ever_completed_by: string[] }[];
}

/** The replacement tree containing this evidence, oldest first. */
async function loadChain(organisationId: string, id: string): Promise<EvidenceChainRow[]> {
  return (await sql`
    WITH RECURSIVE up AS (
      SELECT e.id, e.replaces_evidence_id, 0 AS depth FROM assurance_evidence e WHERE e.organisation_id = ${organisationId} AND e.id = ${id}::uuid
      UNION ALL
      SELECT p.id, p.replaces_evidence_id, up.depth + 1 FROM assurance_evidence p
      JOIN up ON p.organisation_id = ${organisationId} AND p.id = up.replaces_evidence_id
      WHERE up.depth < 1000
    ), root AS (
      SELECT id FROM up WHERE replaces_evidence_id IS NULL
    ), tree AS (
      SELECT e.id, e.evidence_reference, e.title, e.verification_status, e.replaces_evidence_id, e.created_at, e.decided_at, 0 AS depth
      FROM assurance_evidence e JOIN root ON e.id = root.id WHERE e.organisation_id = ${organisationId}
      UNION ALL
      SELECT c.id, c.evidence_reference, c.title, c.verification_status, c.replaces_evidence_id, c.created_at, c.decided_at, tree.depth + 1
      FROM assurance_evidence c JOIN tree ON c.organisation_id = ${organisationId} AND c.replaces_evidence_id = tree.id
      WHERE tree.depth < 1000
    )
    SELECT id, evidence_reference, title, verification_status, replaces_evidence_id, created_at, decided_at
    FROM tree ORDER BY created_at, evidence_reference
  `) as EvidenceChainRow[];
}

/** Mirrors the A0.1H chain-head rule: every OTHER row of the tree is rejected or superseded. */
function isChainHead(chain: EvidenceChainRow[], id: string): boolean {
  return chain.every(r => r.id === id || r.verification_status === 'REJECTED' || r.verification_status === 'SUPERSEDED');
}

export async function getEvidenceDetail(viewer: AssuranceViewer, id: string): Promise<EvidenceDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT e.id, e.evidence_reference, e.evidence_type, e.title, e.description, e.captured_at, e.captured_by, e.metadata, e.created_at, e.created_by,
           e.supplied_by_external_organisation_id, e.verification_status, e.lock_version, e.verification_requested_at,
           e.decided_at, e.decision_reason, e.replaces_evidence_id, e.superseded_by_evidence_id, e.superseded_at,
           cu.name AS captured_by_name, cr.name AS created_by_name, loc.name AS location_name, sup.name AS supplier_name,
           rq.name AS requested_by_name, dc.name AS decided_by_name
    FROM assurance_evidence e
    LEFT JOIN users cu ON cu.id = e.captured_by AND cu.organisation_id = e.organisation_id
    LEFT JOIN users cr ON cr.id = e.created_by AND cr.organisation_id = e.organisation_id
    LEFT JOIN users rq ON rq.id = e.verification_requested_by AND rq.organisation_id = e.organisation_id
    LEFT JOIN users dc ON dc.id = e.decided_by AND dc.organisation_id = e.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = e.organisation_id AND loc.id = e.location_id
    LEFT JOIN external_organisations sup ON sup.organisation_id = e.organisation_id AND sup.id = e.supplied_by_external_organisation_id
    WHERE e.organisation_id = ${org} AND e.id = ${id}::uuid AND ${evidenceVisibleSql(viewer)}
  `) as EvidenceDetail['evidence'][];
  if (!rows[0]) return null;
  const ev = rows[0];

  // Every link row this evidence has ever had, active and removed. The
  // evidence is visible, so (by evidenceVisibleSql) every linked subject is
  // visible too.
  const [links, history, contractorRows, chain, actionVerifications, roles] = await Promise.all([
    sql`
      SELECT * FROM (
        SELECT x.id AS link_id, 'incident' AS kind, inc.id AS target_id, inc.incident_reference AS reference, inc.status AS target_status,
               NULL::text AS item_key, NULL::text AS item_label, x.purpose,
               x.created_at AS linked_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_incidents x JOIN assurance_incidents inc ON inc.organisation_id = x.organisation_id AND inc.id = x.incident_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'investigation', inv.id, inv.investigation_reference, inv.status, NULL, NULL, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_investigations x JOIN assurance_investigations inv ON inv.organisation_id = x.organisation_id AND inv.id = x.investigation_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'inspection', i.id, i.inspection_reference, i.status, x.item_key, r.item_label, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_inspections x JOIN assurance_inspections i ON i.organisation_id = x.organisation_id AND i.id = x.inspection_id
        LEFT JOIN assurance_inspection_responses r ON r.organisation_id = x.organisation_id AND r.inspection_id = x.inspection_id AND r.item_key = x.item_key
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'audit', au.id, au.audit_reference, au.status, x.criterion_key, r.criterion_label, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_audits x JOIN assurance_audits au ON au.organisation_id = x.organisation_id AND au.id = x.audit_id
        LEFT JOIN assurance_audit_responses r ON r.organisation_id = x.organisation_id AND r.audit_id = x.audit_id AND r.criterion_key = x.criterion_key
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'finding', f.id, f.finding_reference, f.status, NULL, NULL, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_findings x JOIN assurance_findings f ON f.organisation_id = x.organisation_id AND f.id = x.finding_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'action', a.id, a.action_reference, a.status, NULL, NULL, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_actions x JOIN assurance_actions a ON a.organisation_id = x.organisation_id AND a.id = x.action_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'verification', a.id, a.action_reference || ' #' || v.attempt_number, v.result, NULL, NULL, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_verifications x
        JOIN assurance_verifications v ON v.organisation_id = x.organisation_id AND v.id = x.verification_id
        JOIN assurance_actions a ON a.organisation_id = v.organisation_id AND a.id = v.action_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
      ) l
      ORDER BY l.removed_at NULLS FIRST, l.linked_at DESC
    `,
    // audit_logs.created_at is a UTC timestamp without time zone; return an unambiguous instant.
    sql`
      SELECT l.id, l.action, (l.created_at AT TIME ZONE 'UTC') AS created_at, u.name AS user_name, l.after_state
      FROM audit_logs l
      LEFT JOIN users u ON u.id = l.user_id AND u.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.resource_type = 'assurance_evidence' AND l.resource_id = ${id}
      ORDER BY l.created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT s.id AS submission_id, s.status, eo.id AS external_organisation_id, eo.name AS external_organisation_name,
             s.requirement_name_snapshot AS requirement_name, s.requirement_code_snapshot AS requirement_code,
             s.supplied_on::text AS supplied_on, s.effective_from::text AS effective_from, s.expires_on::text AS expires_on,
             ru.name AS recorded_by_name, du.name AS decided_by_name, s.decided_at, s.decision_reason
      FROM assurance_requirement_submissions s
      JOIN assurance_requirement_assignments ra ON ra.organisation_id = s.organisation_id AND ra.id = s.assignment_id
      JOIN external_organisations eo ON eo.organisation_id = ra.organisation_id AND eo.id = ra.external_organisation_id
      LEFT JOIN users ru ON ru.id = s.recorded_by AND ru.organisation_id = s.organisation_id
      LEFT JOIN users du ON du.id = s.decided_by AND du.organisation_id = s.organisation_id
      WHERE s.organisation_id = ${org} AND s.evidence_id = ${id}::uuid
    `,
    loadChain(org, id),
    sql`
      SELECT v.id AS verification_id, a.id AS action_id, a.action_reference, a.title AS action_title, a.status AS action_status,
             v.attempt_number, v.result, v.verified_at, u.name AS verified_by_name
      FROM assurance_evidence_verifications x
      JOIN assurance_verifications v ON v.organisation_id = x.organisation_id AND v.id = x.verification_id
      JOIN assurance_actions a ON a.organisation_id = v.organisation_id AND a.id = v.action_id
      LEFT JOIN users u ON u.id = v.verified_by AND u.organisation_id = v.organisation_id
      WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid AND x.removed_at IS NULL
      ORDER BY v.verified_at DESC
    `,
    linkedActionRoles(org, id),
  ]);

  const userIds = [...new Set((links as { created_by: string | null; removed_by: string | null }[])
    .flatMap(l => [l.created_by, l.removed_by]).filter((v): v is string => !!v))];
  const names = userIds.length > 0
    ? new Map(((await sql`SELECT id, name FROM users WHERE organisation_id = ${org} AND id = ANY(${userIds}::text[])`) as { id: string; name: string }[]).map(u => [u.id, u.name]))
    : new Map<string, string>();

  const contractor = (contractorRows as NonNullable<EvidenceDetail['contractor']>[])[0] ?? null;
  const { state, authority } = evidenceState({ verificationStatus: ev.verification_status, contractorStatus: contractor?.status ?? null });
  const conflicts = decisionConflicts({
    viewerId: viewer.userId, recordedBy: ev.created_by, capturedBy: ev.captured_by,
    linkedActions: roles.map(r => ({ ownerUserId: r.owner_user_id, workCompletedBy: r.work_completed_by, everCompletedBy: r.ever_completed_by })),
  });

  return {
    evidence: ev,
    state, authority, contractor, chain,
    actionVerifications: actionVerifications as EvidenceDetail['actionVerifications'],
    links: (links as (Omit<EvidenceLinkHistoryRow, 'linked_by_name' | 'removed_by_name'> & { created_by: string | null; removed_by: string | null })[])
      .map(({ created_by, removed_by, ...l }) => ({
        ...l,
        linked_by_name: created_by ? names.get(created_by) ?? null : null,
        removed_by_name: removed_by ? names.get(removed_by) ?? null : null,
      })),
    history: history as EvidenceDetail['history'],
    decision: { conflicts },
    canReplace: authority === 'evidence' && isReplaceableStatus(ev.verification_status) && isChainHead(chain, ev.id),
  };
}

// A viewer with no user id and no admin rights: "who could see this if they
// weren't personally involved?" Used to tell whether a link target is
// restricted-scoped (hidden from ordinary members of the organisation).
function publicViewerOf(viewer: AssuranceViewer): AssuranceViewer {
  return { organisationId: viewer.organisationId, userId: '', role: 'viewer', canViewAllRestricted: false };
}

type TargetState = { status: string; publicVisible: boolean };

/**
 * Loads a link target the viewer can see (404 otherwise) with its status
 * and whether it is visible to an uninvolved member (restricted scope).
 * Verification targets are refused: evidence is attached to a verification
 * only by recordVerification() itself, at the moment it is recorded.
 */
async function loadTarget(viewer: AssuranceViewer, target: EvidenceLinkTarget, targetId: string): Promise<TargetState> {
  const org = viewer.organisationId;
  const pub = publicViewerOf(viewer);
  let rows: { status: string; public_visible: boolean }[] = [];
  switch (target) {
    case 'incident':
      rows = (await sql`
        SELECT inc.status, ${incidentVisibleSql(pub)} AS public_visible FROM assurance_incidents inc
        WHERE inc.organisation_id = ${org} AND inc.id = ${targetId}::uuid AND ${incidentVisibleSql(viewer)}
      `) as typeof rows;
      break;
    case 'investigation':
      rows = (await sql`
        SELECT inv.status, ${investigationVisibleSql(pub)} AS public_visible FROM assurance_investigations inv
        WHERE inv.organisation_id = ${org} AND inv.id = ${targetId}::uuid AND ${investigationVisibleSql(viewer)}
      `) as typeof rows;
      break;
    case 'inspection':
      rows = (await sql`
        SELECT i.status, true AS public_visible FROM assurance_inspections i
        WHERE i.organisation_id = ${org} AND i.id = ${targetId}::uuid
      `) as typeof rows;
      break;
    case 'audit':
      rows = (await sql`
        SELECT au.status, true AS public_visible FROM assurance_audits au
        WHERE au.organisation_id = ${org} AND au.id = ${targetId}::uuid
      `) as typeof rows;
      break;
    case 'finding':
      rows = (await sql`
        SELECT f.status, ${findingVisibleSql(pub)} AS public_visible FROM assurance_findings f
        WHERE f.organisation_id = ${org} AND f.id = ${targetId}::uuid AND ${findingVisibleSql(viewer)}
      `) as typeof rows;
      break;
    case 'action':
      rows = (await sql`
        SELECT a.status, ${actionVisibleSql(pub)} AS public_visible FROM assurance_actions a
        WHERE a.organisation_id = ${org} AND a.id = ${targetId}::uuid AND ${actionVisibleSql(viewer)}
      `) as typeof rows;
      break;
    case 'verification':
      throw new AssuranceConflictError('Evidence for a verification is attached when the verification is recorded; it cannot be added or removed afterwards.');
  }
  if (!rows[0]) throw new AssuranceNotFoundError('Record');
  return { status: rows[0].status, publicVisible: rows[0].public_visible === true };
}

/** Evidence of finished records is part of their closure record and is frozen. */
function assertEvidenceNotFrozen(target: EvidenceLinkTarget, status: string): void {
  const frozen =
    (target === 'action' && (status === 'CLOSED' || status === 'CANCELLED'))
    || (target === 'finding' && (status === 'CLOSED' || status === 'CANCELLED'))
    || (target === 'inspection' && status === 'CANCELLED')
    || (target === 'audit' && status === 'CANCELLED');
  if (frozen) throw new AssuranceConflictError('This record is finished; its evidence is part of the closure record and can no longer be changed.');
}

/** Guard fragment re-checked inside the write itself (race-safe with the row lock taken first). */
function notFrozenSql(viewer: AssuranceViewer, target: EvidenceLinkTarget, targetId: string) {
  if (target === 'action') {
    return sql`NOT EXISTS (SELECT 1 FROM assurance_actions g WHERE g.organisation_id = ${viewer.organisationId} AND g.id = ${targetId}::uuid AND g.status IN ('CLOSED', 'CANCELLED'))`;
  }
  if (target === 'finding') {
    return sql`NOT EXISTS (SELECT 1 FROM assurance_findings g WHERE g.organisation_id = ${viewer.organisationId} AND g.id = ${targetId}::uuid AND g.status IN ('CLOSED', 'CANCELLED'))`;
  }
  if (target === 'inspection') {
    return sql`NOT EXISTS (SELECT 1 FROM assurance_inspections g WHERE g.organisation_id = ${viewer.organisationId} AND g.id = ${targetId}::uuid AND g.status = 'CANCELLED')`;
  }
  if (target === 'audit') {
    return sql`NOT EXISTS (SELECT 1 FROM assurance_audits g WHERE g.organisation_id = ${viewer.organisationId} AND g.id = ${targetId}::uuid AND g.status = 'CANCELLED')`;
  }
  return sql`true`;
}

/** Row lock on the parent so closure and evidence changes serialise. */
function lockTargetSql(viewer: AssuranceViewer, target: EvidenceLinkTarget, targetId: string) {
  if (target === 'action') return sql`SELECT id FROM assurance_actions WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  if (target === 'finding') return sql`SELECT id FROM assurance_findings WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  if (target === 'inspection') return sql`SELECT id FROM assurance_inspections WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  if (target === 'audit') return sql`SELECT id FROM assurance_audits WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  return sql`SELECT 1`;
}

/** Item / criterion context: only on inspection / audit links, a structured FK to the response row. */
function linkContext(target: EvidenceLinkTarget | null, raw: Record<string, unknown>): string | null {
  const itemKey = optionalText(raw.itemKey, 'Checklist item', 200);
  const criterionKey = optionalText(raw.criterionKey, 'Audit criterion', 200);
  if (itemKey && target !== 'inspection') throw new AssuranceValidationError('A checklist item can only be chosen for an inspection.');
  if (criterionKey && target !== 'audit') throw new AssuranceValidationError('An audit criterion can only be chosen for an audit.');
  return target === 'inspection' ? itemKey : target === 'audit' ? criterionKey : null;
}

function linkInsert(viewer: AssuranceViewer, target: EvidenceLinkTarget, evidenceId: string, targetId: string, purpose: string | null, context: string | null) {
  const t = LINK_TABLES[target];
  if (target === 'inspection') {
    return sql`
      INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key, purpose, created_by)
      SELECT ${viewer.organisationId}, ${evidenceId}::uuid, ${targetId}::uuid, ${context}, ${purpose}, ${viewer.userId}
      WHERE ${notFrozenSql(viewer, target, targetId)}
      RETURNING id
    `;
  }
  if (target === 'audit') {
    return sql`
      INSERT INTO assurance_evidence_audits (organisation_id, evidence_id, audit_id, criterion_key, purpose, created_by)
      SELECT ${viewer.organisationId}, ${evidenceId}::uuid, ${targetId}::uuid, ${context}, ${purpose}, ${viewer.userId}
      WHERE ${notFrozenSql(viewer, target, targetId)}
      RETURNING id
    `;
  }
  return sql`
    INSERT INTO ${sql.unsafe(t.table)} (organisation_id, evidence_id, ${sql.unsafe(t.column)}, purpose, created_by)
    SELECT ${viewer.organisationId}, ${evidenceId}::uuid, ${targetId}::uuid, ${purpose}, ${viewer.userId}
    WHERE ${notFrozenSql(viewer, target, targetId)}
    RETURNING id
  `;
}

/** Maps A0.1H / constraint errors to user-facing errors; rethrows anything else. */
function mapEvidenceDbError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  const text = `${e.constraint ?? ''} ${e.message ?? ''}`;
  if (e.code === 'CE002') throw new AssuranceConflictError(`${(e.message ?? 'That change is not allowed now').replace(/\.?$/, '.')}`);
  if (e.code === 'CE003') throw new AssuranceConflictError('Someone else changed this evidence since you opened it. Reload and try again.');
  if (e.code === 'CE001') throw new AssuranceConflictError('This evidence changed while you were working. Reload and try again.');
  if (e.code === '23505') {
    if (/one_live_replacement/.test(text)) throw new AssuranceConflictError('Another replacement for this evidence is already in progress.');
    if (/active_link/.test(text)) throw new AssuranceConflictError('This evidence is already linked to that record.');
  }
  if (e.code === '23514' && /independent_decision/.test(text)) {
    throw new AssuranceForbiddenError('Someone other than the person who recorded or captured this evidence must decide it.');
  }
  if (e.code === '23503') {
    if (/inspections_item_fkey/.test(text)) throw new AssuranceValidationError('Choose a checklist item recorded on this inspection.');
    if (/audits_criterion_fkey/.test(text)) throw new AssuranceValidationError('Choose a criterion recorded on this audit.');
    if (/supplier_fkey/.test(text)) throw new AssuranceValidationError('Choose a supplier from your organisation’s external organisations.');
  }
  throw err;
}

function evidenceInput(raw: Record<string, unknown>) {
  return {
    evidenceType: requiredEnum(EVIDENCE_TYPES, raw.evidenceType, 'Evidence type'),
    title: requiredText(raw.title, 'Title', 200),
    description: optionalText(raw.description, 'Description', 4000),
    capturedAt: optionalDateTime(raw.capturedAt, 'Captured'),
    locationId: optionalUuid(raw.locationId, 'Location'),
    heldAt: optionalText(raw.heldAt, 'Where the original is held', 500),
    supplierId: optionalUuid(raw.supplierId, 'Supplier'),
    requestVerification: optionalBoolean(raw.requestVerification, false),
  };
}

function insertEvidenceSql(viewer: AssuranceViewer, id: string, reference: string, input: ReturnType<typeof evidenceInput>,
  guard: ReturnType<typeof sql>, replacesId: string | null) {
  // metadata holds only a small allow-listed set of descriptive keys.
  const metadata: Record<string, string> = { source: 'manual_entry' };
  if (input.heldAt) metadata.held_at = input.heldAt;
  const status = input.requestVerification ? 'AWAITING_VERIFICATION' : 'UNVERIFIED';
  return sql`
    INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at,
                                    location_id, metadata, created_by, supplied_by_external_organisation_id, replaces_evidence_id,
                                    verification_status, verification_requested_by, verification_requested_at)
    SELECT ${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.evidenceType}, ${input.title}, ${input.description},
           ${viewer.userId}, ${input.capturedAt ?? new Date().toISOString()}::timestamptz, ${input.locationId}::uuid,
           ${JSON.stringify(metadata)}::jsonb, ${viewer.userId}, ${input.supplierId}::uuid, ${replacesId}::uuid,
           ${status}, ${input.requestVerification ? viewer.userId : null}, ${input.requestVerification ? sql`now()` : sql`NULL`}
    WHERE ${guard}
    RETURNING id
  `;
}

export async function createEvidence(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; evidence_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const input = evidenceInput(raw);
  const target = raw.target === undefined || raw.target === null || raw.target === '' ? null : requiredEnum(EVIDENCE_LINK_TARGETS, raw.target, 'Link target');
  const targetId = optionalUuid(raw.targetId, 'Link target');
  const purpose = optionalText(raw.purpose, 'Purpose', 500);
  if ((target === null) !== (targetId === null)) throw new AssuranceValidationError('Choose both what the evidence relates to and the record.');
  const context = linkContext(target, raw);
  const [, state] = await Promise.all([
    assertContextRefsInOrg(viewer.organisationId, { locationId: input.locationId }),
    target && targetId ? loadTarget(viewer, target, targetId) : null,
  ]);
  if (target && state) assertEvidenceNotFrozen(target, state.status);

  const id = crypto.randomUUID();
  // Lock the parent first; every later statement re-checks "not frozen"
  // with a fresh snapshot, so the evidence, its link and its audit row are
  // written together or not at all.
  const guard = target && targetId ? notFrozenSql(viewer, target, targetId) : sql`true`;
  return withFreshReference('evidence', async reference => {
    const statements = [
      target && targetId ? lockTargetSql(viewer, target, targetId) : sql`SELECT 1`,
      insertEvidenceSql(viewer, id, reference, input, guard, null),
    ];
    if (target && targetId) statements.push(linkInsert(viewer, target, id, targetId, purpose, context));
    statements.push(sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.created', 'assurance_evidence', ${id},
             NULL, ${JSON.stringify({
               evidence_reference: reference, evidence_type: input.evidenceType, link_target: target, link_target_id: targetId,
               context_key: context, supplied_by_external_organisation_id: input.supplierId,
               verification_status: input.requestVerification ? 'AWAITING_VERIFICATION' : 'UNVERIFIED',
             })}::jsonb
      WHERE ${guard}
    `);
    let results: unknown[];
    try {
      results = await sql.transaction(statements);
    } catch (err) {
      mapEvidenceDbError(err);
    }
    if ((results[1] as unknown[]).length === 0) {
      throw new AssuranceConflictError('This record was finished while you were adding evidence. Nothing was saved.');
    }
    return { id, evidence_reference: reference };
  });
}

export async function linkEvidence(viewer: AssuranceViewer, evidenceId: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  if (!isUuid(evidenceId)) throw new AssuranceNotFoundError('Evidence');
  const target = requiredEnum(EVIDENCE_LINK_TARGETS, raw.target, 'Link target');
  const targetId = requiredUuid(raw.targetId, 'Link target');
  const purpose = optionalText(raw.purpose, 'Purpose', 500);
  const context = linkContext(target, raw);

  const ev = await loadEvidenceCore(viewer, evidenceId);
  if (ev.verification_status === 'SUPERSEDED') {
    throw new AssuranceConflictError('This evidence has been replaced. Link the current evidence instead.');
  }
  const state = await loadTarget(viewer, target, targetId);
  assertEvidenceNotFrozen(target, state.status);

  // Linking existing evidence to a restricted-scoped record would hide it
  // from everyone who can currently see it (visibility is inherited from
  // every link, including removed ones). That is only allowed for evidence
  // that has never been linked anywhere; otherwise record new evidence.
  if (!state.publicVisible) {
    const used = (await sql`
      SELECT (
        (SELECT count(*) FROM assurance_evidence_incidents x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_investigations x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_inspections x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_audits x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_findings x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_actions x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_verifications x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
      )::int AS n
    `) as { n: number }[];
    if (used[0].n > 0) {
      throw new AssuranceConflictError('This evidence is already used on other records. Linking it to a restricted record would hide it from everyone else — record new evidence for the restricted record instead.');
    }
  }

  let results: unknown[];
  try {
    results = await sql.transaction([
      lockTargetSql(viewer, target, targetId),
      linkInsert(viewer, target, evidenceId, targetId, purpose, context),
      sql`
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.linked', 'assurance_evidence', ${evidenceId},
               NULL, ${JSON.stringify({ target, target_id: targetId, context_key: context })}::jsonb
        WHERE ${notFrozenSql(viewer, target, targetId)}
      `,
    ]);
  } catch (err) {
    mapEvidenceDbError(err);
  }
  if ((results[1] as unknown[]).length === 0) {
    throw new AssuranceConflictError('This record was finished while you were linking evidence. Nothing was saved.');
  }
}

/** Soft unlink: the link row is kept with removed_at/removed_by/removal_reason. */
export async function unlinkEvidence(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const target = requiredEnum(EVIDENCE_LINK_TARGETS, raw.target, 'Link target');
  const linkId = requiredUuid(raw.linkId, 'Link');
  const reason = requiredText(raw.reason, 'Reason for removal', 1000);
  const t = LINK_TABLES[target];

  if (target === 'verification') {
    throw new AssuranceConflictError('Evidence recorded with a verification is part of that verification record and cannot be removed.');
  }

  // The evidence itself must be visible to the viewer as well as the target.
  const link = (await sql`
    SELECT l.evidence_id, l.${sql.unsafe(t.column)} AS target_id, l.removed_at
    FROM ${sql.unsafe(t.table)} l
    JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
    WHERE l.organisation_id = ${viewer.organisationId} AND l.id = ${linkId}::uuid AND ${evidenceVisibleSql(viewer)}
  `) as { evidence_id: string; target_id: string; removed_at: unknown }[];
  if (!link[0]) throw new AssuranceNotFoundError('Evidence link');
  const targetId = link[0].target_id;
  const state = await loadTarget(viewer, target, targetId);
  if (link[0].removed_at) throw new AssuranceConflictError('This evidence link was already removed.');
  assertEvidenceNotFrozen(target, state.status);

  // Lock the parent first so a concurrent closure cannot slip between the
  // check and the unlink; the UPDATE re-checks "not frozen" afterwards.
  const results = await sql.transaction([
    lockTargetSql(viewer, target, targetId),
    sql`
      WITH upd AS (
        UPDATE ${sql.unsafe(t.table)}
        SET removed_at = now(), removed_by = ${viewer.userId}, removal_reason = ${reason}
        WHERE organisation_id = ${viewer.organisationId} AND id = ${linkId}::uuid AND removed_at IS NULL
          AND ${notFrozenSql(viewer, target, targetId)}
        RETURNING evidence_id AS id
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.unlinked', 'assurance_evidence',
               upd.id::text, NULL, jsonb_build_object('target', ${target}::text, 'target_id', ${targetId}::text, 'link_id', ${linkId}::text)
        FROM upd
      )
      SELECT id FROM upd
    `,
  ]);
  if ((results[1] as unknown[]).length === 0) {
    throw new AssuranceConflictError('This evidence link could not be removed — it was already removed, or the record was finished.');
  }
}

// ── Verification lifecycle (A0.1H) ─────────────────────────────────────────

function requiredLockVersion(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new AssuranceValidationError('Reload the page and try again.');
  return n;
}

function assertGeneric(ev: CoreRow): void {
  if (ev.contractor) {
    throw new AssuranceConflictError('This evidence belongs to a contractor submission. It is accepted or rejected in Contractor assurance.');
  }
}

/** After a guarded write matched nothing, explain why (stale vs. state). */
async function explainNoop(viewer: AssuranceViewer, id: string, lockVersion: number, expected: string): Promise<never> {
  const now = await loadEvidenceCore(viewer, id);
  if (now.lock_version !== lockVersion) throw new AssuranceConflictError('Someone else changed this evidence since you opened it. Reload and try again.');
  throw new AssuranceConflictError(`This evidence is no longer ${expected}.`);
}

/** UNVERIFIED -> AWAITING_VERIFICATION. */
export async function requestEvidenceVerification(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const ev = await loadEvidenceCore(viewer, id);
  assertGeneric(ev);
  if (ev.verification_status !== 'UNVERIFIED') throw new AssuranceConflictError('Only unverified evidence can be submitted for verification.');
  let results: unknown[];
  try {
    results = await sql.transaction([
      sql`SELECT id FROM assurance_evidence WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid FOR UPDATE`,
      sql`
        WITH upd AS (
          UPDATE assurance_evidence
          SET verification_status = 'AWAITING_VERIFICATION', verification_requested_by = ${viewer.userId}, verification_requested_at = now(),
              lock_version = lock_version + 1
          WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid
            AND verification_status = 'UNVERIFIED' AND lock_version = ${lockVersion}::int
          RETURNING id, lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.verification_requested', 'assurance_evidence',
                 upd.id::text, jsonb_build_object('verification_status', 'UNVERIFIED'),
                 jsonb_build_object('verification_status', 'AWAITING_VERIFICATION', 'lock_version', upd.lock_version)
          FROM upd
        )
        SELECT id FROM upd
      `,
    ]);
  } catch (err) {
    mapEvidenceDbError(err);
  }
  if ((results[1] as unknown[]).length === 0) await explainNoop(viewer, ev.id, lockVersion, 'unverified');
}

/** AWAITING_VERIFICATION -> UNVERIFIED (e.g. to correct it first). */
export async function withdrawEvidenceVerification(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const reason = optionalText(raw.reason, 'Reason', 1000);
  const ev = await loadEvidenceCore(viewer, id);
  assertGeneric(ev);
  if (ev.verification_status !== 'AWAITING_VERIFICATION') throw new AssuranceConflictError('This evidence is not awaiting verification.');
  let results: unknown[];
  try {
    results = await sql.transaction([
      sql`SELECT id FROM assurance_evidence WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid FOR UPDATE`,
      sql`
        WITH upd AS (
          UPDATE assurance_evidence
          SET verification_status = 'UNVERIFIED', verification_requested_by = NULL, verification_requested_at = NULL,
              lock_version = lock_version + 1
          WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid
            AND verification_status = 'AWAITING_VERIFICATION' AND lock_version = ${lockVersion}::int
          RETURNING id, lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.verification_withdrawn', 'assurance_evidence',
                 upd.id::text, jsonb_build_object('verification_status', 'AWAITING_VERIFICATION'),
                 jsonb_build_object('verification_status', 'UNVERIFIED', 'lock_version', upd.lock_version, 'reason', ${reason}::text)
          FROM upd
        )
        SELECT id FROM upd
      `,
    ]);
  } catch (err) {
    mapEvidenceDbError(err);
  }
  if ((results[1] as unknown[]).length === 0) await explainNoop(viewer, ev.id, lockVersion, 'awaiting verification');
}

/**
 * AWAITING_VERIFICATION -> ACCEPTED | REJECTED, by an independent person.
 * Accepting a replacement supersedes an accepted predecessor in the same
 * statement (database trigger). Nothing else changes: no Action, Finding,
 * Inspection, Audit, Incident, Investigation, deadline or requirement.
 */
export async function decideEvidence(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ verification_status: EvidenceVerificationStatus; superseded_evidence_id: string | null }> {
  if (!viewerCan(viewer, 'verify')) throw new AssuranceForbiddenError();
  const decision = requiredEnum(EVIDENCE_DECISIONS, raw.decision, 'Decision');
  const reason = decision === 'REJECT' ? requiredText(raw.reason, 'Reason', 2000) : optionalText(raw.reason, 'Reason', 2000);
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const ev = await loadEvidenceCore(viewer, id);
  assertGeneric(ev);
  const roles = await linkedActionRoles(viewer.organisationId, ev.id);
  const conflicts = decisionConflicts({
    viewerId: viewer.userId, recordedBy: ev.created_by, capturedBy: ev.captured_by,
    linkedActions: roles.map(r => ({ ownerUserId: r.owner_user_id, workCompletedBy: r.work_completed_by, everCompletedBy: r.ever_completed_by })),
  });
  if (conflicts.length > 0) {
    throw new AssuranceForbiddenError(`Verification must be independent: ${conflicts.join(' ')}`);
  }
  if (ev.verification_status !== 'AWAITING_VERIFICATION') throw new AssuranceConflictError(`This evidence is ${ev.verification_status.toLowerCase().replace('_', ' ')}, not awaiting verification.`);
  const status: EvidenceVerificationStatus = decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';

  let results: unknown[];
  try {
    results = await sql.transaction([
      sql`SELECT id FROM assurance_evidence WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid FOR UPDATE`,
      sql`
        WITH pred AS (
          SELECT p.id FROM assurance_evidence t
          JOIN assurance_evidence p ON p.organisation_id = t.organisation_id AND p.id = t.replaces_evidence_id
          WHERE t.organisation_id = ${viewer.organisationId} AND t.id = ${ev.id}::uuid
            AND p.verification_status = 'ACCEPTED' AND ${status}::text = 'ACCEPTED'
        ), upd AS (
          UPDATE assurance_evidence
          SET verification_status = ${status}, decided_by = ${viewer.userId}, decided_at = now(), decision_reason = ${reason},
              lock_version = lock_version + 1
          WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid
            AND verification_status = 'AWAITING_VERIFICATION' AND lock_version = ${lockVersion}::int
          RETURNING id, lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId},
                 ${status === 'ACCEPTED' ? 'assurance_evidence.accepted' : 'assurance_evidence.rejected'}, 'assurance_evidence',
                 upd.id::text, jsonb_build_object('verification_status', 'AWAITING_VERIFICATION'),
                 jsonb_build_object('verification_status', ${status}::text, 'lock_version', upd.lock_version, 'reason', ${reason}::text,
                                    'superseded_evidence_id', (SELECT id::text FROM pred))
          FROM upd
        ), aud_sup AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.superseded', 'assurance_evidence',
                 pred.id::text, jsonb_build_object('verification_status', 'ACCEPTED'),
                 jsonb_build_object('verification_status', 'SUPERSEDED', 'superseded_by_evidence_id', upd.id::text)
          FROM pred, upd
        )
        SELECT upd.id, (SELECT id FROM pred) AS superseded_id FROM upd
      `,
    ]);
  } catch (err) {
    mapEvidenceDbError(err);
  }
  const rows = results[1] as { id: string; superseded_id: string | null }[];
  if (!rows[0]) await explainNoop(viewer, ev.id, lockVersion, 'awaiting verification');
  return { verification_status: status, superseded_evidence_id: rows[0].superseded_id };
}

/** Correction (D5): descriptive content only, before a decision, with before/after audit. */
export async function correctEvidence(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ lock_version: number }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const ev = await loadEvidenceCore(viewer, id);
  assertGeneric(ev);
  if (!canCorrect(ev.verification_status)) {
    throw new AssuranceConflictError('Evidence can only be corrected before it is accepted or rejected. Record a replacement instead.');
  }
  const current = (await sql`
    SELECT evidence_type, title, description, captured_at, metadata->>'held_at' AS held_at, supplied_by_external_organisation_id
    FROM assurance_evidence WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid
  `) as { evidence_type: string; title: string | null; description: string | null; captured_at: AssuranceTimestamp | null; held_at: string | null; supplied_by_external_organisation_id: string | null }[];
  const before = current[0];
  const next = {
    evidence_type: raw.evidenceType === undefined ? before.evidence_type : requiredEnum(EVIDENCE_TYPES, raw.evidenceType, 'Evidence type'),
    title: raw.title === undefined ? before.title : requiredText(raw.title, 'Title', 200),
    description: raw.description === undefined ? before.description : optionalText(raw.description, 'Description', 4000),
    held_at: raw.heldAt === undefined ? before.held_at : optionalText(raw.heldAt, 'Where the original is held', 500),
    supplied_by_external_organisation_id: raw.supplierId === undefined ? before.supplied_by_external_organisation_id : optionalUuid(raw.supplierId, 'Supplier'),
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(k => (next[k] ?? null) !== (before[k] ?? null));
  if (changed.length === 0) throw new AssuranceValidationError('Nothing was changed.');
  const beforeState = Object.fromEntries(changed.map(k => [k, before[k] ?? null]));
  const afterState = Object.fromEntries(changed.map(k => [k, next[k] ?? null]));

  let results: unknown[];
  try {
    results = await sql.transaction([
      sql`SELECT id FROM assurance_evidence WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid FOR UPDATE`,
      sql`
        WITH upd AS (
          UPDATE assurance_evidence
          SET evidence_type = ${next.evidence_type}, title = ${next.title}, description = ${next.description},
              metadata = CASE WHEN ${next.held_at}::text IS NULL THEN metadata - 'held_at'
                              ELSE jsonb_set(metadata, '{held_at}', to_jsonb(${next.held_at}::text)) END,
              supplied_by_external_organisation_id = ${next.supplied_by_external_organisation_id}::uuid,
              lock_version = lock_version + 1
          WHERE organisation_id = ${viewer.organisationId} AND id = ${ev.id}::uuid
            AND verification_status IN ('UNVERIFIED', 'AWAITING_VERIFICATION') AND lock_version = ${lockVersion}::int
          RETURNING id, lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.corrected', 'assurance_evidence',
                 upd.id::text, ${JSON.stringify(beforeState)}::jsonb,
                 ${JSON.stringify({ ...afterState, changed })}::jsonb || jsonb_build_object('lock_version', upd.lock_version)
          FROM upd
        )
        SELECT id, lock_version FROM upd
      `,
    ]);
  } catch (err) {
    mapEvidenceDbError(err);
  }
  const rows = results[1] as { id: string; lock_version: number }[];
  if (!rows[0]) await explainNoop(viewer, ev.id, lockVersion, 'correctable');
  return { lock_version: rows[0].lock_version };
}

/** Copies the predecessor's active links (with item context) to a replacement, skipping finished records. */
function copyLinksSql(viewer: AssuranceViewer, fromId: string, toId: string) {
  const org = viewer.organisationId;
  return [
    sql`INSERT INTO assurance_evidence_incidents (organisation_id, evidence_id, incident_id, purpose, created_by)
        SELECT x.organisation_id, ${toId}::uuid, x.incident_id, x.purpose, ${viewer.userId} FROM assurance_evidence_incidents x
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${fromId}::uuid AND x.removed_at IS NULL`,
    sql`INSERT INTO assurance_evidence_investigations (organisation_id, evidence_id, investigation_id, purpose, created_by)
        SELECT x.organisation_id, ${toId}::uuid, x.investigation_id, x.purpose, ${viewer.userId} FROM assurance_evidence_investigations x
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${fromId}::uuid AND x.removed_at IS NULL`,
    sql`INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, item_key, purpose, created_by)
        SELECT x.organisation_id, ${toId}::uuid, x.inspection_id, x.item_key, x.purpose, ${viewer.userId} FROM assurance_evidence_inspections x
        JOIN assurance_inspections g ON g.organisation_id = x.organisation_id AND g.id = x.inspection_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${fromId}::uuid AND x.removed_at IS NULL AND g.status <> 'CANCELLED'`,
    sql`INSERT INTO assurance_evidence_audits (organisation_id, evidence_id, audit_id, criterion_key, purpose, created_by)
        SELECT x.organisation_id, ${toId}::uuid, x.audit_id, x.criterion_key, x.purpose, ${viewer.userId} FROM assurance_evidence_audits x
        JOIN assurance_audits g ON g.organisation_id = x.organisation_id AND g.id = x.audit_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${fromId}::uuid AND x.removed_at IS NULL AND g.status <> 'CANCELLED'`,
    sql`INSERT INTO assurance_evidence_findings (organisation_id, evidence_id, finding_id, purpose, created_by)
        SELECT x.organisation_id, ${toId}::uuid, x.finding_id, x.purpose, ${viewer.userId} FROM assurance_evidence_findings x
        JOIN assurance_findings g ON g.organisation_id = x.organisation_id AND g.id = x.finding_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${fromId}::uuid AND x.removed_at IS NULL AND g.status NOT IN ('CLOSED', 'CANCELLED')`,
    sql`INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, purpose, created_by)
        SELECT x.organisation_id, ${toId}::uuid, x.action_id, x.purpose, ${viewer.userId} FROM assurance_evidence_actions x
        JOIN assurance_actions g ON g.organisation_id = x.organisation_id AND g.id = x.action_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${fromId}::uuid AND x.removed_at IS NULL AND g.status NOT IN ('CLOSED', 'CANCELLED')`,
  ];
}

/**
 * Records replacement evidence for an ACCEPTED or REJECTED chain head. The
 * original stays readable and unchanged; the replacement is linked to the
 * same (unfinished) records and becomes current only when it is accepted.
 */
export async function recordReplacementEvidence(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string; evidence_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const input = evidenceInput(raw);
  const pred = await loadEvidenceCore(viewer, id);
  assertGeneric(pred);
  if (!isReplaceableStatus(pred.verification_status)) {
    throw new AssuranceConflictError(pred.verification_status === 'SUPERSEDED'
      ? 'This evidence has already been replaced. Replace the current evidence instead.'
      : 'Only accepted or rejected evidence can be replaced. Correct it, or withdraw it from verification first.');
  }
  // Friendly pre-check of the A0.1H chain-head rule; the database re-checks under the chain lock.
  const chain = await loadChain(viewer.organisationId, pred.id);
  if (!isChainHead(chain, pred.id)) {
    const pending = chain.some(c => c.replaces_evidence_id === pred.id && c.verification_status !== 'REJECTED');
    throw new AssuranceConflictError(pending
      ? 'Another replacement for this evidence is already in progress. Have it decided first.'
      : 'This evidence is not the current evidence in its chain; replace the current evidence instead.');
  }
  await assertContextRefsInOrg(viewer.organisationId, { locationId: input.locationId });
  const newId = crypto.randomUUID();
  return withFreshReference('evidence', async reference => {
    let results: unknown[];
    try {
      results = await sql.transaction([
        sql`SELECT id FROM assurance_evidence WHERE organisation_id = ${viewer.organisationId} AND id = ${pred.id}::uuid FOR UPDATE`,
        insertEvidenceSql(viewer, newId, reference, input, sql`true`, pred.id),
        ...copyLinksSql(viewer, pred.id, newId),
        sql`
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          VALUES
            (gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.created', 'assurance_evidence', ${newId}, NULL,
             ${JSON.stringify({ evidence_reference: reference, evidence_type: input.evidenceType, replaces_evidence_id: pred.id,
                                supplied_by_external_organisation_id: input.supplierId,
                                verification_status: input.requestVerification ? 'AWAITING_VERIFICATION' : 'UNVERIFIED' })}::jsonb),
            (gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.replacement_recorded', 'assurance_evidence', ${pred.id}, NULL,
             ${JSON.stringify({ replacement_evidence_id: newId, replacement_reference: reference })}::jsonb)
        `,
      ]);
    } catch (err) {
      mapEvidenceDbError(err);
    }
    if ((results[1] as unknown[]).length === 0) throw new AssuranceConflictError('The replacement could not be recorded. Reload and try again.');
    return { id: newId, evidence_reference: reference };
  });
}

// ── Link-target options (for the evidence detail page) ─────────────────────

export type EvidenceLinkableTarget = Exclude<EvidenceLinkTarget, 'verification'>;
export type EvidenceLinkTargetOptions = Record<EvidenceLinkableTarget, { id: string; label: string }[]>;

/**
 * Records existing evidence can be linked to, per target type: only records
 * the viewer can see, in their own organisation, whose evidence is not
 * frozen (closed/cancelled findings and actions, cancelled inspections and
 * audits are excluded; incidents and investigations follow the same "open"
 * offer as the rest of the UI). linkEvidence() re-checks everything; this
 * only shapes what the form offers. Verification evidence is attached when
 * a verification is recorded, never linked afterwards.
 */
export async function listEvidenceLinkTargetOptions(viewer: AssuranceViewer): Promise<EvidenceLinkTargetOptions> {
  const org = viewer.organisationId;
  const [incident, investigation, inspection, audit, finding, action] = await Promise.all([
    sql`SELECT inc.id, inc.incident_reference AS ref, inc.title FROM assurance_incidents inc
        WHERE inc.organisation_id = ${org} AND inc.status NOT IN ('CLOSED', 'CANCELLED') AND ${incidentVisibleSql(viewer)}
        ORDER BY inc.occurred_at DESC LIMIT 300`,
    sql`SELECT inv.id, inv.investigation_reference AS ref, inv.title FROM assurance_investigations inv
        WHERE inv.organisation_id = ${org} AND inv.status NOT IN ('COMPLETED', 'CANCELLED') AND ${investigationVisibleSql(viewer)}
        ORDER BY inv.created_at DESC LIMIT 300`,
    sql`SELECT i.id, i.inspection_reference AS ref, i.title FROM assurance_inspections i
        WHERE i.organisation_id = ${org} AND i.status <> 'CANCELLED'
        ORDER BY i.created_at DESC LIMIT 300`,
    sql`SELECT au.id, au.audit_reference AS ref, au.title FROM assurance_audits au
        WHERE au.organisation_id = ${org} AND au.status <> 'CANCELLED'
        ORDER BY au.created_at DESC LIMIT 300`,
    sql`SELECT f.id, f.finding_reference AS ref, f.title FROM assurance_findings f
        WHERE f.organisation_id = ${org} AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)}
        ORDER BY f.identified_at DESC LIMIT 300`,
    sql`SELECT a.id, a.action_reference AS ref, a.title FROM assurance_actions a
        WHERE a.organisation_id = ${org} AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)}
        ORDER BY a.created_at DESC LIMIT 300`,
  ]);
  const opts = (rows: unknown) => (rows as { id: string; ref: string; title: string }[]).map(r => ({ id: r.id, label: `${r.ref} — ${r.title}` }));
  return {
    incident: opts(incident), investigation: opts(investigation), inspection: opts(inspection),
    audit: opts(audit), finding: opts(finding), action: opts(action),
  };
}

/** Same-org active external organisations (the optional supplier). */
export async function listSupplierOptions(viewer: AssuranceViewer): Promise<{ value: string; label: string }[]> {
  const rows = (await sql`
    SELECT id, reference, name FROM external_organisations
    WHERE organisation_id = ${viewer.organisationId} AND status = 'ACTIVE'
    ORDER BY name LIMIT 500
  `) as { id: string; reference: string; name: string }[];
  return rows.map(r => ({ value: r.id, label: `${r.name} (${r.reference})` }));
}
