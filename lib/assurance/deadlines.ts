import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { actionVisibleSql, findingVisibleSql } from './access';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';
import { isUuid, optionalDateTime, optionalText, optionalUserId, requiredDateTime, requiredText } from './input';
import { assertSameOrgUsers } from './users';
import { dueSoonCutoffSql, timeframeRunningSql } from './deadlineSql';
import type { AssuranceTimestamp } from './sqlHelpers';
import {
  DEADLINE_REASON_MAX, ESCALATION_LEVEL_MAX, ESCALATION_TRANSITIONS, safeTimeZone,
  type EscalationTransition,
} from './deadlineRules';

// BrainBase Assurance — Deadlines: the operational workflow over the
// EXISTING A0.1C timeframe model (no schema change).
//
//   * A timeframe belongs to exactly one finding / action (cases have no
//     creator in the product today and are not listed). Visibility follows
//     the parent record (restricted findings/actions stay hidden).
//   * original_due_at is never written (DB trigger enforces it). The only
//     write to a timeframe is current_due_at, and only when an extension is
//     APPROVED. Timeframe status is never changed here (no code changes it
//     today; "overdue" is derived from current_due_at).
//   * Extensions: PENDING → APPROVED | REJECTED | CANCELLED. One PENDING
//     request per timeframe. A request must move the deadline LATER. The
//     requester cannot decide their own request. Approval is refused if the
//     deadline changed since the request (previous_due_at must still match).
//   * Escalations: manual only. OPEN → ACKNOWLEDGED → RESOLVED;
//     OPEN/ACKNOWLEDGED → CANCELLED. No transition touches the timeframe,
//     the finding or the action.
//   * Every mutation: permission → tenant + visibility (foreign / hidden ids
//     are "not found") → validation → sql.transaction([lock the timeframe
//     row, one guarded statement that writes the change AND its audit row]).
//     The lock is a separate statement so the guarded statement's snapshot
//     sees anything committed by a request that held the lock before it.
//   * Audit payloads carry ids, references, dates and statuses only — never
//     the free-text reason or notes (those live on the history rows).

// ── Shared fragments ─────────────────────────────────────────────────────

/** Joins + visibility for a timeframe aliased t (findings f, actions a). */
function parentJoinsSql() {
  return sql`
    LEFT JOIN assurance_findings f ON f.organisation_id = t.organisation_id AND f.id = t.finding_id
    LEFT JOIN assurance_actions a ON a.organisation_id = t.organisation_id AND a.id = t.action_id`;
}
function parentVisibleSql(viewer: AssuranceViewer) {
  return sql`(
    (t.finding_id IS NOT NULL AND ${findingVisibleSql(viewer, 'f')})
    OR (t.action_id IS NOT NULL AND ${actionVisibleSql(viewer, 'a')})
  )`;
}
/** The timeframe is still running and its finding/action is still open. */
const openSql = () => sql`(${timeframeRunningSql('t')} AND coalesce(f.status, a.status) NOT IN ('CLOSED', 'CANCELLED'))`;

/**
 * Display timezone for Assurance deadline dates: BrainBase's established
 * explicit Australia/Adelaide convention (as lib/dashboard/greeting.ts), so
 * dates never render in the server's UTC. A per-organisation canonical
 * timezone exists only as Platform Phase F.2A schema preparation and is
 * deliberately not consumed by application code yet; this function is the
 * single seam to switch over when that phase wires it in.
 */
export async function getAssuranceTimeZone(organisationId: string): Promise<string> {
  void organisationId;
  return safeTimeZone(null);
}

// ── Reads ────────────────────────────────────────────────────────────────

export type DeadlineView = 'open' | 'overdue' | 'due_soon' | 'extended' | 'escalated' | 'pending' | 'all';

export type DeadlineFilters = { view?: DeadlineView; kind?: 'finding' | 'action'; timeframeType?: string; q?: string };

export type DeadlineRow = {
  id: string;
  timeframe_type: string;
  status: string;
  original_due_at: AssuranceTimestamp;
  current_due_at: AssuranceTimestamp;
  record_kind: 'finding' | 'action';
  record_id: string;
  record_reference: string;
  record_title: string;
  record_status: string;
  owner_name: string | null;
  open: boolean;
  overdue: boolean;
  due_soon: boolean;
  extended: boolean;
  pending_extension: boolean;
  approved_extensions: number;
  open_escalations: number;
  top_open_escalation_level: number | null;
};

