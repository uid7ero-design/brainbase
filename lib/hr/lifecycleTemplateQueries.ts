import 'server-only';

import sql from '@/lib/db';
import type { LifecycleTemplateStatus } from './lifecycleTransitions';

export type LifecycleTemplateTaskView = {
  id: string;
  sequence: number;
  title: string;
  description: string | null;
  responsibilityType: 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
  dueOffsetDays: number | null;
  requiresApproval: boolean;
  approvalType: 'NONE' | 'MANAGER' | 'HR_ADMIN';
  employeeVisible: boolean;
  managerVisible: boolean;
  internalOnly: boolean;
};

export type LifecycleTemplateView = {
  id: string;
  organisationId: string;
  templateKey: string;
  versionNumber: number;
  lifecycleType: 'onboarding' | 'offboarding';
  name: string;
  description: string | null;
  status: LifecycleTemplateStatus;
  activatedAt: Date | string | null;
  retiredAt: Date | string | null;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  tasks?: LifecycleTemplateTaskView[];
};

function mapTemplate(row: Record<string, unknown>): LifecycleTemplateView {
  return {
    id: row.id as string,
    organisationId: row.organisation_id as string,
    templateKey: row.template_key as string,
    versionNumber: Number(row.version_number),
    lifecycleType: row.lifecycle_type as 'onboarding' | 'offboarding',
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    status: row.status as LifecycleTemplateStatus,
    activatedAt: (row.activated_at as Date | string | null) ?? null,
    retiredAt: (row.retired_at as Date | string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date | string,
    updatedAt: row.updated_at as Date | string,
  };
}

export async function listLifecycleTemplates(params: {
  organisationId: string;
  lifecycleType?: 'onboarding' | 'offboarding' | null;
  status?: LifecycleTemplateStatus | null;
  templateKey?: string | null;
}): Promise<LifecycleTemplateView[]> {
  const rows = await sql`
    SELECT *
    FROM hr_lifecycle_templates
    WHERE organisation_id = ${params.organisationId}
      AND (${params.lifecycleType ?? null}::text IS NULL OR lifecycle_type = ${params.lifecycleType ?? null})
      AND (${params.status ?? null}::text IS NULL OR status = ${params.status ?? null})
      AND (${params.templateKey ?? null}::text IS NULL OR template_key = ${params.templateKey ?? null})
    ORDER BY template_key, version_number DESC
  `;
  return rows.map(row => mapTemplate(row as Record<string, unknown>));
}

export async function getLifecycleTemplate(
  organisationId: string,
  templateId: string,
): Promise<LifecycleTemplateView | null> {
  const [templateRows, taskRows] = await Promise.all([
    sql`
      SELECT *
      FROM hr_lifecycle_templates
      WHERE organisation_id = ${organisationId}
        AND id = ${templateId}::uuid
      LIMIT 1
    `,
    sql`
      SELECT *
      FROM hr_lifecycle_template_tasks
      WHERE organisation_id = ${organisationId}
        AND template_id = ${templateId}::uuid
      ORDER BY sequence
    `,
  ]);

  const row = templateRows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    ...mapTemplate(row),
    tasks: taskRows.map(raw => {
      const task = raw as Record<string, unknown>;
      return {
        id: task.id as string,
        sequence: Number(task.sequence),
        title: task.title as string,
        description: (task.description as string | null) ?? null,
        responsibilityType: task.responsibility_type as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN',
        dueOffsetDays: task.due_offset_days === null ? null : Number(task.due_offset_days),
        requiresApproval: task.requires_approval === true,
        approvalType: task.approval_type as 'NONE' | 'MANAGER' | 'HR_ADMIN',
        employeeVisible: task.employee_visible === true,
        managerVisible: task.manager_visible === true,
        internalOnly: task.internal_only === true,
      };
    }),
  };
}


export function lifecycleTemplateToJson(template: LifecycleTemplateView) {
  return {
    id: template.id,
    template_key: template.templateKey,
    version_number: template.versionNumber,
    lifecycle_type: template.lifecycleType,
    name: template.name,
    description: template.description,
    status: template.status,
    activated_at: template.activatedAt,
    retired_at: template.retiredAt,
    created_by: template.createdBy,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
    ...(template.tasks
      ? {
          tasks: template.tasks.map(task => ({
            id: task.id,
            sequence: task.sequence,
            title: task.title,
            description: task.description,
            responsibility_type: task.responsibilityType,
            due_offset_days: task.dueOffsetDays,
            requires_approval: task.requiresApproval,
            approval_type: task.approvalType,
            employee_visible: task.employeeVisible,
            manager_visible: task.managerVisible,
            internal_only: task.internalOnly,
          })),
        }
      : {}),
  };
}
