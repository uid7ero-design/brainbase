import 'server-only';

import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import { requireHrCapability } from './capability';
import { resolveHrAccessContext } from './context';
import { canViewPerson } from './access';
import { projectPersonForAi } from './aiSafePersonProjection';
import { projectLifecycleForAi } from './aiSafeLifecycleProjection';
import { composeAiSafeHrContext, type AiSafeHrContext } from './aiSafeContext';
import type { HrPersonRow } from './projectPerson';
import {
  getVisibleLifecycleTasksForWorkflow,
  listLifecycleWorkflows,
} from './lifecycleWorkflowQueries';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type LoadAiSafeHrContextResult =
  | { outcome: 'ok'; context: AiSafeHrContext }
  | { outcome: 'not_found' };

export async function loadAiSafeHrContext(params: {
  session: OrgSession;
  personId: string;
}): Promise<LoadAiSafeHrContextResult> {
  if (!UUID_RE.test(params.personId)) return { outcome: 'not_found' };

  await requireHrCapability(params.session.organisationId, params.session.role);

  const rows = await sql`
    SELECT
      p.id,
      p.organisation_id,
      p.linked_user_id,
      p.first_name,
      p.last_name,
      p.preferred_name,
      p.work_email,
      p.work_phone,
      p.job_title,
      p.worker_type,
      p.employment_status,
      p.team_id,
      p.manager_person_id,
      p.start_date,
      p.end_date,
      p.created_at,
      p.updated_at,
      t.name AS team_name,
      m.first_name AS manager_first_name,
      m.last_name AS manager_last_name
    FROM hr_people p
    LEFT JOIN hr_teams t
      ON t.organisation_id = p.organisation_id
     AND t.id = p.team_id
    LEFT JOIN hr_people m
      ON m.organisation_id = p.organisation_id
     AND m.id = p.manager_person_id
    WHERE p.organisation_id = ${params.session.organisationId}
      AND p.id = ${params.personId}::uuid
    LIMIT 1
  ` as HrPersonRow[];

  const person = rows[0];
  if (!person) return { outcome: 'not_found' };

  const access = await resolveHrAccessContext({
    organisationId: params.session.organisationId,
    userId: params.session.userId,
    role: params.session.role,
  });
  const target = {
    organisationId: person.organisation_id,
    personId: person.id,
    managerPersonId: person.manager_person_id,
  };

  if (!canViewPerson(access, target)) return { outcome: 'not_found' };

  const workflows = await listLifecycleWorkflows(params.session, {
    personId: params.personId,
  });

  const lifecycleContexts = await Promise.all(
    workflows.map(async workflow => {
      const visibleTasks = await getVisibleLifecycleTasksForWorkflow(
        params.session,
        workflow.id,
      );
      return projectLifecycleForAi(workflow, visibleTasks);
    }),
  );

  return {
    outcome: 'ok',
    context: composeAiSafeHrContext({
      person: projectPersonForAi(person),
      lifecycles: lifecycleContexts,
    }),
  };
}
