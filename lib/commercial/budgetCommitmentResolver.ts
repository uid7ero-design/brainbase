import 'server-only';
import sql from '@/lib/db';
import {
  getPurchaseCommitmentReport,
  type PurchaseCommitmentReport,
  type PurchaseLineCommitment,
  type PurchaseOrderCommitment,
} from './purchasingCommitments';
import type { BudgetPeriodisationMode, BudgetTaxBasis } from './budgets';

export type BudgetCommitmentExceptionCode =
  | 'UNATTRIBUTED_COST_CENTRE'
  | 'UNMAPPED_ACCOUNT'
  | 'AMBIGUOUS_ACCOUNT'
  | 'UNRESOLVED_PERIOD'
  | 'AMBIGUOUS_PERIOD'
  | 'NO_ACTIVE_BUDGET'
  | 'NO_BUDGET_LINE'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_OVERBILLED';

export type ActiveBudgetHeader = {
  budgetId: string;
  financialYearId: string;
  financialYearName: string;
  currency: string;
  taxBasis: BudgetTaxBasis;
  periodisationMode: BudgetPeriodisationMode;
  activeVersionId: string;
  versionNumber: number;
};

export type ActiveBudgetMapping = {
  budgetVersionId: string;
  costCentreId: string;
  budgetAccountId: string;
  budgetAccountCode: string;
  budgetAccountName: string;
};

export type ActiveBudgetLine = {
  budgetLineId: string;
  budgetVersionId: string;
  budgetAccountId: string;
  costCentreId: string;
  annualBudgetCents: number;
};

export type ActiveBudgetPeriodAllocation = {
  budgetLineId: string;
  financialPeriodId: string;
  amountCents: number;
};

export type ActiveBudgetIdentity = {
  financialYearId: string;
  currency: string;
  hasActiveVersion: boolean;
};

export type ActiveBudgetContext = {
  budgetIdentities: ActiveBudgetIdentity[];
  budgets: ActiveBudgetHeader[];
  mappings: ActiveBudgetMapping[];
  lines: ActiveBudgetLine[];
  periodAllocations: ActiveBudgetPeriodAllocation[];
};

export type ResolvedBudgetCommitment = {
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  supplierId: string;
  currency: string;
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
  orderedCents: number;
  billedCents: number;
  committedCents: number;
};

export type BudgetCommitmentException = {
  code: BudgetCommitmentExceptionCode;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  supplierId: string;
  currency: string;
  financialYearId: string | null;
  financialPeriodId: string | null;
  effectiveCostCentreId: string | null;
  outstandingSubtotalCents: number;
  outstandingTotalCents: number;
  committedCents: number | null;
  budgetId: string | null;
  budgetVersionId: string | null;
};

export type BudgetCommitmentConsumptionRow = {
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
  committedCents: number;
  billedCents: number;
  budgetLessCommitmentsCents: number;
  commitmentCount: number;
};

export type BudgetCommitmentConsumptionReport = {
  resolved: ResolvedBudgetCommitment[];
  rows: BudgetCommitmentConsumptionRow[];
  exceptions: BudgetCommitmentException[];
  resolvedCommitmentCount: number;
  unresolvedExceptionCount: number;
};

function safeBudgetCents(value: string | number | bigint): number {
  const parsed = typeof value === 'bigint' ? value : BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Budget money value is outside JavaScript safe-integer range');
  }
  return Number(parsed);
}

function basisValues(line: PurchaseLineCommitment, taxBasis: BudgetTaxBasis) {
  return taxBasis === 'EXCLUSIVE'
    ? {
        orderedCents: line.orderedSubtotalCents,
        billedCents: line.billedSubtotalCents,
        committedCents: line.outstandingSubtotalCents,
      }
    : {
        orderedCents: line.orderedTotalCents,
        billedCents: line.billedTotalCents,
        committedCents: line.outstandingTotalCents,
      };
}

function exception(
  code: BudgetCommitmentExceptionCode,
  po: PurchaseOrderCommitment,
  line: PurchaseLineCommitment,
  budget: ActiveBudgetHeader | null = null,
): BudgetCommitmentException {
  return {
    code,
    purchaseOrderId: po.purchaseOrderId,
    purchaseOrderLineId: line.purchaseOrderLineId,
    supplierId: po.supplierId,
    currency: po.currency,
    financialYearId: po.financialYearId,
    financialPeriodId: po.financialPeriodId,
    effectiveCostCentreId: line.effectiveCostCentreId,
    outstandingSubtotalCents: line.outstandingSubtotalCents,
    outstandingTotalCents: line.outstandingTotalCents,
    committedCents: budget ? basisValues(line, budget.taxBasis).committedCents : null,
    budgetId: budget?.budgetId ?? null,
    budgetVersionId: budget?.activeVersionId ?? null,
  };
}

