import { hrRegisterFixture } from '../../helpers/hrRegisterFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Page from '@/app/people/lifecycle/tasks/page';
vi.mock('@/app/people/_components/PersonDrawer', () => ({ default: ({ personId, onClose }: { personId: string | null; onClose: () => void }) => personId ? <div>Selected {personId}<button onClick={onClose}>Close person</button></div> : null }));
const fetchMock = vi.fn();
const task = { task_id: 't-a', workflow_id: 'w-a', person_id: 'p-a', lifecycle_type: 'onboarding', title: 'Review policy', status: 'AWAITING_APPROVAL', due_at: '2026-10-07T00:00:00.000Z', overdue: true };
const queue = { as_of: '2026-10-08T00:00:00.000Z', tasks: [task, { ...task, task_id: 't-b', title: 'Return equipment', status: 'NOT_STARTED', overdue: false, due_at: null }] };
const people = { people: [{ id: 'p-a', first_name: 'Alex', last_name: 'Worker' }] };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(hrRegisterFixture(body, String(fetchMock.mock.calls.at(-1)?.[0] ?? ''), people.people)), { status }));
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((url: string) => json(url === '/api/hr/people' ? people : queue));
});
afterEach(() => vi.unstubAllGlobals());
describe('lifecycle task queue', () => {
  it('renders titles as inert text, UTC dates and undated work, with no automatic mutations', async () => {
    fetchMock.mockImplementation((url: string) => json(url === '/api/hr/people' ? people : { ...queue, tasks: [{ ...task, title: '<script>secret()</script>' }, queue.tasks[1]] }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('<script>secret()</script>')).toBeTruthy();
    expect(screen.getByText('2026-10-07 00:00')).toBeTruthy(); expect(screen.getByText('No due date')).toBeTruthy();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/hr/lifecycle/queue?page=1&search=&filter=all&lifecycle=all']);
    expect(fetchMock.mock.calls.every(call => call[1].cache === 'no-store')).toBe(true);
  });
  it.each(['overdue', 'AWAITING_APPROVAL'])('filters %s then opens and refreshes the person', async filter => {
    renderBrainbase(<Page />); await screen.findByText('Review policy');
    fireEvent.change(screen.getByLabelText('Show tasks'), { target: { value: filter } });
    await screen.findByRole('button', { name: 'Alex Worker' });
    expect(screen.queryByText('Return equipment')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alex Worker' }));
    expect(screen.getByText('Selected p-a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close person' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
  it('filters not-started and empty in-progress work', async () => {
    renderBrainbase(<Page />); await screen.findByText('Review policy');
    fireEvent.change(screen.getByLabelText('Show tasks'), { target: { value: 'NOT_STARTED' } });
    await screen.findByText('Return equipment');
    expect(screen.queryByText('Review policy')).toBeNull(); expect(screen.getByText('Return equipment')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Show tasks'), { target: { value: 'IN_PROGRESS' } });
    expect(await screen.findByText('No visible outstanding tasks match this view.')).toBeTruthy();
  });
  it('clears old rows on a failed refresh and never echoes raw errors', async () => {
    renderBrainbase(<Page />); await screen.findByText('Review policy');
    fetchMock.mockImplementation(() => json({ error: 'secret' }, 503));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Unable to load lifecycle task queue. Please refresh to try again.')).toBeTruthy();
    expect(screen.queryByText('Review policy')).toBeNull(); expect(screen.queryByText('secret')).toBeNull();
  });
  it.each([{ ...task, status: 'COMPLETED' }, { ...task, due_at: 'invalid' }, { ...task, overdue: 'yes' }])('rejects malformed or terminal queue records', async badTask => {
    fetchMock.mockImplementation((url: string) => json(url === '/api/hr/people' ? people : { ...queue, tasks: [badTask] }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('Unable to load lifecycle task queue. Please refresh to try again.')).toBeTruthy();
  });
  it('cancels an outstanding read on unmount', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const view = renderBrainbase(<Page />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); view.unmount();
    expect(fetchMock.mock.calls.every(call => call[1].signal.aborted)).toBe(true);
  });
});
