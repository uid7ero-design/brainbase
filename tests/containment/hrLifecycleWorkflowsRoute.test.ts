import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const requireContextMock = vi.fn();
const requireAdminMock = vi.fn();
vi.mock('@/lib/hr/lifecycleWorkflowRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleWorkflowRoute')>();
  return {
    ...actual,
    requireLifecycleWorkflowContext: (...args: unknown[]) => requireContextMock(...args),
    requireLifecycleWorkflowAdmin: (...args: unknown[]) => requireAdminMock(...args),
  };
});

const listMock = vi.fn();
const tasksMock = vi.fn();
vi.mock('@/lib/hr/lifecycleWorkflowQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleWorkflowQueries')>();
  return {
    ...actual,
    listLifecycleWorkflows: (...args: unknown[]) => listMock(...args),
    getVisibleLifecycleTasksForWorkflow: (...args: unknown[]) => tasksMock(...args),
  };
});

const startMock = vi.fn();
const cancelMock = vi.fn();
vi.mock('@/lib/hr/lifecycleWorkflowMutations', () => ({
  startLifecycleWorkflow: (...args: unknown[]) => startMock(...args),
  cancelLifecycleWorkflow: (...args: unknown[]) => cancelMock(...args),
}));

const requireWorkflowMock = vi.fn();
vi.mock('@/lib/hr/lifecycleRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleRoute')>();
  return {
    ...actual,
    requireLifecycleWorkflow: (...args: unknown[]) => requireWorkflowMock(...args),
  };
});

const collection = await import('@/app/api/hr/lifecycle/workflows/route');
const detail = await import('@/app/api/hr/lifecycle/workflows/[id]/route');
const cancel = await import('@/app/api/hr/lifecycle/workflows/[id]/cancel/route');

const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';
const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';

const session = {
  userId: 'employee-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer' as const,
  name: 'Employee',
};

const context = {
  ok: true as const,
  context: {
    session,
    isHrAdministrator: false,
  },
};

function workflow(status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' = 'ACTIVE') {
  return {
    id: WORKFLOW_ID,
    organisationId: 'org-a',
    personId: PERSON_ID,
    templateId: TEMPLATE_ID,
    lifecycleType: 'onboarding' as const,
    status,
    anchorDate: '2026-10-06',
    startedBy: 'hr-user',
    startedAt: '2026-09-26T12:00:00.000Z',
    completedAt: status === 'COMPLETED' ? '2026-09-26T13:00:00.000Z' : null,
    cancelledAt: status === 'CANCELLED' ? '2026-09-26T13:00:00.000Z' : null,
  };
}

function visibleTask() {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    organisationId: 'org-a',
    workflowId: WORKFLOW_ID,
    personId: PERSON_ID,
    templateId: TEMPLATE_ID,
    templateTaskId: '33333333-3333-4333-8333-333333333333',
    sequence: 1,
    title: 'Complete profile',
    description: null,
    responsibilityType: 'EMPLOYEE' as const,
    assignedUserId: 'employee-user',
    dueAt: null,
    requiresApproval: false,
    approvalType: 'NONE' as const,
    employeeVisible: true,
    managerVisible: false,
    internalOnly: false,
    status: 'NOT_STARTED' as const,
  };
}

beforeEach(() => {
  requireContextMock.mockReset();
  requireAdminMock.mockReset();
  listMock.mockReset();
  tasksMock.mockReset();
  startMock.mockReset();
  cancelMock.mockReset();
  requireWorkflowMock.mockReset();

  requireContextMock.mockResolvedValue(context);
  requireAdminMock.mockReturnValue(null);
  listMock.mockResolvedValue([]);
  tasksMock.mockResolvedValue([visibleTask()]);
  requireWorkflowMock.mockResolvedValue({
    ok: true,
    workflow: workflow(),
    auth: {},
  });
});

