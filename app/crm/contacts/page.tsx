'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SlidePanel from '../_components/SlidePanel';
import ContactForm from '../_components/ContactForm';
import ClassificationBadge from '../_components/ClassificationBadge';
import {
  Button,
  PageHeader,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';
import { CRM_CONTACT_CLASSIFICATIONS, CRM_CONTACT_CLASSIFICATION_LABELS, type CrmContactClassification } from '@/lib/crm/classification';

type Contact = {
  id: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  job_title: string | null; company_name: string | null; activity_count: number;
  classification: CrmContactClassification | null;
};

// 'ALL' and 'UNCLASSIFIED' are UI-only filter sentinels, not canonical
// classification values (see lib/crm/classification.ts) — 'UNCLASSIFIED'
// matches the same sentinel GET /api/crm/contacts already recognises
// server-side (classification IS NULL); 'ALL' simply omits the query
// param entirely.
type FilterValue = 'ALL' | 'UNCLASSIFIED' | CrmContactClassification;

export default function ContactsPage() {
  const searchParams = useSearchParams();
  // /crm/contacts?classification=EVENT_CONTACT pre-filters the list on
  // load — the "Event Contacts" shortcut this phase asks for resolves
  // to exactly this URL, reusing the SAME crm_contacts rows and the SAME
  // list page, never a separate view/table.
  const initialClassification = searchParams.get('classification');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<FilterValue>(
    initialClassification === 'UNCLASSIFIED' || (CRM_CONTACT_CLASSIFICATIONS as readonly string[]).includes(initialClassification ?? '')
      ? (initialClassification as FilterValue)
      : 'ALL',
  );

  async function load(filter: FilterValue) {
    setLoading(true);
    const qs = filter === 'ALL' ? '' : `?classification=${encodeURIComponent(filter)}`;
    const res = await fetch(`/api/crm/contacts${qs}`);
    if (res.ok) setContacts((await res.json()).contacts);
    setLoading(false);
  }
  useEffect(() => { load(classificationFilter); }, [classificationFilter]);

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return `${c.first_name} ${c.last_name}`.toLowerCase().includes(q)
      || (c.email ?? '').toLowerCase().includes(q)
      || (c.company_name ?? '').toLowerCase().includes(q);
  });

  return (
    <div style={{ maxWidth: 1000 }}>
      <PageHeader
        title="Contacts"
        description={`${contacts.length} total`}
        actions={<Button variant="primary" onClick={() => setShowAdd(true)}>+ Add Contact</Button>}
      />

      <WorkToolbar count={search && !loading ? `${filtered.length} of ${contacts.length}` : undefined}>
        <select
          aria-label="Filter by classification"
          className={toolbarControlClassName}
          value={classificationFilter}
          onChange={e => setClassificationFilter(e.target.value as FilterValue)}
        >
          <option value="ALL">All</option>
          <option value="UNCLASSIFIED">Unclassified</option>
          {CRM_CONTACT_CLASSIFICATIONS.map(value => (
            <option key={value} value={value}>{CRM_CONTACT_CLASSIFICATION_LABELS[value]}</option>
          ))}
        </select>
        <ToolbarSearch
          label="Search contacts"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </WorkToolbar>

      <TableContainer label="Contacts" minWidth={780}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Classification</th>
              <th scope="col">Company</th>
              <th scope="col">Job Title</th>
              <th scope="col">Email</th>
              <th scope="col" className={tableStyles.num}>Activities</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">No contacts yet.</TableStateRow>}
            {filtered.map(c => (
              <tr key={c.id}>
                <td className={tableStyles.primary}>
                  <Link href={`/crm/contacts/${c.id}`}>
                    {c.first_name} {c.last_name}
                  </Link>
                </td>
                <td><ClassificationBadge classification={c.classification} /></td>
                <td>{c.company_name ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{c.job_title ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{c.email ?? <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{c.activity_count}</td>
                <td className={tableStyles.actions}>
                  <Link href={`/crm/contacts/${c.id}`} className={tableStyles.link} aria-label={`View ${c.first_name} ${c.last_name}`}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Contact">
        <ContactForm onSaved={() => { setShowAdd(false); load(classificationFilter); }} />
      </SlidePanel>
    </div>
  );
}
