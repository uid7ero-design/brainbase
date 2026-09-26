import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { OrgSession } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

function patchRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/hr/lifecycle/tasks/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return {
    ...actual,
    requireSession: (...args: unknown[]) => requireSessionMock(...args),
  };
});

const requireHrCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireHrCapabilityMock(...args),
}));

const requireLifecycleTaskMock = vi.fn();
vi.mock('@/lib/hr/lifecycleRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleRoute')>();
  return {
    ...actual,
    requireLifecycleTask: (...args: unknown[]) => requireLifecycleTaskMock(...args),
  };
});

const completeLifecycleTaskMock = vi.fn();
vi.mock('@/lib/hr/lifecycleMutations', () => ({
  completeLifecycleTask: (...args: unknown[]) => completeLifecycleTaskMock(...args),
}));

const { PATCH } = await import('@/app/api/hr/lifecycle/tasks/[id]/route');

const TASK_ID = '55555555-5555-4555-8555-555555555555';
const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';
const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_TASK_ID = '33333333-3333-4333-8333-333333333333';

const EMPLOYEE_SESSION: OrgSession = {
  userId: 'employee-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer',
  name: 'Employee User',
};

function resolvedEmployeeTask() {
  return {
    ok: true as const,
    task: {
      id: TASK_ID,
      organisationId: 'org-a',
      workflowId: WORKFLOW_ID,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      templateTaskId: TEMPLATE_TASK_ID,
      sequence: 1,
      title: 'Complete employee details',
      description: null,
      responsibilityType: 'EMPLOYEE' as const,
      assignedUserId: 'employee-user',
      dueAt: null,
      requiresApproval: false,
      approvalType: 'NONE' as const,
      employeeVisible: true,
      managerVisible: false,
      internalOnly: false,
      status: 'IN_PROGRESS' as const,
    },
    auth: {
      actor: {
        organisationId: 'org-a',
        userId: 'employee-user',
        isHrAdministrator: false,
      },
      target: {
        organisationId: 'org-a',
        personLinkedUserId: 'employee-user',
        currentManagerLinkedUserId: 'manager-user',
        responsibilityType: 'EMPLOYEE' as const,
        approvalType: 'NONE' as const,
        assignedUserId: 'employee-user',
        employeeVisible: true,
        managerVisible: false,
        internalOnly: false,
      },
    },
  };
}

function installSerializedDoubleCompletion(options?: { completesWorkflow?: boolean }) {
  let completed = false;
  let tail = Promise.resolve();

  completeLifecycleTaskMock.mockImplementation((params: {
    actor: { organisationId: string; userId: string };
    taskId: string;
  }) => {
    const run = tail.then(async () => {
      expect(params.taskId).toBe(TASK_ID);
      expect(params.actor.organisationId).toBe('org-a');
      expect(params.actor.userId).toBe('employee-user');

      if (completed) {
        return { outcome: 'already_completed' as const };
      }

      completed = true;
      return {
        outcome: 'completed' as const,
        task: {
          id: TASK_ID,
          status: 'COMPLETED' as const,
          completedBy: 'employee-user',
          completedAt: '2026-09-26T09:15:00.000Z',
        },
        workflow: {
          id: WORKFLOW_ID,
          status: options?.completesWorkflow ? 'COMPLETED' as const : 'ACTIVE' as const,
          completedAt: options?.completesWorkflow
            ? '2026-09-26T09:15:00.000Z'
            : null,
        },
      };
    });

    tail = run.then(() => undefined, () => undefined);
    return run;
  });

  return {
    wasCompleted: () => completed,
  };
}

beforeEach(() => {
  requireSessionMock.mockReset();
  requireHrCapabilityMock.mockReset();
  requireLifecycleTaskMock.mockReset();
  completeLifecycleTaskMock.mockReset();

  requireSessionMock.mockResolvedValue(EMPLOYEE_SESSION);
  requireHrCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
  requireLifecycleTaskMock.mockResolvedValue(resolvedEmployeeTask());
});

