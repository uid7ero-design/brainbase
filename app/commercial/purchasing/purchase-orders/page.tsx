'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PurchaseOrderStatusBadge } from '../_status';
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import {
  PageHeader,
  TableContainer,
  TableStateRow,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';

type PurchaseOrder = {
  id: string; purchase_order_number: string | null; status: PurchaseOrderStatus;
  supplier_name_snapshot: string | null; delivery_date: string | null;
  total_cents: number; currency: string; created_at: string;
};

// Phase C6.3 — mirrors app/commercial/invoices/page.tsx exactly. No
// approve/issue/cancel action buttons anywhere on this page — per this
// gate's Section G / Q, only current status is ever displayed here.
export default function PurchaseOrdersPage() {
  const searchParams = useSearchParams();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'ALL');

  async function load() {
    const res = await fetch('/api/commercial/purchase-orders');
    if (res.ok) setPurchaseOrders((await res.json()).purchaseOrders ?? []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'ALL' ? purchaseOrders : purchaseOrders.filter(po => po.status === statusFilter);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Purchase Orders"
        description={`${purchaseOrders.length} total`}
        actions={<Link href="/commercial/purchasing/purchase-orders/new" {...buttonProps('primary')}>+ New Purchase Order</Link>}
      />

      <WorkToolbar count={statusFilter !== 'ALL' && !loading ? `${filtered.length} of ${purchaseOrders.length}` : undefined}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={toolbarControlClassName}
        >
          <option value="ALL">All statuses</option>
          {PURCHASE_ORDER_STATUSES.map(s => <option key={s} value={s}>{PURCHASE_ORDER_STATUS_LABELS[s]}</option>)}
        </select>
      </WorkToolbar>

      <TableContainer label="Purchase orders" minWidth={780}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">PO Number</th>
              <th scope="col">Supplier</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Delivery Date</th>
              <th scope="col" className={tableStyles.num}>Total</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading purchase orders…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">No purchase orders yet.</TableStateRow>}
            {filtered.map(po => (
              <tr key={po.id}>
                <td className={tableStyles.primary} style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/commercial/purchasing/purchase-orders/${po.id}`}>
                    {po.purchase_order_number ?? <span className={tableStyles.muted}>Draft</span>}
                  </Link>
                </td>
                <td>{po.supplier_name_snapshot ?? <span className={tableStyles.muted}>—</span>}</td>
                <td><PurchaseOrderStatusBadge status={po.status} /></td>
                <td>{formatCommercialDate(po.created_at)}</td>
                <td>{po.delivery_date ? formatCommercialDate(po.delivery_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{formatMoneyCents(po.total_cents, po.currency)}</td>
                <td className={tableStyles.actions}>
                  <Link
                    href={`/commercial/purchasing/purchase-orders/${po.id}`}
                    className={tableStyles.link}
                    aria-label={`${po.status === 'DRAFT' ? 'Edit' : 'View'} purchase order ${po.purchase_order_number ?? '(draft)'}`}
                  >
                    {po.status === 'DRAFT' ? 'Edit →' : 'View →'}
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
