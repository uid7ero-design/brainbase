import { describe, expect, it } from 'vitest';
import { buildBudgetConsumptionCsvExports } from '@/lib/commercial/budgetConsumptionExport';

function reportFixture() {
  return {
    rows: [{
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating costs',
      costCentreCode: 'OPS',
      costCentreName: 'Operations',
      financialYearName: 'FY26',
      financialPeriodName: 'September',
      currency: 'AUD',
      budgetCents: 12000,
      actualCents: 2500,
      committedCents: 7500,
      exposureCents: 10000,
      budgetLessActualCents: 9500,
      budgetLessActualAndCommittedCents: 2000,
    }],
    financeRows: [{
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating costs',
      financialYearName: 'FY26',
      financialPeriodName: 'September',
      currency: 'AUD',
      budgetCents: '12000',
      sourceActualCents: '2500',
      financeAdjustmentCents: '500',
      effectiveActualCents: '3000',
      committedCents: '7500',
      exposureCents: '10500',
      externalGlActualCents: null,
      reconciliationVarianceCents: null,
      reconciliationStatus: null,
      sourceSystemId: null,
    }],
  };
}

describe('C7.9F — Budget consumption CSV exports', () => {
  it('keeps the legacy rows export separate and unchanged when financeRows are present', () => {
    const report = reportFixture();
    const beforeRows = structuredClone(report.rows);

    const exports = buildBudgetConsumptionCsvExports(report);

    expect(report.rows).toEqual(beforeRows);
    expect(exports.legacyRowsCsv).toContain(
      'Budget account code,Budget account name,Cost centre code,Cost centre name',
    );
    expect(exports.legacyRowsCsv).toContain(
      'OPEX,Operating costs,OPS,Operations,FY26,September,AUD,12000,2500,7500,10000,9500,2000',
    );
    expect(exports.legacyRowsCsv).not.toContain('Finance Adjustments cents');
    expect(exports.legacyRowsCsv).not.toContain('Reconciliation status');
  });

  it('exports null external GL and variance values as empty CSV cells', () => {
    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(reportFixture());

    expect(financeRowsCsv).toContain(
      'Source Actual cents,Finance Adjustments cents,Effective Actual cents',
    );
    expect(financeRowsCsv).toContain(
      'External GL Actual cents,Reconciliation Variance cents,Reconciliation status,Source system',
    );
    expect(financeRowsCsv).toContain(
      'OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,,,,',
    );
  });

  it('preserves STALE reconciliation status and historical external GL values in the finance export', () => {
    const report = reportFixture();
    report.financeRows[0] = {
      ...report.financeRows[0],
      externalGlActualCents: '3050',
      reconciliationVarianceCents: '-50',
      reconciliationStatus: 'STALE',
      sourceSystemId: 'xero',
    };

    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);

    expect(financeRowsCsv).toContain(
      'OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,3050',
    );
    expect(financeRowsCsv).toContain("'-50,STALE,xero");
    expect(financeRowsCsv).not.toContain('SIGNED_OFF');
  });
});
