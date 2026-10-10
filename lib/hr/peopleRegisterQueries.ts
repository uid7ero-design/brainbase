import 'server-only';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import { HR_REGISTER_PAGE_SIZE } from './registerPaging';
import { parsePeopleRegisterSnapshot, type PeopleRegisterQuery } from './peopleRegisterContract';

/** Same self/current-direct-manager/HR policy as canViewPerson and resolveHrAccessContext.
 * Authority and totals resolve in one snapshot; names are never inferred as identity.
 */
export async function loadPeopleRegister(session: OrgSession, query: PeopleRegisterQuery) {
  const rows = await sql`
    WITH authority AS (
      SELECT (${session.role === 'super_admin'} OR EXISTS (
        SELECT 1 FROM hr_administrators a WHERE a.organisation_id=${session.organisationId} AND a.user_id=${session.userId}
      )) AS can_manage
    ), visible AS (
      SELECT p.id, p.first_name, p.last_name, p.job_title, p.worker_type, p.employment_status,
        team.name AS team_name, manager.first_name AS manager_first_name, manager.last_name AS manager_last_name
      FROM hr_people p CROSS JOIN authority
      LEFT JOIN hr_teams team ON team.id=p.team_id AND team.organisation_id=p.organisation_id
      LEFT JOIN hr_people manager ON manager.id=p.manager_person_id AND manager.organisation_id=p.organisation_id
      WHERE p.organisation_id=${session.organisationId}
        AND (authority.can_manage OR p.linked_user_id=${session.userId} OR manager.linked_user_id=${session.userId})
    ), filtered AS (
      SELECT * FROM visible
      WHERE (${query.status}='all' OR employment_status=${query.status})
        AND (${query.workerType}='all' OR worker_type=${query.workerType})
        AND (STRPOS(LOWER(first_name || ' ' || last_name), LOWER(${query.search}))>0
          OR STRPOS(LOWER(COALESCE(job_title,'')), LOWER(${query.search}))>0
          OR STRPOS(LOWER(COALESCE(team_name,'')), LOWER(${query.search}))>0)
    ), totals AS (SELECT COUNT(*)::int AS total FROM filtered), bounds AS (
      SELECT total, LEAST(${query.page}::int,GREATEST(1,CEIL(total::numeric/${HR_REGISTER_PAGE_SIZE})::int)) AS page FROM totals
    ), selected AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY first_name,last_name,id) AS ordinal FROM filtered
      ORDER BY first_name,last_name,id LIMIT ${HR_REGISTER_PAGE_SIZE}
      OFFSET (SELECT (page-1)*${HR_REGISTER_PAGE_SIZE} FROM bounds)
    ) SELECT authority.can_manage, bounds.total, bounds.page,
      COALESCE((SELECT jsonb_agg(to_jsonb(selected)-'ordinal' ORDER BY selected.ordinal) FROM selected),'[]'::jsonb) AS people
      FROM bounds CROSS JOIN authority
  `;
  const row = rows[0];
  if (!row) throw new Error('Invalid People result');
  return parsePeopleRegisterSnapshot({ people: row.people, canManage: row.can_manage,
    pagination: { total: row.total, page: row.page, page_size: HR_REGISTER_PAGE_SIZE } });
}