export async function listDeadlines(viewer: AssuranceViewer, filters: DeadlineFilters = {}): Promise<DeadlineRow[]> {
  const view: DeadlineView = filters.view ?? 'open';
  const kind = filters.kind === 'finding' || filters.kind === 'action' ? filters.kind : null;
  const type = typeof filters.timeframeType === 'string' && /^[A-Z_]{1,20}$/.test(filters.timeframeType) ? filters.timeframeType : null;
  const q = typeof filters.q === 'string' && filters.q.trim() ? `%${filters.q.trim().replace(/[\\%_]/g, '\\$&').slice(0, 100)}%` : null;
  const rows = (await sql`
    WITH d AS (
      SELECT t.id, t.timeframe_type, t.status, t.original_due_at, t.current_due_at,
             CASE WHEN t.finding_id IS NOT NULL THEN 'finding' ELSE 'action' END AS record_kind,
             coalesce(f.id, a.id)::text AS record_id,
             coalesce(f.finding_reference, a.action_reference) AS record_reference,
             coalesce(f.title, a.title) AS record_title,
             coalesce(f.status, a.status) AS record_status,
             coalesce(ru.name, ou.name) AS owner_name,
             ${openSql()} AS open,
             (t.original_due_at <> t.current_due_at) AS extended,
             EXISTS (SELECT 1 FROM assurance_timeframe_extensions x
                     WHERE x.organisation_id = t.organisation_id AND x.timeframe_id = t.id AND x.status = 'PENDING') AS pending_extension,
             (SELECT count(*) FROM assurance_timeframe_extensions x
               WHERE x.organisation_id = t.organisation_id AND x.timeframe_id = t.id AND x.status = 'APPROVED')::int AS approved_extensions,
             (SELECT count(*) FROM assurance_escalations e
               WHERE e.organisation_id = t.organisation_id AND e.timeframe_id = t.id AND e.status IN ('OPEN', 'ACKNOWLEDGED'))::int AS open_escalations,
             (SELECT max(e.escalation_level) FROM assurance_escalations e
               WHERE e.organisation_id = t.organisation_id AND e.timeframe_id = t.id AND e.status IN ('OPEN', 'ACKNOWLEDGED')) AS top_open_escalation_level
      FROM assurance_timeframes t
      ${parentJoinsSql()}
      LEFT JOIN users ru ON ru.id = f.responsible_user_id AND ru.organisation_id = f.organisation_id
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE t.organisation_id = ${viewer.organisationId}
        AND t.case_id IS NULL
        AND ${parentVisibleSql(viewer)}
        AND (${kind}::text IS NULL OR (${kind}::text = 'finding') = (t.finding_id IS NOT NULL))
        AND (${type}::text IS NULL OR t.timeframe_type = ${type})
        AND (${q}::text IS NULL OR coalesce(f.finding_reference, a.action_reference) ILIKE ${q} OR coalesce(f.title, a.title) ILIKE ${q})
    )
    SELECT d.*, (d.open AND d.current_due_at < now()) AS overdue,
           (d.open AND d.current_due_at >= now() AND d.current_due_at < ${dueSoonCutoffSql()}) AS due_soon
    FROM d
    WHERE CASE ${view}::text
      WHEN 'all' THEN true
      WHEN 'open' THEN d.open
      WHEN 'overdue' THEN d.open AND d.current_due_at < now()
      WHEN 'due_soon' THEN d.open AND d.current_due_at >= now() AND d.current_due_at < ${dueSoonCutoffSql()}
      WHEN 'extended' THEN d.extended
      WHEN 'escalated' THEN d.open_escalations > 0
      WHEN 'pending' THEN d.pending_extension
      ELSE d.open END
    ORDER BY d.open DESC, d.current_due_at ASC, d.record_reference ASC
    LIMIT 500
  `) as DeadlineRow[];
  return rows;
}

