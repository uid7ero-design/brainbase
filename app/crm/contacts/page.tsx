'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlidePanel from '../_components/SlidePanel';
import ContactForm from '../_components/ContactForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Contact = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; job_title: string | null; company_name: string | null; activity_count: number };

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [search, setSearch]     = useState('');

  async function load() {
    const res = await fetch('/api/crm/contacts');
    if (res.ok) setContacts((await res.json()).contacts);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return `${c.first_name} ${c.last_name}`.toLowerCase().includes(q)
      || (c.email ?? '').toLowerCase().includes(q)
      || (c.company_name ?? '').toLowerCase().includes(q);
  });

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Contacts</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{contacts.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13, outline: 'none', width: 200 }} />
          <button onClick={() => setShowAdd(true)} style={btn('#1a6aff')}>+ Add Contact</button>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Company', 'Job Title', 'Email', 'Activities', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={empty}>No contacts yet.</td></tr>}
            {filtered.map((c, i) => (
              <tr key={c.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/crm/contacts/${c.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                    {c.first_name} {c.last_name}
                  </Link>
                </td>
                <td style={td}>
                  {c.company_name
                    ? <span style={{ color: '#9ca3af' }}>{c.company_name}</span>
                    : <span style={{ color: '#4b5563' }}>—</span>}
                </td>
                <td style={td}>{c.job_title ?? <span style={{ color: '#4b5563' }}>—</span>}</td>
                <td style={{ ...td, fontSize: 12 }}>{c.email ?? <span style={{ color: '#4b5563' }}>—</span>}</td>
                <td style={td}>{c.activity_count}</td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/crm/contacts/${c.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Contact">
        <ContactForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
