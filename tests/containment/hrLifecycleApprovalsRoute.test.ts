import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { OrgSession } from '@/lib/org';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}
function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/hr/lifecycle/tasks/test/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) };
});
const requireHrCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireHrCapabilityMock(...args),
}));
const requireLifecycleTaskMock = vi.fn();
vi.mock('@/lib/hr/lifecycleRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleRoute')>();
  return { ...actual, requireLifecycleTask: (...args: unknown[]) => requireLifecycleTaskMock(...args) };
});
const recordApprovalMock = vi.fn();
vi.mock('@/lib/hr/lifecycleMutations', () => ({
  recordLifecycleTaskApproval: (...args: unknown[]) => recordApprovalMock(...args),
}));

const { POST } = await import('@/app/api/hr/lifecycle/tasks/[id]/approvals/route');

const TASK_ID = '55555555-5555-4555-8555-555555555555';
const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';
const PERSON_ID = '11111111-1111-4111-8111-111111111111';

const MANAGER_SESSION: OrgSession = {
  userId: 'manager-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'Manager',
};

function resolvedManagerApprovalTask() {
  return {
    ok: true as const,
    task: {
      id: TASK_ID,
      organisationId: 'org-a',
      workflowId: WORKFLOW_ID,
      personId: PERSON_ID,
      templateId: '22222222-2222-4222-8222-222222222222',
      templateTaskId: '33333333-3333-4333-8333-333333333333',
      sequence: 1,
      title: 'Manager approval',
      description: null,
      responsibilityType: 'EMPLOYEE' as const,
      assignedUserId: 'employee-user',
      dueAt: null,
      requiresApproval: true,
      approvalType: 'MANAGER' as const,
      employeeVisible: true,
      managerVisible: true,
      internalOnly: false,
      status: 'AWAITING_APPROVAL' as const,
    },
    auth: {
      actor: {
        organisationId: 'org-a',
        userId: 'manager-user',
        isHrAdministrator: false,
      },
      target: {
        organisationId: 'org-a',
        personLinkedUserId: 'employee-user',
        currentManagerLinkedUserId: 'manager-user',
        responsibilityType: 'EMPLOYEE' as const,
        approvalType: 'MANAGER' as const,
        assignedUserId: 'employee-user',
        employeeVisible: true,
        managerVisible: true,
        internalOnly: false,
      },
    },
  };
}

beforeEach(() => {
  requireSessionMock.mockReset();
  requireHrCapabilityMock.mockReset();
  requireLifecycleTaskMock.mockReset();
  recordApprovalMock.mockReset();
  requireSessionMock.mockResolvedValue(MANAGER_SESSION);
  requireHrCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
  requireLifecycleTaskMock.mockResolvedValue(resolvedManagerApprovalTask());
});

describe('POST /api/hr/lifecycle/tasks/[id]/approvals', () => {
  it('records a current-manager approval and derives approver identity from session', async () => {
    recordApprovalMock.mockResolvedValue({
      outcome: 'recorded',
      approval: {
        id: 'approval-1',
        taskId: TASK_ID,
        workflowId: WORKFLOW_ID,
        personId: PERSON_ID,
        approverUserId: 'manager-user',
        decision: 'APPROVED',
        comment: 'Ready',
        decidedAt: '2026-09-26T11:30:00.000Z',
      },
      task: {
        id: TASK_ID,
        status: 'COMPLETED',
        completedAt: '2026-09-26T11:30:00.000Z',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'ACTIVE',
        completedAt: null,
      },
    });

    const res = await POST(
      postRequest({ decision: 'APPROVED', comment: ' Ready ' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      approval: {
        id: 'approval-1',
        task_id: TASK_ID,
        workflow_id: WORKFLOW_ID,
        person_id: PERSON_ID,
        approver_user_id: 'manager-user',
        decision: 'APPROVED',
        comment: 'Ready',
        decided_at: '2026-09-26T11:30:00.000Z',
      },
      task: {
        id: TASK_ID,
        status: 'COMPLETED',
        completed_at: '2026-09-26T11:30:00.000Z',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'ACTIVE',
        completed_at: null,
      },
    });
    expect(recordApprovalMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ userId: 'manager-user', organisationId: 'org-a' }),
      taskId: TASK_ID,
      decision: 'APPROVED',
      comment: 'Ready',
    }));
  });

  it('rejects client-supplied approver identity', async () => {
    const res = await POST(
      postRequest({ decision: 'APPROVED', approver_user_id: 'attacker' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown or unsupported field: approver_user_id' });
    expect(recordApprovalMock).not.toHaveBeenCalled();
  });

  it('rejects invalid approval decisions', async () => {
    const res = await POST(
      postRequest({ decision: 'MAYBE' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'decision must be APPROVED or REJECTED.' });
  });

  it('returns approval_no_longer_applicable when the task leaves AWAITING_APPROVAL before the write', async () => {
    recordApprovalMock.mockResolvedValue({ outcome: 'approval_no_longer_applicable' });
    const res = await POST(
      postRequest({ decision: 'APPROVED' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This task is no longer awaiting approval.',
      code: 'approval_no_longer_applicable',
    });
  });

  it('denies a former manager at route-time current-manager authorization', async () => {
    requireSessionMock.mockResolvedValue({ ...MANAGER_SESSION, userId: 'old-manager' });
    requireLifecycleTaskMock.mockResolvedValue({
      ...resolvedManagerApprovalTask(),
      auth: {
        ...resolvedManagerApprovalTask().auth,
        actor: {
          organisationId: 'org-a',
          userId: 'old-manager',
          isHrAdministrator: false,
        },
      },
    });
    const res = await POST(
      postRequest({ decision: 'APPROVED' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'You are not permitted to approve this lifecycle task.',
      code: 'approval_forbidden',
    });
    expect(recordApprovalMock).not.toHaveBeenCalled();
  });

  it('maps write-boundary authorization loss to approval_forbidden', async () => {
    recordApprovalMock.mockResolvedValue({ outcome: 'forbidden' });
    const res = await POST(
      postRequest({ decision: 'APPROVED' }),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'You are not permitted to approve this lifecycle task.',
      code: 'approval_forbidden',
    });
  });
});