export type ExtensionHistoryRow = {
  id: string; status: string; reason: string; requested_due_at: AssuranceTimestamp; previous_due_at: AssuranceTimestamp;
  approved_due_at: AssuranceTimestamp | null; requested_at: AssuranceTimestamp; requested_by: string | null; requested_by_name: string | null;
  decided_at: AssuranceTimestamp | null; decided_by_name: string | null; decision_notes: string | null;
};
export type EscalationRow = {
  id: string; escalation_level: number; reason: string; status: string; escalated_at: AssuranceTimestamp; escalated_by_name: string | null;
  assigned_user_name: string | null; acknowledged_at: AssuranceTimestamp | null; acknowledged_by_name: string | null;
  resolved_at: AssuranceTimestamp | null; resolved_by_name: string | null; notes: string | null; updated_at: AssuranceTimestamp;
};
export type RecordTimeframe = {
  id: string; timeframe_type: string; status: string; original_due_at: AssuranceTimestamp; current_due_at: AssuranceTimestamp;
  open: boolean; extensions: ExtensionHistoryRow[]; escalations: EscalationRow[];
};

/** Every timeframe of one visible finding or action, with full extension and escalation history. */
export async function listRecordTimeframes(viewer: AssuranceViewer, kind: 'finding' | 'action', recordId: string): Promise<RecordTimeframe[]> {
  if (!isUuid(recordId)) return [];
  return (await sql`
    SELECT t.id, t.timeframe_type, t.status, t.original_due_at, t.current_due_at, ${openSql()} AS open,
           coalesce((
             SELECT json_agg(json_build_object(
               'id', x.id, 'status', x.status, 'reason', x.reason, 'requested_due_at', x.requested_due_at,
               'previous_due_at', x.previous_due_at, 'approved_due_at', x.approved_due_at, 'requested_at', x.requested_at,
               'requested_by', x.requested_by, 'requested_by_name', xu.name, 'decided_at', x.decided_at,
               'decided_by_name', xd.name, 'decision_notes', x.decision_notes) ORDER BY x.requested_at DESC, x.id)
             FROM assurance_timeframe_extensions x
             LEFT JOIN users xu ON xu.id = x.requested_by AND xu.organisation_id = x.organisation_id
             LEFT JOIN users xd ON xd.id = x.decided_by AND xd.organisation_id = x.organisation_id
             WHERE x.organisation_id = t.organisation_id AND x.timeframe_id = t.id
           ), '[]'::json) AS extensions,
           coalesce((
             SELECT json_agg(json_build_object(
               'id', e.id, 'escalation_level', e.escalation_level, 'reason', e.reason, 'status', e.status,
               'escalated_at', e.escalated_at, 'escalated_by_name', eb.name, 'assigned_user_name', ea.name,
               'acknowledged_at', e.acknowledged_at, 'acknowledged_by_name', ek.name,
               'resolved_at', e.resolved_at, 'resolved_by_name', er.name, 'notes', e.notes, 'updated_at', e.updated_at)
               ORDER BY e.escalated_at DESC, e.id)
             FROM assurance_escalations e
             LEFT JOIN users eb ON eb.id = e.escalated_by AND eb.organisation_id = e.organisation_id
             LEFT JOIN users ea ON ea.id = e.assigned_user_id AND ea.organisation_id = e.organisation_id
             LEFT JOIN users ek ON ek.id = e.acknowledged_by AND ek.organisation_id = e.organisation_id
             LEFT JOIN users er ON er.id = e.resolved_by AND er.organisation_id = e.organisation_id
             WHERE e.organisation_id = t.organisation_id AND e.timeframe_id = t.id
           ), '[]'::json) AS escalations
    FROM assurance_timeframes t
    ${parentJoinsSql()}
    WHERE t.organisation_id = ${viewer.organisationId}
      AND ${kind === 'finding' ? sql`t.finding_id = ${recordId}::uuid` : sql`t.action_id = ${recordId}::uuid`}
      AND ${parentVisibleSql(viewer)}
    ORDER BY t.created_at ASC
  `) as RecordTimeframe[];
}

// ── Mutation helpers ─────────────────────────────────────────────────────

type TimeframeState = {
  id: string; current_due_at: string; original_due_at: string; open: boolean; timeframe_type: string;
  record_kind: 'finding' | 'action'; record_reference: string;
};

/** A visible timeframe of the viewer's organisation, else "not found" (never reveals foreign/hidden ids). */
async function timeframeState(viewer: AssuranceViewer, id: string): Promise<TimeframeState> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Deadline');
  const [row] = (await sql`
    SELECT t.id, t.current_due_at, t.original_due_at, t.timeframe_type, ${openSql()} AS open,
           CASE WHEN t.finding_id IS NOT NULL THEN 'finding' ELSE 'action' END AS record_kind,
           coalesce(f.finding_reference, a.action_reference) AS record_reference
    FROM assurance_timeframes t
    ${parentJoinsSql()}
    WHERE t.organisation_id = ${viewer.organisationId} AND t.id = ${id}::uuid AND t.case_id IS NULL
      AND ${parentVisibleSql(viewer)}
  `) as TimeframeState[];
  if (!row) throw new AssuranceNotFoundError('Deadline');
  return row;
}

