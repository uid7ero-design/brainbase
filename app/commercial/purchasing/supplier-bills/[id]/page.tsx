'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SupplierBillStatusBadge } from '../../_billStatus';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { formatMoneyCents } from '@/lib/commercial/money';
import type { SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/commercial/paymentMethods';
import {
  Field as AppField,
  FormError,
  PageHeader,
  StateMessage,
  TableContainer,
  TableStateRow,
  buttonProps,
  fieldControlClassName,
  tableStyles,
} from '@/components/ui/app';

type SupplierBill = {
  id: string; source_purchase_order_id: string; supplier_invoice_number: string; bill_number: string | null;
  status: SupplierBillStatus; currency: string; bill_date: string | null; due_date: string | null;
  subtotal_cents: number; tax_cents: number; total_cents: number; cancel_reason: string | null;
  created_at: string; posted_at: string | null; cancelled_at: string | null;
};
type Line = {
  id: string; source_purchase_order_line_id: string; position: number; description_snapshot: string;
  unit_snapshot: string | null; quantity: string; unit_price_cents: number;
  tax_code_snapshot: string | null; tax_rate_snapshot: string; line_total_cents: number;
};
type PurchaseOrder = { id: string; purchase_order_number: string | null; status: string; supplier_name_snapshot: string | null };
type PurchaseOrderLine = { id: string; description_snapshot: string; unit_snapshot: string | null; line_total_cents: number };
type TaxCode = { id: string; code: string; rate: string };
type AttachmentCategory = 'SUPPLIER_QUOTE' | 'SPECIFICATION' | 'SCOPE_OF_WORK' | 'APPROVAL' | 'OTHER';
const ATTACHMENT_CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  SUPPLIER_QUOTE: 'Supplier Quote', SPECIFICATION: 'Specification', SCOPE_OF_WORK: 'Scope of Work', APPROVAL: 'Approval', OTHER: 'Other',
};
type Attachment = { id: string; category: AttachmentCategory; original_filename: string; size_bytes: number; uploaded_by_name: string | null; created_at: string };
type SupplierPaymentHistoryItem = {
  id: string; amount_cents: number; allocated_amount_cents: number; currency: string; method: PaymentMethod;
  reference: string | null; paid_at: string; status: 'RECORDED' | 'REVERSED'; reversed_at: string | null; reversal_reason: string | null;
};
type SupplierBillPaymentSummary = {
  supplier_bill_id: string; total_cents: number; amount_paid_cents: number; outstanding_balance_cents: number;
  payment_state: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'; active_payment_count: number; payments: SupplierPaymentHistoryItem[];
};

const CLIENT_ROLE_ORDER = ['viewer', 'manager', 'admin', 'super_admin'];
function clientRoleGte(role: string | undefined, min: string): boolean {
  if (!role) return false;
  const i = CLIENT_ROLE_ORDER.indexOf(role);
  const m = CLIENT_ROLE_ORDER.indexOf(min);
  return i !== -1 && m !== -1 && i >= m;
}