export function deriveBudgetCommitmentConsumption(
  commitments: PurchaseCommitmentReport,
  context: ActiveBudgetContext,
): BudgetCommitmentConsumptionReport {
  const resolved: ResolvedBudgetCommitment[] = [];
  const exceptions: BudgetCommitmentException[] = [];

  for (const po of commitments.purchaseOrders) {
    for (const line of po.lines) {
      if (line.state === 'INVALID_OVERBILLED') {
        exceptions.push(exception('INVALID_OVERBILLED', po, line));
        continue;
      }
      if (po.periodResolution === 'UNRESOLVED') {
        exceptions.push(exception('UNRESOLVED_PERIOD', po, line));
        continue;
      }
      if (po.periodResolution === 'AMBIGUOUS') {
        exceptions.push(exception('AMBIGUOUS_PERIOD', po, line));
        continue;
      }
      if (!po.financialYearId || !po.financialPeriodId) {
        exceptions.push(exception('UNRESOLVED_PERIOD', po, line));
        continue;
      }

      const sameYearIdentities = context.budgetIdentities.filter(
        budget => budget.financialYearId === po.financialYearId,
      );
      const exactIdentity = sameYearIdentities.find(budget => budget.currency === po.currency);
      const matchingBudgets = context.budgets.filter(
        budget => budget.financialYearId === po.financialYearId && budget.currency === po.currency,
      );
      if (matchingBudgets.length === 0) {
        exceptions.push(exception(
          exactIdentity ? 'NO_ACTIVE_BUDGET' : sameYearIdentities.length > 0 ? 'CURRENCY_MISMATCH' : 'NO_ACTIVE_BUDGET',
          po,
          line,
        ));
        continue;
      }
      if (matchingBudgets.length > 1) throw new Error('multiple ACTIVE Budgets resolved for one financial year and currency');

      const budget = matchingBudgets[0];
      if (!line.effectiveCostCentreId) {
        exceptions.push(exception('UNATTRIBUTED_COST_CENTRE', po, line, budget));
        continue;
      }

      const mappings = context.mappings.filter(mapping =>
        mapping.budgetVersionId === budget.activeVersionId
        && mapping.costCentreId === line.effectiveCostCentreId,
      );
      if (mappings.length === 0) {
        exceptions.push(exception('UNMAPPED_ACCOUNT', po, line, budget));
        continue;
      }
      if (mappings.length > 1) {
        exceptions.push(exception('AMBIGUOUS_ACCOUNT', po, line, budget));
        continue;
      }

      const mapping = mappings[0];
      const budgetLines = context.lines.filter(candidate =>
        candidate.budgetVersionId === budget.activeVersionId
        && candidate.budgetAccountId === mapping.budgetAccountId
        && candidate.costCentreId === line.effectiveCostCentreId,
      );
      if (budgetLines.length === 0) {
        exceptions.push(exception('NO_BUDGET_LINE', po, line, budget));
        continue;
      }
      if (budgetLines.length > 1) throw new Error('multiple Budget lines resolved for one account and cost centre');

      const budgetLine = budgetLines[0];
      const periodBudgetCents = budget.periodisationMode === 'PERIODISED'
        ? context.periodAllocations
            .filter(allocation => allocation.budgetLineId === budgetLine.budgetLineId
              && allocation.financialPeriodId === po.financialPeriodId)
            .reduce((sum, allocation) => sum + allocation.amountCents, 0)
        : null;
      const values = basisValues(line, budget.taxBasis);

      resolved.push({
        purchaseOrderId: po.purchaseOrderId,
        purchaseOrderLineId: line.purchaseOrderLineId,
        supplierId: po.supplierId,
        currency: po.currency,
        financialYearId: po.financialYearId,
        financialYearName: po.financialYearName ?? budget.financialYearName,
        financialPeriodId: po.financialPeriodId,
        financialPeriodName: po.financialPeriodName ?? po.financialPeriodId,
        budgetId: budget.budgetId,
        budgetVersionId: budget.activeVersionId,
        budgetAccountId: mapping.budgetAccountId,
        budgetAccountCode: mapping.budgetAccountCode,
        budgetAccountName: mapping.budgetAccountName,
        costCentreId: line.effectiveCostCentreId,
        costCentreCode: line.effectiveCostCentreCode,
        costCentreName: line.effectiveCostCentreName,
        budgetLineId: budgetLine.budgetLineId,
        taxBasis: budget.taxBasis,
        periodisationMode: budget.periodisationMode,
        annualBudgetCents: budgetLine.annualBudgetCents,
        periodBudgetCents,
        ...values,
      });
    }
  }
  const rowMap = new Map<string, BudgetCommitmentConsumptionRow>();
  for (const item of resolved) {
    const periodKey = item.periodisationMode === 'PERIODISED' ? item.financialPeriodId : '';
    const key = [item.budgetVersionId, item.budgetLineId, item.costCentreId, periodKey, item.currency].join('|');
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
      committedCents: 0,
      billedCents: 0,
      budgetLessCommitmentsCents: 0,
      commitmentCount: 0,
    };
    current.committedCents += item.committedCents;
    current.billedCents += item.billedCents;
    current.commitmentCount += 1;
    rowMap.set(key, current);
  }

  const rows = [...rowMap.values()].map(row => ({
    ...row,
    budgetLessCommitmentsCents:
      (row.periodisationMode === 'PERIODISED' ? row.periodBudgetCents ?? 0 : row.annualBudgetCents)
      - row.committedCents,
  })).sort((a, b) =>
    a.currency.localeCompare(b.currency)
    || a.budgetAccountCode.localeCompare(b.budgetAccountCode)
    || a.costCentreId.localeCompare(b.costCentreId)
    || (a.financialPeriodId ?? '').localeCompare(b.financialPeriodId ?? ''),
  );

  return {
    resolved,
    rows,
    exceptions,
    resolvedCommitmentCount: resolved.length,
    unresolvedExceptionCount: exceptions.length,
  };
}

