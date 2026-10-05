import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Settings → Risk levels (jsdom): classification from server data, admin vs
// read-only rendering, empty state, the inert "requires verification" help,
// and the serious-set confirmation round trip (server 409 → confirm →
// resubmit with the exact acknowledgement).

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/assurance/settings/risk-levels',
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  useParams: () => ({}),
}));

const { default: RiskLevelsManager } = await import('@/app/assurance/_components/RiskLevelsManager');
type Level = Parameters<typeof RiskLevelsManager>[0]['levels'][number];

const lvl = (code: string, name: string, rank: number, extra: Partial<Level> = {}): Level => ({
  id: `00000000-0000-4000-8000-0000000000${rank}`, code, name, description: `${name} description`, rank,
  is_active: true, requires_verification: rank >= 30, serious: false, revision: `rev-${rank}`, usage_count: 0, ...extra,
});
const BRAINBASE: Level[] = [
  lvl('EXTREME', 'Extreme', 40, { serious: true }),
  lvl('HIGH', 'High', 30, { serious: true }),
  lvl('MEDIUM', 'Medium', 20),
  lvl('LOW', 'Low', 10),
  lvl('RETIRED', 'Retired', 50, { is_active: false }),
].sort((a, b) => b.rank - a.rank);

afterEach(() => { vi.unstubAllGlobals(); refresh.mockReset(); });

describe('RiskLevelsManager', () => {
  it('renders the Brainbase matrix in rank order with Serious / Standard / Inactive classification', () => {
    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister />);
    const table = screen.getByRole('table', { name: 'Risk levels' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Retired', 'Extreme', 'High', 'Medium', 'Low']);
    const cls = (name: string) => within(rows.find(r => r.textContent?.startsWith(name))!).getAllByRole('cell')[5].textContent;
    expect(cls('Extreme')).toContain('Serious');
    expect(cls('High')).toContain('Serious');
    expect(cls('Medium')).toContain('Standard');
    expect(cls('Retired')).toContain('Inactive');
    expect(screen.getByText('The two highest-ranked active risk levels are currently treated as serious on the Assurance dashboard.')).toBeTruthy();
  });

  it('admins get create/edit/deactivate/reactivate; never a delete control', () => {
    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister />);
    expect(screen.getByRole('button', { name: 'Create risk level' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit Extreme' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Deactivate High' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Reactivate Retired' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('non-admins see the list but no mutation controls', () => {
    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister={false} />);
    expect(screen.getByRole('table', { name: 'Risk levels' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create|edit|deactivate|reactivate|delete/i })).toBeNull();
  });

  it('empty state: admins get a create CTA, others do not', () => {
    const { unmount } = renderBrainbase(<RiskLevelsManager levels={[]} canAdminister />);
    expect(screen.getByText('No risk levels have been configured for this organisation.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create risk level' })).toBeTruthy();
    unmount();
    renderBrainbase(<RiskLevelsManager levels={[]} canAdminister={false} />);
    expect(screen.getByText('No risk levels have been configured for this organisation.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create risk level' })).toBeNull();
  });

  it('the create form carries the inert requires-verification help; edit shows the code read-only', () => {
    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister />);
    fireEvent.click(screen.getByRole('button', { name: 'Create risk level' }));
    const dialog = screen.getByRole('dialog', { name: 'Create risk level' });
    expect(within(dialog).getByText('Recorded for policy/configuration purposes. This setting does not currently enforce verification automatically.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit High' })[0]);
    const edit = screen.getByRole('dialog', { name: 'Edit High' });
    const code = within(edit).getByLabelText('Code') as HTMLInputElement;
    expect(code.value).toBe('HIGH');
    expect(code.readOnly).toBe(true);
    expect(within(edit).getByText(/cannot be changed after the risk level is created/)).toBeTruthy();
  });

  it('deactivation explains historical retention before confirming', () => {
    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate Medium' })[0]);
    const d = screen.getByRole('dialog', { name: 'Deactivate Medium' });
    expect(within(d).getByText(/Existing records keep this risk level and continue to show it/)).toBeTruthy();
    expect(within(d).getByText(/no longer be offered when recording new/)).toBeTruthy();
  });

  it('a serious-set change is confirmed with the server-calculated before/after, then resubmitted with the exact acknowledgement', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          error: 'Changing this will change which risk levels are treated as serious on the Assurance dashboard.',
          details: {
            code: 'SERIOUS_CHANGE_CONFIRMATION',
            before: [{ code: 'EXTREME', name: 'Extreme' }, { code: 'HIGH', name: 'High' }],
            after: [{ code: 'HIGH', name: 'High' }, { code: 'MEDIUM', name: 'Medium' }],
            acknowledge: ['HIGH', 'MEDIUM'],
          },
        }), { status: 409 });
      }
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate Extreme' })[0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Deactivate Extreme' })).getByRole('button', { name: 'Deactivate' }));

    const confirm = await screen.findByRole('dialog', { name: 'Confirm serious-risk change' });
    expect(within(confirm).getByText('Changing this will change which risk levels are treated as serious on the Assurance dashboard.')).toBeTruthy();
    expect(within(confirm).getByText('Extreme, High')).toBeTruthy();
    expect(within(confirm).getByText('High, Medium')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('/api/assurance/risk-levels/00000000-0000-4000-8000-000000000040/deactivate');
    expect(calls[0].body).toEqual({ expectedRevision: 'rev-40' });
    expect(calls[1].body).toEqual({ expectedRevision: 'rev-40', acknowledgeSerious: ['HIGH', 'MEDIUM'] });
  });

  it('server errors are shown and nothing refreshes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Rank 30 is already used by "High".' }), { status: 409 })));
    renderBrainbase(<RiskLevelsManager levels={BRAINBASE} canAdminister />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reactivate Retired' })[0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reactivate Retired' })).getByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText('Rank 30 is already used by "High".')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
