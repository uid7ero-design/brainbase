'use client';
import { useState } from 'react';
import { useCrmList, useCrmMutation } from './useCrmRecovery';
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

export default function ContactForm({ initial, onSaved, onReview }: { initial?: Contact; onReview?: () => void; onSaved: (c: Contact) => void }) {
  const mutation=useCrmMutation('/api/crm/contacts');
  const {pending:saving,error}=mutation;
  const [form, setForm]       = useState<Contact>(initial ?? {});
  const {rows:companies,error:lookupError}=useCrmList<Company>('/api/crm/companies','companies');

  const set = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload=form;
    const saved=await mutation.run<Contact>(initial?.id?`/api/crm/contacts/${initial.id}`:'/api/crm/contacts',initial?.id?'PUT':'POST',payload,'contact');
    if(saved)onSaved(saved);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <fieldset disabled={mutation.locked} style={{border:0,padding:0,margin:0,display:'contents'}}>
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

      {lookupError && <FormError>{lookupError}</FormError>}
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Contact'}
        </Button>
      </FormActions>
      </fieldset>
      {mutation.uncertain && <Button type="button" disabled={saving} onClick={()=>mutation.review('/api/crm/contacts','contacts',()=>onReview?.())}>Review saved records</Button>}
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
