'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SupplierBillStatusBadge } from '../_billStatus';
import { SUPPLIER_BILL_STATUSES, SUPPLIER_BILL_STATUS_LABELS, type SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { formatMoneyCents } from '@/lib/commercial/money';
import {
  PageHeader,
  TableContainer,
  TableStateRow,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';

type SupplierBill = {
  id: string; source_purchase_order_id: string; supplier_invoice_number: string; bill_number: string | null;
  status: SupplierBillStatus; currency: string; bill_date: string | null; due_date: string | null;
  total_cents: number; supplier_name_snapshot: string | null; created_at: string;
};

// Phase C7.4 — mirrors app/commercial/purchasing/purchase-receipts/page.tsx's
// shape, with a Supplier/Total column added — unlike a receipt, a
// supplier bill IS a financial document.
export default function SupplierBillsPage() {
  const searchParams = useSearchParams();
  const [supplierBills, setSupplierBills] = useState<SupplierBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'ALL');

  async function load() {
    const res = await fetch('/api/commercial/supplier-bills');
    if (res.ok) setSupplierBills((await res.json()).supplierBills ?? []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'ALL' ? supplierBills : supplierBills.filter(b => b.status === statusFilter);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Supplier Bills"
        description={`${supplierBills.length} total`}
        actions={<Link href="/commercial/purchasing/supplier-bills/new" {...buttonProps('primary')}>+ New Supplier Bill</Link>}
      />

      <WorkToolbar count={statusFilter !== 'ALL' && !loading ? `${filtered.length} of ${supplierBills.length}` : undefined}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={toolbarControlClassName}
        >
          <option value="ALL">All statuses</option>
          {SUPPLIER_BILL_STATUSES.map(s => <option key={s} value={s}>{SUPPLIER_BILL_STATUS_LABELS[s]}</option>)}
        </select>
      </WorkToolbar>

      <TableContainer label="Supplier bills" minWidth={780}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Bill Number</th>
              <th scope="col">Supplier</th>
              <th scope="col">Supplier Invoice #</th>
              <th scope="col">Status</th>
              <th scope="col">Due Date</th>
              <th scope="col" className={tableStyles.num}>Total</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading supplier bills…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">No supplier bills yet.</TableStateRow>}
            {filtered.map(b => (
              <tr key={b.id}>
                <td className={tableStyles.primary} style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/commercial/purchasing/supplier-bills/${b.id}`}>
                    {b.bill_number ?? <span className={tableStyles.muted}>Draft</span>}
                  </Link>
                </td>
                <td>{b.supplier_name_snapshot ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{b.supplier_invoice_number}</td>
                <td><SupplierBillStatusBadge status={b.status} /></td>
                <td>{b.due_date ? formatCommercialDate(b.due_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{formatMoneyCents(b.total_cents, b.currency)}</td>
                <td className={tableStyles.actions}>
                  <Link
                    href={`/commercial/purchasing/supplier-bills/${b.id}`}
                    className={tableStyles.link}
                    aria-label={`${b.status === 'DRAFT' ? 'Edit' : 'View'} supplier bill ${b.bill_number ?? '(draft)'}`}
                  >
                    {b.status === 'DRAFT' ? 'Edit →' : 'View →'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
