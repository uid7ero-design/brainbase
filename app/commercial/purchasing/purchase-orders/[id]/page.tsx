'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PurchaseOrderStatusBadge } from '../../_status';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import type { PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';
import {
  Badge,
  FormError,
  StateMessage,
  TableContainer,
  TableStateRow,
  buttonProps,
  fieldControlClassName,
  tableStyles,
  type SemanticState,
} from '@/components/ui/app';

const CARD = 'var(--bg-surface)'; const BORDER = 'var(--border)';

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
// Phase C7.3 — linked purchase receipts summary (list-shaped, matches
// GET /api/commercial/purchase-orders/[id]/receipts).
type PurchaseReceiptSummary = { id: string; receipt_number: string | null; status: string; received_date: string | null; created_at: string };
// Phase C7.4 — linked supplier bills summary (list-shaped, matches
// GET /api/commercial/purchase-orders/[id]/bills).
type SupplierBillSummary = { id: string; bill_number: string | null; status: string; supplier_invoice_number: string; due_date: string | null; total_cents: number; created_at: string };
type ReconciliationLine = {
  purchaseOrderLineId: string; description: string; orderedQuantity: number; receivedQuantity: number; billedQuantity: number; matchedQuantity: number;
  orderedValueCents: number; billedValueCents: number; reconciliationState: string;
};
type Reconciliation = {
  lineCount: number; fullyReceivedLineCount: number; fullyBilledQuantityLineCount: number; fullyMatchedLineCount: number; fullyBilledLineCount: number; reconciledLineCount: number;
  orderedValueCents: number; billedValueCents: number; status: string; lines: ReconciliationLine[];
};
type CommitmentLine = {
  purchaseOrderLineId: string; description: string; effectiveCostCentreId: string | null; state: string;
  orderedTotalCents: number; billedTotalCents: number; outstandingTotalCents: number;
};
type Commitment = {
  purchaseOrderId: string; purchaseOrderStatus: string; currency: string; commitmentEffectiveAt: string | null;
  periodResolution: string; lineCount: number; orderedTotalCents: number; billedTotalCents: number; outstandingTotalCents: number;
  lines: CommitmentLine[];
};
type MatchCandidateLine = {
  id: string; purchaseOrderLineId: string; documentId: string; documentNumber: string;
  quantity: string; allocatedQuantity: string; remainingQuantity: string;
};
type MatchAllocation = {
  id: string; purchase_order_line_id: string; purchase_receipt_line_id: string; supplier_bill_line_id: string;
  quantity_allocated: string; created_at: string; reversed_at: string | null; reversal_reason: string | null;
};
type MatchWorkspace = { receiptLines: MatchCandidateLine[]; billLines: MatchCandidateLine[]; allocations: MatchAllocation[] };

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

  // Phase C7.3 — linked purchase-receipt document list. Quantitative
  // progress now comes from C7.5B's shared reconciliation read model.
  const [receipts, setReceipts] = useState<PurchaseReceiptSummary[]>([]);

  // Phase C7.4 — linked supplier-bill document list. Financial progress
  // now comes from C7.5B's shared reconciliation read model.
  const [supplierBills, setSupplierBills] = useState<SupplierBillSummary[]>([]);
  // Phase C7.5B — one server-derived reconciliation read model. This is
  // never persisted on the PO/lines and never calculated in the browser.
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  // Phase C7.6C — PO-local, migration-free commitment read model. The
  // browser only renders server-derived values; it never recalculates them.
  const [commitment, setCommitment] = useState<Commitment | null>(null);
  // Phase C7.5D3 — explicit receipt-line <-> supplier-bill-line matching.
  const [matchWorkspace, setMatchWorkspace] = useState<MatchWorkspace | null>(null);
  const [matchReceiptLineId, setMatchReceiptLineId] = useState('');
  const [matchBillLineId, setMatchBillLineId] = useState('');
  const [matchQuantity, setMatchQuantity] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [reversingMatchId, setReversingMatchId] = useState<string | null>(null);
  const [matchReversalReason, setMatchReversalReason] = useState('');

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

  // Phase C7.2 — narrow refresh: re-fetches only the PO itself (header
  // fields, lines, deliveries, the live linked supplier) from the one
  // GET route that already returns all four together in a single
  // response. Extracted out of load() below so a line mutation (which
  // only ever changes the PO's own lines/totals) can refresh exactly
  // what changed without re-fetching suppliers/products/tax-codes/
  // /api/me — none of which a line add/remove can affect — the way the
  // full load() chain previously forced on every single line mutation.
  // Returns whether the fetch succeeded so callers (including load()
  // itself) can decide what to do next without duplicating the
  // response-shape logic.
  const refreshPoAndLines = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/commercial/purchase-orders/${id}`);
    if (!res.ok) return false;
    const data = await res.json();
    setPo(data.purchaseOrder);
    setLines(data.lines);
    setDeliveries(data.deliveries ?? []);
    setLinkedSupplier(data.supplier ?? null);
    return true;
  }, [id]);

  const load = useCallback(async () => {
    const ok = await refreshPoAndLines();
    setLoading(false);
    if (!ok) return;

    const attachmentsRes = await fetch(`/api/commercial/purchase-orders/${id}/attachments`);
    if (attachmentsRes.ok) setAttachments((await attachmentsRes.json()).attachments ?? []);

    // Phase C7.3 — linked purchase-receipt documents.
    const receiptsRes = await fetch(`/api/commercial/purchase-orders/${id}/receipts`);
    if (receiptsRes.ok) {
      const receiptsData = await receiptsRes.json();
      setReceipts(receiptsData.purchaseReceipts ?? []);
    }

    // Phase C7.4 — linked supplier-bill documents.
    const billsRes = await fetch(`/api/commercial/purchase-orders/${id}/bills`);
    if (billsRes.ok) {
      const billsData = await billsRes.json();
      setSupplierBills(billsData.supplierBills ?? []);
    }

    const reconciliationRes = await fetch(`/api/commercial/purchase-orders/${id}/reconciliation`);
    if (reconciliationRes.ok) {
      const reconciliationData = await reconciliationRes.json();
      setReconciliation(reconciliationData.reconciliation ?? null);
    }

    const commitmentRes = await fetch(`/api/commercial/purchase-orders/${id}/commitment`);
    if (commitmentRes.ok) {
      const commitmentData = await commitmentRes.json();
      setCommitment(commitmentData.commitment ?? null);
    }

    const matchesRes = await fetch(`/api/commercial/purchase-orders/${id}/matches`);
    if (matchesRes.ok) {
      const matchesData = await matchesRes.json();
      setMatchWorkspace(matchesData.workspace ?? null);
    }

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
  }, [id, refreshPoAndLines]);

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
    // Phase C7.2 — awaited, narrow refresh (PO + lines only) instead of
    // the full load() chain: adding a line can only change this PO's
    // own lines and recalculated totals, never suppliers/products/
    // tax-codes/the current user's role, so re-fetching those on every
    // line add was both unnecessary and — because the previous
    // fire-and-forget `load()` call let the cleared form render before
    // any of its several sequential fetches resolved — the direct cause
    // of the observed "form resets, then the new line pops in later"
    // visual lag.
    await refreshPoAndLines();
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
  async function createMatchAction(e: React.FormEvent) {
    e.preventDefault();
    if (!matchReceiptLineId || !matchBillLineId || !matchQuantity.trim()) {
      setMatchError('Choose a receipt line, supplier bill line, and quantity.'); return;
    }
    setMatchBusy(true); setMatchError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/matches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseReceiptLineId: matchReceiptLineId, supplierBillLineId: matchBillLineId, quantity: matchQuantity }),
    });
    const data = await res.json().catch(() => ({}));
    setMatchBusy(false);
    if (!res.ok) { setMatchError(data.error ?? 'Failed to create match.'); return; }
    setMatchReceiptLineId(''); setMatchBillLineId(''); setMatchQuantity('');
    await load();
  }

  async function reverseMatchAction(allocationId: string) {
    if (!matchReversalReason.trim()) { setMatchError('A reversal reason is required.'); return; }
    setMatchBusy(true); setMatchError('');
    const res = await fetch(`/api/commercial/purchase-orders/${id}/matches/${allocationId}/reverse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: matchReversalReason }),
    });
    const data = await res.json().catch(() => ({}));
    setMatchBusy(false);
    if (!res.ok) { setMatchError(data.error ?? 'Failed to reverse match.'); return; }
    setReversingMatchId(null); setMatchReversalReason('');
    await load();
  }

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

  if (loading) return <StateMessage kind="loading" title="Loading purchase order…" size="page" />;
  if (!po) {
    return (
      <StateMessage kind="empty" size="page" title="Purchase order not found." action={<Link href="/commercial/purchasing/purchase-orders">Back to purchase orders</Link>} />
    );
  }

  const activeMatchAllocations = matchWorkspace?.allocations.filter(a => !a.reversed_at) ?? [];
  const availableReceiptMatchLines = matchWorkspace?.receiptLines.filter(line => Number(line.remainingQuantity) > 0) ?? [];
  const selectedReceiptMatchLine = availableReceiptMatchLines.find(line => line.id === matchReceiptLineId) ?? null;
  const availableBillMatchLines = (matchWorkspace?.billLines ?? []).filter(line =>
    Number(line.remainingQuantity) > 0 && (!selectedReceiptMatchLine || line.purchaseOrderLineId === selectedReceiptMatchLine.purchaseOrderLineId),
  );

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/commercial/purchasing/purchase-orders" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>← Purchase Orders</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 8px', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-primary)' }}>{po.purchase_order_number ?? 'Draft Purchase Order'}</h1>
          <PurchaseOrderStatusBadge status={po.status} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isDraft && canEdit && (
            <button type="button" onClick={openHeaderEdit} disabled={busy} {...buttonProps('secondary')}>Edit Details</button>
          )}
          {isDraft && canEdit && !confirmingSubmit && (
            <button type="button" onClick={() => setConfirmingSubmit(true)} disabled={busy || lines.length === 0} title={lines.length === 0 ? 'Add at least one line before submitting.' : undefined} {...buttonProps('primary')}>
              Submit for Approval
            </button>
          )}
          {/* C6.9 remediation — only ever offered for a DRAFT that was
              NEVER submitted (no purchase_order_number, no submitted_at)
              — see deleteDraftPurchaseOrder()'s own comment for why a
              returned-then-DRAFT PO with real approval history is
              deliberately excluded. */}
          {isDraft && canEdit && po.purchase_order_number == null && po.submitted_at == null && !confirmingDelete && (
            <button type="button" onClick={() => setConfirmingDelete(true)} disabled={busy} {...buttonProps('danger')}>Delete Draft</button>
          )}
          {isPendingApproval && isAdmin && !confirmingApprove && !confirmingReturn && (
            <button type="button" onClick={() => setConfirmingApprove(true)} disabled={busy} {...buttonProps('primary')}>Approve</button>
          )}
          {isPendingApproval && isAdmin && !confirmingApprove && !confirmingReturn && (
            <button type="button" onClick={() => setConfirmingReturn(true)} disabled={busy} {...buttonProps('secondary')}>Return for Changes</button>
          )}
          {isApproved && isAdmin && !confirmingIssue && (
            <button type="button" onClick={() => setConfirmingIssue(true)} disabled={busy} {...buttonProps('primary')}>Issue Purchase Order</button>
          )}
          {(isIssued || isCancelled) && (
            <a href={`/api/commercial/purchase-orders/${id}/pdf`} {...buttonProps('secondary')}>
              Download PDF
            </a>
          )}
          {isIssued && canEdit && po.supplier_email_snapshot && !confirmingEmail && (
            <button type="button" onClick={() => { setConfirmingEmail(true); setEmailResult(''); }} disabled={busy} {...buttonProps('secondary')}>Email Purchase Order</button>
          )}
          {isIssued && isAdmin && !confirmingCancel && (
            <button type="button" onClick={() => setConfirmingCancel(true)} disabled={busy} {...buttonProps('danger')}>Cancel Purchase Order</button>
          )}
        </div>
      </div>
      {actionError && <div style={{ marginBottom: 16 }}><FormError>{actionError}</FormError></div>}
      {emailResult && <p role="status" style={{ color: 'var(--status-success)', fontSize: 13, margin: '0 0 16px' }}>{emailResult}</p>}
      {!isDraft && !isCancelled && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px' }}>
          This purchase order is {po.status.replace('_', ' ').toLowerCase()} — the supplier, header details, and lines are read-only.
        </p>
      )}
      {isCancelled && (
        <p style={{ color: 'var(--status-danger)', fontSize: 13, margin: '0 0 16px' }}>
          This purchase order has been cancelled. It is no longer active and is retained as a read-only record — its number is not reused.
        </p>
      )}

      {confirmingSubmit && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            Submitting sends this purchase order for approval — the supplier, header details, and lines can no longer be
            edited afterward. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={submitAction} disabled={busy} {...buttonProps('primary')}>Yes, Submit for Approval</button>
            <button type="button" onClick={() => setConfirmingSubmit(false)} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingApprove && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            Approving this purchase order allows it to be issued. It does not allocate a PO number or send anything to the
            supplier. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={approveAction} disabled={busy} {...buttonProps('primary')}>Yes, Approve</button>
            <button type="button" onClick={() => setConfirmingApprove(false)} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingReturn && (
        <div style={{ background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px' }}>Returning this purchase order sends it back to Draft so it can be edited again.</p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>No PO number has been allocated yet, so nothing is lost.</p>
          <label htmlFor="po-return-reason" style={{ ...miniLbl, display: 'block', marginBottom: 6 }}>Reason (required)</label>
          <textarea id="po-return-reason" value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={2} className={fieldControlClassName} style={{ marginBottom: 12 }} placeholder="Why is this being returned for changes?" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={returnAction} disabled={busy || !returnReason.trim()} {...buttonProps('primary')}>Confirm Return</button>
            <button type="button" onClick={() => { setConfirmingReturn(false); setReturnReason(''); }} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingIssue && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            Issuing allocates a permanent purchase order number and freezes this document — the supplier, header details,
            and lines can no longer be edited afterward, and this cannot be undone. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={issueAction} disabled={busy} {...buttonProps('primary')}>Yes, Issue Purchase Order</button>
            <button type="button" onClick={() => setConfirmingIssue(false)} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingEmail && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Send this purchase order to <strong>{po.supplier_email_snapshot}</strong>?
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>The generated PDF will be attached. This does not change the purchase order itself.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={sendEmailAction} disabled={busy} {...buttonProps('primary')}>{busy ? 'Sending…' : 'Yes, Send Email'}</button>
            <button type="button" onClick={() => setConfirmingEmail(false)} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingCancel && (
        <div style={{ background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px' }}>Cancelling this purchase order marks it inactive. This does not delete the record.</p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>The PO number, supplier details, lines, and totals are all retained for the record.</p>
          <label htmlFor="po-cancel-reason" style={{ ...miniLbl, display: 'block', marginBottom: 6 }}>Reason (required)</label>
          <textarea id="po-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} className={fieldControlClassName} style={{ marginBottom: 12 }} placeholder="Why is this purchase order being cancelled?" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={cancelAction} disabled={busy || !cancelReason.trim()} {...buttonProps('danger')}>Confirm Cancel</button>
            <button type="button" onClick={() => { setConfirmingCancel(false); setCancelReason(''); }} disabled={busy} {...buttonProps('secondary')}>Keep Purchase Order</button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div style={{ background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px' }}>Delete this draft purchase order permanently? This cannot be undone.</p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>It has never been submitted and has no purchase order number — nothing else is affected.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={deleteAction} disabled={busy} {...buttonProps('danger')}>Yes, Delete Draft</button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy} {...buttonProps('secondary')}>Keep Draft</button>
          </div>
        </div>
      )}

      {editingHeader ? (
        <form onSubmit={saveHeader} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="po-supplier" style={{ ...miniLbl, display: 'block' }}>Supplier</label>
            <select id="po-supplier" value={hSupplierId} onChange={e => setHSupplierId(e.target.value)} className={fieldControlClassName}>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label htmlFor="po-supplier-reference" style={{ ...miniLbl, display: 'block' }}>Supplier Reference</label>
              <input id="po-supplier-reference" value={hSupplierReference} onChange={e => setHSupplierReference(e.target.value)} className={fieldControlClassName} />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label htmlFor="po-delivery-date" style={{ ...miniLbl, display: 'block' }}>Delivery Date</label>
              <input id="po-delivery-date" type="date" value={hDeliveryDate} onChange={e => setHDeliveryDate(e.target.value)} className={fieldControlClassName} />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label htmlFor="po-payment-terms-days" style={{ ...miniLbl, display: 'block' }}>Payment Terms (days)</label>
              <input id="po-payment-terms-days" value={hPaymentTermsDays} onChange={e => setHPaymentTermsDays(e.target.value)} className={fieldControlClassName} inputMode="numeric" />
            </div>
          </div>
          <div>
            <label htmlFor="po-delivery-address" style={{ ...miniLbl, display: 'block' }}>Delivery Address</label>
            <input id="po-delivery-address" value={hDeliveryAddressLine1} onChange={e => setHDeliveryAddressLine1(e.target.value)} className={fieldControlClassName} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label htmlFor="po-suburb" style={{ ...miniLbl, display: 'block' }}>Suburb</label>
              <input id="po-suburb" value={hDeliverySuburb} onChange={e => setHDeliverySuburb(e.target.value)} className={fieldControlClassName} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="po-state" style={{ ...miniLbl, display: 'block' }}>State</label>
              <input id="po-state" value={hDeliveryState} onChange={e => setHDeliveryState(e.target.value)} className={fieldControlClassName} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="po-postcode" style={{ ...miniLbl, display: 'block' }}>Postcode</label>
              <input id="po-postcode" value={hDeliveryPostcode} onChange={e => setHDeliveryPostcode(e.target.value)} className={fieldControlClassName} />
            </div>
          </div>
          <div>
            <label htmlFor="po-notes-to-supplier" style={{ ...miniLbl, display: 'block' }}>Notes to Supplier</label>
            <textarea id="po-notes-to-supplier" value={hSupplierNotes} onChange={e => setHSupplierNotes(e.target.value)} rows={2} className={fieldControlClassName} />
          </div>
          <div>
            <label htmlFor="po-internal-notes" style={{ ...miniLbl, display: 'block' }}>Internal Notes</label>
            <textarea id="po-internal-notes" value={hInternalNotes} onChange={e => setHInternalNotes(e.target.value)} rows={2} className={fieldControlClassName} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={busy} {...buttonProps('primary')}>Save</button>
            <button type="button" onClick={() => setEditingHeader(false)} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </form>
      ) : (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                  <Link href={`/commercial/purchasing/suppliers/${po.supplier_id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{po.supplier_name_snapshot ?? '—'}</Link>
                </div>
                {po.supplier_contact_name_snapshot && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{po.supplier_contact_name_snapshot}</div>}
                {(po.supplier_email_snapshot || po.supplier_phone_snapshot) && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{[po.supplier_email_snapshot, po.supplier_phone_snapshot].filter(Boolean).join(' · ')}</div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 14 }}>
                  <Link href={`/commercial/purchasing/suppliers/${po.supplier_id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{linkedSupplier?.name ?? '—'}</Link>
                </div>
                {linkedSupplier?.contact_name && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{linkedSupplier.contact_name}</div>}
                {(linkedSupplier?.email || linkedSupplier?.phone) && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{[linkedSupplier?.email, linkedSupplier?.phone].filter(Boolean).join(' · ')}</div>
                )}
              </>
            )}
          </div>
          <div>
            <div style={miniLbl}>Delivery</div>
            <div style={{ fontSize: 14 }}>{formatCommercialDate(po.delivery_date)}</div>
            {(po.delivery_address_line1 || po.delivery_suburb) && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
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
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{po.supplier_notes}</div>
            </div>
          )}
          {po.internal_notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={miniLbl}>Internal Notes</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{po.internal_notes}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <TableContainer label="Purchase order lines" minWidth={620}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className={tableStyles.num}>Qty</th>
              <th scope="col" className={tableStyles.num}>Unit Price</th>
              <th scope="col">Tax</th>
              <th scope="col" className={tableStyles.num}>Total</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <TableStateRow colSpan={6} kind="empty">No line items yet.</TableStateRow>}
            {lines.map(l => (
              <tr key={l.id}>
                <td style={{ color: 'var(--text-primary)' }}>
                  {l.description_snapshot}
                  {l.sku_snapshot && <span className={tableStyles.muted} style={{ marginLeft: 6 }}>({l.sku_snapshot})</span>}
                </td>
                <td className={tableStyles.num}>{l.quantity}{l.unit_snapshot ? ` ${l.unit_snapshot}` : ''}</td>
                <td className={tableStyles.num}>{formatMoneyCents(l.unit_price_cents, po.currency)}</td>
                <td>{l.tax_code_snapshot ? `${l.tax_code_snapshot} (${l.tax_rate_snapshot}%)` : '—'}</td>
                <td className={tableStyles.num}>{formatMoneyCents(l.line_total_cents, po.currency)}</td>
                <td className={tableStyles.actions}>
                  {isDraft && canEdit && <button type="button" onClick={() => removeLine(l.id)} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }} aria-label={`Remove line ${l.description_snapshot}`}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableContainer>

        {isDraft && canEdit && (
          <form onSubmit={addLine} aria-label="Add line item" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 16, marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 180px' }}>
              {/* C6.9 remediation — clarified wording: internal-catalogue
                  selection is explicitly optional, and a freeform
                  supplier line (the common Purchasing case — buying from
                  an external supplier, not from BrainBase's own sales
                  catalogue) is a normal, first-class path, not a
                  fallback. product_id remains fully optional in the
                  domain/API — this is a labeling change only. */}
              <label htmlFor="po-internal-product-service-optional" style={{ ...miniLbl, display: 'block' }}>Internal Product / Service (optional)</label>
              <select id="po-internal-product-service-optional" value={newProductId} onChange={e => applyProductDefaults(e.target.value)} className={fieldControlClassName}>
                <option value="">Or enter a freeform supplier line below</option>
                {products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 180px' }}>
              <label htmlFor="po-description" style={{ ...miniLbl, display: 'block' }}>Description</label>
              <input id="po-description" value={newDescription} onChange={e => setNewDescription(e.target.value)} className={fieldControlClassName} placeholder="Freeform supplier line description" />
            </div>
            <div style={{ width: 70 }}>
              <label htmlFor="po-qty" style={{ ...miniLbl, display: 'block' }}>Qty</label>
              <input id="po-qty" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} className={fieldControlClassName} inputMode="numeric" />
            </div>
            <div style={{ width: 100 }}>
              <label htmlFor="po-unit-price" style={{ ...miniLbl, display: 'block' }}>Unit Price</label>
              <input id="po-unit-price" value={newPrice} onChange={e => setNewPrice(e.target.value)} className={fieldControlClassName} placeholder="0.00" inputMode="decimal" />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label htmlFor="po-tax-code" style={{ ...miniLbl, display: 'block' }}>Tax Code</label>
              <select id="po-tax-code" value={newTaxCodeId} onChange={e => setNewTaxCodeId(e.target.value)} className={fieldControlClassName}>
                <option value="">— No tax —</option>
                {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
              </select>
            </div>
            <button type="submit" disabled={busy} {...buttonProps('primary')}>
              Add Line
            </button>
          </form>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 260, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
          <TotalRow label="Subtotal" value={formatMoneyCents(po.subtotal_cents, po.currency)} />
          <TotalRow label="Tax" value={formatMoneyCents(po.tax_cents, po.currency)} />
          <TotalRow label="Total" value={formatMoneyCents(po.total_cents, po.currency)} bold />
        </div>
      </div>

      {/* Phase C7.6C — governed PO-local commitment surface. Values come
          exclusively from the server-derived C7.6A read model. Receipts and
          explicit match allocations never participate in these monetary
          commitment values. */}
      {commitment && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', marginBottom: 20, padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={miniLbl}>Commitment</div>
            <div style={{ fontSize: 12, color: commitment.purchaseOrderStatus === 'ISSUED' ? 'var(--status-success)' : 'var(--text-muted)' }}>
              {commitment.purchaseOrderStatus === 'ISSUED' ? 'ACTIVE PURCHASE COMMITMENT' : 'NOT COMMITTED'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <div><div style={miniLbl}>Ordered</div><div style={{ fontSize: 14 }}>{formatMoneyCents(commitment.orderedTotalCents, commitment.currency)}</div></div>
            <div><div style={miniLbl}>Billed</div><div style={{ fontSize: 14 }}>{formatMoneyCents(commitment.billedTotalCents, commitment.currency)}</div></div>
            <div><div style={miniLbl}>Outstanding</div><div style={{ fontSize: 14, fontWeight: 700 }}>{formatMoneyCents(commitment.outstandingTotalCents, commitment.currency)}</div></div>
            <div><div style={miniLbl}>Effective</div><div style={{ fontSize: 14 }}>{commitment.commitmentEffectiveAt ? formatCommercialDate(commitment.commitmentEffectiveAt.slice(0, 10)) : '—'}</div></div>
            <div><div style={miniLbl}>Financial Period</div><div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{commitment.periodResolution.replaceAll('_', ' ')}</div></div>
          </div>
          {commitment.lines.map(line => (
            <div key={line.purchaseOrderLineId} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.5fr) repeat(3, minmax(110px, .8fr)) minmax(160px, 1fr) minmax(125px, .8fr)', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${BORDER}`, fontSize: 12 }}>
              <span style={{ color: 'var(--text-primary)' }}>{line.description}</span>
              <span style={{ color: 'var(--text-muted)' }}>{formatMoneyCents(line.orderedTotalCents, commitment.currency)} ordered</span>
              <span style={{ color: 'var(--text-muted)' }}>{formatMoneyCents(line.billedTotalCents, commitment.currency)} billed</span>
              <span style={{ color: 'var(--text-primary)' }}>{formatMoneyCents(line.outstandingTotalCents, commitment.currency)} outstanding</span>
              <span style={{ color: 'var(--text-muted)' }}>Cost centre: {line.effectiveCostCentreId ?? 'Unassigned'}</span>
              <span style={{ color: line.state === 'INVALID_OVERBILLED' ? 'var(--status-danger)' : line.state === 'CONSUMED' ? 'var(--status-success)' : 'var(--text-muted)', textAlign: 'right' }}>{line.state.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Phase C7.5B/C7.5C — one derived reconciliation view over the PO plus
          POSTED receipt/bill facts. This is intentionally a read model:
          no reconciliation status or progress counters are stored on the
          PO or PO-line tables. */}
      {(isIssued || isCancelled) && reconciliation && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', marginBottom: 20, padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={miniLbl}>Reconciliation</div>
            <div style={{ fontSize: 12, color: reconciliation.status === 'RECONCILED' ? 'var(--status-success)' : reconciliation.status === 'EXCEPTION' ? 'var(--status-danger)' : 'var(--status-warning)' }}>
              {reconciliation.status.replaceAll('_', ' ')}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{reconciliation.fullyReceivedLineCount} / {reconciliation.lineCount} lines fully received</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{reconciliation.fullyBilledQuantityLineCount} / {reconciliation.lineCount} lines fully billed by quantity</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{reconciliation.fullyMatchedLineCount} / {reconciliation.lineCount} lines explicitly matched</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{reconciliation.fullyBilledLineCount} / {reconciliation.lineCount} lines fully billed by value</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{reconciliation.reconciledLineCount} / {reconciliation.lineCount} lines reconciled</div>
          </div>
          {reconciliation.lines.map(line => (
            <div key={line.purchaseOrderLineId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${BORDER}`, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: 'var(--text-primary)' }}>{line.description}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{line.receivedQuantity} / {line.orderedQuantity} received</span>
              <span style={{ color: 'var(--text-secondary)' }}>{line.billedQuantity} / {line.orderedQuantity} billed qty</span>
              <span style={{ color: 'var(--text-secondary)' }}>{line.matchedQuantity} / {line.orderedQuantity} matched</span>
              <span style={{ color: 'var(--text-secondary)' }}>{formatMoneyCents(line.billedValueCents, po.currency)} / {formatMoneyCents(line.orderedValueCents, po.currency)} billed value</span>
              <span style={{ color: line.reconciliationState === 'RECONCILED' ? 'var(--status-success)' : 'var(--text-secondary)', textAlign: 'right' }}>{line.reconciliationState.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Phase C7.5D3 — explicit receipt-line <-> supplier-bill-line allocations.
          Common PO-line lineage is only a candidate relationship; a quantity is
          "matched" only after this governed allocation write succeeds. */}
      {(isIssued || isCancelled) && matchWorkspace && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', marginBottom: 20, padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={miniLbl}>Receipt ↔ Bill Matches</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{activeMatchAllocations.length} active</div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>Only explicit allocations count as matched. Sharing the same PO line does not create a match.</p>
          {matchError && <p style={{ color: 'var(--status-danger)', fontSize: 12, margin: '0 0 10px' }}>{matchError}</p>}

          {isIssued && canEdit && (
            <form onSubmit={createMatchAction} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1.2fr) minmax(150px, 1.2fr) minmax(100px, .7fr) auto', gap: 8, alignItems: 'end', marginBottom: 14 }}>
              <div>
                <div style={miniLbl}>Posted Receipt Line</div>
                <select value={matchReceiptLineId} onChange={e => { setMatchReceiptLineId(e.target.value); setMatchBillLineId(''); }} className={fieldControlClassName}>
                  <option value="">Choose receipt line…</option>
                  {availableReceiptMatchLines.map(line => <option key={line.id} value={line.id}>{line.documentNumber} · {Number(line.remainingQuantity)} remaining</option>)}
                </select>
              </div>
              <div>
                <div style={miniLbl}>Posted Bill Line</div>
                <select value={matchBillLineId} disabled={!selectedReceiptMatchLine} onChange={e => setMatchBillLineId(e.target.value)} className={fieldControlClassName}>
                  <option value="">Choose bill line…</option>
                  {availableBillMatchLines.map(line => <option key={line.id} value={line.id}>{line.documentNumber} · {Number(line.remainingQuantity)} remaining</option>)}
                </select>
              </div>
              <div>
                <div style={miniLbl}>Quantity</div>
                <input value={matchQuantity} onChange={e => setMatchQuantity(e.target.value)} inputMode="decimal" placeholder="0.0000" className={fieldControlClassName} />
              </div>
              <button type="submit" disabled={matchBusy || !matchReceiptLineId || !matchBillLineId || !matchQuantity.trim()} {...buttonProps('primary')}>Match</button>
            </form>
          )}

          {matchWorkspace.allocations.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No explicit matches yet.</p>}
          {matchWorkspace.allocations.map(a => {
            const receiptLine = matchWorkspace.receiptLines.find(line => line.id === a.purchase_receipt_line_id);
            const billLine = matchWorkspace.billLines.find(line => line.id === a.supplier_bill_line_id);
            return (
              <div key={a.id} style={{ borderTop: `1px solid ${BORDER}`, padding: '9px 0', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{receiptLine?.documentNumber ?? 'Receipt line'} ↔ {billLine?.documentNumber ?? 'Bill line'} · {Number(a.quantity_allocated)} matched</span>
                  <span style={{ color: a.reversed_at ? 'var(--text-muted)' : 'var(--status-success)' }}>{a.reversed_at ? 'REVERSED' : 'ACTIVE'}</span>
                </div>
                {a.reversal_reason && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>Reversal: {a.reversal_reason}</div>}
                {!a.reversed_at && isIssued && canEdit && reversingMatchId !== a.id && (
                  <button type="button" onClick={() => { setReversingMatchId(a.id); setMatchReversalReason(''); setMatchError(''); }} disabled={matchBusy} style={{ background: 'none', border: 'none', color: 'var(--status-warning)', fontSize: 12, padding: '5px 0 0', cursor: 'pointer' }}>Reverse match</button>
                )}
                {!a.reversed_at && reversingMatchId === a.id && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                    <input value={matchReversalReason} onChange={e => setMatchReversalReason(e.target.value)} placeholder="Reason for reversal" className={fieldControlClassName} style={{ flex: 1 }} />
                    <button type="button" onClick={() => reverseMatchAction(a.id)} disabled={matchBusy} {...buttonProps('danger')}>Confirm reversal</button>
                    <button type="button" onClick={() => { setReversingMatchId(null); setMatchReversalReason(''); }} disabled={matchBusy} {...buttonProps('secondary')}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Phase C7.3 — linked Purchase Receipts + derived received-to-
          date. Only shown once the PO has actually been issued (a
          DRAFT/PENDING_APPROVAL/APPROVED PO cannot have any receipts by
          construction — createPurchaseReceipt() rejects a non-ISSUED
          PO). "New Receipt" is offered only while ISSUED (a CANCELLED
          PO cannot accept new receipts — see postPurchaseReceiptAtomically()'s
          own PO-status guard); the receipt list itself remains visible
          after cancellation for historical record-keeping. */}
      {(isIssued || isCancelled) && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', marginBottom: 20, padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={miniLbl}>Purchase Receipts</div>
            {isIssued && canEdit && (
              <a href={`/commercial/purchasing/purchase-receipts/new?purchaseOrderId=${po.id}`} style={{ fontSize: 12, color: 'var(--brand-brainbase-accent)' }}>+ New Receipt</a>
            )}
          </div>
          {receipts.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No purchase receipts yet.</p>}
          {receipts.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <a href={`/commercial/purchasing/purchase-receipts/${r.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                {r.receipt_number ?? 'Draft'}
              </a>
              <span style={{ color: 'var(--text-secondary)' }}>{r.status}{r.received_date ? ` · ${r.received_date}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Phase C7.4 — linked Supplier Bills + derived billed-to-date
          (VALUE, not quantity — a bill is a money fact). Same visibility
          rule as the receipts panel above: only shown once ISSUED (a
          non-ISSUED PO cannot have any bills by construction —
          createSupplierBill() rejects a non-ISSUED PO); "New Bill" is
          offered only while ISSUED; the bill list itself remains visible
          after cancellation for historical record-keeping. */}
      {(isIssued || isCancelled) && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', marginBottom: 20, padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={miniLbl}>Supplier Bills</div>
            {isIssued && canEdit && (
              <a href={`/commercial/purchasing/supplier-bills/new?purchaseOrderId=${po.id}`} style={{ fontSize: 12, color: 'var(--brand-brainbase-accent)' }}>+ New Bill</a>
            )}
          </div>
          {supplierBills.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No supplier bills yet.</p>}
          {supplierBills.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <a href={`/commercial/purchasing/supplier-bills/${b.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                {b.bill_number ?? 'Draft'} — {b.supplier_invoice_number}
              </a>
              <span style={{ color: 'var(--text-secondary)' }}>{b.status}{b.status === 'POSTED' ? ` · ${formatMoneyCents(b.total_cents, po.currency)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* C6.9 remediation — Supporting Documents. Visible in every
          status (retention: attachments must stay accessible after
          issue/cancellation, never gated tighter than the PO itself).
          Upload/remove only offered while DRAFT — see the attachments
          routes' own comment for why no other status supports mutation. */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', marginBottom: 20 }}>
        <div style={{ padding: '16px 24px 0' }}>
          <div style={miniLbl}>Supporting Documents</div>
        </div>
        {uploadError && <p style={{ color: 'var(--status-danger)', fontSize: 13, margin: '8px 24px 0' }}>{uploadError}</p>}
        {attachments.length === 0 && (
          <div style={{ padding: '12px 24px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>No supporting documents yet.</div>
        )}
        {attachments.length > 0 && (
          <div style={{ padding: '8px 24px 16px' }}>
            {attachments.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontSize: 13, borderTop: `1px solid ${BORDER}` }}>
                <div>
                  <a href={`/api/commercial/purchase-orders/${id}/attachments/${a.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{a.original_filename}</a>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {ATTACHMENT_CATEGORY_LABELS[a.category]} · {formatBytes(a.size_bytes)} · {a.uploaded_by_name ?? 'Unknown'} · {formatCommercialDate(a.created_at)}
                  </div>
                </div>
                {isDraft && canEdit && (
                  <button type="button" onClick={() => removeAttachment(a.id)} disabled={uploadBusy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }}>Remove</button>
                )}
              </div>
            ))}
          </div>
        )}
        {isDraft && canEdit && (
          <form onSubmit={uploadAttachment} style={{ padding: '16px 24px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label htmlFor="po-category" style={{ ...miniLbl, display: 'block' }}>Category</label>
              <select id="po-category" value={uploadCategory} onChange={e => setUploadCategory(e.target.value as AttachmentCategory)} className={fieldControlClassName}>
                {(Object.keys(ATTACHMENT_CATEGORY_LABELS) as AttachmentCategory[]).map(c => <option key={c} value={c}>{ATTACHMENT_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 220px' }}>
              <label htmlFor="po-file" style={{ ...miniLbl, display: 'block' }}>File</label>
              <input id="po-file" type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} className={fieldControlClassName} />
            </div>
            <button type="submit" disabled={uploadBusy || !uploadFile} {...buttonProps('secondary')}>
              + Attach Document
            </button>
          </form>
        )}
      </div>

      {deliveries.length > 0 && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: '16px 24px', marginBottom: 20 }}>
          <div style={miniLbl}>Delivery History</div>
          {deliveries.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, borderTop: `1px solid ${BORDER}` }}>
              <span style={{ color: 'var(--text-secondary)' }}>{d.channel} → {d.recipient}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{new Date(d.attempted_at).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <DeliveryStatusBadge status={d.status} />
            </div>
          ))}
        </div>
      )}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
        <div style={miniLbl}>Timeline</div>
        <TimelineRow label="Created" value={po.created_at} />
        {po.submitted_at && <TimelineRow label="Submitted for approval" value={po.submitted_at} />}
        {po.approved_at && <TimelineRow label="Approved" value={po.approved_at} />}
        {po.issued_at && <TimelineRow label="Issued" value={po.issued_at} />}
        {po.cancelled_at && <TimelineRow label="Cancelled" value={po.cancelled_at} />}
        {po.return_reason && <div style={{ fontSize: 12, color: 'var(--status-warning)', marginTop: 8 }}>Returned to draft: {po.return_reason}</div>}
        {po.cancel_reason && <div style={{ fontSize: 12, color: 'var(--status-danger)', marginTop: 8 }}>Cancelled: {po.cancel_reason}</div>}
      </div>
    </div>
  );
}

// Phase C6.5 — mirrors app/commercial/quotes/[id]/page.tsx's own
// identical DeliveryStatusBadge exactly: delivery outcome → semantic tone,
// with the raw status word kept as the visible label.
const DELIVERY_STATUS_STYLE: Record<string, SemanticState> = {
  PENDING: 'inactive',
  SENT: 'success',
  DELIVERED: 'success',
  FAILED: 'error',
};
function DeliveryStatusBadge({ status }: { status: string }) {
  return <Badge state={DELIVERY_STATUS_STYLE[status] ?? DELIVERY_STATUS_STYLE.PENDING}>{status}</Badge>;
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
      <span>{label}</span><span>{new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 400, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
      <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const miniLbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };



