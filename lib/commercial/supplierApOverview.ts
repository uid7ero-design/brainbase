import 'server-only';
import sql from '@/lib/db';
import { DEFAULT_AP_FILTERS, calendarDay, type ApBillInput, type SupplierApFilters, type PagedSupplierApOverview, type SupplierApBalanceBasis } from './supplierApOverviewModel';

// Every aggregate and page shares one statement snapshot. LIMIT applies only
// after filtering and aggregation, so paging cannot alter portfolio totals.
export async function getSupplierApOverview(organisationId: string, agingDate: string, options: Partial<SupplierApFilters> = {}, basis: SupplierApBalanceBasis = 'CURRENT_POSTED_BILLS'): Promise<PagedSupplierApOverview> {
  return readSupplierApSnapshot(organisationId, agingDate, options, false, basis);
}

// Downloads include every matching posted bill, including fully settled bills,
// so their payable and paid columns reconcile to the overview totals.
export async function getSupplierApExport(organisationId: string, agingDate: string, options: Partial<SupplierApFilters> = {}, basis: SupplierApBalanceBasis = 'CURRENT_POSTED_BILLS') {
  return readSupplierApSnapshot(organisationId, agingDate, options, true, basis);
}

async function readSupplierApSnapshot(organisationId: string, agingDate: string, options: Partial<SupplierApFilters>, exportAll: boolean, basis: SupplierApBalanceBasis): Promise<PagedSupplierApOverview> {
  calendarDay(agingDate);
  const filters = { ...DEFAULT_AP_FILTERS, ...options };
  const historical = basis === 'HISTORICAL_RECORDED_BALANCE';
  // Interpret the selected day explicitly in UTC, independent of database/session
  // timezone. The next midnight is exclusive; events at that instant belong to
  // the following day. created_at prevents backdated entries rewriting history.
  const cutoff = sql`((${agingDate}::date + 1)::timestamp AT TIME ZONE 'UTC')`;
  const paymentScope = historical ? sql`p.created_at < ${cutoff} AND p.paid_at < ${cutoff}
    AND a.created_at < ${cutoff} AND (p.status='RECORDED' OR (p.status='REVERSED' AND p.reversed_at >= ${cutoff}))` : sql`p.status='RECORDED'`;
  const billScope = historical ? sql`b.status IN ('POSTED','CANCELLED') AND b.posted_at < ${cutoff}
    AND (b.status='POSTED' OR b.cancelled_at >= ${cutoff})` : sql`b.status='POSTED'`;
  const incompleteHistory = historical ? sql`EXISTS(
    SELECT 1 FROM commercial_supplier_bills b WHERE b.organisation_id=${organisationId} AND (
      (b.status IN ('POSTED','CANCELLED') AND b.posted_at IS NULL)
      OR (b.status='POSTED' AND b.cancelled_at IS NOT NULL)
      OR (b.status='CANCELLED' AND (b.cancelled_at IS NULL OR b.cancelled_at < b.posted_at))
      OR (b.status='DRAFT' AND b.posted_at IS NOT NULL)))
    OR EXISTS(SELECT 1 FROM commercial_supplier_payments p WHERE p.organisation_id=${organisationId} AND (
      (p.status='REVERSED' AND (p.reversed_at IS NULL OR p.reversed_at < p.created_at))
      OR (p.status='RECORDED' AND p.reversed_at IS NOT NULL)))` : sql`false`;
  const amounts = sql`jsonb_build_object(
    'payable_cents', COALESCE(SUM(payable_cents),0)::text, 'paid_cents', COALESCE(SUM(paid_cents),0)::text,
    'outstanding_cents', COALESCE(SUM(outstanding_cents),0)::text,
    'overdue_cents', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket NOT IN ('CURRENT','NO_DUE_DATE')),0)::text,
    'bill_count', COUNT(*)::int, 'outstanding_bill_count', COUNT(*) FILTER (WHERE outstanding_cents > 0)::int,
    'buckets', jsonb_build_object(
      'CURRENT', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket='CURRENT'),0)::text,
      'DAYS_1_30', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket='DAYS_1_30'),0)::text,
      'DAYS_31_60', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket='DAYS_31_60'),0)::text,
      'DAYS_61_90', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket='DAYS_61_90'),0)::text,
      'DAYS_91_PLUS', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket='DAYS_91_PLUS'),0)::text,
      'NO_DUE_DATE', COALESCE(SUM(outstanding_cents) FILTER (WHERE bucket='NO_DUE_DATE'),0)::text))`;
  const [row] = await sql`
    WITH paid AS (
      SELECT a.supplier_bill_id, SUM(a.allocated_amount_cents) AS paid_cents
      FROM commercial_supplier_payment_allocations a
      JOIN commercial_supplier_payments p ON p.id=a.supplier_payment_id AND p.organisation_id=a.organisation_id
        AND p.supplier_id=a.supplier_id AND p.currency=a.currency
      WHERE a.organisation_id=${organisationId} AND ${paymentScope}
      GROUP BY a.supplier_bill_id
    ), base AS MATERIALIZED (
      SELECT b.id AS bill_id, b.supplier_id, s.name AS supplier_name, s.active AS supplier_active,
        b.bill_number, b.supplier_invoice_number, b.due_date::text AS due_date, b.currency,
        b.total_cents::bigint AS payable_cents, COALESCE(paid.paid_cents,0) AS paid_cents,
        b.total_cents-COALESCE(paid.paid_cents,0) AS outstanding_cents,
        CASE WHEN b.due_date IS NULL THEN 'NO_DUE_DATE'
          WHEN b.due_date >= ${agingDate}::date THEN 'CURRENT'
          WHEN ${agingDate}::date-b.due_date <= 30 THEN 'DAYS_1_30'
          WHEN ${agingDate}::date-b.due_date <= 60 THEN 'DAYS_31_60'
          WHEN ${agingDate}::date-b.due_date <= 90 THEN 'DAYS_61_90' ELSE 'DAYS_91_PLUS' END AS bucket
      FROM commercial_supplier_bills b
      JOIN commercial_suppliers s ON s.id=b.supplier_id AND s.organisation_id=b.organisation_id
      LEFT JOIN paid ON paid.supplier_bill_id=b.id
      WHERE b.organisation_id=${organisationId} AND ${billScope}
    ), filtered AS MATERIALIZED (
      SELECT * FROM base WHERE (${filters.currency}::text IS NULL OR currency=${filters.currency})
        AND (${filters.supplierId}::text IS NULL OR supplier_id::text=${filters.supplierId?.toLowerCase() ?? null})
        AND (${filters.bucket}::text IS NULL OR bucket=${filters.bucket})
        AND strpos(lower(supplier_name || ' ' || COALESCE(bill_number,'') || ' ' || supplier_invoice_number), lower(${filters.search})) > 0
    ), supplier_totals AS MATERIALIZED (
      SELECT supplier_id, supplier_name, supplier_active, currency, ${amounts} AS amounts
      FROM filtered GROUP BY supplier_id,supplier_name,supplier_active,currency
    ), currency_totals AS (
      SELECT currency, ${amounts} AS amounts FROM filtered GROUP BY currency
    ), bill_page AS (
      SELECT * FROM filtered WHERE (${exportAll}::boolean OR outstanding_cents>0)
      ORDER BY supplier_name COLLATE "C",supplier_id,currency,due_date NULLS LAST,bill_id
      LIMIT ${exportAll ? null : filters.pageSize} OFFSET ${exportAll ? 0 : (filters.page-1)*filters.pageSize}
    ), supplier_page AS (
      SELECT * FROM supplier_totals ORDER BY supplier_name COLLATE "C",supplier_id,currency
      LIMIT ${exportAll ? null : filters.pageSize} OFFSET ${exportAll ? 0 : (filters.supplierPage-1)*filters.pageSize}
    )
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('payable_cents',payable_cents::text,'paid_cents',paid_cents::text,'outstanding_cents',outstanding_cents::text)
        ORDER BY supplier_name COLLATE "C",supplier_id,currency,due_date NULLS LAST,bill_id) FROM bill_page b),'[]'::jsonb) AS bills,
      COALESCE((SELECT jsonb_agg(amounts || jsonb_build_object('supplier_id',supplier_id,'supplier_name',supplier_name,'supplier_active',supplier_active,'currency',currency)
        ORDER BY supplier_name COLLATE "C",supplier_id,currency) FROM supplier_page),'[]'::jsonb) AS suppliers,
      COALESCE((SELECT jsonb_agg(amounts || jsonb_build_object('currency',currency) ORDER BY currency) FROM currency_totals),'[]'::jsonb) AS currencies,
      (SELECT COUNT(*)::int FROM filtered WHERE outstanding_cents>0) AS bill_count,
      (SELECT COUNT(*)::int FROM supplier_totals) AS supplier_count,
      EXISTS(SELECT 1 FROM base WHERE outstanding_cents<0) AS has_negative_balance,
      (${incompleteHistory}) AS has_incomplete_history,
      COALESCE((SELECT jsonb_agg(currency ORDER BY currency) FROM (SELECT DISTINCT currency FROM base) c),'[]'::jsonb) AS currency_options,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('supplier_id',supplier_id,'supplier_name',supplier_name) ORDER BY supplier_name COLLATE "C",supplier_id)
        FROM (SELECT DISTINCT supplier_id,supplier_name FROM base) s),'[]'::jsonb) AS supplier_options
  `;
  if (row.has_incomplete_history) throw new Error('Supplier AP history is incomplete');
  if (row.has_negative_balance) throw new Error('Supplier bill has a negative outstanding balance');
  return { aging_date: agingDate, balance_basis: basis, ...(historical ? { as_of_timezone: 'UTC' as const } : {}), filters,
    bills: row.bills as PagedSupplierApOverview['bills'], suppliers: row.suppliers as PagedSupplierApOverview['suppliers'], currencies: row.currencies as PagedSupplierApOverview['currencies'],
    pagination: { page: filters.page, supplier_page: filters.supplierPage, page_size: filters.pageSize, outstanding_bill_count: row.bill_count as number, supplier_count: row.supplier_count as number },
    options: { currencies: row.currency_options as string[], suppliers: row.supplier_options as PagedSupplierApOverview['options']['suppliers'] } };
}

