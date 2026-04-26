'use client';
import { useState } from 'react';

const TYPES = [
  { value: 'note',    label: 'Note',    icon: '📝' },
  { value: 'call',    label: 'Call',    icon: '📞' },
  { value: 'email',   label: 'Email',   icon: '✉️' },
  { value: 'meeting', label: 'Meeting', icon: '🤝' },
];

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
      <div style={{ display: 'flex', gap: 8 }}>
        {TYPES.map(t => (
          <button key={t.value} type="button" onClick={() => setType(t.value)}
            style={{ flex: 1, padding: '8px 4px', background: type === t.value ? '#1a6aff' : '#111318', color: type === t.value ? '#fff' : '#9ca3af', border: '1px solid #1a1d24', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <input value={subject} onChange={e => setSubject(e.target.value)} required placeholder="Subject"
        style={{ padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none' }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Notes (optional)"
        style={{ padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving}
        style={{ padding: '9px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : 'Log Activity'}
      </button>
    </form>
  );
}
