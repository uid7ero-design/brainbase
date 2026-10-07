'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SlidePanel from './_components/SlidePanel';
import PersonForm from './_components/PersonForm';
import PersonDrawer, { type PersonDetail } from './_components/PersonDrawer';
import {
  Badge,
  PageHeader,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  buttonProps,
  tableStyles,
  type SemanticState,
} from '@/components/ui/app';

type Person = {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  worker_type: string;
  employment_status: string;
  team_name?: string | null;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
};

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  // The person currently being edited (Edit action from PersonDrawer) —
  // separate from openPersonId/showAdd so the read-only drawer and the
  // two write panels (Add, Edit) never fight over the same piece of
  // state. PersonForm already fully supports edit mode given an
  // `initial` person (see its own submit(): initial?.id present ->
  // PATCH, otherwise POST) — this phase only wires an existing person
  // into it, no change to PersonForm itself.
  const [editingPerson, setEditingPerson] = useState<PersonDetail | null>(null);
  // canManage reflects whether THIS viewer is an HR administrator — a
  // task-oriented UX flag from GET /api/hr/people (never the raw
  // entitlement/grant record), used only to decide whether to show the
  // "+ Add Person" action at all. Server-side authorization (POST
  // /api/hr/people's own permission check) remains authoritative
  // regardless of this value — hiding the button is a UX courtesy, not
  // the security boundary.
  const [canManage, setCanManage] = useState(false);

  async function load() {
    setLoading(true); setError('');
    const res = await fetch('/api/hr/people');
    if (res.ok) {
      const data = await res.json();
      setPeople(data.people);
      setCanManage(Boolean(data.canManage));
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not load People.');
    }
    setLoading(false);
  }
  useEffect(() => { queueMicrotask(() => { load(); }); }, []);

  const filtered = people.filter(p => {
    const q = search.toLowerCase();
    return `${p.first_name} ${p.last_name}`.toLowerCase().includes(q)
      || (p.job_title ?? '').toLowerCase().includes(q)
      || (p.team_name ?? '').toLowerCase().includes(q);
  });

  // Shared app button look for the header links and the Add action.
  // Precomputed so the canManage-gated JSX below stays free of inline calls.
  const secondaryAction = buttonProps('secondary');
  const primaryAction = buttonProps('primary');

  return (
    <div style={{ maxWidth: 1000 }}>
      <PageHeader
        title="People"
        description={<>Your organisation&apos;s workers, teams, and basic employment information.</>}
        actions={
          <>
            <Link href="/people/lifecycle" {...secondaryAction}>Lifecycle Overview</Link>
            <Link href="/people/restricted-cases" {...secondaryAction}>Restricted Cases</Link>
            {canManage && (
              <>
                {/* HR-2 Step 1B — Teams management, gated identically to
                    "+ Add Person" on the same server-returned canManage
                    flag; app/people/teams itself independently re-derives
                    the same flag before showing any management action. */}
                <Link href="/people/teams" {...secondaryAction}>Manage Teams</Link>
                {/* HR Administrator Management UI — gated identically to
                    "Manage Teams" above, on the same server-returned
                    canManage flag; app/people/administrators itself
                    independently re-derives authorization via its own
                    GET /api/hr/administrators call (canManageHrAccess),
                    not this flag. */}
                <Link href="/people/administrators" {...secondaryAction}>Manage Administrators</Link>
                <Link href="/people/lifecycle-templates" {...secondaryAction}>Lifecycle Templates</Link>
                <button onClick={() => setShowAdd(true)} type="button" {...primaryAction}>+ Add Person</button>
              </>
            )}
          </>
        }
      />

      <WorkToolbar count={search && !loading && !error ? `${filtered.length} of ${people.length}` : undefined}>
        <ToolbarSearch label="Search people" value={search} onChange={e => setSearch(e.target.value)} />
      </WorkToolbar>

      <TableContainer label="People" minWidth={760}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Job Title</th>
              <th scope="col">Team</th>
              <th scope="col">Manager</th>
              <th scope="col">Worker Type</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading people…</TableStateRow>}
            {!loading && error && <TableStateRow colSpan={7} kind="error">{error}</TableStateRow>}
            {!loading && !error && filtered.length === 0 && (
              <TableStateRow colSpan={7} kind="empty">
                {people.length === 0
                  ? (canManage ? 'No people yet. Add your first person to get started.' : 'No people to show yet.')
                  : 'No people match your search.'}
              </TableStateRow>
            )}
            {filtered.map(p => (
              <tr key={p.id}>
                <td className={tableStyles.primary}>
                  <button type="button" onClick={() => setOpenPersonId(p.id)}>
                    {p.first_name} {p.last_name}
                  </button>
                </td>
                <td><StatusBadge status={p.employment_status} /></td>
                <td>{p.job_title ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{p.team_name ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>{p.manager_first_name ? `${p.manager_first_name} ${p.manager_last_name}` : <span className={tableStyles.muted}>—</span>}</td>
                <td style={{ textTransform: 'capitalize' }}>{p.worker_type}</td>
                <td className={tableStyles.actions}>
                  <button type="button" className={tableStyles.link} onClick={() => setOpenPersonId(p.id)} aria-label={`View ${p.first_name} ${p.last_name}`}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Person">
        <PersonForm canManage={canManage} onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>

      <SlidePanel open={editingPerson !== null} onClose={() => setEditingPerson(null)} title="Edit Person">
        {editingPerson && (
          <PersonForm initial={editingPerson} canManage={canManage} onSaved={() => { setEditingPerson(null); load(); }} />
        )}
      </SlidePanel>

      <PersonDrawer
        personId={openPersonId}
        canManage={canManage}
        onClose={() => setOpenPersonId(null)}
        onEdit={person => { setOpenPersonId(null); setEditingPerson(person); }}
      />
    </div>
  );
}

// Employment status → canonical semantic state. Text always visible; the
// domain word is kept as the label (only the tone is shared).
const EMPLOYMENT_STATUS_STATE: Record<string, SemanticState> = {
  active: 'success',
  onboarding: 'info',
  inactive: 'warning',
  ended: 'inactive',
};

function StatusBadge({ status }: { status: string }) {
  const state = EMPLOYMENT_STATUS_STATE[status] ?? 'inactive';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge state={state}>{label}</Badge>;
}
