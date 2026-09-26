import 'server-only';

import sql from '@/lib/db';

export type LifecycleWorkflowMutationActor = {
  organisationId: string;
  userId: string;
  isSuperAdmin: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type StartLifecycleWorkflowParams = {
  actor: LifecycleWorkflowMutationActor;
  personId: string;
  templateId: string;
  anchorDate: string;
};

export type StartLifecycleWorkflowResult =
  | {
      outcome: 'started';
      workflowId: string;
    }
  | { outcome: 'person_not_found' }
  | { outcome: 'template_not_found' }
  | { outcome: 'template_not_active' }
  | { outcome: 'workflow_already_active' }
  | { outcome: 'forbidden' };

type StartWorkflowRow = {
  allowed: boolean;
  person_exists: boolean;
  template_exists: boolean;
  template_status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | null;
  lifecycle_type: 'onboarding' | 'offboarding' | null;
  existing_active: boolean;
  workflow_id: string | null;
  task_count: number;
  audit_written: boolean;
};

function startLockKey(
  organisationId: string,
  personId: string,
): string {
  // Person-level serialization is deliberately a little coarser than the
  // database's (person,lifecycle_type) uniqueness rule. It avoids any
  // pre-transaction template read while still serializing competing starts.
  return `hr-lifecycle-workflow-start:${organisationId}:${personId}`;
}

export async function startLifecycleWorkflow(
  params: StartLifecycleWorkflowParams,
): Promise<StartLifecycleWorkflowResult> {
  const workflowId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${startLockKey(
            params.actor.organisationId,
            params.personId,
          )},
          0
        )
      ) AS locked
    `,
    txn`
      WITH admin_scope AS MATERIALIZED (
        SELECT (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1
            FROM hr_administrators a
            WHERE a.organisation_id = ${params.actor.organisationId}
              AND a.user_id = ${params.actor.userId}
          )
        ) AS allowed
      ),
      person_scope AS MATERIALIZED (
        SELECT
          p.id,
          p.organisation_id,
          p.linked_user_id,
          manager.linked_user_id AS manager_linked_user_id
        FROM hr_people p
        LEFT JOIN hr_people manager
          ON manager.organisation_id = p.organisation_id
         AND manager.id = p.manager_person_id
        WHERE p.organisation_id = ${params.actor.organisationId}
          AND p.id = ${params.personId}::uuid
        LIMIT 1
      ),
      template_scope AS MATERIALIZED (
        SELECT
          t.id,
          t.organisation_id,
          t.lifecycle_type,
          t.status,
          (
            SELECT count(*)::int
            FROM hr_lifecycle_template_tasks task
            WHERE task.organisation_id = t.organisation_id
              AND task.template_id = t.id
          ) AS task_count
        FROM hr_lifecycle_templates t
        WHERE t.organisation_id = ${params.actor.organisationId}
          AND t.id = ${params.templateId}::uuid
        LIMIT 1
      ),
      existing_active AS MATERIALIZED (
        SELECT 1
        FROM hr_lifecycle_workflows w
        JOIN template_scope t
          ON t.organisation_id = w.organisation_id
         AND t.lifecycle_type = w.lifecycle_type
        WHERE w.organisation_id = ${params.actor.organisationId}
          AND w.person_id = ${params.personId}::uuid
          AND w.status = 'ACTIVE'
        LIMIT 1
      ),
      inserted_workflow AS (
        INSERT INTO hr_lifecycle_workflows (
          id,
          organisation_id,
          person_id,
          template_id,
          lifecycle_type,
          status,
          anchor_date,
          started_by
        )
        SELECT
          ${workflowId}::uuid,
          template_scope.organisation_id,
          person_scope.id,
          template_scope.id,
          template_scope.lifecycle_type,
          'ACTIVE',
          ${params.anchorDate}::date,
          ${params.actor.userId}
        FROM admin_scope, person_scope, template_scope
        WHERE admin_scope.allowed = true
          AND template_scope.status = 'ACTIVE'
          AND template_scope.task_count > 0
          AND NOT EXISTS (SELECT 1 FROM existing_active)
        RETURNING *
      ),
      inserted_tasks AS (
        INSERT INTO hr_lifecycle_tasks (
          id,
          organisation_id,
          workflow_id,
          person_id,
          template_id,
          template_task_id,
          sequence,
          title,
          description,
          responsibility_type,
          assigned_user_id,
          due_at,
          requires_approval,
          approval_type,
          employee_visible,
          manager_visible,
          internal_only,
          status
        )
        SELECT
          gen_random_uuid(),
          inserted_workflow.organisation_id,
          inserted_workflow.id,
          inserted_workflow.person_id,
          inserted_workflow.template_id,
          task.id,
          task.sequence,
          task.title,
          task.description,
          task.responsibility_type,
          CASE
            WHEN task.responsibility_type = 'EMPLOYEE'
              THEN person_scope.linked_user_id
            WHEN task.responsibility_type = 'MANAGER'
              THEN person_scope.manager_linked_user_id
            ELSE NULL
          END,
          CASE
            WHEN task.due_offset_days IS NULL THEN NULL
            ELSE (
              (
                inserted_workflow.anchor_date::timestamp
                + make_interval(days => task.due_offset_days)
              ) AT TIME ZONE 'UTC'
            )
          END,
          task.requires_approval,
          task.approval_type,
          task.employee_visible,
          task.manager_visible,
          task.internal_only,
          'NOT_STARTED'
        FROM inserted_workflow
        CROSS JOIN person_scope
        JOIN hr_lifecycle_template_tasks task
          ON task.organisation_id = inserted_workflow.organisation_id
         AND task.template_id = inserted_workflow.template_id
        RETURNING id
      ),
      audited AS (
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
          ${auditId},
          inserted_workflow.organisation_id,
          ${params.actor.userId},
          'hr_lifecycle_workflow.started',
          'hr_lifecycle_workflow',
          inserted_workflow.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'person_id', inserted_workflow.person_id::text,
            'template_id', inserted_workflow.template_id::text,
            'lifecycle_type', inserted_workflow.lifecycle_type,
            'status', inserted_workflow.status,
            'anchor_date', inserted_workflow.anchor_date,
            'started_by', inserted_workflow.started_by,
            'started_at', inserted_workflow.started_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted_workflow
        RETURNING id
      )
      SELECT
        (SELECT allowed FROM admin_scope) AS allowed,
        EXISTS (SELECT 1 FROM person_scope) AS person_exists,
        EXISTS (SELECT 1 FROM template_scope) AS template_exists,
        (SELECT status FROM template_scope) AS template_status,
        (SELECT lifecycle_type FROM template_scope) AS lifecycle_type,
        EXISTS (SELECT 1 FROM existing_active) AS existing_active,
        inserted_workflow.id::text AS workflow_id,
        (SELECT count(*)::int FROM inserted_tasks) AS task_count,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted_workflow ON TRUE
    `,
  ]);

  const row = rows[0] as StartWorkflowRow | undefined;
  if (!row) throw new Error('Lifecycle workflow start returned no state row.');
  if (!row.allowed) return { outcome: 'forbidden' };
  if (!row.person_exists) return { outcome: 'person_not_found' };
  if (!row.template_exists) return { outcome: 'template_not_found' };
  if (row.template_status !== 'ACTIVE') return { outcome: 'template_not_active' };
  if (row.existing_active) return { outcome: 'workflow_already_active' };
  if (!row.workflow_id || !row.audit_written) {
    throw new Error('Lifecycle workflow start did not persist business and audit state.');
  }
  if (row.task_count <= 0) {
    throw new Error('Lifecycle workflow start produced no task snapshots.');
  }

  return { outcome: 'started', workflowId: row.workflow_id };
}

export type CancelLifecycleWorkflowResult =
  | {
      outcome: 'cancelled';
      workflowId: string;
      cancelledAt: Date | string;
    }
  | {
      outcome: 'already_cancelled';
      workflowId: string;
      cancelledAt: Date | string;
    }
  | { outcome: 'already_completed' }
  | { outcome: 'forbidden' }
  | { outcome: 'workflow_not_found' };

type CancelWorkflowRow = {
  workflow_exists: boolean;
  allowed: boolean;
  previous_status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | null;
  previous_cancelled_at: Date | string | null;
  workflow_id: string | null;
  cancelled_at: Date | string | null;
  audit_written: boolean;
};

export async function cancelLifecycleWorkflow(params: {
  actor: LifecycleWorkflowMutationActor;
  workflowId: string;
}): Promise<CancelLifecycleWorkflowResult> {
  const auditId = crypto.randomUUID();

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended('hr-lifecycle-workflow:' || w.id::text, 0)
      ) AS locked
      FROM hr_lifecycle_workflows w
      WHERE w.organisation_id = ${params.actor.organisationId}
        AND w.id = ${params.workflowId}::uuid
    `,
    txn`
      WITH workflow_scope AS MATERIALIZED (
        SELECT
          w.id,
          w.organisation_id,
          w.status AS previous_status,
          w.cancelled_at AS previous_cancelled_at,
          (
            ${params.actor.isSuperAdmin}
            OR EXISTS (
              SELECT 1
              FROM hr_administrators a
              WHERE a.organisation_id = w.organisation_id
                AND a.user_id = ${params.actor.userId}
            )
          ) AS allowed
        FROM hr_lifecycle_workflows w
        WHERE w.organisation_id = ${params.actor.organisationId}
          AND w.id = ${params.workflowId}::uuid
        LIMIT 1
        FOR SHARE OF w
      ),
      cancelled_workflow AS (
        UPDATE hr_lifecycle_workflows w
        SET
          status = 'CANCELLED',
          cancelled_at = NOW(),
          completed_at = NULL,
          updated_at = NOW()
        FROM workflow_scope
        WHERE w.id = workflow_scope.id
          AND w.organisation_id = workflow_scope.organisation_id
          AND workflow_scope.allowed = true
          AND workflow_scope.previous_status = 'ACTIVE'
        RETURNING w.id, w.organisation_id, w.cancelled_at
      ),
      cancelled_tasks AS (
        UPDATE hr_lifecycle_tasks t
        SET
          status = 'CANCELLED',
          completed_by = NULL,
          completed_at = NULL,
          waived_by = NULL,
          waived_at = NULL,
          waiver_reason = NULL,
          updated_at = NOW()
        FROM cancelled_workflow w
        WHERE t.organisation_id = w.organisation_id
          AND t.workflow_id = w.id
          AND t.status NOT IN ('COMPLETED', 'WAIVED', 'CANCELLED')
        RETURNING t.id
      ),
      audited AS (
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
          ${auditId},
          cancelled_workflow.organisation_id,
          ${params.actor.userId},
          'hr_lifecycle_workflow.cancelled',
          'hr_lifecycle_workflow',
          cancelled_workflow.id::text,
          jsonb_build_object('status', 'ACTIVE'),
          jsonb_build_object(
            'status', 'CANCELLED',
            'cancelled_at', cancelled_workflow.cancelled_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM cancelled_workflow
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM workflow_scope) AS workflow_exists,
        COALESCE((SELECT allowed FROM workflow_scope), false) AS allowed,
        (SELECT previous_status FROM workflow_scope) AS previous_status,
        (SELECT previous_cancelled_at FROM workflow_scope) AS previous_cancelled_at,
        cancelled_workflow.id::text AS workflow_id,
        cancelled_workflow.cancelled_at,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN cancelled_workflow ON TRUE
    `,
  ]);

  const row = rows[0] as CancelWorkflowRow | undefined;
  if (!row) throw new Error('Lifecycle workflow cancellation returned no state row.');
  if (!row.workflow_exists) return { outcome: 'workflow_not_found' };
  if (!row.allowed) return { outcome: 'forbidden' };
  if (row.previous_status === 'COMPLETED') return { outcome: 'already_completed' };
  if (row.previous_status === 'CANCELLED') {
    if (!row.previous_cancelled_at) {
      throw new Error('Cancelled lifecycle workflow is missing cancelled_at.');
    }
    return {
      outcome: 'already_cancelled',
      workflowId: params.workflowId,
      cancelledAt: row.previous_cancelled_at,
    };
  }
  if (!row.workflow_id || !row.cancelled_at || !row.audit_written) {
    throw new Error('Lifecycle workflow cancellation did not persist audit state.');
  }

  return {
    outcome: 'cancelled',
    workflowId: row.workflow_id,
    cancelledAt: row.cancelled_at,
  };
}
