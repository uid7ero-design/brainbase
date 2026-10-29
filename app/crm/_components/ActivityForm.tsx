'use client';
import { useState } from 'react';
import { useCrmMutation } from './useCrmRecovery';
import { Button, Field, FormActions, FormError, buttonProps, fieldControlClassName } from '@/components/ui/app';

const TYPES = [
  { value: 'note',    label: 'Note',    icon: '📝' },
  { value: 'call',    label: 'Call',    icon: '📞' },
  { value: 'email',   label: 'Email',   icon: '✉️' },
  { value: 'meeting', label: 'Meeting', icon: '🤝' },
];

// Selected segment: accent tint + accent text (not a solid slab); the
// pressed state is also exposed via aria-pressed.
const PRESSED: React.CSSProperties = {
  background: 'var(--brand-brainbase-accent-muted)',
  borderColor: 'var(--brand-brainbase-accent-border)',
  color: 'var(--brand-brainbase-accent)',
};

type Props = { contactId?: string; companyId?: string; dealId?: string; onReview?: () => void; onSaved: () => void };

export default function ActivityForm({ contactId, companyId, dealId, onSaved, onReview }: Props) {
  const mutation=useCrmMutation('/api/crm/activities');
  const {pending:saving,error}=mutation;
  const [type, setType]       = useState('note');
  const [subject, setSubject] = useState('');
  const [body, setBody]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload={type,subject,body:body||null,contact_id:contactId,company_id:companyId,deal_id:dealId};
    const saved=await mutation.run('/api/crm/activities','POST',payload,'activity');
    if(saved){setSubject('');setBody('');onSaved();}
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <fieldset disabled={mutation.locked} style={{border:0,padding:0,margin:0,display:'contents'}}>
      {/* Type picker */}
      <div role="group" aria-label="Activity type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TYPES.map(t => (
          <button key={t.value} type="button" onClick={() => setType(t.value)} aria-pressed={type === t.value}
            {...buttonProps('secondary', 'sm')}
            style={{ flex: 1, ...(type === t.value ? PRESSED : undefined) }}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <Field label="Subject" required>
        {control => (
          <input {...control} value={subject} onChange={e => setSubject(e.target.value)} required placeholder="Subject" className={fieldControlClassName} />
        )}
      </Field>
      <Field label="Notes">
        {control => (
          <textarea {...control} value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Notes (optional)" className={fieldControlClassName} />
        )}
      </Field>
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Log Activity'}
        </Button>
      </FormActions>
      </fieldset>
      {mutation.uncertain && <Button type="button" disabled={saving} onClick={()=>mutation.review('/api/crm/activities','activities',()=>onReview?.())}>Review saved records</Button>}
    </form>
  );
}
