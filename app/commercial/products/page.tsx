'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import ProductForm from '../_components/ProductForm';
import { formatMoneyCents } from '@/lib/commercial/money';
import {
  Badge,
  PageHeader,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';

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
      <PageHeader
        title="Products & Services"
        description={`${products.length} total`}
        actions={<button type="button" onClick={() => setShowAdd(true)} {...buttonProps('primary')}>+ Add</button>}
      />

      <WorkToolbar count={(filter !== 'ALL' || search) && !loading ? `${filtered.length} of ${products.length}` : undefined}>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as typeof filter)}
          aria-label="Filter by type"
          className={toolbarControlClassName}
        >
          <option value="ALL">All types</option>
          <option value="PRODUCT">Products</option>
          <option value="SERVICE">Services</option>
        </select>
        <ToolbarSearch label="Search products and services" value={search} onChange={e => setSearch(e.target.value)} />
      </WorkToolbar>

      <TableContainer label="Products and services" minWidth={720}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">SKU</th>
              <th scope="col">Unit</th>
              <th scope="col" className={tableStyles.num}>Price</th>
              <th scope="col">Status</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading products and services…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">No products or services yet.</TableStateRow>}
            {filtered.map(p => (
              <tr key={p.id}>
                <td className={tableStyles.primary}>{p.name}</td>
                <td>{p.type === 'PRODUCT' ? 'Product' : 'Service'}</td>
                <td>{p.sku ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{p.unit_label ?? <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{formatMoneyCents(p.default_unit_price_cents, p.currency)}</td>
                <td><Badge state={p.active ? 'active' : 'inactive'}>{p.active ? 'Active' : 'Inactive'}</Badge></td>
                <td className={tableStyles.actions}>
                  <span style={{ display: 'inline-flex', gap: 12 }}>
                    <button type="button" onClick={() => setEditing(p)} className={tableStyles.link} aria-label={`Edit ${p.name}`}>Edit</button>
                    <button type="button" onClick={() => toggleActive(p)} className={tableStyles.link} aria-label={`${p.active ? 'Deactivate' : 'Reactivate'} ${p.name}`}>
                      {p.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

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
