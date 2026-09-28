import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { actionVisibleSql, evidenceVisibleSql } from './access';
import type { AssuranceTimestamp } from './sqlHelpers';
import { getActionState } from './actions';
import { VERIFICATION_RESULTS, type ActionStatus, type VerificationResult } from './domain';
import { optionalText, requiredEnum, uuidList } from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Verification = independent confirmation that an Action's corrective
// work genuinely resolved the issue.
//
//   * assurance_verifications is append-only at the DB level (A0.1C
//     trigger). A correction is always a NEW attempt.
//   * Independence: the verifier may not be the Action's owner or the
//     person who marked its work complete.
//   * A verification result never closes anything. ACCEPTED makes the
//     Action eligible for explicit closure; REJECTED sends the work back;
//     MORE_EVIDENCE_REQUIRED returns it to AWAITING_EVIDENCE.

export type VerificationQueueRow = {
  id: string; action_reference: string; title: string; priority: string; status: ActionStatus;
  owner_name: string | null; work_completed_at: AssuranceTimestamp | null; work_completed_by_name: string | null;
  active_evidence_count: number; attempt_count: number; due_at: AssuranceTimestamp | null;
  can_verify: boolean;
};

export type VerificationHistoryRow = {
  id: string; attempt_number: number; result: VerificationResult; verified_at: AssuranceTimestamp; notes: string | null;
  verified_by_name: string | null; action_id: string; action_reference: string; action_title: string; evidence_count: number;
};

export async function listVerificationQueue(viewer: AssuranceViewer): Promise<VerificationQueueRow[]> {
  return (await sql`
    SELECT a.id, a.action_reference, a.title, a.priority, a.status, ou.name AS owner_name, a.work_completed_at,
           wu.name AS work_completed_by_name,
           (SELECT count(*) FROM assurance_evidence_actions ea
             WHERE ea.organisation_id = a.organisation_id AND ea.action_id = a.id AND ea.removed_at IS NULL)::int AS active_evidence_count,
           (SELECT count(*) FROM assurance_verifications v
             WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id)::int AS attempt_count,
           (SELECT t.current_due_at FROM assurance_timeframes t
             WHERE t.organisation_id = a.organisation_id AND t.action_id = a.id AND t.status IN ('ACTIVE', 'OVERDUE')
             ORDER BY t.current_due_at ASC LIMIT 1) AS due_at,
           (COALESCE(a.owner_user_id, '') <> ${viewer.userId} AND COALESCE(a.work_completed_by, '') <> ${viewer.userId}) AS can_verify
    FROM assurance_actions a
    LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
    LEFT JOIN users wu ON wu.id = a.work_completed_by AND wu.organisation_id = a.organisation_id
    WHERE a.organisation_id = ${viewer.organisationId}
      AND a.status = 'AWAITING_VERIFICATION'
      AND ${actionVisibleSql(viewer)}
      AND NOT EXISTS (
        SELECT 1 FROM assurance_verifications v
        WHERE v.organisation_id = a.organisation_id AND v.action_id = a.id
          AND v.attempt_number = (SELECT max(v2.attempt_number) FROM assurance_verifications v2
                                  WHERE v2.organisation_id = a.organisation_id AND v2.action_id = a.id)
          AND v.result IN ('ACCEPTED', 'NOT_APPLICABLE')
      )
    ORDER BY a.work_completed_at ASC NULLS LAST
    LIMIT 200
  `) as VerificationQueueRow[];
}

export async function listRecentVerifications(viewer: AssuranceViewer, limit = 50): Promise<VerificationHistoryRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  return (await sql`
    SELECT v.id, v.attempt_number, v.result, v.verified_at, v.notes, u.name AS verified_by_name,
           a.id AS action_id, a.action_reference, a.title AS action_title,
           (SELECT count(*) FROM assurance_evidence_verifications ev
             WHERE ev.organisation_id = v.organisation_id AND ev.verification_id = v.id AND ev.removed_at IS NULL)::int AS evidence_count
    FROM assurance_verifications v
    JOIN assurance_actions a ON a.organisation_id = v.organisation_id AND a.id = v.action_id
    LEFT JOIN users u ON u.id = v.verified_by AND u.organisation_id = v.organisation_id
    WHERE v.organisation_id = ${viewer.organisationId}
      AND ${actionVisibleSql(viewer)}
    ORDER BY v.verified_at DESC, v.attempt_number DESC
    LIMIT ${capped}
  `) as VerificationHistoryRow[];
}

