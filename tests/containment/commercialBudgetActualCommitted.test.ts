import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const { deriveBudgetActualCommittedReport } = await import('@/lib/commercial/budgetActualCommitted');

import type { BudgetCommitmentConsumptionReport } from '@/lib/commercial/budgetCommitmentResolver';
import type { BudgetActualConsumptionReport } from '@/lib/commercial/budgetActualResolver';

const commitmentReport = (committedCents: number, overrides: Partial<BudgetCommitmentConsumptionReport> = {}): BudgetCommitmentConsumptionReport => ({
  resolved: [],
  exceptions: [],
  resolvedCommitmentCount: committedCents === 0 ? 0 : 1,
  unresolvedExceptionCount: 0,
  rows: committedCents === 0 ? [] : [{
    budgetId: 'b-1', budgetVersionId: 'v-1', budgetAccountId: 'acc-1', budgetAccountCode: 'OPEX', budgetAccountName: 'Operating',
    costCentreId: 'cc-1', costCentreCode: 'OPS', costCentreName: 'Operations', financialYearId: 'fy-1', financialYearName: 'FY26',
    financialPeriodId: 'fp-1', financialPeriodName: 'September', currency: 'AUD', taxBasis: 'INCLUSIVE', periodisationMode: 'PERIODISED',
    annualBudgetCents: 120000, periodBudgetCents: 10000, committedCents, billedCents: 0,
    budgetLessCommitmentsCents: 10000 - committedCents, commitmentCount: 1,
  }],
  ...overrides,
});
const actualReport = (actualCents: number, overrides: Partial<BudgetActualConsumptionReport> = {}): BudgetActualConsumptionReport => ({
  resolved: [],
  exceptions: [],
  resolvedActualCount: actualCents === 0 ? 0 : 1,
  unresolvedExceptionCount: 0,
  rows: actualCents === 0 ? [] : [{
    budgetId: 'b-1', budgetVersionId: 'v-1', budgetAccountId: 'acc-1', budgetAccountCode: 'OPEX', budgetAccountName: 'Operating',
    costCentreId: 'cc-1', costCentreCode: 'OPS', costCentreName: 'Operations', financialYearId: 'fy-1', financialYearName: 'FY26',
    financialPeriodId: 'fp-1', financialPeriodName: 'September', currency: 'AUD', taxBasis: 'INCLUSIVE', periodisationMode: 'PERIODISED',
    annualBudgetCents: 120000, periodBudgetCents: 10000, actualCents, actualLineCount: 1,
  }],
  ...overrides,
});

