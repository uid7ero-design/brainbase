import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionMock = vi.fn();
const sqlMock = Object.assign(vi.fn(), { transaction: transactionMock });
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const getPurchaseCommitmentReportMock = vi.fn();
vi.mock('@/lib/commercial/purchasingCommitments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/purchasingCommitments')>();
  return { ...actual, getPurchaseCommitmentReport: (...args: unknown[]) => getPurchaseCommitmentReportMock(...args) };
});

const {
  deriveBudgetCommitmentConsumption,
  getActiveBudgetContext,
  getBudgetCommitmentConsumption,
} = await import('@/lib/commercial/budgetCommitmentResolver');

import type {
  ActiveBudgetContext,
} from '@/lib/commercial/budgetCommitmentResolver';
import type {
  PurchaseCommitmentReport,
  PurchaseLineCommitment,
  PurchaseOrderCommitment,
} from '@/lib/commercial/purchasingCommitments';

const line = (overrides: Partial<PurchaseLineCommitment> = {}): PurchaseLineCommitment => ({
  purchaseOrderLineId: 'pol-1',
  position: 1,
  description: 'Services',
  effectiveCostCentreId: 'cc-1',
  effectiveCostCentreCode: 'OPS',
  effectiveCostCentreName: 'Operations',
  state: 'PARTIALLY_CONSUMED',
  orderedSubtotalCents: 10000,
  orderedTaxCents: 1000,
  orderedTotalCents: 11000,
  billedSubtotalCents: 2500,
  billedTaxCents: 250,
  billedTotalCents: 2750,
  outstandingSubtotalCents: 7500,
  outstandingTaxCents: 750,
  outstandingTotalCents: 8250,
  ...overrides,
});

const po = (overrides: Partial<PurchaseOrderCommitment> = {}): PurchaseOrderCommitment => ({
  purchaseOrderId: 'po-1',
  purchaseOrderStatus: 'ISSUED',
  supplierId: 'sup-1',
  supplierName: 'Supplier',
  currency: 'AUD',
  commitmentEffectiveAt: '2026-09-25T00:00:00.000Z',
  periodResolution: 'RESOLVED',
  financialPeriodId: 'period-1',
  financialPeriodName: 'September',
  financialPeriodStatus: 'OPEN',
  financialYearId: 'fy-1',
  financialYearName: 'FY26',
  lineCount: 1,
  orderedSubtotalCents: 10000,
  orderedTaxCents: 1000,
  orderedTotalCents: 11000,
  billedSubtotalCents: 2500,
  billedTaxCents: 250,
  billedTotalCents: 2750,
  outstandingSubtotalCents: 7500,
  outstandingTaxCents: 750,
  outstandingTotalCents: 8250,
  lines: [line()],
  ...overrides,
});

const report = (purchaseOrders: PurchaseOrderCommitment[] = [po()]): PurchaseCommitmentReport => ({
  periodResolution: purchaseOrders.some(p => p.periodResolution === 'AMBIGUOUS')
    ? 'AMBIGUOUS'
    : purchaseOrders.every(p => p.periodResolution === 'RESOLVED') ? 'RESOLVED' : 'UNRESOLVED',
  purchaseOrderCount: purchaseOrders.length,
  resolvedPurchaseOrderCount: purchaseOrders.filter(p => p.periodResolution === 'RESOLVED').length,
  unresolvedPurchaseOrderCount: purchaseOrders.filter(p => p.periodResolution === 'UNRESOLVED').length,
  ambiguousPurchaseOrderCount: purchaseOrders.filter(p => p.periodResolution === 'AMBIGUOUS').length,
  lineCount: purchaseOrders.reduce((sum, p) => sum + p.lines.length, 0),
  currencies: [],
  purchaseOrders,
});

const context = (overrides: Partial<ActiveBudgetContext> = {}): ActiveBudgetContext => ({
  budgetIdentities: [{ financialYearId: 'fy-1', currency: 'AUD', hasActiveVersion: true }],
  budgets: [{
    budgetId: 'budget-1',
    financialYearId: 'fy-1',
    financialYearName: 'FY26',
    currency: 'AUD',
    taxBasis: 'INCLUSIVE',
    periodisationMode: 'PERIODISED',
    activeVersionId: 'bv-1',
    versionNumber: 1,
  }],
  mappings: [{
    budgetVersionId: 'bv-1',
    costCentreId: 'cc-1',
    budgetAccountId: 'acc-1',
    budgetAccountCode: 'OPEX',
    budgetAccountName: 'Operating',
  }],
  lines: [{
    budgetLineId: 'bl-1',
    budgetVersionId: 'bv-1',
    budgetAccountId: 'acc-1',
    costCentreId: 'cc-1',
    annualBudgetCents: 100000,
  }],
  periodAllocations: [{
    budgetLineId: 'bl-1',
    financialPeriodId: 'period-1',
    amountCents: 10000,
  }],
  ...overrides,
});

