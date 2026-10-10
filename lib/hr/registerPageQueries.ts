import 'server-only';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import { HR_REGISTER_PAGE_SIZE, validateRegisterPagination, type RegisterKind, type RegisterQuery } from './registerPaging';

// These fixed SQL statements reproduce the canonical lifecycle/document scope.
// Every caller-supplied value is a parameter; no query input becomes SQL syntax.
const authorised = `SELECT w.id AS workflow_id, w.person_id, w.lifecycle_type, w.started_at,
      p.first_name, p.last_name,
      ($3 OR EXISTS (SELECT 1 FROM hr_administrators a WHERE a.organisation_id=w.organisation_id AND a.user_id=$2)) AS privileged,
      (p.linked_user_id=$2) AS employee, (manager.linked_user_id=$2) AS manager
    FROM hr_lifecycle_workflows w
    JOIN hr_people p ON p.organisation_id=w.organisation_id AND p.id=w.person_id
    LEFT JOIN hr_people manager ON manager.organisation_id=p.organisation_id AND manager.id=p.manager_person_id
    WHERE w.organisation_id=$1 AND w.status='ACTIVE'
      AND ($3 OR EXISTS (SELECT 1 FROM hr_administrators a WHERE a.organisation_id=w.organisation_id AND a.user_id=$2)
        OR p.linked_user_id=$2 OR manager.linked_user_id=$2)`;
const visible = `SELECT t.id AS task_id, w.workflow_id, w.person_id, w.lifecycle_type, w.first_name, w.last_name,
      t.title, t.status, t.due_at, COALESCE(t.due_at < $4::timestamptz, false) AS overdue
    FROM authorised w JOIN hr_lifecycle_workflows source ON source.id=w.workflow_id AND source.organisation_id=$1
    JOIN hr_lifecycle_tasks t ON t.organisation_id=source.organisation_id AND t.workflow_id=source.id
      AND t.person_id=source.person_id AND t.template_id=source.template_id
    WHERE w.privileged OR (t.internal_only=false AND ((t.employee_visible=true AND w.employee) OR (t.manager_visible=true AND w.manager)))`;
const documentRows = `
    SELECT p.id::text AS person_id, p.first_name, p.last_name,
      COUNT(d.id)::int AS documents,
      COUNT(d.id) FILTER (WHERE v.id IS NULL)::int AS missing_version,
      COUNT(v.id) FILTER (WHERE p.linked_user_id IS NOT NULL AND a.acknowledged_at IS NULL)::int AS pending_acknowledgement,
      COUNT(v.id) FILTER (WHERE p.linked_user_id IS NULL)::int AS unlinked_employee,
      COUNT(v.id) FILTER (WHERE verification.decision IS NULL)::int AS pending_verification,
      COUNT(v.id) FILTER (WHERE verification.decision = 'REJECTED')::int AS rejected,
      COUNT(v.id) FILTER (WHERE v.expires_at < $4::date)::int AS expired,
      COUNT(v.id) FILTER (WHERE v.expires_at >= $4::date AND v.expires_at <= $5::date)::int AS expiring_soon
    FROM hr_people p
    JOIN hr_employee_documents d ON d.organisation_id = p.organisation_id AND d.person_id = p.id AND d.deleted_at IS NULL
    LEFT JOIN hr_employee_document_versions v ON v.organisation_id = d.organisation_id AND v.document_id = d.id AND v.is_current = TRUE
    LEFT JOIN LATERAL (
      SELECT acknowledgement.acknowledged_at
      FROM hr_employee_document_acknowledgements acknowledgement
      WHERE acknowledgement.organisation_id = p.organisation_id
        AND acknowledgement.document_version_id = v.id
        AND p.linked_user_id IS NOT NULL AND acknowledgement.acknowledged_by = p.linked_user_id
      ORDER BY acknowledgement.acknowledged_at DESC LIMIT 1
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT check_record.decision
      FROM hr_employee_document_verifications check_record
      WHERE check_record.organisation_id = p.organisation_id AND check_record.document_version_id = v.id
      ORDER BY check_record.verified_at DESC, check_record.created_at DESC, check_record.id DESC LIMIT 1
    ) verification ON TRUE
    WHERE p.organisation_id = $1
      AND ($3 OR p.linked_user_id = $2
        OR EXISTS (SELECT 1 FROM hr_administrators administrator
          WHERE administrator.organisation_id = p.organisation_id AND administrator.user_id = $2))
    GROUP BY p.id, p.first_name, p.last_name
`;

