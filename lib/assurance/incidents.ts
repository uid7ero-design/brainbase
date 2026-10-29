import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { incidentVisibleSql, investigationVisibleSql, findingVisibleSql, actionVisibleSql, evidenceVisibleSql } from './access';
import { auditInsert, listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import { auditFromCte, type AssuranceTimestamp } from './sqlHelpers';
import { assertSameOrgUsers } from './users';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import {
  INCIDENT_CATEGORIES, INCIDENT_STATUSES, type IncidentCategory, type IncidentStatus,
} from './domain';
import {
  isUuid, optionalBoolean, optionalText, optionalUserId, optionalUuid,
  requiredDateTime, requiredEnum, requiredText, searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';
import { INCIDENT_TRANSITIONS, parseIncidentView } from './incidentRules';

// ── Reads ─────────────────────────────────────────────────────────────────

export type IncidentListFilters = {
  q?: string;
  status?: string;
  state?: 'open' | 'closed' | 'all';
  /** Register view (lib/assurance/incidentRules.ts). `state` is the legacy name. */
  view?: string;
  category?: string;
  riskLevelId?: string;
  ownerUserId?: string;
  locationId?: string;
  externalOrganisationId?: string;
  restricted?: 'yes' | 'no';
  occurredFrom?: string;
  occurredTo?: string;
};

export type IncidentListRow = {
  id: string;
  incident_reference: string;
  title: string;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: AssuranceTimestamp;
  restricted: boolean;
  risk_name: string | null;
  risk_rank: number | null;
  owner_name: string | null;
  location_name: string | null;
  asset_name: string | null;
  external_organisation_name: string | null;
  investigation_count: number;
  active_investigation_count: number;
  finding_count: number;
  open_finding_count: number;
  open_action_count: number;
};

export const INCIDENT_LIST_LIMIT = 200;

export async function listIncidents(viewer: AssuranceViewer, filters: IncidentListFilters = {}): Promise<IncidentListRow[]> {
  const org = viewer.organisationId;
  const pattern = searchPattern(filters.q);
  const status = INCIDENT_STATUSES.includes(filters.status as IncidentStatus) ? filters.status! : null;
  const category = INCIDENT_CATEGORIES.includes(filters.category as IncidentCategory) ? filters.category! : null;
  const riskLevelId = isUuid(filters.riskLevelId) ? filters.riskLevelId : null;
  const locationId = isUuid(filters.locationId) ? filters.locationId : null;
  const ownerUserId = typeof filters.ownerUserId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(filters.ownerUserId) ? filters.ownerUserId : null;
  const externalOrganisationId = isUuid(filters.externalOrganisationId) ? filters.externalOrganisationId : null;
  const view = parseIncidentView(filters.view ?? filters.state);
  const restricted = filters.restricted === 'yes' ? true : filters.restricted === 'no' ? false : null;
  const from = safeDate(filters.occurredFrom);
  const to = safeDate(filters.occurredTo, true);

  return (await sql`
    SELECT inc.id, inc.incident_reference, inc.title, inc.category, inc.status, inc.occurred_at, inc.restricted,
           rl.name AS risk_name, rl.rank AS risk_rank,
           ou.name AS owner_name,
           loc.name AS location_name, ast.name AS asset_name, xo.name AS external_organisation_name,
           (SELECT count(*) FROM assurance_investigation_incidents ii
             JOIN assurance_investigations inv ON inv.organisation_id = ii.organisation_id AND inv.id = ii.investigation_id
             WHERE ii.organisation_id = inc.organisation_id AND ii.incident_id = inc.id
               AND ${investigationVisibleSql(viewer)})::int AS investigation_count,
           (SELECT count(*) FROM assurance_investigation_incidents ii
             JOIN assurance_investigations inv ON inv.organisation_id = ii.organisation_id AND inv.id = ii.investigation_id
             WHERE ii.organisation_id = inc.organisation_id AND ii.incident_id = inc.id
               AND inv.status NOT IN ('COMPLETED', 'CANCELLED') AND ${investigationVisibleSql(viewer)})::int AS active_investigation_count,
           (SELECT count(*) FROM assurance_incident_findings xf
             JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
             WHERE xf.organisation_id = inc.organisation_id AND xf.incident_id = inc.id
               AND ${findingVisibleSql(viewer)})::int AS finding_count,
           (SELECT count(*) FROM assurance_incident_findings xf
             JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
             WHERE xf.organisation_id = inc.organisation_id AND xf.incident_id = inc.id
               AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)})::int AS open_finding_count,
           (SELECT count(DISTINCT a.id) FROM assurance_incident_findings xf
             JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
             JOIN assurance_action_findings af ON af.organisation_id = f.organisation_id AND af.finding_id = f.id
             JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
             WHERE xf.organisation_id = inc.organisation_id AND xf.incident_id = inc.id
               AND a.status NOT IN ('CLOSED', 'CANCELLED')
               AND ${findingVisibleSql(viewer)} AND ${actionVisibleSql(viewer)})::int AS open_action_count
    FROM assurance_incidents inc
    LEFT JOIN assurance_risk_levels rl ON rl.organisation_id = inc.organisation_id AND rl.id = inc.risk_level_id
    LEFT JOIN users ou ON ou.id = inc.owner_user_id AND ou.organisation_id = inc.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = inc.organisation_id AND loc.id = inc.location_id
    LEFT JOIN assets ast ON ast.organisation_id = inc.organisation_id AND ast.id = inc.asset_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = inc.organisation_id AND xo.id = inc.external_organisation_id
    WHERE inc.organisation_id = ${org}
      AND ${incidentVisibleSql(viewer)}
      AND (${status}::text IS NULL OR inc.status = ${status})
      AND (${view}::text IN ('all', 'closed') OR inc.status NOT IN ('CLOSED', 'CANCELLED'))
      AND (${view}::text <> 'closed' OR inc.status IN ('CLOSED', 'CANCELLED'))
      AND (${view}::text <> 'needs_triage' OR inc.status IN ('REPORTED', 'UNDER_REVIEW'))
      AND (${view}::text <> 'investigation_required' OR inc.status = 'INVESTIGATION_REQUIRED')
      AND (${view}::text <> 'under_investigation' OR inc.status = 'UNDER_INVESTIGATION')
      -- Derived views count EVERY linked record (the closure guard does), never naming hidden ones.
      AND (${view}::text <> 'findings_open' OR ${openFindingsAllSql} > 0)
      AND (${view}::text <> 'ready' OR (inc.status = 'AWAITING_VERIFICATION' AND ${openFindingsAllSql} = 0 AND ${activeInvestigationsAllSql} = 0))
      AND (${category}::text IS NULL OR inc.category = ${category})
      AND (${riskLevelId}::uuid IS NULL OR inc.risk_level_id = ${riskLevelId}::uuid)
      AND (${locationId}::uuid IS NULL OR inc.location_id = ${locationId}::uuid)
      AND (${externalOrganisationId}::uuid IS NULL OR inc.external_organisation_id = ${externalOrganisationId}::uuid)
      AND (${ownerUserId}::text IS NULL OR inc.owner_user_id = ${ownerUserId})
      AND (${restricted}::boolean IS NULL OR inc.restricted = ${restricted}::boolean)
      AND (${from}::timestamptz IS NULL OR inc.occurred_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR inc.occurred_at < ${to}::timestamptz)
      AND (${pattern}::text IS NULL OR inc.incident_reference ILIKE ${pattern} OR inc.title ILIKE ${pattern})
    ORDER BY inc.occurred_at DESC, inc.created_at DESC
    LIMIT ${INCIDENT_LIST_LIMIT}
  `) as IncidentListRow[];
}

/** Correlated counts over EVERY linked record of the incident aliased `inc` (closure-guard semantics). */
const openFindingsAllSql = sql`(SELECT count(*) FROM assurance_incident_findings lx
  JOIN assurance_findings g ON g.organisation_id = lx.organisation_id AND g.id = lx.finding_id
  WHERE lx.organisation_id = inc.organisation_id AND lx.incident_id = inc.id AND g.status NOT IN ('CLOSED', 'CANCELLED'))`;
const activeInvestigationsAllSql = sql`(SELECT count(*) FROM assurance_investigation_incidents li
  JOIN assurance_investigations w ON w.organisation_id = li.organisation_id AND w.id = li.investigation_id
  WHERE li.organisation_id = inc.organisation_id AND li.incident_id = inc.id AND w.status NOT IN ('COMPLETED', 'CANCELLED'))`;

function safeDate(value: string | undefined, endOfDay = false): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export type IncidentDetail = {
  incident: {
    id: string; incident_reference: string; title: string; description: string; category: IncidentCategory;
    status: IncidentStatus; occurred_at: AssuranceTimestamp; reported_at: AssuranceTimestamp; restricted: boolean;
    immediate_response: string | null; closure_summary: string | null; closed_at: AssuranceTimestamp | null;
    risk_name: string | null; risk_rank: number | null;
    owner_user_id: string | null; owner_name: string | null; reporter_name: string | null; closed_by_name: string | null;
    location_name: string | null; asset_name: string | null; external_organisation_name: string | null;
    created_at: AssuranceTimestamp; updated_at: AssuranceTimestamp;
  };
  people: { id: string; role: string; notes: string | null; display_name: string; job_title: string | null }[];
  investigations: {
    link_id: string; relationship: string; visible: boolean;
    id: string | null; investigation_reference: string | null; title: string | null; status: string | null;
  }[];
  findings: { id: string; finding_reference: string; title: string; finding_type: string; status: string; identified_at: AssuranceTimestamp }[];
  hiddenFindingCount: number;
  /** Open Findings / active Investigations the viewer cannot see — used only to say "one or more". */
  hiddenOpenFindingCount: number;
  hiddenActiveInvestigationCount: number;
  /** Corrective Actions addressing this incident's (visible) Findings. Incidents never own Actions directly. */
  actions: { id: string; action_reference: string; title: string; status: string; owner_name: string | null; finding_references: string[] }[];
  evidence: EvidenceLinkRow[];
  history: AssuranceHistoryEntry[];
};

export type EvidenceLinkRow = {
  link_id: string; evidence_id: string; evidence_reference: string; evidence_type: string; title: string | null;
  purpose: string | null; linked_at: AssuranceTimestamp; removed_at: AssuranceTimestamp | null; removal_reason: string | null;
  linked_by_name: string | null; removed_by_name: string | null;
  /** A0.1H: the evidence's own lifecycle, and the contractor submission status when Contractor Assurance owns the decision. */
  verification_status?: string; contractor_status?: string | null;
  /** Inspection item / audit criterion context, when the link carries one. */
  item_key?: string | null; item_label?: string | null;
};

export async function getIncidentDetail(viewer: AssuranceViewer, id: string): Promise<IncidentDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;

  const rows = (await sql`
    SELECT inc.id, inc.incident_reference, inc.title, inc.description, inc.category, inc.status,
           inc.occurred_at, inc.reported_at, inc.restricted, inc.immediate_response, inc.closure_summary, inc.closed_at,
           rl.name AS risk_name, rl.rank AS risk_rank,
           inc.owner_user_id, ou.name AS owner_name, ru.name AS reporter_name, cu.name AS closed_by_name,
           loc.name AS location_name, ast.name AS asset_name, xo.name AS external_organisation_name,
           inc.created_at, inc.updated_at
    FROM assurance_incidents inc
    LEFT JOIN assurance_risk_levels rl ON rl.organisation_id = inc.organisation_id AND rl.id = inc.risk_level_id
    LEFT JOIN users ou ON ou.id = inc.owner_user_id AND ou.organisation_id = inc.organisation_id
    LEFT JOIN users ru ON ru.id = inc.reported_by_user_id AND ru.organisation_id = inc.organisation_id
    LEFT JOIN users cu ON cu.id = inc.closed_by AND cu.organisation_id = inc.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = inc.organisation_id AND loc.id = inc.location_id
    LEFT JOIN assets ast ON ast.organisation_id = inc.organisation_id AND ast.id = inc.asset_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = inc.organisation_id AND xo.id = inc.external_organisation_id
    WHERE inc.organisation_id = ${org} AND inc.id = ${id}::uuid
      AND ${incidentVisibleSql(viewer)}
  `) as IncidentDetail['incident'][];
  const incident = rows[0];
  if (!incident) return null;

  const [people, investigations, findings, hidden, evidence, history, hiddenOpen, actions] = await Promise.all([
    sql`
      SELECT ip.id, ip.role, ip.notes,
             COALESCE(NULLIF(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name AS display_name,
             p.job_title
      FROM assurance_incident_people ip
      JOIN hr_people p ON p.organisation_id = ip.organisation_id AND p.id = ip.person_id
      WHERE ip.organisation_id = ${org} AND ip.incident_id = ${id}::uuid
      ORDER BY ip.created_at ASC
    `,
    sql`
      SELECT ii.id AS link_id, ii.relationship,
             ${investigationVisibleSql(viewer)} AS visible,
             CASE WHEN ${investigationVisibleSql(viewer)} THEN inv.id END AS id,
             CASE WHEN ${investigationVisibleSql(viewer)} THEN inv.investigation_reference END AS investigation_reference,
             CASE WHEN ${investigationVisibleSql(viewer)} THEN inv.title END AS title,
             CASE WHEN ${investigationVisibleSql(viewer)} THEN inv.status END AS status
      FROM assurance_investigation_incidents ii
      JOIN assurance_investigations inv ON inv.organisation_id = ii.organisation_id AND inv.id = ii.investigation_id
      WHERE ii.organisation_id = ${org} AND ii.incident_id = ${id}::uuid
      ORDER BY ii.created_at ASC
    `,
    sql`
      SELECT f.id, f.finding_reference, f.title, f.finding_type, f.status, f.identified_at
      FROM assurance_incident_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.incident_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)}
      ORDER BY f.identified_at DESC
    `,
    sql`
      SELECT count(*)::int AS n
      FROM assurance_incident_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.incident_id = ${id}::uuid
        AND NOT ${findingVisibleSql(viewer)}
    `,
    sql`
      SELECT l.id AS link_id, e.id AS evidence_id, e.evidence_reference, e.evidence_type, e.title,
             e.verification_status,
             (SELECT s.status FROM assurance_requirement_submissions s WHERE s.organisation_id = e.organisation_id AND s.evidence_id = e.id) AS contractor_status,
             l.purpose, l.created_at AS linked_at, l.removed_at, l.removal_reason,
             cu.name AS linked_by_name, ru.name AS removed_by_name
      FROM assurance_evidence_incidents l
      JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
      LEFT JOIN users cu ON cu.id = l.created_by AND cu.organisation_id = l.organisation_id
      LEFT JOIN users ru ON ru.id = l.removed_by AND ru.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.incident_id = ${id}::uuid
        AND ${evidenceVisibleSql(viewer)}
      ORDER BY l.removed_at NULLS FIRST, l.created_at DESC
    `,
    listAssuranceHistory(org, 'assurance_incident', id),
    sql`
      SELECT
        (SELECT count(*) FROM assurance_incident_findings lx
          JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
          WHERE lx.organisation_id = ${org} AND lx.incident_id = ${id}::uuid
            AND f.status NOT IN ('CLOSED', 'CANCELLED') AND NOT ${findingVisibleSql(viewer)})::int AS findings,
        (SELECT count(*) FROM assurance_investigation_incidents ii
          JOIN assurance_investigations inv ON inv.organisation_id = ii.organisation_id AND inv.id = ii.investigation_id
          WHERE ii.organisation_id = ${org} AND ii.incident_id = ${id}::uuid
            AND inv.status NOT IN ('COMPLETED', 'CANCELLED') AND NOT ${investigationVisibleSql(viewer)})::int AS investigations
    `,
    sql`
      SELECT a.id, a.action_reference, a.title, a.status, ou.name AS owner_name,
             array_agg(DISTINCT f.finding_reference ORDER BY f.finding_reference) AS finding_references
      FROM assurance_incident_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      JOIN assurance_action_findings af ON af.organisation_id = f.organisation_id AND af.finding_id = f.id
      JOIN assurance_actions a ON a.organisation_id = af.organisation_id AND a.id = af.action_id
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE lx.organisation_id = ${org} AND lx.incident_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)} AND ${actionVisibleSql(viewer)}
      GROUP BY a.id, a.action_reference, a.title, a.status, ou.name, a.created_at
      ORDER BY a.created_at ASC
    `,
  ]);
  const h = (hiddenOpen as { findings: number; investigations: number }[])[0];

  return {
    incident,
    people: people as IncidentDetail['people'],
    investigations: investigations as IncidentDetail['investigations'],
    findings: findings as IncidentDetail['findings'],
    hiddenFindingCount: ((hidden as { n: number }[])[0]?.n) ?? 0,
    hiddenOpenFindingCount: h?.findings ?? 0,
    hiddenActiveInvestigationCount: h?.investigations ?? 0,
    actions: actions as IncidentDetail['actions'],
    evidence: evidence as EvidenceLinkRow[],
    history,
  };
}

/** Minimal tenant+visibility-scoped existence check used by other services. */
export async function assertIncidentVisible(viewer: AssuranceViewer, id: string): Promise<{ id: string; status: IncidentStatus; incident_reference: string }> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Incident');
  const rows = (await sql`
    SELECT inc.id, inc.status, inc.incident_reference
    FROM assurance_incidents inc
    WHERE inc.organisation_id = ${viewer.organisationId} AND inc.id = ${id}::uuid
      AND ${incidentVisibleSql(viewer)}
  `) as { id: string; status: IncidentStatus; incident_reference: string }[];
  if (!rows[0]) throw new AssuranceNotFoundError('Incident');
  return rows[0];
}

