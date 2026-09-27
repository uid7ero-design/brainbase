'use client';
import { useState } from 'react';
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

type Props = { contactId?: string; companyId?: string; dealId?: string; onSaved: () => void };

export default function ActivityForm({ contactId, companyId, dealId, onSaved }: Props) {
  const [type, setType]       = useState('note');
  const [subject, setSubject] = useState('');
  const [body, setBody]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const res = await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, subject, body: body || null, contact_id: contactId, company_id: companyId, deal_id: dealId }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    setSubject(''); setBody('');
    onSaved();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
    </form>
  );
}
