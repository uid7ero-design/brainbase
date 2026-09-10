'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
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
type Supplier = { id: string; name: string };
type Product = { id: string; name: string; default_unit_price_cents: number; default_tax_code_id: string | null; sku: string | null; unit_label: string | null; active: boolean };
type TaxCode = { id: string; code: string; name: string; rate: string };

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

// Phase C6.3 — foundation only. DRAFT is the only status this page ever
// renders an edit affordance for (header fields or lines) — PENDING_APPROVAL/
// APPROVED/ISSUED/CANCELLED all render strictly read-only, with no
// submit/approve/return/issue/cancel controls anywhere on this page; those
// are explicitly out of scope for C6.3 (C6.4). No cost-centre picker is
// offered here — no cost-centre listing API/UI exists anywhere in
// Commercial yet (unlike products/tax-codes, which quote/invoice lines
// already expose pickers for), so adding one is left to a later phase;
// a line's cost_centre_id remains fully API/domain-settable, just not
// from this UI.
export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

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
    setLoading(false);

    const [suppliersRes, productsRes, taxCodesRes, meRes] = await Promise.all([
      fetch('/api/commercial/suppliers'), fetch('/api/commercial/products'), fetch('/api/commercial/tax-codes'), fetch('/api/me'),
    ]);
    if (suppliersRes.ok) setSuppliers((await suppliersRes.json()).suppliers ?? []);
    if (productsRes.ok) setProducts((await productsRes.json()).products ?? []);
    if (taxCodesRes.ok) setTaxCodes((await taxCodesRes.json()).taxCodes ?? []);
    if (meRes.ok) {
      const me = await meRes.json();
      setCanEdit(clientRoleGte(me.role, 'manager'));
    }
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const isDraft = po?.status === 'DRAFT';

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
        {isDraft && canEdit && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={openHeaderEdit} disabled={busy} style={btn('#1f2937')}>Edit Details</button>
          </div>
        )}
      </div>
      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 16px' }}>{actionError}</p>}
      {!isDraft && (
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 16px' }}>
          This purchase order is {po.status.replace('_', ' ').toLowerCase()} and its contents are read-only.
        </p>
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
            <div style={{ fontSize: 14 }}>
              <Link href={`/commercial/purchasing/suppliers/${po.supplier_id}`} style={{ color: '#f9fafb', textDecoration: 'none' }}>{po.supplier_name_snapshot ?? '—'}</Link>
            </div>
            {po.supplier_contact_name_snapshot && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{po.supplier_contact_name_snapshot}</div>}
            {(po.supplier_email_snapshot || po.supplier_phone_snapshot) && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{[po.supplier_email_snapshot, po.supplier_phone_snapshot].filter(Boolean).join(' · ')}</div>
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
              <div style={miniLbl}>Product</div>
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
          <TotalRow label="Subtotal" value={formatMoneyCents(po.subtotal_cents, po.currency)} />
          <TotalRow label="Tax" value={formatMoneyCents(po.tax_cents, po.currency)} />
          <TotalRow label="Total" value={formatMoneyCents(po.total_cents, po.currency)} bold />
        </div>
      </div>

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
