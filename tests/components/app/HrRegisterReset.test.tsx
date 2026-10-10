import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { hrRegisterFixture } from '../../helpers/hrRegisterFixture';
import People from '@/app/people/page';
import Lifecycle from '@/app/people/lifecycle/page';
import Tasks from '@/app/people/lifecycle/tasks/page';
import Documents from '@/app/people/documents/page';

vi.mock('@/app/people/_components/PersonDrawer', () => ({ default: () => null }));
vi.mock('@/app/people/_components/PersonForm', () => ({ default: () => null }));
vi.mock('@/app/people/_components/SlidePanel', () => ({ default: () => null }));
const people = Array.from({ length: 61 }, (_, i) => ({ id: `p-${i}`, first_name: `Worker ${String(i + 1).padStart(3, '0')}`, last_name: 'Fixture',
  job_title: null, team_name: null, manager_first_name: null, manager_last_name: null, employment_status: i % 2 ? 'inactive' : 'active', worker_type: i % 2 ? 'contractor' : 'employee' }));
const workflows = people.map((p, i) => ({ person_id: p.id, workflow_id: `w-${i}`, lifecycle_type: i % 2 ? 'offboarding' : 'onboarding', visible_tasks: 1, outstanding_tasks: 1, awaiting_approval: 0, overdue_tasks: 1 }));
const tasks = workflows.map((w, i) => ({ ...w, task_id: `t-${i}`, title: `Task ${i}`, status: 'NOT_STARTED', due_at: null, overdue: false }));
const documents = people.map(p => ({ person_id: p.id, first_name: p.first_name, last_name: p.last_name, documents: 1, missing_version: 0, pending_acknowledgement: 1, unlinked_employee: 0, pending_verification: 1, rejected: 0, expired: 1, expiring_soon: 0 }));
function response(url: string) {
  const body = url.includes('/queue') ? { as_of: '2026-10-10T00:00:00Z', tasks } : url.includes('/documents/')
    ? { as_of_date: '2026-10-10', expiring_through: '2026-11-09', people: documents } : url.includes('/register?') ? { people, canManage: false } : { workflows };
  return new Response(JSON.stringify(hrRegisterFixture(body, url, people)));
}
const fetchMock = vi.fn();
const modes = [['people', People], ['lifecycle', Lifecycle], ['tasks', Tasks], ['documents', Documents]] as const;
const searchLabel = (mode: string) => mode === 'people' ? 'Search people, job titles or teams' : mode === 'tasks' ? 'Search people or tasks' : 'Search people';
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation((url: string) => Promise.resolve(response(url))); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('reset register view without mutating records', () => {
  it.each(modes)('%s clears every filter and a non-first page in one read', async (mode, Page) => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    expect((screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement).disabled).toBe(true);
    const filters = mode === 'people' ? [['Employment status', 'inactive'], ['Worker type', 'contractor']] : mode === 'documents'
      ? [['Show documents', 'expired']] : [['Lifecycle', 'offboarding'], [mode === 'tasks' ? 'Show tasks' : 'Show workflows', mode === 'tasks' ? 'NOT_STARTED' : 'outstanding']];
    for (const [label, value] of filters) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText(searchLabel(mode)), { target: { value: 'Worker' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Page 2'));
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    expect(screen.getByRole('status').textContent).toContain('Page 1 of 3');
    expect(screen.getByRole('status').textContent).toContain('61 matching rows');
    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
    for (const [label] of filters) expect((screen.getByLabelText(label) as HTMLSelectElement).value).toBe('all');
    expect((screen.getByLabelText(searchLabel(mode)) as HTMLInputElement).value).toBe('');
    expect(fetchMock.mock.calls.every(call => !call[1].method || call[1].method === 'GET')).toBe(true);
  });
  it.each(modes)('%s can reset an empty view and recover from a filtered read failure', async (mode, Page) => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    fireEvent.change(screen.getByLabelText(searchLabel(mode)), { target: { value: 'No match' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('0 matching rows'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    fetchMock.mockRejectedValueOnce(new Error('secret'));
    fireEvent.change(screen.getByLabelText(searchLabel(mode)), { target: { value: 'Worker 061' } });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText('secret')).toBeNull();
  });
  it.each(modes)('%s cancels a pending filtered read and ignores its late result after reset', async (mode, Page) => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    fireEvent.change(screen.getByLabelText(searchLabel(mode)), { target: { value: 'Worker 061' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const pending = fetchMock.mock.calls[1];
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    expect(pending[1].signal.aborted).toBe(true);
    finish(response(pending[0]));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('61 matching rows'));
    expect(screen.queryByRole('button', { name: 'Worker 061 Fixture' })).toBeNull();
  });
});
