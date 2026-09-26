import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

let responseQueue: unknown[][] = [];
let callCount = 0;
const calls: { text: string; values: unknown[] }[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responseQueue[callCount++] ?? []);
});

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) =>
    (sqlMock as unknown as (...a: unknown[]) => unknown)(
      ...(args as [TemplateStringsArray, ...unknown[]]),
    ),
}));

const {
  lifecycleNotFoundResponse,
  requireLifecycleTask,
  requireLifecycleWorkflow,
} = await import('@/lib/hr/lifecycleRoute');

const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

const EMPLOYEE_SESSION: OrgSession = {
  userId: 'employee-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer',
  name: 'Employee',
};

const MANAGER_SESSION: OrgSession = {
  userId: 'manager-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'Manager',
};

const OLD_MANAGER_SESSION: OrgSession = {
  ...MANAGER_SESSION,
  userId: 'old-manager',
};

const HR_ADMIN_SESSION: OrgSession = {
  userId: 'hr-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'admin',
  name: 'HR',
};

const SUPER_ADMIN_SESSION: OrgSession = {
  userId: 'founder-user',
  organisationId: 'org-b',
  homeOrganisationId: 'founder-org',
  role: 'super_admin',
  name: 'Founder',
};

function queue(...responses: unknown[][]) {
  responseQueue = responses;
  callCount = 0;
}

function workflowRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: WORKFLOW_ID,
    organisation_id: 'org-a',
    person_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    template_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lifecycle_type: 'onboarding',
    status: 'ACTIVE',
    anchor_date: '2026-10-01',
    started_by: 'hr-user',
    started_at: '2026-09-26T00:00:00.000Z',
    completed_at: null,
    cancelled_at: null,
    person_linked_user_id: 'employee-user',
    current_manager_linked_user_id: 'manager-user',
    is_hr_administrator: false,
    ...overrides,
  };
}

function taskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    organisation_id: 'org-a',
    workflow_id: WORKFLOW_ID,
    person_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    template_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    template_task_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sequence: 1,
    title: 'Complete details',
    description: null,
    responsibility_type: 'EMPLOYEE',
    assigned_user_id: 'employee-user',
    due_at: null,
    requires_approval: false,
    approval_type: 'NONE',
    employee_visible: true,
    manager_visible: false,
    internal_only: false,
    status: 'NOT_STARTED',
    person_linked_user_id: 'employee-user',
    current_manager_linked_user_id: 'manager-user',
    is_hr_administrator: false,
    ...overrides,
  };
}

async function expectCanonical404(
  result:
    | Awaited<ReturnType<typeof requireLifecycleWorkflow>>
    | Awaited<ReturnType<typeof requireLifecycleTask>>,
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected denied result');
  expect(result.response.status).toBe(404);
  expect(await result.response.json()).toEqual({
    error: 'Lifecycle resource not found.',
  });
}

beforeEach(() => {
  sqlMock.mockClear();
  calls.length = 0;
  responseQueue = [];
  callCount = 0;
});

describe('HR-7B canonical lifecycle 404', () => {
  it('has one stable body for resource-resolution failures', async () => {
    const response = lifecycleNotFoundResponse();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Lifecycle resource not found.',
    });
  });

  it('malformed workflow and task ids return the canonical 404 without a DB lookup', async () => {
    await expectCanonical404(await requireLifecycleWorkflow(EMPLOYEE_SESSION, 'bad-id'));
    await expectCanonical404(await requireLifecycleTask(EMPLOYEE_SESSION, 'also-bad'));
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('nonexistent/cross-org workflow collapses to the canonical 404 and query is active-org scoped', async () => {
    queue([]);
    const result = await requireLifecycleWorkflow(EMPLOYEE_SESSION, WORKFLOW_ID);
    await expectCanonical404(result);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/WHERE w\.id = \?::uuid[\s\S]*w\.organisation_id = \?/);
    expect(calls[0].values).toContain('org-a');
  });

  it('nonexistent/cross-org task collapses to the same canonical 404 and query is active-org scoped', async () => {
    queue([]);
    const result = await requireLifecycleTask(MANAGER_SESSION, TASK_ID);
    await expectCanonical404(result);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/WHERE t\.id = \?::uuid[\s\S]*t\.organisation_id = \?/);
    expect(calls[0].values).toContain('org-a');
  });

  it('same-org but inaccessible workflow returns the same canonical 404', async () => {
    queue([workflowRow({
      person_linked_user_id: 'someone-else',
      current_manager_linked_user_id: 'someone-else',
    })]);
    await expectCanonical404(await requireLifecycleWorkflow(EMPLOYEE_SESSION, WORKFLOW_ID));
  });

  it('same-org but inaccessible task returns the same canonical 404', async () => {
    queue([taskRow({ employee_visible: false, manager_visible: false })]);
    await expectCanonical404(await requireLifecycleTask(EMPLOYEE_SESSION, TASK_ID));
  });
});

