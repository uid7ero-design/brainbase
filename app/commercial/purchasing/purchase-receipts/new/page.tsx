'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Field as AppField, FormActions, FormError, PageHeader, buttonProps, fieldControlClassName } from '@/components/ui/app';

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
      <PageHeader eyebrow={<Link href="/commercial/purchasing/purchase-receipts">← Purchase Receipts</Link>} title="New Purchase Receipt" />

      <form onSubmit={submit} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AppField
          label="Purchase Order"
          required
          helper={!loadingPOs && purchaseOrders.length === 0 ? 'No issued purchase orders are available to receive against yet.' : undefined}
        >
          {control => (
            <select {...control} value={purchaseOrderId} onChange={e => setPurchaseOrderId(e.target.value)} required className={fieldControlClassName}>
              <option value="">— Select an issued purchase order —</option>
              {purchaseOrders.map(po => (
                <option key={po.id} value={po.id}>
                  {po.purchase_order_number} — {po.supplier_name_snapshot ?? 'Unknown supplier'}
                </option>
              ))}
            </select>
          )}
        </AppField>
        <AppField label="Received Date">
          {control => (
            <input {...control} type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} className={fieldControlClassName} />
          )}
        </AppField>
        <AppField label="Supplier Delivery Reference">
          {control => (
            <input {...control} value={deliveryReference} onChange={e => setDeliveryReference(e.target.value)} placeholder="The supplier's own delivery note / docket number" className={fieldControlClassName} />
          )}
        </AppField>
        <AppField label="Notes">
          {control => (
            <textarea {...control} value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={fieldControlClassName} />
          )}
        </AppField>
        {error && <FormError>{error}</FormError>}
        <FormActions align="stretch">
          <button type="submit" disabled={saving} {...buttonProps('primary')}>
            {saving ? 'Creating…' : 'Create Draft — add lines next'}
          </button>
        </FormActions>
      </form>
    </div>
  );
}