const NEXT_STATUS: Record<VerificationResult, ActionStatus> = {
  ACCEPTED: 'AWAITING_VERIFICATION',
  NOT_APPLICABLE: 'AWAITING_VERIFICATION',
  PARTIALLY_ACCEPTED: 'IN_PROGRESS',
  REJECTED: 'IN_PROGRESS',
  MORE_EVIDENCE_REQUIRED: 'AWAITING_EVIDENCE',
};

export async function recordVerification(viewer: AssuranceViewer, actionId: string, raw: Record<string, unknown>): Promise<{ id: string; attempt_number: number; action_status: ActionStatus }> {
  if (!viewerCan(viewer, 'verify')) throw new AssuranceForbiddenError();
  const result = requiredEnum(VERIFICATION_RESULTS, raw.result, 'Result');
  const notes = optionalText(raw.notes, 'Notes', 4000);
  const evidenceIds = uuidList(raw.evidenceIds, 'Evidence', 20);
  if (result !== 'ACCEPTED' && !notes) throw new AssuranceValidationError('Explain the verification result in the notes.');

  const a = await getActionState(viewer, actionId);
  if (a.status !== 'AWAITING_VERIFICATION') throw new AssuranceConflictError('This action is not awaiting verification.');
  if (a.owner_user_id === viewer.userId || a.work_completed_by === viewer.userId) {
    throw new AssuranceForbiddenError('Verification must be independent: the action owner or the person who completed the work cannot verify it.');
  }
  if (a.latest_verification_result === 'ACCEPTED' || a.latest_verification_result === 'NOT_APPLICABLE') {
    throw new AssuranceConflictError('This action has already been verified. Close it, or record a new attempt only after further work.');
  }

  if (evidenceIds.length > 0) {
    const ok = (await sql`
      SELECT e.id FROM assurance_evidence e
      WHERE e.organisation_id = ${viewer.organisationId} AND e.id = ANY(${evidenceIds}::uuid[]) AND ${evidenceVisibleSql(viewer)}
    `) as unknown[];
    if (ok.length !== evidenceIds.length) throw new AssuranceNotFoundError('Evidence');
  }

  const verificationId = crypto.randomUUID();
  const nextStatus = NEXT_STATUS[result];
  try {
    const rows = (await sql`
      WITH act AS (
        SELECT a.id, a.organisation_id, a.status
        FROM assurance_actions a
        WHERE a.organisation_id = ${viewer.organisationId} AND a.id = ${actionId}::uuid AND a.status = 'AWAITING_VERIFICATION'
        FOR UPDATE
      ), ins AS (
        INSERT INTO assurance_verifications (id, organisation_id, action_id, attempt_number, result, verified_by, verified_at, notes)
        SELECT ${verificationId}::uuid, act.organisation_id, act.id,
               COALESCE((SELECT max(v.attempt_number) FROM assurance_verifications v
                          WHERE v.organisation_id = act.organisation_id AND v.action_id = act.id), 0) + 1,
               ${result}, ${viewer.userId}, now(), ${notes}
        FROM act
        RETURNING id, action_id, attempt_number
      ), ev AS (
        INSERT INTO assurance_evidence_verifications (organisation_id, evidence_id, verification_id, purpose, created_by)
        SELECT ${viewer.organisationId}, e_id, ins.id, 'Verification evidence', ${viewer.userId}
        FROM ins, unnest(${evidenceIds}::uuid[]) AS e_id
      ), upd AS (
        UPDATE assurance_actions a
        SET status = ${nextStatus}, updated_at = now()
        FROM ins
        WHERE a.organisation_id = ${viewer.organisationId} AND a.id = ins.action_id AND a.status <> ${nextStatus}
        RETURNING a.id
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_action.verification_recorded',
               'assurance_action', ins.action_id::text, jsonb_build_object('status', 'AWAITING_VERIFICATION'),
               jsonb_build_object('verification_id', ins.id, 'attempt_number', ins.attempt_number, 'result', ${result}::text,
                                  'status', ${nextStatus}::text, 'evidence_count', ${evidenceIds.length}::int)
        FROM ins
      )
      SELECT id, attempt_number FROM ins
    `) as { id: string; attempt_number: number }[];
    if (!rows[0]) throw new AssuranceConflictError('This action is no longer awaiting verification.');
    return { id: rows[0].id, attempt_number: rows[0].attempt_number, action_status: nextStatus };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AssuranceConflictError('Another verification was recorded at the same time. Refresh and try again.');
    }
    throw err;
  }
}
