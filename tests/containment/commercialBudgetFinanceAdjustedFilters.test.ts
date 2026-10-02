import { describe, expect, it } from 'vitest';
import {
  filterFinanceAdjustedRows,
  type FinanceRow,
} from '@/app/commercial/budgeting/commitments/page';

function financeRow(overrides: Partial<FinanceRow> = {}): FinanceRow {
  return {
    budgetId: 'budget-1',
    budgetVersionId: 'version-1',
    budgetAccountId: 'account-a',
    budgetAccountCode: 'A',
    budgetAccountName: 'Account A',
    financialYearId: 'fy-26',
    financialYearName: 'FY26',
    financialPeriodId: 'period-sep',
    financialPeriodName: 'September',
    currency: 'AUD',
    taxBasis: 'EXCLUSIVE',
    periodisationMode: 'PERIODISED',
    budgetCents: '10000',
    sourceActualCents: '1000',
    financeAdjustmentCents: '0',
    effectiveActualCents: '1000',
    committedCents: '2000',
    exposureCents: '3000',
    externalGlActualCents: null,
    reconciliationVarianceCents: null,
    reconciliationId: null,
    reconciliationStatus: null,
    sourceSystemId: null,
    ...overrides,
  };
}

const ALL = {
  financialYearId: 'ALL',
  financialPeriodId: 'ALL',
  budgetAccountId: 'ALL',
  currency: 'ALL',
};

describe('C7.9F — finance-adjusted table filters', () => {
  it('filters only by dimensions present at the finance account-period-currency grain', () => {
    const rows = [
      financeRow(),
      financeRow({
        budgetAccountId: 'account-b',
        budgetAccountCode: 'B',
        financialYearId: 'fy-27',
        financialYearName: 'FY27',
        financialPeriodId: 'period-oct',
        financialPeriodName: 'October',
        currency: 'USD',
      }),
    ];

    expect(filterFinanceAdjustedRows(rows, { ...ALL, financialYearId: 'fy-26' }))
      .toEqual([rows[0]]);
    expect(filterFinanceAdjustedRows(rows, { ...ALL, financialPeriodId: 'period-oct' }))
      .toEqual([rows[1]]);
    expect(filterFinanceAdjustedRows(rows, { ...ALL, budgetAccountId: 'account-b' }))
      .toEqual([rows[1]]);
    expect(filterFinanceAdjustedRows(rows, { ...ALL, currency: 'AUD' }))
      .toEqual([rows[0]]);
  });

  it('does not apply the legacy cost-centre filter to finance-grain rows', () => {
    const rows = [financeRow(), financeRow({ budgetAccountId: 'account-b' })];
    const filters = { ...ALL, costCentreId: 'cost-centre-that-does-not-exist-on-finance-rows' };

    expect(filterFinanceAdjustedRows(rows, filters)).toEqual(rows);
  });
});
