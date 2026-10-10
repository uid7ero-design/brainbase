import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Administrators from '@/app/people/administrators/page';
import Teams from '@/app/people/teams/page';
const fetchMock = vi.fn();
const admin = { id: 'admin', name: 'Alex Administrator', email: null, is_hr_administrator: true, grant_eligible: false };
const candidate = { id: 'candidate', name: 'Morgan Candidate', email: null, is_hr_administrator: false, grant_eligible: true };
const team = { id: 'team', name: 'Delivery', description: null, manager_person_id: null, archived_at: null };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let canManage: boolean;
function read(url: string) { return response(url.includes('/administrators') ? { users: [admin, candidate] } : url.includes('/teams') ? { teams: [team] } : { people: [], canManage }); }
beforeEach(() => { canManage = true; fetchMock.mockReset(); fetchMock.mockImplementation((url: string) => Promise.resolve(read(url))); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('HR administration read recovery', () => {
  it.each([['administrators', Administrators, 'Alex Administrator'], ['teams', Teams, 'Delivery']] as const)('%s clears stale records and controls on denied refresh, then recovers', async (mode, Page, label) => {
    renderBrainbase(<Page />); await screen.findByText(label);
    fetchMock.mockResolvedValueOnce(response({ error: 'database secret' }, 403));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText(/Please refresh to try again/);
    expect(screen.queryByText(label)).toBeNull(); expect(screen.queryByText('database secret')).toBeNull();
    expect(screen.queryByRole('button', { name: mode === 'teams' ? '+ Create Team' : 'Grant' })).toBeNull();
    canManage = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await screen.findByText(label);
    if (mode === 'teams') expect(screen.queryByRole('button', { name: '+ Create Team' })).toBeNull();
  });
  it.each([Administrators, Teams])('handles network failures without remaining stuck loading', async Page => {
    fetchMock.mockRejectedValueOnce(new Error('network secret'));
    renderBrainbase(<Page />); await screen.findByText(/Please refresh to try again/);
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('network secret')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/Please refresh to try again/)).toBeNull());
  });
  it('drops Teams authority when only its People/context read fails', async () => {
    renderBrainbase(<Teams />); await screen.findByText('Delivery');
    fetchMock.mockImplementationOnce(() => Promise.resolve(read('/api/hr/teams'))).mockResolvedValueOnce(response({}, 503));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await screen.findByText(/Please refresh to try again/);
    expect(screen.queryByText('Delivery')).toBeNull(); expect(screen.queryByRole('button', { name: '+ Create Team' })).toBeNull();
  });
  it('rejects a string permission flag instead of treating it as management authority', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('/people') ? response({ people: [], canManage: 'false' }) : read(url)));
    renderBrainbase(<Teams />); await screen.findByText(/Please refresh to try again/);
    expect(screen.queryByRole('button', { name: '+ Create Team' })).toBeNull();
  });
  it('cancels superseded archived reads and prevents late permission restoration', async () => {
    const view = renderBrainbase(<Teams />); await screen.findByText('Delivery');
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByLabelText('Show archived'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const pending = fetchMock.mock.calls[2];
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
    expect(pending[1].cache).toBe('no-store');
    view.unmount(); expect(pending[1].signal.aborted).toBe(true);
    canManage = false;
    renderBrainbase(<Teams />); await screen.findByText('Delivery');
    finish(response({ teams: [{ ...team, name: 'Old archived team' }] }));
    await waitFor(() => expect(screen.queryByText('Old archived team')).toBeNull());
    expect(screen.queryByRole('button', { name: '+ Create Team' })).toBeNull();

  });
  it('preserves an open team draft but disables submitting it after failed authority refresh', async () => {
    renderBrainbase(<Teams />); await screen.findByText('Delivery');
    fireEvent.click(screen.getByRole('button', { name: '+ Create Team' }));
    const name = screen.getByRole('textbox', { name: /^Name/ });
    fireEvent.change(name, { target: { value: 'Unsaved team' } });
    fetchMock.mockResolvedValueOnce(response({}, 403));
    fireEvent.click(screen.getByText('Refresh', { exact: true }));
    await screen.findByText(/Please refresh to try again/);
    expect((screen.getByRole('button', { name: 'Create Team', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((name as HTMLInputElement).value).toBe('Unsaved team');
    fireEvent.submit(name.closest('form')!);
    expect(fetchMock.mock.calls.every(call => !call[1].method)).toBe(true);
  });
  it('clears explicit grant selection on refresh without sending any mutation', async () => {
    const view = renderBrainbase(<Administrators />); await screen.findByText('Alex Administrator');
    fireEvent.change(screen.getByLabelText('User to grant HR administrator access'), { target: { value: 'candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await screen.findByText('Alex Administrator');
    expect((screen.getByRole('button', { name: 'Grant' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.every(call => !call[1].method)).toBe(true);
    view.unmount(); expect(fetchMock.mock.calls.every(call => call[1].signal.aborted)).toBe(true);
  });
});
