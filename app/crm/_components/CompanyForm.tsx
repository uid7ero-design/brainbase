'use client';
import { useState } from 'react';
import { Button, Field, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';

type Company = { id?: string; name?: string; website?: string | null; industry?: string | null; company_size?: string | null; phone?: string | null; address?: string | null; notes?: string | null };

const INDUSTRIES = ['Agriculture','Construction','Education','Energy','Finance','Government','Healthcare','Hospitality','Legal','Manufacturing','Media','Non-profit','Real Estate','Retail','Technology','Transport','Utilities','Waste Management','Other'];
const SIZES = ['1–10','11–50','51–200','201–500','500+'];

export default function CompanyForm({ initial, onSaved }: { initial?: Company; onSaved: (c: Company) => void }) {
  const [form, setForm] = useState<Company>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const method = initial?.id ? 'PUT' : 'POST';
    const url    = initial?.id ? `/api/crm/companies/${initial.id}` : '/api/crm/companies';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.company);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TextField label="Company Name" value={form.name ?? ''} onChange={set('name')} required />
      <TextField label="Website" value={form.website ?? ''} onChange={set('website')} placeholder="https://" />
      <Field label="Industry">
        {control => (
          <select {...control} value={form.industry ?? ''} onChange={set('industry')} className={fieldControlClassName}>
            <option value="">— Select —</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        )}
      </Field>
      <Field label="Company Size">
        {control => (
          <select {...control} value={form.company_size ?? ''} onChange={set('company_size')} className={fieldControlClassName}>
            <option value="">— Select —</option>
            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </Field>
      <TextField label="Phone" value={form.phone ?? ''} onChange={set('phone')} />
      <TextField label="Address" value={form.address ?? ''} onChange={set('address')} />
      <Field label="Notes">
        {control => (
          <textarea {...control} value={form.notes ?? ''} onChange={set('notes')} rows={3} className={fieldControlClassName} />
        )}
      </Field>
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Company'}
        </Button>
      </FormActions>
    </form>
  );
}

function TextField({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean; placeholder?: string }) {
  return (
    <Field label={label} required={required}>
      {control => (
        <input {...control} value={value} onChange={onChange} required={required} placeholder={placeholder} className={fieldControlClassName} />
      )}
    </Field>
  );
}
