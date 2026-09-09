'use client';
import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge, OverdueBadge } from '../_status';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { buildInvoicePdf, type InvoicePdfSupplier } from '@/lib/commercial/invoicePdf';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/commercial/paymentMethods';
import SlidePanel from '../../_components/SlidePanel';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Invoice = {
  id: string; organisation_id: string; customer_id: string; source_quote_id: string | null;
  invoice_number: string | null; status: string;
  currency: string; issue_date: string | null; due_date: string | null; payment_terms_days: number | null;
  notes: string | null; terms: string | null;
  subtotal_cents: number; tax_cents: number; total_cents: number;
  customer_name_snapshot: string | null; billing_address_snapshot: string | null;
  email_snapshot: string | null; phone_snapshot: string | null; tax_identifier_snapshot: string | null;
  void_reason: string | null; voided_at: string | null;
};
type Line = {
  id: string; product_id: string | null; position: number; description_snapshot: string; sku_snapshot: string | null;
  unit_snapshot: string | null; quantity: number; unit_price_cents: number; tax_code_snapshot: string | null;
  tax_rate_snapshot: string; line_subtotal_cents: number; line_tax_cents: number; line_total_cents: number;
};
type Customer = { id: string; name: string };
type Product = { id: string; name: string; default_unit_price_cents: number; default_tax_code_id: string | null; sku: string | null; unit_label: string | null; active: boolean };
type TaxCode = { id: string; code: string; name: string; rate: string };
type Delivery = { id: string; channel: string; status: string; recipient: string; attempted_at: string };
type Payment = {
  id: string; amount_cents: number; currency: string; method: string; reference: string | null;
  provider: string | null; provider_reference: string | null; received_at: string;
  status: 'RECORDED' | 'REVERSED'; reversed_at: string | null; reversal_reason: string | null;
};
type PaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
type BusinessProfileResponse = {
  organisationName: string;
  profile: { tradingName: string | null; address: string | null; email: string | null; phone: string | null; abn: string | null };
};

// Phase C4.3B — client-side loader for the same rasterized Hybrid Orbit
// icon+wordmark lockup PNG the server-side email path loads via fs
// (lib/commercial/documentEmail.ts's loadBrandLockupBase64Server()).
// Mirrors app/commercial/quotes/[id]/page.tsx's own identical loader
// exactly — duplicated per-page rather than shared across client
// components, matching that existing precedent. Memoized at module
// scope so repeated downloads in one session don't re-fetch the asset.
let cachedBrandLockupBase64: string | null = null;
async function loadBrandLockupBase64Client(): Promise<string> {
  if (cachedBrandLockupBase64) return cachedBrandLockupBase64;
  const res = await fetch('/Brand/brainbase-horizontal-color-284.png');
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  cachedBrandLockupBase64 = btoa(binary);
  return cachedBrandLockupBase64;
}

