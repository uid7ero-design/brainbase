import 'server-only';

import sql from '@/lib/db';
import type { LifecycleTemplateInput } from './lifecycleTemplateDomain';

export type LifecycleTemplateMutationActor = {
  organisationId: string;
  userId: string;
  isSuperAdmin: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type LifecycleTemplateMutationResult =
  | { outcome: 'created'; templateId: string; versionNumber: number }
  | { outcome: 'activated'; templateId: string }
  | { outcome: 'retired'; templateId: string }
  | { outcome: 'already_active'; templateId: string }
  | { outcome: 'already_retired'; templateId: string }
  | { outcome: 'family_exists' }
  | { outcome: 'active_version_exists' }
  | { outcome: 'invalid_transition' }
  | { outcome: 'forbidden' }
  | { outcome: 'template_not_found' };

function familyLockKey(organisationId: string, templateKey: string): string {
  return `hr-lifecycle-template-family:${organisationId}:${templateKey}`;
}

function taskJson(input: LifecycleTemplateInput): string {
  return JSON.stringify(input.tasks.map(task => ({
    id: crypto.randomUUID(),
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
  })));
}

export async function createLifecycleTemplate(params: {
  actor: LifecycleTemplateMutationActor;
  input: LifecycleTemplateInput & { templateKey: string; lifecycleType: 'onboarding' | 'offboarding' };
}): Promise<LifecycleTemplateMutationResult> {
  const templateId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const tasks = taskJson(params.input);

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${familyLockKey(params.actor.organisationId, params.input.templateKey)}, 0)
      ) AS locked
    `,
    txn`
      WITH admin_scope AS MATERIALIZED (
        SELECT (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1 FROM hr_administrators a
            WHERE a.organisation_id = ${params.actor.organisationId}
              AND a.user_id = ${params.actor.userId}
          )
        ) AS allowed
      ),
      existing AS MATERIALIZED (
        SELECT 1
        FROM hr_lifecycle_templates
        WHERE organisation_id = ${params.actor.organisationId}
          AND template_key = ${params.input.templateKey}
        LIMIT 1
      ),
      inserted AS (
        INSERT INTO hr_lifecycle_templates (
          id, organisation_id, template_key, version_number, lifecycle_type,
          name, description, status, created_by
        )
        SELECT
          ${templateId}::uuid,
          ${params.actor.organisationId},
          ${params.input.templateKey},
          1,
          ${params.input.lifecycleType},
          ${params.input.name},
          ${params.input.description},
          'DRAFT',
          ${params.actor.userId}
        FROM admin_scope
        WHERE allowed = true
          AND NOT EXISTS (SELECT 1 FROM existing)
        RETURNING *
      ),
      inserted_tasks AS (
        INSERT INTO hr_lifecycle_template_tasks (
          id, organisation_id, template_id, sequence, title, description,
          responsibility_type, due_offset_days, requires_approval, approval_type,
          employee_visible, manager_visible, internal_only
        )
        SELECT
          x.id,
          inserted.organisation_id,
          inserted.id,
          x.sequence,
          x.title,
          x.description,
          x.responsibility_type,
          x.due_offset_days,
          x.requires_approval,
          x.approval_type,
          x.employee_visible,
          x.manager_visible,
          x.internal_only
        FROM inserted
        CROSS JOIN jsonb_to_recordset(${tasks}::jsonb) AS x(
          id uuid,
          sequence integer,
          title text,
          description text,
          responsibility_type text,
          due_offset_days integer,
          requires_approval boolean,
          approval_type text,
          employee_visible boolean,
          manager_visible boolean,
          internal_only boolean
        )
        RETURNING id
      ),
      audited AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          inserted.organisation_id,
          ${params.actor.userId},
          'hr_lifecycle_template.created',
          'hr_lifecycle_template',
          inserted.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'template_key', inserted.template_key,
            'version_number', inserted.version_number,
            'lifecycle_type', inserted.lifecycle_type,
            'status', inserted.status,
            'created_by', inserted.created_by
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted
        RETURNING id
      )
      SELECT
        (SELECT allowed FROM admin_scope) AS allowed,
        EXISTS (SELECT 1 FROM existing) AS family_exists,
        inserted.id::text AS template_id,
        inserted.version_number,
        (SELECT count(*)::int FROM inserted_tasks) AS task_count,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted ON TRUE
    `,
  ]);

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('Lifecycle template creation returned no state row.');
  if (row.allowed !== true) return { outcome: 'forbidden' };
  if (row.family_exists === true) return { outcome: 'family_exists' };
  if (!row.template_id) throw new Error('Lifecycle template was not created.');
  if (Number(row.task_count) !== params.input.tasks.length || row.audit_written !== true) {
    throw new Error('Lifecycle template creation did not persist all tasks and audit state.');
  }
  return {
    outcome: 'created',
    templateId: row.template_id as string,
    versionNumber: Number(row.version_number),
  };
}

export async function createLifecycleTemplateVersion(params: {
  actor: LifecycleTemplateMutationActor;
  sourceTemplateId: string;
  input: LifecycleTemplateInput;
}): Promise<LifecycleTemplateMutationResult> {
  const templateId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const tasks = taskJson(params.input);

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          'hr-lifecycle-template-family:' || t.organisation_id || ':' || t.template_key,
          0
        )
      ) AS locked
      FROM hr_lifecycle_templates t
      WHERE t.organisation_id = ${params.actor.organisationId}
        AND t.id = ${params.sourceTemplateId}::uuid
    `,
    txn`
      WITH source AS MATERIALIZED (
        SELECT *
        FROM hr_lifecycle_templates
        WHERE organisation_id = ${params.actor.organisationId}
          AND id = ${params.sourceTemplateId}::uuid
        LIMIT 1
      ),
      admin_scope AS MATERIALIZED (
        SELECT (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1 FROM hr_administrators a
            WHERE a.organisation_id = ${params.actor.organisationId}
              AND a.user_id = ${params.actor.userId}
          )
        ) AS allowed
      ),
      next_version AS MATERIALIZED (
        SELECT COALESCE(max(t.version_number), 0) + 1 AS version_number
        FROM hr_lifecycle_templates t
        JOIN source s
          ON s.organisation_id = t.organisation_id
         AND s.template_key = t.template_key
      ),
      inserted AS (
        INSERT INTO hr_lifecycle_templates (
          id, organisation_id, template_key, version_number, lifecycle_type,
          name, description, status, created_by
        )
        SELECT
          ${templateId}::uuid,
          source.organisation_id,
          source.template_key,
          next_version.version_number,
          source.lifecycle_type,
          ${params.input.name},
          ${params.input.description},
          'DRAFT',
          ${params.actor.userId}
        FROM source, next_version, admin_scope
        WHERE admin_scope.allowed = true
        RETURNING *
      ),
      inserted_tasks AS (
        INSERT INTO hr_lifecycle_template_tasks (
          id, organisation_id, template_id, sequence, title, description,
          responsibility_type, due_offset_days, requires_approval, approval_type,
          employee_visible, manager_visible, internal_only
        )
        SELECT
          x.id,
          inserted.organisation_id,
          inserted.id,
          x.sequence,
          x.title,
          x.description,
          x.responsibility_type,
          x.due_offset_days,
          x.requires_approval,
          x.approval_type,
          x.employee_visible,
          x.manager_visible,
          x.internal_only
        FROM inserted
        CROSS JOIN jsonb_to_recordset(${tasks}::jsonb) AS x(
          id uuid,
          sequence integer,
          title text,
          description text,
          responsibility_type text,
          due_offset_days integer,
          requires_approval boolean,
          approval_type text,
          employee_visible boolean,
          manager_visible boolean,
          internal_only boolean
        )
        RETURNING id
      ),
      audited AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          inserted.organisation_id,
          ${params.actor.userId},
          'hr_lifecycle_template.versioned',
          'hr_lifecycle_template',
          inserted.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'template_key', inserted.template_key,
            'version_number', inserted.version_number,
            'lifecycle_type', inserted.lifecycle_type,
            'status', inserted.status,
            'created_by', inserted.created_by
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted
        RETURNING id
      )
      SELECT
        (SELECT allowed FROM admin_scope) AS allowed,
        EXISTS (SELECT 1 FROM source) AS source_exists,
        inserted.id::text AS template_id,
        inserted.version_number,
        (SELECT count(*)::int FROM inserted_tasks) AS task_count,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted ON TRUE
    `,
  ]);

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('Lifecycle template versioning returned no state row.');
  if (row.allowed !== true) return { outcome: 'forbidden' };
  if (row.source_exists !== true) return { outcome: 'template_not_found' };
  if (!row.template_id) throw new Error('Lifecycle template version was not created.');
  if (Number(row.task_count) !== params.input.tasks.length || row.audit_written !== true) {
    throw new Error('Lifecycle template versioning did not persist all tasks and audit state.');
  }
  return {
    outcome: 'created',
    templateId: row.template_id as string,
    versionNumber: Number(row.version_number),
  };
}

