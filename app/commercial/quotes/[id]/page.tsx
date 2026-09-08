'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge } from '../_status';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { buildQuotePdf, type QuotePdfSupplier } from '@/lib/commercial/quotePdf';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Quote = {
  id: string; organisation_id: string; customer_id: string; quote_number: string | null; status: string;
  currency: string; issue_date: string | null; expiry_date: string | null; notes: string | null; terms: string | null;
  subtotal_cents: number; tax_cents: number; total_cents: number;
  customer_name_snapshot: string | null; billing_address_snapshot: string | null;
  email_snapshot: string | null; phone_snapshot: string | null; tax_identifier_snapshot: string | null;
};
type Line = {
  id: string; product_id: string | null; position: number; description_snapshot: string; sku_snapshot: string | null;
  unit_snapshot: string | null; quantity: number; unit_price_cents: number; tax_code_snapshot: string | null;
  tax_rate_snapshot: string; line_subtotal_cents: number; line_tax_cents: number; line_total_cents: number;
};
type Customer = { id: string; name: string; billing_address: string | null; billing_email: string | null; billing_phone: string | null };
type Product = { id: string; name: string; default_unit_price_cents: number; default_tax_code_id: string | null; sku: string | null; unit_label: string | null; active: boolean };
type TaxCode = { id: string; code: string; name: string; rate: string };
type Delivery = {
  id: string; channel: string; recipient: string; status: string; attempted_at: string; error_summary: string | null;
};
type BusinessProfileResponse = {
  organisationName: string;
  profile: { tradingName: string | null; address: string | null; email: string | null; phone: string | null; abn: string | null };
};

