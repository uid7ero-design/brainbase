import 'server-only';
import sql from '@/lib/db';
import {
  derivePurchaseCommitmentReport,
  type RawPurchaseCommitmentRow,
} from './purchasingCommitments';
import {
  deriveBudgetActualReport,
  type RawBudgetActualRow,
} from './budgetActuals';
import {
  deriveActiveBudgetContextFromRows,
  deriveBudgetCommitmentConsumption,
  type ActiveBudgetAllocationRow,
  type ActiveBudgetHeaderRow,
  type ActiveBudgetLineRow,
  type ActiveBudgetMappingRow,
  type BudgetCommitmentConsumptionReport,
} from './budgetCommitmentResolver';
import {
  deriveBudgetActualConsumption,
  type BudgetActualConsumptionReport,
} from './budgetActualResolver';
import type { BudgetPeriodisationMode, BudgetTaxBasis } from './budgets';

export type CombinedBudgetException =
  | { source: 'COMMITMENT'; exception: BudgetCommitmentConsumptionReport['exceptions'][number] }
  | { source: 'ACTUAL'; exception: BudgetActualConsumptionReport['exceptions'][number] };
export type BudgetActualCommittedRow = {
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
  budgetCents: number;
  actualCents: number;
  committedCents: number;
  exposureCents: number;
  budgetLessActualCents: number;
  budgetLessActualAndCommittedCents: number;
  actualLineCount: number;
  commitmentCount: number;
};

export type BudgetActualCommittedReport = {
  rows: BudgetActualCommittedRow[];
  exceptions: CombinedBudgetException[];
  resolvedActualCount: number;
  resolvedCommitmentCount: number;
  unresolvedExceptionCount: number;
};

type MergeSeed = Omit<
  BudgetActualCommittedRow,
  | 'actualCents'
  | 'committedCents'
  | 'exposureCents'
  | 'budgetLessActualCents'
  | 'budgetLessActualAndCommittedCents'
  | 'actualLineCount'
  | 'commitmentCount'
>;

function grainKey(row: {
  budgetVersionId: string;
  budgetAccountId: string;
  costCentreId: string;
  financialPeriodId: string | null;
  currency: string;
}) {
  return [
    row.budgetVersionId,
    row.budgetAccountId,
    row.costCentreId,
    row.financialPeriodId ?? 'ANNUAL',
    row.currency,
  ].join('|');
}
function mergeSeed(row: {
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
}): MergeSeed {
  const budgetCents = row.periodisationMode === 'PERIODISED'
    ? row.periodBudgetCents ?? 0
    : row.annualBudgetCents;
  return { ...row, budgetCents };
}

