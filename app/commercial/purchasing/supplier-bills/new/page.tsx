'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Field as AppField, FormActions, FormError, PageHeader, buttonProps, fieldControlClassName } from '@/components/ui/app';

import { useDraftCreation } from '../../../_components/useDraftCreation';

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
  const draft = useDraftCreation('supplierBill');
  const { saving, error, setError } = draft;
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(true);
  const requestNumber = useRef(0);

  async function loadIssuedPurchaseOrders() {
    const request = ++requestNumber.current;
    setReading(true); setReadError(''); setPurchaseOrders([]);
    try {
      const res = await fetch('/api/commercial/purchase-orders?status=ISSUED', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = res.ok ? await res.json() : null;
      if (!Array.isArray(data?.purchaseOrders)) throw new Error();
      if (request === requestNumber.current) setPurchaseOrders(data.purchaseOrders.filter((po: PurchaseOrder) => po.status === 'ISSUED'));
    } catch { if (request === requestNumber.current) setReadError('Saved choices could not be loaded. Retry before creating a draft.'); }
    finally { if (request === requestNumber.current) { setReading(false); setLoadingPOs(false); } }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadIssuedPurchaseOrders(); const currentRequest = requestNumber; return () => { currentRequest.current++; }; }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (draft.blocked || reading || readError) return;
    if (!purchaseOrders.some(row => row.id === purchaseOrderId)) { setError('Select an issued purchase order first.'); return; }
    if (!supplierInvoiceNumber.trim()) { setError('Enter the supplier\'s own invoice number.'); return; }
    await draft.create('/api/commercial/supplier-bills', {
      purchaseOrderId, supplierInvoiceNumber, billDate: billDate || null, dueDate: dueDate || null,
    }, id => router.push(`/commercial/purchasing/supplier-bills/${id}`));
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <PageHeader eyebrow={<Link href="/commercial/purchasing/supplier-bills">← Supplier Bills</Link>} title="New Supplier Bill" />

      {readError && <p role="alert">{readError} <button type="button" disabled={reading} onClick={loadIssuedPurchaseOrders}>Retry saved choices</button></p>}
      {draft.recovery}
      <form onSubmit={submit} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AppField
          label="Purchase Order"
          required
          helper={!loadingPOs && !readError && purchaseOrders.length === 0 ? 'No issued purchase orders are available to bill against yet.' : undefined}
        >
          {control => (
            <select {...control} disabled={draft.blocked || reading || !!readError} value={purchaseOrderId} onChange={e => setPurchaseOrderId(e.target.value)} required className={fieldControlClassName}>
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
          <button type="submit" disabled={draft.blocked || reading || !!readError} {...buttonProps('primary')}>
            {saving ? 'Creating…' : 'Create Draft — add lines next'}
          </button>
        </FormActions>
      </form>
    </div>
  );
}
