import 'server-only';
import {
  getBudgetActualReport,
  type BudgetActualExceptionCode,
  type BudgetActualLine,
  type BudgetActualReport,
} from './budgetActuals';
import {
  getActiveBudgetContext,
  type ActiveBudgetContext,
  type ActiveBudgetHeader,
} from './budgetCommitmentResolver';
import type { BudgetPeriodisationMode, BudgetTaxBasis } from './budgets';

export type BudgetActualClassificationExceptionCode =
  | BudgetActualExceptionCode
  | 'UNMAPPED_ACCOUNT'
  | 'AMBIGUOUS_ACCOUNT'
  | 'NO_ACTIVE_BUDGET'
  | 'NO_BUDGET_LINE'
  | 'CURRENCY_MISMATCH';

export type ResolvedBudgetActual = {
  supplierBillLineId: string;
  supplierBillId: string;
  supplierBillNumber: string | null;
  supplierId: string;
  supplierName: string | null;
  sourcePurchaseOrderId: string;
  sourcePurchaseOrderLineId: string;
  currency: string;
  recognisedAt: string;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string;
  financialPeriodName: string;
  budgetId: string;
  budgetVersionId: string;
  budgetAccountId: string;
  budgetAccountCode: string;
  budgetAccountName: string;
  costCentreId: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  budgetLineId: string;
  taxBasis: BudgetTaxBasis;
  periodisationMode: BudgetPeriodisationMode;
  annualBudgetCents: number;
  periodBudgetCents: number | null;
  sourceSubtotalCents: number;
  sourceTaxCents: number;
  sourceTotalCents: number;
  actualCents: number;
};

export type BudgetActualClassificationException = {
  codes: BudgetActualClassificationExceptionCode[];
  supplierBillLineId: string;
  supplierBillId: string;
  supplierBillNumber: string | null;
  supplierId: string;
  sourcePurchaseOrderId: string;
  sourcePurchaseOrderLineId: string;
  currency: string;
  recognisedAt: string | null;
  financialYearId: string | null;
  financialPeriodId: string | null;
  financialPeriodName: string | null;
  effectiveCostCentreId: string | null;
  sourceSubtotalCents: number;
  sourceTaxCents: number;
  sourceTotalCents: number;
  actualCents: number | null;
  budgetId: string | null;
  budgetVersionId: string | null;
  billDate: string | null;
  billDateFinancialPeriodId: string | null;
  billDateFinancialPeriodName: string | null;
  billDateFinancialPeriodStatus: 'OPEN' | 'CLOSED' | null;
};

export type BudgetActualConsumptionRow = {
  budgetId: string;
  budgetVersionId: string;
  budgetAccountId: string;
  budgetAccountCode: string;
  budgetAccountName: string;
  costCentreId: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string | null;
  financialPeriodName: string | null;
  currency: string;
  taxBasis: BudgetTaxBasis;
  periodisationMode: BudgetPeriodisationMode;
  annualBudgetCents: number;
  periodBudgetCents: number | null;
  actualCents: number;
  actualLineCount: number;
};

export type BudgetActualConsumptionReport = {
  resolved: ResolvedBudgetActual[];
  rows: BudgetActualConsumptionRow[];
  exceptions: BudgetActualClassificationException[];
  resolvedActualCount: number;
  unresolvedExceptionCount: number;
};

function actualOnBasis(actual: BudgetActualLine, taxBasis: BudgetTaxBasis): number {
  return taxBasis === 'EXCLUSIVE' ? actual.subtotalCents : actual.totalCents;
}

