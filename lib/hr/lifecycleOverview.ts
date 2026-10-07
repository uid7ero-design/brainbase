import 'server-only';
import type { OrgSession } from '@/lib/org';
import { getVisibleLifecycleTasksForWorkflow, listLifecycleWorkflows } from './lifecycleWorkflowQueries';

/** Counts only canonical viewer-visible tasks; hidden tasks contribute nothing. */
export async function loadLifecycleOverview(session: OrgSession, now = new Date()) {
  const workflows = await listLifecycleWorkflows(session, { status: 'ACTIVE' });
  const summaries = [];
  // Bound simultaneous database reads without silently truncating the overview.
  for (let offset = 0; offset < workflows.length; offset += 4) {
    const batch = await Promise.all(workflows.slice(offset, offset + 4).map(async workflow => {
      const tasks = await getVisibleLifecycleTasksForWorkflow(session, workflow.id);
      const outstanding = tasks.filter(task => ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL'].includes(task.status));
      return {
        workflow_id: workflow.id,
        person_id: workflow.personId,
        lifecycle_type: workflow.lifecycleType,
        visible_tasks: tasks.length,
        outstanding_tasks: outstanding.length,
        awaiting_approval: outstanding.filter(task => task.status === 'AWAITING_APPROVAL').length,
        overdue_tasks: outstanding.filter(task => {
          if (!task.dueAt) return false;
          const due = new Date(task.dueAt).getTime();
          if (!Number.isFinite(due)) throw new Error('Invalid lifecycle due date');
          return due < now.getTime();
        }).length,
      };
    }));
    summaries.push(...batch);
  }
  return { workflows: summaries };
}