// Client-side role/admin check, mirroring lib/session.ts's own
// ROLE_ORDER exactly — that module cannot be imported here directly
// (it begins with `import 'server-only'`, so bundling it into any client
// component fails the build). This is UX only: the real enforcement for
// void is authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.approve)
// inside app/api/commercial/invoices/[id]/void/route.ts.
const CLIENT_ROLE_ORDER = ['viewer', 'manager', 'admin', 'super_admin'];
function clientRoleGte(role: string | undefined, min: string): boolean {
  if (!role) return false;
  const i = CLIENT_ROLE_ORDER.indexOf(role);
  const m = CLIENT_ROLE_ORDER.indexOf(min);
  return i !== -1 && m !== -1 && i >= m;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [sourceQuoteNumber, setSourceQuoteNumber] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amountPaidCents, setAmountPaidCents] = useState(0);
  const [outstandingBalanceCents, setOutstandingBalanceCents] = useState(0);
  const [paymentState, setPaymentState] = useState<PaymentState>('UNPAID');
  const [businessProfile, setBusinessProfile] = useState<BusinessProfileResponse | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [sendResult, setSendResult] = useState('');
  const [busy, setBusy] = useState(false);

  // draft-field edit state
  const [dueDate, setDueDate] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');

  // add-line form state
  const [newProductId, setNewProductId] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newPrice, setNewPrice] = useState('');
  const [newTaxCodeId, setNewTaxCodeId] = useState('');

  // issue/void confirmation state
  const [confirmingIssue, setConfirmingIssue] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  // record-payment panel state
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentReceivedDate, setPaymentReceivedDate] = useState('');

  // reversal confirmation state — which payment (if any) is currently
  // being confirmed for reversal, and the reason entered for it.
  const [reversingPaymentId, setReversingPaymentId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  const load = useCallback(async () => {
    const [res, meRes] = await Promise.all([fetch(`/api/commercial/invoices/${id}`), fetch('/api/me')]);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setInvoice(data.invoice);
    setLines(data.lines);
    setSourceQuoteNumber(data.sourceQuoteNumber ?? null);
    setOverdue(!!data.overdue);
    setDeliveries(data.deliveries ?? []);
    setPayments(data.payments ?? []);
    setAmountPaidCents(data.amount_paid_cents ?? 0);
    setOutstandingBalanceCents(data.outstanding_balance_cents ?? data.invoice.total_cents);
    setPaymentState((data.payment_state as PaymentState) ?? 'UNPAID');
    setDueDate(data.invoice.due_date ?? '');
    setPaymentTermsDays(data.invoice.payment_terms_days != null ? String(data.invoice.payment_terms_days) : '');
    setNotes(data.invoice.notes ?? '');
    setTerms(data.invoice.terms ?? '');
    setLoading(false);
    if (meRes.ok) {
      const me = await meRes.json();
      setIsAdmin(clientRoleGte(me.role, 'admin'));
    }

    const [customersRes, productsRes, taxCodesRes, businessProfileRes] = await Promise.all([
      fetch('/api/commercial/customers'), fetch('/api/commercial/products'), fetch('/api/commercial/tax-codes'),
      fetch('/api/commercial/settings/business-profile'),
    ]);
    const customersData = await customersRes.json();
    const productsData = await productsRes.json();
    const taxCodesData = await taxCodesRes.json();
    setCustomer((customersData.customers ?? []).find((c: Customer) => c.id === data.invoice.customer_id) ?? null);
    setProducts(productsData.products ?? []);
    setTaxCodes(taxCodesData.taxCodes ?? []);
    if (businessProfileRes.ok) setBusinessProfile(await businessProfileRes.json());
  }, [id]);

  // Mirrors app/commercial/quotes/[id]/page.tsx's identical, pre-existing pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const isDraft = invoice?.status === 'DRAFT';
  const isIssued = invoice?.status === 'ISSUED';
  const isVoid = invoice?.status === 'VOID';

  function applyProductDefaults(productId: string) {
    setNewProductId(productId);
    const p = products.find(x => x.id === productId);
    if (p) {
      setNewDescription(p.name);
      setNewPrice((p.default_unit_price_cents / 100).toFixed(2));
      setNewTaxCodeId(p.default_tax_code_id ?? '');
    }
  }

  async function saveDraftFields() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/invoices/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: dueDate || null, paymentTermsDays: paymentTermsDays ? Number(paymentTermsDays) : null, notes: notes || null, terms: terms || null }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to save.'); return; }
    load();
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/invoices/${id}/lines`, {
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
    setBusy(true);
    await fetch(`/api/commercial/invoices/${id}/lines/${lineId}`, { method: 'DELETE' });
    setBusy(false);
    load();
  }

  // Phase C4.2 §16 — the confirmation step and the due-date requirement
  // are both surfaced client-side for UX, but the server
  // (issueInvoice()) remains the sole authority: a due-date-less invoice
  // is rejected there regardless of what this button allows. A 409
  // response (see app/api/commercial/invoices/[id]/issue/route.ts) means
  // someone else's request won the same-invoice race — shown as a plain
  // "someone else already issued this invoice, refreshing…" message, not
  // a raw error, and never auto-retried.
  async function issueInvoice() {
    setBusy(true); setActionError(''); setConfirmingIssue(false);
    const res = await fetch(`/api/commercial/invoices/${id}/issue`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (res.status === 409) setActionError('This invoice was just issued by another request. Refreshing…');
      else setActionError(data.error ?? 'Failed to issue invoice.');
      load();
      return;
    }
    load();
  }

  async function voidInvoiceAction() {
    if (!voidReason.trim()) { setActionError('A void reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/invoices/${id}/void`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: voidReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to void invoice.'); return; }
    setConfirmingVoid(false); setVoidReason('');
    load();
  }

  // Phase C5.2 — server remains authoritative for every rule this form
  // hints at client-side (positive amount, valid method, no overpayment,
  // ISSUED-only): recordInvoicePayment() (lib/commercial/payments.ts)
  // re-validates and re-derives everything itself. This handler only
  // shapes the request and surfaces whatever error the server returns.
  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentMethod) { setActionError('A payment method is required.'); return; }
    const amountCents = Math.round(parseFloat(paymentAmount || '0') * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) { setActionError('Enter a valid payment amount.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/invoices/${id}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_cents: amountCents,
        method: paymentMethod,
        reference: paymentReference || null,
        received_at: paymentReceivedDate ? new Date(paymentReceivedDate).toISOString() : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to record payment.'); return; }
    setShowRecordPayment(false);
    setPaymentAmount(''); setPaymentMethod(''); setPaymentReference(''); setPaymentReceivedDate('');
    load();
  }

  async function reversePayment(paymentId: string) {
    if (!reversalReason.trim()) { setActionError('A reversal reason is required.'); return; }
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/invoices/${id}/payments/${paymentId}/reverse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reversalReason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to reverse payment.'); return; }
    setReversingPaymentId(null); setReversalReason('');
    load();
  }

  async function deleteDraft() {
    setBusy(true);
    const res = await fetch(`/api/commercial/invoices/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.push('/commercial/invoices');
  }

  // Phase C4.3B — builds through the exact same lib/commercial/invoicePdf.ts
  // buildInvoicePdf() the email attachment uses server-side, fed this
  // invoice's own persisted snapshot/total fields (never live customer/
  // product values, never recomputed here) plus the org's CURRENT
  // business profile (the seller's own letterhead is not a per-invoice
  // snapshot concern). Available for ISSUED and VOID — never DRAFT,
  // since a draft has no invoice_number and nothing locked to show.
  async function downloadPdf() {
    if (!invoice) return;
    const brandLockupBase64 = await loadBrandLockupBase64Client();
    const supplier: InvoicePdfSupplier = {
      displayName: businessProfile?.profile.tradingName ?? businessProfile?.organisationName ?? 'BRΛINBΛSE',
      address: businessProfile?.profile.address ?? null,
      email: businessProfile?.profile.email ?? null,
      phone: businessProfile?.profile.phone ?? null,
      abn: businessProfile?.profile.abn ?? null,
    };
    const bytes = await buildInvoicePdf({
      invoice: { ...invoice, source_quote_number: sourceQuoteNumber },
      lines,
      supplier,
      brandLockupBase64,
    });
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoice_number ?? 'invoice-draft'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendEmail() {
    setBusy(true); setActionError(''); setSendResult('');
    const res = await fetch(`/api/commercial/invoices/${id}/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'EMAIL' }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setActionError(data.error ?? 'Failed to send invoice email.');
      return;
    }
    setSendResult('Invoice emailed successfully.');
    load();
  }

  if (loading) return <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>;
  if (!invoice) return <div style={{ color: '#6b7280', fontSize: 14 }}>Invoice not found.</div>;

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/commercial/invoices" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Invoices</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 8px', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            {invoice.invoice_number ?? 'Draft — number pending'}
          </h1>
          <StatusBadge status={invoice.status} />
          {overdue && <OverdueBadge />}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {!isDraft && <button onClick={downloadPdf} disabled={busy} style={btn('#1f2937')}>Download PDF</button>}
          {isIssued && invoice.email_snapshot && (
            <button onClick={sendEmail} disabled={busy} style={btn('#1f2937')}>
              {deliveries.length === 0 ? 'Send Email' : 'Resend Email'}
            </button>
          )}
          {isDraft && <button onClick={deleteDraft} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Delete Draft</button>}
          {isDraft && !confirmingIssue && (
            <button onClick={() => setConfirmingIssue(true)} disabled={busy || !dueDate} style={btn('#1a6aff')}>Issue Invoice</button>
          )}
          {isIssued && outstandingBalanceCents > 0 && (
            <button onClick={() => setShowRecordPayment(true)} disabled={busy} style={btn('#1a6aff')}>Record Payment</button>
          )}
          {isIssued && isAdmin && !confirmingVoid && (
            <button
              onClick={() => setConfirmingVoid(true)}
              disabled={busy || amountPaidCents > 0}
              title={amountPaidCents > 0 ? 'Reverse all recorded payments before voiding this invoice.' : undefined}
              style={btn('rgba(239,68,68,0.15)', '#f87171')}
            >
              Void Invoice
            </button>
          )}
        </div>
      </div>
      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 16px' }}>{actionError}</p>}
      {sendResult && <p style={{ color: '#4ade80', fontSize: 13, margin: '0 0 16px' }}>{sendResult}</p>}
      {isDraft && !dueDate && (
        <p style={{ color: '#fbbf24', fontSize: 13, margin: '0 0 16px' }}>Set a due date before this invoice can be issued.</p>
      )}
      {isIssued && isAdmin && amountPaidCents > 0 && (
        <p style={{ color: '#fbbf24', fontSize: 13, margin: '0 0 16px' }}>
          This invoice has recorded payments and cannot be voided. Reverse the payment(s) below first.
        </p>
      )}

      {confirmingIssue && (
        <div style={{ background: 'rgba(26,106,255,0.08)', border: '1px solid rgba(26,106,255,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 12px' }}>
            Issuing allocates a permanent invoice number and locks this document — the customer, lines, and totals
            can no longer be edited afterward. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={issueInvoice} disabled={busy} style={btn('#1a6aff')}>Yes, Issue Invoice</button>
            <button onClick={() => setConfirmingIssue(false)} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingVoid && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: '#f9fafb', margin: '0 0 4px' }}>
            Voiding this invoice changes its BrainBase document state only. Payment/refund handling is not part of this phase.
          </p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>The invoice number and totals are retained for the record.</p>
          <label style={lbl}>Reason (required)</label>
          <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', marginBottom: 12 }} placeholder="Why is this invoice being voided?" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={voidInvoiceAction} disabled={busy || !voidReason.trim()} style={btn('#f87171', '#1a0505')}>Confirm Void</button>
            <button onClick={() => { setConfirmingVoid(false); setVoidReason(''); }} disabled={busy} style={btn('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      {isVoid && invoice.void_reason && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 24px', marginBottom: 20 }}>
          <div style={miniLbl}>Void Reason</div>
          <p style={{ fontSize: 13, color: '#9ca3af', margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{invoice.void_reason}</p>
          {invoice.voided_at && <div style={{ fontSize: 12, color: '#6b7280' }}>Voided {formatCommercialDate(invoice.voided_at)}</div>}
        </div>
      )}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={miniLbl}>Customer</div>
          <div style={{ fontSize: 14 }}>
            {isDraft ? (
              <Link href={`/commercial/customers/${invoice.customer_id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{customer?.name ?? '—'}</Link>
            ) : (invoice.customer_name_snapshot ?? customer?.name ?? '—')}
          </div>
          {!isDraft && invoice.billing_address_snapshot && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{invoice.billing_address_snapshot}</div>}
        </div>
        <div>
          <div style={miniLbl}>Source Quote</div>
          <div style={{ fontSize: 14 }}>
            {invoice.source_quote_id ? (
              <Link href={`/commercial/quotes/${invoice.source_quote_id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{sourceQuoteNumber ?? 'View quote →'}</Link>
            ) : <span style={{ color: '#4b5563' }}>Standalone (no source quote)</span>}
          </div>
        </div>
        <div>
          <div style={miniLbl}>Issue Date</div>
          <div style={{ fontSize: 14 }}>{invoice.issue_date ? formatCommercialDate(invoice.issue_date) : <span style={{ color: '#4b5563' }}>Not yet issued</span>}</div>
        </div>
        <div>
          <div style={miniLbl}>Due Date</div>
          {isDraft ? (
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} onBlur={saveDraftFields} style={sel} />
          ) : (
            <div style={{ fontSize: 14 }}>{invoice.due_date ? formatCommercialDate(invoice.due_date) : '—'}</div>
          )}
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                <td style={td}>{formatMoneyCents(l.unit_price_cents, invoice.currency)}</td>
                <td style={td}>{l.tax_code_snapshot ? `${l.tax_code_snapshot} (${l.tax_rate_snapshot}%)` : '—'}</td>
                <td style={td}>{formatMoneyCents(l.line_total_cents, invoice.currency)}</td>
                <td style={{ padding: '12px 16px' }}>
                  {isDraft && <button onClick={() => removeLine(l.id)} disabled={busy} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', padding: 0 }}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isDraft && (
          <form onSubmit={addLine} style={{ padding: '16px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 180px' }}>
              <div style={miniLbl}>Product / Service</div>
              <select value={newProductId} onChange={e => applyProductDefaults(e.target.value)} style={sel}>
                <option value="">— Freeform line —</option>
                {products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 180px' }}>
              <div style={miniLbl}>Description</div>
              <input value={newDescription} onChange={e => setNewDescription(e.target.value)} style={sel} placeholder="Line description" />
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
        <div style={{ width: 280, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px' }}>
          <TotalRow label="Subtotal" value={formatMoneyCents(invoice.subtotal_cents, invoice.currency)} />
          <TotalRow label="GST / Tax" value={formatMoneyCents(invoice.tax_cents, invoice.currency)} />
          <TotalRow label="Total" value={formatMoneyCents(invoice.total_cents, invoice.currency)} bold />
          {!isDraft && (
            <>
              <div style={{ borderTop: `1px solid ${BORDER}`, margin: '8px 0' }} />
              <TotalRow label="Amount Paid" value={formatMoneyCents(amountPaidCents, invoice.currency)} />
              <TotalRow label="Balance Due" value={formatMoneyCents(outstandingBalanceCents, invoice.currency)} bold />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <PaymentStateBadge state={paymentState} />
              </div>
            </>
          )}
        </div>
      </div>

      {!isDraft && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 600, color: '#f9fafb' }}>Payment History</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Received', 'Amount', 'Method', 'Reference', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={6} style={empty}>No payments recorded yet.</td></tr>}
              {payments.map((p, i) => (
                <Fragment key={p.id}>
                  <tr style={{ borderBottom: (reversingPaymentId === p.id || i < payments.length - 1) ? `1px solid ${BORDER}` : 'none' }}>
                    <td style={td}>{formatCommercialDate(p.received_at)}</td>
                    <td style={td}>{formatMoneyCents(p.amount_cents, p.currency)}</td>
                    <td style={td}>{p.method.replaceAll('_', ' ')}</td>
                    <td style={td}>{p.reference ?? '—'}</td>
                    <td style={td}>
                      {p.status === 'RECORDED'
                        ? <span style={{ color: '#4ade80' }}>Recorded</span>
                        : <span style={{ color: '#f87171' }}>Reversed{p.reversal_reason ? `: ${p.reversal_reason}` : ''}</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {p.status === 'RECORDED' && isAdmin && reversingPaymentId !== p.id && (
                        <button onClick={() => { setReversingPaymentId(p.id); setReversalReason(''); setActionError(''); }} disabled={busy} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', padding: 0 }}>Reverse Payment</button>
                      )}
                    </td>
                  </tr>
                  {reversingPaymentId === p.id && (
                    <tr style={{ borderBottom: i < payments.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                      <td colSpan={6} style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.06)' }}>
                        <label style={lbl}>Reason (required)</label>
                        <textarea value={reversalReason} onChange={e => setReversalReason(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', marginBottom: 10 }} placeholder="Why is this payment being reversed?" />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => reversePayment(p.id)} disabled={busy || !reversalReason.trim()} style={btn('#f87171', '#1a0505')}>Confirm Reversal</button>
                          <button onClick={() => { setReversingPaymentId(null); setReversalReason(''); }} disabled={busy} style={btn('#1f2937')}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlidePanel open={showRecordPayment} onClose={() => setShowRecordPayment(false)} title="Record Payment">
        <form onSubmit={recordPayment} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={lbl}>Amount</label>
            <input
              value={paymentAmount}
              onChange={e => setPaymentAmount(e.target.value)}
              style={sel}
              placeholder={(outstandingBalanceCents / 100).toFixed(2)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label style={lbl}>Payment Method</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} style={sel}>
              <option value="">— Select —</option>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Reference</label>
            <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} style={sel} placeholder="e.g. bank reference, receipt no." />
          </div>
          <div>
            <label style={lbl}>Received Date</label>
            <input type="date" value={paymentReceivedDate} onChange={e => setPaymentReceivedDate(e.target.value)} style={sel} />
          </div>
          <button type="submit" disabled={busy} style={{ padding: '10px 16px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Record Payment
          </button>
        </form>
      </SlidePanel>

      {isDraft ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Payment Terms (days)</label>
              <input value={paymentTermsDays} onChange={e => setPaymentTermsDays(e.target.value)} onBlur={saveDraftFields} style={sel} placeholder="e.g. 14" inputMode="numeric" />
            </div>
          </div>
          <div>
            <label style={lbl}>Notes (internal)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={saveDraftFields} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div>
            <label style={lbl}>Terms (shown on the invoice)</label>
            <textarea value={terms} onChange={e => setTerms(e.target.value)} onBlur={saveDraftFields} rows={3} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>
      ) : (invoice.notes || invoice.terms) && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
          {invoice.notes && <><div style={miniLbl}>Notes</div><p style={{ fontSize: 13, color: '#9ca3af', margin: '4px 0 16px', whiteSpace: 'pre-wrap' }}>{invoice.notes}</p></>}
          {invoice.terms && <><div style={miniLbl}>Terms</div><p style={{ fontSize: 13, color: '#9ca3af', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{invoice.terms}</p></>}
        </div>
      )}
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

// Phase C5.2 — a purely display label for the derived payment_state
// value the API returns. Never persisted, never part of InvoiceStatus.
function PaymentStateBadge({ state }: { state: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    UNPAID: { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Unpaid' },
    PARTIALLY_PAID: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'Partially Paid' },
    PAID: { bg: 'rgba(74,222,128,0.15)', color: '#4ade80', label: 'Paid' },
  };
  const s = styles[state] ?? styles.UNPAID;
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {s.label}
    </span>
  );
}

const lbl: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const miniLbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '28px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
const sel: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 13, boxSizing: 'border-box' };
function btn(bg: string, color = '#fff'): React.CSSProperties {
  return { padding: '8px 16px', background: bg, color, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
}
