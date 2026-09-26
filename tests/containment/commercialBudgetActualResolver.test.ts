import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBudgetActualReportMock = vi.fn();
vi.mock('@/lib/commercial/budgetActuals', () => ({
  getBudgetActualReport: (...args: unknown[]) => getBudgetActualReportMock(...args),
}));
const getActiveBudgetContextMock = vi.fn();
vi.mock('@/lib/commercial/budgetCommitmentResolver', () => ({
  getActiveBudgetContext: (...args: unknown[]) => getActiveBudgetContextMock(...args),
}));

const { deriveBudgetActualConsumption, getBudgetActualConsumption } =
  await import('@/lib/commercial/budgetActualResolver');

import type { BudgetActualLine, BudgetActualReport } from '@/lib/commercial/budgetActuals';
import type { ActiveBudgetContext } from '@/lib/commercial/budgetCommitmentResolver';

const actual = (overrides: Partial<BudgetActualLine> = {}): BudgetActualLine => ({
  supplierBillLineId: 'sbl-1',
  supplierBillId: 'sb-1',
  supplierBillNumber: 'BILL-1',
  supplierId: 'sup-1',
  supplierName: 'Supplier',
  sourcePurchaseOrderId: 'po-1',
  sourcePurchaseOrderLineId: 'pol-1',
  currency: 'AUD',
  recognisedAt: '2026-09-15T12:00:00.000Z',
  periodResolution: 'RESOLVED',
  financialPeriodId: 'fp-1',
  financialPeriodName: 'September',
  financialPeriodStatus: 'OPEN',
  financialYearId: 'fy-1',
  financialYearName: 'FY26',
  effectiveCostCentreId: 'cc-1',
  effectiveCostCentreCode: 'OPS',
  effectiveCostCentreName: 'Operations',
  subtotalCents: 10000,
  taxCents: 1000,
  totalCents: 11000,
  exceptionCodes: [],
  ...overrides,
});

const report = (lines: BudgetActualLine[] = [actual()]): BudgetActualReport => ({
  lineCount: lines.length,
  resolvedPeriodCount: lines.filter(x => x.periodResolution === 'RESOLVED').length,
  unresolvedPeriodCount: lines.filter(x => x.periodResolution === 'UNRESOLVED').length,
  ambiguousPeriodCount: lines.filter(x => x.periodResolution === 'AMBIGUOUS').length,
  exceptionLineCount: lines.filter(x => x.exceptionCodes.length > 0).length,
  currencies: [],
  lines,
});

const context = (overrides: Partial<ActiveBudgetContext> = {}): ActiveBudgetContext => ({
  budgetIdentities: [{ financialYearId: 'fy-1', currency: 'AUD', hasActiveVersion: true }],
  budgets: [{
    budgetId: 'b-1', financialYearId: 'fy-1', financialYearName: 'FY26', currency: 'AUD',
    taxBasis: 'INCLUSIVE', periodisationMode: 'PERIODISED', activeVersionId: 'v-1', versionNumber: 1,
  }],
  mappings: [{
    budgetVersionId: 'v-1', costCentreId: 'cc-1', budgetAccountId: 'acc-1',
    budgetAccountCode: 'OPEX', budgetAccountName: 'Operating',
  }],
  lines: [{
    budgetLineId: 'bl-1', budgetVersionId: 'v-1', budgetAccountId: 'acc-1',
    costCentreId: 'cc-1', annualBudgetCents: 120000,
  }],
  periodAllocations: [{ budgetLineId: 'bl-1', financialPeriodId: 'fp-1', amountCents: 10000 }],
  ...overrides,
});

beforeEach(() => {
  getBudgetActualReportMock.mockReset();
  getActiveBudgetContextMock.mockReset();
});

