import 'server-only';

import sql from '@/lib/db';

export type LifecycleMutationActor = {
  organisationId: string;
  userId: string;
  isSuperAdmin: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CompleteLifecycleTaskParams = {
  actor: LifecycleMutationActor;
  taskId: string;
};

export type CompleteLifecycleTaskResult =
  | {
      outcome: 'completed';
      task: {
        id: string;
        status: 'COMPLETED';
        completedBy: string;
        completedAt: Date | string;
      };
      workflow: {
        id: string;
        status: 'ACTIVE' | 'COMPLETED';
        completedAt: Date | string | null;
      };
    }
  | {
      outcome: 'awaiting_approval';
      task: {
        id: string;
        status: 'AWAITING_APPROVAL';
      };
      workflow: {
        id: string;
        status: 'ACTIVE';
        completedAt: null;
      };
    }
  | { outcome: 'already_completed' }
  | { outcome: 'already_submitted' }
  | { outcome: 'already_terminal' }
  | { outcome: 'workflow_not_active' }
  | { outcome: 'forbidden' }
  | { outcome: 'task_not_found' };

type CompleteMutationRow = {
  task_exists: boolean;
  authorized: boolean;
  workflow_status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | null;
  previous_status:
    | 'NOT_STARTED'
    | 'IN_PROGRESS'
    | 'AWAITING_APPROVAL'
    | 'COMPLETED'
    | 'WAIVED'
    | 'CANCELLED'
    | null;
  task_id: string | null;
  task_status: 'AWAITING_APPROVAL' | 'COMPLETED' | null;
  completed_by: string | null;
  completed_at: Date | string | null;
  workflow_id: string | null;
  resulting_workflow_status: 'ACTIVE' | 'COMPLETED' | null;
  workflow_completed_at: Date | string | null;
  task_audit_written: boolean;
  workflow_audit_written: boolean;
};

function lifecycleTaskLockKey(taskId: string): string {
  return `hr-lifecycle-task:${taskId}`;
}

/**
 * Completes (or submits for approval) one lifecycle task.
 *
 * Statement 1 acquires a transaction-scoped advisory lock keyed by task id.
 * Statement 2 receives a fresh READ COMMITTED snapshot after any wait, then
 * re-resolves active-org scope, current employee/manager linkage and HR-admin
 * authority at the write boundary. Business state + audit state are writable
 * CTEs in the same statement, so audit failure rolls the entire mutation back.
 */
export async function completeLifecycleTask(
  params: CompleteLifecycleTaskParams,
): Promise<CompleteLifecycleTaskResult> {
  const taskAuditId = crypto.randomUUID();
  const workflowAuditId = crypto.randomUUID();

  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${lifecycleTaskLockKey(params.taskId)}, 0)
      ) AS locked
    `,
    txn`
    WITH task_scope AS MATERIALIZED (
      SELECT
        t.id,
        t.organisation_id,
        t.workflow_id,
        t.person_id,
        t.template_id,
        t.status AS previous_status,
        t.responsibility_type,
        t.requires_approval,
        t.approval_type,
        t.employee_visible,
        t.manager_visible,
        t.internal_only,
        w.status AS workflow_status,
        p.linked_user_id AS person_linked_user_id,
        manager.linked_user_id AS current_manager_linked_user_id,
        (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1
            FROM hr_administrators a
            WHERE a.organisation_id = t.organisation_id
              AND a.user_id = ${params.actor.userId}
          )
        ) AS is_hr_administrator
      FROM hr_lifecycle_tasks t
      JOIN hr_lifecycle_workflows w
        ON w.organisation_id = t.organisation_id
       AND w.id = t.workflow_id
       AND w.person_id = t.person_id
       AND w.template_id = t.template_id
      JOIN hr_people p
        ON p.organisation_id = t.organisation_id
       AND p.id = t.person_id
      LEFT JOIN hr_people manager
        ON manager.organisation_id = p.organisation_id
       AND manager.id = p.manager_person_id
      WHERE t.id = ${params.taskId}::uuid
        AND t.organisation_id = ${params.actor.organisationId}
      FOR SHARE OF t, w, p
    ),
    decision AS MATERIALIZED (
      SELECT
        task_scope.*,
        (
          task_scope.is_hr_administrator
          OR (
            task_scope.internal_only = false
            AND task_scope.responsibility_type = 'EMPLOYEE'
            AND task_scope.employee_visible = true
            AND task_scope.person_linked_user_id = ${params.actor.userId}
          )
          OR (
            task_scope.internal_only = false
            AND task_scope.responsibility_type = 'MANAGER'
            AND task_scope.manager_visible = true
            AND task_scope.current_manager_linked_user_id = ${params.actor.userId}
          )
        ) AS authorized
      FROM task_scope
    ),
    updated_task AS (
      UPDATE hr_lifecycle_tasks t
      SET
        status = CASE
          WHEN decision.requires_approval THEN 'AWAITING_APPROVAL'
          ELSE 'COMPLETED'
        END,
        completed_by = CASE
          WHEN decision.requires_approval THEN NULL
          ELSE ${params.actor.userId}
        END,
        completed_at = CASE
          WHEN decision.requires_approval THEN NULL
          ELSE NOW()
        END,
        updated_at = NOW()
      FROM decision
      WHERE t.id = decision.id
        AND t.organisation_id = decision.organisation_id
        AND decision.authorized = true
        AND decision.workflow_status = 'ACTIVE'
        AND decision.previous_status IN ('NOT_STARTED', 'IN_PROGRESS')
      RETURNING
        t.id,
        t.organisation_id,
        t.workflow_id,
        t.person_id,
        t.template_id,
        t.status,
        t.completed_by,
        t.completed_at,
        decision.previous_status,
        decision.requires_approval
    ),
    workflow_completed AS (
      UPDATE hr_lifecycle_workflows w
      SET
        status = 'COMPLETED',
        completed_at = NOW(),
        updated_at = NOW()
      FROM updated_task completed
      WHERE completed.status = 'COMPLETED'
        AND w.id = completed.workflow_id
        AND w.organisation_id = completed.organisation_id
        AND w.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1
          FROM hr_lifecycle_tasks other_task
          WHERE other_task.organisation_id = completed.organisation_id
            AND other_task.workflow_id = completed.workflow_id
            AND other_task.id <> completed.id
            AND other_task.status NOT IN ('COMPLETED', 'WAIVED')
        )
      RETURNING w.id, w.status, w.completed_at
    ),
    task_audited AS (
      INSERT INTO audit_logs (
        id,
        organisation_id,
        user_id,
        action,
        resource_type,
        resource_id,
        before_state,
        after_state,
        ip_address,
        user_agent
      )
      SELECT
        ${taskAuditId},
        updated_task.organisation_id,
        ${params.actor.userId},
        CASE
          WHEN updated_task.status = 'COMPLETED'
            THEN 'hr_lifecycle_task.completed'
          ELSE 'hr_lifecycle_task.submitted_for_approval'
        END,
        'hr_lifecycle_task',
        updated_task.id::text,
        jsonb_build_object('status', updated_task.previous_status),
        jsonb_build_object(
          'status', updated_task.status,
          'completed_by', updated_task.completed_by,
          'completed_at', updated_task.completed_at
        ),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM updated_task
      RETURNING id
    ),
    workflow_audited AS (
      INSERT INTO audit_logs (
        id,
        organisation_id,
        user_id,
        action,
        resource_type,
        resource_id,
        before_state,
        after_state,
        ip_address,
        user_agent
      )
      SELECT
        ${workflowAuditId},
        ${params.actor.organisationId},
        ${params.actor.userId},
        'hr_lifecycle_workflow.completed',
        'hr_lifecycle_workflow',
        workflow_completed.id::text,
        jsonb_build_object('status', 'ACTIVE'),
        jsonb_build_object(
          'status', workflow_completed.status,
          'completed_at', workflow_completed.completed_at
        ),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM workflow_completed
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM task_scope) AS task_exists,
      COALESCE((SELECT authorized FROM decision), false) AS authorized,
      (SELECT workflow_status FROM task_scope) AS workflow_status,
      (SELECT previous_status FROM task_scope) AS previous_status,
      updated_task.id::text AS task_id,
      updated_task.status AS task_status,
      updated_task.completed_by,
      updated_task.completed_at,
      updated_task.workflow_id::text AS workflow_id,
      COALESCE(
        (SELECT status FROM workflow_completed),
        CASE
          WHEN updated_task.id IS NOT NULL THEN 'ACTIVE'
          ELSE NULL
        END
      ) AS resulting_workflow_status,
      (SELECT completed_at FROM workflow_completed) AS workflow_completed_at,
      EXISTS (SELECT 1 FROM task_audited) AS task_audit_written,
      EXISTS (SELECT 1 FROM workflow_audited) AS workflow_audit_written
    FROM (SELECT 1) sentinel
    LEFT JOIN updated_task ON TRUE
    `,
  ]);

  const rows = mutationRows as CompleteMutationRow[];
  const row = rows[0];
  if (!row) throw new Error('Lifecycle task completion returned no state row.');

  if (!row.task_exists) return { outcome: 'task_not_found' };
  if (!row.authorized) return { outcome: 'forbidden' };

  // Terminal/submitted task state takes precedence over the parent workflow
  // state. In the final-task double-completion race, the winner atomically
  // completes both task and workflow; after acquiring the same task lock, the
  // loser must still report already_completed rather than workflow_not_active.
  if (!row.task_id) {
    if (row.previous_status === 'COMPLETED') return { outcome: 'already_completed' };
    if (row.previous_status === 'AWAITING_APPROVAL') return { outcome: 'already_submitted' };
    if (row.previous_status === 'WAIVED' || row.previous_status === 'CANCELLED') {
      return { outcome: 'already_terminal' };
    }
    if (row.workflow_status !== 'ACTIVE') return { outcome: 'workflow_not_active' };
    throw new Error('Lifecycle task completion did not update an eligible task.');
  }

  if (row.workflow_status !== 'ACTIVE') return { outcome: 'workflow_not_active' };

  if (!row.task_audit_written) {
    throw new Error('Lifecycle task completion audit was not written.');
  }

  if (row.task_status === 'AWAITING_APPROVAL') {
    if (!row.workflow_id) {
      throw new Error('Lifecycle task completion returned no workflow id.');
    }
    return {
      outcome: 'awaiting_approval',
      task: {
        id: row.task_id,
        status: 'AWAITING_APPROVAL',
      },
      workflow: {
        id: row.workflow_id,
        status: 'ACTIVE',
        completedAt: null,
      },
    };
  }

  if (
    row.task_status !== 'COMPLETED'
    || row.completed_by === null
    || row.completed_at === null
    || row.workflow_id === null
    || row.resulting_workflow_status === null
  ) {
    throw new Error('Lifecycle task completion returned incomplete terminal state.');
  }

  if (row.resulting_workflow_status === 'COMPLETED' && !row.workflow_audit_written) {
    throw new Error('Lifecycle workflow completion audit was not written.');
  }
  if (row.resulting_workflow_status === 'ACTIVE' && row.workflow_audit_written) {
    throw new Error('Lifecycle workflow completion audit was written without completion.');
  }

  return {
    outcome: 'completed',
    task: {
      id: row.task_id,
      status: 'COMPLETED',
      completedBy: row.completed_by,
      completedAt: row.completed_at,
    },
    workflow: {
      id: row.workflow_id,
      status: row.resulting_workflow_status,
      completedAt: row.workflow_completed_at,
    },
  };
}