const lockTimeframe = (organisationId: string, id: string) =>
  sql`SELECT id FROM assurance_timeframes WHERE organisation_id = ${organisationId} AND id = ${id}::uuid FOR UPDATE`;

function laterThan(candidate: string, current: string | Date): boolean {
  return new Date(candidate).getTime() > new Date(current).getTime();
}

/** Audit JSON for a timeframe-level event (ids, references, dates and statuses only). */
function timeframeAuditJson(tf: TimeframeState, extra: Record<string, unknown>) {
  return JSON.stringify({
    timeframe_id: tf.id, record_type: tf.record_kind, record_reference: tf.record_reference, timeframe_type: tf.timeframe_type,
    original_due_at: new Date(tf.original_due_at).toISOString(), ...extra,
  });
}

// ── Extensions ───────────────────────────────────────────────────────────

/** Request a later deadline. Leaves the effective due date unchanged until approved. */
export async function requestExtension(viewer: AssuranceViewer, timeframeId: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError('Only managers and admins can request an extension.');
  const tf = await timeframeState(viewer, timeframeId);
  const requested = requiredDateTime(raw.requestedDueAt, 'New due date');
  const reason = requiredText(raw.reason, 'Reason', DEADLINE_REASON_MAX);
  if (!tf.open) throw new AssuranceConflictError('This deadline is no longer open, so it cannot be extended.');
  if (!laterThan(requested, tf.current_due_at)) throw new AssuranceValidationError('The new due date must be later than the current due date.');
  if (!laterThan(requested, new Date())) throw new AssuranceValidationError('The new due date must be in the future.');

  const org = viewer.organisationId;
  const [, rows] = await sql.transaction([
    lockTimeframe(org, tf.id),
    sql`
      WITH t AS (
        SELECT t.id, t.current_due_at FROM assurance_timeframes t
        WHERE t.organisation_id = ${org} AND t.id = ${tf.id}::uuid AND t.current_due_at = ${tf.current_due_at}::timestamptz
          AND ${timeframeRunningSql('t')}
          AND NOT EXISTS (SELECT 1 FROM assurance_timeframe_extensions p
                          WHERE p.organisation_id = t.organisation_id AND p.timeframe_id = t.id AND p.status = 'PENDING')
      ), ins AS (
        INSERT INTO assurance_timeframe_extensions (organisation_id, timeframe_id, requested_due_at, reason, requested_by, previous_due_at)
        SELECT ${org}, t.id, ${requested}::timestamptz, ${reason}, ${viewer.userId}, t.current_due_at FROM t
        WHERE ${requested}::timestamptz > t.current_due_at
        RETURNING id, previous_due_at, requested_due_at
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_timeframe.extension_requested', 'assurance_timeframe', ${tf.id},
               jsonb_build_object('current_due_at', ins.previous_due_at),
               ${timeframeAuditJson(tf, {})}::jsonb || jsonb_build_object('extension_id', ins.id, 'status', 'PENDING',
                 'previous_due_at', ins.previous_due_at, 'requested_due_at', ins.requested_due_at, 'current_due_at', ins.previous_due_at)
        FROM ins
      )
      SELECT id FROM ins
    `,
  ]);
  const created = (rows as { id: string }[])[0];
  if (!created) {
    const pending = (await sql`SELECT 1 FROM assurance_timeframe_extensions WHERE organisation_id = ${org} AND timeframe_id = ${tf.id}::uuid AND status = 'PENDING'`) as unknown[];
    if (pending.length > 0) throw new AssuranceConflictError('An extension request is already waiting for a decision on this deadline.');
    throw new AssuranceConflictError('This deadline changed while you were requesting. Refresh and try again.');
  }
  return created;
}

type ExtensionState = { id: string; timeframe_id: string; status: string; requested_by: string | null; requested_due_at: string; previous_due_at: string };

