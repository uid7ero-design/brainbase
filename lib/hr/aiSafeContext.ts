import 'server-only';

import type { AiSafeHrPersonProjection } from './aiSafePersonProjection';
import type {
  AiSafeLifecycleTaskProjection,
  AiSafeLifecycleWorkflowProjection,
} from './aiSafeLifecycleProjection';

export type AiSafeHrContext = {
  person: AiSafeHrPersonProjection;
  lifecycles: AiSafeLifecycleWorkflowProjection[];
};

/**
 * HR-8C — the single reviewed envelope future HR AI features can hand to a
 * model after canonical authorization/visibility and HR-8A/8B projection.
 *
 * Inputs are already-safe projection types, but this function deliberately
 * re-materialises every nested object from the explicit allowlist rather than
 * retaining caller objects by reference. That keeps the runtime boundary
 * fail-closed even when JavaScript callers provide structurally compatible
 * objects carrying extra properties.
 */
export function composeAiSafeHrContext(params: {
  person: AiSafeHrPersonProjection;
  lifecycles: readonly AiSafeLifecycleWorkflowProjection[];
}): AiSafeHrContext {
  return {
    person: {
      display_name: params.person.display_name,
      job_title: params.person.job_title,
      worker_type: params.person.worker_type,
      employment_status: params.person.employment_status,
      team_name: params.person.team_name,
      manager_name: params.person.manager_name,
    },
    lifecycles: params.lifecycles.map(lifecycle => ({
      lifecycle_type: lifecycle.lifecycle_type,
      status: lifecycle.status,
      tasks: lifecycle.tasks.map((task): AiSafeLifecycleTaskProjection => ({
        title: task.title,
        status: task.status,
      })),
    })),
  };
}
