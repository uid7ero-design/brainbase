import { describe, expect, it } from 'vitest';
import {
  buildBudgetFilterOptions,
  filterFinanceAdjustedRows,
  type ConsumptionRow,
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

function consumptionRow(overrides: Partial<ConsumptionRow> = {}): ConsumptionRow {
  return {
    budgetId: 'budget-1',
    budgetVersionId: 'version-1',
    budgetAccountId: 'account-a',
    budgetAccountCode: 'A',
    budgetAccountName: 'Account A',
    costCentreId: 'cc-a',
    costCentreCode: 'OPS',
    costCentreName: 'Operations',
    financialYearId: 'fy-26',
    financialYearName: 'FY26',
    financialPeriodId: 'period-sep',
    financialPeriodName: 'September',
    currency: 'AUD',
    taxBasis: 'EXCLUSIVE',
    periodisationMode: 'PERIODISED',
    annualBudgetCents: 120000,
    periodBudgetCents: 10000,
    budgetCents: 10000,
    actualCents: 1000,
    committedCents: 2000,
    exposureCents: 3000,
    budgetLessActualCents: 9000,
    budgetLessActualAndCommittedCents: 7000,
    actualLineCount: 1,
    commitmentCount: 1,
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

  it('includes finance-only year, period, account and currency values in shared filter options', () => {
    const legacyRows = [consumptionRow()];
    const financeOnly = financeRow({
      financialYearId: 'fy-27',
      financialYearName: 'FY27',
      financialPeriodId: 'period-oct',
      financialPeriodName: 'October',
      budgetAccountId: 'account-b',
      budgetAccountCode: 'B',
      budgetAccountName: 'Account B',
      currency: 'USD',
    });

    const options = buildBudgetFilterOptions(legacyRows, [financeOnly], 'ALL');

    expect(options.financialYears).toEqual([
      ['fy-26', 'FY26'],
      ['fy-27', 'FY27'],
    ]);
    expect(options.financialPeriods).toEqual([
      ['period-oct', 'October'],
      ['period-sep', 'September'],
    ]);
    expect(options.accounts).toEqual([
      ['account-a', 'A — Account A'],
      ['account-b', 'B — Account B'],
    ]);
    expect(options.currencies).toEqual(['AUD', 'USD']);
    expect(options.costCentres).toEqual([
      ['cc-a', 'OPS — Operations'],
    ]);
  });

  it('limits period options across both grains when a financial year is selected', () => {
    const options = buildBudgetFilterOptions(
      [consumptionRow()],
      [financeRow({
        financialYearId: 'fy-27',
        financialYearName: 'FY27',
        financialPeriodId: 'period-oct',
        financialPeriodName: 'October',
      })],
      'fy-27',
    );

    expect(options.financialPeriods).toEqual([
      ['period-oct', 'October'],
    ]);
  });

  it('does not apply the legacy cost-centre filter to finance-grain rows', () => {
    const rows = [financeRow(), financeRow({ budgetAccountId: 'account-b' })];
    const filters = { ...ALL, costCentreId: 'cost-centre-that-does-not-exist-on-finance-rows' };

    expect(filterFinanceAdjustedRows(rows, filters)).toEqual(rows);
  });
});
