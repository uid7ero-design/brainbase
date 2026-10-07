'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import SupplierForm from '../../_components/SupplierForm';
import {
  Badge,
  PageHeader,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  buttonProps,
  tableStyles,
} from '@/components/ui/app';

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
      <PageHeader
        title="Suppliers"
        description={`${suppliers.length} total`}
        actions={<><Link href="/commercial/purchasing/ap-overview" {...buttonProps('secondary')}>AP Overview</Link><button type="button" onClick={() => setShowAdd(true)} {...buttonProps('primary')}>+ Add Supplier</button></>}
      />

      <WorkToolbar count={search && !loading ? `${filtered.length} of ${suppliers.length}` : undefined}>
        <ToolbarSearch label="Search suppliers" value={search} onChange={e => setSearch(e.target.value)} />
      </WorkToolbar>

      <TableContainer label="Suppliers" minWidth={720}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Contact</th>
              <th scope="col">Email</th>
              <th scope="col">Phone</th>
              <th scope="col">Reference</th>
              <th scope="col">Status</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading suppliers…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">No suppliers yet.</TableStateRow>}
            {filtered.map(s => (
              <tr key={s.id}>
                <td className={tableStyles.primary}>
                  <Link href={`/commercial/purchasing/suppliers/${s.id}`}>{s.name}</Link>
                </td>
                <td>{s.contact_name ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{s.email ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{s.phone ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{s.supplier_reference ?? <span className={tableStyles.muted}>—</span>}</td>
                <td><Badge state={s.active ? 'active' : 'inactive'}>{s.active ? 'Active' : 'Inactive'}</Badge></td>
                <td className={tableStyles.actions}>
                  <span style={{ display: 'inline-flex', gap: 12 }}>
                    <Link href={`/commercial/purchasing/suppliers/${s.id}`} className={tableStyles.link} aria-label={`View supplier ${s.name}`}>View →</Link>
                    <button type="button" onClick={() => toggleActive(s)} className={tableStyles.link} aria-label={`${s.active ? 'Deactivate' : 'Reactivate'} supplier ${s.name}`}>
                      {s.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Supplier">
        <SupplierForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}