describe('PATCH /api/hr/lifecycle/tasks/[id] — completion', () => {
  it('returns the locked 401 contract before resolving the task', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));

    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized.' });
    expect(requireLifecycleTaskMock).not.toHaveBeenCalled();
    expect(completeLifecycleTaskMock).not.toHaveBeenCalled();
  });

  it('returns 503 when People capability cannot be verified', async () => {
    requireHrCapabilityMock.mockRejectedValue(new CapabilityDatabaseError());

    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Unable to verify People access.' });
    expect(completeLifecycleTaskMock).not.toHaveBeenCalled();
  });

  it('maps malformed task ids to the canonical lifecycle 404 before resolution', async () => {
    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Lifecycle resource not found.' });
    expect(requireLifecycleTaskMock).not.toHaveBeenCalled();
    expect(completeLifecycleTaskMock).not.toHaveBeenCalled();
  });

  it('rejects client-managed or unsupported fields before mutation', async () => {
    const res = await PATCH(
      patchRequest({
        action: 'complete',
        completed_by: 'attacker',
      }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unknown or unsupported field: completed_by',
    });
    expect(completeLifecycleTaskMock).not.toHaveBeenCalled();
  });

  it('allows exactly one concurrent completion and returns task_already_completed to the loser', async () => {
    const state = installSerializedDoubleCompletion();
    const ctx = { params: Promise.resolve({ id: TASK_ID }) };

    const [a, b] = await Promise.all([
      PATCH(patchRequest({ action: 'complete' }), ctx),
      PATCH(patchRequest({ action: 'complete' }), ctx),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const success = [a, b].find(res => res.status === 200);
    const conflict = [a, b].find(res => res.status === 409);

    expect(success).toBeDefined();
    expect(conflict).toBeDefined();
    if (!success || !conflict) throw new Error('Expected one winner and one loser.');

    expect(await success.json()).toEqual({
      task: {
        id: TASK_ID,
        status: 'COMPLETED',
        completed_by: 'employee-user',
        completed_at: '2026-09-26T09:15:00.000Z',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'ACTIVE',
        completed_at: null,
      },
    });

    expect(await conflict.json()).toEqual({
      error: 'This task has already been completed.',
      code: 'task_already_completed',
    });

    expect(state.wasCompleted()).toBe(true);
    expect(completeLifecycleTaskMock).toHaveBeenCalledTimes(2);
  });

  it('returns one workflow completion when the same race targets the final task', async () => {
    installSerializedDoubleCompletion({ completesWorkflow: true });
    const ctx = { params: Promise.resolve({ id: TASK_ID }) };

    const [a, b] = await Promise.all([
      PATCH(patchRequest({ action: 'complete' }), ctx),
      PATCH(patchRequest({ action: 'complete' }), ctx),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const success = [a, b].find(res => res.status === 200)!;
    const conflict = [a, b].find(res => res.status === 409)!;

    expect(await success.json()).toEqual({
      task: {
        id: TASK_ID,
        status: 'COMPLETED',
        completed_by: 'employee-user',
        completed_at: '2026-09-26T09:15:00.000Z',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'COMPLETED',
        completed_at: '2026-09-26T09:15:00.000Z',
      },
    });

    expect(await conflict.json()).toEqual({
      error: 'This task has already been completed.',
      code: 'task_already_completed',
    });
  });

  it('maps a write-boundary task disappearance to the canonical 404', async () => {
    completeLifecycleTaskMock.mockResolvedValue({ outcome: 'task_not_found' });

    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Lifecycle resource not found.' });
  });

  it('maps live authorization loss at the mutation boundary to 403', async () => {
    completeLifecycleTaskMock.mockResolvedValue({ outcome: 'forbidden' });

    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'You are not permitted to perform this lifecycle task action.',
      code: 'task_action_forbidden',
    });
  });

  it('maps an already-awaiting-approval race to the exact task_already_submitted conflict', async () => {
    completeLifecycleTaskMock.mockResolvedValue({ outcome: 'already_submitted' });

    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This task is already awaiting approval.',
      code: 'task_already_submitted',
    });
  });

  it('maps unexpected mutation failures to the generic locked 500', async () => {
    completeLifecycleTaskMock.mockRejectedValue(new Error('database exploded'));

    const res = await PATCH(
      patchRequest({ action: 'complete' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Could not complete lifecycle task.',
    });
  });
});
