import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FinanceAdjustedTable,
  FinanceReconciliationQueue,
  type FinanceReconciliationQueueEntry,
  type FinanceRow,
} from '@/app/commercial/budgeting/commitments/BudgetCommitmentsPage';

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'app/commercial/budgeting/commitments/BudgetCommitmentsPage.tsx'),
  'utf8',
);

function financeRow(overrides: Partial<FinanceRow> = {}): FinanceRow {
  return {
    budgetId: 'budget-1',
    budgetVersionId: 'version-1',
    budgetAccountId: 'account-1',
    budgetAccountCode: 'OPEX',
    budgetAccountName: 'Operating costs',
    financialYearId: 'fy-1',
    financialYearName: 'FY26',
    financialPeriodId: 'period-1',
    financialPeriodName: 'September',
    currency: 'AUD',
    taxBasis: 'INCLUSIVE',
    periodisationMode: 'PERIODISED',
    budgetCents: '12000',
    sourceActualCents: '2500',
    financeAdjustmentCents: '500',
    effectiveActualCents: '3000',
    committedCents: '7500',
    exposureCents: '10500',
    externalGlActualCents: null,
    reconciliationVarianceCents: null,
    reconciliationId: null,
    reconciliationStatus: null,
    sourceSystemId: null,
    ...overrides,
  };
}

function reconciliationEntry(
  overrides: Partial<FinanceReconciliationQueueEntry> = {},
): FinanceReconciliationQueueEntry {
  return {
    id: 'recon-1',
    financialYearId: 'fy-1',
    financialYearName: 'FY26',
    financialPeriodId: 'period-1',
    financialPeriodName: 'September',
    sourceSystemId: 'xero',
    currency: 'AUD',
    status: 'PREPARED',
    closeId: null,
    sourceActualCents: '2500',
    financeAdjustmentCents: '500',
    brainbaseEffectiveActualCents: '3000',
    externalGlTotalCents: '3050',
    varianceCents: '-50',
    unresolvedItemCount: 1,
    snapshotAt: '2026-09-30T23:59:59.000Z',
    preparedAt: '2026-10-01T00:05:00.000Z',
    reviewedAt: null,
    notes: null,
    items: [{
      id: 'item-1',
      budgetAccountId: 'account-1',
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating costs',
      externalGlAccountCode: '600',
      costCentreId: 'cc-1',
      costCentreCode: 'OPS',
      costCentreName: 'Operations',
      externalCostCentreCode: '100',
      currency: 'AUD',
      sourceActualCents: '2500',
      financeAdjustmentCents: '500',
      brainbaseEffectiveActualCents: '3000',
      externalGlCents: '3050',
      varianceCents: '-50',
      sourceActualCount: 1,
      externalEntryCount: 1,
      outcome: 'VARIANCE',
    }],
    ...overrides,
  };
}

describe('C7.9F — finance-adjusted Budgeting UI', () => {
  it('keeps the legacy rows table and adds financeRows as a separate surface', () => {
    expect(pageSource).toContain('const rows = useMemo(() => report?.rows ?? []');
    expect(pageSource).toContain('const financeRows = useMemo(() => report?.financeRows ?? []');
    expect(pageSource).toContain('<FinanceAdjustedTable rows={filteredFinanceRows} />');
    expect(pageSource).toContain('cost-centre filter does not apply');
    expect(pageSource).toContain('Resolved Budget consumption');
    expect(pageSource).toContain("'Budget less Actual + Committed'");
    expect(pageSource).toContain('Finance-adjusted reporting');
  });

  it('renders all finance measures while null external GL evidence is visibly unavailable', () => {
    const html = renderToStaticMarkup(createElement(FinanceAdjustedTable, {
      rows: [financeRow()],
    }));

    for (const label of [
      'Source Actual',
      'Finance Adjustments',
      'Effective Actual',
      'Committed',
      'Exposure',
      'External GL Actual',
      'Reconciliation Variance',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('OPEX');
    expect(html).toContain('Operating costs');
    expect(html).toContain('$25.00');
    expect(html).toContain('$5.00');
    expect(html).toContain('$30.00');
    expect(html).toContain('$75.00');
    expect(html).toContain('$105.00');
    expect((html.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain('data-reconciliation-status="STALE"');
  });

  it('renders stale reconciliation status and preserves its historical GL amount and variance', () => {
    const html = renderToStaticMarkup(createElement(FinanceAdjustedTable, {
      rows: [financeRow({
        externalGlActualCents: '3050',
        reconciliationVarianceCents: '-50',
        reconciliationId: 'recon-stale-1',
        reconciliationStatus: 'STALE',
        sourceSystemId: 'xero',
      })],
    }));

    expect(html).toContain('data-reconciliation-status="STALE"');
    expect(html).toContain('>STALE<');
    expect(html).toContain('data-reconciliation-id="recon-stale-1"');
    expect(html).toContain('Reconciliation recon-stale-1');
    expect(html).toContain('xero');
    expect(html).toContain('$30.50');
    expect(html).toContain('-$0.50');
    expect(html).not.toContain('SIGNED_OFF');
  });

  it('loads and renders the finance reconciliation queue separately from Actual/Commitment exceptions', () => {
    expect(pageSource).toContain("fetch(`/api/commercial/budgeting/reconciliations${suffix}`");
    expect(pageSource).toContain('<FinanceReconciliationQueue');
    expect(pageSource).toContain('Actual/Commitment exceptions');
    expect(pageSource).toContain('Finance reconciliation items');

    const html = renderToStaticMarkup(createElement(FinanceReconciliationQueue, {
      reconciliations: [reconciliationEntry({ status: 'STALE' })],
      loading: false,
      error: null,
      sourceSystemId: 'xero',
    }));

    expect(html).toContain('Finance reconciliation queue');
    expect(html).toContain('Latest unresolved snapshot for xero');
    expect(html).toContain('data-finance-reconciliation-status="STALE"');
    expect(html).toContain('data-reconciliation-outcome="VARIANCE"');
    expect(html).toContain('data-finance-reconciliation-id="recon-1"');
    expect(html).toContain('OPEX');
    expect(html).toContain('Operating costs');
    expect(html).toContain('600');
    expect(html).toContain('OPS');
    expect(html).toContain('Operations');
    expect(html).toContain('$25.00');
    expect(html).toContain('$5.00');
    expect(html).toContain('$30.00');
    expect(html).toContain('$30.50');
    expect(html).toContain('-$0.50');
  });

  it('shows loading, error and clean finance reconciliation queue states without inventing items', () => {
    const loading = renderToStaticMarkup(createElement(FinanceReconciliationQueue, {
      reconciliations: [],
      loading: true,
      error: null,
      sourceSystemId: null,
    }));
    expect(loading).toContain('Loading finance reconciliation items');
    expect(loading).not.toContain('data-reconciliation-outcome');

    const error = renderToStaticMarkup(createElement(FinanceReconciliationQueue, {
      reconciliations: [],
      loading: false,
      error: 'Unable to load the finance reconciliation queue.',
      sourceSystemId: null,
    }));
    expect(error).toContain('Unable to load the finance reconciliation queue.');

    const clean = renderToStaticMarkup(createElement(FinanceReconciliationQueue, {
      reconciliations: [],
      loading: false,
      error: null,
      sourceSystemId: null,
    }));
    expect(clean).toContain('No unresolved finance reconciliation items in the latest snapshots.');
    expect(clean).toContain('Latest unresolved snapshots across all External GL sources');
  });
});