function actualException(
  codes: BudgetActualClassificationExceptionCode[],
  actual: BudgetActualLine,
  budget: ActiveBudgetHeader | null = null,
): BudgetActualClassificationException {
  return {
    codes: [...new Set(codes)],
    supplierBillLineId: actual.supplierBillLineId,
    supplierBillId: actual.supplierBillId,
    supplierBillNumber: actual.supplierBillNumber,
    supplierId: actual.supplierId,
    sourcePurchaseOrderId: actual.sourcePurchaseOrderId,
    sourcePurchaseOrderLineId: actual.sourcePurchaseOrderLineId,
    currency: actual.currency,
    recognisedAt: actual.recognisedAt,
    financialYearId: actual.financialYearId,
    financialPeriodId: actual.financialPeriodId,
    financialPeriodName: actual.financialPeriodName,
    effectiveCostCentreId: actual.effectiveCostCentreId,
    sourceSubtotalCents: actual.subtotalCents,
    sourceTaxCents: actual.taxCents,
    sourceTotalCents: actual.totalCents,
    actualCents: budget ? actualOnBasis(actual, budget.taxBasis) : null,
    budgetId: budget?.budgetId ?? null,
    budgetVersionId: budget?.activeVersionId ?? null,
    billDate: actual.billDate,
    billDateFinancialPeriodId: actual.billDateFinancialPeriodId,
    billDateFinancialPeriodName: actual.billDateFinancialPeriodName,
    billDateFinancialPeriodStatus: actual.billDateFinancialPeriodStatus,
  };
}
const RECONCILIATION_ONLY_CODES: BudgetActualExceptionCode[] = [
  'LATE_BILL_PRIOR_PERIOD',
  'LATE_BILL_CLOSED_PERIOD',
  'BILL_DATE_UNRESOLVED',
  'BILL_DATE_AMBIGUOUS',
];

