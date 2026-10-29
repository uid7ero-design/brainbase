'use client';
import { useState } from 'react';
import { useCrmMutation } from './useCrmRecovery';
import { Button, Field, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';

type Company = { id?: string; name?: string; website?: string | null; industry?: string | null; company_size?: string | null; phone?: string | null; address?: string | null; notes?: string | null };

const INDUSTRIES = ['Agriculture','Construction','Education','Energy','Finance','Government','Healthcare','Hospitality','Legal','Manufacturing','Media','Non-profit','Real Estate','Retail','Technology','Transport','Utilities','Waste Management','Other'];
const SIZES = ['1–10','11–50','51–200','201–500','500+'];

export default function CompanyForm({ initial, onSaved, onReview }: { initial?: Company; onReview?: () => void; onSaved: (c: Company) => void }) {
  const mutation=useCrmMutation('/api/crm/companies');
  const {pending:saving,error}=mutation;
  const [form, setForm] = useState<Company>(initial ?? {});

  const set = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload=form;
    const saved=await mutation.run<Company>(initial?.id?`/api/crm/companies/${initial.id}`:'/api/crm/companies',initial?.id?'PUT':'POST',payload,'company');
    if(saved)onSaved(saved);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <fieldset disabled={mutation.locked} style={{border:0,padding:0,margin:0,display:'contents'}}>
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
      </fieldset>
      {mutation.uncertain && <Button type="button" disabled={saving} onClick={()=>mutation.review('/api/crm/companies','companies',()=>onReview?.())}>Review saved records</Button>}
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
