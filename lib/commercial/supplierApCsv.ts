import { buildCsv } from '@/lib/events/csvExport';
import { AP_AGING_BUCKETS, type SupplierApOverview } from './supplierApOverviewModel';

// Protect spreadsheet consumers even when untrusted text starts with whitespace
// or control characters before a formula. Preserve the original text otherwise.
function textCell(value: string | null) {
  return value && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function buildSupplierApCsv(report: SupplierApOverview, view: 'bills' | 'aging'): string {
  const common = ['Aging date', 'Balance basis', 'Supplier ID', 'Supplier', 'Supplier active', 'Currency'];
  if (view === 'aging') {
    return buildCsv([...common, 'Posted payable cents', 'Paid cents', 'Outstanding cents', 'Overdue cents',
      ...AP_AGING_BUCKETS.map(bucket => `${bucket} cents`), 'Bill count', 'Outstanding bill count'],
    report.suppliers.map(row => [report.aging_date, report.balance_basis, row.supplier_id, textCell(row.supplier_name), String(row.supplier_active), row.currency,
      row.payable_cents, row.paid_cents, row.outstanding_cents, row.overdue_cents, ...AP_AGING_BUCKETS.map(bucket => row.buckets[bucket]), row.bill_count, row.outstanding_bill_count]));
  }
  return buildCsv([...common, 'Bill ID', 'Bill number', 'Supplier invoice number', 'Due date', 'Posted payable cents', 'Paid cents', 'Outstanding cents', 'Aging bucket'],
    report.bills.map(row => [report.aging_date, report.balance_basis, row.supplier_id, textCell(row.supplier_name), String(row.supplier_active), row.currency,
      row.bill_id, textCell(row.bill_number), textCell(row.supplier_invoice_number), row.due_date, row.payable_cents, row.paid_cents, row.outstanding_cents, row.bucket]));
}
