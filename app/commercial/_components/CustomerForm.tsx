'use client';
import { useState } from 'react';
import { Button, Field as AppField, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';

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
      <Field label="Customer Name" value={form.name ?? ''} onChange={set('name')} required />
      <Field label="Billing Email" value={form.billingEmail ?? ''} onChange={set('billingEmail')} placeholder="billing@customer.com" />
      <Field label="Billing Phone" value={form.billingPhone ?? ''} onChange={set('billingPhone')} />
      <Field label="Billing Address" value={form.billingAddress ?? ''} onChange={set('billingAddress')} />
      <Field label="Tax / Business Number" value={form.taxBusinessNumber ?? ''} onChange={set('taxBusinessNumber')} placeholder="ABN, GST number, ..." />
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Customer'}
        </Button>
      </FormActions>
    </form>
  );
}

/**
 * Labelled single-line text input on the shared Field contract. Kept as a
 * named export because the other Commercial forms reuse it.
 */
export function Field({ label, value, onChange, required, placeholder, type }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string; type?: string;
}) {
  return (
    <AppField label={label} required={required}>
      {control => (
        <input {...control} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder}
          className={fieldControlClassName} />
      )}
    </AppField>
  );
}
