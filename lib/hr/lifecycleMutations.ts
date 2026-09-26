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

/**
 * Completes (or submits for approval) one lifecycle task.
 *
 * Statement 1 acquires a transaction-scoped advisory lock keyed by workflow id.
 * This serializes state changes across different tasks in the same workflow,
 * so concurrent final tasks cannot both miss derived workflow completion.
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
        hashtextextended('hr-lifecycle-workflow:' || t.workflow_id::text, 0)
      ) AS locked
      FROM hr_lifecycle_tasks t
      WHERE t.id = ${params.taskId}::uuid
        AND t.organisation_id = ${params.actor.organisationId}
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
  // completes both task and workflow; after acquiring the same workflow lock, the
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


export type StartLifecycleTaskResult =
  | {
      outcome: 'started';
      task: { id: string; status: 'IN_PROGRESS' };
    }
  | { outcome: 'already_started' }
  | { outcome: 'already_terminal' }
  | { outcome: 'workflow_not_active' }
  | { outcome: 'forbidden' }
  | { outcome: 'task_not_found' };

type StartMutationRow = {
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
  task_status: 'IN_PROGRESS' | null;
  audit_written: boolean;
};

export async function startLifecycleTask(
  params: CompleteLifecycleTaskParams,
): Promise<StartLifecycleTaskResult> {
  const auditId = crypto.randomUUID();

  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended('hr-lifecycle-workflow:' || t.workflow_id::text, 0)
      ) AS locked
      FROM hr_lifecycle_tasks t
      WHERE t.id = ${params.taskId}::uuid
        AND t.organisation_id = ${params.actor.organisationId}
    `,
    txn`
    WITH task_scope AS MATERIALIZED (
      SELECT
        t.id,
        t.organisation_id,
        t.status AS previous_status,
        t.responsibility_type,
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
    updated AS (
      UPDATE hr_lifecycle_tasks t
      SET status = 'IN_PROGRESS', updated_at = NOW()
      FROM decision
      WHERE t.id = decision.id
        AND t.organisation_id = decision.organisation_id
        AND decision.authorized = true
        AND decision.workflow_status = 'ACTIVE'
        AND decision.previous_status = 'NOT_STARTED'
      RETURNING t.id, t.organisation_id, decision.previous_status, t.status
    ),
    audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${auditId},
        updated.organisation_id,
        ${params.actor.userId},
        'hr_lifecycle_task.started',
        'hr_lifecycle_task',
        updated.id::text,
        jsonb_build_object('status', updated.previous_status),
        jsonb_build_object('status', updated.status),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM updated
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM task_scope) AS task_exists,
      COALESCE((SELECT authorized FROM decision), false) AS authorized,
      (SELECT workflow_status FROM task_scope) AS workflow_status,
      (SELECT previous_status FROM task_scope) AS previous_status,
      updated.id::text AS task_id,
      updated.status AS task_status,
      EXISTS (SELECT 1 FROM audited) AS audit_written
    FROM (SELECT 1) sentinel
    LEFT JOIN updated ON TRUE
    `,
  ]);

  const row = (mutationRows as StartMutationRow[])[0];
  if (!row) throw new Error('Lifecycle task start returned no state row.');
  if (!row.task_exists) return { outcome: 'task_not_found' };
  if (!row.authorized) return { outcome: 'forbidden' };
  if (!row.task_id) {
    if (row.previous_status === 'IN_PROGRESS' || row.previous_status === 'AWAITING_APPROVAL') {
      return { outcome: 'already_started' };
    }
    if (row.previous_status === 'COMPLETED' || row.previous_status === 'WAIVED' || row.previous_status === 'CANCELLED') {
      return { outcome: 'already_terminal' };
    }
    if (row.workflow_status !== 'ACTIVE') return { outcome: 'workflow_not_active' };
    throw new Error('Lifecycle task start did not update an eligible task.');
  }
  if (!row.audit_written || row.task_status !== 'IN_PROGRESS') {
    throw new Error('Lifecycle task start audit was not written.');
  }
  return {
    outcome: 'started',
    task: { id: row.task_id, status: 'IN_PROGRESS' },
  };
}

export type WaiveLifecycleTaskParams = {
  actor: LifecycleMutationActor;
  taskId: string;
  reason: string;
};

export type WaiveLifecycleTaskResult =
  | {
      outcome: 'waived';
      task: {
        id: string;
        status: 'WAIVED';
        waivedBy: string;
        waivedAt: Date | string;
        waiverReason: string;
      };
      workflow: {
        id: string;
        status: 'ACTIVE' | 'COMPLETED';
        completedAt: Date | string | null;
      };
    }
  | { outcome: 'already_terminal' }
  | { outcome: 'workflow_not_active' }
  | { outcome: 'forbidden' }
  | { outcome: 'task_not_found' };

type WaiveMutationRow = {
  task_exists: boolean;
  authorized: boolean;
  workflow_status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | null;
  previous_status: string | null;
  task_id: string | null;
  waived_by: string | null;
  waived_at: Date | string | null;
  waiver_reason: string | null;
  workflow_id: string | null;
  resulting_workflow_status: 'ACTIVE' | 'COMPLETED' | null;
  workflow_completed_at: Date | string | null;
  task_audit_written: boolean;
  workflow_audit_written: boolean;
};

export async function waiveLifecycleTask(
  params: WaiveLifecycleTaskParams,
): Promise<WaiveLifecycleTaskResult> {
  const taskAuditId = crypto.randomUUID();
  const workflowAuditId = crypto.randomUUID();

  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended('hr-lifecycle-workflow:' || t.workflow_id::text, 0)
      ) AS locked
      FROM hr_lifecycle_tasks t
      WHERE t.id = ${params.taskId}::uuid
        AND t.organisation_id = ${params.actor.organisationId}
    `,
    txn`
    WITH task_scope AS MATERIALIZED (
      SELECT
        t.id,
        t.organisation_id,
        t.workflow_id,
        t.status AS previous_status,
        w.status AS workflow_status,
        (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1
            FROM hr_administrators a
            WHERE a.organisation_id = t.organisation_id
              AND a.user_id = ${params.actor.userId}
          )
        ) AS authorized
      FROM hr_lifecycle_tasks t
      JOIN hr_lifecycle_workflows w
        ON w.organisation_id = t.organisation_id
       AND w.id = t.workflow_id
       AND w.person_id = t.person_id
       AND w.template_id = t.template_id
      WHERE t.id = ${params.taskId}::uuid
        AND t.organisation_id = ${params.actor.organisationId}
      FOR SHARE OF t, w
    ),
    updated_task AS (
      UPDATE hr_lifecycle_tasks t
      SET
        status = 'WAIVED',
        completed_by = NULL,
        completed_at = NULL,
        waived_by = ${params.actor.userId},
        waived_at = NOW(),
        waiver_reason = ${params.reason},
        updated_at = NOW()
      FROM task_scope
      WHERE t.id = task_scope.id
        AND t.organisation_id = task_scope.organisation_id
        AND task_scope.authorized = true
        AND task_scope.workflow_status = 'ACTIVE'
        AND task_scope.previous_status IN ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL')
      RETURNING
        t.id,
        t.organisation_id,
        t.workflow_id,
        task_scope.previous_status,
        t.waived_by,
        t.waived_at,
        t.waiver_reason
    ),
    workflow_completed AS (
      UPDATE hr_lifecycle_workflows w
      SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
      FROM updated_task waived
      WHERE w.id = waived.workflow_id
        AND w.organisation_id = waived.organisation_id
        AND w.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1
          FROM hr_lifecycle_tasks other_task
          WHERE other_task.organisation_id = waived.organisation_id
            AND other_task.workflow_id = waived.workflow_id
            AND other_task.id <> waived.id
            AND other_task.status NOT IN ('COMPLETED', 'WAIVED')
        )
      RETURNING w.id, w.status, w.completed_at
    ),
    task_audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${taskAuditId},
        updated_task.organisation_id,
        ${params.actor.userId},
        'hr_lifecycle_task.waived',
        'hr_lifecycle_task',
        updated_task.id::text,
        jsonb_build_object('status', updated_task.previous_status),
        jsonb_build_object(
          'status', 'WAIVED',
          'waived_by', updated_task.waived_by,
          'waived_at', updated_task.waived_at,
          'waiver_reason', '[redacted]'
        ),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM updated_task
      RETURNING id
    ),
    workflow_audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
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
      COALESCE((SELECT authorized FROM task_scope), false) AS authorized,
      (SELECT workflow_status FROM task_scope) AS workflow_status,
      (SELECT previous_status FROM task_scope) AS previous_status,
      updated_task.id::text AS task_id,
      updated_task.waived_by,
      updated_task.waived_at,
      updated_task.waiver_reason,
      updated_task.workflow_id::text AS workflow_id,
      COALESCE(
        (SELECT status FROM workflow_completed),
        CASE WHEN updated_task.id IS NOT NULL THEN 'ACTIVE' ELSE NULL END
      ) AS resulting_workflow_status,
      (SELECT completed_at FROM workflow_completed) AS workflow_completed_at,
      EXISTS (SELECT 1 FROM task_audited) AS task_audit_written,
      EXISTS (SELECT 1 FROM workflow_audited) AS workflow_audit_written
    FROM (SELECT 1) sentinel
    LEFT JOIN updated_task ON TRUE
    `,
  ]);

  const row = (mutationRows as WaiveMutationRow[])[0];
  if (!row) throw new Error('Lifecycle task waive returned no state row.');
  if (!row.task_exists) return { outcome: 'task_not_found' };
  if (!row.authorized) return { outcome: 'forbidden' };

  if (!row.task_id) {
    if (row.previous_status === 'COMPLETED' || row.previous_status === 'WAIVED' || row.previous_status === 'CANCELLED') {
      return { outcome: 'already_terminal' };
    }
    if (row.workflow_status !== 'ACTIVE') return { outcome: 'workflow_not_active' };
    throw new Error('Lifecycle task waive did not update an eligible task.');
  }

  if (
    !row.task_audit_written
    || row.waived_by === null
    || row.waived_at === null
    || row.waiver_reason === null
    || row.workflow_id === null
    || row.resulting_workflow_status === null
  ) {
    throw new Error('Lifecycle task waive audit was not written.');
  }
  if (row.resulting_workflow_status === 'COMPLETED' && !row.workflow_audit_written) {
    throw new Error('Lifecycle workflow completion audit was not written.');
  }

  return {
    outcome: 'waived',
    task: {
      id: row.task_id,
      status: 'WAIVED',
      waivedBy: row.waived_by,
      waivedAt: row.waived_at,
      waiverReason: row.waiver_reason,
    },
    workflow: {
      id: row.workflow_id,
      status: row.resulting_workflow_status,
      completedAt: row.workflow_completed_at,
    },
  };
}

export type RecordLifecycleTaskApprovalParams = {
  actor: LifecycleMutationActor;
  taskId: string;
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
};

export type RecordLifecycleTaskApprovalResult =
  | {
      outcome: 'recorded';
      approval: {
        id: string;
        taskId: string;
        workflowId: string;
        personId: string;
        approverUserId: string;
        decision: 'APPROVED' | 'REJECTED';
        comment: string | null;
        decidedAt: Date | string;
      };
      task: {
        id: string;
        status: 'COMPLETED' | 'IN_PROGRESS';
        completedAt: Date | string | null;
      };
      workflow: {
        id: string;
        status: 'ACTIVE' | 'COMPLETED';
        completedAt: Date | string | null;
      };
    }
  | { outcome: 'approval_not_required' }
  | { outcome: 'approval_no_longer_applicable' }
  | { outcome: 'workflow_not_active' }
  | { outcome: 'forbidden' }
  | { outcome: 'task_not_found' };

type ApprovalMutationRow = {
  task_exists: boolean;
  authorized: boolean;
  requires_approval: boolean | null;
  previous_status: string | null;
  workflow_status: string | null;
  approval_id: string | null;
  task_id: string | null;
  workflow_id: string | null;
  person_id: string | null;
  approver_user_id: string | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  comment: string | null;
  decided_at: Date | string | null;
  task_status: 'COMPLETED' | 'IN_PROGRESS' | null;
  task_completed_at: Date | string | null;
  resulting_workflow_status: 'ACTIVE' | 'COMPLETED' | null;
  workflow_completed_at: Date | string | null;
  approval_audit_written: boolean;
  task_audit_written: boolean;
  workflow_audit_written: boolean;
};

export async function recordLifecycleTaskApproval(
  params: RecordLifecycleTaskApprovalParams,
): Promise<RecordLifecycleTaskApprovalResult> {
  const approvalId = crypto.randomUUID();
  const approvalAuditId = crypto.randomUUID();
  const taskAuditId = crypto.randomUUID();
  const workflowAuditId = crypto.randomUUID();

  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended('hr-lifecycle-workflow:' || t.workflow_id::text, 0)
      ) AS locked
      FROM hr_lifecycle_tasks t
      WHERE t.id = ${params.taskId}::uuid
        AND t.organisation_id = ${params.actor.organisationId}
    `,
    txn`
    WITH task_scope AS MATERIALIZED (
      SELECT
        t.id,
        t.organisation_id,
        t.workflow_id,
        t.person_id,
        t.status AS previous_status,
        t.requires_approval,
        t.approval_type,
        w.status AS workflow_status,
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
    decision_scope AS MATERIALIZED (
      SELECT
        task_scope.*,
        CASE
          WHEN task_scope.approval_type = 'MANAGER'
            THEN task_scope.current_manager_linked_user_id = ${params.actor.userId}
          WHEN task_scope.approval_type = 'HR_ADMIN'
            THEN task_scope.is_hr_administrator
          ELSE false
        END AS authorized
      FROM task_scope
    ),
    inserted_approval AS (
      INSERT INTO hr_lifecycle_task_approvals (
        id,
        organisation_id,
        task_id,
        workflow_id,
        person_id,
        approver_user_id,
        decision,
        comment
      )
      SELECT
        ${approvalId}::uuid,
        decision_scope.organisation_id,
        decision_scope.id,
        decision_scope.workflow_id,
        decision_scope.person_id,
        ${params.actor.userId},
        ${params.decision},
        ${params.comment}
      FROM decision_scope
      WHERE decision_scope.authorized = true
        AND decision_scope.requires_approval = true
        AND decision_scope.workflow_status = 'ACTIVE'
        AND decision_scope.previous_status = 'AWAITING_APPROVAL'
      RETURNING
        id,
        organisation_id,
        task_id,
        workflow_id,
        person_id,
        approver_user_id,
        decision,
        comment,
        decided_at
    ),
    updated_task AS (
      UPDATE hr_lifecycle_tasks t
      SET
        status = CASE
          WHEN inserted_approval.decision = 'APPROVED' THEN 'COMPLETED'
          ELSE 'IN_PROGRESS'
        END,
        completed_by = CASE
          WHEN inserted_approval.decision = 'APPROVED' THEN ${params.actor.userId}
          ELSE NULL
        END,
        completed_at = CASE
          WHEN inserted_approval.decision = 'APPROVED' THEN inserted_approval.decided_at
          ELSE NULL
        END,
        updated_at = NOW()
      FROM inserted_approval
      WHERE t.id = inserted_approval.task_id
        AND t.organisation_id = inserted_approval.organisation_id
      RETURNING
        t.id,
        t.organisation_id,
        t.workflow_id,
        t.status,
        t.completed_at
    ),
    workflow_completed AS (
      UPDATE hr_lifecycle_workflows w
      SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
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
    approval_audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${approvalAuditId},
        inserted_approval.organisation_id,
        ${params.actor.userId},
        'hr_lifecycle_task_approval.recorded',
        'hr_lifecycle_task_approval',
        inserted_approval.id::text,
        NULL::jsonb,
        jsonb_build_object(
          'task_id', inserted_approval.task_id::text,
          'workflow_id', inserted_approval.workflow_id::text,
          'person_id', inserted_approval.person_id::text,
          'approver_user_id', inserted_approval.approver_user_id,
          'decision', inserted_approval.decision,
          'comment', '[redacted]',
          'decided_at', inserted_approval.decided_at
        ),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM inserted_approval
      RETURNING id
    ),
    task_audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${taskAuditId},
        updated_task.organisation_id,
        ${params.actor.userId},
        CASE
          WHEN updated_task.status = 'COMPLETED'
            THEN 'hr_lifecycle_task.completed'
          ELSE 'hr_lifecycle_task.reopened'
        END,
        'hr_lifecycle_task',
        updated_task.id::text,
        jsonb_build_object('status', 'AWAITING_APPROVAL'),
        jsonb_build_object(
          'status', updated_task.status,
          'completed_by', CASE WHEN updated_task.status = 'COMPLETED' THEN ${params.actor.userId} ELSE NULL END,
          'completed_at', updated_task.completed_at
        ),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM updated_task
      RETURNING id
    ),
    workflow_audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${workflowAuditId},
        ${params.actor.organisationId},
        ${params.actor.userId},
        'hr_lifecycle_workflow.completed',
        'hr_lifecycle_workflow',
        workflow_completed.id::text,
        jsonb_build_object('status', 'ACTIVE'),
        jsonb_build_object('status', workflow_completed.status, 'completed_at', workflow_completed.completed_at),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM workflow_completed
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM task_scope) AS task_exists,
      COALESCE((SELECT authorized FROM decision_scope), false) AS authorized,
      (SELECT requires_approval FROM task_scope) AS requires_approval,
      (SELECT previous_status FROM task_scope) AS previous_status,
      (SELECT workflow_status FROM task_scope) AS workflow_status,
      inserted_approval.id::text AS approval_id,
      inserted_approval.task_id::text AS task_id,
      inserted_approval.workflow_id::text AS workflow_id,
      inserted_approval.person_id::text AS person_id,
      inserted_approval.approver_user_id,
      inserted_approval.decision,
      inserted_approval.comment,
      inserted_approval.decided_at,
      updated_task.status AS task_status,
      updated_task.completed_at AS task_completed_at,
      COALESCE(
        (SELECT status FROM workflow_completed),
        CASE WHEN updated_task.id IS NOT NULL THEN 'ACTIVE' ELSE NULL END
      ) AS resulting_workflow_status,
      (SELECT completed_at FROM workflow_completed) AS workflow_completed_at,
      EXISTS (SELECT 1 FROM approval_audited) AS approval_audit_written,
      EXISTS (SELECT 1 FROM task_audited) AS task_audit_written,
      EXISTS (SELECT 1 FROM workflow_audited) AS workflow_audit_written
    FROM (SELECT 1) sentinel
    LEFT JOIN inserted_approval ON TRUE
    LEFT JOIN updated_task ON TRUE
    `,
  ]);

  const row = (mutationRows as ApprovalMutationRow[])[0];
  if (!row) throw new Error('Lifecycle approval returned no state row.');
  if (!row.task_exists) return { outcome: 'task_not_found' };
  if (!row.requires_approval) return { outcome: 'approval_not_required' };
  if (!row.authorized) return { outcome: 'forbidden' };

  // The post-lock task state takes precedence over the parent workflow state.
  // A race loser after final-task approval therefore remains a task conflict.
  if (row.previous_status !== 'AWAITING_APPROVAL' || !row.approval_id) {
    return { outcome: 'approval_no_longer_applicable' };
  }
  if (row.workflow_status !== 'ACTIVE') return { outcome: 'workflow_not_active' };

  if (
    !row.approval_audit_written
    || !row.task_audit_written
    || row.task_id === null
    || row.workflow_id === null
    || row.person_id === null
    || row.approver_user_id === null
    || row.decision === null
    || row.decided_at === null
    || row.task_status === null
    || row.resulting_workflow_status === null
  ) {
    throw new Error('Lifecycle approval audit was not written.');
  }

  if (row.resulting_workflow_status === 'COMPLETED' && !row.workflow_audit_written) {
    throw new Error('Lifecycle workflow completion audit was not written.');
  }

  return {
    outcome: 'recorded',
    approval: {
      id: row.approval_id,
      taskId: row.task_id,
      workflowId: row.workflow_id,
      personId: row.person_id,
      approverUserId: row.approver_user_id,
      decision: row.decision,
      comment: row.comment,
      decidedAt: row.decided_at,
    },
    task: {
      id: row.task_id,
      status: row.task_status,
      completedAt: row.task_completed_at,
    },
    workflow: {
      id: row.workflow_id,
      status: row.resulting_workflow_status,
      completedAt: row.workflow_completed_at,
    },
  };
}