async function extensionState(viewer: AssuranceViewer, id: string): Promise<{ ext: ExtensionState; tf: TimeframeState }> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Extension request');
  const [ext] = (await sql`
    SELECT id, timeframe_id, status, requested_by, requested_due_at, previous_due_at
    FROM assurance_timeframe_extensions WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid
  `) as ExtensionState[];
  if (!ext) throw new AssuranceNotFoundError('Extension request');
  let tf: TimeframeState;
  try { tf = await timeframeState(viewer, ext.timeframe_id); } catch { throw new AssuranceNotFoundError('Extension request'); }
  return { ext, tf };
}

/**
 * Approve or reject a PENDING request. Approval moves current_due_at to the
 * approved date (the request's, or a different later date the approver
 * chooses); original_due_at is never touched. Rejection changes nothing but
 * the request. The requester may not decide their own request.
 */
export async function decideExtension(
  viewer: AssuranceViewer, extensionId: string, raw: Record<string, unknown>, decision: 'approve' | 'reject',
): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can decide extension requests.');
  const { ext, tf } = await extensionState(viewer, extensionId);
  if (ext.status !== 'PENDING') throw new AssuranceConflictError(`This request has already been ${ext.status.toLowerCase()}.`);
  if (ext.requested_by && ext.requested_by === viewer.userId) {
    throw new AssuranceForbiddenError('You cannot decide your own extension request. Another admin must decide it.');
  }
  const org = viewer.organisationId;

  if (decision === 'reject') {
    const notes = requiredText(raw.notes, 'Reason for rejecting', DEADLINE_REASON_MAX);
    const [, rows] = await sql.transaction([
      lockTimeframe(org, tf.id),
      sql`
        WITH x AS (
          UPDATE assurance_timeframe_extensions e
          SET status = 'REJECTED', decided_by = ${viewer.userId}, decided_at = now(), decision_notes = ${notes}
          WHERE e.organisation_id = ${org} AND e.id = ${ext.id}::uuid AND e.status = 'PENDING'
          RETURNING e.id, e.previous_due_at, e.requested_due_at
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_timeframe.extension_rejected', 'assurance_timeframe', ${tf.id},
                 jsonb_build_object('extension_status', 'PENDING', 'current_due_at', t.current_due_at),
                 ${timeframeAuditJson(tf, {})}::jsonb || jsonb_build_object('extension_id', x.id, 'status', 'REJECTED',
                   'requested_due_at', x.requested_due_at, 'previous_due_at', t.current_due_at, 'current_due_at', t.current_due_at)
          FROM x JOIN assurance_timeframes t ON t.organisation_id = ${org} AND t.id = ${tf.id}::uuid
        )
        SELECT id FROM x
      `,
    ]);
    const done = (rows as { id: string }[])[0];
    if (!done) throw new AssuranceConflictError('This request was decided by someone else. Refresh to see the outcome.');
    return done;
  }

  const notes = optionalText(raw.notes, 'Notes', DEADLINE_REASON_MAX);
  const approved = optionalDateTime(raw.approvedDueAt, 'Approved due date') ?? new Date(ext.requested_due_at).toISOString();
  if (!tf.open) throw new AssuranceConflictError('This deadline is no longer open, so the extension cannot be approved. Reject or leave it.');
  if (new Date(tf.current_due_at).getTime() !== new Date(ext.previous_due_at).getTime()) {
    throw new AssuranceConflictError('The deadline has changed since this request was made. Reject it and ask for a new request.');
  }
  if (!laterThan(approved, tf.current_due_at)) throw new AssuranceValidationError('The approved due date must be later than the current due date.');

  const [, rows] = await sql.transaction([
    lockTimeframe(org, tf.id),
    sql`
      WITH x AS (
        UPDATE assurance_timeframe_extensions e
        SET status = 'APPROVED', decided_by = ${viewer.userId}, decided_at = now(), decision_notes = ${notes}, approved_due_at = ${approved}::timestamptz
        FROM assurance_timeframes t
        WHERE e.organisation_id = ${org} AND e.id = ${ext.id}::uuid AND e.status = 'PENDING'
          AND t.organisation_id = e.organisation_id AND t.id = e.timeframe_id
          AND t.current_due_at = e.previous_due_at AND ${timeframeRunningSql('t')}
          AND ${approved}::timestamptz > t.current_due_at
        RETURNING e.id, e.timeframe_id, e.previous_due_at, e.requested_due_at, e.approved_due_at
      ), tf AS (
        UPDATE assurance_timeframes t SET current_due_at = x.approved_due_at, updated_at = now()
        FROM x WHERE t.organisation_id = ${org} AND t.id = x.timeframe_id
        RETURNING t.id, t.current_due_at
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_timeframe.extension_approved', 'assurance_timeframe', ${tf.id},
               jsonb_build_object('extension_status', 'PENDING', 'current_due_at', x.previous_due_at),
               ${timeframeAuditJson(tf, {})}::jsonb || jsonb_build_object('extension_id', x.id, 'status', 'APPROVED',
                 'requested_due_at', x.requested_due_at, 'previous_due_at', x.previous_due_at,
                 'approved_due_at', x.approved_due_at, 'current_due_at', tf.current_due_at)
        FROM x, tf
      )
      SELECT id FROM x
    `,
  ]);
  const done = (rows as { id: string }[])[0];
  if (!done) throw new AssuranceConflictError('This request or its deadline changed while you were deciding. Refresh and try again.');
  return done;
}

