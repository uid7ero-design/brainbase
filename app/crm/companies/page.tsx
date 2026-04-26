'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlidePanel from '../_components/SlidePanel';
import CompanyForm from '../_components/CompanyForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Company = {
  id: string; name: string; industry: string | null; website: string | null;
  phone: string | null; company_size: string | null;
  contact_count: number; deal_count: number; pipeline_value: number;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [search, setSearch]       = useState('');

  async function load() {
    const res = await fetch('/api/crm/companies');
    if (res.ok) setCompanies((await res.json()).companies);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.industry ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Companies</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{companies.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13, outline: 'none', width: 200 }}
          />
          <button onClick={() => setShowAdd(true)} style={btn('#1a6aff')}>+ Add Company</button>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Company', 'Industry', 'Contacts', 'Deals', 'Pipeline Value', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={empty}>No companies yet.</td></tr>}
            {filtered.map((c, i) => (
              <tr key={c.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/crm/companies/${c.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>{c.name}</Link>
                  {c.website && <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{c.website}</div>}
                </td>
                <td style={td}>{c.industry ?? <Dim>—</Dim>}</td>
                <td style={td}>{c.contact_count}</td>
                <td style={td}>{c.deal_count}</td>
                <td style={td}>{c.pipeline_value > 0 ? `$${Number(c.pipeline_value).toLocaleString()}` : <Dim>—</Dim>}</td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/crm/companies/${c.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Company">
        <CompanyForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#4b5563' }}>{children}</span>;
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