export async function getSupplierApBills(organisationId: string, supplierId: string | null = null): Promise<ApBillInput[]> {
  const rows = await sql`
    WITH paid AS (
      SELECT a.supplier_bill_id, a.organisation_id, SUM(a.allocated_amount_cents)::text AS paid_cents
      FROM commercial_supplier_payment_allocations a
      JOIN commercial_supplier_payments p ON p.id = a.supplier_payment_id
        AND p.organisation_id = a.organisation_id AND p.supplier_id = a.supplier_id AND p.currency = a.currency
      WHERE a.organisation_id = ${organisationId} AND p.status = 'RECORDED'
      GROUP BY a.supplier_bill_id, a.organisation_id
    )
    SELECT b.id AS bill_id, b.supplier_id, s.name AS supplier_name, s.active AS supplier_active,
      b.bill_number, b.supplier_invoice_number, b.due_date::text AS due_date, b.currency,
      b.total_cents::text AS payable_cents, COALESCE(paid.paid_cents, '0') AS paid_cents
    FROM commercial_supplier_bills b
    JOIN commercial_suppliers s ON s.id = b.supplier_id AND s.organisation_id = b.organisation_id
    LEFT JOIN paid ON paid.supplier_bill_id = b.id AND paid.organisation_id = b.organisation_id
    WHERE b.organisation_id = ${organisationId} AND b.status = 'POSTED'
      AND (${supplierId}::text IS NULL OR b.supplier_id = ${supplierId})
    ORDER BY s.name, s.id, b.currency, b.due_date NULLS LAST, b.id
  `;
  return rows as ApBillInput[];
}