/** Withdraw a PENDING request: the requester, or an organisation admin. */
export async function cancelExtension(viewer: AssuranceViewer, extensionId: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const { ext, tf } = await extensionState(viewer, extensionId);
  if (ext.requested_by !== viewer.userId && !viewerCan(viewer, 'administer')) {
    throw new AssuranceForbiddenError('Only the person who asked for this extension, or an organisation admin, can withdraw it.');
  }
  if (ext.status !== 'PENDING') throw new AssuranceConflictError(`This request has already been ${ext.status.toLowerCase()}.`);
  const notes = optionalText(raw.notes, 'Notes', DEADLINE_REASON_MAX);
  const org = viewer.organisationId;
  const [, rows] = await sql.transaction([
    lockTimeframe(org, tf.id),
    sql`
      WITH x AS (
        UPDATE assurance_timeframe_extensions e
        SET status = 'CANCELLED', decided_by = ${viewer.userId}, decided_at = now(), decision_notes = ${notes}
        WHERE e.organisation_id = ${org} AND e.id = ${ext.id}::uuid AND e.status = 'PENDING'
        RETURNING e.id, e.requested_due_at
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_timeframe.extension_cancelled', 'assurance_timeframe', ${tf.id},
               jsonb_build_object('extension_status', 'PENDING'),
               ${timeframeAuditJson(tf, {})}::jsonb || jsonb_build_object('extension_id', x.id, 'status', 'CANCELLED', 'requested_due_at', x.requested_due_at,
                 'current_due_at', t.current_due_at)
        FROM x JOIN assurance_timeframes t ON t.organisation_id = ${org} AND t.id = ${tf.id}::uuid
      )
      SELECT id FROM x
    `,
  ]);
  const done = (rows as { id: string }[])[0];
  if (!done) throw new AssuranceConflictError('This request was decided by someone else. Refresh to see the outcome.');
  return done;
}

// ── Escalations ──────────────────────────────────────────────────────────

function parseLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > ESCALATION_LEVEL_MAX) {
    throw new AssuranceValidationError(`Escalation level must be a whole number from 1 to ${ESCALATION_LEVEL_MAX}.`);
  }
  return n;
}

/** Manually escalate an open deadline. Changes nothing about the deadline or its record. */
export async function raiseEscalation(viewer: AssuranceViewer, timeframeId: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError('Only managers and admins can escalate a deadline.');
  const tf = await timeframeState(viewer, timeframeId);
  const level = parseLevel(raw.level);
  const reason = requiredText(raw.reason, 'Reason', DEADLINE_REASON_MAX);
  const assignedUserId = optionalUserId(raw.assignedUserId, 'Assigned to');
  await assertSameOrgUsers(viewer.organisationId, [{ field: 'Assigned to', userId: assignedUserId }]);
  if (!tf.open) throw new AssuranceConflictError('This deadline is no longer open, so it cannot be escalated.');
  const org = viewer.organisationId;
  const [, rows] = await sql.transaction([
    lockTimeframe(org, tf.id),
    sql`
      WITH t AS (
        SELECT t.id FROM assurance_timeframes t WHERE t.organisation_id = ${org} AND t.id = ${tf.id}::uuid AND ${timeframeRunningSql('t')}
      ), ins AS (
        INSERT INTO assurance_escalations (organisation_id, timeframe_id, escalation_level, reason, escalated_by, assigned_user_id)
        SELECT ${org}, t.id, ${level}, ${reason}, ${viewer.userId}, ${assignedUserId} FROM t
        RETURNING id, escalation_level, status, assigned_user_id
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_escalation.created', 'assurance_escalation', ins.id::text, NULL,
               ${timeframeAuditJson(tf, { current_due_at: new Date(tf.current_due_at).toISOString() })}::jsonb
                 || jsonb_build_object('escalation_id', ins.id, 'level', ins.escalation_level, 'status', ins.status, 'assigned_user_id', ins.assigned_user_id)
        FROM ins
      )
      SELECT id FROM ins
    `,
  ]);
  const created = (rows as { id: string }[])[0];
  if (!created) throw new AssuranceConflictError('This deadline changed while you were escalating. Refresh and try again.');
  return created;
}

