import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { actionVisibleSql, findingVisibleSql, evidenceVisibleSql } from './access';
import { listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import { auditFromCte, type AssuranceTimestamp } from './sqlHelpers';
import { assertSameOrgUsers } from './users';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import { assertFindingsVisible } from './findings';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import type { EvidenceLinkRow } from './incidents';
import {
  ACTION_PRIORITIES, ACTION_STATUSES, ACTION_TYPES, type ActionPriority, type ActionStatus, type ActionType,
  type VerificationResult,
} from './domain';
import {
  isUuid, optionalBoolean, optionalDateTime, optionalText, optionalUserId, optionalUuid, requiredEnum, requiredText,
  requiredUuid, searchPattern, uuidList,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Corrective Actions (A0.1C assurance_actions).
//
// Governing rules, enforced here and nowhere bypassed:
//   * An Action is linked to one or more Findings (assurance_action_findings, M:N).
//   * Organiser task completion NEVER changes an Action (tasks are linked
//     via assurance_action_tasks and only ever displayed).
//   * Work completed != verified != closed. Each is a separate, explicit step.
//   * Closing requires: work completed; active evidence when
//     evidence_required; latest verification ACCEPTED/NOT_APPLICABLE when
//     verification_required.
//   * Closing an Action never closes its Findings or their sources.

export type ActionListFilters = {
  q?: string;
  status?: string;
  view?: 'open' | 'overdue' | 'awaiting_verification' | 'mine' | 'closed' | 'all';
  priority?: string;
  actionType?: string;
  ownerUserId?: string;
};

export type ActionListRow = {
  id: string; action_reference: string; title: string; action_type: ActionType; priority: string; status: ActionStatus;
  owner_name: string | null; due_at: AssuranceTimestamp | null; work_completed_at: AssuranceTimestamp | null;
  evidence_required: boolean; verification_required: boolean; active_evidence_count: number;
  latest_verification_result: VerificationResult | null; findings: { id: string; reference: string }[];
};

export async function listActions(viewer: AssuranceViewer, filters: ActionListFilters = {}): Promise<ActionListRow[]> {
  const pattern = searchPattern(filters.q);
  const status = ACTION_STATUSES.includes(filters.status as ActionStatus) ? filters.status! : null;
  const priority = ACTION_PRIORITIES.includes(filters.priority as ActionPriority) ? filters.priority! : null;
  const type = ACTION_TYPES.includes(filters.actionType as ActionType) ? filters.actionType! : null;
  const view = filters.view && ['open', 'overdue', 'awaiting_verification', 'mine', 'closed'].includes(filters.view) ? filters.view : 'all';
  const ownerUserId = typeof filters.ownerUserId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(filters.ownerUserId) ? filters.ownerUserId : null;

  return (await sql`
    SELECT a.id, a.action_reference, a.title, a.action_type, a.priority, a.status, ou.name AS owner_name,
           tf.current_due_at AS due_at, a.work_completed_at, a.evidence_required, a.verification_required,
           (SELECT count(*) FROM assurance_evidence_actions ea
             WHERE ea.organisation_id = a.organisation_id AND ea.action_id = a.id AND ea.removed_at IS NULL)::int AS active_evidence_count,
           (SELECT v.result FROM assurance_verifications v
             WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id
             ORDER BY v.attempt_number DESC LIMIT 1) AS latest_verification_result,
           COALESCE((
             SELECT json_agg(json_build_object('id', f.id, 'reference', f.finding_reference) ORDER BY f.finding_reference)
             FROM assurance_action_findings af
             JOIN assurance_findings f ON f.organisation_id = af.organisation_id AND f.id = af.finding_id
             WHERE af.organisation_id = a.organisation_id AND af.action_id = a.id
           ), '[]'::json) AS findings
    FROM assurance_actions a
    LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
    LEFT JOIN LATERAL (
      SELECT t.current_due_at FROM assurance_timeframes t
      WHERE t.organisation_id = a.organisation_id AND t.action_id = a.id AND t.status IN ('ACTIVE', 'OVERDUE')
      ORDER BY t.current_due_at ASC LIMIT 1
    ) tf ON true
    WHERE a.organisation_id = ${viewer.organisationId}
      AND ${actionVisibleSql(viewer)}
      AND (${status}::text IS NULL OR a.status = ${status})
      AND (${priority}::text IS NULL OR a.priority = ${priority})
      AND (${type}::text IS NULL OR a.action_type = ${type})
      AND (${ownerUserId}::text IS NULL OR a.owner_user_id = ${ownerUserId})
      AND (${view}::text NOT IN ('open', 'overdue', 'mine') OR a.status NOT IN ('CLOSED', 'CANCELLED'))
      AND (${view}::text <> 'overdue' OR tf.current_due_at < now())
      AND (${view}::text <> 'awaiting_verification' OR a.status = 'AWAITING_VERIFICATION')
      AND (${view}::text <> 'mine' OR a.owner_user_id = ${viewer.userId})
      AND (${view}::text <> 'closed' OR a.status IN ('CLOSED', 'CANCELLED'))
      AND (${pattern}::text IS NULL OR a.action_reference ILIKE ${pattern} OR a.title ILIKE ${pattern})
    ORDER BY CASE WHEN a.status IN ('CLOSED', 'CANCELLED') THEN 1 ELSE 0 END, tf.current_due_at ASC NULLS LAST, a.created_at DESC
    LIMIT 200
  `) as ActionListRow[];
}

export type VerificationAttemptRow = {
  id: string; attempt_number: number; result: VerificationResult; verified_at: AssuranceTimestamp;
  verified_by_name: string | null; notes: string | null;
  evidence: { id: string; reference: string; title: string | null }[];
};

export type ActionDetail = {
  action: {
    id: string; action_reference: string; title: string; description: string | null; action_type: ActionType;
    priority: string; status: ActionStatus; owner_user_id: string | null; owner_name: string | null;
    responsible_external_organisation_name: string | null;
    evidence_required: boolean; verification_required: boolean;
    work_completed_at: AssuranceTimestamp | null; work_completed_by: string | null; work_completed_by_name: string | null;
    closed_at: AssuranceTimestamp | null; closed_by_name: string | null; created_by_name: string | null;
    created_at: AssuranceTimestamp;
  };
  findings: { id: string; finding_reference: string; title: string; status: string; finding_type: string }[];
  hiddenFindingCount: number;
  tasks: { link_id: string; relationship_type: string; organiser_item_id: string; name: string; status: string | null }[];
  evidence: EvidenceLinkRow[];
  verifications: VerificationAttemptRow[];
  timeframes: {
    id: string; timeframe_type: string; original_due_at: AssuranceTimestamp; current_due_at: AssuranceTimestamp; status: string;
    extensions: { requested_due_at: string; status: string; reason: string; approved_due_at: string | null }[];
  }[];
  readiness: ActionReadiness;
  history: AssuranceHistoryEntry[];
};

export type ActionReadiness = {
  workCompleted: boolean;
  evidenceSatisfied: boolean;
  verificationSatisfied: boolean;
  canClose: boolean;
  blockers: string[];
};

/** Pure closure-readiness rule. Shared by the detail view and closeAction(). */
export function computeActionReadiness(a: {
  status: ActionStatus; work_completed_at: unknown; evidence_required: boolean; verification_required: boolean;
  active_evidence_count: number; latest_verification_result: VerificationResult | null;
}): ActionReadiness {
  const workCompleted = a.work_completed_at != null;
  const evidenceSatisfied = !a.evidence_required || a.active_evidence_count > 0;
  const verificationSatisfied = !a.verification_required
    || a.latest_verification_result === 'ACCEPTED' || a.latest_verification_result === 'NOT_APPLICABLE';
  const blockers: string[] = [];
  if (a.status === 'CLOSED' || a.status === 'CANCELLED') blockers.push(`Action is already ${a.status.toLowerCase()}.`);
  if (!workCompleted) blockers.push('Work has not been marked complete.');
  if (!evidenceSatisfied) blockers.push('Evidence is required and none is currently linked.');
  if (!verificationSatisfied) {
    blockers.push(a.latest_verification_result
      ? `Latest verification is "${a.latest_verification_result.toLowerCase().replace(/_/g, ' ')}" — an accepted verification is required.`
      : 'Independent verification is required and has not been recorded.');
  }
  return { workCompleted, evidenceSatisfied, verificationSatisfied, canClose: blockers.length === 0, blockers };
}

export async function getActionDetail(viewer: AssuranceViewer, id: string): Promise<ActionDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT a.id, a.action_reference, a.title, a.description, a.action_type, a.priority, a.status,
           a.owner_user_id, ou.name AS owner_name, xo.name AS responsible_external_organisation_name,
           a.evidence_required, a.verification_required, a.work_completed_at, a.work_completed_by,
           wu.name AS work_completed_by_name, a.closed_at, cu.name AS closed_by_name, cr.name AS created_by_name, a.created_at,
           (SELECT count(*) FROM assurance_evidence_actions ea
             WHERE ea.organisation_id = a.organisation_id AND ea.action_id = a.id AND ea.removed_at IS NULL)::int AS active_evidence_count,
           (SELECT v.result FROM assurance_verifications v
             WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id
             ORDER BY v.attempt_number DESC LIMIT 1) AS latest_verification_result
    FROM assurance_actions a
    LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
    LEFT JOIN users wu ON wu.id = a.work_completed_by AND wu.organisation_id = a.organisation_id
    LEFT JOIN users cu ON cu.id = a.closed_by AND cu.organisation_id = a.organisation_id
    LEFT JOIN users cr ON cr.id = a.created_by AND cr.organisation_id = a.organisation_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = a.organisation_id AND xo.id = a.responsible_external_organisation_id
    WHERE a.organisation_id = ${org} AND a.id = ${id}::uuid
      AND ${actionVisibleSql(viewer)}
  `) as (ActionDetail['action'] & { active_evidence_count: number; latest_verification_result: VerificationResult | null })[];
  const row = rows[0];
  if (!row) return null;
  const { active_evidence_count, latest_verification_result, ...action } = row;

  const [findings, hidden, tasks, evidence, verifications, timeframes, history] = await Promise.all([
    sql`
      SELECT f.id, f.finding_reference, f.title, f.status, f.finding_type
      FROM assurance_action_findings af
      JOIN assurance_findings f ON f.organisation_id = af.organisation_id AND f.id = af.finding_id
      WHERE af.organisation_id = ${org} AND af.action_id = ${id}::uuid AND ${findingVisibleSql(viewer)}
      ORDER BY f.finding_reference
    `,
    sql`
      SELECT count(*)::int AS n
      FROM assurance_action_findings af
      JOIN assurance_findings f ON f.organisation_id = af.organisation_id AND f.id = af.finding_id
      WHERE af.organisation_id = ${org} AND af.action_id = ${id}::uuid AND NOT ${findingVisibleSql(viewer)}
    `,
    // Organiser tasks: id, name and status only — displayed, never acted on,
    // and only when the organisation has Organiser.
    organiserEnabled(org).then(enabled => (enabled ? sql`
      SELECT t.id AS link_id, t.relationship_type, t.organiser_item_id, oi.name, oi.status
      FROM assurance_action_tasks t
      JOIN organiser_items oi ON oi.organisation_id = t.organisation_id AND oi.id = t.organiser_item_id
      WHERE t.organisation_id = ${org} AND t.action_id = ${id}::uuid
      ORDER BY t.created_at ASC
    ` : [])),
    sql`
      SELECT l.id AS link_id, e.id AS evidence_id, e.evidence_reference, e.evidence_type, e.title,
             l.purpose, l.created_at AS linked_at, l.removed_at, l.removal_reason,
             cu.name AS linked_by_name, ru.name AS removed_by_name
      FROM assurance_evidence_actions l
      JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
      LEFT JOIN users cu ON cu.id = l.created_by AND cu.organisation_id = l.organisation_id
      LEFT JOIN users ru ON ru.id = l.removed_by AND ru.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.action_id = ${id}::uuid
        AND ${evidenceVisibleSql(viewer)}
      ORDER BY l.removed_at NULLS FIRST, l.created_at DESC
    `,
    sql`
      SELECT v.id, v.attempt_number, v.result, v.verified_at, u.name AS verified_by_name, v.notes,
             COALESCE((
               SELECT json_agg(json_build_object('id', e.id, 'reference', e.evidence_reference, 'title', e.title) ORDER BY e.evidence_reference)
               FROM assurance_evidence_verifications ev
               JOIN assurance_evidence e ON e.organisation_id = ev.organisation_id AND e.id = ev.evidence_id
               WHERE ev.organisation_id = v.organisation_id AND ev.verification_id = v.id AND ev.removed_at IS NULL
                 AND ${evidenceVisibleSql(viewer)}
             ), '[]'::json) AS evidence
      FROM assurance_verifications v
      LEFT JOIN users u ON u.id = v.verified_by AND u.organisation_id = v.organisation_id
      WHERE v.organisation_id = ${org} AND v.action_id = ${id}::uuid
      ORDER BY v.attempt_number DESC
    `,
    sql`
      SELECT t.id, t.timeframe_type, t.original_due_at, t.current_due_at, t.status,
             COALESCE((
               SELECT json_agg(json_build_object('requested_due_at', x.requested_due_at, 'status', x.status,
                                                 'reason', x.reason, 'approved_due_at', x.approved_due_at) ORDER BY x.requested_at)
               FROM assurance_timeframe_extensions x
               WHERE x.organisation_id = t.organisation_id AND x.timeframe_id = t.id
             ), '[]'::json) AS extensions
      FROM assurance_timeframes t
      WHERE t.organisation_id = ${org} AND t.action_id = ${id}::uuid
      ORDER BY t.created_at ASC
    `,
    listAssuranceHistory(org, 'assurance_action', id),
  ]);

  return {
    action,
    findings: findings as ActionDetail['findings'],
    hiddenFindingCount: ((hidden as { n: number }[])[0]?.n) ?? 0,
    tasks: tasks as ActionDetail['tasks'],
    evidence: evidence as EvidenceLinkRow[],
    verifications: verifications as VerificationAttemptRow[],
    timeframes: timeframes as ActionDetail['timeframes'],
    readiness: computeActionReadiness({ ...action, active_evidence_count, latest_verification_result }),
    history,
  };
}

type ActionState = {
  id: string; status: ActionStatus; owner_user_id: string | null; work_completed_at: unknown; work_completed_by: string | null;
  evidence_required: boolean; verification_required: boolean; active_evidence_count: number;
  latest_verification_result: VerificationResult | null;
};

export async function getActionState(viewer: AssuranceViewer, id: string): Promise<ActionState> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Action');
  const rows = (await sql`
    SELECT a.id, a.status, a.owner_user_id, a.work_completed_at, a.work_completed_by, a.evidence_required, a.verification_required,
           (SELECT count(*) FROM assurance_evidence_actions ea
             WHERE ea.organisation_id = a.organisation_id AND ea.action_id = a.id AND ea.removed_at IS NULL)::int AS active_evidence_count,
           (SELECT v.result FROM assurance_verifications v
             WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id
             ORDER BY v.attempt_number DESC LIMIT 1) AS latest_verification_result
    FROM assurance_actions a
    WHERE a.organisation_id = ${viewer.organisationId} AND a.id = ${id}::uuid AND ${actionVisibleSql(viewer)}
  `) as ActionState[];
  if (!rows[0]) throw new AssuranceNotFoundError('Action');
  return rows[0];
}

export async function createAction(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; action_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const input = {
    findingIds: uuidList(raw.findingIds, 'Findings', 20),
    actionType: requiredEnum(ACTION_TYPES, raw.actionType, 'Action type'),
    title: requiredText(raw.title, 'Title', 200),
    description: optionalText(raw.description, 'Description', 8000),
    priority: requiredEnum(ACTION_PRIORITIES, raw.priority ?? 'MEDIUM', 'Priority'),
    ownerUserId: optionalUserId(raw.ownerUserId, 'Owner'),
    responsibleExternalOrganisationId: optionalUuid(raw.responsibleExternalOrganisationId, 'Responsible external organisation'),
    evidenceRequired: optionalBoolean(raw.evidenceRequired, true),
    verificationRequired: optionalBoolean(raw.verificationRequired, true),
    dueAt: optionalDateTime(raw.dueAt, 'Due date'),
  };
  if (input.findingIds.length === 0) throw new AssuranceValidationError('Link the action to at least one finding.');
  if (input.dueAt && new Date(input.dueAt).getTime() < Date.now() - 24 * 3600_000) {
    throw new AssuranceValidationError('Due date cannot be in the past.');
  }

  const [findings] = await Promise.all([
    assertFindingsVisible(viewer, input.findingIds),
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Owner', userId: input.ownerUserId }]),
    assertContextRefsInOrg(viewer.organisationId, { externalOrganisationId: input.responsibleExternalOrganisationId }),
  ]);
  if (findings.some(f => f.status === 'CLOSED' || f.status === 'CANCELLED')) {
    throw new AssuranceConflictError('Actions cannot be added to a closed or cancelled finding.');
  }

  const id = crypto.randomUUID();
  const ids = input.findingIds;
  // Share-lock the findings first (a concurrent finding closure takes FOR
  // UPDATE, so the two serialise); every later statement re-checks that all
  // of them are still open with a fresh snapshot, so the action, its links,
  // timeframe and audit row are written together or not at all.
  const findingsStillOpen = sql`(
    SELECT count(*) FROM assurance_findings f
    WHERE f.organisation_id = ${viewer.organisationId} AND f.id = ANY(${ids}::uuid[]) AND f.status NOT IN ('CLOSED', 'CANCELLED')
  ) = ${ids.length}`;
  return withFreshReference('action', async reference => {
    const statements = [
      sql`SELECT id FROM assurance_findings WHERE organisation_id = ${viewer.organisationId} AND id = ANY(${ids}::uuid[]) FOR SHARE`,
      sql`
        INSERT INTO assurance_actions (
          id, organisation_id, action_reference, action_type, title, description, priority, status, owner_user_id,
          responsible_external_organisation_id, evidence_required, verification_required, created_by
        )
        SELECT ${id}::uuid, ${viewer.organisationId}, ${reference}, ${input.actionType}, ${input.title}, ${input.description},
               ${input.priority}, 'OPEN', ${input.ownerUserId}, ${input.responsibleExternalOrganisationId}::uuid,
               ${input.evidenceRequired}, ${input.verificationRequired}, ${viewer.userId}
        WHERE ${findingsStillOpen}
        RETURNING id
      `,
      ...ids.map(findingId => sql`
        INSERT INTO assurance_action_findings (organisation_id, action_id, finding_id, created_by)
        SELECT ${viewer.organisationId}, ${id}::uuid, ${findingId}::uuid, ${viewer.userId}
        WHERE ${findingsStillOpen}
      `),
    ];
    if (input.dueAt) statements.push(sql`
      INSERT INTO assurance_timeframes (organisation_id, action_id, timeframe_type, original_due_at, current_due_at, created_by)
      SELECT ${viewer.organisationId}, ${id}::uuid, 'ACTION', ${input.dueAt}::timestamptz, ${input.dueAt}::timestamptz, ${viewer.userId}
      WHERE ${findingsStillOpen}
    `);
    statements.push(sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_action.created', 'assurance_action', ${id},
             NULL, ${JSON.stringify({
               action_reference: reference, status: 'OPEN', finding_ids: ids, priority: input.priority,
               evidence_required: input.evidenceRequired, verification_required: input.verificationRequired,
             })}::jsonb
      WHERE ${findingsStillOpen}
    `);
    const results = await sql.transaction(statements);
    if ((results[1] as unknown[]).length === 0) {
      throw new AssuranceConflictError('A linked finding was closed while you were creating this action. Nothing was saved.');
    }
    return { id, action_reference: reference };
  });
}

