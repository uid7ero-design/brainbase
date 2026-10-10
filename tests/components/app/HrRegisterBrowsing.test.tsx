import { hrRegisterFixture } from '../../helpers/hrRegisterFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Lifecycle from '@/app/people/lifecycle/page';
import Tasks from '@/app/people/lifecycle/tasks/page';
import Documents from '@/app/people/documents/page';
vi.mock('@/app/people/_components/PersonDrawer', () => ({ default: () => null }));
const people = Array.from({ length: 61 }, (_, i) => ({ id: `p-${i}`, first_name: `Worker ${String(i + 1).padStart(3, '0')}`, last_name: 'Fixture' }));
const workflows = people.map((person, i) => ({ person_id: person.id, workflow_id: `w-${i}`, lifecycle_type: i % 2 ? 'offboarding' : 'onboarding', visible_tasks: 1, outstanding_tasks: 1, awaiting_approval: 0, overdue_tasks: 1 }));
const tasks = workflows.map((workflow, i) => ({ ...workflow, task_id: `t-${i}`, title: `Task ${i + 1}`, status: 'NOT_STARTED', due_at: null, overdue: false }));
const documents = people.map((person, i) => ({ person_id: person.id, first_name: person.first_name, last_name: person.last_name, documents: 1, missing_version: 0, pending_acknowledgement: 1, unlinked_employee: 0, pending_verification: 1, rejected: 0, expired: i === 60 ? 1 : 0, expiring_soon: 0 }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(hrRegisterFixture(
    url.includes('/queue') ? { as_of: '2026-10-09T00:00:00Z', tasks }
      : url.includes('/documents/') ? { as_of_date: '2026-10-09', expiring_through: '2026-11-08', people: documents } : { workflows }, url, people,
  )))));
});
afterEach(() => vi.unstubAllGlobals());
describe('HR register browsing bundle', () => {
  it.each([['lifecycle', Lifecycle], ['tasks', Tasks], ['documents', Documents]] as const)('%s ignores a late page response after search changes', async (mode, Page) => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const pending = fetchMock.mock.calls[1];
    fireEvent.change(screen.getByLabelText(mode === 'tasks' ? 'Search people or tasks' : 'Search people'), { target: { value: 'Worker 061' } });
    await screen.findByRole('button', { name: 'Worker 061 Fixture' });
    expect(pending[1].signal.aborted).toBe(true);
    const body = mode === 'tasks' ? { as_of: '2026-10-09T00:00:00Z', tasks } : mode === 'documents'
      ? { as_of_date: '2026-10-09', expiring_through: '2026-11-08', people: documents } : { workflows };
    finish(new Response(JSON.stringify(hrRegisterFixture(body, pending[0], people))));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 matching rows'));
    expect(screen.queryByRole('button', { name: 'Worker 026 Fixture' })).toBeNull();
  });
  it.each([['lifecycle', Lifecycle], ['tasks', Tasks], ['documents', Documents]] as const)('%s pages 61 matches without changing counts, and search resets to page one', async (mode, Page) => {
    renderBrainbase(<Page />);
    await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('status').textContent).toContain('61 matching rows');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: 'Worker 026 Fixture' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Worker 001 Fixture' })).toBeNull();
    fireEvent.change(screen.getByLabelText(mode === 'tasks' ? 'Search people or tasks' : 'Search people'), { target: { value: '  WORKER 061  ' } });
    expect(await screen.findByRole('button', { name: 'Worker 061 Fixture' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Page 1 of 1');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('navigation', { name: 'HR operational views' }).querySelectorAll('a')).toHaveLength(4);
  });
  it.each([['lifecycle', Lifecycle], ['tasks', Tasks]] as const)('%s combines lifecycle, text and status filters before pagination', async (mode, Page) => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Lifecycle'), { target: { value: 'offboarding' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Page 1 of 2'));
    expect(screen.getByRole('status').textContent).toContain('30 matching rows');
    fireEvent.change(screen.getByLabelText(mode === 'tasks' ? 'Search people or tasks' : 'Search people'), { target: { value: 'Worker 002' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 matching rows'));
  });
  it('searches task titles independently of person names', async () => {
    renderBrainbase(<Tasks />); await screen.findByText('Task 1');
    fireEvent.change(screen.getByLabelText('Search people or tasks'), { target: { value: 'Task 61' } });
    expect(await screen.findByRole('button', { name: 'Worker 061 Fixture' })).toBeTruthy();
  });
  it('combines document category filtering with search and resets pagination', async () => {
    renderBrainbase(<Documents />); await screen.findByRole('button', { name: 'Worker 001 Fixture' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Show documents'), { target: { value: 'expired' } });
    expect(await screen.findByRole('button', { name: 'Worker 061 Fixture' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Page 1 of 1');
  });
});
