import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Page from '@/app/people/documents/page';
vi.mock('@/app/people/_components/PersonDrawer', () => ({ default: ({ personId, onClose }: { personId: string | null; onClose: () => void }) => personId ? <div>Selected {personId}<button onClick={onClose}>Close person</button></div> : null }));
const fetchMock = vi.fn();
const person = { person_id: 'p-a', first_name: 'Alex', last_name: 'Worker', documents: 3, missing_version: 0, pending_acknowledgement: 1, unlinked_employee: 0, pending_verification: 1, rejected: 0, expired: 1, expiring_soon: 0 };
const snapshot = { as_of_date: '2026-10-08', expiring_through: '2026-11-07', people: [person, { ...person, person_id: 'p-b', first_name: 'Morgan', expired: 0, pending_acknowledgement: 0, pending_verification: 0 }] };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(() => json(snapshot)); });
afterEach(() => vi.unstubAllGlobals());
describe('document assurance overview', () => {
  it('reads only the overview, explains overlapping counts and makes no mutation/provider requests', async () => {
    renderBrainbase(<Page />);
    expect(await screen.findByRole('button', { name: 'Alex Worker' })).toBeTruthy();
    expect(screen.getByText(/Counts cover current versions and may overlap/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hr/documents/overview');
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
  });
  it.each(['expired', 'pending_acknowledgement', 'pending_verification'])('filters %s and opens/refreshes the authorized person', async filter => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Alex Worker' });
    fireEvent.change(screen.getByLabelText('Show documents'), { target: { value: filter } });
    expect(screen.queryByRole('button', { name: 'Morgan Worker' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alex Worker' }));
    expect(screen.getByText('Selected p-a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close person' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
  it('shows an empty state without implying document access to anyone else', async () => {
    fetchMock.mockImplementation(() => json({ ...snapshot, people: [] }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('No visible employee documents match this view.')).toBeTruthy();
  });
  it('clears prior counts on refresh failure and never echoes a server error', async () => {
    renderBrainbase(<Page />); await screen.findByRole('button', { name: 'Alex Worker' });
    fetchMock.mockImplementation(() => json({ error: 'secret' }, 503));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Unable to load document overview. Please refresh to try again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alex Worker' })).toBeNull();
    expect(screen.queryByText('secret')).toBeNull();
  });
  it('rejects malformed counts', async () => {
    fetchMock.mockImplementation(() => json({ ...snapshot, people: [{ ...person, expired: -1 }] }));
    renderBrainbase(<Page />);
    expect(await screen.findByText('Unable to load document overview. Please refresh to try again.')).toBeTruthy();
  });
  it('ignores a late response from an aborted refresh', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const view = renderBrainbase(<Page />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify(snapshot)));
  });
});
