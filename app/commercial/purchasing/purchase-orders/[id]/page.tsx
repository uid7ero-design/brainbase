'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PurchaseOrderStatusBadge } from '../../_status';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import type { PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type PurchaseOrder = {
  id: string; organisation_id: string; supplier_id: string; purchase_order_number: string | null;
  status: PurchaseOrderStatus; currency: string;
  supplier_reference: string | null; delivery_date: string | null;
  delivery_address_line1: string | null; delivery_address_line2: string | null;
  delivery_suburb: string | null; delivery_state: string | null; delivery_postcode: string | null; delivery_country: string | null;
  payment_terms_days: number | null; internal_notes: string | null; supplier_notes: string | null;
  subtotal_cents: number; tax_cents: number; total_cents: number;
  supplier_name_snapshot: string | null; supplier_contact_name_snapshot: string | null;
  supplier_email_snapshot: string | null; supplier_phone_snapshot: string | null; supplier_address_snapshot: string | null;
  return_reason: string | null; cancel_reason: string | null;
  created_at: string; updated_at: string;
  submitted_at: string | null; approved_at: string | null; issued_at: string | null; cancelled_at: string | null;
};
type Line = {
  id: string; product_id: string | null; position: number; description_snapshot: string; sku_snapshot: string | null;
  unit_snapshot: string | null; quantity: number; unit_price_cents: number; tax_code_snapshot: string | null;
  tax_rate_snapshot: string; line_subtotal_cents: number; line_tax_cents: number; line_total_cents: number;
};
type Supplier = {
  id: string; name: string;
  contact_name: string | null; email: string | null; phone: string | null; billing_address: string | null;
};
type Product = { id: string; name: string; default_unit_price_cents: number; default_tax_code_id: string | null; sku: string | null; unit_label: string | null; active: boolean };
type TaxCode = { id: string; code: string; name: string; rate: string };
// Phase C6.5 — mirrors app/commercial/quotes/[id]/page.tsx's own
// identical Delivery type exactly.
type Delivery = { id: string; channel: string; recipient: string; status: string; attempted_at: string; error_summary: string | null };
// C6.9 remediation — Supporting Documents.
type AttachmentCategory = 'SUPPLIER_QUOTE' | 'SPECIFICATION' | 'SCOPE_OF_WORK' | 'APPROVAL' | 'OTHER';
const ATTACHMENT_CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  SUPPLIER_QUOTE: 'Supplier Quote', SPECIFICATION: 'Specification', SCOPE_OF_WORK: 'Scope of Work', APPROVAL: 'Approval', OTHER: 'Other',
};
type Attachment = {
  id: string; category: AttachmentCategory; original_filename: string; size_bytes: number;
  uploaded_by_name: string | null; created_at: string;
};

// Client-side role check only — UX gating, not enforcement. The real
// floor is authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit)
// inside every mutating route this page calls. Mirrors
// app/commercial/invoices/[id]/page.tsx's own clientRoleGte exactly.
const CLIENT_ROLE_ORDER = ['viewer', 'manager', 'admin', 'super_admin'];
function clientRoleGte(role: string | undefined, min: string): boolean {
  if (!role) return false;
  const i = CLIENT_ROLE_ORDER.indexOf(role);
  const m = CLIENT_ROLE_ORDER.indexOf(min);
  return i !== -1 && m !== -1 && i >= m;
}