// Phase C7.4 — supplier bill detail page. Lines are selected ONLY from
// the linked PO's own lines (source_purchase_order_line_id is required —
// see lib/commercial/supplierBills.ts's own header), and the ordered /
// previously-billed / remaining / this-draft-bill VALUE (not quantity —
// a supplier bill is a money fact) are all shown so a user can see an
// obvious over-billing before ever submitting — but the SERVER
// (postSupplierBillAtomically()) remains the sole, concurrency-safe
// authority for the actual decision; nothing here is trusted as the real
// check.
//
// UI behaviour: mutations use a NARROW, awaited refresh of this one GET
// route (which already returns bill + lines + PO + PO lines + billed
// amounts together) rather than the old Add-Line full-reload pattern
// this phase was explicitly told not to repeat.
//
// Posting/cancelling require admin (isAdmin) — a stricter floor than
// purchase receipts, per the C7.4 capability matrix; edit/delete/add-line
// require only manager (canEdit).
export default function SupplierBillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplierBill, setSupplierBill] = useState<SupplierBill | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [poLines, setPoLines] = useState<PurchaseOrderLine[]>([]);
  const [billedAmounts, setBilledAmounts] = useState<Record<string, number>>({});
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // AP-4 supplier settlement UI state. The API remains authoritative for
  // tenant, supplier, currency, bill lifecycle, balance and role checks.
  const [paymentSummary, setPaymentSummary] = useState<SupplierBillPaymentSummary | null>(null);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentPaidDate, setPaymentPaidDate] = useState('');
  const [reversingPaymentId, setReversingPaymentId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  const [confirmingPost, setConfirmingPost] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadCategory, setUploadCategory] = useState<AttachmentCategory>('SUPPLIER_QUOTE');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [newPoLineId, setNewPoLineId] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [newTaxCodeId, setNewTaxCodeId] = useState('');

  // Narrow refresh — refetches only this one GET route (bill + lines +
  // PO + PO lines + billed amounts), never re-fetches attachments/tax
  // codes/the current user's role, none of which can change from a line
  // mutation.
  const refreshBillAndLines = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/commercial/supplier-bills/${id}`);
    if (!res.ok) return false;
    const data = await res.json();
    setSupplierBill(data.supplierBill);
    setLines(data.lines);
    setPurchaseOrder(data.purchaseOrder);
    setPoLines(data.purchaseOrderLines ?? []);
    setBilledAmounts(data.billedAmounts ?? {});
    return true;
  }, [id]);

  const load = useCallback(async () => {
    const ok = await refreshBillAndLines();
    setLoading(false);
    if (!ok) return;

    const [attachmentsRes, taxCodesRes, meRes, paymentsRes] = await Promise.all([
      fetch(`/api/commercial/supplier-bills/${id}/attachments`),
      fetch('/api/commercial/tax-codes'),
      fetch('/api/me'),
      fetch(`/api/commercial/supplier-bills/${id}/payments`),
    ]);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);
    if (taxCodesRes.ok) setTaxCodes((await taxCodesRes.json()).taxCodes ?? []);
    if (paymentsRes.ok) setPaymentSummary((await paymentsRes.json()).supplier_bill_payment_summary ?? null);
    if (meRes.ok) {
      const me = await meRes.json();
      setCanEdit(clientRoleGte(me.role, 'manager'));
      setIsAdmin(clientRoleGte(me.role, 'admin'));
    }
  }, [id, refreshBillAndLines]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const isDraft = supplierBill?.status === 'DRAFT';
  const isPosted = supplierBill?.status === 'POSTED';
  const isCancelled = supplierBill?.status === 'CANCELLED';

  // Remaining VALUE available on a PO line = ordered line_total_cents -
  // (posted on OTHER bills) - (already added to THIS draft bill). Purely
  // a client-side convenience so a user sees an obvious over-billing
  // before submitting — billedAmounts from the server only ever reflects
  // OTHER POSTED bills (this one is still DRAFT), and this draft's own
  // lines are subtracted here locally.
  function remainingForPoLine(poLineId: string, excludeLineId?: string): number {
    const poLine = poLines.find(l => l.id === poLineId);
    if (!poLine) return 0;
    const billedElsewhere = billedAmounts[poLineId] ?? 0;
    const inThisDraft = lines
      .filter(l => l.source_purchase_order_line_id === poLineId && l.id !== excludeLineId)
      .reduce((sum, l) => sum + l.line_total_cents, 0);
    return poLine.line_total_cents - billedElsewhere - inThisDraft;
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!newPoLineId) { setActionError('Select a purchase order line.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}/lines`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePurchaseOrderLineId: newPoLineId,
        quantity: newQuantity,
        unitPriceCents: Math.round(parseFloat(newUnitPrice || '0') * 100),
        taxCodeId: newTaxCodeId || null,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to add line.'); return; }
    setNewPoLineId(''); setNewQuantity('1'); setNewUnitPrice(''); setNewTaxCodeId('');
    await refreshBillAndLines();
  }

  async function removeLine(lineId: string) {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}/lines/${lineId}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { const data = await res.json().catch(() => ({})); setActionError(data.error ?? 'Failed to remove line.'); return; }
    await refreshBillAndLines();
  }

  async function postAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}/post`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmingPost(false);
    if (!res.ok) setActionError(data.error ?? 'Failed to post supplier bill.');
    await refreshBillAndLines();
  }

  async function cancelAction() {
    if (!cancelReason.trim()) { setActionError('A cancel reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: cancelReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to cancel supplier bill.'); return; }
    setConfirmingCancel(false); setCancelReason('');
    await refreshBillAndLines();
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentMethod) { setActionError('A payment method is required.'); return; }
    const amountCents = Math.round(parseFloat(paymentAmount || '0') * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) { setActionError('Enter a valid payment amount.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_cents: amountCents,
        method: paymentMethod,
        reference: paymentReference || null,
        paid_at: paymentPaidDate ? new Date(paymentPaidDate).toISOString() : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to record supplier payment.'); return; }
    setPaymentSummary(data.supplier_bill_payment_summary ?? null);
    setShowRecordPayment(false);
    setPaymentAmount(''); setPaymentMethod(''); setPaymentReference(''); setPaymentPaidDate('');
  }

  async function reversePayment(paymentId: string) {
    if (!reversalReason.trim()) { setActionError('A reversal reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}/payments/${paymentId}/reverse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reversalReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to reverse supplier payment.'); return; }
    setPaymentSummary(data.supplier_bill_payment_summary ?? null);
    setReversingPaymentId(null); setReversalReason('');
  }

  async function deleteAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/supplier-bills/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to delete draft.'); return; }
    router.push('/commercial/purchasing/supplier-bills');
  }

  async function uploadAttachment(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { setUploadError('Choose a file first.'); return; }
    setUploadBusy(true); setUploadError('');
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('category', uploadCategory);
    const res = await fetch(`/api/commercial/supplier-bills/${id}/attachments`, { method: 'POST', body: formData });
    const data = await res.json();
    setUploadBusy(false);
    if (!res.ok) { setUploadError(data.error ?? 'Failed to upload file.'); return; }
    setUploadFile(null);
    const attachmentsRes = await fetch(`/api/commercial/supplier-bills/${id}/attachments`);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);
  }

  async function removeAttachment(attachmentId: string) {
    const res = await fetch(`/api/commercial/supplier-bills/${id}/attachments/${attachmentId}`, { method: 'DELETE' });
    if (res.ok) setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (loading) return <StateMessage kind="loading" title="Loading supplier bill…" size="page" />;
  if (!supplierBill) {
    return (
      <StateMessage
        kind="empty"
        size="page"
        title="Supplier bill not found."
        action={<Link href="/commercial/purchasing/supplier-bills">Back to supplier bills</Link>}
      />
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <PageHeader
        eyebrow={<Link href="/commercial/purchasing/supplier-bills">← Supplier Bills</Link>}
        title={supplierBill.bill_number ?? 'Draft Supplier Bill'}
        meta={<SupplierBillStatusBadge status={supplierBill.status} />}
        description={purchaseOrder ? (
          <>
            Against Purchase Order{' '}
            <Link href={`/commercial/purchasing/purchase-orders/${purchaseOrder.id}`} style={{ color: 'var(--brand-brainbase-accent)' }}>
              {purchaseOrder.purchase_order_number ?? purchaseOrder.id}
            </Link>
            {purchaseOrder.supplier_name_snapshot ? ` — ${purchaseOrder.supplier_name_snapshot}` : ''}
          </>
        ) : undefined}
        actions={
          <>
            {isDraft && isAdmin && lines.length > 0 && (
              <button type="button" onClick={() => setConfirmingPost(true)} disabled={busy} {...buttonProps('primary')}>Post Bill</button>
            )}
            {isDraft && canEdit && supplierBill.bill_number == null && (
              <button type="button" onClick={() => setConfirmingDelete(true)} disabled={busy} {...buttonProps('danger')}>Delete Draft</button>
            )}
            {isPosted && isAdmin && (paymentSummary?.outstanding_balance_cents ?? 0) > 0 && (
              <button type="button" onClick={() => setShowRecordPayment(true)} disabled={busy} {...buttonProps('primary')}>Record Payment</button>
            )}
            {isPosted && isAdmin && (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                disabled={busy || (paymentSummary?.active_payment_count ?? 0) > 0}
                title={(paymentSummary?.active_payment_count ?? 0) > 0 ? 'Reverse all recorded supplier payments before cancelling this bill.' : undefined}
                {...buttonProps('danger')}
              >Cancel Bill</button>
            )}
          </>
        }
      />

      {actionError && <div style={{ marginBottom: 16 }}><FormError>{actionError}</FormError></div>}

      {confirmingPost && (
        <div role="group" aria-label="Confirm post" style={{ ...panel, marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>
            Posting allocates a permanent bill number, freezes the supplier snapshot, and freezes this document — lines can no longer be edited afterward. The server will re-check that no line bills beyond its purchase order line&rsquo;s ordered value. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={postAction} disabled={busy} {...buttonProps('primary')}>Yes, Post Bill</button>
            <button type="button" onClick={() => setConfirmingPost(false)} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div role="group" aria-label="Confirm delete" style={{ ...dangerPanel, marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>Delete this draft supplier bill permanently? This cannot be undone. It has never been posted — nothing else is affected.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={deleteAction} disabled={busy} {...buttonProps('danger')}>Yes, Delete Draft</button>
            <button type="button" onClick={() => setConfirmingDelete(false)} {...buttonProps('secondary')}>Keep Draft</button>
          </div>
        </div>
      )}

      {confirmingCancel && (
        <div role="group" aria-label="Confirm cancel" style={{ ...dangerPanel, marginBottom: 20 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-primary)' }}>Cancelling this supplier bill marks it inactive and removes it from billed-to-date. This does not delete the record. Any active supplier payments must be reversed first.</p>
          <AppField label="Reason" required>
            {control => (
              <textarea {...control} value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} placeholder="Why is this supplier bill being cancelled?" className={fieldControlClassName} />
            )}
          </AppField>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={cancelAction} disabled={busy} {...buttonProps('danger')}>Confirm Cancel</button>
            <button type="button" onClick={() => setConfirmingCancel(false)} {...buttonProps('secondary')}>Keep Bill</button>
          </div>
        </div>
      )}

      <dl style={{ ...panel, margin: '0 0 20px' }}>
        <Row label="Supplier Invoice Number" value={supplierBill.supplier_invoice_number} />
        <Row label="Bill Date" value={supplierBill.bill_date ? formatCommercialDate(supplierBill.bill_date) : '—'} />
        <Row label="Due Date" value={supplierBill.due_date ? formatCommercialDate(supplierBill.due_date) : '—'} />
        {isCancelled && supplierBill.cancel_reason && <Row label="Cancellation Reason" value={supplierBill.cancel_reason} />}
      </dl>

      {paymentSummary && !isDraft && (
        <section aria-labelledby="supplier-payment-history" style={{ ...panel, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h2 id="supplier-payment-history" style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: 0 }}>Supplier Payments</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '5px 0 0' }}>Cash settlement is tracked separately from the Budget Actual recognised when this supplier bill was posted.</p>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: paymentSummary.payment_state === 'PAID' ? 'var(--status-success)' : paymentSummary.payment_state === 'PARTIALLY_PAID' ? 'var(--status-warning)' : 'var(--text-secondary)' }}>
              {paymentSummary.payment_state.replaceAll('_', ' ')}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <PaymentMetric label="Bill Total" value={formatMoneyCents(paymentSummary.total_cents, supplierBill.currency)} />
            <PaymentMetric label="Paid" value={formatMoneyCents(paymentSummary.amount_paid_cents, supplierBill.currency)} />
            <PaymentMetric label="Remaining" value={formatMoneyCents(paymentSummary.outstanding_balance_cents, supplierBill.currency)} />
          </div>
          {paymentSummary.payments.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No supplier payments recorded.</p>
          ) : (
            <TableContainer label="Supplier payment history" minWidth={760}>
              <table className={tableStyles.table}>
                <thead><tr><th scope="col">Paid Date</th><th scope="col">Method</th><th scope="col">Reference</th><th scope="col" className={tableStyles.num}>Allocated</th><th scope="col">Status</th><th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {paymentSummary.payments.map(payment => (
                    <Fragment key={payment.id}>
                      <tr>
                        <td>{formatCommercialDate(payment.paid_at)}</td>
                        <td>{payment.method.replaceAll('_', ' ')}</td>
                        <td>{payment.reference ?? '—'}</td>
                        <td className={tableStyles.num}>{formatMoneyCents(payment.allocated_amount_cents, supplierBill.currency)}</td>
                        <td>{payment.status === 'RECORDED' ? <span style={{ color: 'var(--status-success)' }}>Recorded</span> : <span style={{ color: 'var(--status-danger)' }}>Reversed{payment.reversal_reason ? `: ${payment.reversal_reason}` : ''}</span>}</td>
                        <td className={tableStyles.actions}>{payment.status === 'RECORDED' && isAdmin && reversingPaymentId !== payment.id && (<button type="button" onClick={() => { setReversingPaymentId(payment.id); setReversalReason(''); setActionError(''); }} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }}>Reverse Payment</button>)}</td>
                      </tr>
                      {reversingPaymentId === payment.id && (
                        <tr><td colSpan={6} style={{ background: 'var(--status-danger-muted)' }}>
                          <p>This reverses the entire supplier payment of {formatMoneyCents(payment.amount_cents, payment.currency)}, including allocations to any other bills. This bill was allocated {formatMoneyCents(payment.allocated_amount_cents, supplierBill.currency)}.</p>
                          <AppField label="Reversal Reason" required>{control => <textarea {...control} value={reversalReason} onChange={e => setReversalReason(e.target.value)} rows={2} className={fieldControlClassName} placeholder="Why is this supplier payment being reversed?" />}</AppField>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            <button type="button" onClick={() => reversePayment(payment.id)} disabled={busy || !reversalReason.trim()} {...buttonProps('danger', 'sm')}>Confirm Reversal</button>
                            <button type="button" onClick={() => { setReversingPaymentId(null); setReversalReason(''); }} disabled={busy} {...buttonProps('secondary', 'sm')}>Cancel</button>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </TableContainer>
          )}
        </section>
      )}

      {showRecordPayment && isPosted && isAdmin && paymentSummary && (
        <section aria-labelledby="record-supplier-payment" style={{ ...panel, marginBottom: 20 }}>
          <h2 id="record-supplier-payment" style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: '0 0 14px' }}>Record Supplier Payment</h2>
          <form onSubmit={recordPayment} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
            <AppField label="Amount" required>{control => <input {...control} value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className={fieldControlClassName} placeholder={(paymentSummary.outstanding_balance_cents / 100).toFixed(2)} inputMode="decimal" />}</AppField>
            <AppField label="Payment Method" required>{control => (<select {...control} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className={fieldControlClassName}><option value="">— Select —</option>{PAYMENT_METHODS.map(method => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select>)}</AppField>
            <AppField label="Reference">{control => <input {...control} value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className={fieldControlClassName} placeholder="Bank reference or remittance" />}</AppField>
            <AppField label="Paid Date">{control => <input {...control} type="date" value={paymentPaidDate} onChange={e => setPaymentPaidDate(e.target.value)} className={fieldControlClassName} />}</AppField>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="submit" disabled={busy} {...buttonProps('primary')}>Record Payment</button><button type="button" onClick={() => { setShowRecordPayment(false); setPaymentAmount(''); setPaymentMethod(''); setPaymentReference(''); setPaymentPaidDate(''); }} disabled={busy} {...buttonProps('secondary')}>Cancel</button></div>
          </form>
        </section>
      )}

      <div style={{ marginBottom: 20 }}>
        <TableContainer label="Bill lines" minWidth={860}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className={tableStyles.num}>Ordered Value</th>
                <th scope="col" className={tableStyles.num}>Previously Billed</th>
                <th scope="col" className={tableStyles.num}>Remaining</th>
                <th scope="col" className={tableStyles.num}>Qty</th>
                <th scope="col" className={tableStyles.num}>Unit Price</th>
                <th scope="col">Tax</th>
                <th scope="col" className={tableStyles.num}>Line Total</th>
                <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <TableStateRow colSpan={9} kind="empty">No line items yet.</TableStateRow>}
              {lines.map(line => {
                const poLine = poLines.find(l => l.id === line.source_purchase_order_line_id);
                const remaining = remainingForPoLine(line.source_purchase_order_line_id, line.id);
                return (
                  <tr key={line.id}>
                    <td style={{ color: 'var(--text-primary)' }}>{line.description_snapshot}</td>
                    <td className={tableStyles.num}>{poLine ? formatMoneyCents(poLine.line_total_cents, supplierBill.currency) : '—'}</td>
                    <td className={tableStyles.num}>{formatMoneyCents(billedAmounts[line.source_purchase_order_line_id] ?? 0, supplierBill.currency)}</td>
                    <td className={tableStyles.num} style={remaining < 0 ? { color: 'var(--status-danger)', fontWeight: 600 } : undefined}>{formatMoneyCents(remaining, supplierBill.currency)}</td>
                    <td className={tableStyles.num}>{line.quantity}</td>
                    <td className={tableStyles.num}>{formatMoneyCents(line.unit_price_cents, supplierBill.currency)}</td>
                    <td>{line.tax_code_snapshot ?? '—'}</td>
                    <td className={tableStyles.num}>{formatMoneyCents(line.line_total_cents, supplierBill.currency)}</td>
                    <td className={tableStyles.actions}>
                      {isDraft && canEdit && (
                        <button type="button" onClick={() => removeLine(line.id)} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }} aria-label={`Remove line ${line.description_snapshot}`}>Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot style={{ borderTop: '1px solid var(--border)' }}>
                <tr>
                  <td colSpan={7} className={tableStyles.num} style={{ fontWeight: 600 }}>Subtotal</td>
                  <td className={tableStyles.num} style={{ fontWeight: 600 }}>{formatMoneyCents(supplierBill.subtotal_cents, supplierBill.currency)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={7} className={tableStyles.num} style={{ fontWeight: 600 }}>Tax</td>
                  <td className={tableStyles.num} style={{ fontWeight: 600 }}>{formatMoneyCents(supplierBill.tax_cents, supplierBill.currency)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={7} className={tableStyles.num} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total</td>
                  <td className={tableStyles.num} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoneyCents(supplierBill.total_cents, supplierBill.currency)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </TableContainer>

        {isDraft && canEdit && (
          <form onSubmit={addLine} aria-label="Add bill line" style={{ ...panel, padding: 16, marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 220px' }}>
              <AppField label="Purchase Order Line">
                {control => (
                  <select value={newPoLineId} onChange={e => setNewPoLineId(e.target.value)} {...control} className={fieldControlClassName}>
                    <option value="">— Select a purchase order line —</option>
                    {poLines.map(pl => {
                      const remaining = remainingForPoLine(pl.id);
                      return (
                        <option key={pl.id} value={pl.id}>
                          {pl.description_snapshot} (remaining: {formatMoneyCents(remaining, supplierBill.currency)})
                        </option>
                      );
                    })}
                  </select>
                )}
              </AppField>
            </div>
            <div style={{ flex: '0 1 90px' }}>
              <AppField label="Quantity">
                {control => <input {...control} type="number" min="0.0001" step="0.0001" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} className={fieldControlClassName} inputMode="decimal" />}
              </AppField>
            </div>
            <div style={{ flex: '0 1 120px' }}>
              <AppField label="Unit Price">
                {control => <input {...control} value={newUnitPrice} onChange={e => setNewUnitPrice(e.target.value)} className={fieldControlClassName} placeholder="0.00" inputMode="decimal" />}
              </AppField>
            </div>
            <div style={{ flex: '0 1 140px' }}>
              <AppField label="Tax Code">
                {control => (
                  <select {...control} value={newTaxCodeId} onChange={e => setNewTaxCodeId(e.target.value)} className={fieldControlClassName}>
                    <option value="">— None —</option>
                    {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
                  </select>
                )}
              </AppField>
            </div>
            <button type="submit" disabled={busy} {...buttonProps('primary')}>Add Line</button>
          </form>
        )}
      </div>

      <section aria-labelledby="bill-supporting-documents" style={panel}>
        <h2 id="bill-supporting-documents" style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: '0 0 12px' }}>Supporting Documents</h2>
        {attachments.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>No supporting documents yet.</p>}
        {attachments.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0 }}>
              <a href={`/api/commercial/supplier-bills/${id}/attachments/${a.id}`} style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{a.original_filename}</a>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                {ATTACHMENT_CATEGORY_LABELS[a.category]} · {formatBytes(a.size_bytes)} · {a.uploaded_by_name ?? 'Unknown'} · {formatCommercialDate(a.created_at)}
              </div>
            </div>
            {isDraft && canEdit && (
              <button type="button" onClick={() => removeAttachment(a.id)} className={tableStyles.link} style={{ color: 'var(--status-danger)' }} aria-label={`Remove ${a.original_filename}`}>Remove</button>
            )}
          </div>
        ))}

        {isDraft && canEdit && (
          <form onSubmit={uploadAttachment} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
            <AppField label="Category">
              {control => (
                <select {...control} value={uploadCategory} onChange={e => setUploadCategory(e.target.value as AttachmentCategory)} className={fieldControlClassName}>
                  {(Object.keys(ATTACHMENT_CATEGORY_LABELS) as AttachmentCategory[]).map(c => <option key={c} value={c}>{ATTACHMENT_CATEGORY_LABELS[c]}</option>)}
                </select>
              )}
            </AppField>
            <AppField label="File">
              {control => <input {...control} type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, color: 'var(--text-secondary)' }} />}
            </AppField>
            <button type="submit" disabled={uploadBusy} {...buttonProps('secondary')}>{uploadBusy ? 'Uploading…' : '+ Attach Document'}</button>
          </form>
        )}
        {uploadError && <div style={{ marginTop: 8 }}><FormError>{uploadError}</FormError></div>}
      </section>
    </div>
  );
}

function PaymentMetric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <dt style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  );
}

const panel: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 };
const dangerPanel: React.CSSProperties = { background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', borderRadius: 'var(--radius-lg)', padding: 20 };