beforeEach(() => {
  transactionMock.mockReset();
  sqlMock.mockReset();
  getPurchaseCommitmentReportMock.mockReset();
});

describe('C7.7E — derived commitment-to-Budget resolution', () => {
  it('resolves against ACTIVE version mapping/line and uses INCLUSIVE totals', () => {
    const result = deriveBudgetCommitmentConsumption(report(), context());
    expect(result.exceptions).toEqual([]);
    expect(result.resolved).toEqual([expect.objectContaining({
      budgetId: 'budget-1',
      budgetVersionId: 'bv-1',
      budgetAccountId: 'acc-1',
      costCentreId: 'cc-1',
      financialPeriodId: 'period-1',
      taxBasis: 'INCLUSIVE',
      orderedCents: 11000,
      billedCents: 2750,
      committedCents: 8250,
      annualBudgetCents: 100000,
      periodBudgetCents: 10000,
    })]);
    expect(result.rows[0]).toMatchObject({ committedCents: 8250, billedCents: 2750, commitmentCount: 1 });
  });

  it('uses EXCLUSIVE subtotal values without changing C7.6 commitment facts', () => {
    const c = context({
      budgets: [{ ...context().budgets[0], taxBasis: 'EXCLUSIVE' }],
    });
    expect(deriveBudgetCommitmentConsumption(report(), c).resolved[0]).toMatchObject({
      orderedCents: 10000,
      billedCents: 2500,
      committedCents: 7500,
    });
  });

  it('keeps ANNUAL_ONLY period Budget null and never fabricates allocations', () => {
    const c = context({
      budgets: [{ ...context().budgets[0], periodisationMode: 'ANNUAL_ONLY' }],
      periodAllocations: [],
    });
    expect(deriveBudgetCommitmentConsumption(report(), c).resolved[0]).toMatchObject({
      periodisationMode: 'ANNUAL_ONLY',
      periodBudgetCents: null,
    });
  });

  it.each([
    ['UNRESOLVED', 'UNRESOLVED_PERIOD'],
    ['AMBIGUOUS', 'AMBIGUOUS_PERIOD'],
  ] as const)('surfaces %s C7.6 period attribution as %s', (resolution, expectedCode) => {
    const purchaseOrder = po({
      periodResolution: resolution,
      financialPeriodId: null,
      financialYearId: null,
    });
    const result = deriveBudgetCommitmentConsumption(report([purchaseOrder]), context());
    expect(result.resolved).toHaveLength(0);
    expect(result.exceptions[0]).toMatchObject({
      code: expectedCode,
      outstandingSubtotalCents: 7500,
      outstandingTotalCents: 8250,
      committedCents: null,
    });
  });

  it('propagates INVALID_OVERBILLED before attempting Budget classification', () => {
    const result = deriveBudgetCommitmentConsumption(
      report([po({ lines: [line({ state: 'INVALID_OVERBILLED' })] })]),
      context(),
    );
    expect(result.exceptions[0]).toMatchObject({ code: 'INVALID_OVERBILLED', budgetId: null });
  });

  it('distinguishes CURRENCY_MISMATCH from NO_ACTIVE_BUDGET', () => {
    const usd = report([po({ currency: 'USD' })]);
    expect(deriveBudgetCommitmentConsumption(usd, context()).exceptions[0].code).toBe('CURRENCY_MISMATCH');
    expect(deriveBudgetCommitmentConsumption(
      report([po({ financialYearId: 'fy-missing' })]),
      context(),
    ).exceptions[0].code).toBe('NO_ACTIVE_BUDGET');

    const inactiveExact = context({
      budgetIdentities: [{ financialYearId: 'fy-1', currency: 'AUD', hasActiveVersion: false }],
      budgets: [],
    });
    expect(deriveBudgetCommitmentConsumption(report(), inactiveExact).exceptions[0].code).toBe('NO_ACTIVE_BUDGET');
  });

  it('surfaces unattributed, unmapped, ambiguous mapping, and missing Budget-line states explicitly', () => {
    expect(deriveBudgetCommitmentConsumption(
      report([po({ lines: [line({ effectiveCostCentreId: null })] })]),
      context(),
    ).exceptions[0].code).toBe('UNATTRIBUTED_COST_CENTRE');

    expect(deriveBudgetCommitmentConsumption(report(), context({ mappings: [] })).exceptions[0].code).toBe('UNMAPPED_ACCOUNT');

    expect(deriveBudgetCommitmentConsumption(report(), context({
      mappings: [...context().mappings, { ...context().mappings[0], budgetAccountId: 'acc-2' }],
    })).exceptions[0].code).toBe('AMBIGUOUS_ACCOUNT');

    expect(deriveBudgetCommitmentConsumption(report(), context({ lines: [] })).exceptions[0].code).toBe('NO_BUDGET_LINE');
  });

  it('retains basis-selected amount for exceptions once the exact Budget is known', () => {
    const result = deriveBudgetCommitmentConsumption(report(), context({ mappings: [] }));
    expect(result.exceptions[0]).toMatchObject({
      code: 'UNMAPPED_ACCOUNT',
      budgetId: 'budget-1',
      budgetVersionId: 'bv-1',
      committedCents: 8250,
    });
  });

  it('aggregates only resolved commitments at Budget-line/period/currency grain', () => {
    const second = po({
      purchaseOrderId: 'po-2',
      lines: [line({ purchaseOrderLineId: 'pol-2', outstandingTotalCents: 1000, billedTotalCents: 500 })],
    });
    const result = deriveBudgetCommitmentConsumption(report([po(), second]), context());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      committedCents: 9250,
      billedCents: 3250,
      commitmentCount: 2,
      currency: 'AUD',
    });
  });
});


