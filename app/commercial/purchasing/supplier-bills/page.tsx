'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SupplierBillStatusBadge } from '../_billStatus';
import { SUPPLIER_BILL_STATUSES, SUPPLIER_BILL_STATUS_LABELS, type SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { formatMoneyCents } from '@/lib/commercial/money';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Supplier Bills</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{supplierBills.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13 }}>
            <option value="ALL">All statuses</option>
            {SUPPLIER_BILL_STATUSES.map(s => <option key={s} value={s}>{SUPPLIER_BILL_STATUS_LABELS[s]}</option>)}
          </select>
          <Link href="/commercial/purchasing/supplier-bills/new" style={btn('#1a6aff')}>+ New Supplier Bill</Link>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Bill Number', 'Supplier', 'Supplier Invoice #', 'Status', 'Due Date', 'Total', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={empty}>No supplier bills yet.</td></tr>}
            {filtered.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/supplier-bills/${b.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                    {b.bill_number ?? <Dim>Draft</Dim>}
                  </Link>
                </td>
                <td style={td}>{b.supplier_name_snapshot ?? <Dim>—</Dim>}</td>
                <td style={td}>{b.supplier_invoice_number}</td>
                <td style={td}><SupplierBillStatusBadge status={b.status} /></td>
                <td style={td}>{b.due_date ? formatCommercialDate(b.due_date) : <Dim>—</Dim>}</td>
                <td style={td}>{formatMoneyCents(b.total_cents, b.currency)}</td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/supplier-bills/${b.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>
                    {b.status === 'DRAFT' ? 'Edit →' : 'View →'}
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
