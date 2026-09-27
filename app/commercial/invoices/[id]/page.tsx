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
import {
  Badge,
  Field as AppField,
  FormActions,
  FormError,
  PageHeader,
  StateMessage,
  TableContainer,
  TableStateRow,
  buttonProps,
  fieldControlClassName,
  tableStyles,
  type SemanticState,
} from '@/components/ui/app';

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

  if (loading) return <StateMessage kind="loading" title="Loading invoice…" size="page" />;
  if (!invoice) {
    return (
      <StateMessage
        kind="empty"
        size="page"
        title="Invoice not found."
        action={<Link href="/commercial/invoices">Back to invoices</Link>}
      />
    );
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHeader
        eyebrow={<Link href="/commercial/invoices">← Invoices</Link>}
        title={invoice.invoice_number ?? 'Draft — number pending'}
        meta={
          <>
            <StatusBadge status={invoice.status} />
            {overdue && <OverdueBadge />}
          </>
        }
        actions={
          <>
            {!isDraft && <button type="button" onClick={downloadPdf} disabled={busy} {...buttonProps('secondary')}>Download PDF</button>}
            {isIssued && invoice.email_snapshot && (
              <button type="button" onClick={sendEmail} disabled={busy} {...buttonProps('secondary')}>
                {deliveries.length === 0 ? 'Send Email' : 'Resend Email'}
              </button>
            )}
            {isDraft && <button type="button" onClick={deleteDraft} disabled={busy} {...buttonProps('danger')}>Delete Draft</button>}
            {isDraft && !confirmingIssue && (
              <button type="button" onClick={() => setConfirmingIssue(true)} disabled={busy || !dueDate} {...buttonProps('primary')}>Issue Invoice</button>
            )}
            {isIssued && outstandingBalanceCents > 0 && (
              <button type="button" onClick={() => setShowRecordPayment(true)} disabled={busy} {...buttonProps('primary')}>Record Payment</button>
            )}
            {isIssued && isAdmin && !confirmingVoid && (
              <button
                type="button"
                onClick={() => setConfirmingVoid(true)}
                disabled={busy || amountPaidCents > 0}
                title={amountPaidCents > 0 ? 'Reverse all recorded payments before voiding this invoice.' : undefined}
                {...buttonProps('danger')}
              >
                Void Invoice
              </button>
            )}
          </>
        }
      />
      {actionError && <div style={{ marginBottom: 16 }}><FormError>{actionError}</FormError></div>}
      {sendResult && <p role="status" style={{ color: 'var(--status-success)', fontSize: 13, margin: '0 0 16px' }}>{sendResult}</p>}
      {isDraft && !dueDate && (
        <p style={{ color: 'var(--status-warning)', fontSize: 13, margin: '0 0 16px' }}>Set a due date before this invoice can be issued.</p>
      )}
      {isIssued && isAdmin && amountPaidCents > 0 && (
        <p style={{ color: 'var(--status-warning)', fontSize: 13, margin: '0 0 16px' }}>
          This invoice has recorded payments and cannot be voided. Reverse the payment(s) below first.
        </p>
      )}

      {confirmingIssue && (
        <div role="group" aria-label="Confirm issue" style={{ ...SECTION, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            Issuing allocates a permanent invoice number and locks this document — the customer, lines, and totals
            can no longer be edited afterward. Continue?
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={issueInvoice} disabled={busy} {...buttonProps('primary')}>Yes, Issue Invoice</button>
            <button type="button" onClick={() => setConfirmingIssue(false)} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {confirmingVoid && (
        <div role="group" aria-label="Confirm void" style={{ background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Voiding this invoice changes its BrainBase document state only. Payment/refund handling is not part of this phase.
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>The invoice number and totals are retained for the record.</p>
          <AppField label="Reason" required>
            {control => (
              <textarea {...control} value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={2} className={fieldControlClassName} placeholder="Why is this invoice being voided?" />
            )}
          </AppField>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={voidInvoiceAction} disabled={busy || !voidReason.trim()} {...buttonProps('danger')}>Confirm Void</button>
            <button type="button" onClick={() => { setConfirmingVoid(false); setVoidReason(''); }} disabled={busy} {...buttonProps('secondary')}>Cancel</button>
          </div>
        </div>
      )}

      {isVoid && invoice.void_reason && (
        <div style={{ ...SECTION, marginBottom: 20 }}>
          <div style={miniLbl}>Void Reason</div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{invoice.void_reason}</p>
          {invoice.voided_at && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Voided {formatCommercialDate(invoice.voided_at)}</div>}
        </div>
      )}

      <div style={{ ...SECTION, marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div>
          <div style={miniLbl}>Customer</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
            {isDraft ? (
              <Link href={`/commercial/customers/${invoice.customer_id}`} style={{ color: 'var(--text-primary)' }}>{customer?.name ?? '—'}</Link>
            ) : (invoice.customer_name_snapshot ?? customer?.name ?? '—')}
          </div>
          {!isDraft && invoice.billing_address_snapshot && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{invoice.billing_address_snapshot}</div>}
        </div>
        <div>
          <div style={miniLbl}>Source Quote</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
            {invoice.source_quote_id ? (
              <Link href={`/commercial/quotes/${invoice.source_quote_id}`} style={{ color: 'var(--text-primary)' }}>{sourceQuoteNumber ?? 'View quote →'}</Link>
            ) : <span style={{ color: 'var(--text-muted)' }}>Standalone (no source quote)</span>}
          </div>
        </div>
        <div>
          <div style={miniLbl}>Issue Date</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{invoice.issue_date ? formatCommercialDate(invoice.issue_date) : <span style={{ color: 'var(--text-muted)' }}>Not yet issued</span>}</div>
        </div>
        <div>
          {isDraft ? (
            <AppField label="Due Date">
              {control => <input {...control} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} onBlur={saveDraftFields} className={fieldControlClassName} />}
            </AppField>
          ) : (
            <>
              <div style={miniLbl}>Due Date</div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{invoice.due_date ? formatCommercialDate(invoice.due_date) : '—'}</div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <TableContainer label="Invoice line items" minWidth={620}>
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
                  <td className={tableStyles.num}>{formatMoneyCents(l.unit_price_cents, invoice.currency)}</td>
                  <td>{l.tax_code_snapshot ? `${l.tax_code_snapshot} (${l.tax_rate_snapshot}%)` : '—'}</td>
                  <td className={tableStyles.num}>{formatMoneyCents(l.line_total_cents, invoice.currency)}</td>
                  <td className={tableStyles.actions}>
                    {isDraft && <button type="button" onClick={() => removeLine(l.id)} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }} aria-label={`Remove line ${l.description_snapshot}`}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>

        {isDraft && (
          <form onSubmit={addLine} aria-label="Add line item" style={{ ...SECTION, padding: 16, marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 180px' }}>
              <AppField label="Product / Service">
                {control => (
                  <select {...control} value={newProductId} onChange={e => applyProductDefaults(e.target.value)} className={fieldControlClassName}>
                    <option value="">— Freeform line —</option>
                    {products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </AppField>
            </div>
            <div style={{ flex: '2 1 180px' }}>
              <AppField label="Description">
                {control => <input {...control} value={newDescription} onChange={e => setNewDescription(e.target.value)} className={fieldControlClassName} placeholder="Line description" />}
              </AppField>
            </div>
            <div style={{ width: 70 }}>
              <AppField label="Qty">
                {control => <input {...control} value={newQuantity} onChange={e => setNewQuantity(e.target.value)} className={fieldControlClassName} inputMode="numeric" />}
              </AppField>
            </div>
            <div style={{ width: 100 }}>
              <AppField label="Unit Price">
                {control => <input {...control} value={newPrice} onChange={e => setNewPrice(e.target.value)} className={fieldControlClassName} placeholder="0.00" inputMode="decimal" />}
              </AppField>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <AppField label="Tax Code">
                {control => (
                  <select {...control} value={newTaxCodeId} onChange={e => setNewTaxCodeId(e.target.value)} className={fieldControlClassName}>
                    <option value="">— No tax —</option>
                    {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
                  </select>
                )}
              </AppField>
            </div>
            <button type="submit" disabled={busy} {...buttonProps('primary')}>
              Add Line
            </button>
          </form>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 280, maxWidth: '100%', ...SECTION, padding: '16px 20px' }}>
          <TotalRow label="Subtotal" value={formatMoneyCents(invoice.subtotal_cents, invoice.currency)} />
          <TotalRow label="GST / Tax" value={formatMoneyCents(invoice.tax_cents, invoice.currency)} />
          <TotalRow label="Total" value={formatMoneyCents(invoice.total_cents, invoice.currency)} bold />
          {!isDraft && (
            <>
              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
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
        <section aria-labelledby="invoice-payment-history" style={{ marginBottom: 20 }}>
          <h2 id="invoice-payment-history" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>Payment History</h2>
          <TableContainer label="Payment history" minWidth={620}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col" className={tableStyles.num}>Amount</th>
                  <th scope="col">Method</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && <TableStateRow colSpan={6} kind="empty">No payments recorded yet.</TableStateRow>}
                {payments.map(p => (
                  <Fragment key={p.id}>
                    <tr>
                      <td>{formatCommercialDate(p.received_at)}</td>
                      <td className={tableStyles.num}>{formatMoneyCents(p.amount_cents, p.currency)}</td>
                      <td>{p.method.replaceAll('_', ' ')}</td>
                      <td>{p.reference ?? '—'}</td>
                      <td>
                        {p.status === 'RECORDED'
                          ? <span style={{ color: 'var(--status-success)' }}>Recorded</span>
                          : <span style={{ color: 'var(--status-danger)' }}>Reversed{p.reversal_reason ? `: ${p.reversal_reason}` : ''}</span>}
                      </td>
                      <td className={tableStyles.actions}>
                        {p.status === 'RECORDED' && isAdmin && reversingPaymentId !== p.id && (
                          <button type="button" onClick={() => { setReversingPaymentId(p.id); setReversalReason(''); setActionError(''); }} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }}>Reverse Payment</button>
                        )}
                      </td>
                    </tr>
                    {reversingPaymentId === p.id && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--status-danger-muted)' }}>
                          <AppField label="Reason" required>
                            {control => (
                              <textarea {...control} value={reversalReason} onChange={e => setReversalReason(e.target.value)} rows={2} className={fieldControlClassName} placeholder="Why is this payment being reversed?" />
                            )}
                          </AppField>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            <button type="button" onClick={() => reversePayment(p.id)} disabled={busy || !reversalReason.trim()} {...buttonProps('danger', 'sm')}>Confirm Reversal</button>
                            <button type="button" onClick={() => { setReversingPaymentId(null); setReversalReason(''); }} disabled={busy} {...buttonProps('secondary', 'sm')}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </section>
      )}

      <SlidePanel open={showRecordPayment} onClose={() => setShowRecordPayment(false)} title="Record Payment">
        <form onSubmit={recordPayment} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AppField label="Amount">
            {control => (
              <input
                {...control}
                value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)}
                className={fieldControlClassName}
                placeholder={(outstandingBalanceCents / 100).toFixed(2)}
                inputMode="decimal"
              />
            )}
          </AppField>
          <AppField label="Payment Method">
            {control => (
              <select {...control} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className={fieldControlClassName}>
                <option value="">— Select —</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}
              </select>
            )}
          </AppField>
          <AppField label="Reference">
            {control => <input {...control} value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className={fieldControlClassName} placeholder="e.g. bank reference, receipt no." />}
          </AppField>
          <AppField label="Received Date">
            {control => <input {...control} type="date" value={paymentReceivedDate} onChange={e => setPaymentReceivedDate(e.target.value)} className={fieldControlClassName} />}
          </AppField>
          <FormActions align="stretch">
            <button type="submit" disabled={busy} {...buttonProps('primary')}>
              Record Payment
            </button>
          </FormActions>
        </form>
      </SlidePanel>

      {isDraft ? (
        <div style={{ ...SECTION, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ maxWidth: 240 }}>
            <AppField label="Payment Terms (days)">
              {control => <input {...control} value={paymentTermsDays} onChange={e => setPaymentTermsDays(e.target.value)} onBlur={saveDraftFields} className={fieldControlClassName} placeholder="e.g. 14" inputMode="numeric" />}
            </AppField>
          </div>
          <AppField label="Notes (internal)">
            {control => <textarea {...control} value={notes} onChange={e => setNotes(e.target.value)} onBlur={saveDraftFields} rows={2} className={fieldControlClassName} />}
          </AppField>
          <AppField label="Terms (shown on the invoice)">
            {control => <textarea {...control} value={terms} onChange={e => setTerms(e.target.value)} onBlur={saveDraftFields} rows={3} className={fieldControlClassName} />}
          </AppField>
        </div>
      ) : (invoice.notes || invoice.terms) && (
        <div style={SECTION}>
          {invoice.notes && <><div style={miniLbl}>Notes</div><p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 16px', whiteSpace: 'pre-wrap' }}>{invoice.notes}</p></>}
          {invoice.terms && <><div style={miniLbl}>Terms</div><p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{invoice.terms}</p></>}
        </div>
      )}
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

// Phase C5.2 — a purely display label for the derived payment_state
// value the API returns. Never persisted, never part of InvoiceStatus.
// Phase C (work surfaces): canonical semantic Badge; the payment word
// stays the visible label.
const PAYMENT_STATE: Record<string, { state: SemanticState; label: string }> = {
  UNPAID: { state: 'inactive', label: 'Unpaid' },
  PARTIALLY_PAID: { state: 'warning', label: 'Partially Paid' },
  PAID: { state: 'success', label: 'Paid' },
};

function PaymentStateBadge({ state }: { state: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' }) {
  const s = PAYMENT_STATE[state] ?? PAYMENT_STATE.UNPAID;
  return <Badge state={s.state}>{s.label}</Badge>;
}

const SECTION: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' };
const miniLbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
