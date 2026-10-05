'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PurchaseReceiptStatusBadge } from '../../_receiptStatus';
import { formatCommercialDate } from '@/lib/commercial/dates';
import type { PurchaseReceiptStatus } from '@/lib/commercial/purchaseReceiptLifecycle';
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

type PurchaseReceipt = {
  id: string; purchase_order_id: string; receipt_number: string | null; status: PurchaseReceiptStatus;
  received_date: string | null; delivery_reference: string | null; notes: string | null; cancel_reason: string | null;
  created_at: string; posted_at: string | null; cancelled_at: string | null;
};
type Line = { id: string; source_purchase_order_line_id: string; position: number; description_snapshot: string; unit_snapshot: string | null; quantity_received: string };
type PurchaseOrder = { id: string; purchase_order_number: string | null; status: string; supplier_name_snapshot: string | null };
type PurchaseOrderLine = { id: string; description_snapshot: string; unit_snapshot: string | null; quantity: number };
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

// Phase C7.3 — purchase receipt detail page. Lines are selected ONLY
// from the linked PO's own lines (source_purchase_order_line_id is
// required — see lib/commercial/purchaseReceipts.ts's own header), and
// the ordered / previously-received / remaining / this-draft's-own
// quantity are all shown so a user can see an obvious over-receipt
// before ever submitting — but the SERVER (postPurchaseReceiptAtomically())
// remains the sole, concurrency-safe authority for the actual decision;
// nothing here is trusted as the real check.
//
// UI behaviour: mutations use a NARROW, awaited refresh of this one GET
// route (which already returns receipt + lines + PO + PO lines +
// received quantities together) rather than the old Add-Line
// full-reload pattern this phase was explicitly told not to repeat.
export default function PurchaseReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [poLines, setPoLines] = useState<PurchaseOrderLine[]>([]);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
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
  const [newQuantity, setNewQuantity] = useState('');

  // Narrow refresh — refetches only this one GET route (receipt + lines +
  // PO + PO lines + received quantities), never re-fetches attachments/
  // the current user's role, which cannot change from a line mutation.
  const refreshReceiptAndLines = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/commercial/purchase-receipts/${id}`);
    if (!res.ok) return false;
    const data = await res.json();
    setReceipt(data.purchaseReceipt);
    setLines(data.lines);
    setPurchaseOrder(data.purchaseOrder);
    setPoLines(data.purchaseOrderLines ?? []);
    setReceivedQuantities(data.receivedQuantities ?? {});
    return true;
  }, [id]);

  const load = useCallback(async () => {
    const ok = await refreshReceiptAndLines();
    setLoading(false);
    if (!ok) return;

    const attachmentsRes = await fetch(`/api/commercial/purchase-receipts/${id}/attachments`);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);

    const meRes = await fetch('/api/me');
    if (meRes.ok) {
      const me = await meRes.json();
      setCanEdit(clientRoleGte(me.role, 'manager'));
      setIsAdmin(clientRoleGte(me.role, 'admin'));
    }
  }, [id, refreshReceiptAndLines]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const isDraft = receipt?.status === 'DRAFT';
  const isPosted = receipt?.status === 'POSTED';
  const isCancelled = receipt?.status === 'CANCELLED';

  // Remaining quantity available on a PO line = ordered - (posted on
  // OTHER receipts) - (already added to THIS draft receipt). Purely a
  // client-side convenience so a user sees an obvious over-receipt
  // before submitting — receivedQuantities from the server only ever
  // reflects OTHER POSTED receipts (this one is still DRAFT, so it is
  // never included there), and this draft's own lines are subtracted
  // here locally.
  function remainingForPoLine(poLineId: string, excludeReceiptLineId?: string): number {
    const poLine = poLines.find(l => l.id === poLineId);
    if (!poLine) return 0;
    const postedElsewhere = receivedQuantities[poLineId] ?? 0;
    const inThisDraft = lines
      .filter(l => l.source_purchase_order_line_id === poLineId && l.id !== excludeReceiptLineId)
      .reduce((sum, l) => sum + Number(l.quantity_received), 0);
    return poLine.quantity - postedElsewhere - inThisDraft;
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!newPoLineId) { setActionError('Select a purchase order line.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-receipts/${id}/lines`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePurchaseOrderLineId: newPoLineId, quantityReceived: Number(newQuantity) }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to add line.'); return; }
    setNewPoLineId(''); setNewQuantity('');
    await refreshReceiptAndLines();
  }

  async function removeLine(lineId: string) {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-receipts/${id}/lines/${lineId}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { const data = await res.json().catch(() => ({})); setActionError(data.error ?? 'Failed to remove line.'); return; }
    await refreshReceiptAndLines();
  }

  async function postAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-receipts/${id}/post`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmingPost(false);
    if (!res.ok) setActionError(data.error ?? 'Failed to post purchase receipt.');
    await refreshReceiptAndLines();
  }

  async function cancelAction() {
    if (!cancelReason.trim()) { setActionError('A cancel reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-receipts/${id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: cancelReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to cancel purchase receipt.'); return; }
    setConfirmingCancel(false); setCancelReason('');
    await refreshReceiptAndLines();
  }

  async function deleteAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-receipts/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to delete draft.'); return; }
    router.push('/commercial/purchasing/purchase-receipts');
  }

  async function uploadAttachment(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { setUploadError('Choose a file first.'); return; }
    setUploadBusy(true); setUploadError('');
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('category', uploadCategory);
    const res = await fetch(`/api/commercial/purchase-receipts/${id}/attachments`, { method: 'POST', body: formData });
    const data = await res.json();
    setUploadBusy(false);
    if (!res.ok) { setUploadError(data.error ?? 'Failed to upload file.'); return; }
    setUploadFile(null);
    const attachmentsRes = await fetch(`/api/commercial/purchase-receipts/${id}/attachments`);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);
  }

  async function removeAttachment(attachmentId: string) {
    const res = await fetch(`/api/commercial/purchase-receipts/${id}/attachments/${attachmentId}`, { method: 'DELETE' });
    if (res.ok) setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (loading) return <StateMessage kind="loading" title="Loading purchase receipt…" size="page" />;
  if (!receipt) {
    return (
      <StateMessage
        kind="empty"
        size="page"
        title="Purchase receipt not found."
        action={<Link href="/commercial/purchasing/purchase-receipts">Back to purchase receipts</Link>}
      />
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow={<Link href="/commercial/purchasing/purchase-receipts">← Purchase Receipts</Link>}
        title={receipt.receipt_number ?? 'Draft Purchase Receipt'}
        meta={<PurchaseReceiptStatusBadge status={receipt.status} />}
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
            {isDraft && canEdit && lines.length > 0 && (
              <button type="button" onClick={() => setConfirmingPost(true)} disabled={busy} {...buttonProps('primary')}>Post Receipt</button>
            )}
            {isDraft && canEdit && receipt.receipt_number == null && (
              <button type="button" onClick={() => setConfirmingDelete(true)} disabled={busy} {...buttonProps('danger')}>Delete Draft</button>
            )}
            {isPosted && isAdmin && (
              <button type="button" onClick={() => setConfirmingCancel(true)} disabled={busy} {...buttonProps('danger')}>Cancel Receipt</button>
            )}
          </>
        }
      />

      {actionError && <div style={{ marginBottom: 16 }}><FormError>{actionError}</FormError></div>}

      {confirmingPost && (
        <div role="group" aria-label="Confirm post" style={{ ...panel, marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>
            Posting allocates a permanent receipt number and freezes this document — lines can no longer be edited afterward. The server will re-check that no line exceeds its ordered quantity. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={postAction} disabled={busy} {...buttonProps('primary')}>Yes, Post Receipt</button>
            <button type="button" onClick={() => setConfirmingPost(false)} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div role="group" aria-label="Confirm delete" style={{ ...dangerPanel, marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>Delete this draft purchase receipt permanently? This cannot be undone. It has never been posted — nothing else is affected.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={deleteAction} disabled={busy} {...buttonProps('danger')}>Yes, Delete Draft</button>
            <button type="button" onClick={() => setConfirmingDelete(false)} {...buttonProps('secondary')}>Keep Draft</button>
          </div>
        </div>
      )}

      {confirmingCancel && (
        <div role="group" aria-label="Confirm cancel" style={{ ...dangerPanel, marginBottom: 20 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-primary)' }}>Cancelling this purchase receipt marks it inactive and reopens the quantity it contributed. This does not delete the record.</p>
          <AppField label="Reason" required>
            {control => (
              <textarea {...control} value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} placeholder="Why is this purchase receipt being cancelled?" className={fieldControlClassName} />
            )}
          </AppField>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={cancelAction} disabled={busy} {...buttonProps('danger')}>Confirm Cancel</button>
            <button type="button" onClick={() => setConfirmingCancel(false)} {...buttonProps('secondary')}>Keep Receipt</button>
          </div>
        </div>
      )}

      <dl style={{ ...panel, margin: '0 0 20px' }}>
        <Row label="Received Date" value={receipt.received_date ? formatCommercialDate(receipt.received_date) : '—'} />
        <Row label="Supplier Delivery Reference" value={receipt.delivery_reference ?? '—'} />
        <Row label="Notes" value={receipt.notes ?? '—'} />
        {isCancelled && receipt.cancel_reason && <Row label="Cancellation Reason" value={receipt.cancel_reason} />}
      </dl>

      <div style={{ marginBottom: 20 }}>
        <TableContainer label="Receipt lines" minWidth={680}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col">Unit</th>
                <th scope="col" className={tableStyles.num}>Ordered</th>
                <th scope="col" className={tableStyles.num}>Previously Received</th>
                <th scope="col" className={tableStyles.num}>Remaining</th>
                <th scope="col" className={tableStyles.num}>This Receipt</th>
                <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <TableStateRow colSpan={7} kind="empty">No line items yet.</TableStateRow>}
              {lines.map(line => {
                const poLine = poLines.find(l => l.id === line.source_purchase_order_line_id);
                const remaining = remainingForPoLine(line.source_purchase_order_line_id, line.id);
                return (
                  <tr key={line.id}>
                    <td style={{ color: 'var(--text-primary)' }}>{line.description_snapshot}</td>
                    <td>{line.unit_snapshot ?? '—'}</td>
                    <td className={tableStyles.num}>{poLine?.quantity ?? '—'}</td>
                    <td className={tableStyles.num}>{receivedQuantities[line.source_purchase_order_line_id] ?? 0}</td>
                    <td className={tableStyles.num} style={remaining < 0 ? { color: 'var(--status-danger)', fontWeight: 600 } : undefined}>{remaining}</td>
                    <td className={tableStyles.num}>{line.quantity_received}</td>
                    <td className={tableStyles.actions}>
                      {isDraft && canEdit && (
                        <button type="button" onClick={() => removeLine(line.id)} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }} aria-label={`Remove line ${line.description_snapshot}`}>Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableContainer>

        {isDraft && canEdit && (
          <form onSubmit={addLine} aria-label="Add receipt line" style={{ ...panel, padding: 16, marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 220px' }}>
              <AppField label="Purchase Order Line">
                {control => (
                  <select value={newPoLineId} onChange={e => setNewPoLineId(e.target.value)} {...control} className={fieldControlClassName}>
                    <option value="">— Select a purchase order line —</option>
                    {poLines.map(pl => {
                      const remaining = remainingForPoLine(pl.id);
                      return (
                        <option key={pl.id} value={pl.id}>
                          {pl.description_snapshot} (remaining: {remaining})
                        </option>
                      );
                    })}
                  </select>
                )}
              </AppField>
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <AppField label="Quantity Received">
                {control => <input {...control} type="number" step="0.0001" min="0.0001" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} className={fieldControlClassName} />}
              </AppField>
            </div>
            <button type="submit" disabled={busy} {...buttonProps('primary')}>Add Line</button>
          </form>
        )}
      </div>

      <section aria-labelledby="receipt-supporting-documents" style={panel}>
        <h2 id="receipt-supporting-documents" style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: '0 0 12px' }}>Supporting Documents</h2>
        {attachments.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>No supporting documents yet.</p>}
        {attachments.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0 }}>
              <a href={`/api/commercial/purchase-receipts/${id}/attachments/${a.id}`} style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{a.original_filename}</a>
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
