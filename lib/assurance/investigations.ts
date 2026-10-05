import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { incidentVisibleSql, investigationVisibleSql, findingVisibleSql, evidenceVisibleSql } from './access';
import { auditInsert, listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import { auditFromCte, type AssuranceTimestamp } from './sqlHelpers';
import { assertSameOrgUsers } from './users';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import type { EvidenceLinkRow } from './incidents';
import {
  INVESTIGATION_INCIDENT_RELATIONSHIPS, INVESTIGATION_STATUSES,
  type InvestigationIncidentRelationship, type InvestigationStatus,
} from './domain';
import {
  isUuid, optionalBoolean, optionalDateTime, optionalUserId, optionalUuid, requiredEnum, requiredText,
  requiredUuid, searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

export type InvestigationListFilters = {
  q?: string;
  status?: string;
  state?: 'active' | 'completed' | 'all';
  leadUserId?: string;
  restricted?: 'yes' | 'no';
};

export type InvestigationListRow = {
  id: string;
  investigation_reference: string;
  title: string;
  status: InvestigationStatus;
  lead_name: string | null;
  started_at: AssuranceTimestamp;
  target_completion_at: AssuranceTimestamp | null;
  completed_at: AssuranceTimestamp | null;
  restricted: boolean;
  linked_incidents: { id: string; reference: string }[];
  hidden_incident_count: number;
  finding_count: number;
};

export async function listInvestigations(viewer: AssuranceViewer, filters: InvestigationListFilters = {}): Promise<InvestigationListRow[]> {
  const org = viewer.organisationId;
  const pattern = searchPattern(filters.q);
  const status = INVESTIGATION_STATUSES.includes(filters.status as InvestigationStatus) ? filters.status! : null;
  const state = filters.state === 'active' || filters.state === 'completed' ? filters.state : 'all';
  const leadUserId = typeof filters.leadUserId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(filters.leadUserId) ? filters.leadUserId : null;
  const restricted = filters.restricted === 'yes' ? true : filters.restricted === 'no' ? false : null;

  return (await sql`
    SELECT inv.id, inv.investigation_reference, inv.title, inv.status, inv.started_at, inv.target_completion_at,
           inv.completed_at, inv.restricted, lu.name AS lead_name,
           COALESCE((
             SELECT json_agg(json_build_object('id', inc.id, 'reference', inc.incident_reference) ORDER BY inc.incident_reference)
             FROM assurance_investigation_incidents ii
             JOIN assurance_incidents inc ON inc.organisation_id = ii.organisation_id AND inc.id = ii.incident_id
             WHERE ii.organisation_id = inv.organisation_id AND ii.investigation_id = inv.id
               AND ${incidentVisibleSql(viewer)}
           ), '[]'::json) AS linked_incidents,
           (SELECT count(*) FROM assurance_investigation_incidents ii
             JOIN assurance_incidents inc ON inc.organisation_id = ii.organisation_id AND inc.id = ii.incident_id
             WHERE ii.organisation_id = inv.organisation_id AND ii.investigation_id = inv.id
               AND NOT ${incidentVisibleSql(viewer)})::int AS hidden_incident_count,
           (SELECT count(*) FROM assurance_investigation_findings xf
             JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
             WHERE xf.organisation_id = inv.organisation_id AND xf.investigation_id = inv.id
               AND ${findingVisibleSql(viewer)})::int AS finding_count
    FROM assurance_investigations inv
    LEFT JOIN users lu ON lu.id = inv.lead_user_id AND lu.organisation_id = inv.organisation_id
    WHERE inv.organisation_id = ${org}
      AND ${investigationVisibleSql(viewer)}
      AND (${status}::text IS NULL OR inv.status = ${status})
      AND (${state}::text <> 'active' OR inv.status NOT IN ('COMPLETED', 'CANCELLED'))
      AND (${state}::text <> 'completed' OR inv.status IN ('COMPLETED', 'CANCELLED'))
      AND (${leadUserId}::text IS NULL OR inv.lead_user_id = ${leadUserId})
      AND (${restricted}::boolean IS NULL OR inv.restricted = ${restricted}::boolean)
      AND (${pattern}::text IS NULL OR inv.investigation_reference ILIKE ${pattern} OR inv.title ILIKE ${pattern})
    ORDER BY inv.started_at DESC, inv.created_at DESC
    LIMIT 200
  `) as InvestigationListRow[];
}

export type InvestigationDetail = {
  investigation: {
    id: string; investigation_reference: string; title: string; scope: string; status: InvestigationStatus;
    restricted: boolean; started_at: AssuranceTimestamp; target_completion_at: AssuranceTimestamp | null;
    completed_at: AssuranceTimestamp | null; conclusion: string | null;
    risk_name: string | null; lead_user_id: string | null; lead_name: string | null; completed_by_name: string | null;
    created_at: AssuranceTimestamp; updated_at: AssuranceTimestamp;
  };
  incidents: {
    link_id: string; relationship: InvestigationIncidentRelationship; visible: boolean; linked_at: AssuranceTimestamp;
    id: string | null; incident_reference: string | null; title: string | null; status: string | null;
    other_investigation_count: number;
  }[];
  people: { id: string; role: string; notes: string | null; display_name: string; job_title: string | null }[];
  findings: { id: string; finding_reference: string; title: string; finding_type: string; status: string; identified_at: AssuranceTimestamp }[];
  hiddenFindingCount: number;
  evidence: EvidenceLinkRow[];
  history: AssuranceHistoryEntry[];
};

export async function getInvestigationDetail(viewer: AssuranceViewer, id: string): Promise<InvestigationDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT inv.id, inv.investigation_reference, inv.title, inv.scope, inv.status, inv.restricted, inv.started_at,
           inv.target_completion_at, inv.completed_at, inv.conclusion, rl.name AS risk_name,
           inv.lead_user_id, lu.name AS lead_name, cu.name AS completed_by_name, inv.created_at, inv.updated_at
    FROM assurance_investigations inv
    LEFT JOIN assurance_risk_levels rl ON rl.organisation_id = inv.organisation_id AND rl.id = inv.risk_level_id
    LEFT JOIN users lu ON lu.id = inv.lead_user_id AND lu.organisation_id = inv.organisation_id
    LEFT JOIN users cu ON cu.id = inv.completed_by AND cu.organisation_id = inv.organisation_id
    WHERE inv.organisation_id = ${org} AND inv.id = ${id}::uuid
      AND ${investigationVisibleSql(viewer)}
  `) as InvestigationDetail['investigation'][];
  const investigation = rows[0];
  if (!investigation) return null;

  const [incidents, people, findings, hidden, evidence, history] = await Promise.all([
    sql`
      SELECT ii.id AS link_id, ii.relationship, ii.created_at AS linked_at,
             ${incidentVisibleSql(viewer)} AS visible,
             CASE WHEN ${incidentVisibleSql(viewer)} THEN inc.id END AS id,
             CASE WHEN ${incidentVisibleSql(viewer)} THEN inc.incident_reference END AS incident_reference,
             CASE WHEN ${incidentVisibleSql(viewer)} THEN inc.title END AS title,
             CASE WHEN ${incidentVisibleSql(viewer)} THEN inc.status END AS status,
             CASE WHEN ${incidentVisibleSql(viewer)} THEN (
               SELECT count(*) FROM assurance_investigation_incidents o
               JOIN assurance_investigations inv ON inv.organisation_id = o.organisation_id AND inv.id = o.investigation_id
               WHERE o.organisation_id = ii.organisation_id AND o.incident_id = ii.incident_id
                 AND o.investigation_id <> ii.investigation_id AND ${investigationVisibleSql(viewer)}
             ) ELSE 0 END::int AS other_investigation_count
      FROM assurance_investigation_incidents ii
      JOIN assurance_incidents inc ON inc.organisation_id = ii.organisation_id AND inc.id = ii.incident_id
      WHERE ii.organisation_id = ${org} AND ii.investigation_id = ${id}::uuid
      ORDER BY CASE ii.relationship WHEN 'PRIMARY' THEN 0 WHEN 'TRIGGERING' THEN 1 WHEN 'RELATED' THEN 2 ELSE 3 END, ii.created_at
    `,
    sql`
      SELECT ip.id, ip.role, ip.notes,
             COALESCE(NULLIF(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name AS display_name,
             p.job_title
      FROM assurance_investigation_people ip
      JOIN hr_people p ON p.organisation_id = ip.organisation_id AND p.id = ip.person_id
      WHERE ip.organisation_id = ${org} AND ip.investigation_id = ${id}::uuid
      ORDER BY ip.created_at ASC
    `,
    sql`
      SELECT f.id, f.finding_reference, f.title, f.finding_type, f.status, f.identified_at
      FROM assurance_investigation_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.investigation_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)}
      ORDER BY f.identified_at DESC
    `,
    sql`
      SELECT count(*)::int AS n
      FROM assurance_investigation_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.investigation_id = ${id}::uuid
        AND NOT ${findingVisibleSql(viewer)}
    `,
    sql`
      SELECT l.id AS link_id, e.id AS evidence_id, e.evidence_reference, e.evidence_type, e.title,
             e.verification_status,
             (SELECT s.status FROM assurance_requirement_submissions s WHERE s.organisation_id = e.organisation_id AND s.evidence_id = e.id) AS contractor_status,
             l.purpose, l.created_at AS linked_at, l.removed_at, l.removal_reason,
             cu.name AS linked_by_name, ru.name AS removed_by_name
      FROM assurance_evidence_investigations l
      JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
      LEFT JOIN users cu ON cu.id = l.created_by AND cu.organisation_id = l.organisation_id
      LEFT JOIN users ru ON ru.id = l.removed_by AND ru.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.investigation_id = ${id}::uuid
        AND ${evidenceVisibleSql(viewer)}
      ORDER BY l.removed_at NULLS FIRST, l.created_at DESC
    `,
    listAssuranceHistory(org, 'assurance_investigation', id),
  ]);

  return {
    investigation,
    incidents: incidents as InvestigationDetail['incidents'],
    people: people as InvestigationDetail['people'],
    findings: findings as InvestigationDetail['findings'],
    hiddenFindingCount: ((hidden as { n: number }[])[0]?.n) ?? 0,
    evidence: evidence as EvidenceLinkRow[],
    history,
  };
}

export async function assertInvestigationVisible(viewer: AssuranceViewer, id: string): Promise<{ id: string; status: InvestigationStatus }> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Investigation');
  const rows = (await sql`
    SELECT inv.id, inv.status FROM assurance_investigations inv
    WHERE inv.organisation_id = ${viewer.organisationId} AND inv.id = ${id}::uuid
      AND ${investigationVisibleSql(viewer)}
  `) as { id: string; status: InvestigationStatus }[];
  if (!rows[0]) throw new AssuranceNotFoundError('Investigation');
  return rows[0];
}

/** Every incident id must exist in the org AND be visible to the viewer. */
async function assertIncidentsVisible(viewer: AssuranceViewer, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = (await sql`
    SELECT inc.id FROM assurance_incidents inc
    WHERE inc.organisation_id = ${viewer.organisationId} AND inc.id = ANY(${ids}::uuid[])
      AND ${incidentVisibleSql(viewer)}
  `) as { id: string }[];
  if (rows.length !== ids.length) throw new AssuranceNotFoundError('Incident');
}

function parseIncidentLinks(raw: unknown): { incidentId: string; relationship: InvestigationIncidentRelationship }[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50) throw new AssuranceValidationError('Linked incidents must be a list.');
  const seen = new Set<string>();
  const out: { incidentId: string; relationship: InvestigationIncidentRelationship }[] = [];
  for (const entry of raw) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const incidentId = requiredUuid(e.incidentId, 'Linked incident');
    if (seen.has(incidentId)) continue;
    seen.add(incidentId);
    out.push({ incidentId, relationship: requiredEnum(INVESTIGATION_INCIDENT_RELATIONSHIPS, e.relationship ?? 'RELATED', 'Relationship') });
  }
  if (out.filter(l => l.relationship === 'PRIMARY').length > 1) {
    throw new AssuranceValidationError('Only one incident can be the primary incident.');
  }
  return out;
}

/** Form shape: one optional primary incident + a list of related incidents. */
function formIncidentLinks(raw: Record<string, unknown>): unknown {
  const links: { incidentId: unknown; relationship: InvestigationIncidentRelationship }[] = [];
  if (raw.primaryIncidentId) links.push({ incidentId: raw.primaryIncidentId, relationship: 'PRIMARY' });
  if (Array.isArray(raw.relatedIncidentIds)) {
    for (const id of raw.relatedIncidentIds) {
      if (id !== raw.primaryIncidentId) links.push({ incidentId: id, relationship: 'RELATED' });
    }
  }
  return links;
}

export async function createInvestigation(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; investigation_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const input = {
    title: requiredText(raw.title, 'Title', 200),
    scope: requiredText(raw.scope, 'Scope', 8000),
    leadUserId: optionalUserId(raw.leadUserId, 'Lead investigator'),
    riskLevelId: optionalUuid(raw.riskLevelId, 'Risk level'),
    targetCompletionAt: optionalDateTime(raw.targetCompletionAt, 'Target completion'),
    restricted: optionalBoolean(raw.restricted, false),
    incidents: parseIncidentLinks(raw.incidents ?? formIncidentLinks(raw)),
  };

  await Promise.all([
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Lead investigator', userId: input.leadUserId }]),
    assertContextRefsInOrg(viewer.organisationId, { riskLevelId: input.riskLevelId }),
    assertIncidentsVisible(viewer, input.incidents.map(l => l.incidentId)),
  ]);

  const id = crypto.randomUUID();
  return withFreshReference('investigation', async reference => {
    await sql.transaction([
      sql`
        INSERT INTO assurance_investigations (
          id, organisation_id, investigation_reference, title, scope, status, risk_level_id, lead_user_id,
          target_completion_at, restricted, created_by
        ) VALUES (
          ${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.title}, ${input.scope}, 'OPEN',
          ${input.riskLevelId}::uuid, ${input.leadUserId}, ${input.targetCompletionAt}::timestamptz,
          ${input.restricted}, ${viewer.userId}
        )
      `,
      ...input.incidents.map(link => sql`
        INSERT INTO assurance_investigation_incidents (organisation_id, investigation_id, incident_id, relationship, created_by)
        VALUES (${viewer.organisationId}, ${id}::uuid, ${link.incidentId}::uuid, ${link.relationship}, ${viewer.userId})
      `),
      auditInsert({
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_investigation',
        resourceId: id, verb: 'created',
        after: {
          investigation_reference: reference, status: 'OPEN', restricted: input.restricted,
          incident_ids: input.incidents.map(l => l.incidentId),
        },
      }),
    ]);
    return { id, investigation_reference: reference };
  });
}

/** Adds an Incident link to an existing Investigation (M:N). Links are never deleted. */
export async function linkIncidentToInvestigation(viewer: AssuranceViewer, investigationId: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const inv = await assertInvestigationVisible(viewer, investigationId);
  if (inv.status === 'COMPLETED' || inv.status === 'CANCELLED') {
    throw new AssuranceConflictError('Incidents cannot be linked to a completed or cancelled investigation.');
  }
  const incidentId = requiredUuid(raw.incidentId, 'Incident');
  const relationship = requiredEnum(INVESTIGATION_INCIDENT_RELATIONSHIPS, raw.relationship ?? 'RELATED', 'Relationship');
  await assertIncidentsVisible(viewer, [incidentId]);
  try {
    // Lock the investigation first so concurrent links serialise; the insert
    // then refuses a second PRIMARY and a finished investigation atomically.
    const results = await sql.transaction([
      sql`SELECT id FROM assurance_investigations WHERE organisation_id = ${viewer.organisationId} AND id = ${investigationId}::uuid FOR UPDATE`,
      sql`
        WITH ins AS (
          INSERT INTO assurance_investigation_incidents (organisation_id, investigation_id, incident_id, relationship, created_by)
          SELECT ${viewer.organisationId}, ${investigationId}::uuid, ${incidentId}::uuid, ${relationship}, ${viewer.userId}
          WHERE EXISTS (SELECT 1 FROM assurance_investigations v WHERE v.organisation_id = ${viewer.organisationId}
                          AND v.id = ${investigationId}::uuid AND v.status NOT IN ('COMPLETED', 'CANCELLED'))
            AND (${relationship}::text <> 'PRIMARY' OR NOT EXISTS (
                  SELECT 1 FROM assurance_investigation_incidents x
                  WHERE x.organisation_id = ${viewer.organisationId} AND x.investigation_id = ${investigationId}::uuid AND x.relationship = 'PRIMARY'))
          RETURNING investigation_id AS id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_investigation.incident_linked',
                 'assurance_investigation', ins.id::text, NULL,
                 jsonb_build_object('incident_id', ${incidentId}::text, 'relationship', ${relationship}::text)
          FROM ins
        )
        SELECT id FROM ins
      `,
    ]);
    if ((results[1] as unknown[]).length === 0) {
      throw new AssuranceConflictError(relationship === 'PRIMARY'
        ? 'This investigation already has a primary incident, or it has been completed.'
        : 'This investigation has been completed or cancelled.');
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new AssuranceConflictError('That incident is already linked.');
    throw err;
  }
}

export const INVESTIGATION_TRANSITIONS: Record<InvestigationStatus, readonly InvestigationStatus[]> = {
  OPEN: ['PLANNING', 'IN_PROGRESS', 'CANCELLED'],
  PLANNING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_INFORMATION', 'AWAITING_REVIEW', 'CANCELLED'],
  AWAITING_INFORMATION: ['IN_PROGRESS', 'CANCELLED'],
  AWAITING_REVIEW: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Investigation lifecycle. Completing an investigation records its
 * conclusion ONLY — it never closes linked Incidents or Findings.
 */
export async function transitionInvestigation(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string; status: InvestigationStatus }> {
  const to = requiredEnum(INVESTIGATION_STATUSES, raw.status, 'Status');
  const completing = to === 'COMPLETED';
  if (!viewerCan(viewer, completing || to === 'CANCELLED' ? 'close' : 'record')) throw new AssuranceForbiddenError();
  const current = await assertInvestigationVisible(viewer, id);
  if (!INVESTIGATION_TRANSITIONS[current.status].includes(to)) {
    throw new AssuranceConflictError(`An investigation that is ${current.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}.`);
  }
  const conclusion = completing ? requiredText(raw.conclusion, 'Conclusion', 8000) : null;

  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_investigations
      SET status = ${to},
          updated_at = now(),
          completed_at = CASE WHEN ${completing}::boolean THEN now() ELSE NULL END,
          completed_by = CASE WHEN ${completing}::boolean THEN ${viewer.userId} ELSE NULL END,
          conclusion = CASE WHEN ${completing}::boolean THEN ${conclusion} ELSE conclusion END
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${current.status}
      RETURNING id, status
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_investigation',
        verb: completing ? 'completed' : 'status_changed', before: { status: current.status }, after: { status: to },
      })}
    )
    SELECT id, status FROM upd
  `) as { id: string; status: InvestigationStatus }[];
  if (!rows[0]) throw new AssuranceConflictError('This investigation was changed by someone else. Refresh and try again.');
  return rows[0];
}
