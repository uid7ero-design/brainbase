import 'server-only';
import type { OrgSession } from '@/lib/org';
import { getVisibleLifecycleTasksForWorkflow, listLifecycleWorkflows } from './lifecycleWorkflowQueries';

export async function loadLifecycleTaskQueue(session: OrgSession, now = new Date()) {
  const asOf = now.toISOString();
  const workflows = await listLifecycleWorkflows(session, { status: 'ACTIVE' });
  const tasks = [];
  for (let offset = 0; offset < workflows.length; offset += 4) {
    const batch = await Promise.all(workflows.slice(offset, offset + 4).map(async workflow => {
      const visible = await getVisibleLifecycleTasksForWorkflow(session, workflow.id);
      return visible.filter(task => ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL'].includes(task.status)).map(task => {
        const dueAt = task.dueAt === null ? null : new Date(task.dueAt).toISOString();
        return {
          task_id: task.id, workflow_id: workflow.id, person_id: workflow.personId,
          lifecycle_type: workflow.lifecycleType, title: task.title, status: task.status,
          due_at: dueAt, overdue: dueAt !== null && new Date(dueAt).getTime() < now.getTime(),
        };
      });
    }));
    tasks.push(...batch.flat());
  }
  // Overdue first, then due date (undated last), then stable resource identities.
  tasks.sort((a, b) => Number(b.overdue) - Number(a.overdue)
    || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')
    || a.workflow_id.localeCompare(b.workflow_id) || a.task_id.localeCompare(b.task_id));
  return { as_of: asOf, tasks };
}