export async function activateLifecycleTemplate(params: {
  actor: LifecycleTemplateMutationActor;
  templateId: string;
}): Promise<LifecycleTemplateMutationResult> {
  const auditId = crypto.randomUUID();

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          'hr-lifecycle-template-family:' || t.organisation_id || ':' || t.template_key,
          0
        )
      ) AS locked
      FROM hr_lifecycle_templates t
      WHERE t.organisation_id = ${params.actor.organisationId}
        AND t.id = ${params.templateId}::uuid
    `,
    txn`
      WITH target AS MATERIALIZED (
        SELECT *
        FROM hr_lifecycle_templates
        WHERE organisation_id = ${params.actor.organisationId}
          AND id = ${params.templateId}::uuid
        LIMIT 1
      ),
      admin_scope AS MATERIALIZED (
        SELECT (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1 FROM hr_administrators a
            WHERE a.organisation_id = ${params.actor.organisationId}
              AND a.user_id = ${params.actor.userId}
          )
        ) AS allowed
      ),
      other_active AS MATERIALIZED (
        SELECT 1
        FROM hr_lifecycle_templates t
        JOIN target ON target.organisation_id = t.organisation_id
                   AND target.template_key = t.template_key
        WHERE t.status = 'ACTIVE'
          AND t.id <> target.id
        LIMIT 1
      ),
      updated AS (
        UPDATE hr_lifecycle_templates t
        SET status = 'ACTIVE', activated_at = NOW(), retired_at = NULL, updated_at = NOW()
        FROM target, admin_scope
        WHERE t.id = target.id
          AND t.organisation_id = target.organisation_id
          AND admin_scope.allowed = true
          AND target.status = 'DRAFT'
          AND NOT EXISTS (SELECT 1 FROM other_active)
        RETURNING t.*
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
          'hr_lifecycle_template.activated',
          'hr_lifecycle_template',
          updated.id::text,
          jsonb_build_object('status', 'DRAFT'),
          jsonb_build_object('status', updated.status, 'activated_at', updated.activated_at),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM updated
        RETURNING id
      )
      SELECT
        (SELECT allowed FROM admin_scope) AS allowed,
        EXISTS (SELECT 1 FROM target) AS target_exists,
        (SELECT status FROM target) AS previous_status,
        EXISTS (SELECT 1 FROM other_active) AS other_active_exists,
        updated.id::text AS template_id,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN updated ON TRUE
    `,
  ]);

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('Lifecycle template activation returned no state row.');
  if (row.allowed !== true) return { outcome: 'forbidden' };
  if (row.target_exists !== true) return { outcome: 'template_not_found' };
  if (row.previous_status === 'ACTIVE') {
    return { outcome: 'already_active', templateId: params.templateId };
  }
  if (row.previous_status !== 'DRAFT') return { outcome: 'invalid_transition' };
  if (row.other_active_exists === true) return { outcome: 'active_version_exists' };
  if (!row.template_id || row.audit_written !== true) {
    throw new Error('Lifecycle template activation did not persist audit state.');
  }
  return { outcome: 'activated', templateId: row.template_id as string };
}

export async function retireLifecycleTemplate(params: {
  actor: LifecycleTemplateMutationActor;
  templateId: string;
}): Promise<LifecycleTemplateMutationResult> {
  const auditId = crypto.randomUUID();

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          'hr-lifecycle-template-family:' || t.organisation_id || ':' || t.template_key,
          0
        )
      ) AS locked
      FROM hr_lifecycle_templates t
      WHERE t.organisation_id = ${params.actor.organisationId}
        AND t.id = ${params.templateId}::uuid
    `,
    txn`
      WITH target AS MATERIALIZED (
        SELECT *
        FROM hr_lifecycle_templates
        WHERE organisation_id = ${params.actor.organisationId}
          AND id = ${params.templateId}::uuid
        LIMIT 1
      ),
      admin_scope AS MATERIALIZED (
        SELECT (
          ${params.actor.isSuperAdmin}
          OR EXISTS (
            SELECT 1 FROM hr_administrators a
            WHERE a.organisation_id = ${params.actor.organisationId}
              AND a.user_id = ${params.actor.userId}
          )
        ) AS allowed
      ),
      updated AS (
        UPDATE hr_lifecycle_templates t
        SET status = 'RETIRED', retired_at = NOW(), updated_at = NOW()
        FROM target, admin_scope
        WHERE t.id = target.id
          AND t.organisation_id = target.organisation_id
          AND admin_scope.allowed = true
          AND target.status IN ('DRAFT', 'ACTIVE')
        RETURNING t.*, target.status AS previous_status
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
          'hr_lifecycle_template.retired',
          'hr_lifecycle_template',
          updated.id::text,
          jsonb_build_object('status', updated.previous_status),
          jsonb_build_object(
            'status', updated.status,
            'activated_at', updated.activated_at,
            'retired_at', updated.retired_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM updated
        RETURNING id
      )
      SELECT
        (SELECT allowed FROM admin_scope) AS allowed,
        EXISTS (SELECT 1 FROM target) AS target_exists,
        (SELECT status FROM target) AS previous_status,
        updated.id::text AS template_id,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN updated ON TRUE
    `,
  ]);

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('Lifecycle template retirement returned no state row.');
  if (row.allowed !== true) return { outcome: 'forbidden' };
  if (row.target_exists !== true) return { outcome: 'template_not_found' };
  if (row.previous_status === 'RETIRED') {
    return { outcome: 'already_retired', templateId: params.templateId };
  }
  if (!row.template_id || row.audit_written !== true) {
    throw new Error('Lifecycle template retirement did not persist audit state.');
  }
  return { outcome: 'retired', templateId: row.template_id as string };
}
