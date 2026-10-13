'use client';
import { useEffect, useState } from 'react';
import { useHrDrawerFocusReturn } from './_components/useHrDrawerFocusReturn';
import Link from 'next/link';
import SlidePanel from './_components/SlidePanel';
import PersonForm from './_components/PersonForm';
import PersonDrawer, { type PersonDetail } from './_components/PersonDrawer';
import { HrOperationsNav, HrRegisterReset, HrRegisterPagination } from './_components/HrRegisterControls';
import { parsePeopleRegisterSnapshot, type PeopleRegisterRow } from '@/lib/hr/peopleRegisterContract';
import { EMPLOYMENT_STATUSES, WORKER_TYPES } from '@/lib/hr/personEnums';
import type { RegisterPagination } from '@/lib/hr/registerPaging';
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


export default function PeoplePage() {
  const [people, setPeople] = useState<PeopleRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [workerType, setWorkerType] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<RegisterPagination | null>(null);
  const [refresh, setRefresh] = useState(0);
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
  // task-oriented UX flag from GET /api/hr/people/register (never the raw
  // entitlement/grant record), used only to decide whether to show the
  // "+ Add Person" action at all. Server-side authorization (POST
  // /api/hr/people's own permission check) remains authoritative
  // regardless of this value — hiding the button is a UX courtesy, not
  // the security boundary.
  const [canManage, setCanManage] = useState(false);

  useHrDrawerFocusReturn(openPersonId, !loading);

  function load() { setRefresh(value => value + 1); }
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setLoading(true); setError(''); setPeople([]); setCanManage(false); setPagination(null);
      try {
        const response = await fetch(`/api/hr/people/register?${new URLSearchParams({ page: String(page), search, status, worker_type: workerType })}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unavailable');
        const data = parsePeopleRegisterSnapshot(await response.json());
        if (!controller.signal.aborted) {
          setPeople(data.people); setCanManage(Boolean(data.canManage)); setPagination(data.pagination);
        }
      } catch { if (!controller.signal.aborted) setError('Unable to load People. Please refresh to try again.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    });
    return () => controller.abort();
  }, [refresh, page, search, status, workerType]);

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
            <HrOperationsNav current="/people" />
            <button type="button" data-hr-register-refresh {...secondaryAction} disabled={loading} onClick={load}>Refresh</button>
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

      <WorkToolbar>
        <ToolbarSearch label="Search people, job titles or teams" value={search} onChange={e => { setSearch(e.target.value.slice(0, 200)); setPage(1); }} />
        <label>Employment status{' '}<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="all">All employment statuses</option>{EMPLOYMENT_STATUSES.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <label>Worker type{' '}<select value={workerType} onChange={event => { setWorkerType(event.target.value); setPage(1); }}>
          <option value="all">All worker types</option>{WORKER_TYPES.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <HrRegisterReset active={Boolean(search) || status !== 'all' || workerType !== 'all' || page !== 1} onReset={() => { setSearch(''); setStatus('all'); setWorkerType('all'); setPage(1); }} />
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
            {!loading && !error && people.length === 0 && (
              <TableStateRow colSpan={7} kind="empty">
                {!search.trim() && status === 'all' && workerType === 'all'
                  ? (canManage ? 'No people yet. Add your first person to get started.' : 'No people to show yet.')
                  : 'No people match your search.'}
              </TableStateRow>
            )}
            {!loading && !error && people.map(p => (
              <tr key={p.id}>
                <td className={tableStyles.primary}>
                  <button type="button" data-hr-person-id={p.id} onClick={() => setOpenPersonId(p.id)}>
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

      {!loading && !error && pagination && <HrRegisterPagination page={pagination.page} total={pagination.total} onChange={setPage} />}

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
        onClose={() => { setOpenPersonId(null); load(); }}
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