export async function loadRegisterPage(session: OrgSession, kind: RegisterKind, query: RegisterQuery, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const values: unknown[] = [session.organisationId, session.userId, session.role === 'super_admin', kind === 'documents' ? today : now.toISOString(), soon, query.search.toLowerCase(), query.filter, query.lifecycle, query.page];
  let source: string, predicate: string, order: string, projection: string;
  if (kind === 'documents') {
    source = `base AS (${documentRows})`;
    // Column choice is fixed by this map, never interpolated from query input.
    const categories: Record<string, string> = { missing_version: 'missing_version', pending_acknowledgement: 'pending_acknowledgement', unlinked_employee: 'unlinked_employee', pending_verification: 'pending_verification', rejected: 'rejected', expired: 'expired', expiring_soon: 'expiring_soon' };
    predicate = `($7='all'${categories[query.filter] ? ` OR ${categories[query.filter]}>0` : ''})`;
    order = 'last_name, first_name, person_id';
    projection = 'person_id, first_name, last_name, documents, missing_version, pending_acknowledgement, unlinked_employee, pending_verification, rejected, expired, expiring_soon';
  } else {
    source = `authorised AS (${authorised}), visible AS MATERIALIZED (${visible}), base AS (`;
    if (kind === 'queue') {
      source += `SELECT * FROM visible WHERE status IN ('NOT_STARTED','IN_PROGRESS','AWAITING_APPROVAL'))`;
      predicate = `($7='all' OR ($7='overdue' AND overdue) OR status=$7) AND ($8='all' OR lifecycle_type=$8)`;
      order = 'overdue DESC, due_at ASC NULLS LAST, workflow_id, task_id';
      projection = 'task_id, workflow_id, person_id, lifecycle_type, first_name, last_name, title, status, due_at, overdue';
    } else {
      source += `SELECT w.workflow_id, w.person_id, w.lifecycle_type, w.first_name, w.last_name, w.started_at,
        COUNT(t.task_id)::int AS visible_tasks,
        COUNT(t.task_id) FILTER (WHERE t.status IN ('NOT_STARTED','IN_PROGRESS','AWAITING_APPROVAL'))::int AS outstanding_tasks,
        COUNT(t.task_id) FILTER (WHERE t.status='AWAITING_APPROVAL')::int AS awaiting_approval,
        COUNT(t.task_id) FILTER (WHERE t.status IN ('NOT_STARTED','IN_PROGRESS','AWAITING_APPROVAL') AND t.overdue)::int AS overdue_tasks
        FROM authorised w LEFT JOIN visible t ON t.workflow_id=w.workflow_id
        GROUP BY w.workflow_id,w.person_id,w.lifecycle_type,w.first_name,w.last_name,w.started_at)`;
      predicate = `($7='all' OR ($7='outstanding' AND outstanding_tasks>0) OR ($7='approvals' AND awaiting_approval>0) OR ($7='overdue' AND overdue_tasks>0)) AND ($8='all' OR lifecycle_type=$8)`;
      order = 'started_at DESC, workflow_id';
      projection = 'workflow_id, person_id, lifecycle_type, first_name, last_name, visible_tasks, outstanding_tasks, awaiting_approval, overdue_tasks';
    }
  }
  const search = kind === 'queue' ? "first_name || ' ' || last_name || ' ' || title" : "first_name || ' ' || last_name";
  const rows = await sql.query(`WITH ${source}, filtered AS (
    SELECT * FROM base WHERE $5::text IS NOT NULL AND $8::text IS NOT NULL AND ${predicate} AND STRPOS(LOWER(${search}), $6)>0
  ), totals AS (SELECT COUNT(*)::int AS total FROM filtered), bounds AS (
    SELECT total, LEAST($9::int,GREATEST(1,CEIL(total::numeric/${HR_REGISTER_PAGE_SIZE})::int)) AS page FROM totals
  ), selected AS (
    SELECT ${projection} FROM filtered ORDER BY ${order}
    LIMIT ${HR_REGISTER_PAGE_SIZE} OFFSET (SELECT (page-1)*${HR_REGISTER_PAGE_SIZE} FROM bounds)
  ) SELECT total, page, COALESCE((SELECT jsonb_agg(selected) FROM selected),'[]'::jsonb) AS rows FROM bounds`, values);
  const result = rows[0];
  if (!result || !Array.isArray(result.rows)) throw new Error('Invalid register result');
  const pagination = validateRegisterPagination({ page: result.page, total: result.total, page_size: HR_REGISTER_PAGE_SIZE }, result.rows.length);
  const records = result.rows as Record<string, unknown>[];
  // The SQL projection is an allowlist. Counts and identifiers fail closed on drift.
  for (const record of records) {
    if (typeof record.person_id !== 'string' || typeof record.first_name !== 'string' || typeof record.last_name !== 'string') throw new Error('Invalid register row');
    for (const [key, value] of Object.entries(record)) {
      if (['documents','missing_version','pending_acknowledgement','unlinked_employee','pending_verification','rejected','expired','expiring_soon','visible_tasks','outstanding_tasks','awaiting_approval','overdue_tasks'].includes(key)
        && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid register count');
    }
    if (kind === 'queue' && record.due_at !== null) record.due_at = new Date(record.due_at as string).toISOString();
  }
  if (kind === 'documents') return { as_of_date: today, expiring_through: soon, people: records, pagination };
  const people = [...new Map(records.map(record => [record.person_id, { id: record.person_id, first_name: record.first_name, last_name: record.last_name }])).values()];
  // Names live in the page's small people index, not the task/count records.
  const items = records.map(({ first_name, last_name, ...record }) => { void first_name; void last_name; return record; });
  return kind === 'queue' ? { as_of: now.toISOString(), tasks: items, people, pagination } : { workflows: items, people, pagination };
}
