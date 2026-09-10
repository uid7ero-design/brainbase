'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import SupplierForm from '../../_components/SupplierForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Supplier = {
  id: string; name: string; contact_name: string | null; email: string | null; phone: string | null;
  supplier_reference: string | null; active: boolean;
};

// Phase C6.3 — mirrors app/commercial/customers/page.tsx exactly. No
// financial balance / AP columns (this gate's Section F explicitly
// excludes them — no bills/AP subsystem exists yet).
export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    const res = await fetch('/api/commercial/suppliers');
    if (res.ok) setSuppliers((await res.json()).suppliers);
    setLoading(false);
  }

  // Mirrors the identical, pre-existing load()-in-effect pattern already
  // used unmodified throughout Commercial (see app/commercial/customers/page.tsx's
  // own identical line, which fails this same rule today) — not a
  // regression introduced by this phase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  async function toggleActive(s: Supplier) {
    await fetch(`/api/commercial/suppliers/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !s.active }),
    });
    load();
  }

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Suppliers</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{suppliers.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13, outline: 'none', width: 200 }}
          />
          <button onClick={() => setShowAdd(true)} style={btn('#1a6aff')}>+ Add Supplier</button>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Contact', 'Email', 'Phone', 'Reference', 'Status', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={empty}>No suppliers yet.</td></tr>}
            {filtered.map((s, i) => (
              <tr key={s.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: s.active ? 1 : 0.5 }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/purchasing/suppliers/${s.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>{s.name}</Link>
                </td>
                <td style={td}>{s.contact_name ?? <Dim>—</Dim>}</td>
                <td style={td}>{s.email ?? <Dim>—</Dim>}</td>
                <td style={td}>{s.phone ?? <Dim>—</Dim>}</td>
                <td style={td}>{s.supplier_reference ?? <Dim>—</Dim>}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.active ? '#4ade80' : '#9ca3af', background: s.active ? 'rgba(74,222,128,0.1)' : 'rgba(156,163,175,0.1)' }}>
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '13px 16px', display: 'flex', gap: 12 }}>
                  <Link href={`/commercial/purchasing/suppliers/${s.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View →</Link>
                  <button onClick={() => toggleActive(s)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                    {s.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Supplier">
        <SupplierForm onSaved={() => { setShowAdd(false); load(); }} />
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
