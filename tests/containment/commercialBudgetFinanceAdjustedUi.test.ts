import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FinanceAdjustedTable,
  type FinanceRow,
} from '@/app/commercial/budgeting/commitments/page';

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'app/commercial/budgeting/commitments/page.tsx'),
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

describe('C7.9F — finance-adjusted Budgeting UI', () => {
  it('keeps the legacy rows table and adds financeRows as a separate surface', () => {
    expect(pageSource).toContain('const rows = useMemo(() => report?.rows ?? []');
    expect(pageSource).toContain('const financeRows = useMemo(() => report?.financeRows ?? []');
    expect(pageSource).toContain('<FinanceAdjustedTable rows={financeRows} />');
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
    expect(html).toContain('xero');
    expect(html).toContain('$30.50');
    expect(html).toContain('-$0.50');
    expect(html).not.toContain('SIGNED_OFF');
  });
});
