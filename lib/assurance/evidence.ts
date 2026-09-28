import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import {
  incidentVisibleSql, investigationVisibleSql, findingVisibleSql, actionVisibleSql, evidenceVisibleSql,
} from './access';
import { listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import type { AssuranceTimestamp } from './sqlHelpers';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import { EVIDENCE_LINK_TARGETS, EVIDENCE_TYPES, type EvidenceLinkTarget, type EvidenceType } from './domain';
import {
  isUuid, optionalDateTime, optionalText, optionalUuid, requiredEnum, requiredText, requiredUuid, searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Evidence is a first-class, reusable record (assurance_evidence) linked
// to its subjects ONLY through the six explicit link tables. Links are
// never deleted: "unlinking" sets removed_at / removed_by /
// removal_reason (soft unlink), so evidence history is preserved. A
// removed link can be re-established as a NEW link row.
//
// This phase records evidence METADATA (what the proof is, where it is
// held, who captured it). Binary file storage is not implemented yet.

// Allow-listed link-table metadata. Table/column names are never taken
// from request data; `target` is validated against EVIDENCE_LINK_TARGETS
// before lookup, and the names below are constants.
const LINK_TABLES: Record<EvidenceLinkTarget, { table: string; column: string }> = {
  incident: { table: 'assurance_evidence_incidents', column: 'incident_id' },
  investigation: { table: 'assurance_evidence_investigations', column: 'investigation_id' },
  inspection: { table: 'assurance_evidence_inspections', column: 'inspection_id' },
  finding: { table: 'assurance_evidence_findings', column: 'finding_id' },
  action: { table: 'assurance_evidence_actions', column: 'action_id' },
  verification: { table: 'assurance_evidence_verifications', column: 'verification_id' },
};

export type EvidenceListFilters = { q?: string; evidenceType?: string; linked?: 'linked' | 'unlinked' };

export type EvidenceListRow = {
  id: string; evidence_reference: string; evidence_type: EvidenceType; title: string | null; captured_at: AssuranceTimestamp | null;
  captured_by_name: string | null; location_name: string | null; created_at: AssuranceTimestamp;
  active_link_count: number; removed_link_count: number;
  links: { kind: EvidenceLinkTarget; id: string; reference: string }[];
};

export async function listEvidence(viewer: AssuranceViewer, filters: EvidenceListFilters = {}): Promise<EvidenceListRow[]> {
  const pattern = searchPattern(filters.q);
  const type = EVIDENCE_TYPES.includes(filters.evidenceType as EvidenceType) ? filters.evidenceType! : null;
  const linked = filters.linked === 'linked' || filters.linked === 'unlinked' ? filters.linked : null;

  return (await sql`
    WITH base AS (
      SELECT e.*, ${activeLinksSql(viewer)} AS links, ${linkCountsSql()} AS counts
      FROM assurance_evidence e
      WHERE e.organisation_id = ${viewer.organisationId}
        AND ${evidenceVisibleSql(viewer)}
        AND (${type}::text IS NULL OR e.evidence_type = ${type})
        AND (${pattern}::text IS NULL OR e.evidence_reference ILIKE ${pattern} OR e.title ILIKE ${pattern})
    )
    SELECT b.id, b.evidence_reference, b.evidence_type, b.title, b.captured_at, b.created_at,
           cu.name AS captured_by_name, loc.name AS location_name,
           (b.counts->>'active')::int AS active_link_count, (b.counts->>'removed')::int AS removed_link_count,
           b.links
    FROM base b
    LEFT JOIN users cu ON cu.id = b.captured_by AND cu.organisation_id = b.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = b.organisation_id AND loc.id = b.location_id
    WHERE (${linked}::text IS NULL
           OR (${linked}::text = 'linked' AND (b.counts->>'active')::int > 0)
           OR (${linked}::text = 'unlinked' AND (b.counts->>'active')::int = 0))
    ORDER BY COALESCE(b.captured_at, b.created_at) DESC
    LIMIT 200
  `) as EvidenceListRow[];
}

/** Active links with references (evidence aliased `e`). Links to records hidden from the viewer are excluded. */
function activeLinksSql(viewer: AssuranceViewer) {
  return sql`(
    SELECT COALESCE(json_agg(l ORDER BY l->>'kind', l->>'reference'), '[]'::json) FROM (
      SELECT json_build_object('kind', 'incident', 'id', inc.id, 'reference', inc.incident_reference)::jsonb AS l
      FROM assurance_evidence_incidents x JOIN assurance_incidents inc ON inc.organisation_id = x.organisation_id AND inc.id = x.incident_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${incidentVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'investigation', 'id', inv.id, 'reference', inv.investigation_reference)::jsonb
      FROM assurance_evidence_investigations x JOIN assurance_investigations inv ON inv.organisation_id = x.organisation_id AND inv.id = x.investigation_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${investigationVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'inspection', 'id', i.id, 'reference', i.inspection_reference)::jsonb
      FROM assurance_evidence_inspections x JOIN assurance_inspections i ON i.organisation_id = x.organisation_id AND i.id = x.inspection_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL
      UNION ALL
      SELECT json_build_object('kind', 'finding', 'id', f.id, 'reference', f.finding_reference)::jsonb
      FROM assurance_evidence_findings x JOIN assurance_findings f ON f.organisation_id = x.organisation_id AND f.id = x.finding_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${findingVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'action', 'id', a.id, 'reference', a.action_reference)::jsonb
      FROM assurance_evidence_actions x JOIN assurance_actions a ON a.organisation_id = x.organisation_id AND a.id = x.action_id
      WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id AND x.removed_at IS NULL AND ${actionVisibleSql(viewer)}
      UNION ALL
      SELECT json_build_object('kind', 'verification', 'id', a.id, 'reference', a.action_reference || ' #' || v.attempt_number)::jsonb
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
      UNION ALL SELECT removed_at FROM assurance_evidence_findings x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_actions x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
      UNION ALL SELECT removed_at FROM assurance_evidence_verifications x WHERE x.organisation_id = e.organisation_id AND x.evidence_id = e.id
    ) c
  )`;
}

export type EvidenceLinkHistoryRow = {
  link_id: string; kind: EvidenceLinkTarget; target_id: string; reference: string; purpose: string | null;
  linked_at: AssuranceTimestamp; linked_by_name: string | null;
  removed_at: AssuranceTimestamp | null; removed_by_name: string | null; removal_reason: string | null;
};

export type EvidenceDetail = {
  evidence: {
    id: string; evidence_reference: string; evidence_type: EvidenceType; title: string | null; description: string | null;
    captured_at: AssuranceTimestamp | null; captured_by_name: string | null; location_name: string | null;
    metadata: Record<string, unknown>; created_at: AssuranceTimestamp; created_by_name: string | null;
  };
  links: EvidenceLinkHistoryRow[];
  history: AssuranceHistoryEntry[];
};

export async function getEvidenceDetail(viewer: AssuranceViewer, id: string): Promise<EvidenceDetail | null> {
  if (!isUuid(id)) return null;
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT e.id, e.evidence_reference, e.evidence_type, e.title, e.description, e.captured_at, e.metadata, e.created_at,
           cu.name AS captured_by_name, cr.name AS created_by_name, loc.name AS location_name
    FROM assurance_evidence e
    LEFT JOIN users cu ON cu.id = e.captured_by AND cu.organisation_id = e.organisation_id
    LEFT JOIN users cr ON cr.id = e.created_by AND cr.organisation_id = e.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = e.organisation_id AND loc.id = e.location_id
    WHERE e.organisation_id = ${org} AND e.id = ${id}::uuid AND ${evidenceVisibleSql(viewer)}
  `) as EvidenceDetail['evidence'][];
  if (!rows[0]) return null;

  // Every link row this evidence has ever had, active and removed. The
  // evidence is visible, so (by evidenceVisibleSql) every linked subject is
  // visible too.
  const [links, history] = await Promise.all([
    sql`
      SELECT * FROM (
        SELECT x.id AS link_id, 'incident' AS kind, inc.id AS target_id, inc.incident_reference AS reference, x.purpose,
               x.created_at AS linked_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_incidents x JOIN assurance_incidents inc ON inc.organisation_id = x.organisation_id AND inc.id = x.incident_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'investigation', inv.id, inv.investigation_reference, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_investigations x JOIN assurance_investigations inv ON inv.organisation_id = x.organisation_id AND inv.id = x.investigation_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'inspection', i.id, i.inspection_reference, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_inspections x JOIN assurance_inspections i ON i.organisation_id = x.organisation_id AND i.id = x.inspection_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'finding', f.id, f.finding_reference, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_findings x JOIN assurance_findings f ON f.organisation_id = x.organisation_id AND f.id = x.finding_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'action', a.id, a.action_reference, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_actions x JOIN assurance_actions a ON a.organisation_id = x.organisation_id AND a.id = x.action_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
        UNION ALL
        SELECT x.id, 'verification', a.id, a.action_reference || ' #' || v.attempt_number, x.purpose, x.created_at, x.removed_at, x.removal_reason, x.created_by, x.removed_by
        FROM assurance_evidence_verifications x
        JOIN assurance_verifications v ON v.organisation_id = x.organisation_id AND v.id = x.verification_id
        JOIN assurance_actions a ON a.organisation_id = v.organisation_id AND a.id = v.action_id
        WHERE x.organisation_id = ${org} AND x.evidence_id = ${id}::uuid
      ) l
      ORDER BY l.removed_at NULLS FIRST, l.linked_at DESC
    `,
    listAssuranceHistory(org, 'assurance_evidence', id),
  ]);

  const userIds = [...new Set((links as { created_by: string | null; removed_by: string | null }[])
    .flatMap(l => [l.created_by, l.removed_by]).filter((v): v is string => !!v))];
  const names = userIds.length > 0
    ? new Map(((await sql`SELECT id, name FROM users WHERE organisation_id = ${org} AND id = ANY(${userIds}::text[])`) as { id: string; name: string }[]).map(u => [u.id, u.name]))
    : new Map<string, string>();

  return {
    evidence: rows[0],
    links: (links as (Omit<EvidenceLinkHistoryRow, 'linked_by_name' | 'removed_by_name'> & { created_by: string | null; removed_by: string | null })[])
      .map(({ created_by, removed_by, ...l }) => ({
        ...l,
        linked_by_name: created_by ? names.get(created_by) ?? null : null,
        removed_by_name: removed_by ? names.get(removed_by) ?? null : null,
      })),
    history,
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
    || (target === 'inspection' && status === 'CANCELLED');
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
  return sql`true`;
}

/** Row lock on the parent so closure and evidence changes serialise. */
function lockTargetSql(viewer: AssuranceViewer, target: EvidenceLinkTarget, targetId: string) {
  if (target === 'action') return sql`SELECT id FROM assurance_actions WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  if (target === 'finding') return sql`SELECT id FROM assurance_findings WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  if (target === 'inspection') return sql`SELECT id FROM assurance_inspections WHERE organisation_id = ${viewer.organisationId} AND id = ${targetId}::uuid FOR UPDATE`;
  return sql`SELECT 1`;
}

function linkInsert(viewer: AssuranceViewer, target: EvidenceLinkTarget, evidenceId: string, targetId: string, purpose: string | null) {
  const t = LINK_TABLES[target];
  return sql`
    INSERT INTO ${sql.unsafe(t.table)} (organisation_id, evidence_id, ${sql.unsafe(t.column)}, purpose, created_by)
    SELECT ${viewer.organisationId}, ${evidenceId}::uuid, ${targetId}::uuid, ${purpose}, ${viewer.userId}
    WHERE ${notFrozenSql(viewer, target, targetId)}
    RETURNING id
  `;
}

export async function createEvidence(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; evidence_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const input = {
    evidenceType: requiredEnum(EVIDENCE_TYPES, raw.evidenceType, 'Evidence type'),
    title: requiredText(raw.title, 'Title', 200),
    description: optionalText(raw.description, 'Description', 4000),
    capturedAt: optionalDateTime(raw.capturedAt, 'Captured'),
    locationId: optionalUuid(raw.locationId, 'Location'),
    heldAt: optionalText(raw.heldAt, 'Where the original is held', 500),
    target: raw.target === undefined || raw.target === null || raw.target === '' ? null : requiredEnum(EVIDENCE_LINK_TARGETS, raw.target, 'Link target'),
    targetId: optionalUuid(raw.targetId, 'Link target'),
    purpose: optionalText(raw.purpose, 'Purpose', 500),
  };
  if ((input.target === null) !== (input.targetId === null)) throw new AssuranceValidationError('Choose both what the evidence relates to and the record.');
  const [, state] = await Promise.all([
    assertContextRefsInOrg(viewer.organisationId, { locationId: input.locationId }),
    input.target && input.targetId ? loadTarget(viewer, input.target, input.targetId) : null,
  ]);
  if (input.target && state) assertEvidenceNotFrozen(input.target, state.status);

  // metadata holds only a small allow-listed set of descriptive keys.
  const metadata: Record<string, string> = { source: 'manual_entry' };
  if (input.heldAt) metadata.held_at = input.heldAt;

  const id = crypto.randomUUID();
  const target = input.target;
  const targetId = input.targetId;
  // Lock the parent first; every later statement re-checks "not frozen"
  // with a fresh snapshot, so the evidence, its link and its audit row are
  // written together or not at all.
  const guard = target && targetId ? notFrozenSql(viewer, target, targetId) : sql`true`;
  return withFreshReference('evidence', async reference => {
    const statements = [
      target && targetId ? lockTargetSql(viewer, target, targetId) : sql`SELECT 1`,
      sql`
        INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at, location_id, metadata, created_by)
        SELECT ${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.evidenceType}, ${input.title}, ${input.description},
               ${viewer.userId}, ${input.capturedAt ?? new Date().toISOString()}::timestamptz, ${input.locationId}::uuid,
               ${JSON.stringify(metadata)}::jsonb, ${viewer.userId}
        WHERE ${guard}
        RETURNING id
      `,
    ];
    if (target && targetId) statements.push(linkInsert(viewer, target, id, targetId, input.purpose));
    statements.push(sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.created', 'assurance_evidence', ${id},
             NULL, ${JSON.stringify({ evidence_reference: reference, evidence_type: input.evidenceType, link_target: target, link_target_id: targetId })}::jsonb
      WHERE ${guard}
    `);
    const results = await sql.transaction(statements);
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

  const ev = (await sql`
    SELECT e.id FROM assurance_evidence e
    WHERE e.organisation_id = ${viewer.organisationId} AND e.id = ${evidenceId}::uuid AND ${evidenceVisibleSql(viewer)}
  `) as unknown[];
  if (ev.length === 0) throw new AssuranceNotFoundError('Evidence');
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
        + (SELECT count(*) FROM assurance_evidence_findings x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_actions x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
        + (SELECT count(*) FROM assurance_evidence_verifications x WHERE x.organisation_id = ${viewer.organisationId} AND x.evidence_id = ${evidenceId}::uuid)
      )::int AS n
    `) as { n: number }[];
    if (used[0].n > 0) {
      throw new AssuranceConflictError('This evidence is already used on other records. Linking it to a restricted record would hide it from everyone else — record new evidence for the restricted record instead.');
    }
  }

  try {
    const results = await sql.transaction([
      lockTargetSql(viewer, target, targetId),
      linkInsert(viewer, target, evidenceId, targetId, purpose),
      sql`
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.linked', 'assurance_evidence', ${evidenceId},
               NULL, ${JSON.stringify({ target, target_id: targetId })}::jsonb
        WHERE ${notFrozenSql(viewer, target, targetId)}
      `,
    ]);
    if ((results[1] as unknown[]).length === 0) {
      throw new AssuranceConflictError('This record was finished while you were linking evidence. Nothing was saved.');
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new AssuranceConflictError('This evidence is already linked to that record.');
    throw err;
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
