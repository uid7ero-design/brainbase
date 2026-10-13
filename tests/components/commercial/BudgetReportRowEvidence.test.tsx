import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BudgetCommitmentsPage, { FinanceAdjustedTable, type FinanceRow } from '@/app/commercial/budgeting/commitments/BudgetCommitmentsPage';
import { FinanceReportSummaries } from '@/app/commercial/budgeting/commitments/FinanceReportSummaries';
import { completeReport, consumptionRow, financeRow } from '../../fixtures/commercialBudgetReport';

const base = financeRow as FinanceRow;
const identified: FinanceRow = { ...base, reconciliationId: 'snapshot', sourceSystemId: 'XERO', reconciliationStatus: 'SIGNED_OFF', externalGlActualCents: '0', reconciliationVarianceCents: '0' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Budget row precision and evidence consistency', () => {
  it.each([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])('keeps every resolved row measure exact at %s cents', async amount => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/sources') ? { sourceSystemIds: [] } : url.includes('/reconciliations') ? { reconciliations: [] } : { report: { ...completeReport, rows: [{ ...consumptionRow, budgetCents: amount, actualCents: amount, committedCents: amount, exposureCents: amount, budgetLessActualCents: amount, budgetLessActualAndCommittedCents: amount }] } })));
    render(<BudgetCommitmentsPage />);
    const table = within(await screen.findByRole('region', { name: 'Resolved Budget consumption' }));
    expect(table.getAllByText(`${amount < 0 ? '-' : ''}$90,071,992,547,409.91`)).toHaveLength(6);
    expect(table.queryByText(/409\.90/)).not.toBeInTheDocument();
  });

  it.each(['EXCLUSIVE', 'INCLUSIVE', null] as const)('states Budget basis %s and preserves unknown versus zero in the table', basis => {
    render(<FinanceAdjustedTable rows={[{ ...base, taxBasis: basis, budgetCents: '0' }]} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent(basis === null ? 'Budget basis unavailable' : basis === 'INCLUSIVE' ? 'Tax inclusive' : 'Tax exclusive');
    expect(cells[4]).toHaveTextContent(basis === null ? 'Unavailable' : '$0.00');
    expect(cells[5]).toHaveTextContent('$0.00');
  });

  it.each([{ externalGlActualCents: null }, { reconciliationVarianceCents: null }, { reconciliationId: null }, { sourceSystemId: null }, { reconciliationStatus: null }, { reconciliationId: ' ' }, { sourceSystemId: ' ' }])('table and summary both withhold incomplete ledger evidence: %j', change => {
    const row = { ...identified, ...change };
    render(<><FinanceAdjustedTable rows={[row]} /><FinanceReportSummaries rows={[row]} /></>);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[10]).toHaveTextContent('Unavailable'); expect(cells[11]).toHaveTextContent('Unavailable');
    expect(cells[12]).toHaveTextContent('Ledger evidence incomplete');
    const summary = within(screen.getByRole('region', { name: 'Finance totals AUD Tax exclusive' }));
    expect(summary.getAllByText('Unavailable')).toHaveLength(2);
    expect(summary.getByText(/Ledger evidence covers 0 of 1 row/)).toBeVisible();
  });

  it.each(['SIGNED_OFF', 'STALE'] as const)('retains qualified zero and exact signed measures for %s snapshots', status => {
    render(<FinanceAdjustedTable rows={[{ ...identified, reconciliationStatus: status, financeAdjustmentCents: '-1', effectiveActualCents: '9007199254740993' }]} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[6]).toHaveTextContent('-$0.01'); expect(cells[7]).toHaveTextContent('$90,071,992,547,409.93');
    expect(cells[10]).toHaveTextContent('$0.00'); expect(cells[11]).toHaveTextContent('$0.00');
    expect(cells[12]).toHaveTextContent(status); expect(cells[12]).not.toHaveTextContent('incomplete');
  });

  it('retains stale status when monetary evidence is incomplete without displaying its partial ledger as complete', () => {
    render(<FinanceAdjustedTable rows={[{ ...identified, reconciliationStatus: 'STALE', externalGlActualCents: '100', reconciliationVarianceCents: null }]} />);
    const row = within(screen.getAllByRole('row')[1]);
    expect(row.getByText('STALE')).toBeVisible(); expect(row.getByText('Ledger evidence incomplete')).toBeVisible();
    expect(row.queryByText('$1.00')).not.toBeInTheDocument();
  });
});