async function guardedActionUpdate(
  viewer: AssuranceViewer,
  id: string,
  fromStatus: ActionStatus,
  verb: string,
  set: { status: ActionStatus; markWorkComplete?: boolean; close?: boolean },
): Promise<void> {
  // Lock first, then guard with a fresh snapshot (see closeAction()).
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_actions WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid FOR UPDATE`,
    sql`
    WITH upd AS (
      UPDATE assurance_actions
      SET status = ${set.status},
          updated_at = now(),
          work_completed_at = CASE WHEN ${set.markWorkComplete === true}::boolean THEN now() ELSE work_completed_at END,
          work_completed_by = CASE WHEN ${set.markWorkComplete === true}::boolean THEN ${viewer.userId} ELSE work_completed_by END,
          closed_at = CASE WHEN ${set.close === true}::boolean THEN now() ELSE closed_at END,
          closed_by = CASE WHEN ${set.close === true}::boolean THEN ${viewer.userId} ELSE closed_by END
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${fromStatus}
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_action',
        verb, before: { status: fromStatus }, after: { status: set.status },
      })}
    )
    SELECT id FROM upd
  `,
  ]);
  if ((results[1] as unknown[]).length === 0) throw new AssuranceConflictError('This action was changed by someone else. Refresh and try again.');
}

export async function startAction(viewer: AssuranceViewer, id: string): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const a = await getActionState(viewer, id);
  if (a.status !== 'OPEN') throw new AssuranceConflictError('Only an open action can be started.');
  await guardedActionUpdate(viewer, id, a.status, 'started', { status: 'IN_PROGRESS' });
}

/**
 * Marks the corrective WORK complete. This is not verification and not
 * closure. The next status reflects what is still outstanding.
 */
export async function completeActionWork(viewer: AssuranceViewer, id: string): Promise<{ status: ActionStatus }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const a = await getActionState(viewer, id);
  if (a.status !== 'OPEN' && a.status !== 'IN_PROGRESS') {
    throw new AssuranceConflictError('Work can only be marked complete on an open or in-progress action.');
  }
  const next: ActionStatus = a.evidence_required && a.active_evidence_count === 0
    ? 'AWAITING_EVIDENCE'
    : a.verification_required ? 'AWAITING_VERIFICATION' : 'IN_PROGRESS';
  if (a.work_completed_at != null && next === a.status) {
    throw new AssuranceConflictError('Work is already marked complete. The action is ready to close.');
  }
  // work_completed_at/by record the LATEST completion; every completion is
  // also an audit row, and verification independence is checked against all
  // of them (see verifications.ts), so re-completion cannot launder a completer.
  await guardedActionUpdate(viewer, id, a.status, 'work_completed', { status: next, markWorkComplete: true });
  return { status: next };
}

/** AWAITING_EVIDENCE -> AWAITING_VERIFICATION (or IN_PROGRESS) once evidence is linked. */
export async function submitActionEvidence(viewer: AssuranceViewer, id: string): Promise<{ status: ActionStatus }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const a = await getActionState(viewer, id);
  if (a.status !== 'AWAITING_EVIDENCE') throw new AssuranceConflictError('This action is not awaiting evidence.');
  if (a.evidence_required && a.active_evidence_count === 0) {
    throw new AssuranceConflictError('Link at least one piece of evidence first.');
  }
  const next: ActionStatus = a.verification_required ? 'AWAITING_VERIFICATION' : 'IN_PROGRESS';
  await guardedActionUpdate(viewer, id, a.status, 'evidence_submitted', { status: next });
  return { status: next };
}

export async function closeAction(viewer: AssuranceViewer, id: string): Promise<void> {
  if (!viewerCan(viewer, 'close')) throw new AssuranceForbiddenError();
  const a = await getActionState(viewer, id);
  const readiness = computeActionReadiness(a);
  if (!readiness.canClose) throw new AssuranceConflictError(`This action cannot be closed yet. ${readiness.blockers.join(' ')}`);

  // Lock the action row FIRST (evidence link/unlink and verification take
  // the same lock), then re-assert every closure precondition in a second
  // statement, which gets a fresh snapshot once the lock is granted — so a
  // concurrent unlink/verification cannot slip between check and write.
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_actions WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid FOR UPDATE`,
    sql`
    WITH upd AS (
      UPDATE assurance_actions a
      SET status = 'CLOSED', updated_at = now(), closed_at = now(), closed_by = ${viewer.userId}
      WHERE a.organisation_id = ${viewer.organisationId} AND a.id = ${id}::uuid AND a.status = ${a.status}
        AND a.work_completed_at IS NOT NULL
        AND (a.evidence_required = false OR EXISTS (
              SELECT 1 FROM assurance_evidence_actions ea
              WHERE ea.organisation_id = a.organisation_id AND ea.action_id = a.id AND ea.removed_at IS NULL))
        AND (a.verification_required = false OR (
              SELECT v.result FROM assurance_verifications v
              WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id
              ORDER BY v.attempt_number DESC LIMIT 1) IN ('ACCEPTED', 'NOT_APPLICABLE'))
      RETURNING a.id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_action',
        verb: 'closed', before: { status: a.status }, after: { status: 'CLOSED' },
      })}
    )
    SELECT id FROM upd
  `,
  ]);
  if ((results[1] as unknown[]).length === 0) throw new AssuranceConflictError('This action changed while you were closing it. Refresh and try again.');
}

