import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { logHrEvent } = await import('@/lib/hr/auditLog');

function sqlCallArgs(): unknown[] {
  return (sqlMock.mock.calls[0] as unknown as [string[], ...unknown[]]).slice(1);
}

function jsonStates(): Record<string, unknown>[] {
  return sqlCallArgs()
    .filter((arg): arg is string => typeof arg === 'string' && arg.startsWith('{'))
    .map((arg) => JSON.parse(arg) as Record<string, unknown>);
}

beforeEach(() => {
  sqlMock.mockClear();
});

describe('HR-7B lifecycle audit field policies', () => {
  it('template policy allows lifecycle metadata, id-projects creator, redacts prose, and omits structural fields', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_lifecycle_template.created',
        resourceType: 'hr_lifecycle_template',
        resourceId: 'template-1',
        afterState: {
          id: 'template-1',
          organisation_id: 'org-a',
          template_key: 'standard-onboarding',
          version_number: 1,
          lifecycle_type: 'onboarding',
          status: 'DRAFT',
          name: 'Executive onboarding',
          description: 'Sensitive operational detail',
          created_by: 'hr-user',
          future_secret_field: 'must never pass raw',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      template_key: 'standard-onboarding',
      version_number: 1,
      lifecycle_type: 'onboarding',
      status: 'DRAFT',
      name: '[redacted]',
      description: '[redacted]',
      created_by: 'hr-user',
      future_secret_field: '[redacted]',
    });
  });

  it('workflow policy retains status/date metadata and id-only lineage fields', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_lifecycle_workflow.started',
        resourceType: 'hr_lifecycle_workflow',
        resourceId: 'workflow-1',
        afterState: {
          organisation_id: 'org-a',
          person_id: 'person-1',
          template_id: 'template-1',
          lifecycle_type: 'onboarding',
          status: 'ACTIVE',
          anchor_date: '2026-10-01',
          started_by: 'hr-user',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      person_id: 'person-1',
      template_id: 'template-1',
      lifecycle_type: 'onboarding',
      status: 'ACTIVE',
      anchor_date: '2026-10-01',
      started_by: 'hr-user',
    });
  });

  it('task policy redacts title/description/waiver reason but keeps governed execution metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_lifecycle_task.completed',
        resourceType: 'hr_lifecycle_task',
        resourceId: 'task-1',
        afterState: {
          workflow_id: 'workflow-1',
          person_id: 'person-1',
          template_id: 'template-1',
          template_task_id: 'template-task-1',
          assigned_user_id: 'employee-user',
          responsibility_type: 'EMPLOYEE',
          approval_type: 'NONE',
          employee_visible: true,
          manager_visible: false,
          internal_only: false,
          status: 'COMPLETED',
          title: 'Provide bank details',
          description: 'Sensitive instructions',
          waiver_reason: 'Sensitive reason',
          completed_by: 'employee-user',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      workflow_id: 'workflow-1',
      person_id: 'person-1',
      template_id: 'template-1',
      template_task_id: 'template-task-1',
      assigned_user_id: 'employee-user',
      responsibility_type: 'EMPLOYEE',
      approval_type: 'NONE',
      employee_visible: true,
      manager_visible: false,
      internal_only: false,
      status: 'COMPLETED',
      title: '[redacted]',
      description: '[redacted]',
      waiver_reason: '[redacted]',
      completed_by: 'employee-user',
    });
  });

  it('approval policy redacts comment and records only identifiers + decision metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'manager-user' },
      {
        action: 'hr_lifecycle_task_approval.recorded',
        resourceType: 'hr_lifecycle_task_approval',
        resourceId: 'approval-1',
        afterState: {
          task_id: 'task-1',
          workflow_id: 'workflow-1',
          person_id: 'person-1',
          approver_user_id: 'manager-user',
          decision: 'APPROVED',
          comment: 'Contains employee-specific detail',
          decided_at: '2026-09-26T00:00:00Z',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      task_id: 'task-1',
      workflow_id: 'workflow-1',
      person_id: 'person-1',
      approver_user_id: 'manager-user',
      decision: 'APPROVED',
      comment: '[redacted]',
      decided_at: '2026-09-26T00:00:00Z',
    });
  });

  it('unregistered future hr_lifecycle resource types fail closed by redacting every field', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_lifecycle_future.created',
        resourceType: 'hr_lifecycle_future',
        resourceId: 'future-1',
        afterState: {
          innocent_looking_field: 'raw value must not leak',
          another_field: 123,
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      innocent_looking_field: '[redacted]',
      another_field: '[redacted]',
    });
  });
});
