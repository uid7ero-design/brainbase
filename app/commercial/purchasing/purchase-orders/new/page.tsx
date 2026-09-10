'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../../_components/SlidePanel';
import SupplierForm from '../../../_components/SupplierForm';
import { Field, lbl, sel } from '../../../_components/CustomerForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Supplier = { id: string; name: string; active: boolean };

// Phase C6.3 — mirrors app/commercial/invoices/new/page.tsx's own
// deliberate two-step flow exactly: create the DRAFT header only, then
// navigate to the detail page where lines are added (every line-mutation
// API requires a real purchaseOrderId; there is no unsaved-draft
// client-side staging model anywhere in this codebase).
export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(searchParams.get('supplierId') ?? '');
  const [supplierReference, setSupplierReference] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryAddressLine1, setDeliveryAddressLine1] = useState('');
  const [deliverySuburb, setDeliverySuburb] = useState('');
  const [deliveryState, setDeliveryState] = useState('');
  const [deliveryPostcode, setDeliveryPostcode] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadSuppliers() {
    const res = await fetch('/api/commercial/suppliers');
    if (res.ok) setSuppliers((await res.json()).suppliers.filter((s: Supplier) => s.active));
  }

  // Mirrors app/commercial/invoices/new/page.tsx's identical, pre-existing pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSuppliers(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError('Select or create a supplier first.'); return; }
    setSaving(true); setError('');
    const res = await fetch('/api/commercial/purchase-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId,
        supplierReference: supplierReference || null,
        deliveryDate: deliveryDate || null,
        deliveryAddressLine1: deliveryAddressLine1 || null,
        deliverySuburb: deliverySuburb || null,
        deliveryState: deliveryState || null,
        deliveryPostcode: deliveryPostcode || null,
        paymentTermsDays: paymentTermsDays ? Number(paymentTermsDays) : null,
        supplierNotes: supplierNotes || null,
        internalNotes: internalNotes || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create purchase order.'); setSaving(false); return; }
    router.push(`/commercial/purchasing/purchase-orders/${data.purchaseOrder.id}`);
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <Link href="/commercial/purchasing/purchase-orders" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Purchase Orders</Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '16px 0 24px' }}>New Purchase Order</h1>

      <form onSubmit={submit} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={lbl}>Supplier *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={sel}>
              <option value="">— Select a supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" onClick={() => setShowNewSupplier(true)} style={{ padding: '9px 14px', background: '#1f2937', color: '#f9fafb', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + New
            </button>
          </div>
        </div>
        <Field label="Supplier Reference" value={supplierReference} onChange={e => setSupplierReference(e.target.value)} placeholder="Your PO reference for this supplier" />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="Delivery Date" type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Payment Terms (days)</label>
            <input value={paymentTermsDays} onChange={e => setPaymentTermsDays(e.target.value)} style={sel} placeholder="e.g. 30" inputMode="numeric" />
          </div>
        </div>
        <Field label="Delivery Address" value={deliveryAddressLine1} onChange={e => setDeliveryAddressLine1(e.target.value)} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 2 }}>
            <Field label="Suburb" value={deliverySuburb} onChange={e => setDeliverySuburb(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="State" value={deliveryState} onChange={e => setDeliveryState(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Postcode" value={deliveryPostcode} onChange={e => setDeliveryPostcode(e.target.value)} />
          </div>
        </div>
        <div>
          <label style={lbl}>Notes to Supplier</label>
          <textarea value={supplierNotes} onChange={e => setSupplierNotes(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div>
          <label style={lbl}>Internal Notes</label>
          <textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Creating…' : 'Create Draft — add line items next'}
        </button>
      </form>

      <SlidePanel open={showNewSupplier} onClose={() => setShowNewSupplier(false)} title="New Supplier">
        <SupplierForm onSaved={async (s) => { setShowNewSupplier(false); await loadSuppliers(); if (s.id) setSupplierId(s.id); }} />
      </SlidePanel>
    </div>
  );
}