export async function cancelAction(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'close')) throw new AssuranceForbiddenError();
  const reason = requiredText(raw.reason, 'Reason', 2000);
  const a = await getActionState(viewer, id);
  if (a.status === 'CLOSED' || a.status === 'CANCELLED') throw new AssuranceConflictError('This action is already finished.');
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_actions SET status = 'CANCELLED', updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${a.status}
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_action',
        verb: 'cancelled', before: { status: a.status }, after: { status: 'CANCELLED', reason },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This action was changed by someone else. Refresh and try again.');
}

/**
 * Organiser task names/statuses are only shown or linked when the
 * organisation is entitled to Organiser — the same capability every
 * Organiser API enforces (lib/organiser/authorize.ts).
 */
export async function organiserEnabled(organisationId: string): Promise<boolean> {
  return (await checkCapability(organisationId, 'organiser')).allowed;
}

/** Organiser items in the organisation for the task-link picker (id + name only). */
export async function listOrganiserItemOptions(viewer: AssuranceViewer): Promise<{ id: string; label: string }[]> {
  if (!(await organiserEnabled(viewer.organisationId))) return [];
  const rows = (await sql`
    SELECT id, name FROM organiser_items
    WHERE organisation_id = ${viewer.organisationId}
    ORDER BY created_at DESC
    LIMIT 300
  `) as { id: string; name: string }[];
  return rows.map(r => ({ id: r.id, label: r.name }));
}