describe('C7.7E — ACTIVE Budget context data access', () => {
  it('reads only ACTIVE pointer-backed Budget versions under one tenant-scoped repeatable-read snapshot', async () => {
    let queries: Array<{ strings: readonly string[]; values: unknown[] }> = [];
    transactionMock.mockImplementationOnce(async (
      builder: (tx: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
      options: { isolationLevel?: string },
    ) => {
      const tx = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values });
      queries = builder(tx) as Array<{ strings: readonly string[]; values: unknown[] }>;
      expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      return [
        [{
          budget_id: 'b1', financial_year_id: 'fy1', financial_year_name: 'FY',
          currency: 'AUD', tax_basis: 'INCLUSIVE', periodisation_mode: 'PERIODISED',
          active_version_id: 'v1', version_number: 1,
        }],
        [{
          budget_version_id: 'v1', cost_centre_id: 'cc1', budget_account_id: 'a1',
          budget_account_code: 'OPS', budget_account_name: 'Operations',
        }],
        [{
          budget_line_id: 'l1', budget_version_id: 'v1', budget_account_id: 'a1',
          cost_centre_id: 'cc1', annual_budget_cents: '9007199254740991',
        }],
        [{ budget_line_id: 'l1', financial_period_id: 'p1', amount_cents: '1000' }],
      ];
    });

    const result = await getActiveBudgetContext('org-a');

    expect(result.lines[0].annualBudgetCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.strings.join('')).toMatch(/organisation_id = /);
      expect(query.values).toContain('org-a');
    }
    expect(queries[0].strings.join('')).toMatch(/LEFT JOIN commercial_budget_versions bv/);
    expect(queries[0].strings.join('')).toMatch(/bv\.status = 'ACTIVE'/);
    expect(queries[1].strings.join('')).toMatch(/cb\.active_version_id = bv\.id/);
    expect(queries[2].strings.join('')).toMatch(/cb\.active_version_id = bv\.id/);
    expect(queries[3].strings.join('')).toMatch(/cb\.active_version_id = bv\.id/);
  });

  it('rejects BIGINT Budget amounts outside JavaScript safe-integer range', async () => {
    transactionMock.mockImplementationOnce(async () => [
      [],
      [],
      [{
        budget_line_id: 'l1', budget_version_id: 'v1', budget_account_id: 'a1',
        cost_centre_id: 'cc1', annual_budget_cents: '9007199254740992',
      }],
      [],
    ]);
    await expect(getActiveBudgetContext('org-a')).rejects.toThrow('outside JavaScript safe-integer range');
  });

  it('feeds C7.6 commitments and ACTIVE Budget context the same authenticated tenant', async () => {
    getPurchaseCommitmentReportMock.mockResolvedValue(report([]));
    transactionMock.mockResolvedValueOnce([[], [], [], []]);

    await getBudgetCommitmentConsumption('org-a');

    expect(getPurchaseCommitmentReportMock).toHaveBeenCalledWith('org-a');
    expect(transactionMock).toHaveBeenCalledOnce();
  });
});
