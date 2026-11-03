'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SlidePanel from '../_components/SlidePanel';
import CustomerForm from '../_components/CustomerForm';
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

type Customer = {
  id: string; name: string; billing_email: string | null; billing_phone: string | null;
  tax_business_number: string | null; active: boolean; crm_company_id: string | null; crm_contact_id: string | null;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const requestNumber = useRef(0);
  const writing = useRef(false);

  async function load() {
    const number = ++requestNumber.current;
    setLoading(true); setCustomers([]); setError('');
    try {
      const res = await fetch('/api/commercial/customers', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!Array.isArray(data.customers)) throw new Error();
      if (number === requestNumber.current) setCustomers(data.customers);
    } catch { if (number === requestNumber.current) setError('Saved billing customers could not be loaded. Review saved records before making changes.'); }
    finally { if (number === requestNumber.current) setLoading(false); }
  }

  useEffect(() => {
    // Subsequent refreshes clear rows synchronously so old records cannot remain actionable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const invalidate = () => { requestNumber.current++; };
    return invalidate;
  }, []);

  async function toggleActive(c: Customer) {
    if (writing.current || loading || error) return;
    writing.current = true; setChanging(true);
    try {
      const response = await fetch(`/api/commercial/customers/${c.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !c.active }), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      requestNumber.current++; setCustomers([]);
      setError('The status change could not be confirmed. Review saved records before trying again.');
    } finally { writing.current = false; setChanging(false); }
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.billing_email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Customers"
        description={loading || error ? 'Check saved billing customers' : `${customers.length} total`}
        actions={<button type="button" disabled={loading || !!error || changing} onClick={() => setShowAdd(true)} {...buttonProps('primary')}>+ Add Customer</button>}
      />
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={loading || changing} onClick={() => void load()} {...buttonProps('secondary')}>Review saved records</button>

      <WorkToolbar count={search && !loading ? `${filtered.length} of ${customers.length}` : undefined}>
        <ToolbarSearch label="Search customers" value={search} onChange={e => setSearch(e.target.value)} />
      </WorkToolbar>

      <TableContainer label="Customers" minWidth={720}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Phone</th>
              <th scope="col">Tax / Business No.</th>
              <th scope="col">CRM Link</th>
              <th scope="col">Status</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading customers…</TableStateRow>}
            {!loading && !error && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">{search ? 'No matching customers.' : 'No customers yet.'}</TableStateRow>}
            {filtered.map(c => (
              <tr key={c.id}>
                <td className={tableStyles.primary}>
                  <Link href={`/commercial/customers/${c.id}`}>{c.name}</Link>
                </td>
                <td>{c.billing_email ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{c.billing_phone ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{c.tax_business_number ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{(c.crm_company_id || c.crm_contact_id) ? <span style={{ color: 'var(--text-primary)' }}>Linked</span> : <span className={tableStyles.muted}>—</span>}</td>
                <td><Badge state={c.active ? 'active' : 'inactive'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
                <td className={tableStyles.actions}>
                  <span style={{ display: 'inline-flex', gap: 12 }}>
                    <Link href={`/commercial/customers/${c.id}`} className={tableStyles.link} aria-label={`View customer ${c.name}`}>View →</Link>
                    <button type="button" disabled={changing} onClick={() => toggleActive(c)} className={tableStyles.link} aria-label={`${c.active ? 'Deactivate' : 'Reactivate'} customer ${c.name}`}>
                      {c.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Customer">
        <CustomerForm onReview={() => { setShowAdd(false); load(); }} onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}