export type ActiveBudgetHeaderRow = {
  budget_id: string;
  financial_year_id: string;
  financial_year_name: string;
  currency: string;
  tax_basis: BudgetTaxBasis;
  periodisation_mode: BudgetPeriodisationMode;
  active_version_id: string | null;
  version_number: number | null;
};
export type ActiveBudgetMappingRow = {
  budget_version_id: string;
  cost_centre_id: string;
  budget_account_id: string;
  budget_account_code: string;
  budget_account_name: string;
};
export type ActiveBudgetLineRow = {
  budget_line_id: string;
  budget_version_id: string;
  budget_account_id: string;
  cost_centre_id: string;
  annual_budget_cents: string | number | bigint;
};
export type ActiveBudgetAllocationRow = {
  budget_line_id: string;
  financial_period_id: string;
  amount_cents: string | number | bigint;
};

export async function getActiveBudgetContext(organisationId: string): Promise<ActiveBudgetContext> {
  const [budgetRows, mappingRows, lineRows, allocationRows] = await sql.transaction(txn => [
    txn`
      SELECT
        cb.id AS budget_id,
        cb.financial_year_id,
        cfy.name AS financial_year_name,
        cb.currency,
        cb.tax_basis,
        cb.periodisation_mode,
        cb.active_version_id,
        bv.version_number
      FROM commercial_budgets cb
      JOIN commercial_financial_years cfy
        ON cfy.id = cb.financial_year_id
       AND cfy.organisation_id = cb.organisation_id
      LEFT JOIN commercial_budget_versions bv
        ON bv.id = cb.active_version_id
       AND bv.budget_id = cb.id
       AND bv.organisation_id = cb.organisation_id
       AND bv.status = 'ACTIVE'
      WHERE cb.organisation_id = ${organisationId}
      ORDER BY cb.financial_year_id, cb.currency
    `,
    txn`
      SELECT
        bcm.budget_version_id,
        bcm.cost_centre_id,
        bcm.budget_account_id,
        ba.code AS budget_account_code,
        ba.name AS budget_account_name
      FROM commercial_budget_commitment_mappings bcm
      JOIN commercial_budget_versions bv
        ON bv.id = bcm.budget_version_id
       AND bv.organisation_id = bcm.organisation_id
       AND bv.status = 'ACTIVE'
      JOIN commercial_budgets cb
        ON cb.id = bv.budget_id
       AND cb.organisation_id = bv.organisation_id
       AND cb.active_version_id = bv.id
      JOIN commercial_budget_accounts ba
        ON ba.id = bcm.budget_account_id
       AND ba.organisation_id = bcm.organisation_id
      WHERE bcm.organisation_id = ${organisationId}
      ORDER BY bcm.budget_version_id, bcm.cost_centre_id, bcm.id
    `,
    txn`
      SELECT
        bl.id AS budget_line_id,
        bl.budget_version_id,
        bl.budget_account_id,
        bl.cost_centre_id,
        bl.annual_budget_cents::text AS annual_budget_cents
      FROM commercial_budget_lines bl
      JOIN commercial_budget_versions bv
        ON bv.id = bl.budget_version_id
       AND bv.organisation_id = bl.organisation_id
       AND bv.status = 'ACTIVE'
      JOIN commercial_budgets cb
        ON cb.id = bv.budget_id
       AND cb.organisation_id = bv.organisation_id
       AND cb.active_version_id = bv.id
      WHERE bl.organisation_id = ${organisationId}
      ORDER BY bl.budget_version_id, bl.budget_account_id, bl.cost_centre_id
    `,
    txn`
      SELECT
        bpa.budget_line_id,
        bpa.financial_period_id,
        bpa.amount_cents::text AS amount_cents
      FROM commercial_budget_period_allocations bpa
      JOIN commercial_budget_lines bl
        ON bl.id = bpa.budget_line_id
       AND bl.organisation_id = bpa.organisation_id
      JOIN commercial_budget_versions bv
        ON bv.id = bl.budget_version_id
       AND bv.organisation_id = bl.organisation_id
       AND bv.status = 'ACTIVE'
      JOIN commercial_budgets cb
        ON cb.id = bv.budget_id
       AND cb.organisation_id = bv.organisation_id
       AND cb.active_version_id = bv.id
      WHERE bpa.organisation_id = ${organisationId}
      ORDER BY bpa.budget_line_id, bpa.financial_period_id
    `,
  ], { isolationLevel: 'RepeatableRead' });

  return deriveActiveBudgetContextFromRows(
    budgetRows as ActiveBudgetHeaderRow[],
    mappingRows as ActiveBudgetMappingRow[],
    lineRows as ActiveBudgetLineRow[],
    allocationRows as ActiveBudgetAllocationRow[],
  );
}

