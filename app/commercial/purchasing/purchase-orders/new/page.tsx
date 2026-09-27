'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../../_components/SlidePanel';
import SupplierForm from '../../../_components/SupplierForm';
import { Field } from '../../../_components/CustomerForm';
import { Field as AppField, FormActions, FormError, PageHeader, buttonProps, fieldControlClassName } from '@/components/ui/app';

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
      <PageHeader eyebrow={<Link href="/commercial/purchasing/purchase-orders">← Purchase Orders</Link>} title="New Purchase Order" />

      <form onSubmit={submit} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AppField label="Supplier" required>
          {control => (
            <div style={{ display: 'flex', gap: 8 }}>
              <select {...control} value={supplierId} onChange={e => setSupplierId(e.target.value)} className={fieldControlClassName}>
                <option value="">— Select a supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewSupplier(true)} {...buttonProps('secondary')} aria-label="Create a new supplier" style={{ whiteSpace: 'nowrap' }}>
                + New
              </button>
            </div>
          )}
        </AppField>
        <Field label="Supplier Reference" value={supplierReference} onChange={e => setSupplierReference(e.target.value)} placeholder="Your PO reference for this supplier" />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="Delivery Date" type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <AppField label="Payment Terms (days)">
              {control => (
                <input {...control} value={paymentTermsDays} onChange={e => setPaymentTermsDays(e.target.value)} className={fieldControlClassName} placeholder="e.g. 30" inputMode="numeric" />
              )}
            </AppField>
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
        <AppField label="Notes to Supplier">
          {control => (
            <textarea {...control} value={supplierNotes} onChange={e => setSupplierNotes(e.target.value)} rows={2} className={fieldControlClassName} />
          )}
        </AppField>
        <AppField label="Internal Notes">
          {control => (
            <textarea {...control} value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} className={fieldControlClassName} />
          )}
        </AppField>
        {error && <FormError>{error}</FormError>}
        <FormActions align="stretch">
          <button type="submit" disabled={saving} {...buttonProps('primary')}>
            {saving ? 'Creating…' : 'Create Draft — add line items next'}
          </button>
        </FormActions>
      </form>

      <SlidePanel open={showNewSupplier} onClose={() => setShowNewSupplier(false)} title="New Supplier">
        <SupplierForm onSaved={async (s) => { setShowNewSupplier(false); await loadSuppliers(); if (s.id) setSupplierId(s.id); }} />
      </SlidePanel>
    </div>
  );
}
