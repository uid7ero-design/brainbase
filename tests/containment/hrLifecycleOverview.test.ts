import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ workflows: vi.fn(), tasks: vi.fn(), context: vi.fn() }));
vi.mock('@/lib/hr/lifecycleWorkflowQueries', () => ({ listLifecycleWorkflows: mocks.workflows, getVisibleLifecycleTasksForWorkflow: mocks.tasks }));
vi.mock('@/lib/hr/lifecycleWorkflowRoute', () => ({ requireLifecycleWorkflowContext: mocks.context }));
vi.mock('@/lib/hr/registerPageQueries', () => ({ loadRegisterPage: async (session: unknown) => {
  const { loadLifecycleOverview } = await import('@/lib/hr/lifecycleOverview');
  return loadLifecycleOverview(session as Parameters<typeof loadLifecycleOverview>[0]);
} }));
const { loadLifecycleOverview } = await import('@/lib/hr/lifecycleOverview');
const { GET } = await import('@/app/api/hr/lifecycle/overview/route');
const SESSION = { userId: 'viewer', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'viewer' as const, name: 'Viewer' };
const WORKFLOW = { id: 'workflow-a', personId: 'person-a', lifecycleType: 'onboarding', status: 'ACTIVE', startedBy: 'secret-user' };

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.context.mockResolvedValue({ ok: true, context: { session: SESSION, isHrAdministrator: false } });
  mocks.workflows.mockResolvedValue([WORKFLOW]);
  mocks.tasks.mockResolvedValue([]);
});

describe('HR-9 lifecycle overview', () => {
  it('counts only canonical visible tasks and excludes terminal tasks from outstanding/overdue counts', async () => {
    mocks.tasks.mockResolvedValue([
      { status: 'NOT_STARTED', dueAt: '2026-10-01T00:00:00Z', assignedUserId: 'secret' },
      { status: 'IN_PROGRESS', dueAt: '2026-10-09T00:00:00Z' },
      { status: 'AWAITING_APPROVAL', dueAt: '2026-10-01T00:00:00Z' },
      { status: 'COMPLETED', dueAt: '2026-10-01T00:00:00Z' },
      { status: 'WAIVED', dueAt: '2026-10-01T00:00:00Z' },
      { status: 'CANCELLED', dueAt: '2026-10-01T00:00:00Z' },
      { status: 'NOT_STARTED', dueAt: null },
    ]);
    expect(await loadLifecycleOverview(SESSION, new Date('2026-10-07T00:00:00Z'))).toEqual({ workflows: [{
      workflow_id: 'workflow-a', person_id: 'person-a', lifecycle_type: 'onboarding',
      visible_tasks: 7, outstanding_tasks: 4, awaiting_approval: 1, overdue_tasks: 2,
    }] });
    expect(mocks.workflows).toHaveBeenCalledWith(SESSION, { status: 'ACTIVE' });
    expect(mocks.tasks).toHaveBeenCalledWith(SESSION, 'workflow-a');
  });

  it('does not infer hidden task counts from an authorized workflow shell', async () => {
    const result = await loadLifecycleOverview(SESSION);
    expect(result.workflows[0]).toEqual({ workflow_id: 'workflow-a', person_id: 'person-a', lifecycle_type: 'onboarding', visible_tasks: 0, outstanding_tasks: 0, awaiting_approval: 0, overdue_tasks: 0 });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns no workflows and makes no task reads for an empty authorized list', async () => {
    mocks.workflows.mockResolvedValue([]);
    expect(await loadLifecycleOverview(SESSION)).toEqual({ workflows: [] });
    expect(mocks.tasks).not.toHaveBeenCalled();
  });

  it('uses an exact due-time boundary and excludes undated tasks', async () => {
    mocks.tasks.mockResolvedValue([{ status: 'IN_PROGRESS', dueAt: '2026-10-07T00:00:00Z' }, { status: 'IN_PROGRESS', dueAt: null }]);
    expect((await loadLifecycleOverview(SESSION, new Date('2026-10-07T00:00:00Z'))).workflows[0].overdue_tasks).toBe(0);
  });

  it('bounds concurrency to four and retains all workflows in original order', async () => {
    mocks.workflows.mockResolvedValue(Array.from({ length: 11 }, (_, i) => ({ ...WORKFLOW, id: `workflow-${i}` })));
    let active = 0, peak = 0;
    mocks.tasks.mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return [];
    });
    const result = await loadLifecycleOverview(SESSION);
    expect(peak).toBe(4);
    expect(result.workflows.map(row => row.workflow_id)).toEqual(Array.from({ length: 11 }, (_, i) => `workflow-${i}`));
  });

  it.each([401, 403, 503])('preserves canonical authorization status %s without loading overview', async status => {
    mocks.context.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Denied' }, { status }) });
    const response = await GET();
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.workflows).not.toHaveBeenCalled();
  });

  it('returns a non-cacheable allowlisted response for the trusted session', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.workflows).toHaveBeenCalledWith(SESSION, { status: 'ACTIVE' });
    expect(Object.keys((await response.json()).workflows[0]).sort()).toEqual(['awaiting_approval', 'lifecycle_type', 'outstanding_tasks', 'overdue_tasks', 'person_id', 'visible_tasks', 'workflow_id']);
  });

  it('returns a generic failure instead of a partial overview when any task read fails', async () => {
    mocks.tasks.mockRejectedValue(new Error('database secret'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Unable to load lifecycle overview.' });
  });

  it('fails closed on malformed outstanding due dates', async () => {
    mocks.tasks.mockResolvedValue([{ status: 'IN_PROGRESS', dueAt: 'bad-date' }]);
    expect((await GET()).status).toBe(503);
  });
});
