import { buildCsv } from '@/lib/events/csvExport';

type LegacyConsumptionRow = {
  budgetAccountCode: string;
  budgetAccountName: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  financialYearName: string;
  financialPeriodName: string | null;
  currency: string;
  budgetCents: number;
  actualCents: number;
  committedCents: number;
  exposureCents: number;
  budgetLessActualCents: number;
  budgetLessActualAndCommittedCents: number;
};

type FinanceConsumptionRow = {
  budgetAccountCode: string;
  budgetAccountName: string;
  financialYearName: string;
  financialPeriodName: string;
  currency: string;
  budgetCents: string;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  effectiveActualCents: string;
  committedCents: string;
  exposureCents: string;
  externalGlActualCents: string | null;
  reconciliationVarianceCents: string | null;
  reconciliationStatus: 'SIGNED_OFF' | 'STALE' | null;
  sourceSystemId: string | null;
};

export type BudgetConsumptionExportInput = {
  rows: LegacyConsumptionRow[];
  financeRows: FinanceConsumptionRow[];
};

const LEGACY_HEADER = [
  'Budget account code', 'Budget account name', 'Cost centre code', 'Cost centre name',
  'Financial year', 'Financial period', 'Currency', 'Budget cents', 'Actual cents',
  'Committed cents', 'Exposure cents', 'Budget less Actual cents',
  'Budget less Actual + Committed cents',
];

const FINANCE_HEADER = [
  'Budget account code', 'Budget account name', 'Financial year', 'Financial period',
  'Currency', 'Budget cents', 'Source Actual cents', 'Finance Adjustments cents',
  'Effective Actual cents', 'Committed cents', 'Exposure cents', 'External GL Actual cents',
  'Reconciliation Variance cents', 'Reconciliation status', 'Source system',
];

export function buildBudgetConsumptionCsvExports(report: BudgetConsumptionExportInput) {
  const legacyRowsCsv = buildCsv(LEGACY_HEADER, report.rows.map(row => [
    row.budgetAccountCode,
    row.budgetAccountName,
    row.costCentreCode,
    row.costCentreName,
    row.financialYearName,
    row.financialPeriodName,
    row.currency,
    row.budgetCents,
    row.actualCents,
    row.committedCents,
    row.exposureCents,
    row.budgetLessActualCents,
    row.budgetLessActualAndCommittedCents,
  ]));

  const financeRowsCsv = buildCsv(FINANCE_HEADER, report.financeRows.map(row => [
    row.budgetAccountCode,
    row.budgetAccountName,
    row.financialYearName,
    row.financialPeriodName,
    row.currency,
    row.budgetCents,
    row.sourceActualCents,
    row.financeAdjustmentCents,
    row.effectiveActualCents,
    row.committedCents,
    row.exposureCents,
    row.externalGlActualCents,
    row.reconciliationVarianceCents,
    row.reconciliationStatus,
    row.sourceSystemId,
  ]));

  return { legacyRowsCsv, financeRowsCsv };
}
