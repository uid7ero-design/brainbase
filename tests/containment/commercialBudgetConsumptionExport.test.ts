import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { buildBudgetConsumptionCsvExports, type BudgetConsumptionExportInput } from '@/lib/commercial/budgetConsumptionExport';

function reportFixture(): BudgetConsumptionExportInput {
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

describe('Budget consumption spreadsheet text boundary', () => {
  const fields = [
    ...(['budgetAccountCode', 'budgetAccountName', 'costCentreCode', 'costCentreName', 'financialYearName', 'financialPeriodName'] as const)
      .map(field => ({ table: 'rows' as const, field })),
    ...(['budgetAccountCode', 'budgetAccountName', 'financialYearName', 'financialPeriodName', 'sourceSystemId'] as const)
      .map(field => ({ table: 'financeRows' as const, field })),
  ];
  const cases = fields.flatMap(item => ['=', '+', '-', '@'].map(prefix => ({ ...item, value: `\t\r ${prefix}SUM(1,2)` })));
  it.each(cases)('neutralizes a prefixed formula in $table.$field: $value', ({ table, field, value }) => {
    const report = reportFixture();
    (report[table][0] as unknown as Record<string, unknown>)[field] = value;
    const original = structuredClone(report);
    const exported = buildBudgetConsumptionCsvExports(report);
    const csv = table === 'rows' ? exported.legacyRowsCsv : exported.financeRowsCsv;
    const rows = parse(csv, { bom: true }) as string[][];
    expect(rows[1]).toContain(`'${value}`);
    expect(report).toEqual(original);
  });
  it('preserves safe Unicode text, exact money, empty fields and the existing negative-money format', () => {
    const report = reportFixture();
    report.financeRows[0].budgetAccountName = '  Coût, "café"\n第二行';
    report.financeRows[0].budgetCents = '9007199254740993';
    report.financeRows[0].financeAdjustmentCents = '-12';
    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);
    const rows = parse(financeRowsCsv, { bom: true }) as string[][];
    expect(rows[1][1]).toBe(report.financeRows[0].budgetAccountName);
    expect(rows[1][5]).toBe('9007199254740993');
    expect(rows[1][7]).toBe("'-12");
    expect(rows[1].slice(11)).toEqual(['', '', '', '']);
  });
});