describe('HR-7C lifecycle workflow routes', () => {
  it('lists only the viewer-scoped workflows and passes filters into the SQL query layer', async () => {
    listMock.mockResolvedValue([workflow()]);
    const req = new Request(
      `http://localhost/api/hr/lifecycle/workflows?lifecycle_type=onboarding&status=ACTIVE&person_id=${PERSON_ID}`,
    ) as unknown as NextRequest;

    const res = await collection.GET(req);

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(session, {
      lifecycleType: 'onboarding',
      status: 'ACTIVE',
      personId: PERSON_ID,
    });
    expect((await res.json()).workflows).toHaveLength(1);
  });

  it('returns an empty list for an authorized viewer with no visible workflows', async () => {
    const res = await collection.GET(
      new Request('http://localhost/api/hr/lifecycle/workflows') as unknown as NextRequest,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflows: [] });
  });

  it('rejects invalid list filters before querying', async () => {
    const res = await collection.GET(
      new Request(
        'http://localhost/api/hr/lifecycle/workflows?status=UNKNOWN',
      ) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('starts a workflow only through the HR-admin route gate and returns snapshotted tasks', async () => {
    requireContextMock.mockResolvedValue({
      ok: true,
      context: {
        session: { ...session, userId: 'hr-user', role: 'admin' as const },
        isHrAdministrator: true,
      },
    });
    startMock.mockResolvedValue({
      outcome: 'started',
      workflowId: WORKFLOW_ID,
    });

    const req = new Request('http://localhost/api/hr/lifecycle/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: PERSON_ID,
        template_id: TEMPLATE_ID,
        anchor_date: '2026-10-06',
      }),
    }) as unknown as NextRequest;

    const res = await collection.POST(req);

    expect(res.status).toBe(201);
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({
        organisationId: 'org-a',
        userId: 'hr-user',
      }),
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    }));
    const body = await res.json();
    expect(body.workflow.id).toBe(WORKFLOW_ID);
    expect(body.tasks).toHaveLength(1);
  });

  it('rejects impossible calendar anchor dates before mutation', async () => {
    requireContextMock.mockResolvedValue({
      ok: true,
      context: {
        session: { ...session, userId: 'hr-user', role: 'admin' as const },
        isHrAdministrator: true,
      },
    });

    const res = await collection.POST(
      new Request('http://localhost/api/hr/lifecycle/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: PERSON_ID,
          template_id: TEMPLATE_ID,
          anchor_date: '2026-02-31',
        }),
      }) as unknown as NextRequest,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/anchor_date/i);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('rejects client-supplied lifecycle/server-managed fields on workflow start', async () => {
    requireContextMock.mockResolvedValue({
      ok: true,
      context: {
        session: { ...session, userId: 'hr-user', role: 'admin' as const },
        isHrAdministrator: true,
      },
    });
    const req = new Request('http://localhost/api/hr/lifecycle/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: PERSON_ID,
        template_id: TEMPLATE_ID,
        anchor_date: '2026-10-06',
        status: 'COMPLETED',
      }),
    }) as unknown as NextRequest;

    const res = await collection.POST(req);
    expect(res.status).toBe(400);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('maps duplicate ACTIVE workflow start to deterministic 409', async () => {
    requireContextMock.mockResolvedValue({
      ok: true,
      context: {
        session: { ...session, userId: 'hr-user', role: 'admin' as const },
        isHrAdministrator: true,
      },
    });
    startMock.mockResolvedValue({ outcome: 'workflow_already_active' });

    const res = await collection.POST(
      new Request('http://localhost/api/hr/lifecycle/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: PERSON_ID,
          template_id: TEMPLATE_ID,
          anchor_date: '2026-10-06',
        }),
      }) as unknown as NextRequest,
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('workflow_already_active');
  });

  it('uses canonical 404 for malformed workflow detail ids', async () => {
    const res = await detail.GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'bad-id' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Lifecycle resource not found.' });
    expect(requireWorkflowMock).not.toHaveBeenCalled();
  });

  it('returns only tasks visible to the caller inside an otherwise-visible workflow', async () => {
    const res = await detail.GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: WORKFLOW_ID }),
    });
    expect(res.status).toBe(200);
    expect(tasksMock).toHaveBeenCalledWith(session, WORKFLOW_ID);
    const body = await res.json();
    expect(body.workflow.id).toBe(WORKFLOW_ID);
    expect(body.tasks).toHaveLength(1);
  });

  it('requires HR administration to cancel a workflow', async () => {
    requireAdminMock.mockReturnValue(
      new Response(JSON.stringify({ error: 'HR administrator access is required.', code: 'hr_admin_required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await cancel.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }) as unknown as NextRequest,
      { params: Promise.resolve({ id: WORKFLOW_ID }) },
    );
    expect(res.status).toBe(403);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('cancels an ACTIVE workflow and returns the reread CANCELLED state', async () => {
    requireContextMock.mockResolvedValue({
      ok: true,
      context: {
        session: { ...session, userId: 'hr-user', role: 'admin' as const },
        isHrAdministrator: true,
      },
    });
    cancelMock.mockResolvedValue({
      outcome: 'cancelled',
      workflowId: WORKFLOW_ID,
      cancelledAt: '2026-09-26T14:00:00.000Z',
    });
    requireWorkflowMock
      .mockResolvedValueOnce({ ok: true, workflow: workflow(), auth: {} })
      .mockResolvedValueOnce({ ok: true, workflow: workflow('CANCELLED'), auth: {} });

    const res = await cancel.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }) as unknown as NextRequest,
      { params: Promise.resolve({ id: WORKFLOW_ID }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).workflow.status).toBe('CANCELLED');
  });

  it('maps completed-workflow cancellation to deterministic 409', async () => {
    requireContextMock.mockResolvedValue({
      ok: true,
      context: {
        session: { ...session, userId: 'hr-user', role: 'admin' as const },
        isHrAdministrator: true,
      },
    });
    cancelMock.mockResolvedValue({ outcome: 'already_completed' });

    const res = await cancel.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }) as unknown as NextRequest,
      { params: Promise.resolve({ id: WORKFLOW_ID }) },
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('workflow_already_completed');
  });
});
