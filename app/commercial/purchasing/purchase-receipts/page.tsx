'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PurchaseReceiptStatusBadge } from '../_receiptStatus';
import { PURCHASE_RECEIPT_STATUSES, PURCHASE_RECEIPT_STATUS_LABELS, type PurchaseReceiptStatus } from '@/lib/commercial/purchaseReceiptLifecycle';
import { formatCommercialDate } from '@/lib/commercial/dates';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Purchase Receipts</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{purchaseReceipts.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13 }}>
            <option value="ALL">All statuses</option>
            {PURCHASE_RECEIPT_STATUSES.map(s => <option key={s} value={s}>{PURCHASE_RECEIPT_STATUS_LABELS[s]}</option>)}
          </select>
          <Link href="/commercial/purchasing/purchase-receipts/new" style={btn('#1a6aff')}>+ New Purchase Receipt</Link>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Receipt Number', 'Status', 'Received Date', 'Delivery Reference', 'Created', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={empty}>No purchase receipts yet.</td></tr>}
            {filtered.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/purchase-receipts/${r.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                    {r.receipt_number ?? <Dim>Draft</Dim>}
                  </Link>
                </td>
                <td style={td}><PurchaseReceiptStatusBadge status={r.status} /></td>
                <td style={td}>{r.received_date ? formatCommercialDate(r.received_date) : <Dim>—</Dim>}</td>
                <td style={td}>{r.delivery_reference ?? <Dim>—</Dim>}</td>
                <td style={td}>{formatCommercialDate(r.created_at)}</td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/purchase-receipts/${r.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>
                    {r.status === 'DRAFT' ? 'Edit →' : 'View →'}
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
  return <span style={{ color: '#4b5563' }}>{children}</span>;
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }; }
