'use client';
import { useEffect, useState } from 'react';
import { Field, lbl, sel } from './CustomerForm';

type TaxCode = { id: string; code: string; name: string; rate: string };

type Product = {
  id?: string; type?: 'PRODUCT' | 'SERVICE'; name?: string; description?: string | null;
  sku?: string | null; unitLabel?: string | null; defaultUnitPriceCents?: number;
  currency?: string; defaultTaxCodeId?: string | null;
};

export default function ProductForm({ initial, onSaved }: { initial?: Product; onSaved: (p: Product) => void }) {
  const [form, setForm] = useState<Product>(initial ?? { type: 'PRODUCT', currency: 'AUD' });
  const [priceDisplay, setPriceDisplay] = useState(initial?.defaultUnitPriceCents !== undefined ? (initial.defaultUnitPriceCents / 100).toFixed(2) : '');
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/commercial/tax-codes').then(r => r.json()).then(d => setTaxCodes(d.taxCodes ?? []));
  }, []);

  const set = (k: keyof Product) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) { setError('Product/service name is required.'); return; }
    setSaving(true); setError('');
    const payload = { ...form, defaultUnitPriceCents: Math.round(parseFloat(priceDisplay || '0') * 100) };
    const method = initial?.id ? 'PUT' : 'POST';
    const url = initial?.id ? `/api/commercial/products/${initial.id}` : '/api/commercial/products';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.product);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={lbl}>Type</label>
        <select value={form.type ?? 'PRODUCT'} onChange={set('type')} style={sel} disabled={!!initial?.id}>
          <option value="PRODUCT">Product</option>
          <option value="SERVICE">Service</option>
        </select>
      </div>
      <Field label="Name *" value={form.name ?? ''} onChange={set('name')} required />
      <div>
        <label style={lbl}>Description</label>
        <textarea value={form.description ?? ''} onChange={set('description')} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      <Field label="SKU / Code" value={form.sku ?? ''} onChange={set('sku')} />
      <Field label="Unit" value={form.unitLabel ?? ''} onChange={set('unitLabel')} placeholder="each, hour, kg, ..." />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Default Price</label>
          <input value={priceDisplay} onChange={e => setPriceDisplay(e.target.value)} placeholder="0.00" inputMode="decimal" style={sel} />
        </div>
        <div style={{ width: 90 }}>
          <label style={lbl}>Currency</label>
          <input value={form.currency ?? 'AUD'} onChange={set('currency')} style={sel} maxLength={3} />
        </div>
      </div>
      <div>
        <label style={lbl}>Default Tax Code</label>
        <select value={form.defaultTaxCodeId ?? ''} onChange={set('defaultTaxCodeId')} style={sel}>
          <option value="">— No tax code —</option>
          {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} — {t.name} ({t.rate}%)</option>)}
        </select>
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create'}
      </button>
    </form>
  );
}