export function deriveBudgetActualConsumption(
  actuals: BudgetActualReport,
  context: ActiveBudgetContext,
): BudgetActualConsumptionReport {
  const resolved: ResolvedBudgetActual[] = [];
  const exceptions: BudgetActualClassificationException[] = [];

  for (const actual of actuals.lines) {
    const reconciliationCodes = actual.exceptionCodes.filter(code =>
      RECONCILIATION_ONLY_CODES.includes(code),
    );
    const upstreamBlockingCodes = actual.exceptionCodes.filter(
      code => code !== 'UNATTRIBUTED_COST_CENTRE' && !RECONCILIATION_ONLY_CODES.includes(code),
    );
    if (upstreamBlockingCodes.length > 0) {
      exceptions.push(actualException([...upstreamBlockingCodes, ...reconciliationCodes], actual));
      continue;
    }

    if (
      actual.periodResolution !== 'RESOLVED'
      || !actual.financialYearId
      || !actual.financialYearName
      || !actual.financialPeriodId
      || !actual.financialPeriodName
      || !actual.recognisedAt
    ) {
      exceptions.push(actualException(['UNRESOLVED_PERIOD'], actual));
      continue;
    }

    const sameYearIdentities = context.budgetIdentities.filter(
      budget => budget.financialYearId === actual.financialYearId,
    );
    const exactIdentity = sameYearIdentities.find(
      budget => budget.currency === actual.currency,
    );
    const matchingBudgets = context.budgets.filter(
      budget =>
        budget.financialYearId === actual.financialYearId
        && budget.currency === actual.currency,
    );
    if (matchingBudgets.length === 0) {
      exceptions.push(actualException(
        exactIdentity
          ? [...reconciliationCodes, 'NO_ACTIVE_BUDGET']
          : sameYearIdentities.length > 0
            ? [...reconciliationCodes, 'CURRENCY_MISMATCH']
            : [...reconciliationCodes, 'NO_ACTIVE_BUDGET'],
        actual,
      ));
      continue;
    }
    if (matchingBudgets.length > 1) {
      throw new Error('multiple ACTIVE Budgets resolved for one Actual financial year and currency');
    }

    const budget = matchingBudgets[0];

    if (!actual.effectiveCostCentreId) {
      exceptions.push(actualException([...reconciliationCodes, 'UNATTRIBUTED_COST_CENTRE'], actual, budget));
      continue;
    }

    const mappings = context.mappings.filter(mapping =>
      mapping.budgetVersionId === budget.activeVersionId
      && mapping.costCentreId === actual.effectiveCostCentreId,
    );
    if (mappings.length === 0) {
      exceptions.push(actualException([...reconciliationCodes, 'UNMAPPED_ACCOUNT'], actual, budget));
      continue;
    }
    if (mappings.length > 1) {
      exceptions.push(actualException([...reconciliationCodes, 'AMBIGUOUS_ACCOUNT'], actual, budget));
      continue;
    }

    const mapping = mappings[0];
    const budgetLines = context.lines.filter(line =>
      line.budgetVersionId === budget.activeVersionId
      && line.budgetAccountId === mapping.budgetAccountId
      && line.costCentreId === actual.effectiveCostCentreId,
    );
    if (budgetLines.length === 0) {
      exceptions.push(actualException([...reconciliationCodes, 'NO_BUDGET_LINE'], actual, budget));
      continue;
    }
    if (budgetLines.length > 1) {
      throw new Error('multiple Budget lines resolved for one Actual account and cost centre');
    }

    const budgetLine = budgetLines[0];
    const periodBudgetCents = budget.periodisationMode === 'PERIODISED'
      ? context.periodAllocations
          .filter(allocation =>
            allocation.budgetLineId === budgetLine.budgetLineId
            && allocation.financialPeriodId === actual.financialPeriodId,
          )
          .reduce((sum, allocation) => sum + allocation.amountCents, 0)
      : null;

    resolved.push({
      supplierBillLineId: actual.supplierBillLineId,
      supplierBillId: actual.supplierBillId,
      supplierBillNumber: actual.supplierBillNumber,
      supplierId: actual.supplierId,
      supplierName: actual.supplierName,
      sourcePurchaseOrderId: actual.sourcePurchaseOrderId,
      sourcePurchaseOrderLineId: actual.sourcePurchaseOrderLineId,
      currency: actual.currency,
      recognisedAt: actual.recognisedAt,
      financialYearId: actual.financialYearId,
      financialYearName: actual.financialYearName,
      financialPeriodId: actual.financialPeriodId,
      financialPeriodName: actual.financialPeriodName,
      budgetId: budget.budgetId,
      budgetVersionId: budget.activeVersionId,
      budgetAccountId: mapping.budgetAccountId,
      budgetAccountCode: mapping.budgetAccountCode,
      budgetAccountName: mapping.budgetAccountName,
      costCentreId: actual.effectiveCostCentreId,
      costCentreCode: actual.effectiveCostCentreCode,
      costCentreName: actual.effectiveCostCentreName,
      budgetLineId: budgetLine.budgetLineId,
      taxBasis: budget.taxBasis,
      periodisationMode: budget.periodisationMode,
      annualBudgetCents: budgetLine.annualBudgetCents,
      periodBudgetCents,
      sourceSubtotalCents: actual.subtotalCents,
      sourceTaxCents: actual.taxCents,
      sourceTotalCents: actual.totalCents,
      actualCents: actualOnBasis(actual, budget.taxBasis),
    });
    if (reconciliationCodes.length > 0) {
      exceptions.push(actualException(reconciliationCodes, actual, budget));
    }
  }

  const rowMap = new Map<string, BudgetActualConsumptionRow>();
  for (const item of resolved) {
    const periodKey = item.periodisationMode === 'PERIODISED' ? item.financialPeriodId : '';
    const key = [
      item.budgetVersionId,
      item.budgetLineId,
      item.costCentreId,
      periodKey,
      item.currency,
    ].join('|');
    const current = rowMap.get(key) ?? {
      budgetId: item.budgetId,
      budgetVersionId: item.budgetVersionId,
      budgetAccountId: item.budgetAccountId,
      budgetAccountCode: item.budgetAccountCode,
      budgetAccountName: item.budgetAccountName,
      costCentreId: item.costCentreId,
      costCentreCode: item.costCentreCode,
      costCentreName: item.costCentreName,
      financialYearId: item.financialYearId,
      financialYearName: item.financialYearName,
      financialPeriodId: item.periodisationMode === 'PERIODISED' ? item.financialPeriodId : null,
      financialPeriodName: item.periodisationMode === 'PERIODISED' ? item.financialPeriodName : null,
      currency: item.currency,
      taxBasis: item.taxBasis,
      periodisationMode: item.periodisationMode,
      annualBudgetCents: item.annualBudgetCents,
      periodBudgetCents: item.periodBudgetCents,
      actualCents: 0,
      actualLineCount: 0,
    };
    current.actualCents += item.actualCents;
    current.actualLineCount += 1;
    rowMap.set(key, current);
  }

  return {
    resolved,
    rows: [...rowMap.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency)
      || a.budgetAccountCode.localeCompare(b.budgetAccountCode)
      || a.costCentreId.localeCompare(b.costCentreId)
      || (a.financialPeriodId ?? '').localeCompare(b.financialPeriodId ?? ''),
    ),
    exceptions,
    resolvedActualCount: resolved.length,
    unresolvedExceptionCount: exceptions.length,
  };
}

export async function getBudgetActualConsumption(
  organisationId: string,
): Promise<BudgetActualConsumptionReport> {
  const [actuals, context] = await Promise.all([
    getBudgetActualReport(organisationId),
    getActiveBudgetContext(organisationId),
  ]);
  return deriveBudgetActualConsumption(actuals, context);
}
