'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PurchaseOrderStatusBadge } from '../_status';
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';

const CARD = 'var(--bg-surface)'; const BORDER = 'var(--border)';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Purchase Orders</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>{purchaseOrders.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }}>
            <option value="ALL">All statuses</option>
            {PURCHASE_ORDER_STATUSES.map(s => <option key={s} value={s}>{PURCHASE_ORDER_STATUS_LABELS[s]}</option>)}
          </select>
          <Link href="/commercial/purchasing/purchase-orders/new" style={btn('var(--purple-600)')}>+ New Purchase Order</Link>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['PO Number', 'Supplier', 'Status', 'Created', 'Delivery Date', 'Total', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={empty}>No purchase orders yet.</td></tr>}
            {filtered.map((po, i) => (
              <tr key={po.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/purchase-orders/${po.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                    {po.purchase_order_number ?? <Dim>Draft</Dim>}
                  </Link>
                </td>
                <td style={td}>{po.supplier_name_snapshot ?? <Dim>—</Dim>}</td>
                <td style={td}><PurchaseOrderStatusBadge status={po.status} /></td>
                <td style={td}>{formatCommercialDate(po.created_at)}</td>
                <td style={td}>{po.delivery_date ? formatCommercialDate(po.delivery_date) : <Dim>—</Dim>}</td>
                <td style={td}>{formatMoneyCents(po.total_cents, po.currency)}</td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/purchase-orders/${po.id}`} style={{ fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none' }}>
                    {po.status === 'DRAFT' ? 'Edit →' : 'View →'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--text-muted)' }}>{children}</span>;
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: 'var(--text-secondary)' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }; }
