'use client';
import { useEffect, useState } from 'react';
import { Button, Field, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';
import { CRM_CONTACT_CLASSIFICATIONS, CRM_CONTACT_CLASSIFICATION_LABELS, type CrmContactClassification } from '@/lib/crm/classification';

type Contact = {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  company_id?: string | null;
  notes?: string | null;
  classification?: CrmContactClassification | null;
};
type Company = { id: string; name: string };

export default function ContactForm({ initial, onSaved }: { initial?: Contact; onSaved: (c: Contact) => void }) {
  const [form, setForm]       = useState<Contact>(initial ?? {});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    fetch('/api/crm/companies').then(r => r.json()).then(d => setCompanies(d.companies ?? []));
  }, []);

  const set = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const method = initial?.id ? 'PUT' : 'POST';
    const url    = initial?.id ? `/api/crm/contacts/${initial.id}` : '/api/crm/contacts';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.contact);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <TextField label="First Name" value={form.first_name ?? ''} onChange={set('first_name')} required />
        <TextField label="Last Name"  value={form.last_name  ?? ''} onChange={set('last_name')}  required />
      </div>
      <TextField label="Email" value={form.email ?? ''} onChange={set('email')} />
      <TextField label="Phone" value={form.phone ?? ''} onChange={set('phone')} />
      <TextField label="Job Title" value={form.job_title ?? ''} onChange={set('job_title')} />
      {/* Classification is optional — "Unclassified" (empty value)
          submits as '', which both API routes (POST/PUT
          /api/crm/contacts) treat identically to null. Never required:
          see this field's own comment in lib/crm/classification.ts —
          most existing contacts, and any contact a human creates
          without picking one, are unclassified, which is a valid,
          expected state, not an error. */}
      <Field label="Classification">
        {control => (
          <select {...control} value={form.classification ?? ''} onChange={set('classification')} className={fieldControlClassName}>
            <option value="">— Unclassified —</option>
            {CRM_CONTACT_CLASSIFICATIONS.map(value => (
              <option key={value} value={value}>{CRM_CONTACT_CLASSIFICATION_LABELS[value]}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Company">
        {control => (
          <select {...control} value={form.company_id ?? ''} onChange={set('company_id')} className={fieldControlClassName}>
            <option value="">— No company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </Field>
      <Field label="Notes">
        {control => (
          <textarea {...control} value={form.notes ?? ''} onChange={set('notes')} rows={3} className={fieldControlClassName} />
        )}
      </Field>

      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Contact'}
        </Button>
      </FormActions>
    </form>
  );
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      {control => (
        <input {...control} value={value} onChange={onChange} required={required} className={fieldControlClassName} />
      )}
    </Field>
  );
}
