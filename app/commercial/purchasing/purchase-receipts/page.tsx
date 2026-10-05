'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PurchaseReceiptStatusBadge } from '../_receiptStatus';
import { PURCHASE_RECEIPT_STATUSES, PURCHASE_RECEIPT_STATUS_LABELS, type PurchaseReceiptStatus } from '@/lib/commercial/purchaseReceiptLifecycle';
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

type PurchaseReceipt = {
  id: string; purchase_order_id: string; receipt_number: string | null; status: PurchaseReceiptStatus;
  received_date: string | null; delivery_reference: string | null; created_at: string;
};

// Phase C7.3 — mirrors app/commercial/purchasing/purchase-orders/page.tsx
// exactly. No supplier/total column here (a receipt is a quantity fact,
// not a financial document) — PO Number links back to the parent PO.
export default function PurchaseReceiptsPage() {
  const searchParams = useSearchParams();
  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'ALL');

  async function load() {
    const res = await fetch('/api/commercial/purchase-receipts');
    if (res.ok) setPurchaseReceipts((await res.json()).purchaseReceipts ?? []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'ALL' ? purchaseReceipts : purchaseReceipts.filter(r => r.status === statusFilter);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Purchase Receipts"
        description={`${purchaseReceipts.length} total`}
        actions={<Link href="/commercial/purchasing/purchase-receipts/new" {...buttonProps('primary')}>+ New Purchase Receipt</Link>}
      />

      <WorkToolbar count={statusFilter !== 'ALL' && !loading ? `${filtered.length} of ${purchaseReceipts.length}` : undefined}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={toolbarControlClassName}
        >
          <option value="ALL">All statuses</option>
          {PURCHASE_RECEIPT_STATUSES.map(s => <option key={s} value={s}>{PURCHASE_RECEIPT_STATUS_LABELS[s]}</option>)}
        </select>
      </WorkToolbar>

      <TableContainer label="Purchase receipts" minWidth={640}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Receipt Number</th>
              <th scope="col">Status</th>
              <th scope="col">Received Date</th>
              <th scope="col">Delivery Reference</th>
              <th scope="col">Created</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={6} kind="loading">Loading purchase receipts…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={6} kind="empty">No purchase receipts yet.</TableStateRow>}
            {filtered.map(r => (
              <tr key={r.id}>
                <td className={tableStyles.primary} style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/commercial/purchasing/purchase-receipts/${r.id}`}>
                    {r.receipt_number ?? <span className={tableStyles.muted}>Draft</span>}
                  </Link>
                </td>
                <td><PurchaseReceiptStatusBadge status={r.status} /></td>
                <td>{r.received_date ? formatCommercialDate(r.received_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td>{r.delivery_reference ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{formatCommercialDate(r.created_at)}</td>
                <td className={tableStyles.actions}>
                  <Link
                    href={`/commercial/purchasing/purchase-receipts/${r.id}`}
                    className={tableStyles.link}
                    aria-label={`${r.status === 'DRAFT' ? 'Edit' : 'View'} purchase receipt ${r.receipt_number ?? '(draft)'}`}
                  >
                    {r.status === 'DRAFT' ? 'Edit →' : 'View →'}
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