describe('C7.8B — Actual to ACTIVE Budget classification', () => {
  it('resolves ACTIVE version/account/line and applies INCLUSIVE tax basis', () => {
    const result = deriveBudgetActualConsumption(report(), context());
    expect(result.exceptions).toEqual([]);
    expect(result.resolved[0]).toMatchObject({
      budgetId: 'b-1', budgetVersionId: 'v-1', budgetAccountId: 'acc-1', budgetLineId: 'bl-1',
      taxBasis: 'INCLUSIVE', actualCents: 11000, sourceSubtotalCents: 10000,
      sourceTaxCents: 1000, sourceTotalCents: 11000, periodBudgetCents: 10000,
    });
  });
  it('applies EXCLUSIVE tax basis from the ACTIVE Budget', () => {
    const c = context({ budgets: [{ ...context().budgets[0], taxBasis: 'EXCLUSIVE' }] });
    expect(deriveBudgetActualConsumption(report(), c).resolved[0].actualCents).toBe(10000);
  });

  it('keeps ANNUAL_ONLY Budget period amount null', () => {
    const c = context({ budgets: [{ ...context().budgets[0], periodisationMode: 'ANNUAL_ONLY' }], periodAllocations: [] });
    expect(deriveBudgetActualConsumption(report(), c).resolved[0]).toMatchObject({
      periodisationMode: 'ANNUAL_ONLY', periodBudgetCents: null,
    });
  });

  it('preserves upstream period/source integrity exceptions verbatim and does not classify them', () => {
    const source = actual({
      periodResolution: 'AMBIGUOUS', financialPeriodId: null, financialYearId: null,
      exceptionCodes: ['AMBIGUOUS_PERIOD', 'SOURCE_CURRENCY_MISMATCH'],
    });
    const result = deriveBudgetActualConsumption(report([source]), context());
    expect(result.resolved).toHaveLength(0);
    expect(result.exceptions[0].codes).toEqual(['AMBIGUOUS_PERIOD', 'SOURCE_CURRENCY_MISMATCH']);
    expect(result.exceptions[0].actualCents).toBeNull();
  });

  it('preserves UNATTRIBUTED_COST_CENTRE while still exposing Budget-basis Actual when Budget is known', () => {
    const source = actual({ effectiveCostCentreId: null, exceptionCodes: ['UNATTRIBUTED_COST_CENTRE'] });
    const result = deriveBudgetActualConsumption(report([source]), context());
    expect(result.exceptions[0]).toMatchObject({
      codes: ['UNATTRIBUTED_COST_CENTRE'], budgetId: 'b-1', budgetVersionId: 'v-1', actualCents: 11000,
    });
  });
  it('distinguishes NO_ACTIVE_BUDGET from CURRENCY_MISMATCH', () => {
    const inactive = context({
      budgetIdentities: [{ financialYearId: 'fy-1', currency: 'AUD', hasActiveVersion: false }], budgets: [],
    });
    expect(deriveBudgetActualConsumption(report(), inactive).exceptions[0].codes).toEqual(['NO_ACTIVE_BUDGET']);

    const usdOnly = context({
      budgetIdentities: [{ financialYearId: 'fy-1', currency: 'USD', hasActiveVersion: true }],
      budgets: [{ ...context().budgets[0], currency: 'USD' }],
    });
    expect(deriveBudgetActualConsumption(report(), usdOnly).exceptions[0].codes).toEqual(['CURRENCY_MISMATCH']);
  });

  it('surfaces UNMAPPED_ACCOUNT, AMBIGUOUS_ACCOUNT and NO_BUDGET_LINE explicitly', () => {
    expect(deriveBudgetActualConsumption(report(), context({ mappings: [] })).exceptions[0].codes)
      .toEqual(['UNMAPPED_ACCOUNT']);
    expect(deriveBudgetActualConsumption(report(), context({
      mappings: [...context().mappings, { ...context().mappings[0], budgetAccountId: 'acc-2' }],
    })).exceptions[0].codes).toEqual(['AMBIGUOUS_ACCOUNT']);
    expect(deriveBudgetActualConsumption(report(), context({ lines: [] })).exceptions[0].codes)
      .toEqual(['NO_BUDGET_LINE']);
  });

  it('retains tax-basis Actual amount on Budget-configuration exceptions once Budget is known', () => {
    const result = deriveBudgetActualConsumption(report(), context({ mappings: [] }));
    expect(result.exceptions[0]).toMatchObject({ actualCents: 11000, budgetId: 'b-1', budgetVersionId: 'v-1' });
  });
  it('aggregates only resolved Actuals at Budget line/period/currency grain', () => {
    const second = actual({ supplierBillLineId: 'sbl-2', subtotalCents: 500, taxCents: 50, totalCents: 550 });
    const result = deriveBudgetActualConsumption(report([actual(), second]), context());
    expect(result.rows).toEqual([expect.objectContaining({
      actualCents: 11550, actualLineCount: 2, currency: 'AUD', financialPeriodId: 'fp-1',
    })]);
  });

  it('fails loud on duplicate ACTIVE Budget or duplicate Budget-line integrity drift', () => {
    expect(() => deriveBudgetActualConsumption(report(), context({
      budgets: [...context().budgets, { ...context().budgets[0], budgetId: 'b-2', activeVersionId: 'v-2' }],
    }))).toThrow('multiple ACTIVE Budgets');
    expect(() => deriveBudgetActualConsumption(report(), context({
      lines: [...context().lines, { ...context().lines[0], budgetLineId: 'bl-2' }],
    }))).toThrow('multiple Budget lines');
  });

  it('feeds C7.8A Actuals and ACTIVE Budget context the same tenant id', async () => {
    getBudgetActualReportMock.mockResolvedValue(report([]));
    getActiveBudgetContextMock.mockResolvedValue(context({ budgetIdentities: [], budgets: [], mappings: [], lines: [], periodAllocations: [] }));
    await getBudgetActualConsumption('org-a');
    expect(getBudgetActualReportMock).toHaveBeenCalledWith('org-a');
    expect(getActiveBudgetContextMock).toHaveBeenCalledWith('org-a');
  });
});
