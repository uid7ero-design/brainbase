import 'server-only';

import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import {
  canViewLifecycleTask,
  canViewLifecycleWorkflow,
  type LifecycleActorContext,
  type LifecycleApprovalType,
  type LifecycleResponsibilityType,
  type LifecycleTaskAccessTarget,
  type LifecycleWorkflowAccessTarget,
} from './lifecycleAccess';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isLifecycleResourceId(value: string): boolean {
  return UUID_RE.test(value);
}

export function lifecycleNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'Lifecycle resource not found.' }, { status: 404 });
}

export type LifecycleWorkflowRow = {
  id: string;
  organisationId: string;
  personId: string;
  templateId: string;
  lifecycleType: 'onboarding' | 'offboarding';
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  anchorDate: Date | string;
  startedBy: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  cancelledAt: Date | string | null;
};

export type LifecycleTaskRow = {
  id: string;
  organisationId: string;
  workflowId: string;
  personId: string;
  templateId: string;
  templateTaskId: string;
  sequence: number;
  title: string;
  description: string | null;
  responsibilityType: LifecycleResponsibilityType;
  assignedUserId: string | null;
  dueAt: Date | string | null;
  requiresApproval: boolean;
  approvalType: LifecycleApprovalType;
  employeeVisible: boolean;
  managerVisible: boolean;
  internalOnly: boolean;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'WAIVED' | 'CANCELLED';
};

export type LifecycleAuthorizationFacts = {
  actor: LifecycleActorContext;
  target: LifecycleWorkflowAccessTarget;
};

export type LifecycleTaskAuthorizationFacts = {
  actor: LifecycleActorContext;
  target: LifecycleTaskAccessTarget;
};

export type LifecycleWorkflowRouteResult =
  | { ok: true; workflow: LifecycleWorkflowRow; auth: LifecycleAuthorizationFacts }
  | { ok: false; response: NextResponse };

export type LifecycleTaskRouteResult =
  | { ok: true; task: LifecycleTaskRow; auth: LifecycleTaskAuthorizationFacts }
  | { ok: false; response: NextResponse };

function actorFromRow(session: OrgSession, row: Record<string, unknown>): LifecycleActorContext {
  return {
    organisationId: session.organisationId,
    userId: session.userId,
    isHrAdministrator: row.is_hr_administrator === true,
  };
}

function workflowTargetFromRow(row: Record<string, unknown>): LifecycleWorkflowAccessTarget {
  return {
    organisationId: row.organisation_id as string,
    personLinkedUserId: (row.person_linked_user_id as string | null) ?? null,
    currentManagerLinkedUserId: (row.current_manager_linked_user_id as string | null) ?? null,
  };
}

/**
 * Resolves a workflow, current employee/manager relationship, and HR-admin
 * authority in one active-org-scoped query. Malformed, nonexistent, cross-org,
 * and inaccessible resources all collapse to the same canonical 404.
 */
export async function requireLifecycleWorkflow(
  session: OrgSession,
  workflowId: string,
): Promise<LifecycleWorkflowRouteResult> {
  if (!isLifecycleResourceId(workflowId)) {
    return { ok: false, response: lifecycleNotFoundResponse() };
  }

  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      w.id,
      w.organisation_id,
      w.person_id,
      w.template_id,
      w.lifecycle_type,
      w.status,
      w.anchor_date,
      w.started_by,
      w.started_at,
      w.completed_at,
      w.cancelled_at,
      p.linked_user_id AS person_linked_user_id,
      manager.linked_user_id AS current_manager_linked_user_id,
      (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = w.organisation_id
            AND a.user_id = ${session.userId}
        )
      ) AS is_hr_administrator
    FROM hr_lifecycle_workflows w
    JOIN hr_people p
      ON p.organisation_id = w.organisation_id
     AND p.id = w.person_id
    LEFT JOIN hr_people manager
      ON manager.organisation_id = p.organisation_id
     AND manager.id = p.manager_person_id
    WHERE w.id = ${workflowId}::uuid
      AND w.organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, response: lifecycleNotFoundResponse() };

  const actor = actorFromRow(session, row);
  const target = workflowTargetFromRow(row);

  if (!canViewLifecycleWorkflow(actor, target)) {
    return { ok: false, response: lifecycleNotFoundResponse() };
  }

  return {
    ok: true,
    workflow: {
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
    },
    auth: { actor, target },
  };
}

/**
 * Resolves task + workflow + current employee/manager relationship in one
 * active-org-scoped query. assigned_user_id is returned as data but is not an
 * authority source; live explicit HR relationships are authoritative.
 */
export async function requireLifecycleTask(
  session: OrgSession,
  taskId: string,
): Promise<LifecycleTaskRouteResult> {
  if (!isLifecycleResourceId(taskId)) {
    return { ok: false, response: lifecycleNotFoundResponse() };
  }

  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      t.id,
      t.organisation_id,
      t.workflow_id,
      t.person_id,
      t.template_id,
      t.template_task_id,
      t.sequence,
      t.title,
      t.description,
      t.responsibility_type,
      t.assigned_user_id,
      t.due_at,
      t.requires_approval,
      t.approval_type,
      t.employee_visible,
      t.manager_visible,
      t.internal_only,
      t.status,
      p.linked_user_id AS person_linked_user_id,
      manager.linked_user_id AS current_manager_linked_user_id,
      (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = t.organisation_id
            AND a.user_id = ${session.userId}
        )
      ) AS is_hr_administrator
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
    WHERE t.id = ${taskId}::uuid
      AND t.organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, response: lifecycleNotFoundResponse() };

  const actor = actorFromRow(session, row);
  const workflowTarget = workflowTargetFromRow(row);
  const target: LifecycleTaskAccessTarget = {
    ...workflowTarget,
    responsibilityType: row.responsibility_type as LifecycleResponsibilityType,
    approvalType: row.approval_type as LifecycleApprovalType,
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    employeeVisible: row.employee_visible === true,
    managerVisible: row.manager_visible === true,
    internalOnly: row.internal_only === true,
  };

  if (!canViewLifecycleTask(actor, target)) {
    return { ok: false, response: lifecycleNotFoundResponse() };
  }

  return {
    ok: true,
    task: {
      id: row.id as string,
      organisationId: row.organisation_id as string,
      workflowId: row.workflow_id as string,
      personId: row.person_id as string,
      templateId: row.template_id as string,
      templateTaskId: row.template_task_id as string,
      sequence: Number(row.sequence),
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      responsibilityType: row.responsibility_type as LifecycleResponsibilityType,
      assignedUserId: (row.assigned_user_id as string | null) ?? null,
      dueAt: (row.due_at as Date | string | null) ?? null,
      requiresApproval: row.requires_approval === true,
      approvalType: row.approval_type as LifecycleApprovalType,
      employeeVisible: row.employee_visible === true,
      managerVisible: row.manager_visible === true,
      internalOnly: row.internal_only === true,
      status: row.status as LifecycleTaskRow['status'],
    },
    auth: { actor, target },
  };
}
