'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type PurchaseOrder = { id: string; purchase_order_number: string | null; status: string; supplier_name_snapshot: string | null };

// Phase C7.4 — create-from-PO flow, mirroring app/commercial/purchasing/
// purchase-receipts/new/page.tsx's own two-step pattern exactly (create
// the DRAFT header, then add lines on the detail page — there is no
// unsaved-draft client-side staging model anywhere in this codebase).
// Only ISSUED purchase orders are offered — createSupplierBill() itself
// rejects any other status server-side (UX convenience only).
export default function NewSupplierBillPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState(searchParams.get('purchaseOrderId') ?? '');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [billDate, setBillDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loadingPOs, setLoadingPOs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadIssuedPurchaseOrders() {
    const res = await fetch('/api/commercial/purchase-orders?status=ISSUED');
    if (res.ok) setPurchaseOrders((await res.json()).purchaseOrders ?? []);
    setLoadingPOs(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadIssuedPurchaseOrders(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!purchaseOrderId) { setError('Select an issued purchase order first.'); return; }
    if (!supplierInvoiceNumber.trim()) { setError('Enter the supplier\'s own invoice number.'); return; }
    setSaving(true); setError('');
    const res = await fetch('/api/commercial/supplier-bills', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchaseOrderId,
        supplierInvoiceNumber,
        billDate: billDate || null,
        dueDate: dueDate || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create supplier bill.'); setSaving(false); return; }
    router.push(`/commercial/purchasing/supplier-bills/${data.supplierBill.id}`);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Link href="/commercial/purchasing/supplier-bills" style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none' }}>← Supplier Bills</Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '8px 0 20px' }}>New Supplier Bill</h1>

      <form onSubmit={submit} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={lbl}>Purchase Order *</label>
          <select value={purchaseOrderId} onChange={e => setPurchaseOrderId(e.target.value)} required style={sel}>
            <option value="">— Select an issued purchase order —</option>
            {purchaseOrders.map(po => (
              <option key={po.id} value={po.id}>
                {po.purchase_order_number} — {po.supplier_name_snapshot ?? 'Unknown supplier'}
              </option>
            ))}
          </select>
          {!loadingPOs && purchaseOrders.length === 0 && (
            <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0' }}>No issued purchase orders are available to bill against yet.</p>
          )}
        </div>

        <div>
          <label style={lbl}>Supplier Invoice Number *</label>
          <input value={supplierInvoiceNumber} onChange={e => setSupplierInvoiceNumber(e.target.value)} placeholder="The supplier's own invoice number" style={sel} />
          <p style={{ fontSize: 11, color: '#6b7280', margin: '6px 0 0' }}>Distinct from the internal bill number BrainBase allocates when this bill is posted. Recording the same supplier invoice number twice for this supplier is rejected.</p>
        </div>

        <div>
          <label style={lbl}>Bill Date</label>
          <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} style={sel} />
        </div>

        <div>
          <label style={lbl}>Due Date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={sel} />
        </div>

        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}

        <button type="submit" disabled={saving} style={{ padding: '10px 16px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Creating…' : 'Create Draft — add lines next'}
        </button>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#07080B', border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 14, boxSizing: 'border-box' };
