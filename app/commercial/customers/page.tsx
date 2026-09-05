'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlidePanel from '../_components/SlidePanel';
import CustomerForm from '../_components/CustomerForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Customer = {
  id: string; name: string; billing_email: string | null; billing_phone: string | null;
  tax_business_number: string | null; active: boolean; crm_company_id: string | null; crm_contact_id: string | null;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    const res = await fetch('/api/commercial/customers');
    if (res.ok) setCustomers((await res.json()).customers);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(c: Customer) {
    await fetch(`/api/commercial/customers/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !c.active }),
    });
    load();
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.billing_email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Customers</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{customers.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13, outline: 'none', width: 200 }}
          />
          <button onClick={() => setShowAdd(true)} style={btn('#1a6aff')}>+ Add Customer</button>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Email', 'Phone', 'Tax / Business No.', 'CRM Link', 'Status', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={empty}>No customers yet.</td></tr>}
            {filtered.map((c, i) => (
              <tr key={c.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: c.active ? 1 : 0.5 }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/customers/${c.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>{c.name}</Link>
                </td>
                <td style={td}>{c.billing_email ?? <Dim>—</Dim>}</td>
                <td style={td}>{c.billing_phone ?? <Dim>—</Dim>}</td>
                <td style={td}>{c.tax_business_number ?? <Dim>—</Dim>}</td>
                <td style={td}>{(c.crm_company_id || c.crm_contact_id) ? <span style={{ color: '#a78bfa' }}>Linked</span> : <Dim>—</Dim>}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: c.active ? '#4ade80' : '#9ca3af', background: c.active ? 'rgba(74,222,128,0.1)' : 'rgba(156,163,175,0.1)' }}>
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '13px 16px', display: 'flex', gap: 12 }}>
                  <Link href={`/commercial/customers/${c.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View →</Link>
                  <button onClick={() => toggleActive(c)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                    {c.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Customer">
        <CustomerForm onSaved={() => { setShowAdd(false); load(); }} />
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
