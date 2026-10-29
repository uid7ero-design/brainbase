import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BudgetCommitmentsPage from '@/app/commercial/budgeting/commitments/BudgetCommitmentsPage';
import { completeReport } from '../../fixtures/commercialBudgetReport';

let choices: string[], saved: typeof completeReport, failReport: boolean, failSources: boolean;
const fetcher = vi.fn(async (url: string) => {
  if (url.includes('/sources')) return Response.json(failSources ? {} : { sourceSystemIds: choices });
  if (url.includes('/reconciliations')) return Response.json({ reconciliations: [] });
  return Response.json(failReport ? {} : { report: saved });
});
beforeEach(() => {
  choices = ['XERO', 'OTHER']; saved = structuredClone(completeReport); failReport = false; failSources = false;
  fetcher.mockClear(); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function ready() { render(<BudgetCommitmentsPage />); await screen.findByRole('region', { name: 'Finance-adjusted report' }); }
async function chooseSource(value: string) {
  fireEvent.change(screen.getByLabelText('Finance source'), { target: { value } });
  await screen.findByRole('region', { name: 'Finance-adjusted report' });
}
const reportReads = () => fetcher.mock.calls.filter(([url]) => url.includes('/consumption')).length;
const queueReads = () => fetcher.mock.calls.filter(([url]) => url.includes('/reconciliations')).length;
async function loseSource() {
  choices = ['OTHER']; fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
  await screen.findByText(/The selected source is no longer available/);
}

describe('Budget report source and review recovery', () => {
  it('pauses reports and exports when a selected source disappears without reading a fallback scope', async () => {
    await ready(); await chooseSource('XERO'); const reads = [reportReads(), queueReads()];
    await loseSource();
    expect(screen.getByLabelText('Finance source')).toHaveValue('XERO');
    expect(screen.getByRole('option', { name: 'XERO (unavailable)' })).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText('Finance source')).toHaveFocus());
    expect(screen.queryByRole('region', { name: 'Finance-adjusted report' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('a[data-export-view]')).toHaveLength(0);
    expect([reportReads(), queueReads()]).toEqual(reads);
  });
  it.each(['', 'OTHER'])('requires an explicit replacement source %s and restores matching export scope', async source => {
    await ready(); await chooseSource('XERO'); await loseSource(); await chooseSource(source);
    const href = document.querySelector('a[data-export-view="finance"]')?.getAttribute('href');
    expect(href?.includes('sourceSystemId=OTHER')).toBe(source === 'OTHER');
    expect(href).not.toContain('XERO');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Budget vs Actual vs Committed' })).toHaveFocus());
  });
  it('requires fresh report and queue reads when a removed source returns', async () => {
    await ready(); await chooseSource('XERO'); await loseSource(); const reads = [reportReads(), queueReads()];
    choices = ['XERO']; saved.resolvedActualCount = 7;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
    await screen.findByRole('region', { name: 'Finance-adjusted report' });
    expect([reportReads(), queueReads()]).toEqual(reads.map(value => value + 1));
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByLabelText('Finance source')).toHaveValue('XERO');
  });
  it('keeps exports paused when a returned source has an invalid report, then recovers through a fresh read', async () => {
    await ready(); await chooseSource('XERO'); await loseSource(); choices = ['XERO']; failReport = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
    const alert = await screen.findByText('Unable to load Budget vs Actual reporting. Reload the report to try again.');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText('Finance source')).toHaveValue('XERO');
    expect(document.querySelectorAll('a[data-export-view]')).toHaveLength(0);
    failReport = false; fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByRole('region', { name: 'Finance-adjusted report' });
    expect(document.querySelector('a[data-export-view="finance"]')).toHaveAttribute('href', expect.stringContaining('sourceSystemId=XERO'));
  });
  it('keeps the last valid source and report on failed source refresh', async () => {
    await ready(); await chooseSource('XERO'); const reads = reportReads(); failSources = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
    await screen.findByText('Unable to load External GL sources.');
    expect(screen.getByLabelText('Finance source')).toHaveValue('XERO');
    expect(reportReads()).toBe(reads); expect(screen.getByRole('region', { name: 'Finance-adjusted report' })).toBeVisible();
  });
  it('refreshes the current report even when successful source choices are unchanged', async () => {
    await ready(); await chooseSource('XERO'); const reads = reportReads(); saved.resolvedActualCount = 8;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
    await screen.findByText('8'); expect(reportReads()).toBe(reads + 1);
  });
  it('ignores a pending removed-source body after another source loads', async () => {
    await ready(); let release!: (body: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/consumption?sourceSystemId=XERO')) return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
      return fetcher(url);
    }));
    fireEvent.change(screen.getByLabelText('Finance source'), { target: { value: 'XERO' } });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    await loseSource(); await chooseSource('OTHER');
    await act(async () => release({ report: { ...saved, resolvedActualCount: 99 } }));
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Finance source')).toHaveValue('OTHER');
  });
  it('focuses a failed reload and then the successfully recovered heading', async () => {
    await ready(); failReport = true; fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    const alert = await screen.findByRole('alert'); await waitFor(() => expect(alert).toHaveFocus());
    failReport = false; fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Budget vs Actual vs Committed' })).toHaveFocus());
    expect(screen.getByText('Report loaded. BrainBase only; finance-adjusted rows exclude External GL evidence.')).toBeVisible();
  });
});

describe('Budget report unavailable filter review', () => {
  it.each([
    ['Financial year', 'financialYearId', 'year'], ['Financial period', 'financialPeriodId', 'period'],
    ['Budget account', 'budgetAccountId', 'account'], ['Cost centre', 'costCentreId', 'centre'], ['Currency', 'currency', 'AUD'],
  ])('retains and explains unavailable %s, then clears only the missing selection', async (label, key, value) => {
    await ready();
    const retainedLabel = key === 'budgetAccountId' ? 'Currency' : 'Budget account';
    const retainedValue = retainedLabel === 'Currency' ? 'AUD' : 'account';
    fireEvent.change(screen.getByLabelText(retainedLabel), { target: { value: retainedValue } });
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    Object.assign(saved.rows[0], { [key]: key === 'currency' ? 'USD' : 'replacement' });
    if (key !== 'costCentreId') Object.assign(saved.financeRows[0], { [key]: key === 'currency' ? 'USD' : 'replacement' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText(/Some filters are no longer available/);
    expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(screen.getByRole('option', { name: 'Previously selected (unavailable)' })).toBeDisabled();
    expect(screen.getByLabelText(retainedLabel)).toHaveValue(retainedValue);
    fireEvent.click(screen.getByRole('button', { name: 'Clear unavailable filters' }));
    expect(screen.getByLabelText(label)).toHaveValue('ALL');
    expect(screen.getByLabelText(retainedLabel)).toHaveValue(retainedValue);
    expect(screen.queryByText(/Some filters are no longer available/)).not.toBeInTheDocument();
  });
});
