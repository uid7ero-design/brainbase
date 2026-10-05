import { NextResponse } from 'next/server';
import {
  getVisibleLifecycleTasksForWorkflow,
  lifecycleTaskToJson,
  lifecycleWorkflowToJson,
} from '@/lib/hr/lifecycleWorkflowQueries';
import {
  canApproveLifecycleTask,
  canExecuteLifecycleTask,
  type LifecycleTaskAccessTarget,
} from '@/lib/hr/lifecycleAccess';
import { requireLifecycleWorkflowContext } from '@/lib/hr/lifecycleWorkflowRoute';
import {
  isLifecycleResourceId,
  lifecycleNotFoundResponse,
  requireLifecycleWorkflow,
} from '@/lib/hr/lifecycleRoute';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireLifecycleWorkflowContext();
  if (!ctx.ok) return ctx.response;

  const { id } = await params;
  if (!isLifecycleResourceId(id)) return lifecycleNotFoundResponse();

  const resolved = await requireLifecycleWorkflow(ctx.context.session, id);
  if (!resolved.ok) return resolved.response;

  const tasks = await getVisibleLifecycleTasksForWorkflow(
    ctx.context.session,
    id,
  );

  return NextResponse.json({
    workflow: lifecycleWorkflowToJson(resolved.workflow),
    tasks: tasks.map(task => {
      const target: LifecycleTaskAccessTarget = {
        ...resolved.auth.target,
        responsibilityType: task.responsibilityType,
        approvalType: task.approvalType,
        assignedUserId: task.assignedUserId,
        employeeVisible: task.employeeVisible,
        managerVisible: task.managerVisible,
        internalOnly: task.internalOnly,
      };

      return {
        ...lifecycleTaskToJson(task),
        capabilities: {
          can_execute: canExecuteLifecycleTask(resolved.auth.actor, target),
          can_approve: canApproveLifecycleTask(resolved.auth.actor, target),
        },
      };
    }),
  });
}
