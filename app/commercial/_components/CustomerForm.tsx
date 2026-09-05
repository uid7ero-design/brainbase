'use client';
import { useState } from 'react';

type Customer = {
  id?: string; name?: string; billingEmail?: string | null; billingPhone?: string | null;
  billingAddress?: string | null; taxBusinessNumber?: string | null;
  crmCompanyId?: string | null; crmContactId?: string | null;
};

export default function CustomerForm({ initial, onSaved }: { initial?: Customer; onSaved: (c: Customer) => void }) {
  const [form, setForm] = useState<Customer>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) { setError('Customer name is required.'); return; }
    setSaving(true); setError('');
    const method = initial?.id ? 'PUT' : 'POST';
    const url = initial?.id ? `/api/commercial/customers/${initial.id}` : '/api/commercial/customers';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.customer);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field label="Customer Name *" value={form.name ?? ''} onChange={set('name')} required />
      <Field label="Billing Email" value={form.billingEmail ?? ''} onChange={set('billingEmail')} placeholder="billing@customer.com" />
      <Field label="Billing Phone" value={form.billingPhone ?? ''} onChange={set('billingPhone')} />
      <Field label="Billing Address" value={form.billingAddress ?? ''} onChange={set('billingAddress')} />
      <Field label="Tax / Business Number" value={form.taxBusinessNumber ?? ''} onChange={set('taxBusinessNumber')} placeholder="ABN, GST number, ..." />
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Customer'}
      </button>
    </form>
  );
}

export function Field({ label, value, onChange, required, placeholder, type }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type={type} value={value} onChange={onChange} required={required} placeholder={placeholder}
        style={{ width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

export const lbl: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
export const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, boxSizing: 'border-box' };