/**
 * Acknowledge, resolve or cancel an escalation. Only the listed
 * transitions are allowed; none of them touches the deadline, the finding
 * or the action. Cancelling needs a reason. The write applies only if the
 * escalation is still in the status the caller saw, so a concurrent change
 * is reported ("updated by someone else"), never silently built upon.
 */
export async function transitionEscalation(
  viewer: AssuranceViewer, escalationId: string, raw: Record<string, unknown>, transition: EscalationTransition,
): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError('Only managers and admins can update an escalation.');
  if (!isUuid(escalationId)) throw new AssuranceNotFoundError('Escalation');
  const [esc] = (await sql`
    SELECT id, timeframe_id, status, escalation_level FROM assurance_escalations
    WHERE organisation_id = ${viewer.organisationId} AND id = ${escalationId}::uuid
  `) as { id: string; timeframe_id: string; status: string; escalation_level: number }[];
  if (!esc) throw new AssuranceNotFoundError('Escalation');
  let tf: TimeframeState;
  try { tf = await timeframeState(viewer, esc.timeframe_id); } catch { throw new AssuranceNotFoundError('Escalation'); }
  const rule = ESCALATION_TRANSITIONS[transition];
  if (!rule.from.includes(esc.status as never)) {
    throw new AssuranceConflictError(`An escalation that is ${esc.status.toLowerCase()} cannot be ${transition === 'acknowledge' ? 'acknowledged' : transition === 'resolve' ? 'resolved' : 'cancelled'}.`);
  }
  const notes = transition === 'cancel'
    ? requiredText(raw.notes, 'Reason for cancelling', DEADLINE_REASON_MAX)
    : optionalText(raw.notes, 'Notes', DEADLINE_REASON_MAX);
  const org = viewer.organisationId;
  const [, rows] = await sql.transaction([
    lockTimeframe(org, tf.id),
    sql`
      WITH upd AS (
        UPDATE assurance_escalations e
        SET status = ${rule.to}::text,
            acknowledged_at = CASE WHEN ${transition}::text = 'acknowledge' THEN now() ELSE e.acknowledged_at END,
            acknowledged_by = CASE WHEN ${transition}::text = 'acknowledge' THEN ${viewer.userId}::text ELSE e.acknowledged_by END,
            resolved_at = CASE WHEN ${transition}::text = 'resolve' THEN now() ELSE e.resolved_at END,
            resolved_by = CASE WHEN ${transition}::text = 'resolve' THEN ${viewer.userId}::text ELSE e.resolved_by END,
            notes = coalesce(${notes}::text, e.notes),
            updated_at = now()
        WHERE e.organisation_id = ${org} AND e.id = ${esc.id}::uuid AND e.status = ${esc.status}::text
        RETURNING e.id, e.escalation_level, e.status
      ), aud AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, ${`assurance_escalation.${rule.to === 'ACKNOWLEDGED' ? 'acknowledged' : rule.to === 'RESOLVED' ? 'resolved' : 'cancelled'}`},
               'assurance_escalation', upd.id::text,
               jsonb_build_object('status', ${esc.status}::text),
               ${timeframeAuditJson(tf, {})}::jsonb || jsonb_build_object('escalation_id', upd.id, 'level', upd.escalation_level, 'status', upd.status)
        FROM upd
      )
      SELECT id FROM upd
    `,
  ]);
  const done = (rows as { id: string }[])[0];
  if (!done) throw new AssuranceConflictError('This escalation was updated by someone else. Refresh to see its current status.');
  return done;
}
