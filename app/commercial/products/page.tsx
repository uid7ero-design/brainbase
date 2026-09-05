'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import ProductForm from '../_components/ProductForm';
import { formatMoneyCents } from '@/lib/commercial/money';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Product = {
  id: string; type: 'PRODUCT' | 'SERVICE'; name: string; sku: string | null;
  default_unit_price_cents: number; currency: string; active: boolean; unit_label: string | null;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'PRODUCT' | 'SERVICE'>('ALL');
  const [search, setSearch] = useState('');

  async function load() {
    const res = await fetch('/api/commercial/products');
    if (res.ok) setProducts((await res.json()).products);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(p: Product) {
    await fetch(`/api/commercial/products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !p.active }),
    });
    load();
  }

  const filtered = products
    .filter(p => filter === 'ALL' || p.type === filter)
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Products &amp; Services</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{products.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13 }}>
            <option value="ALL">All types</option>
            <option value="PRODUCT">Products</option>
            <option value="SERVICE">Services</option>
          </select>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13, outline: 'none', width: 180 }}
          />
          <button onClick={() => setShowAdd(true)} style={btn('#1a6aff')}>+ Add</button>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Type', 'SKU', 'Unit', 'Price', 'Status', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={empty}>No products or services yet.</td></tr>}
            {filtered.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: p.active ? 1 : 0.5 }}>
                <td style={{ padding: '13px 16px', color: '#f9fafb', fontWeight: 500, fontSize: 14 }}>{p.name}</td>
                <td style={td}>{p.type === 'PRODUCT' ? 'Product' : 'Service'}</td>
                <td style={td}>{p.sku ?? <Dim>—</Dim>}</td>
                <td style={td}>{p.unit_label ?? <Dim>—</Dim>}</td>
                <td style={td}>{formatMoneyCents(p.default_unit_price_cents, p.currency)}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: p.active ? '#4ade80' : '#9ca3af', background: p.active ? 'rgba(74,222,128,0.1)' : 'rgba(156,163,175,0.1)' }}>
                    {p.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '13px 16px', display: 'flex', gap: 12 }}>
                  <button onClick={() => setEditing(p)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: 0 }}>Edit</button>
                  <button onClick={() => toggleActive(p)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                    {p.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Product / Service">
        <ProductForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>

      <SlidePanel open={!!editing} onClose={() => setEditing(null)} title="Edit Product / Service">
        {editing && (
          <ProductForm
            initial={{
              id: editing.id, type: editing.type, name: editing.name, sku: editing.sku,
              unitLabel: editing.unit_label, defaultUnitPriceCents: editing.default_unit_price_cents, currency: editing.currency,
            }}
            onSaved={() => { setEditing(null); load(); }}
          />
        )}
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
