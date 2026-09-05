'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge } from '../_status';
import { formatMoneyCents } from '@/lib/commercial/money';

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

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

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
    setLoading(false);

    const [customersRes, productsRes, taxCodesRes] = await Promise.all([
      fetch('/api/commercial/customers'), fetch('/api/commercial/products'), fetch('/api/commercial/tax-codes'),
    ]);
    const customersData = await customersRes.json();
    const productsData = await productsRes.json();
    const taxCodesData = await taxCodesRes.json();
    setCustomer((customersData.customers ?? []).find((c: Customer) => c.id === data.quote.customer_id) ?? null);
    setProducts(productsData.products ?? []);
    setTaxCodes(taxCodesData.taxCodes ?? []);
  }, [id]);

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

  async function deleteDraft() {
    setBusy(true);
    const res = await fetch(`/api/commercial/quotes/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.push('/commercial/quotes');
  }

  async function downloadPdf() {
    if (!quote) return;
    const jspdfMod = await import('jspdf');
    const JsPDF = jspdfMod.jsPDF ?? jspdfMod.default;
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 18;
    let y = margin;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('BRΛINBΛSE', margin, y);
    doc.setFontSize(14);
    doc.text('QUOTE', pageW - margin, y, { align: 'right' });
    y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 100, 100);
    doc.text(quote.quote_number ?? 'DRAFT', pageW - margin, y, { align: 'right' });
    y += 12;

    doc.setDrawColor(220, 220, 220); doc.line(margin, y, pageW - margin, y); y += 10;

    doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Customer', margin, y);
    doc.text('Details', pageW / 2 + 10, y);
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    const custName = quote.customer_name_snapshot ?? customer?.name ?? '';
    const custAddr = quote.billing_address_snapshot ?? customer?.billing_address ?? '';
    const custEmail = quote.email_snapshot ?? customer?.billing_email ?? '';
    doc.text(custName, margin, y);
    doc.text(`Issue date: ${quote.issue_date ?? '—'}`, pageW / 2 + 10, y);
    y += 5;
    if (custAddr) { doc.text(custAddr, margin, y); }
    doc.text(`Expiry: ${quote.expiry_date ?? '—'}`, pageW / 2 + 10, y);
    y += 5;
    if (custEmail) doc.text(custEmail, margin, y);
    y += 12;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Description', margin, y);
    doc.text('Qty', pageW - margin - 65, y, { align: 'right' });
    doc.text('Unit Price', pageW - margin - 40, y, { align: 'right' });
    doc.text('Tax', pageW - margin - 20, y, { align: 'right' });
    doc.text('Total', pageW - margin, y, { align: 'right' });
    y += 3;
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    for (const line of lines) {
      doc.text(doc.splitTextToSize(line.description_snapshot, 90), margin, y);
      doc.text(String(line.quantity), pageW - margin - 65, y, { align: 'right' });
      doc.text(formatMoneyCents(line.unit_price_cents, quote.currency), pageW - margin - 40, y, { align: 'right' });
      doc.text(`${line.tax_rate_snapshot}%`, pageW - margin - 20, y, { align: 'right' });
      doc.text(formatMoneyCents(line.line_total_cents, quote.currency), pageW - margin, y, { align: 'right' });
      y += 7;
    }
    y += 3;
    doc.line(pageW - margin - 80, y, pageW - margin, y);
    y += 7;

    doc.text('Subtotal', pageW - margin - 40, y, { align: 'right' });
    doc.text(formatMoneyCents(quote.subtotal_cents, quote.currency), pageW - margin, y, { align: 'right' });
    y += 6;
    doc.text('Tax', pageW - margin - 40, y, { align: 'right' });
    doc.text(formatMoneyCents(quote.tax_cents, quote.currency), pageW - margin, y, { align: 'right' });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Total', pageW - margin - 40, y, { align: 'right' });
    doc.text(formatMoneyCents(quote.total_cents, quote.currency), pageW - margin, y, { align: 'right' });
    y += 14;

    if (quote.terms) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Terms', margin, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
      doc.text(doc.splitTextToSize(quote.terms, pageW - margin * 2), margin, y);
    }

    doc.save(`${quote.quote_number ?? 'quote-draft'}.pdf`);
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
          {isSent && <button onClick={downloadPdf} style={btn('#1f2937')}>Download PDF</button>}
          {isDraft && <button onClick={deleteDraft} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Delete Draft</button>}
          {isDraft && <button onClick={() => runAction('issue')} disabled={busy} style={btn('#1a6aff')}>Issue Quote</button>}
          {isSent && <button onClick={() => runAction('reject')} disabled={busy} style={btn('rgba(239,68,68,0.15)', '#f87171')}>Reject</button>}
          {isSent && <button onClick={() => runAction('expire')} disabled={busy} style={btn('rgba(251,191,36,0.15)', '#fbbf24')}>Mark Expired</button>}
          {isSent && <button onClick={() => runAction('accept')} disabled={busy} style={btn('rgba(74,222,128,0.15)', '#4ade80')}>Accept</button>}
        </div>
      </div>
      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 16px' }}>{actionError}</p>}

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
          <div style={{ fontSize: 14 }}>{quote.issue_date ?? '—'} — {quote.expiry_date ?? '—'}</div>
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