// Phase C6.3 built the DRAFT-only foundation (header/line edit affordances,
// strictly read-only rendering for every other status). Phase C6.4 adds
// the five lifecycle-transition actions (submit/approve/return/issue/
// cancel) on top of that same read-only shell — it does not touch the
// DRAFT edit UI at all. No cost-centre picker is offered in the line
// editor — no cost-centre listing API/UI exists anywhere in Commercial
// yet (unlike products/tax-codes, which quote/invoice lines already
// expose pickers for), so adding one is left to a later phase; a line's
// cost_centre_id remains fully API/domain-settable, just not from this UI.
export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // C6.9 remediation — the CURRENT/live linked supplier, as returned by
  // GET .../purchase-orders/:id (supplier_id resolved server-side, see
  // that route's own comment). Used for pre-issue display only — never
  // for ISSUED/CANCELLED, which always render the frozen
  // supplier_*_snapshot fields instead (see the render logic below).
  const [linkedSupplier, setLinkedSupplier] = useState<Supplier | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  // Phase C6.4 — admin+ floor for approve/return/issue/cancel, matching
  // this gate's own COMMERCIAL_MIN_ROLE.approve role-floor spec exactly.
  // UX gating only; every route re-enforces this server-side.
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // Phase C6.4 — lifecycle action confirmation state, mirroring
  // app/commercial/invoices/[id]/page.tsx's own confirmingIssue/
  // confirmingVoid inline-panel convention exactly (no window.confirm
  // anywhere in this codebase's Commercial UI).
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [confirmingReturn, setConfirmingReturn] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [confirmingIssue, setConfirmingIssue] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // C6.9 remediation — Delete Draft confirmation state, same
  // inline-panel convention as every other lifecycle action on this page.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Phase C6.5 — email confirmation/result state, mirroring
  // app/commercial/invoices/[id]/page.tsx's own confirmingVoid-style
  // inline panel convention. There is no equivalent PDF confirmation
  // state — Download PDF is a plain same-origin link to the new GET
  // .../pdf route (Content-Disposition: attachment triggers the
  // browser's own download, no client-side blob/jsPDF work needed here
  // at all, unlike the quote/invoice pages' own client-built-PDF
  // download buttons).
  const [confirmingEmail, setConfirmingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState('');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  // C6.9 remediation — Supporting Documents state.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadCategory, setUploadCategory] = useState<AttachmentCategory>('SUPPLIER_QUOTE');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // header edit form state
  const [editingHeader, setEditingHeader] = useState(false);
  const [hSupplierId, setHSupplierId] = useState('');
  const [hSupplierReference, setHSupplierReference] = useState('');
  const [hDeliveryDate, setHDeliveryDate] = useState('');
  const [hDeliveryAddressLine1, setHDeliveryAddressLine1] = useState('');
  const [hDeliverySuburb, setHDeliverySuburb] = useState('');
  const [hDeliveryState, setHDeliveryState] = useState('');
  const [hDeliveryPostcode, setHDeliveryPostcode] = useState('');
  const [hPaymentTermsDays, setHPaymentTermsDays] = useState('');
  const [hSupplierNotes, setHSupplierNotes] = useState('');
  const [hInternalNotes, setHInternalNotes] = useState('');

  // add-line form state
  const [newProductId, setNewProductId] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newPrice, setNewPrice] = useState('');
  const [newTaxCodeId, setNewTaxCodeId] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/commercial/purchase-orders/${id}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setPo(data.purchaseOrder);
    setLines(data.lines);
    setDeliveries(data.deliveries ?? []);
    setLinkedSupplier(data.supplier ?? null);
    setLoading(false);

    const attachmentsRes = await fetch(`/api/commercial/purchase-orders/${id}/attachments`);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);

    const [suppliersRes, productsRes, taxCodesRes, meRes] = await Promise.all([
      fetch('/api/commercial/suppliers'), fetch('/api/commercial/products'), fetch('/api/commercial/tax-codes'), fetch('/api/me'),
    ]);
    if (suppliersRes.ok) setSuppliers((await suppliersRes.json()).suppliers ?? []);
    if (productsRes.ok) setProducts((await productsRes.json()).products ?? []);
    if (taxCodesRes.ok) setTaxCodes((await taxCodesRes.json()).taxCodes ?? []);
    if (meRes.ok) {
      const me = await meRes.json();
      setCanEdit(clientRoleGte(me.role, 'manager'));
      setIsAdmin(clientRoleGte(me.role, 'admin'));
    }
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const isDraft = po?.status === 'DRAFT';
  const isPendingApproval = po?.status === 'PENDING_APPROVAL';
  const isApproved = po?.status === 'APPROVED';
  const isIssued = po?.status === 'ISSUED';
  const isCancelled = po?.status === 'CANCELLED';

  function openHeaderEdit() {
    if (!po) return;
    setHSupplierId(po.supplier_id);
    setHSupplierReference(po.supplier_reference ?? '');
    setHDeliveryDate(po.delivery_date ?? '');
    setHDeliveryAddressLine1(po.delivery_address_line1 ?? '');
    setHDeliverySuburb(po.delivery_suburb ?? '');
    setHDeliveryState(po.delivery_state ?? '');
    setHDeliveryPostcode(po.delivery_postcode ?? '');
    setHPaymentTermsDays(po.payment_terms_days != null ? String(po.payment_terms_days) : '');
    setHSupplierNotes(po.supplier_notes ?? '');
    setHInternalNotes(po.internal_notes ?? '');
    setActionError('');
    setEditingHeader(true);
  }

  async function saveHeader(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: hSupplierId,
        supplierReference: hSupplierReference || null,
        deliveryDate: hDeliveryDate || null,
        deliveryAddressLine1: hDeliveryAddressLine1 || null,
        deliverySuburb: hDeliverySuburb || null,
        deliveryState: hDeliveryState || null,
        deliveryPostcode: hDeliveryPostcode || null,
        paymentTermsDays: hPaymentTermsDays ? Number(hPaymentTermsDays) : null,
        supplierNotes: hSupplierNotes || null,
        internalNotes: hInternalNotes || null,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to save purchase order.'); return; }
    setEditingHeader(false);
    load();
  }

  function applyProductDefaults(productId: string) {
    setNewProductId(productId);
    const p = products.find(x => x.id === productId);
    if (p) {
      setNewDescription(p.name);
      setNewPrice((p.default_unit_price_cents / 100).toFixed(2));
      setNewTaxCodeId(p.default_tax_code_id ?? '');
    }
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/lines`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: newProductId || null,
        description: newDescription || undefined,
        quantity: Number(newQuantity),
        unitPriceCents: Math.round(parseFloat(newPrice || '0') * 100),
        taxCodeId: newTaxCodeId || null,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to add line.'); return; }
    setNewProductId(''); setNewDescription(''); setNewQuantity('1'); setNewPrice(''); setNewTaxCodeId('');
    load();
  }

  async function removeLine(lineId: string) {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/lines/${lineId}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { const data = await res.json().catch(() => ({})); setActionError(data.error ?? 'Failed to remove line.'); return; }
    load();
  }

  // Phase C6.4 — every lifecycle action follows the identical shape
  // app/commercial/invoices/[id]/page.tsx's issueInvoice()/voidInvoiceAction()
  // already established: POST the transition route, and on a 409 (the
  // server's own atomic guard lost a race — someone else's request
  // already applied a transition) show a plain "changed — refreshing…"
  // message and reload, rather than exposing the raw conflict text or
  // silently retrying. The server (the C6.2 domain functions) remains
  // the sole authority for whether a transition is actually legal —
  // these handlers never guess at that themselves.
  async function submitAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/submit`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmingSubmit(false);
    if (!res.ok) {
      if (res.status === 409) setActionError('This purchase order’s status just changed. Refreshing…');
      else setActionError(data.error ?? 'Failed to submit purchase order.');
    }
    load();
  }

  async function approveAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/approve`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmingApprove(false);
    if (!res.ok) {
      if (res.status === 409) setActionError('This purchase order’s status just changed. Refreshing…');
      else setActionError(data.error ?? 'Failed to approve purchase order.');
    }
    load();
  }

  async function returnAction() {
    if (!returnReason.trim()) { setActionError('A return reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: returnReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (res.status === 409) { setActionError('This purchase order’s status just changed. Refreshing…'); load(); return; }
      setActionError(data.error ?? 'Failed to return purchase order to draft.');
      return;
    }
    setConfirmingReturn(false); setReturnReason('');
    load();
  }

  // Phase C6.4 Section I — issuing is the highest-risk transition:
  // permanent number allocation and the freeze are entirely owned by
  // issuePurchaseOrder()'s own atomic statement (see its header comment
  // in lib/commercial/purchaseOrders.ts) — this handler never retries on
  // failure and never allocates or guesses a number itself.
  async function issueAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/issue`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmingIssue(false);
    if (!res.ok) {
      if (res.status === 409) setActionError('This purchase order was just issued by another request. Refreshing…');
      else setActionError(data.error ?? 'Failed to issue purchase order.');
    }
    load();
  }

  async function cancelAction() {
    if (!cancelReason.trim()) { setActionError('A cancel reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: cancelReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (res.status === 409) { setActionError('This purchase order’s status just changed. Refreshing…'); load(); return; }
      setActionError(data.error ?? 'Failed to cancel purchase order.');
      return;
    }
    setConfirmingCancel(false); setCancelReason('');
    load();
  }

  // C6.9 remediation — safe discard for a never-issued, never-submitted
  // DRAFT. The server independently re-verifies the full eligibility
  // gate (see deleteDraftPurchaseOrder()'s own comment) — this button is
  // only ever rendered when the client already knows it should be
  // eligible (isDraft, no purchase_order_number, no submitted_at), but
  // that is UX gating only, never the actual enforcement. Redirects away
  // on success since this PO no longer exists.
  async function deleteAction() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to delete draft purchase order.'); return; }
    router.push('/commercial/purchasing/purchase-orders');
  }

  // C6.9 remediation — Supporting Documents upload/remove. Uploads go
  // through the server route (multipart/form-data), which streams
  // straight into the dedicated private Commercial attachment store —
  // never a client-side Blob SDK call, never a raw store URL returned to
  // this page.
  async function uploadAttachment(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { setUploadError('Choose a file first.'); return; }
    setUploadBusy(true); setUploadError('');
    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('category', uploadCategory);
    const res = await fetch(`/api/commercial/purchase-orders/${id}/attachments`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    setUploadBusy(false);
    if (!res.ok) { setUploadError(data.error ?? 'Upload failed.'); return; }
    setUploadFile(null);
    load();
  }

  async function removeAttachment(attachmentId: string) {
    setUploadBusy(true); setUploadError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/attachments/${attachmentId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setUploadBusy(false);
    if (!res.ok) { setUploadError(data.error ?? 'Failed to remove document.'); return; }
    load();
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Phase C6.5 — sends the exact server-generated PDF (built fresh,
  // server-side, from this PO's own persisted snapshot/line/total
  // fields) to the supplier's ISSUED snapshot email, via
  // POST .../email. `busy` disables the confirm button for the
  // duration of the request, preventing an accidental duplicate-click
  // double-send while a request is already in flight — the server's
  // own 60-second cooldown (secondsSinceLastAttempt(), matching the
  // quote/invoice routes exactly) is still the real guard against a
  // genuine repeat click after the first request completes.
  async function sendEmailAction() {
    setBusy(true); setActionError(''); setEmailResult('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'EMAIL' }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setActionError(data.error ?? 'Failed to send purchase order email.');
      return;
    }
    setConfirmingEmail(false);
    setEmailResult('Purchase order emailed to the supplier.');
    load(); // refreshes delivery history to include this attempt
  }

  if (loading) return <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>;
  if (!po) return <div style={{ color: '#6b7280', fontSize: 14 }}>Purchase order not found.</div>;

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/commercial/purchasing/purchase-orders" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Purchase Orders</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 8px', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{po.purchase_order_number ?? 'Draft Purchase Order'}</h1>
          <PurchaseOrderStatusBadge status={po.status} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isDraft && canEdit && (
            <button onClick={openHeaderEdit} disabled={busy} style={btn('#1f2937')}>Edit Details</button>
          )}
          {isDraft && canEdit && !confirmingSubmit && (
            <button onClick={() => setConfirmingSubmit(true)} disabled={busy || lines.length === 0} title={lines.length === 0 ? 'Add at least one line before submitting.' : undefined} style={btn('#1a6aff')}>
              Submit for Approval
            </button>
          )}
          {/* C6.9 remediation — only ever offered for a DRAFT that was
              NEVER submitted (no purchase_order_number, no submitted_at)
              — see deleteDraftPurchaseOrder()'s own comment for why a
              returned-then-DRAFT PO with real approval history is
              deliberately excluded. */}
          {isDraft && canEdit && po.purchase_order_number == null && po.submitted_at == null && !confirmingDelete && (
            <button onClick={() => setConfirmingDelete(true)} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Delete Draft</button>
          )}
          {isPendingApproval && isAdmin && !confirmingApprove && !confirmingReturn && (
            <button onClick={() => setConfirmingApprove(true)} disabled={busy} style={btn('#1a6aff')}>Approve</button>
          )}
          {isPendingApproval && isAdmin && !confirmingApprove && !confirmingReturn && (
            <button onClick={() => setConfirmingReturn(true)} disabled={busy} style={btn('#1f2937')}>Return for Changes</button>
          )}
          {isApproved && isAdmin && !confirmingIssue && (
            <button onClick={() => setConfirmingIssue(true)} disabled={busy} style={btn('#1a6aff')}>Issue Purchase Order</button>
          )}
          {(isIssued || isCancelled) && (
            <a href={`/api/commercial/purchase-orders/${id}/pdf`} style={{ ...btn('#1f2937'), textDecoration: 'none', display: 'inline-block' }}>
              Download PDF
            </a>
          )}
          {isIssued && canEdit && po.supplier_email_snapshot && !confirmingEmail && (
            <button onClick={() => { setConfirmingEmail(true); setEmailResult(''); }} disabled={busy} style={btn('#1f2937')}>Email Purchase Order</button>
          )}
          {isIssued && isAdmin && !confirmingCancel && (
            <button onClick={() => setConfirmingCancel(true)} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Cancel Purchase Order</button>
          )}
        </div>
      </div>
      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 16px' }}>{actionError}</p>}
      {emailResult && <p style={{ color: '#4ade80', fontSize: 13, margin: '0 0 16px' }}>{emailResult}</p>}
      {!isDraft && !isCancelled && (
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 16px' }}>
          This purchase order is {po.status.replace('_', ' ').toLowerCase()} — the supplier, header details, and lines are read-only.
        </p>
      )}
      {isCancelled && (
        <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 16px' }}>
          This purchase order has been cancelled. It is no longer active and is retained as a read-only record — its number is not reused.
        </p>
      )}

      {confirmingSubmit && (
        <div style={{ background: 'rgba(26,106,255,0.08)', border: '1px solid rgba(26,106,255,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 12px' }}>
            Submitting sends this purchase order for approval — the supplier, header details, and lines can no longer be
            edited afterward. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitAction} disabled={busy} style={btn('#1a6aff')}>Yes, Submit for Approval</button>
            <button onClick={() => setConfirmingSubmit(false)} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingApprove && (
        <div style={{ background: 'rgba(26,106,255,0.08)', border: '1px solid rgba(26,106,255,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 12px' }}>
            Approving this purchase order allows it to be issued. It does not allocate a PO number or send anything to the
            supplier. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={approveAction} disabled={busy} style={btn('#1a6aff')}>Yes, Approve</button>
            <button onClick={() => setConfirmingApprove(false)} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingReturn && (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 4px' }}>Returning this purchase order sends it back to Draft so it can be edited again.</p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>No PO number has been allocated yet, so nothing is lost.</p>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Reason (required)</div>
          <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', marginBottom: 12 }} placeholder="Why is this being returned for changes?" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={returnAction} disabled={busy || !returnReason.trim()} style={btn('#1a6aff')}>Confirm Return</button>
            <button onClick={() => { setConfirmingReturn(false); setReturnReason(''); }} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingIssue && (
        <div style={{ background: 'rgba(26,106,255,0.08)', border: '1px solid rgba(26,106,255,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 12px' }}>
            Issuing allocates a permanent purchase order number and freezes this document — the supplier, header details,
            and lines can no longer be edited afterward, and this cannot be undone. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={issueAction} disabled={busy} style={btn('#1a6aff')}>Yes, Issue Purchase Order</button>
            <button onClick={() => setConfirmingIssue(false)} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingEmail && (
        <div style={{ background: 'rgba(26,106,255,0.08)', border: '1px solid rgba(26,106,255,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 4px' }}>
            Send this purchase order to <strong>{po.supplier_email_snapshot}</strong>?
          </p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>The generated PDF will be attached. This does not change the purchase order itself.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={sendEmailAction} disabled={busy} style={btn('#1a6aff')}>{busy ? 'Sending…' : 'Yes, Send Email'}</button>
            <button onClick={() => setConfirmingEmail(false)} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingCancel && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 4px' }}>Cancelling this purchase order marks it inactive. This does not delete the record.</p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>The PO number, supplier details, lines, and totals are all retained for the record.</p>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Reason (required)</div>
          <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', marginBottom: 12 }} placeholder="Why is this purchase order being cancelled?" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelAction} disabled={busy || !cancelReason.trim()} style={btn('#f87171', '#1a0505')}>Confirm Cancel</button>
            <button onClick={() => { setConfirmingCancel(false); setCancelReason(''); }} disabled={busy} style={btn('#1f2937')}>Keep Purchase Order</button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 4px' }}>Delete this draft purchase order permanently? This cannot be undone.</p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>It has never been submitted and has no purchase order number — nothing else is affected.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={deleteAction} disabled={busy} style={btn('#f87171', '#1a0505')}>Yes, Delete Draft</button>
            <button onClick={() => setConfirmingDelete(false)} disabled={busy} style={btn('#1f2937')}>Keep Draft</button>
          </div>
        </div>
      )}

      {editingHeader ? (
        <form onSubmit={saveHeader} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={miniLbl}>Supplier</div>
            <select value={hSupplierId} onChange={e => setHSupplierId(e.target.value)} style={sel}>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <div style={miniLbl}>Supplier Reference</div>
              <input value={hSupplierReference} onChange={e => setHSupplierReference(e.target.value)} style={sel} />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <div style={miniLbl}>Delivery Date</div>
              <input type="date" value={hDeliveryDate} onChange={e => setHDeliveryDate(e.target.value)} style={sel} />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <div style={miniLbl}>Payment Terms (days)</div>
              <input value={hPaymentTermsDays} onChange={e => setHPaymentTermsDays(e.target.value)} style={sel} inputMode="numeric" />
            </div>
          </div>
          <div>
            <div style={miniLbl}>Delivery Address</div>
            <input value={hDeliveryAddressLine1} onChange={e => setHDeliveryAddressLine1(e.target.value)} style={sel} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}>
              <div style={miniLbl}>Suburb</div>
              <input value={hDeliverySuburb} onChange={e => setHDeliverySuburb(e.target.value)} style={sel} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={miniLbl}>State</div>
              <input value={hDeliveryState} onChange={e => setHDeliveryState(e.target.value)} style={sel} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={miniLbl}>Postcode</div>
              <input value={hDeliveryPostcode} onChange={e => setHDeliveryPostcode(e.target.value)} style={sel} />
            </div>
          </div>
          <div>
            <div style={miniLbl}>Notes to Supplier</div>
            <textarea value={hSupplierNotes} onChange={e => setHSupplierNotes(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div>
            <div style={miniLbl}>Internal Notes</div>
            <textarea value={hInternalNotes} onChange={e => setHInternalNotes(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={busy} style={btn('#1a6aff')}>Save</button>
            <button type="button" onClick={() => setEditingHeader(false)} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </form>
      ) : (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={miniLbl}>Supplier</div>
            {/* C6.9 remediation — DRAFT/PENDING_APPROVAL/APPROVED render
                the CURRENT linked supplier (live data, always correct);
                ISSUED/CANCELLED render the frozen supplier_*_snapshot
                fields instead, since those documents must stay
                historically immutable even if the live supplier record
                later changes. Root cause of the old bug: this block
                unconditionally read the snapshot fields, which are only
                ever populated at issue time — pre-issue they are all
                null, hence the permanent "—". */}
            {(po.status === 'ISSUED' || po.status === 'CANCELLED') ? (
              <>
                <div style={{ fontSize: 14 }}>
                  <Link href={`/commercial/purchasing/suppliers/${po.supplier_id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{po.supplier_name_snapshot ?? '—'}</Link>
                </div>
                {po.supplier_contact_name_snapshot && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{po.supplier_contact_name_snapshot}</div>}
                {(po.supplier_email_snapshot || po.supplier_phone_snapshot) && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{[po.supplier_email_snapshot, po.supplier_phone_snapshot].filter(Boolean).join(' · ')}</div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 14 }}>
                  <Link href={`/commercial/purchasing/suppliers/${po.supplier_id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{linkedSupplier?.name ?? '—'}</Link>
                </div>
                {linkedSupplier?.contact_name && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{linkedSupplier.contact_name}</div>}
                {(linkedSupplier?.email || linkedSupplier?.phone) && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{[linkedSupplier?.email, linkedSupplier?.phone].filter(Boolean).join(' · ')}</div>
                )}
              </>
            )}
          </div>
          <div>
            <div style={miniLbl}>Delivery</div>
            <div style={{ fontSize: 14 }}>{formatCommercialDate(po.delivery_date)}</div>
            {(po.delivery_address_line1 || po.delivery_suburb) && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                {[po.delivery_address_line1, po.delivery_address_line2, po.delivery_suburb, po.delivery_state, po.delivery_postcode].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
          <div>
            <div style={miniLbl}>Payment Terms</div>
            <div style={{ fontSize: 14 }}>{po.payment_terms_days != null ? `${po.payment_terms_days} days` : '—'}</div>
          </div>
          <div>
            <div style={miniLbl}>Supplier Reference</div>
            <div style={{ fontSize: 14 }}>{po.supplier_reference ?? '—'}</div>
          </div>
          {po.supplier_notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={miniLbl}>Notes to Supplier</div>
              <div style={{ fontSize: 13, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>{po.supplier_notes}</div>
            </div>
          )}
          {po.internal_notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={miniLbl}>Internal Notes</div>
              <div style={{ fontSize: 13, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>{po.internal_notes}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginBottom: 20, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Description', 'Qty', 'Unit Price', 'Tax', 'Total', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} style={empty}>No line items yet.</td></tr>}
            {lines.map((l, i) => (
              <tr key={l.id} style={{ borderBottom: i < lines.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#f9fafb' }}>
                  {l.description_snapshot}
                  {l.sku_snapshot && <span style={{ color: '#4b5563', marginLeft: 6 }}>({l.sku_snapshot})</span>}
                </td>
                <td style={td}>{l.quantity}{l.unit_snapshot ? ` ${l.unit_snapshot}` : ''}</td>
                <td style={td}>{formatMoneyCents(l.unit_price_cents, po.currency)}</td>
                <td style={td}>{l.tax_code_snapshot ? `${l.tax_code_snapshot} (${l.tax_rate_snapshot}%)` : '—'}</td>
                <td style={td}>{formatMoneyCents(l.line_total_cents, po.currency)}</td>
                <td style={{ padding: '12px 16px' }}>
                  {isDraft && canEdit && <button onClick={() => removeLine(l.id)} disabled={busy} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', padding: 0 }}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isDraft && canEdit && (
          <form onSubmit={addLine} style={{ padding: '16px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 180px' }}>
              {/* C6.9 remediation — clarified wording: internal-catalogue
                  selection is explicitly optional, and a freeform
                  supplier line (the common Purchasing case — buying from
                  an external supplier, not from BrainBase's own sales
                  catalogue) is a normal, first-class path, not a
                  fallback. product_id remains fully optional in the
                  domain/API — this is a labeling change only. */}
              <div style={miniLbl}>Internal Product / Service (optional)</div>
              <select value={newProductId} onChange={e => applyProductDefaults(e.target.value)} style={sel}>
                <option value="">Or enter a freeform supplier line below</option>
                {products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 180px' }}>
              <div style={miniLbl}>Description</div>
              <input value={newDescription} onChange={e => setNewDescription(e.target.value)} style={sel} placeholder="Freeform supplier line description" />
            </div>
            <div style={{ width: 70 }}>
              <div style={miniLbl}>Qty</div>
              <input value={newQuantity} onChange={e => setNewQuantity(e.target.value)} style={sel} inputMode="numeric" />
            </div>
            <div style={{ width: 100 }}>
              <div style={miniLbl}>Unit Price</div>
              <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={sel} placeholder="0.00" inputMode="decimal" />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <div style={miniLbl}>Tax Code</div>
              <select value={newTaxCodeId} onChange={e => setNewTaxCodeId(e.target.value)} style={sel}>
                <option value="">— No tax —</option>
                {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
              </select>
            </div>
            <button type="submit" disabled={busy} style={{ padding: '9px 16px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Add Line
            </button>
          </form>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 260, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px' }}>
          <TotalRow label="Subtotal" value={formatMoneyCents(po.subtotal_cents, po.currency)} />
          <TotalRow label="Tax" value={formatMoneyCents(po.tax_cents, po.currency)} />
          <TotalRow label="Total" value={formatMoneyCents(po.total_cents, po.currency)} bold />
        </div>
      </div>

      {/* C6.9 remediation — Supporting Documents. Visible in every
          status (retention: attachments must stay accessible after
          issue/cancellation, never gated tighter than the PO itself).
          Upload/remove only offered while DRAFT — see the attachments
          routes' own comment for why no other status supports mutation. */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, marginBottom: 20 }}>
        <div style={{ padding: '16px 24px 0' }}>
          <div style={miniLbl}>Supporting Documents</div>
        </div>
        {uploadError && <p style={{ color: '#f87171', fontSize: 13, margin: '8px 24px 0' }}>{uploadError}</p>}
        {attachments.length === 0 && (
          <div style={{ padding: '12px 24px 16px', fontSize: 13, color: '#6b7280' }}>No supporting documents yet.</div>
        )}
        {attachments.length > 0 && (
          <div style={{ padding: '8px 24px 16px' }}>
            {attachments.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontSize: 13, borderTop: `1px solid ${BORDER}` }}>
                <div>
                  <a href={`/api/commercial/purchase-orders/${id}/attachments/${a.id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{a.original_filename}</a>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {ATTACHMENT_CATEGORY_LABELS[a.category]} · {formatBytes(a.size_bytes)} · {a.uploaded_by_name ?? 'Unknown'} · {formatCommercialDate(a.created_at)}
                  </div>
                </div>
                {isDraft && canEdit && (
                  <button onClick={() => removeAttachment(a.id)} disabled={uploadBusy} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', padding: 0 }}>Remove</button>
                )}
              </div>
            ))}
          </div>
        )}
        {isDraft && canEdit && (
          <form onSubmit={uploadAttachment} style={{ padding: '16px 24px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px' }}>
              <div style={miniLbl}>Category</div>
              <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value as AttachmentCategory)} style={sel}>
                {(Object.keys(ATTACHMENT_CATEGORY_LABELS) as AttachmentCategory[]).map(c => <option key={c} value={c}>{ATTACHMENT_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 220px' }}>
              <div style={miniLbl}>File</div>
              <input type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} style={sel} />
            </div>
            <button type="submit" disabled={uploadBusy || !uploadFile} style={{ padding: '9px 16px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + Attach Document
            </button>
          </form>
        )}
      </div>

      {deliveries.length > 0 && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 24px', marginBottom: 20 }}>
          <div style={miniLbl}>Delivery History</div>
          {deliveries.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, borderTop: `1px solid ${BORDER}` }}>
              <span style={{ color: '#9ca3af' }}>{d.channel} → {d.recipient}</span>
              <span style={{ color: '#6b7280', fontSize: 12 }}>{new Date(d.attempted_at).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <DeliveryStatusBadge status={d.status} />
            </div>
          ))}
        </div>
      )}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
        <div style={miniLbl}>Timeline</div>
        <TimelineRow label="Created" value={po.created_at} />
        {po.submitted_at && <TimelineRow label="Submitted for approval" value={po.submitted_at} />}
        {po.approved_at && <TimelineRow label="Approved" value={po.approved_at} />}
        {po.issued_at && <TimelineRow label="Issued" value={po.issued_at} />}
        {po.cancelled_at && <TimelineRow label="Cancelled" value={po.cancelled_at} />}
        {po.return_reason && <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 8 }}>Returned to draft: {po.return_reason}</div>}
        {po.cancel_reason && <div style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>Cancelled: {po.cancel_reason}</div>}
      </div>
    </div>
  );
}

// Phase C6.5 — mirrors app/commercial/quotes/[id]/page.tsx's own
// identical DeliveryStatusBadge exactly.
const DELIVERY_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  PENDING: { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  SENT: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  DELIVERED: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  FAILED: { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};
function DeliveryStatusBadge({ status }: { status: string }) {
  const s = DELIVERY_STATUS_STYLE[status] ?? DELIVERY_STATUS_STYLE.PENDING;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg }}>
      {status}
    </span>
  );
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#9ca3af' }}>
      <span>{label}</span><span>{new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 400, color: bold ? '#f9fafb' : '#9ca3af' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

const miniLbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '28px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
const sel: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 13, boxSizing: 'border-box' };
function btn(bg: string, color = '#fff'): React.CSSProperties {
  return { padding: '8px 16px', background: bg, color, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
}
