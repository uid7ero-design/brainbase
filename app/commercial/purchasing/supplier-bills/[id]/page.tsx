'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SupplierBillStatusBadge } from '../../_billStatus';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { formatMoneyCents } from '@/lib/commercial/money';
import type { SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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

    const [attachmentsRes, taxCodesRes, meRes] = await Promise.all([
      fetch(`/api/commercial/supplier-bills/${id}/attachments`),
      fetch('/api/commercial/tax-codes'),
      fetch('/api/me'),
    ]);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);
    if (taxCodesRes.ok) setTaxCodes((await taxCodesRes.json()).taxCodes ?? []);
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

  if (loading) return <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>;
  if (!supplierBill) return <div style={{ color: '#6b7280', fontSize: 14 }}>Supplier bill not found.</div>;

  return (
    <div style={{ maxWidth: 960 }}>
      <Link href="/commercial/purchasing/supplier-bills" style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none' }}>← Supplier Bills</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            {supplierBill.bill_number ?? 'Draft Supplier Bill'}
          </h1>
          <SupplierBillStatusBadge status={supplierBill.status} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isDraft && isAdmin && lines.length > 0 && (
            <button onClick={() => setConfirmingPost(true)} disabled={busy} style={actionBtn('#1a6aff')}>Post Bill</button>
          )}
          {isDraft && canEdit && supplierBill.bill_number == null && (
            <button onClick={() => setConfirmingDelete(true)} disabled={busy} style={actionBtn('#7f1d1d')}>Delete Draft</button>
          )}
          {isPosted && isAdmin && (
            <button onClick={() => setConfirmingCancel(true)} disabled={busy} style={actionBtn('#7f1d1d')}>Cancel Bill</button>
          )}
        </div>
      </div>

      {purchaseOrder && (
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>
          Against Purchase Order{' '}
          <Link href={`/commercial/purchasing/purchase-orders/${purchaseOrder.id}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>
            {purchaseOrder.purchase_order_number ?? purchaseOrder.id}
          </Link>
          {purchaseOrder.supplier_name_snapshot ? ` — ${purchaseOrder.supplier_name_snapshot}` : ''}
        </p>
      )}

      {actionError && <div style={{ ...panel, borderColor: '#7f1d1d', color: '#f87171', marginBottom: 16 }}>{actionError}</div>}

      {confirmingPost && (
        <div style={{ ...panel, borderColor: '#1a6aff', marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13 }}>
            Posting allocates a permanent bill number, freezes the supplier snapshot, and freezes this document — lines can no longer be edited afterward. The server will re-check that no line bills beyond its purchase order line&rsquo;s ordered value. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={postAction} disabled={busy} style={actionBtn('#1a6aff')}>Yes, Post Bill</button>
            <button onClick={() => setConfirmingPost(false)} style={actionBtn('#1a1d24')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div style={{ ...panel, borderColor: '#7f1d1d', marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13 }}>Delete this draft supplier bill permanently? This cannot be undone. It has never been posted — nothing else is affected.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={deleteAction} disabled={busy} style={actionBtn('#dc2626')}>Yes, Delete Draft</button>
            <button onClick={() => setConfirmingDelete(false)} style={actionBtn('#1a1d24')}>Keep Draft</button>
          </div>
        </div>
      )}

      {confirmingCancel && (
        <div style={{ ...panel, borderColor: '#7f1d1d', marginBottom: 20 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13 }}>Cancelling this supplier bill marks it inactive and removes it from billed-to-date. This does not delete the record. No supplier payments exist yet, so there is nothing further to reverse.</p>
          <label style={lbl}>Reason (required)</label>
          <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} placeholder="Why is this supplier bill being cancelled?" style={{ ...sel, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelAction} disabled={busy} style={actionBtn('#dc2626')}>Confirm Cancel</button>
            <button onClick={() => setConfirmingCancel(false)} style={actionBtn('#1a1d24')}>Keep Bill</button>
          </div>
        </div>
      )}

      <div style={{ ...panel, marginBottom: 20 }}>
        <Row label="Supplier Invoice Number" value={supplierBill.supplier_invoice_number} />
        <Row label="Bill Date" value={supplierBill.bill_date ? formatCommercialDate(supplierBill.bill_date) : '—'} />
        <Row label="Due Date" value={supplierBill.due_date ? formatCommercialDate(supplierBill.due_date) : '—'} />
        {isCancelled && supplierBill.cancel_reason && <Row label="Cancellation Reason" value={supplierBill.cancel_reason} />}
      </div>

      <div style={{ ...panel, marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Description', 'Ordered Value', 'Previously Billed', 'Remaining', 'Qty', 'Unit Price', 'Tax', 'Line Total', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={9} style={empty}>No line items yet.</td></tr>}
            {lines.map(line => {
              const poLine = poLines.find(l => l.id === line.source_purchase_order_line_id);
              const remaining = remainingForPoLine(line.source_purchase_order_line_id, line.id);
              return (
                <tr key={line.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={td}>{line.description_snapshot}</td>
                  <td style={td}>{poLine ? formatMoneyCents(poLine.line_total_cents, supplierBill.currency) : '—'}</td>
                  <td style={td}>{formatMoneyCents(billedAmounts[line.source_purchase_order_line_id] ?? 0, supplierBill.currency)}</td>
                  <td style={{ ...td, color: remaining < 0 ? '#f87171' : '#9ca3af' }}>{formatMoneyCents(remaining, supplierBill.currency)}</td>
                  <td style={td}>{line.quantity}</td>
                  <td style={td}>{formatMoneyCents(line.unit_price_cents, supplierBill.currency)}</td>
                  <td style={td}>{line.tax_code_snapshot ?? '—'}</td>
                  <td style={td}>{formatMoneyCents(line.line_total_cents, supplierBill.currency)}</td>
                  <td style={td}>
                    {isDraft && canEdit && (
                      <button onClick={() => removeLine(line.id)} disabled={busy} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'right', fontWeight: 600 }}>Subtotal</td>
                <td style={{ ...td, fontWeight: 600 }} colSpan={2}>{formatMoneyCents(supplierBill.subtotal_cents, supplierBill.currency)}</td>
              </tr>
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'right', fontWeight: 600 }}>Tax</td>
                <td style={{ ...td, fontWeight: 600 }} colSpan={2}>{formatMoneyCents(supplierBill.tax_cents, supplierBill.currency)}</td>
              </tr>
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#f9fafb' }}>Total</td>
                <td style={{ ...td, fontWeight: 700, color: '#f9fafb' }} colSpan={2}>{formatMoneyCents(supplierBill.total_cents, supplierBill.currency)}</td>
              </tr>
            </tfoot>
          )}
        </table>

        {isDraft && canEdit && (
          <form onSubmit={addLine} style={{ padding: '16px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 220px' }}>
              <label style={lbl}>Purchase Order Line</label>
              <select value={newPoLineId} onChange={e => setNewPoLineId(e.target.value)} style={sel}>
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
            </div>
            <div style={{ flex: '0 1 90px' }}>
              <label style={lbl}>Quantity</label>
              <input type="number" min="0.0001" step="0.0001" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} style={sel} inputMode="decimal" />
            </div>
            <div style={{ flex: '0 1 120px' }}>
              <label style={lbl}>Unit Price</label>
              <input value={newUnitPrice} onChange={e => setNewUnitPrice(e.target.value)} style={sel} placeholder="0.00" inputMode="decimal" />
            </div>
            <div style={{ flex: '0 1 140px' }}>
              <label style={lbl}>Tax Code</label>
              <select value={newTaxCodeId} onChange={e => setNewTaxCodeId(e.target.value)} style={sel}>
                <option value="">— None —</option>
                {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
              </select>
            </div>
            <button type="submit" disabled={busy} style={actionBtn('#1a6aff')}>Add Line</button>
          </form>
        )}
      </div>

      <div style={panel}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>Supporting Documents</h2>
        {attachments.length === 0 && <p style={{ fontSize: 13, color: '#4b5563', margin: '0 0 12px' }}>No supporting documents yet.</p>}
        {attachments.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <a href={`/api/commercial/supplier-bills/${id}/attachments/${a.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>{a.original_filename}</a>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                {ATTACHMENT_CATEGORY_LABELS[a.category]} · {formatBytes(a.size_bytes)} · {a.uploaded_by_name ?? 'Unknown'} · {formatCommercialDate(a.created_at)}
              </div>
            </div>
            {isDraft && canEdit && (
              <button onClick={() => removeAttachment(a.id)} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>Remove</button>
            )}
          </div>
        ))}

        {isDraft && canEdit && (
          <form onSubmit={uploadAttachment} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
            <div>
              <label style={lbl}>Category</label>
              <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value as AttachmentCategory)} style={sel}>
                {(Object.keys(ATTACHMENT_CATEGORY_LABELS) as AttachmentCategory[]).map(c => <option key={c} value={c}>{ATTACHMENT_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>File</label>
              <input type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, color: '#9ca3af' }} />
            </div>
            <button type="submit" disabled={uploadBusy} style={actionBtn('#1a6aff')}>{uploadBusy ? 'Uploading…' : '+ Attach Document'}</button>
          </form>
        )}
        {uploadError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{uploadError}</div>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#f9fafb' }}>{value}</div>
    </div>
  );
}

const panel: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 };
const th: React.CSSProperties = { padding: '8px 8px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '10px 8px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '20px 8px', textAlign: 'center', color: '#4b5563', fontSize: 13 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
const sel: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#07080B', border: `1px solid ${BORDER}`, borderRadius: 7, color: '#f9fafb', fontSize: 13, boxSizing: 'border-box' };
function actionBtn(bg: string): React.CSSProperties { return { padding: '8px 14px', background: bg, color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }; }