/** Visible incidents for pickers (most recent first). */
export async function listIncidentOptions(viewer: AssuranceViewer, opts: { openOnly?: boolean } = {}): Promise<{ id: string; label: string }[]> {
  const openOnly = opts.openOnly !== false;
  const rows = (await sql`
    SELECT inc.id, inc.incident_reference, inc.title
    FROM assurance_incidents inc
    WHERE inc.organisation_id = ${viewer.organisationId}
      AND ${incidentVisibleSql(viewer)}
      AND (${openOnly}::boolean = false OR inc.status NOT IN ('CLOSED', 'CANCELLED'))
    ORDER BY inc.occurred_at DESC
    LIMIT 300
  `) as { id: string; incident_reference: string; title: string }[];
  return rows.map(r => ({ id: r.id, label: `${r.incident_reference} — ${r.title}` }));
}

// ── Writes ────────────────────────────────────────────────────────────────

export async function createIncident(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; incident_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();

  const input = {
    title: requiredText(raw.title, 'Title', 200),
    description: requiredText(raw.description, 'Description', 8000),
    category: requiredEnum(INCIDENT_CATEGORIES, raw.category, 'Category'),
    occurredAt: requiredDateTime(raw.occurredAt, 'Date and time occurred'),
    riskLevelId: optionalUuid(raw.riskLevelId, 'Risk level'),
    ownerUserId: optionalUserId(raw.ownerUserId, 'Owner'),
    locationId: optionalUuid(raw.locationId, 'Location'),
    assetId: optionalUuid(raw.assetId, 'Asset'),
    externalOrganisationId: optionalUuid(raw.externalOrganisationId, 'External organisation'),
    immediateResponse: optionalText(raw.immediateResponse, 'Immediate response', 4000),
    restricted: optionalBoolean(raw.restricted, false),
  };
  if (new Date(input.occurredAt).getTime() > Date.now() + 5 * 60_000) {
    throw new AssuranceValidationError('Date and time occurred cannot be in the future.');
  }

  await Promise.all([
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Owner', userId: input.ownerUserId }]),
    assertContextRefsInOrg(viewer.organisationId, {
      riskLevelId: input.riskLevelId, locationId: input.locationId, assetId: input.assetId,
      externalOrganisationId: input.externalOrganisationId,
    }),
  ]);

  const id = crypto.randomUUID();
  return withFreshReference('incident', async reference => {
    await sql.transaction([
      sql`
        INSERT INTO assurance_incidents (
          id, organisation_id, incident_reference, category, title, description, status, risk_level_id,
          occurred_at, reported_by_user_id, owner_user_id, location_id, asset_id, external_organisation_id,
          immediate_response, restricted, created_by
        ) VALUES (
          ${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.category}, ${input.title}, ${input.description},
          'REPORTED', ${input.riskLevelId}::uuid, ${input.occurredAt}::timestamptz, ${viewer.userId}, ${input.ownerUserId},
          ${input.locationId}::uuid, ${input.assetId}::uuid, ${input.externalOrganisationId}::uuid,
          ${input.immediateResponse}, ${input.restricted}, ${viewer.userId}
        )
      `,
      auditInsert({
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_incident',
        resourceId: id, verb: 'created',
        after: { incident_reference: reference, category: input.category, status: 'REPORTED', restricted: input.restricted },
      }),
    ]);
    return { id, incident_reference: reference };
  });
}