function assertSameSeed(existing: MergeSeed, candidate: MergeSeed) {
  const fields: Array<keyof MergeSeed> = [
    'budgetId', 'budgetVersionId', 'budgetAccountId', 'costCentreId',
    'financialYearId', 'financialPeriodId', 'currency', 'taxBasis',
    'periodisationMode', 'annualBudgetCents', 'periodBudgetCents', 'budgetCents',
  ];
  for (const field of fields) {
    if (existing[field] !== candidate[field]) {
      throw new Error(`Budget Actual/Committed snapshot metadata mismatch at ${String(field)}`);
    }
  }
}
export function deriveBudgetActualCommittedReport(
  commitments: BudgetCommitmentConsumptionReport,
  actuals: BudgetActualConsumptionReport,
): BudgetActualCommittedReport {
  const map = new Map<string, {
    seed: MergeSeed;
    actualCents: number;
    committedCents: number;
    actualLineCount: number;
    commitmentCount: number;
  }>();

  for (const row of commitments.rows) {
    const seed = mergeSeed(row);
    const key = grainKey(row);
    const current = map.get(key);
    if (current) {
      assertSameSeed(current.seed, seed);
      current.committedCents += row.committedCents;
      current.commitmentCount += row.commitmentCount;
    } else {
      map.set(key, {
        seed,
        actualCents: 0,
        committedCents: row.committedCents,
        actualLineCount: 0,
        commitmentCount: row.commitmentCount,
      });
    }
  }

  for (const row of actuals.rows) {
    const seed = mergeSeed(row);
    const key = grainKey(row);
    const current = map.get(key);
    if (current) {
      assertSameSeed(current.seed, seed);
      current.actualCents += row.actualCents;
      current.actualLineCount += row.actualLineCount;
    } else {
      map.set(key, {
        seed,
        actualCents: row.actualCents,
        committedCents: 0,
        actualLineCount: row.actualLineCount,
        commitmentCount: 0,
      });
    }
  }

  const rows = [...map.values()].map(item => {
    const exposureCents = item.actualCents + item.committedCents;
    return {
      ...item.seed,
      actualCents: item.actualCents,
      committedCents: item.committedCents,
      exposureCents,
      budgetLessActualCents: item.seed.budgetCents - item.actualCents,
      budgetLessActualAndCommittedCents: item.seed.budgetCents - exposureCents,
      actualLineCount: item.actualLineCount,
      commitmentCount: item.commitmentCount,
    };
  }).sort((a, b) =>
    a.currency.localeCompare(b.currency)
    || a.budgetAccountCode.localeCompare(b.budgetAccountCode)
    || a.costCentreId.localeCompare(b.costCentreId)
    || (a.financialPeriodId ?? '').localeCompare(b.financialPeriodId ?? ''),
  );

  return {
    rows,
    exceptions: [
      ...commitments.exceptions.map(exception => ({ source: 'COMMITMENT' as const, exception })),
      ...actuals.exceptions.map(exception => ({ source: 'ACTUAL' as const, exception })),
    ],
    resolvedActualCount: actuals.resolvedActualCount,
    resolvedCommitmentCount: commitments.resolvedCommitmentCount,
    unresolvedExceptionCount:
      actuals.unresolvedExceptionCount + commitments.unresolvedExceptionCount,
  };
}
export async function getBudgetActualCommittedReport(
  organisationId: string,
): Promise<BudgetActualCommittedReport> {
  const [
    commitmentRows,
    actualRows,
    budgetRows,
    mappingRows,
    lineRows,
    allocationRows,
  ] = await sql.transaction(txn => [
    txn`
      WITH billed AS (
        SELECT
          csbl.source_purchase_order_line_id AS line_id,
          COALESCE(SUM(csbl.line_subtotal_cents), 0) AS billed_subtotal_cents,
          COALESCE(SUM(csbl.line_tax_cents), 0) AS billed_tax_cents,
          COALESCE(SUM(csbl.line_total_cents), 0) AS billed_total_cents
        FROM commercial_supplier_bill_lines csbl
        JOIN commercial_supplier_bills csb
          ON csb.id = csbl.supplier_bill_id
         AND csb.organisation_id = csbl.organisation_id
        JOIN commercial_purchase_order_lines source_line
          ON source_line.id = csbl.source_purchase_order_line_id
         AND source_line.organisation_id = csbl.organisation_id
        WHERE csbl.organisation_id = ${organisationId}
          AND csb.source_purchase_order_id = source_line.purchase_order_id
          AND csb.status = 'POSTED'
        GROUP BY csbl.source_purchase_order_line_id
      )
      SELECT
        cpo.id AS purchase_order_id,
        cpo.status AS purchase_order_status,
        cpo.supplier_id,
        supplier.name AS supplier_name,
        cpo.currency,
        cpo.issued_at,
        cpo.cost_centre_id AS purchase_order_cost_centre_id,
        cpol.id AS line_id,
        cpol.position,
        cpol.description_snapshot,
        cpol.cost_centre_id AS line_cost_centre_id,
        effective_cc.code AS effective_cost_centre_code,
        effective_cc.name AS effective_cost_centre_name,
        cpol.line_subtotal_cents AS ordered_subtotal_cents,
        cpol.line_tax_cents AS ordered_tax_cents,
        cpol.line_total_cents AS ordered_total_cents,
        COALESCE(b.billed_subtotal_cents, 0)::text AS billed_subtotal_cents,
        COALESCE(b.billed_tax_cents, 0)::text AS billed_tax_cents,
        COALESCE(b.billed_total_cents, 0)::text AS billed_total_cents,
        period.period_match_count,
        period.financial_period_id,
        period.financial_period_name,
        period.financial_period_status,
        period.financial_year_id,
        period.financial_year_name
      FROM commercial_purchase_orders cpo
      LEFT JOIN commercial_purchase_order_lines cpol
        ON cpol.purchase_order_id = cpo.id
       AND cpol.organisation_id = cpo.organisation_id
      LEFT JOIN billed b ON b.line_id = cpol.id
      LEFT JOIN commercial_suppliers supplier
        ON supplier.id = cpo.supplier_id
       AND supplier.organisation_id = cpo.organisation_id
      LEFT JOIN commercial_cost_centres effective_cc
        ON effective_cc.id = COALESCE(cpol.cost_centre_id, cpo.cost_centre_id)
       AND effective_cc.organisation_id = cpo.organisation_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS period_match_count,
          CASE WHEN COUNT(*) = 1 THEN MIN(cfp.id::text) ELSE NULL END AS financial_period_id,
          CASE WHEN COUNT(*) = 1 THEN MIN(cfp.name) ELSE NULL END AS financial_period_name,
          CASE WHEN COUNT(*) = 1 THEN MIN(cfp.status) ELSE NULL END AS financial_period_status,
          CASE WHEN COUNT(*) = 1 THEN MIN(cfy.id::text) ELSE NULL END AS financial_year_id,
          CASE WHEN COUNT(*) = 1 THEN MIN(cfy.name) ELSE NULL END AS financial_year_name
        FROM commercial_financial_periods cfp
        JOIN commercial_financial_years cfy
          ON cfy.id = cfp.financial_year_id
         AND cfy.organisation_id = cfp.organisation_id
        WHERE cfp.organisation_id = cpo.organisation_id
          AND cpo.issued_at IS NOT NULL
          AND cpo.issued_at::date BETWEEN cfp.starts_on AND cfp.ends_on
      ) period ON true
      WHERE cpo.organisation_id = ${organisationId}
        AND cpo.status = 'ISSUED'
      ORDER BY cpo.issued_at ASC NULLS LAST, cpo.id ASC,
        cpol.position ASC NULLS LAST, cpol.id ASC NULLS LAST
    `,
    txn`
      SELECT
        sbl.id AS supplier_bill_line_id,
        sb.id AS supplier_bill_id,
        sb.bill_number AS supplier_bill_number,
        sb.supplier_id,
        sb.supplier_name_snapshot AS supplier_name,
        sb.source_purchase_order_id,
        sbl.source_purchase_order_line_id,
        sb.currency AS bill_currency,
        po.currency AS purchase_order_currency,
        sb.posted_at,
        sb.bill_date,
        sbl.line_subtotal_cents::text AS line_subtotal_cents,
        sbl.line_tax_cents::text AS line_tax_cents,
        sbl.line_total_cents::text AS line_total_cents,
        COALESCE(pol.cost_centre_id, po.cost_centre_id) AS effective_cost_centre_id,
        cc.code AS effective_cost_centre_code,
        cc.name AS effective_cost_centre_name,
        period.period_match_count,
        period.financial_period_id,
        period.financial_period_name,
        period.financial_period_status,
        period.financial_year_id,
        period.financial_year_name,
        bill_period.bill_period_match_count,
        bill_period.bill_financial_period_id,
        bill_period.bill_financial_period_name,
        bill_period.bill_financial_period_status
      FROM commercial_supplier_bill_lines sbl
      JOIN commercial_supplier_bills sb
        ON sb.id = sbl.supplier_bill_id
       AND sb.organisation_id = sbl.organisation_id
      JOIN commercial_purchase_order_lines pol
        ON pol.id = sbl.source_purchase_order_line_id
       AND pol.organisation_id = sbl.organisation_id
      JOIN commercial_purchase_orders po
        ON po.id = pol.purchase_order_id
       AND po.organisation_id = pol.organisation_id
       AND po.id = sb.source_purchase_order_id
      LEFT JOIN commercial_cost_centres cc
        ON cc.id = COALESCE(pol.cost_centre_id, po.cost_centre_id)
       AND cc.organisation_id = sbl.organisation_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS period_match_count,
          CASE WHEN COUNT(*) = 1 THEN MIN(fp.id::text) ELSE NULL END AS financial_period_id,
          CASE WHEN COUNT(*) = 1 THEN MIN(fp.name) ELSE NULL END AS financial_period_name,
          CASE WHEN COUNT(*) = 1 THEN MIN(fp.status) ELSE NULL END AS financial_period_status,
          CASE WHEN COUNT(*) = 1 THEN MIN(fy.id::text) ELSE NULL END AS financial_year_id,
          CASE WHEN COUNT(*) = 1 THEN MIN(fy.name) ELSE NULL END AS financial_year_name
        FROM commercial_financial_periods fp
        JOIN commercial_financial_years fy
          ON fy.id = fp.financial_year_id
         AND fy.organisation_id = fp.organisation_id
        WHERE fp.organisation_id = sbl.organisation_id
          AND sb.posted_at IS NOT NULL
          AND sb.posted_at::date BETWEEN fp.starts_on AND fp.ends_on
      ) period ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS bill_period_match_count,
          CASE WHEN COUNT(*) = 1 THEN MIN(fp.id::text) ELSE NULL END AS bill_financial_period_id,
          CASE WHEN COUNT(*) = 1 THEN MIN(fp.name) ELSE NULL END AS bill_financial_period_name,
          CASE WHEN COUNT(*) = 1 THEN MIN(fp.status) ELSE NULL END AS bill_financial_period_status
        FROM commercial_financial_periods fp
        WHERE fp.organisation_id = sbl.organisation_id
          AND sb.bill_date BETWEEN fp.starts_on AND fp.ends_on
      ) bill_period ON true
      WHERE sbl.organisation_id = ${organisationId}
        AND sb.organisation_id = ${organisationId}
        AND pol.organisation_id = ${organisationId}
        AND po.organisation_id = ${organisationId}
        AND sb.status = 'POSTED'
      ORDER BY sb.posted_at ASC NULLS LAST, sb.id ASC, sbl.position ASC, sbl.id ASC
    `,
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

  const context = deriveActiveBudgetContextFromRows(
    budgetRows as ActiveBudgetHeaderRow[],
    mappingRows as ActiveBudgetMappingRow[],
    lineRows as ActiveBudgetLineRow[],
    allocationRows as ActiveBudgetAllocationRow[],
  );
  const commitments = deriveBudgetCommitmentConsumption(
    derivePurchaseCommitmentReport(commitmentRows as RawPurchaseCommitmentRow[]),
    context,
  );
  const actuals = deriveBudgetActualConsumption(
    deriveBudgetActualReport(actualRows as RawBudgetActualRow[]),
    context,
  );

  return deriveBudgetActualCommittedReport(commitments, actuals);
}
