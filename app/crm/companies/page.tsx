'use client';
import { useState } from 'react';
import { useCrmList } from '../_components/useCrmRecovery';
import Link from 'next/link';
import SlidePanel from '../_components/SlidePanel';
import CompanyForm from '../_components/CompanyForm';
import {
  Button,
  PageHeader,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  tableStyles,
} from '@/components/ui/app';

type Company = {
  id: string; name: string; industry: string | null; website: string | null;
  phone: string | null; company_size: string | null;
  contact_count: number; deal_count: number; pipeline_value: number;
};

export default function CompaniesPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const {rows:companies,loading,error,reload:load} = useCrmList<Company>('/api/crm/companies','companies');

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.industry ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 1000 }}>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={load} disabled={loading}>Refresh saved records</button>
      <PageHeader
        title="Companies"
        description={`${companies.length} total`}
        actions={<Button variant="primary" onClick={() => setShowAdd(true)}>+ Add Company</Button>}
      />

      <WorkToolbar count={search && !loading ? `${filtered.length} of ${companies.length}` : undefined}>
        <ToolbarSearch
          label="Search companies"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </WorkToolbar>

      <TableContainer label="Companies">
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Industry</th>
              <th scope="col" className={tableStyles.num}>Contacts</th>
              <th scope="col" className={tableStyles.num}>Deals</th>
              <th scope="col" className={tableStyles.num}>Pipeline Value</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={6} kind="loading">Loading companies…</TableStateRow>}
            {!loading && !error && filtered.length === 0 && (
              <TableStateRow colSpan={6} kind="empty">
                {search ? 'No companies match your search.' : 'No companies yet.'}
              </TableStateRow>
            )}
            {filtered.map(c => (
              <tr key={c.id}>
                <td className={tableStyles.primary}>
                  <Link href={`/crm/companies/${c.id}`}>{c.name}</Link>
                  {c.website && <span className={tableStyles.meta}>{c.website}</span>}
                </td>
                <td>{c.industry ?? <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{c.contact_count}</td>
                <td className={tableStyles.num}>{c.deal_count}</td>
                <td className={tableStyles.num}>
                  {c.pipeline_value > 0 ? `$${Number(c.pipeline_value).toLocaleString()}` : <span className={tableStyles.muted}>—</span>}
                </td>
                <td className={tableStyles.actions}>
                  <Link href={`/crm/companies/${c.id}`} className={tableStyles.link} aria-label={`View ${c.name}`}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Company">
        <CompanyForm onReview={() => { setShowAdd(false); load(); }} onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}
