import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ workflows: vi.fn(), tasks: vi.fn(), context: vi.fn() }));
vi.mock('@/lib/hr/lifecycleWorkflowQueries', () => ({ listLifecycleWorkflows: mocks.workflows, getVisibleLifecycleTasksForWorkflow: mocks.tasks }));
vi.mock('@/lib/hr/lifecycleWorkflowRoute', () => ({ requireLifecycleWorkflowContext: mocks.context }));
vi.mock('@/lib/hr/registerPageQueries', () => ({ loadRegisterPage: async (session: unknown) => {
  const { loadLifecycleTaskQueue } = await import('@/lib/hr/lifecycleTaskQueue');
  return loadLifecycleTaskQueue(session as Parameters<typeof loadLifecycleTaskQueue>[0]);
} }));
const { loadLifecycleTaskQueue } = await import('@/lib/hr/lifecycleTaskQueue');
const { GET } = await import('@/app/api/hr/lifecycle/queue/route');
const session = { userId: 'viewer', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'viewer' as const, name: 'Viewer' };
const workflow = { id: 'w-a', personId: 'p-a', lifecycleType: 'onboarding' };
const task = { id: 't-a', title: 'Review policy', status: 'NOT_STARTED', dueAt: null, description: 'secret', assignedUserId: 'secret-user' };
const now = new Date('2026-10-08T00:00:00Z');
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.workflows.mockResolvedValue([workflow]); mocks.tasks.mockResolvedValue([task]);
  mocks.context.mockResolvedValue({ ok: true, context: { session } });
});
describe('scoped lifecycle task queue', () => {
  it('uses canonical readers with the trusted session and active workflows only', async () => {
    const result = await loadLifecycleTaskQueue(session, now);
    expect(mocks.workflows).toHaveBeenCalledWith(session, { status: 'ACTIVE' });
    expect(mocks.tasks).toHaveBeenCalledWith(session, 'w-a');
    expect(result).toEqual({ as_of: now.toISOString(), tasks: [{ task_id: 't-a', workflow_id: 'w-a', person_id: 'p-a', lifecycle_type: 'onboarding', title: 'Review policy', status: 'NOT_STARTED', due_at: null, overdue: false }] });
  });
  it('excludes every terminal state and does not infer tasks from visible shells', async () => {
    mocks.tasks.mockResolvedValue(['COMPLETED', 'WAIVED', 'CANCELLED'].map(status => ({ ...task, status })));
    expect((await loadLifecycleTaskQueue(session, now)).tasks).toEqual([]);
    mocks.tasks.mockResolvedValue([]);
    expect((await loadLifecycleTaskQueue(session, now)).tasks).toEqual([]);
  });
  it('retains all three outstanding states with deterministic overdue/date/identity ordering', async () => {
    mocks.tasks.mockResolvedValue([
      { ...task, id: 'undated' },
      { ...task, id: 'later', dueAt: '2026-10-09T00:00:00Z' },
      { ...task, id: 'b', status: 'AWAITING_APPROVAL', dueAt: '2026-10-07T00:00:00Z' },
      { ...task, id: 'a', status: 'IN_PROGRESS', dueAt: '2026-10-07T10:00:00+10:00' },
      { ...task, id: 'boundary', dueAt: now.toISOString() },
    ]);
    const result = await loadLifecycleTaskQueue(session, now);
    expect(result.tasks.map(row => row.task_id)).toEqual(['a', 'b', 'boundary', 'later', 'undated']);
    expect(result.tasks.map(row => row.overdue)).toEqual([true, true, false, false, false]);
    expect(result.tasks[0].due_at).toBe('2026-10-07T00:00:00.000Z');
  });
  it('does not read tasks for an empty authorized workflow list', async () => {
    mocks.workflows.mockResolvedValue([]);
    expect((await loadLifecycleTaskQueue(session, now)).tasks).toEqual([]);
    expect(mocks.tasks).not.toHaveBeenCalled();
  });
  it('bounds task readers to four without truncating workflows', async () => {
    mocks.workflows.mockResolvedValue(Array.from({ length: 11 }, (_, i) => ({ ...workflow, id: `w-${i}` })));
    let active = 0, peak = 0;
    mocks.tasks.mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return [task];
    });
    expect((await loadLifecycleTaskQueue(session, now)).tasks).toHaveLength(11);
    expect(peak).toBe(4);
  });
  it.each([401, 403, 503])('preserves context denial %s without task reads and disables caching', async status => {
    mocks.context.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Denied' }, { status }) });
    const response = await GET();
    expect(response.status).toBe(status); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.workflows).not.toHaveBeenCalled();
  });
  it('allows only display metadata and disables caching on success', async () => {
    const response = await GET();
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const result = await response.json();
    expect(Object.keys(result.tasks[0]).sort()).toEqual(['due_at', 'lifecycle_type', 'overdue', 'person_id', 'status', 'task_id', 'title', 'workflow_id']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('returns a generic error with no partial queue on read failure', async () => {
    mocks.tasks.mockRejectedValue(new Error('database secret'));
    const response = await GET();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Unable to load lifecycle task queue.' });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('fails closed on malformed due dates rather than misclassifying overdue work', async () => {
    mocks.tasks.mockResolvedValue([{ ...task, dueAt: 'invalid' }]);
    expect((await GET()).status).toBe(503);
  });
});
