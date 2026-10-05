'use client';
import { useEffect, useState } from 'react';
import { Field } from './CustomerForm';
import { Button, Field as AppField, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';

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
      <AppField label="Type">
        {control => (
          <select {...control} value={form.type ?? 'PRODUCT'} onChange={set('type')} className={fieldControlClassName} disabled={!!initial?.id}>
            <option value="PRODUCT">Product</option>
            <option value="SERVICE">Service</option>
          </select>
        )}
      </AppField>
      <Field label="Name" value={form.name ?? ''} onChange={set('name')} required />
      <AppField label="Description">
        {control => (
          <textarea {...control} value={form.description ?? ''} onChange={set('description')} rows={2} className={fieldControlClassName} />
        )}
      </AppField>
      <Field label="SKU / Code" value={form.sku ?? ''} onChange={set('sku')} />
      <Field label="Unit" value={form.unitLabel ?? ''} onChange={set('unitLabel')} placeholder="each, hour, kg, ..." />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <AppField label="Default Price">
            {control => (
              <input {...control} value={priceDisplay} onChange={e => setPriceDisplay(e.target.value)} placeholder="0.00" inputMode="decimal" className={fieldControlClassName} />
            )}
          </AppField>
        </div>
        <div style={{ width: 90 }}>
          <AppField label="Currency">
            {control => (
              <input {...control} value={form.currency ?? 'AUD'} onChange={set('currency')} className={fieldControlClassName} maxLength={3} />
            )}
          </AppField>
        </div>
      </div>
      <AppField label="Default Tax Code">
        {control => (
          <select {...control} value={form.defaultTaxCodeId ?? ''} onChange={set('defaultTaxCodeId')} className={fieldControlClassName}>
            <option value="">— No tax code —</option>
            {taxCodes.map(t => <option key={t.id} value={t.id}>{t.code} — {t.name} ({t.rate}%)</option>)}
          </select>
        )}
      </AppField>
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create'}
        </Button>
      </FormActions>
    </form>
  );
}
