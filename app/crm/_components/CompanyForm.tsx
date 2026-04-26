'use client';
import { useState } from 'react';

type Company = { id?: string; name?: string; website?: string; industry?: string; company_size?: string; phone?: string; address?: string; notes?: string };

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
      <Field label="Company Name *" value={form.name ?? ''} onChange={set('name')} required />
      <Field label="Website" value={form.website ?? ''} onChange={set('website')} placeholder="https://" />
      <div>
        <label style={lbl}>Industry</label>
        <select value={form.industry ?? ''} onChange={set('industry')} style={sel}>
          <option value="">— Select —</option>
          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Company Size</label>
        <select value={form.company_size ?? ''} onChange={set('company_size')} style={sel}>
          <option value="">— Select —</option>
          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Field label="Phone" value={form.phone ?? ''} onChange={set('phone')} />
      <Field label="Address" value={form.address ?? ''} onChange={set('address')} />
      <div>
        <label style={lbl}>Notes</label>
        <textarea value={form.notes ?? ''} onChange={set('notes')} rows={3}
          style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Company'}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input value={value} onChange={onChange} required={required} placeholder={placeholder}
        style={{ width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14 };
