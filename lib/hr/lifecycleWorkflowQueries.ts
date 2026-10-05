import 'server-only';

import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import type { LifecycleTaskRow, LifecycleWorkflowRow } from './lifecycleRoute';

export type LifecycleWorkflowListFilters = {
  lifecycleType?: 'onboarding' | 'offboarding' | null;
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | null;
  personId?: string | null;
};

function mapWorkflow(row: Record<string, unknown>): LifecycleWorkflowRow {
  return {
    id: row.id as string,
    organisationId: row.organisation_id as string,
    personId: row.person_id as string,
    templateId: row.template_id as string,
    lifecycleType: row.lifecycle_type as 'onboarding' | 'offboarding',
    status: row.status as LifecycleWorkflowRow['status'],
    anchorDate: row.anchor_date as Date | string,
    startedBy: row.started_by as string,
    startedAt: row.started_at as Date | string,
    completedAt: (row.completed_at as Date | string | null) ?? null,
    cancelledAt: (row.cancelled_at as Date | string | null) ?? null,
  };
}

function mapTask(row: Record<string, unknown>): LifecycleTaskRow {
  return {
    id: row.id as string,
    organisationId: row.organisation_id as string,
    workflowId: row.workflow_id as string,
    personId: row.person_id as string,
    templateId: row.template_id as string,
    templateTaskId: row.template_task_id as string,
    sequence: Number(row.sequence),
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    responsibilityType: row.responsibility_type as LifecycleTaskRow['responsibilityType'],
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    dueAt: (row.due_at as Date | string | null) ?? null,
    requiresApproval: row.requires_approval === true,
    approvalType: row.approval_type as LifecycleTaskRow['approvalType'],
    employeeVisible: row.employee_visible === true,
    managerVisible: row.manager_visible === true,
    internalOnly: row.internal_only === true,
    status: row.status as LifecycleTaskRow['status'],
  };
}

export async function listLifecycleWorkflows(
  session: OrgSession,
  filters: LifecycleWorkflowListFilters,
): Promise<LifecycleWorkflowRow[]> {
  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      w.id, w.organisation_id, w.person_id, w.template_id, w.lifecycle_type,
      w.status, w.anchor_date, w.started_by, w.started_at, w.completed_at,
      w.cancelled_at
    FROM hr_lifecycle_workflows w
    JOIN hr_people p
      ON p.organisation_id = w.organisation_id
     AND p.id = w.person_id
    LEFT JOIN hr_people manager
      ON manager.organisation_id = p.organisation_id
     AND manager.id = p.manager_person_id
    WHERE w.organisation_id = ${session.organisationId}
      AND (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = w.organisation_id
            AND a.user_id = ${session.userId}
        )
        OR p.linked_user_id = ${session.userId}
        OR manager.linked_user_id = ${session.userId}
      )
      AND (${filters.lifecycleType ?? null}::text IS NULL OR w.lifecycle_type = ${filters.lifecycleType ?? null})
      AND (${filters.status ?? null}::text IS NULL OR w.status = ${filters.status ?? null})
      AND (${filters.personId ?? null}::uuid IS NULL OR w.person_id = ${filters.personId ?? null}::uuid)
    ORDER BY w.started_at DESC, w.id
  `;

  return rows.map(row => mapWorkflow(row as Record<string, unknown>));
}

export async function getVisibleLifecycleTasksForWorkflow(
  session: OrgSession,
  workflowId: string,
): Promise<LifecycleTaskRow[]> {
  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      t.id, t.organisation_id, t.workflow_id, t.person_id, t.template_id,
      t.template_task_id, t.sequence, t.title, t.description,
      t.responsibility_type, t.assigned_user_id, t.due_at,
      t.requires_approval, t.approval_type, t.employee_visible,
      t.manager_visible, t.internal_only, t.status
    FROM hr_lifecycle_tasks t
    JOIN hr_lifecycle_workflows w
      ON w.organisation_id = t.organisation_id
     AND w.id = t.workflow_id
     AND w.person_id = t.person_id
     AND w.template_id = t.template_id
    JOIN hr_people p
      ON p.organisation_id = w.organisation_id
     AND p.id = w.person_id
    LEFT JOIN hr_people manager
      ON manager.organisation_id = p.organisation_id
     AND manager.id = p.manager_person_id
    WHERE t.organisation_id = ${session.organisationId}
      AND t.workflow_id = ${workflowId}::uuid
      AND (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = t.organisation_id
            AND a.user_id = ${session.userId}
        )
        OR (
          t.internal_only = false
          AND t.employee_visible = true
          AND p.linked_user_id = ${session.userId}
        )
        OR (
          t.internal_only = false
          AND t.manager_visible = true
          AND manager.linked_user_id = ${session.userId}
        )
      )
    ORDER BY t.sequence, t.id
  `;

  return rows.map(row => mapTask(row as Record<string, unknown>));
}

export function lifecycleWorkflowToJson(workflow: LifecycleWorkflowRow) {
  return {
    id: workflow.id,
    person_id: workflow.personId,
    template_id: workflow.templateId,
    lifecycle_type: workflow.lifecycleType,
    status: workflow.status,
    anchor_date: workflow.anchorDate,
    started_by: workflow.startedBy,
    started_at: workflow.startedAt,
    completed_at: workflow.completedAt,
    cancelled_at: workflow.cancelledAt,
  };
}

export function lifecycleTaskToJson(task: LifecycleTaskRow) {
  return {
    id: task.id,
    template_task_id: task.templateTaskId,
    sequence: task.sequence,
    title: task.title,
    description: task.description,
    responsibility_type: task.responsibilityType,
    assigned_user_id: task.assignedUserId,
    due_at: task.dueAt,
    requires_approval: task.requiresApproval,
    approval_type: task.approvalType,
    employee_visible: task.employeeVisible,
    manager_visible: task.managerVisible,
    internal_only: task.internalOnly,
    status: task.status,
  };
}
