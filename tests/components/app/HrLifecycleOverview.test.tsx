import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Page from '@/app/people/lifecycle/page';

vi.mock('@/app/people/_components/PersonDrawer', () => ({ default: ({ personId, onClose }: { personId: string | null; onClose: () => void }) => personId ? <div>Selected {personId}<button onClick={onClose}>Close person</button></div> : null }));
const fetchMock = vi.fn();
const ROWS = [
  { workflow_id: 'w-a', person_id: 'p-a', lifecycle_type: 'onboarding', visible_tasks: 3, outstanding_tasks: 2, awaiting_approval: 1, overdue_tasks: 1 },
  { workflow_id: 'w-b', person_id: 'p-b', lifecycle_type: 'offboarding', visible_tasks: 1, outstanding_tasks: 0, awaiting_approval: 0, overdue_tasks: 0 },
];
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((url: string) => url === '/api/hr/people'
    ? json({ people: [{ id: 'p-a', first_name: 'Alex', last_name: 'Worker' }, { id: 'p-b', first_name: 'Morgan', last_name: 'Worker' }] })
    : json({ workflows: ROWS }));
});
afterEach(() => vi.unstubAllGlobals());

describe('HR operational lifecycle overview', () => {
  it('renders authorized person names and counts without automatic mutations or AI calls', async () => {
    renderBrainbase(<Page />);
    expect(await screen.findByRole('button', { name: 'Alex Worker' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Onboarding' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Offboarding' })).toBeTruthy();
    expect(fetchMock.mock.calls.map(call => call[0]).sort()).toEqual(['/api/hr/lifecycle/overview', '/api/hr/people']);
    expect(fetchMock.mock.calls.every(call => call[1].cache === 'no-store')).toBe(true);
  });

  it.each(['outstanding', 'approvals', 'overdue'])('filters by %s and opens the selected person', async filter => {
    renderBrainbase(<Page />);
    await screen.findByRole('button', { name: 'Alex Worker' });
    fireEvent.change(screen.getByLabelText('Show workflows'), { target: { value: filter } });
    expect(screen.queryByRole('button', { name: 'Morgan Worker' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alex Worker' }));
    expect(screen.getByText('Selected p-a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close person' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('shows a safe empty state', async () => {
    fetchMock.mockImplementation(() => json({ workflows: [], people: [] }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('No active workflows match this view.')).toBeTruthy();
  });

  it('shows generic failures and supports refresh without echoing server errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'secret' }), { status: 503 }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('Unable to load lifecycle overview. Please refresh to try again.')).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: 'Alex Worker' })).toBeTruthy();
  });

  it('rejects malformed counts rather than displaying misleading totals', async () => {
    fetchMock.mockImplementation(() => json({ people: [], workflows: [{ ...ROWS[0], overdue_tasks: -1 }] }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('Unable to load lifecycle overview. Please refresh to try again.')).toBeTruthy();
  });
});
