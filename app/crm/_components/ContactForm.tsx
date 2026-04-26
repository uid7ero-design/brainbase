'use client';
import { useEffect, useState } from 'react';

type Contact = { id?: string; first_name?: string; last_name?: string; email?: string; phone?: string; job_title?: string; company_id?: string; notes?: string };
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="First Name *" value={form.first_name ?? ''} onChange={set('first_name')} required />
        <Field label="Last Name *"  value={form.last_name  ?? ''} onChange={set('last_name')}  required />
      </div>
      <Field label="Email" value={form.email ?? ''} onChange={set('email')} />
      <Field label="Phone" value={form.phone ?? ''} onChange={set('phone')} />
      <Field label="Job Title" value={form.job_title ?? ''} onChange={set('job_title')} />
      <div>
        <label style={lbl}>Company</label>
        <select value={form.company_id ?? ''} onChange={set('company_id')} style={sel}>
          <option value="">— No company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Notes</label>
        <textarea value={form.notes ?? ''} onChange={set('notes')} rows={3}
          style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Contact'}
      </button>
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
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14 };
