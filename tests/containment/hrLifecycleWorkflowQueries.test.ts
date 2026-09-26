import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

type QuerySpec = { text: string; values: unknown[] };
let responses: unknown[][] = [];
let callCount = 0;
const calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responses[callCount++] ?? []);
});

vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) =>
  (sqlMock as unknown as (...a: unknown[]) => unknown)(
    ...(args as [TemplateStringsArray, ...unknown[]]),
  ),
}));

const {
  listLifecycleWorkflows,
  getVisibleLifecycleTasksForWorkflow,
} = await import('@/lib/hr/lifecycleWorkflowQueries');

const SESSION: OrgSession = {
  userId: 'employee-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer',
  name: 'Employee',
};

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls.length = 0;
  sqlMock.mockClear();
});

describe('HR-7C viewer-scoped lifecycle workflow queries', () => {
  it('scopes workflow list in SQL to active org and explicit employee/current-manager/admin relationships', async () => {
    responses = [[]];

    await listLifecycleWorkflows(SESSION, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('w.organisation_id = ?');
    expect(calls[0].text).toContain('FROM hr_administrators a');
    expect(calls[0].text).toContain('p.linked_user_id = ?');
    expect(calls[0].text).toContain('manager.linked_user_id = ?');
    expect(calls[0].text).toContain('manager.id = p.manager_person_id');
    expect(calls[0].values).toContain('org-a');
    expect(calls[0].values).toContain('employee-user');
    expect(calls[0].text).not.toMatch(/email|phone/i);
  });

  it('keeps person filter inside the already viewer-scoped SQL query', async () => {
    responses = [[]];

    await listLifecycleWorkflows(SESSION, {
      personId: '11111111-1111-4111-8111-111111111111',
      lifecycleType: 'onboarding',
      status: 'ACTIVE',
    });

    expect(calls[0].text).toContain('w.person_id = ?::uuid');
    expect(calls[0].text).toContain('w.lifecycle_type = ?');
    expect(calls[0].text).toContain('w.status = ?');
  });

  it('filters workflow tasks in SQL by employee_visible, manager_visible, and internal_only', async () => {
    responses = [[]];

    await getVisibleLifecycleTasksForWorkflow(
      SESSION,
      '44444444-4444-4444-8444-444444444444',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('t.internal_only = false');
    expect(calls[0].text).toContain('t.employee_visible = true');
    expect(calls[0].text).toContain('t.manager_visible = true');
    expect(calls[0].text).toContain('p.linked_user_id = ?');
    expect(calls[0].text).toContain('manager.linked_user_id = ?');
    expect(calls[0].text).toContain('FROM hr_administrators a');
  });

  it('super_admin bypass stays inside active-org SQL scope', async () => {
    responses = [[]];
    await listLifecycleWorkflows(
      { ...SESSION, userId: 'founder-user', role: 'super_admin', organisationId: 'org-b' },
      {},
    );

    expect(calls[0].values).toContain(true);
    expect(calls[0].values).toContain('org-b');
    expect(calls[0].text).toContain('w.organisation_id = ?');
  });
});
