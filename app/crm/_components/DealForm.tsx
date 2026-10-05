'use client';
import { useEffect, useState } from 'react';
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

export default function DealForm({ initial, onSaved, onDelete }: { initial?: Deal; onSaved: (d: Deal) => void; onDelete?: () => void }) {
  const [form, setForm]       = useState<Deal>({ stage: 'lead', probability: 0, ...initial });
  const [companies, setCompanies] = useState<Opt[]>([]);
  const [contacts, setContacts]   = useState<Opt[]>([]);
  const [users, setUsers]         = useState<Opt[]>([]);
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    fetch('/api/crm/companies').then(r => r.json()).then(d => setCompanies(d.companies ?? []));
    fetch('/api/crm/contacts').then(r => r.json()).then(d =>
      setContacts((d.contacts ?? []).map((c: { id: string; first_name: string; last_name: string }) => ({ id: c.id, name: `${c.first_name} ${c.last_name}` }))));
    fetch('/api/me').then(r => r.json()).then(me => {
      // Just show current user for now — could expand to all users
      if (me?.userId) setUsers([{ id: me.userId, name: me.name }]);
    });
  }, []);

  const set = (k: keyof Deal) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    const payload = { ...form, value: form.value ? Number(form.value) : null, probability: Number(form.probability ?? 0) };
    const method = initial?.id ? 'PUT' : 'POST';
    const url    = initial?.id ? `/api/crm/deals/${initial.id}` : '/api/crm/deals';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.deal);
  }

  async function handleDelete() {
    if (!initial?.id || !confirm('Delete this deal?')) return;
    setDeleting(true);
    await fetch(`/api/crm/deals/${initial.id}`, { method: 'DELETE' });
    onDelete?.();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete deal'}
          </Button>
        </FormActions>
      )}
    </form>
  );
}