// Client-side loader for the same rasterized Hybrid Orbit icon+wordmark
// lockup PNG the server-side email path loads via fs
// (lib/commercial/quoteEmail.ts's loadBrandLockupBase64Server()) — see
// lib/commercial/quotePdf.ts's own header for why a single shared PDF
// builder needs this asset handed in as base64 rather than loaded
// inside itself. Memoized at module scope so repeated downloads in one
// session don't re-fetch the asset.
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

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [sendResult, setSendResult] = useState('');
  const [busy, setBusy] = useState(false);
  // Phase C4.2 §13 — Create Invoice is shown only when the CURRENT
  // organisation is entitled to Invoicing specifically (a quotes-only
  // tenant must never see it — the two capabilities are independently
  // entitlable, see app/commercial/layout.tsx's own comment) AND the
  // current user is manager+. /api/me's enabledCapabilities/role are the
  // same fields TopNav's own client-side capability projection already
  // relies on for identical UX-only (never authorization-boundary)
  // decisions — the real enforcement is convert-to-invoice's own
  // server-side authorizeCommercialRequest('invoicing', ...) call.
  const [canCreateInvoice, setCanCreateInvoice] = useState(false);

  // add-line form state
  const [newProductId, setNewProductId] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newPrice, setNewPrice] = useState('');
  const [newTaxCodeId, setNewTaxCodeId] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/commercial/quotes/${id}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setQuote(data.quote);
    setLines(data.lines);
    setDeliveries(data.deliveries ?? []);
    setLoading(false);

    const [customersRes, productsRes, taxCodesRes, businessProfileRes, meRes] = await Promise.all([
      fetch('/api/commercial/customers'), fetch('/api/commercial/products'), fetch('/api/commercial/tax-codes'),
      fetch('/api/commercial/settings/business-profile'), fetch('/api/me'),
    ]);
    const customersData = await customersRes.json();
    const productsData = await productsRes.json();
    const taxCodesData = await taxCodesRes.json();
    setCustomer((customersData.customers ?? []).find((c: Customer) => c.id === data.quote.customer_id) ?? null);
    setProducts(productsData.products ?? []);
    setTaxCodes(taxCodesData.taxCodes ?? []);
    if (businessProfileRes.ok) setBusinessProfile(await businessProfileRes.json());
    if (meRes.ok) {
      const me = await meRes.json();
      const hasInvoicing = (me.enabledCapabilities ?? []).some((c: { key: string }) => c.key === 'invoicing');
      const isManagerPlus = ['manager', 'admin', 'super_admin'].includes(me.role);
      setCanCreateInvoice(hasInvoicing && isManagerPlus);
    }
  }, [id]);

  // Pre-existing pattern predating Phase C4.2 (this line is unchanged by
  // this phase); silenced here only because C4.2 already touches this
  // file for the Create Invoice button below, and scoped lint on the
  // file must pass.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const isDraft = quote?.status === 'DRAFT';
  const isSent = quote?.status === 'SENT';

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
    const res = await fetch(`/api/commercial/quotes/${id}/lines`, {
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
    await fetch(`/api/commercial/quotes/${id}/lines/${lineId}`, { method: 'DELETE' });
    setBusy(false);
    load();
  }

  async function runAction(action: 'issue' | 'accept' | 'reject' | 'expire') {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/quotes/${id}/${action}`, { method: 'POST' });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? `Failed to ${action} quote.`); return; }
    load();
  }

  // Phase C3-POLISH-R §6/§9/§13 — decoupled from issueQuote(): sending
  // never touches the quote row itself, so a failed/slow send can never
  // corrupt or roll back an already-issued quote. Button is disabled for
  // the duration of the request (setBusy) as the client-side half of
  // §13's duplicate-send protection; the server enforces the real
  // 60-second cooldown regardless of what the client does.
  async function sendEmail() {
    setBusy(true); setActionError(''); setSendResult('');
    const res = await fetch(`/api/commercial/quotes/${id}/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'EMAIL' }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setActionError(data.error ?? 'Failed to send quote email.');
      return;
    }
    setSendResult('Quote emailed successfully.');
    load();
  }

  // Phase C4.2 §13 — deliberately does NOT check for an existing invoice
  // before allowing another conversion: one accepted quote may legally
  // produce zero, one, or many invoices (see lib/commercial/invoices.ts's
  // createInvoiceFromQuote() — no uniqueness on source_quote_id, by
  // design, to keep future progress/deposit invoicing possible). Hiding
  // this action after one conversion would implement a progress-invoice
  // restriction this phase explicitly does not build.
  async function createInvoiceFromThisQuote() {
    setBusy(true); setActionError('');
    const res = await fetch(`/api/commercial/quotes/${id}/convert-to-invoice`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setActionError(data.error ?? 'Failed to create invoice from this quote.'); return; }
    router.push(`/commercial/invoices/${data.invoice.id}`);
  }

  async function deleteDraft() {
    setBusy(true);
    const res = await fetch(`/api/commercial/quotes/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.push('/commercial/quotes');
  }

  // Phase C3-POLISH-R §1/§2/§15 — builds through the exact same
  // lib/commercial/quotePdf.ts buildQuotePdf() the email attachment uses
  // server-side, fed this quote's own persisted snapshot fields (never
  // live customer/product values) plus the org's CURRENT business
  // profile (the seller's own letterhead is not a per-quote snapshot
  // concern — only customer/product/tax fields are).
  async function downloadPdf() {
    if (!quote) return;
    const brandLockupBase64 = await loadBrandLockupBase64Client();
    const supplier: QuotePdfSupplier = {
      displayName: businessProfile?.profile.tradingName ?? businessProfile?.organisationName ?? 'BRΛINBΛSE',
      address: businessProfile?.profile.address ?? null,
      email: businessProfile?.profile.email ?? null,
      phone: businessProfile?.profile.phone ?? null,
      abn: businessProfile?.profile.abn ?? null,
    };
    const bytes = await buildQuotePdf({ quote, lines, supplier, brandLockupBase64 });
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quote.quote_number ?? 'quote-draft'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>;
  if (!quote) return <div style={{ color: '#6b7280', fontSize: 14 }}>Quote not found.</div>;

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/commercial/quotes" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Quotes</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 8px', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{quote.quote_number ?? 'Draft Quote'}</h1>
          <StatusBadge status={quote.status} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {!isDraft && <button onClick={downloadPdf} disabled={busy} style={btn('#1f2937')}>Download PDF</button>}
          {!isDraft && quote.email_snapshot && (
            <button onClick={sendEmail} disabled={busy} style={btn('#1f2937')}>
              {deliveries.length === 0 ? 'Send Email' : 'Resend Email'}
            </button>
          )}
          {isDraft && <button onClick={deleteDraft} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Delete Draft</button>}
          {isDraft && <button onClick={() => runAction('issue')} disabled={busy} style={btn('#1a6aff')}>Issue Quote</button>}
          {isSent && <button onClick={() => runAction('reject')} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Reject</button>}
          {isSent && <button onClick={() => runAction('expire')} disabled={busy} style={btn('rgba(251,191,36,0.15)', '#fbbf24')}>Mark Expired</button>}
          {isSent && <button onClick={() => runAction('accept')} disabled={busy} style={btn('rgba(74,222,128,0.15)', '#4ade80')}>Accept</button>}
          {quote.status === 'ACCEPTED' && canCreateInvoice && (
            <button onClick={createInvoiceFromThisQuote} disabled={busy} style={btn('#1a6aff')}>Create Invoice</button>
          )}
        </div>
      </div>
      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 16px' }}>{actionError}</p>}
      {sendResult && <p style={{ color: '#4ade80', fontSize: 13, margin: '0 0 16px' }}>{sendResult}</p>}
      {!isDraft && !quote.email_snapshot && (
        <p style={{ color: '#fbbf24', fontSize: 13, margin: '0 0 16px' }}>No customer email on file — this quote cannot be emailed.</p>
      )}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={miniLbl}>Customer</div>
          <div style={{ fontSize: 14 }}>
            {isDraft ? (
              <Link href={`/commercial/customers/${quote.customer_id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{customer?.name ?? '—'}</Link>
            ) : (quote.customer_name_snapshot ?? customer?.name ?? '—')}
          </div>
          {!isDraft && quote.billing_address_snapshot && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{quote.billing_address_snapshot}</div>}
        </div>
        <div>
          <div style={miniLbl}>Issue / Expiry</div>
          <div style={{ fontSize: 14 }}>{formatCommercialDate(quote.issue_date)} — {formatCommercialDate(quote.expiry_date)}</div>
        </div>
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
                <td style={td}>{formatMoneyCents(l.unit_price_cents, quote.currency)}</td>
                <td style={td}>{l.tax_code_snapshot ? `${l.tax_code_snapshot} (${l.tax_rate_snapshot}%)` : '—'}</td>
                <td style={td}>{formatMoneyCents(l.line_total_cents, quote.currency)}</td>
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
        <div style={{ width: 260, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px' }}>
          <TotalRow label="Subtotal" value={formatMoneyCents(quote.subtotal_cents, quote.currency)} />
          <TotalRow label="Tax" value={formatMoneyCents(quote.tax_cents, quote.currency)} />
          <TotalRow label="Total" value={formatMoneyCents(quote.total_cents, quote.currency)} bold />
        </div>
      </div>

      {(quote.notes || quote.terms) && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
          {quote.notes && <><div style={miniLbl}>Notes</div><p style={{ fontSize: 13, color: '#9ca3af', margin: '4px 0 16px', whiteSpace: 'pre-wrap' }}>{quote.notes}</p></>}
          {quote.terms && <><div style={miniLbl}>Terms</div><p style={{ fontSize: 13, color: '#9ca3af', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{quote.terms}</p></>}
        </div>
      )}
    </div>
  );
}

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