describe('HR-7B lifecycle SQL-backed relationship resolution', () => {
  it('employee self access uses the explicit person linked_user_id', async () => {
    queue([workflowRow()]);
    const result = await requireLifecycleWorkflow(EMPLOYEE_SESSION, WORKFLOW_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected access');
    expect(result.auth.target.personLinkedUserId).toBe('employee-user');
    expect(calls[0].text).toContain('p.linked_user_id AS person_linked_user_id');
    expect(calls[0].text).not.toMatch(/email|phone|name\s*=/i);
  });

  it('manager access is resolved from the CURRENT hr_people.manager_person_id', async () => {
    queue([workflowRow()]);
    const result = await requireLifecycleWorkflow(MANAGER_SESSION, WORKFLOW_ID);
    expect(result.ok).toBe(true);
    expect(calls[0].text).toContain('manager.id = p.manager_person_id');
    expect(calls[0].text).toContain('manager.linked_user_id AS current_manager_linked_user_id');
  });

  it('former manager is denied immediately even if assigned_user_id is stale', async () => {
    queue([taskRow({
      responsibility_type: 'MANAGER',
      assigned_user_id: 'old-manager',
      employee_visible: false,
      manager_visible: true,
      current_manager_linked_user_id: 'manager-user',
    })]);
    const result = await requireLifecycleTask(OLD_MANAGER_SESSION, TASK_ID);
    await expectCanonical404(result);
  });

  it('task resolver verifies the HR-7A composite lineage chain in SQL', async () => {
    queue([taskRow()]);
    const result = await requireLifecycleTask(EMPLOYEE_SESSION, TASK_ID);
    expect(result.ok).toBe(true);
    expect(calls[0].text).toContain('w.organisation_id = t.organisation_id');
    expect(calls[0].text).toContain('w.id = t.workflow_id');
    expect(calls[0].text).toContain('w.person_id = t.person_id');
    expect(calls[0].text).toContain('w.template_id = t.template_id');
  });

  it('HR-admin authority is resolved from hr_administrators in the active org', async () => {
    queue([taskRow({ is_hr_administrator: true, internal_only: true, employee_visible: false })]);
    const result = await requireLifecycleTask(HR_ADMIN_SESSION, TASK_ID);
    expect(result.ok).toBe(true);
    expect(calls[0].text).toContain('FROM hr_administrators a');
    expect(calls[0].text).toContain('a.organisation_id = t.organisation_id');
    expect(calls[0].values).toContain('hr-user');
  });

  it('super_admin bypass remains constrained to the active organisation', async () => {
    queue([workflowRow({
      organisation_id: 'org-b',
      person_linked_user_id: null,
      current_manager_linked_user_id: null,
      is_hr_administrator: true,
    })]);
    const result = await requireLifecycleWorkflow(SUPER_ADMIN_SESSION, WORKFLOW_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected super_admin access');
    expect(result.workflow.organisationId).toBe('org-b');
    expect(calls[0].values).toContain(true);
    expect(calls[0].values).toContain('org-b');
  });

  it('super_admin still gets canonical 404 outside the active organisation', async () => {
    queue([]);
    await expectCanonical404(await requireLifecycleWorkflow(SUPER_ADMIN_SESSION, WORKFLOW_ID));
    expect(calls[0].values).toContain('org-b');
  });
});
