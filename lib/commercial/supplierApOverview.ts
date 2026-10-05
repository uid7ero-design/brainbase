import 'server-only';
import sql from '@/lib/db';
import { buildSupplierApOverview, calendarDay, type ApBillInput } from './supplierApOverviewModel';

export async function getSupplierApOverview(organisationId: string, agingDate: string) {
  calendarDay(agingDate);
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
    ORDER BY s.name, s.id, b.currency, b.due_date NULLS LAST, b.id
  `;
  return buildSupplierApOverview(rows as ApBillInput[], agingDate);
}