/** Links an existing Organiser item to an Action. The task's own status never drives the Action. */
export async function linkActionTask(viewer: AssuranceViewer, actionId: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const organiserItemId = requiredUuid(raw.organiserItemId, 'Organiser task');
  const relationshipType = requiredEnum(['IMPLEMENTATION', 'FOLLOW_UP', 'EVIDENCE_COLLECTION', 'OTHER'] as const, raw.relationshipType ?? 'IMPLEMENTATION', 'Relationship');
  const a = await getActionState(viewer, actionId);
  if (a.status === 'CLOSED' || a.status === 'CANCELLED') throw new AssuranceConflictError('Tasks cannot be linked to a finished action.');
  if (!(await organiserEnabled(viewer.organisationId))) throw new AssuranceForbiddenError('Organiser is not enabled for your organisation.');
  const item = (await sql`
    SELECT id FROM organiser_items WHERE organisation_id = ${viewer.organisationId} AND id = ${organiserItemId}::uuid
  `) as unknown[];
  if (item.length === 0) throw new AssuranceValidationError('Organiser task was not found in your organisation.');
  try {
    const rows = (await sql`
      WITH ins AS (
        INSERT INTO assurance_action_tasks (organisation_id, action_id, organiser_item_id, relationship_type, created_by)
        VALUES (${viewer.organisationId}, ${actionId}::uuid, ${organiserItemId}::uuid, ${relationshipType}, ${viewer.userId})
        RETURNING action_id AS id
      ), aud AS (
        ${auditFromCte('ins', {
          organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_action',
          verb: 'task_linked', after: { organiser_item_id: organiserItemId, relationship_type: relationshipType },
        })}
      )
      SELECT id FROM ins
    `) as unknown[];
    if (rows.length === 0) throw new AssuranceConflictError('The task could not be linked.');
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new AssuranceConflictError('That task is already linked.');
    throw err;
  }
}
