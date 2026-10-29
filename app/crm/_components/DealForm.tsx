'use client';
import { useState } from 'react';
import { useCrmList, useCrmMutation } from './useCrmRecovery';
import { Button, Field, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';

const STAGES = [
  { value: 'lead',        label: 'Lead' },
  { value: 'qualified',   label: 'Qualified' },
  { value: 'proposal',    label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'closed_won',  label: 'Won' },
  { value: 'closed_lost', label: 'Lost' },
];

type Deal = { id?: string; title?: string; value?: number | null; stage?: string; probability?: number; expected_close?: string | null; company_id?: string | null; contact_id?: string | null; assigned_to?: string | null; notes?: string | null };
type Opt = { id: string; name: string };

export default function DealForm({ initial, onSaved, onDelete, onReview }: { initial?: Deal; onReview?: () => void; onSaved: (d: Deal) => void; onDelete?: () => void }) {
  const mutation=useCrmMutation('/api/crm/deals');
  const {pending:saving,error}=mutation;
  const [form, setForm]       = useState<Deal>({ stage: 'lead', probability: 0, ...initial });
  const {rows:companies}=useCrmList<Opt>('/api/crm/companies','companies');
  const {rows:contactRows}=useCrmList<{id:string;first_name:string;last_name:string}>('/api/crm/contacts','contacts');
  const contacts=contactRows.map(c=>({id:c.id,name:c.first_name+' '+c.last_name}));

  const set = (k: keyof Deal) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload={...form,value:form.value==null||String(form.value)==='' ?null:Number(form.value),probability:Number(form.probability??0)};
    const saved=await mutation.run<Deal>(initial?.id?`/api/crm/deals/${initial.id}`:'/api/crm/deals',initial?.id?'PUT':'POST',payload,'deal');
    if(saved)onSaved(saved);
  }
  async function handleDelete(){
    if(mutation.locked||!initial?.id||!confirm('Delete this deal?'))return;
    const deleted=await mutation.run(`/api/crm/deals/${initial.id}`,'DELETE');
    if(deleted)onDelete?.();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <fieldset disabled={mutation.locked} style={{border:0,padding:0,margin:0,display:'contents'}}>
      <Field label="Deal Title" required>
        {control => (
          <input {...control} value={form.title ?? ''} onChange={set('title')} required className={fieldControlClassName} />
        )}
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Field label="Value ($)">
          {control => (
            <input {...control} type="number" min="0" step="0.01" value={form.value ?? ''} onChange={set('value')}
              className={fieldControlClassName} placeholder="0" style={{ fontVariantNumeric: 'tabular-nums' }} />
          )}
        </Field>
        <Field label="Probability (%)">
          {control => (
            <input {...control} type="number" min="0" max="100" value={form.probability ?? 0} onChange={set('probability')}
              className={fieldControlClassName} style={{ fontVariantNumeric: 'tabular-nums' }} />
          )}
        </Field>
      </div>
      <Field label="Stage">
        {control => (
          <select {...control} value={form.stage ?? 'lead'} onChange={set('stage')} className={fieldControlClassName}>
            {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
      </Field>
      <Field label="Expected Close">
        {control => (
          <input {...control} type="date" value={form.expected_close ?? ''} onChange={set('expected_close')} className={fieldControlClassName} />
        )}
      </Field>
      <Field label="Company">
        {control => (
          <select {...control} value={form.company_id ?? ''} onChange={set('company_id')} className={fieldControlClassName}>
            <option value="">— None —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </Field>
      <Field label="Contact">
        {control => (
          <select {...control} value={form.contact_id ?? ''} onChange={set('contact_id')} className={fieldControlClassName}>
            <option value="">— None —</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Deal'}
        </Button>
      </FormActions>
      {initial?.id && onDelete && (
        <FormActions align="stretch">
          <Button type="button" variant="danger" onClick={handleDelete} disabled={mutation.locked}>
            {saving ? 'Working…' : 'Delete deal'}
          </Button>
        </FormActions>
      )}
      </fieldset>
      {mutation.uncertain && <Button type="button" disabled={saving} onClick={()=>mutation.review('/api/crm/deals','deals',()=>onReview?.())}>Review saved records</Button>}
    </form>
  );
}