// Triage lifecycle. Closure is always an explicit step; nothing elsewhere
// in Assurance ever moves an Incident to CLOSED as a side effect.
export { INCIDENT_TRANSITIONS };

export async function transitionIncident(
  viewer: AssuranceViewer,
  id: string,
  raw: Record<string, unknown>,
): Promise<{ id: string; status: IncidentStatus }> {
  const to = requiredEnum(INCIDENT_STATUSES, raw.status, 'Status');
  const closing = to === 'CLOSED';
  if (!viewerCan(viewer, closing || to === 'CANCELLED' ? 'close' : 'record')) throw new AssuranceForbiddenError();

  const current = await assertIncidentVisible(viewer, id);
  if (!INCIDENT_TRANSITIONS[current.status].includes(to)) {
    throw new AssuranceConflictError(`An incident that is ${current.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}.`);
  }
  const closureSummary = closing ? requiredText(raw.closureSummary, 'Closure summary', 4000) : null;

  if (closing) {
    // Closure is explicit AND guarded: an incident cannot be closed while
    // its own linked findings or investigations are still open. Nothing is
    // closed on its behalf.
    const blockers = (await sql`
      SELECT
        (SELECT count(*) FROM assurance_incident_findings lx
           JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
          WHERE lx.organisation_id = ${viewer.organisationId} AND lx.incident_id = ${id}::uuid
            AND f.status NOT IN ('CLOSED', 'CANCELLED'))::int AS open_findings,
        (SELECT count(*) FROM assurance_investigation_incidents ii
           JOIN assurance_investigations inv ON inv.organisation_id = ii.organisation_id AND inv.id = ii.investigation_id
          WHERE ii.organisation_id = ${viewer.organisationId} AND ii.incident_id = ${id}::uuid
            AND inv.status NOT IN ('COMPLETED', 'CANCELLED'))::int AS active_investigations
    `) as { open_findings: number; active_investigations: number }[];
    const b = blockers[0];
    if (b.open_findings > 0 || b.active_investigations > 0) {
      // Counts deliberately not shown: they may include restricted records.
      throw new AssuranceConflictError('This incident cannot be closed yet: linked findings or investigations are still open.');
    }
  }

  // Lock the incident FIRST (raising a finding from it share-locks it), then
  // re-check the closure guard inside the UPDATE with a fresh snapshot.
  const closeGuard = sql`(
    NOT ${closing}::boolean OR (
      NOT EXISTS (
        SELECT 1 FROM assurance_incident_findings lx
        JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
        WHERE lx.organisation_id = ${viewer.organisationId} AND lx.incident_id = ${id}::uuid AND f.status NOT IN ('CLOSED', 'CANCELLED'))
      AND NOT EXISTS (
        SELECT 1 FROM assurance_investigation_incidents ii
        JOIN assurance_investigations inv ON inv.organisation_id = ii.organisation_id AND inv.id = ii.investigation_id
        WHERE ii.organisation_id = ${viewer.organisationId} AND ii.incident_id = ${id}::uuid AND inv.status NOT IN ('COMPLETED', 'CANCELLED'))
    )
  )`;
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_incidents WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid FOR UPDATE`,
    sql`
    WITH upd AS (
      UPDATE assurance_incidents
      SET status = ${to},
          updated_at = now(),
          closed_at = CASE WHEN ${closing}::boolean THEN now() ELSE NULL END,
          closed_by = CASE WHEN ${closing}::boolean THEN ${viewer.userId} ELSE NULL END,
          closure_summary = CASE WHEN ${closing}::boolean THEN ${closureSummary} ELSE closure_summary END
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${current.status}
        AND ${closeGuard}
      RETURNING id, status
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_incident',
        verb: closing ? 'closed' : 'status_changed', before: { status: current.status }, after: { status: to },
      })}
    )
    SELECT id, status FROM upd
  `,
  ]);
  const rows = results[1] as { id: string; status: IncidentStatus }[];
  if (!rows[0]) throw new AssuranceConflictError('This incident changed while you were updating it. Refresh and try again.');
  return rows[0];
}

/**
 * Assigns (or clears) the incident owner. Optimistic: the request carries
 * the owner the user saw; a concurrent change makes it a deterministic
 * conflict instead of a silent overwrite. Finished incidents keep their
 * owner. Ownership never changes status, risk or anything linked.
 */
export async function assignIncidentOwner(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string; owner_user_id: string | null }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const ownerUserId = optionalUserId(raw.ownerUserId, 'Owner');
  const expected = raw.expectedOwnerUserId === undefined ? undefined : optionalUserId(raw.expectedOwnerUserId, 'Current owner');
  const current = await assertIncidentVisible(viewer, id);
  if (current.status === 'CLOSED' || current.status === 'CANCELLED') {
    throw new AssuranceConflictError('The owner of a closed or cancelled incident cannot be changed.');
  }
  await assertSameOrgUsers(viewer.organisationId, [{ field: 'Owner', userId: ownerUserId }]);
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_incidents WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid FOR UPDATE`,
    sql`
      WITH prev AS (
        SELECT owner_user_id FROM assurance_incidents
        WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid
      ), upd AS (
        UPDATE assurance_incidents i
        SET owner_user_id = ${ownerUserId}, updated_at = now()
        WHERE i.organisation_id = ${viewer.organisationId} AND i.id = ${id}::uuid
          AND i.status NOT IN ('CLOSED', 'CANCELLED')
          AND (${expected === undefined}::boolean OR i.owner_user_id IS NOT DISTINCT FROM ${expected ?? null}::text)
          AND i.owner_user_id IS DISTINCT FROM ${ownerUserId}::text
        RETURNING i.id, i.owner_user_id
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_incident.owner_changed',
               'assurance_incident', upd.id::text,
               jsonb_build_object('owner_user_id', (SELECT owner_user_id FROM prev)),
               jsonb_build_object('owner_user_id', upd.owner_user_id)
        FROM upd
      )
      SELECT id, owner_user_id FROM upd
    `,
  ]);
  const rows = results[1] as { id: string; owner_user_id: string | null }[];
  if (!rows[0]) {
    throw new AssuranceConflictError('The owner was not changed: someone else changed it (or the incident) first, or it is already that person. Refresh and try again.');
  }
  return rows[0];
}
