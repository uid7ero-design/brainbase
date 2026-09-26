import 'server-only';
import sql from '@/lib/db';

export type BudgetActualPeriodResolution = 'UNRESOLVED' | 'RESOLVED' | 'AMBIGUOUS';

export type BudgetActualExceptionCode =
  | 'UNRESOLVED_PERIOD'
  | 'AMBIGUOUS_PERIOD'
  | 'UNATTRIBUTED_COST_CENTRE'
  | 'MISSING_POSTED_AT'
  | 'SOURCE_CURRENCY_MISMATCH';

export interface BudgetActualLine {
  supplierBillLineId: string;
  supplierBillId: string;
  supplierBillNumber: string | null;
  supplierId: string;
  supplierName: string | null;
  sourcePurchaseOrderId: string;
  sourcePurchaseOrderLineId: string;
  currency: string;
  recognisedAt: string | null;
  periodResolution: BudgetActualPeriodResolution;
  financialPeriodId: string | null;
  financialPeriodName: string | null;
  financialPeriodStatus: 'OPEN' | 'CLOSED' | null;
  financialYearId: string | null;
  financialYearName: string | null;
  effectiveCostCentreId: string | null;
  effectiveCostCentreCode: string | null;
  effectiveCostCentreName: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  exceptionCodes: BudgetActualExceptionCode[];
}

export interface BudgetActualCurrencySummary {
  currency: string;
  lineCount: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface BudgetActualReport {
  lineCount: number;
  resolvedPeriodCount: number;
  unresolvedPeriodCount: number;
  ambiguousPeriodCount: number;
  exceptionLineCount: number;
  currencies: BudgetActualCurrencySummary[];
  lines: BudgetActualLine[];
}

export type RawBudgetActualRow = {
  supplier_bill_line_id: string;
  supplier_bill_id: string;
  supplier_bill_number: string | null;
  supplier_id: string;
  supplier_name: string | null;
  source_purchase_order_id: string;
  source_purchase_order_line_id: string;
  bill_currency: string;
  purchase_order_currency: string;
  posted_at: string | Date | null;
  line_subtotal_cents: number | string;
  line_tax_cents: number | string;
  line_total_cents: number | string;
  effective_cost_centre_id: string | null;
  effective_cost_centre_code: string | null;
  effective_cost_centre_name: string | null;
  period_match_count: number | string | null;
  financial_period_id: string | null;
  financial_period_name: string | null;
  financial_period_status: 'OPEN' | 'CLOSED' | null;
  financial_year_id: string | null;
  financial_year_name: string | null;
};

function cents(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Budget Actual money value is not a safe integer number of cents');
  return parsed;
}

function timestamp(value: string | Date | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Budget Actual recognised timestamp is invalid');
  return parsed.toISOString();
}

export function deriveBudgetActualLine(row: RawBudgetActualRow): BudgetActualLine {
  const matchCount = Number(row.period_match_count ?? 0);
  const periodResolution: BudgetActualPeriodResolution =
    matchCount === 1 ? 'RESOLVED' : matchCount > 1 ? 'AMBIGUOUS' : 'UNRESOLVED';
  const exceptionCodes: BudgetActualExceptionCode[] = [];

  if (!row.posted_at) exceptionCodes.push('MISSING_POSTED_AT');
  if (periodResolution === 'UNRESOLVED') exceptionCodes.push('UNRESOLVED_PERIOD');
  if (periodResolution === 'AMBIGUOUS') exceptionCodes.push('AMBIGUOUS_PERIOD');
  if (!row.effective_cost_centre_id) exceptionCodes.push('UNATTRIBUTED_COST_CENTRE');
  if (row.bill_currency !== row.purchase_order_currency) exceptionCodes.push('SOURCE_CURRENCY_MISMATCH');

  return {
    supplierBillLineId: row.supplier_bill_line_id,
    supplierBillId: row.supplier_bill_id,
    supplierBillNumber: row.supplier_bill_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    sourcePurchaseOrderId: row.source_purchase_order_id,
    sourcePurchaseOrderLineId: row.source_purchase_order_line_id,
    currency: row.bill_currency,
    recognisedAt: timestamp(row.posted_at),
    periodResolution,
    financialPeriodId: periodResolution === 'RESOLVED' ? row.financial_period_id : null,
    financialPeriodName: periodResolution === 'RESOLVED' ? row.financial_period_name : null,
    financialPeriodStatus: periodResolution === 'RESOLVED' ? row.financial_period_status : null,
    financialYearId: periodResolution === 'RESOLVED' ? row.financial_year_id : null,
    financialYearName: periodResolution === 'RESOLVED' ? row.financial_year_name : null,
    effectiveCostCentreId: row.effective_cost_centre_id,
    effectiveCostCentreCode: row.effective_cost_centre_code,
    effectiveCostCentreName: row.effective_cost_centre_name,
    subtotalCents: cents(row.line_subtotal_cents),
    taxCents: cents(row.line_tax_cents),
    totalCents: cents(row.line_total_cents),
    exceptionCodes,
  };
}

export function deriveBudgetActualReport(rows: RawBudgetActualRow[]): BudgetActualReport {
  const lines = rows.map(deriveBudgetActualLine);
  const currencyMap = new Map<string, BudgetActualCurrencySummary>();
  for (const line of lines) {
    const current = currencyMap.get(line.currency) ?? {
      currency: line.currency, lineCount: 0, subtotalCents: 0, taxCents: 0, totalCents: 0,
    };
    current.lineCount += 1;
    current.subtotalCents += line.subtotalCents;
    current.taxCents += line.taxCents;
    current.totalCents += line.totalCents;
    currencyMap.set(line.currency, current);
  }

  return {
    lineCount: lines.length,
    resolvedPeriodCount: lines.filter(line => line.periodResolution === 'RESOLVED').length,
    unresolvedPeriodCount: lines.filter(line => line.periodResolution === 'UNRESOLVED').length,
    ambiguousPeriodCount: lines.filter(line => line.periodResolution === 'AMBIGUOUS').length,
    exceptionLineCount: lines.filter(line => line.exceptionCodes.length > 0).length,
    currencies: [...currencyMap.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    lines,
  };
}

// C7.8A is read-only and migration-free. bill_date, receipts, match allocations,
// customer payments, and legacy financial_models are deliberately absent.
export async function getBudgetActualReport(
  organisationId: string,
): Promise<BudgetActualReport> {
  const rows = await sql`
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
      period.financial_year_name
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
    WHERE sbl.organisation_id = ${organisationId}
      AND sb.organisation_id = ${organisationId}
      AND pol.organisation_id = ${organisationId}
      AND po.organisation_id = ${organisationId}
      AND sb.status = 'POSTED'
    ORDER BY sb.posted_at ASC NULLS LAST, sb.id ASC, sbl.position ASC, sbl.id ASC
  ` as RawBudgetActualRow[];

  return deriveBudgetActualReport(rows);
}
