import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BudgetCommitmentsPage, { type FinanceRow } from '@/app/commercial/budgeting/commitments/BudgetCommitmentsPage';
import { FinanceReportSummaries } from '@/app/commercial/budgeting/commitments/FinanceReportSummaries';
import { completeReport, financeRow, consumptionRow } from '../../fixtures/commercialBudgetReport';
const base = financeRow as FinanceRow;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Finance report summary review', () => {
  it('renders exact large and negative values and incomplete evidence without a zero ledger claim', () => {
    render(<FinanceReportSummaries rows={[{ ...base, sourceActualCents: '900719925474099313', financeAdjustmentCents: '-101' }]} />);
    const summary = within(screen.getByRole('region', { name: 'Finance totals AUD Tax exclusive' }));
    expect(summary.getByText('$9,007,199,254,740,993.13')).toBeVisible(); expect(summary.getByText('-$1.01')).toBeVisible();
    expect(summary.getAllByText('Unavailable')).toHaveLength(2); expect(summary.getByText('Incomplete evidence is not a zero ledger total.')).toBeVisible();
  });
  it('shows stale evidence explicitly and separates unknown basis', () => {
    render(<FinanceReportSummaries rows={[{ ...base, taxBasis: null, externalGlActualCents: '100', reconciliationVarianceCents: '-100', reconciliationId: 'recon', sourceSystemId: 'XERO', reconciliationStatus: 'STALE' }]} />);
    const region = within(screen.getByRole('region', { name: 'Finance totals AUD Budget basis unavailable' }));
    expect(region.getByText('Ledger evidence covers 1 of 1 row. Snapshot row statuses: 0 signed off, 1 stale.')).toBeVisible();
    expect(region.getByText(/Stale snapshot rows are present/)).toBeVisible(); expect(region.getAllByText('Unavailable')).toHaveLength(1);
    expect(region.getByText('Budget').parentElement).toHaveTextContent('Unavailable');
  });
  it('hides the totals section when there are no finance rows', () => {
    render(<FinanceReportSummaries rows={[]} />); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('keeps legacy mixed bases separate while rendering a large aggregate exactly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/sources') ? { sourceSystemIds: [] } : url.includes('/reconciliations') ? { reconciliations: [] } : { report: { ...completeReport, rows: [
      { ...consumptionRow, budgetCents: Number.MAX_SAFE_INTEGER }, { ...consumptionRow, costCentreId: 'centre-2', budgetCents: 2 }, { ...consumptionRow, costCentreId: 'centre-3', taxBasis: 'INCLUSIVE' },
    ] } })));
    render(<BudgetCommitmentsPage />);
    const exclusive = within(await screen.findByRole('region', { name: 'Resolved totals AUD Tax exclusive' }));
    expect(exclusive.getByText('$90,071,992,547,409.93')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Resolved totals AUD Tax inclusive' })).toBeVisible();
  });
  it('finance totals follow account and currency filters but remain independent of the cost centre', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/sources') ? { sourceSystemIds: [] } : url.includes('/reconciliations') ? { reconciliations: [] } : { report: { ...completeReport,
      rows: [consumptionRow, { ...consumptionRow, costCentreId: 'other', costCentreCode: 'OTHER' }],
      financeRows: [financeRow, { ...financeRow, budgetAccountId: 'other-account', budgetAccountCode: 'OTHER', currency: 'USD' }],
    } })));
    render(<BudgetCommitmentsPage />); await screen.findByRole('region', { name: 'Finance totals AUD Tax exclusive' });
    fireEvent.change(screen.getByLabelText('Cost centre'), { target: { value: 'other' } });
    expect(screen.getByRole('region', { name: 'Finance totals USD Tax exclusive' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'AUD' } });
    expect(screen.queryByRole('region', { name: 'Finance totals USD Tax exclusive' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Budget account'), { target: { value: 'other-account' } });
    expect(screen.queryByRole('region', { name: 'Finance-adjusted totals' })).not.toBeInTheDocument();
  });
});