describe('C7.8C — combined Budget vs Actual vs Committed arithmetic', () => {
  it('keeps POST transition exposure invariant while value moves from Committed to Actual', () => {
    const before = deriveBudgetActualCommittedReport(commitmentReport(10000), actualReport(0));
    const after = deriveBudgetActualCommittedReport(commitmentReport(7500), actualReport(2500));
    expect(before.rows[0]).toMatchObject({ actualCents: 0, committedCents: 10000, exposureCents: 10000 });
    expect(after.rows[0]).toMatchObject({ actualCents: 2500, committedCents: 7500, exposureCents: 10000 });
    expect(after.rows[0].budgetLessActualAndCommittedCents).toBe(0);
  });

  it('keeps CANCEL transition exposure invariant while value moves from Actual back to Committed', () => {
    const before = deriveBudgetActualCommittedReport(commitmentReport(7500), actualReport(2500));
    const after = deriveBudgetActualCommittedReport(commitmentReport(10000), actualReport(0));
    expect(before.rows[0].exposureCents).toBe(10000);
    expect(after.rows[0].exposureCents).toBe(10000);
    expect(after.rows[0]).toMatchObject({ actualCents: 0, committedCents: 10000 });
  });
  it('computes Budget less Actual and Budget less Actual+Committed independently', () => {
    const report = deriveBudgetActualCommittedReport(commitmentReport(3000), actualReport(2500));
    expect(report.rows[0]).toMatchObject({
      budgetCents: 10000,
      budgetLessActualCents: 7500,
      budgetLessActualAndCommittedCents: 4500,
      exposureCents: 5500,
    });
  });

  it('keeps unlike currencies on separate rows', () => {
    const actualUsd = actualReport(2000, {
      rows: [{ ...actualReport(2000).rows[0], currency: 'USD' }],
    });
    const result = deriveBudgetActualCommittedReport(commitmentReport(3000), actualUsd);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(row => row.currency).sort()).toEqual(['AUD', 'USD']);
  });

  it('preserves Actual and Commitment exception provenance', () => {
    const commitments = commitmentReport(0, {
      exceptions: [{
        code: 'UNMAPPED_ACCOUNT', purchaseOrderId: 'po-1', purchaseOrderLineId: 'pol-1', supplierId: 'sup-1', currency: 'AUD',
        financialYearId: 'fy-1', financialPeriodId: 'fp-1', effectiveCostCentreId: 'cc-1', outstandingSubtotalCents: 1000,
        outstandingTotalCents: 1100, committedCents: 1100, budgetId: 'b-1', budgetVersionId: 'v-1',
      }],
      unresolvedExceptionCount: 1,
    });
    const actuals = actualReport(0, {
      exceptions: [{
        codes: ['UNMAPPED_ACCOUNT'], supplierBillLineId: 'sbl-1', supplierBillId: 'sb-1', supplierBillNumber: 'B-1', supplierId: 'sup-1',
        sourcePurchaseOrderId: 'po-1', sourcePurchaseOrderLineId: 'pol-1', currency: 'AUD', recognisedAt: '2026-09-15T00:00:00.000Z',
        financialYearId: 'fy-1', financialPeriodId: 'fp-1', financialPeriodName: 'September', effectiveCostCentreId: 'cc-1', sourceSubtotalCents: 1000,
        sourceTaxCents: 100, sourceTotalCents: 1100, actualCents: 1100, budgetId: 'b-1', budgetVersionId: 'v-1',
        billDate: '2026-09-10', billDateFinancialPeriodId: 'fp-1', billDateFinancialPeriodName: 'September', billDateFinancialPeriodStatus: 'OPEN',
      }],
      unresolvedExceptionCount: 1,
    });
    const result = deriveBudgetActualCommittedReport(commitments, actuals);
    expect(result.exceptions.map(item => item.source)).toEqual(['COMMITMENT', 'ACTUAL']);
    expect(result.unresolvedExceptionCount).toBe(2);
  });
  it('fails loud if the two classified streams disagree on Budget metadata for one grain', () => {
    const actuals = actualReport(2500, {
      rows: [{ ...actualReport(2500).rows[0], taxBasis: 'EXCLUSIVE' }],
    });
    expect(() => deriveBudgetActualCommittedReport(commitmentReport(7500), actuals))
      .toThrow('snapshot metadata mismatch');
  });
});

describe('C7.8C — snapshot SQL contract', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/commercial/budgetActualCommitted.ts'), 'utf8');

  it('reads all source streams and Budget context inside one REPEATABLE READ transaction', () => {
    expect(source).toContain("sql.transaction(txn => [");
    expect(source).toContain("{ isolationLevel: 'RepeatableRead' }");
    expect((source.match(/txn`/g) ?? []).length).toBe(6);
  });

  it('uses the same authenticated tenant parameter in commitment, Actual and Budget queries', () => {
    expect((source.match(/organisationId/g) ?? []).length).toBeGreaterThan(8);
    expect(source).toContain('csbl.organisation_id = ${organisationId}');
    expect(source).toContain('sbl.organisation_id = ${organisationId}');
    expect(source).toContain('cb.organisation_id = ${organisationId}');
  });

  it('uses POSTED bills consistently on both sides of the transition', () => {
    expect(source).toContain("csb.status = 'POSTED'");
    expect(source).toContain("sb.status = 'POSTED'");
  });
});
