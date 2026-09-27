'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Field as AppField, FormActions, FormError, PageHeader, buttonProps, fieldControlClassName } from '@/components/ui/app';

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
      <PageHeader eyebrow={<Link href="/commercial/purchasing/supplier-bills">← Supplier Bills</Link>} title="New Supplier Bill" />

      <form onSubmit={submit} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AppField
          label="Purchase Order"
          required
          helper={!loadingPOs && purchaseOrders.length === 0 ? 'No issued purchase orders are available to bill against yet.' : undefined}
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
        <AppField
          label="Supplier Invoice Number"
          required
          helper="Distinct from the internal bill number BrainBase allocates when this bill is posted. Recording the same supplier invoice number twice for this supplier is rejected."
        >
          {control => (
            <input {...control} value={supplierInvoiceNumber} onChange={e => setSupplierInvoiceNumber(e.target.value)} placeholder="The supplier's own invoice number" className={fieldControlClassName} />
          )}
        </AppField>
        <AppField label="Bill Date">
          {control => (
            <input {...control} type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className={fieldControlClassName} />
          )}
        </AppField>
        <AppField label="Due Date">
          {control => (
            <input {...control} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={fieldControlClassName} />
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
