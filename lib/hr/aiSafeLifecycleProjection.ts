import 'server-only';

import type { LifecycleTaskRow, LifecycleWorkflowRow } from './lifecycleRoute';

export type AiSafeLifecycleTaskProjection = {
  title: string;
  status: LifecycleTaskRow['status'];
};

export type AiSafeLifecycleWorkflowProjection = {
  lifecycle_type: LifecycleWorkflowRow['lifecycleType'];
  status: LifecycleWorkflowRow['status'];
  tasks: AiSafeLifecycleTaskProjection[];
};

/**
 * HR-8B — minimal lifecycle context for a future explicitly-authorised AI
 * feature.
 *
 * Authorization and task visibility MUST already have been resolved by the
 * caller. In particular, the supplied task list must be the result of the
 * canonical lifecycle visibility rules; this helper never broadens access.
 *
 * The projection deliberately omits identifiers, descriptions, assignment
 * data, exact dates/timestamps, approval/responsibility metadata and
 * employee/manager/internal visibility flags. It constructs a new object from
 * a closed allowlist so future fields added to lifecycle rows fail closed.
 */
export function projectLifecycleForAi(
  workflow: LifecycleWorkflowRow,
  visibleTasks: readonly LifecycleTaskRow[],
): AiSafeLifecycleWorkflowProjection {
  return {
    lifecycle_type: workflow.lifecycleType,
    status: workflow.status,
    tasks: visibleTasks.map(task => ({
      title: task.title,
      status: task.status,
    })),
  };
}
