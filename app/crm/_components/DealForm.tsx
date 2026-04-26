'use client';
import { useEffect, useState } from 'react';

const STAGES = [
  { value: 'lead',        label: 'Lead' },
  { value: 'qualified',   label: 'Qualified' },
  { value: 'proposal',    label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'closed_won',  label: 'Won' },
  { value: 'closed_lost', label: 'Lost' },
];

type Deal = { id?: string; title?: string; value?: number | null; stage?: string; probability?: number; expected_close?: string | null; company_id?: string; contact_id?: string; assigned_to?: string | null; notes?: string };
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
      <Field label="Deal Title *" value={form.title ?? ''} onChange={set('title')} required />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Value ($)</label>
          <input type="number" min="0" step="0.01" value={form.value ?? ''} onChange={set('value')}
            style={inp} placeholder="0" />
        </div>
        <div>
          <label style={lbl}>Probability (%)</label>
          <input type="number" min="0" max="100" value={form.probability ?? 0} onChange={set('probability')}
            style={inp} />
        </div>
      </div>
      <div>
        <label style={lbl}>Stage</label>
        <select value={form.stage ?? 'lead'} onChange={set('stage')} style={sel}>
          {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Expected Close</label>
        <input type="date" value={form.expected_close ?? ''} onChange={set('expected_close')} style={inp} />
      </div>
      <div>
        <label style={lbl}>Company</label>
        <select value={form.company_id ?? ''} onChange={set('company_id')} style={sel}>
          <option value="">— None —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Contact</label>
        <select value={form.contact_id ?? ''} onChange={set('contact_id')} style={sel}>
          <option value="">— None —</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Notes</label>
        <textarea value={form.notes ?? ''} onChange={set('notes')} rows={3}
          style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving}
        style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Deal'}
      </button>
      {initial?.id && onDelete && (
        <button type="button" onClick={handleDelete} disabled={deleting}
          style={{ padding: '8px 0', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 13, cursor: deleting ? 'default' : 'pointer' }}>
          {deleting ? 'Deleting…' : 'Delete deal'}
        </button>
      )}
    </form>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input value={value} onChange={onChange} required={required}
        style={{ width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14 };