export function deriveActiveBudgetContextFromRows(
  budgetRows: ActiveBudgetHeaderRow[],
  mappingRows: ActiveBudgetMappingRow[],
  lineRows: ActiveBudgetLineRow[],
  allocationRows: ActiveBudgetAllocationRow[],
): ActiveBudgetContext {
  const headers = budgetRows;
  return {
    budgetIdentities: headers.map(row => ({
      financialYearId: row.financial_year_id,
      currency: row.currency,
      hasActiveVersion: row.active_version_id !== null && row.version_number !== null,
    })),
    budgets: headers.filter(
      (row): row is ActiveBudgetHeaderRow & { active_version_id: string; version_number: number } =>
        row.active_version_id !== null && row.version_number !== null,
    ).map(row => ({
      budgetId: row.budget_id,
      financialYearId: row.financial_year_id,
      financialYearName: row.financial_year_name,
      currency: row.currency,
      taxBasis: row.tax_basis,
      periodisationMode: row.periodisation_mode,
      activeVersionId: row.active_version_id,
      versionNumber: Number(row.version_number),
    })),
    mappings: mappingRows.map(row => ({
      budgetVersionId: row.budget_version_id,
      costCentreId: row.cost_centre_id,
      budgetAccountId: row.budget_account_id,
      budgetAccountCode: row.budget_account_code,
      budgetAccountName: row.budget_account_name,
    })),
    lines: lineRows.map(row => ({
      budgetLineId: row.budget_line_id,
      budgetVersionId: row.budget_version_id,
      budgetAccountId: row.budget_account_id,
      costCentreId: row.cost_centre_id,
      annualBudgetCents: safeBudgetCents(row.annual_budget_cents),
    })),
    periodAllocations: allocationRows.map(row => ({
      budgetLineId: row.budget_line_id,
      financialPeriodId: row.financial_period_id,
      amountCents: safeBudgetCents(row.amount_cents),
    })),
  };
}

export async function getBudgetCommitmentConsumption(
  organisationId: string,
): Promise<BudgetCommitmentConsumptionReport> {
  const [commitments, context] = await Promise.all([
    getPurchaseCommitmentReport(organisationId),
    getActiveBudgetContext(organisationId),
  ]);
  return deriveBudgetCommitmentConsumption(commitments, context);
}
