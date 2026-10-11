import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BudgetCommitmentsPage from '@/app/commercial/budgeting/commitments/BudgetCommitmentsPage';

const report = (count = 0) => ({ rows: [], financeRows: [], exceptions: [], resolvedActualCount: count, resolvedCommitmentCount: 0, unresolvedExceptionCount: 0 });
const response = (body: unknown) => Response.json(body);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Budget reporting read recovery', () => {
  it.each(['network', 'json', 'incomplete', 'denied'])('recovers a %s report failure through GET only', async failure => {
    let broken = true;
    const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
      if (_options?.method && _options.method !== 'GET') throw new Error('Unexpected reporting mutation');
      if (url.includes('/sources')) return response({ sourceSystemIds: [] });
      if (url.includes('/reconciliations')) return response({ reconciliations: [] });
      if (broken) {
        if (failure === 'network') throw new Error('offline');
        if (failure === 'json') return new Response('<html>unavailable</html>');
        if (failure === 'denied') return new Response('', { status: 403 });
        return response({ report: { rows: [] } });
      }
      return response({ report: report() });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<BudgetCommitmentsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(failure === 'denied' ? 'Budgeting access is required' : 'Unable to load');
    expect(screen.queryByText('No Budget consumption report is available.')).not.toBeInTheDocument();
    expect(document.querySelectorAll('a[data-export-view]')).toHaveLength(0);
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByRole('heading', { name: 'Budget vs Actual vs Committed' });
    expect(screen.getByText('No unresolved finance reconciliation items in the latest snapshots.')).toBeVisible();
    expect(fetcher.mock.calls.every(([, options]) => !options || !(options as RequestInit).method || (options as RequestInit).method === 'GET')).toBe(true);
  });

  it('shows unavailable queue totals rather than zero and recovers without changing the source', async () => {
    let broken = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/sources')) return response({ sourceSystemIds: ['XERO'] });
      if (url.includes('/reconciliations')) {
        if (broken) throw new Error('offline');
        return response({ reconciliations: [] });
      }
      return response({ report: report() });
    }));
    render(<BudgetCommitmentsPage />);
    await screen.findByRole('alert');
    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.queryByText('No unresolved finance reconciliation items in the latest snapshots.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Finance source'), { target: { value: 'XERO' } });
    await screen.findByRole('alert');
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText('No unresolved finance reconciliation items in the latest snapshots.');
    expect(screen.getByLabelText('Finance source')).toHaveValue('XERO');
  });

  it('does not let a delayed old source body replace the selected report or queue', async () => {
    let releaseReport!: (value: unknown) => void;
    let releaseQueue!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/sources')) return response({ sourceSystemIds: ['OLD', 'NEW'] });
      if (url.includes('sourceSystemId=OLD')) return {
        ok: true,
        json: () => new Promise(resolve => { if (url.includes('/consumption')) releaseReport = resolve; else releaseQueue = resolve; }),
      };
      return response(url.includes('/consumption') ? { report: report(7) } : { reconciliations: [] });
    }));
    render(<BudgetCommitmentsPage />);
    await screen.findByRole('heading', { name: 'Budget vs Actual vs Committed' });
    // Start an OLD read, then change the source while its body remains pending.
    fireEvent.change(screen.getByLabelText('Finance source'), { target: { value: 'OLD' } });
    await waitFor(() => expect(releaseReport).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Finance source'), { target: { value: 'NEW' } });
    await screen.findByRole('heading', { name: 'Budget vs Actual vs Committed' });
    await act(async () => {
      releaseReport({ report: report(3) });
      releaseQueue({ reconciliations: [{ items: [null] }] });
    });
    expect(screen.getByLabelText('Finance source')).toHaveValue('NEW');
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByText('No unresolved finance reconciliation items in the latest snapshots.')).toBeVisible();
  });

  it('recovers a failed sources read using Refresh sources', async () => {
    let broken = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/sources')) { if (broken) throw new Error('offline'); return response({ sourceSystemIds: ['XERO'] }); }
      return response(url.includes('/consumption') ? { report: report() } : { reconciliations: [] });
    }));
    render(<BudgetCommitmentsPage />);
    await screen.findByText(/Unable to load External GL sources/);
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
    await screen.findByRole('option', { name: 'XERO' });
    expect(screen.queryByText(/Unable to load External GL sources/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Finance source')).toHaveValue('');
  });
});
