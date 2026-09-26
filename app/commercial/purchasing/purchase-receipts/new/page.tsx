'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const CARD = 'var(--bg-surface)'; const BORDER = 'var(--border)';

type PurchaseOrder = { id: string; purchase_order_number: string | null; status: string; supplier_name_snapshot: string | null };

// Phase C7.3 — create-from-PO flow. C7.3 is strictly PO-backed (every
// purchase receipt must belong to one purchase order — see
// lib/commercial/purchaseReceipts.ts's own header), so this page's only
// real job is picking WHICH issued PO the new draft receipt belongs to,
// then creating the DRAFT header and navigating to the detail page where
// lines are added — the same deliberate two-step flow
// app/commercial/purchasing/purchase-orders/new/page.tsx already
// established (every line-mutation API requires a real
// purchaseReceiptId; there is no unsaved-draft client-side staging model
// anywhere in this codebase).
//
// Only ISSUED purchase orders are offered — createPurchaseReceipt()
// itself rejects any other status server-side (this is UX convenience
// only, never the real authorization boundary).
export default function NewPurchaseReceiptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState(searchParams.get('purchaseOrderId') ?? '');
  const [receivedDate, setReceivedDate] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [notes, setNotes] = useState('');
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
    setSaving(true); setError('');
    const res = await fetch('/api/commercial/purchase-receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchaseOrderId,
        receivedDate: receivedDate || null,
        deliveryReference: deliveryReference || null,
        notes: notes || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create purchase receipt.'); setSaving(false); return; }
    router.push(`/commercial/purchasing/purchase-receipts/${data.purchaseReceipt.id}`);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Link href="/commercial/purchasing/purchase-receipts" style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>← Purchase Receipts</Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '8px 0 20px' }}>New Purchase Receipt</h1>

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
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>No issued purchase orders are available to receive against yet.</p>
          )}
        </div>

        <div>
          <label style={lbl}>Received Date</label>
          <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} style={sel} />
        </div>

        <div>
          <label style={lbl}>Supplier Delivery Reference</label>
          <input value={deliveryReference} onChange={e => setDeliveryReference(e.target.value)} placeholder="The supplier's own delivery note / docket number" style={sel} />
        </div>

        <div>
          <label style={lbl}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...sel, resize: 'vertical' }} />
        </div>

        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}

        <button type="submit" disabled={saving} style={{ padding: '10px 16px', background: 'var(--purple-600)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Creating…' : 'Create Draft — add lines next'}
        </button>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'var(--bg-base)', border: `1px solid ${BORDER}`, borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' };
