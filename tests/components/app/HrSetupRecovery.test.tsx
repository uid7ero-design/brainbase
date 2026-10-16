import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import PersonForm from '@/app/people/_components/PersonForm';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('HR person setup recovery', () => {
  it('never requests setup choices or submits without current management authority', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderBrainbase(<PersonForm canManage={false} onSaved={vi.fn()} />);
    await screen.findByText('Person setup options are unavailable. Refresh before saving.');
    const submit = screen.getByRole('button', { name: 'Create Person' });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(fetcher).not.toHaveBeenCalled();
  });
  for (const outcome of ['network', 'server', 'malformed'] as const) {
    it(`locks a ${outcome} save outcome, ends busy state and never resubmits`, async () => {
      const uncertain = vi.fn();
      const saved = vi.fn();
      const pending = vi.fn();
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          if (outcome === 'network') throw new Error('PRIVATE EXCEPTION');
          return outcome === 'server' ? json({ error: 'PRIVATE RESPONSE' }, 503) : json({ person: null });
        }
        if (url === '/api/hr/teams') return json({ teams: [] });
        if (url === '/api/hr/people') return json({ people: [], canManage: true });
        return json({ users: [] });
      });
      vi.stubGlobal('fetch', fetcher);
      renderBrainbase(<PersonForm canManage onSaved={saved} onUncertain={uncertain} onPendingChange={pending} />);
      const submit = screen.getByRole('button', { name: 'Create Person' });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.change(screen.getByRole('textbox', { name: /^First Name/ }), { target: { value: 'Local' } });
      fireEvent.change(screen.getByRole('textbox', { name: /^Last Name/ }), { target: { value: 'Fixture' } });
      fireEvent.submit(submit.closest('form')!);
      await screen.findByText(/The save could not be confirmed/);
      expect(submit).toBeDisabled();
      expect(pending.mock.calls.map(args => args[0])).toEqual([true, false]);
      fireEvent.submit(submit.closest('form')!);
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      expect(uncertain).toHaveBeenCalledOnce();
      expect(saved).not.toHaveBeenCalled();
      expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
    });
  }

  it('clears failed setup reads and requires a successful refresh before saving', async () => {
    let fail = true;
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/hr/teams') return fail ? json({ error: 'PRIVATE' }, 503) : json({ teams: [] });
      if (url === '/api/hr/people') return json({ people: [], canManage: true });
      return json({ users: [] });
    });
    vi.stubGlobal('fetch', fetcher);
    renderBrainbase(<PersonForm canManage onSaved={vi.fn()} />);
    await screen.findByText('Person setup options are unavailable. Refresh before saving.');
    expect(screen.getByRole('button', { name: 'Create Person' })).toBeDisabled();
    expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh options' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Person' })).toBeEnabled());
  });

  it('treats a known denial as generic and retryable and blocks rapid duplicate submits', async () => {
    let resolveSave: (response: Response) => void = () => {};
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>(resolve => { resolveSave = resolve; });
      return Promise.resolve(json(url === '/api/hr/teams' ? { teams: [] } : url === '/api/hr/people' ? { people: [], canManage: true } : { users: [] }));
    });
    vi.stubGlobal('fetch', fetcher);
    renderBrainbase(<PersonForm canManage onSaved={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Create Person' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.submit(submit.closest('form')!);
    fireEvent.submit(submit.closest('form')!);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    resolveSave(json({ error: 'PRIVATE DENIAL' }, 403));
    await screen.findByText('Could not save person. Review the details and your access.');
    expect(submit).toBeEnabled();
    expect(screen.queryByText('PRIVATE DENIAL')).not.toBeInTheDocument();
  });
});
