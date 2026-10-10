'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import {
  Badge,
  Field,
  FormActions,
  FormError,
  PageHeader,
  TableContainer,
  TableStateRow,
  buttonProps,
  fieldControlClassName,
  tableStyles,
} from '@/components/ui/app';

// HR-2 Step 1B — minimal Teams management UI, reusing app/people/
// page.tsx's own styling constants/structure rather than introducing a
// separate design language. Sits at a sibling route under the existing
// app/people/layout.tsx (same People-module capability gate, including
// the HR-2 super_admin bypass — no layout change needed), matching the
// app/commercial precedent (its own invoices/quotes/purchasing pages)
// of sibling route segments over in-page tabs. Management actions
// (create/edit/archive/restore/"Show archived")
// are gated purely on the server-returned `canManage` flag (GET
// /api/hr/people's own ctx.isHrAdministrator projection, already
// established since HR-1) — a UX courtesy only, exactly like
// app/people/page.tsx's own "+ Add Person" gating; every action's real
// authorization boundary is the API route itself (PATCH/archive/restore
// each independently require ctx.isHrAdministrator, and
// ?include_archived=1 independently 403s for a non-admin caller).

type Team = {
  id: string;
  name: string;
  description: string | null;
  manager_person_id: string | null;
  archived_at: string | null;
};
type ManagerOption = { id: string; first_name: string; last_name: string };

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  // Inline confirmation state for Archive — this repo avoids native
  // window.confirm() (a blocking dialog), so "confirm" is just which
  // row id is currently showing its confirm/cancel controls.
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const [refresh, setRefresh] = useState(0);
  async function load() { setRefresh(value => value + 1); }
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setLoading(true); setError(''); setTeams([]); setManagers([]); setCanManage(false); setConfirmArchiveId(null);
      const teamsUrl = showArchived ? '/api/hr/teams?include_archived=1' : '/api/hr/teams';
      try {
        const [teamsRes, peopleRes] = await Promise.all([
          fetch(teamsUrl, { signal: controller.signal, cache: 'no-store' }),
          fetch('/api/hr/people', { signal: controller.signal, cache: 'no-store' }),
        ]);
        if (!teamsRes.ok || !peopleRes.ok) throw new Error('Unavailable');
        const [data, peopleData] = await Promise.all([teamsRes.json(), peopleRes.json()]);
        if (!Array.isArray(data.teams) || !data.teams.every((team: Team) => team && typeof team.id === 'string' && typeof team.name === 'string'
          && [team.description, team.manager_person_id, team.archived_at].every(value => value === null || typeof value === 'string'))
          || !Array.isArray(peopleData.people) || !peopleData.people.every((person: ManagerOption) => person && typeof person.id === 'string' && typeof person.first_name === 'string' && typeof person.last_name === 'string')
          || typeof peopleData.canManage !== 'boolean') throw new Error('Invalid Teams');
        if (!controller.signal.aborted) {
          setTeams(data.teams); setManagers(peopleData.people); setCanManage(peopleData.canManage);
        }
      } catch { if (!controller.signal.aborted) setError('Could not load Teams. Please refresh to try again.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    });
    return () => controller.abort();
  }, [showArchived, refresh]);

  async function archive(id: string) {
    setActionError('');
    const res = await fetch(`/api/hr/teams/${id}/archive`, { method: 'POST' });
    if (res.ok) { setConfirmArchiveId(null); load(); return; }
    const data = await res.json().catch(() => ({}));
    setActionError(data.error ?? 'Could not archive team.');
  }
  async function restore(id: string) {
    setActionError('');
    const res = await fetch(`/api/hr/teams/${id}/restore`, { method: 'POST' });
    if (res.ok) { load(); return; }
    const data = await res.json().catch(() => ({}));
    setActionError(data.error ?? 'Could not restore team.');
  }

  function managerName(id: string | null) {
    if (!id) return null;
    const m = managers.find(mm => mm.id === id);
    return m ? `${m.first_name} ${m.last_name}` : null;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Teams"
        description={<>Manage your organisation&apos;s teams.</>}
        actions={
          <>
            <button type="button" {...buttonProps('secondary')} disabled={loading} onClick={load}>Refresh</button>
            {canManage && (
              <>
                <label style={checkboxLabel}>
                  <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                  Show archived
                </label>
                <button onClick={() => setShowCreate(true)} type="button" {...buttonProps('primary')}>+ Create Team</button>
              </>
            )}
          </>
        }
      />

      {actionError && <div style={{ marginBottom: 12 }}><FormError>{actionError}</FormError></div>}

      <TableContainer label="Teams" minWidth={680}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Description</th>
              <th scope="col">Manager</th>
              <th scope="col">Status</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={5} kind="loading">Loading…</TableStateRow>}
            {!loading && error && <TableStateRow colSpan={5} kind="error">{error}</TableStateRow>}
            {!loading && !error && teams.length === 0 && (
              <TableStateRow colSpan={5} kind="empty">No teams yet.</TableStateRow>
            )}
            {!loading && !error && teams.map(t => {
              const archived = t.archived_at !== null;
              return (
                <tr key={t.id} style={{ opacity: archived ? 0.7 : 1 }}>
                  <td className={tableStyles.primary}>{t.name}</td>
                  <td>{t.description ?? <span className={tableStyles.muted}>—</span>}</td>
                  <td>{managerName(t.manager_person_id) ?? <span className={tableStyles.muted}>—</span>}</td>
                  <td>
                    {archived
                      ? <Badge state="inactive">Archived</Badge>
                      : <Badge state="success">Active</Badge>}
                  </td>
                  <td className={tableStyles.actions}>
                    <div style={rowActions}>
                    {canManage && !archived && (
                      confirmArchiveId === t.id ? (
                        <>
                          <span style={confirmPrompt}>Archive this team?</span>
                          <button onClick={() => archive(t.id)} type="button" {...buttonProps('danger', 'sm')} aria-label={`Confirm archive ${t.name}`}>Confirm</button>
                          <button onClick={() => setConfirmArchiveId(null)} type="button" {...buttonProps('ghost', 'sm')}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditingTeam(t)} type="button" {...buttonProps('ghost', 'sm')} aria-label={`Edit ${t.name}`}>Edit</button>
                          <button onClick={() => setConfirmArchiveId(t.id)} type="button" {...buttonProps('ghost', 'sm')} aria-label={`Archive ${t.name}`}>Archive</button>
                        </>
                      )
                    )}
                    {/* Archived teams have no Edit action while archived — restore, edit, optionally archive again. */}
                    {canManage && archived && (
                      <button onClick={() => restore(t.id)} type="button" {...buttonProps('secondary', 'sm')} aria-label={`Restore ${t.name}`}>Restore</button>
                    )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel open={showCreate} onClose={() => setShowCreate(false)} title="Create Team">
        <TeamForm canManage={canManage} managers={managers} onSaved={() => { setShowCreate(false); load(); }} />
      </SlidePanel>

      <SlidePanel open={editingTeam !== null} onClose={() => setEditingTeam(null)} title="Edit Team">
        {editingTeam && (
          <TeamForm canManage={canManage} initial={editingTeam} managers={managers} onSaved={() => { setEditingTeam(null); load(); }} />
        )}
      </SlidePanel>
    </div>
  );
}

function TeamForm({ initial, managers, onSaved, canManage }: {
  initial?: Team; managers: ManagerOption[]; onSaved: () => void; canManage: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [managerPersonId, setManagerPersonId] = useState(initial?.manager_person_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || saving) return;
    setSaving(true); setError('');
    const isEdit = Boolean(initial?.id);
    const url = isEdit ? `/api/hr/teams/${initial!.id}` : '/api/hr/teams';
    const method = isEdit ? 'PATCH' : 'POST';
    const body = { name, description: description || null, manager_person_id: managerPersonId || null };
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field label="Name" required>
        {control => <input {...control} value={name} onChange={e => setName(e.target.value)} required className={fieldControlClassName} />}
      </Field>
      <Field label="Description">
        {control => <input {...control} value={description ?? ''} onChange={e => setDescription(e.target.value)} className={fieldControlClassName} />}
      </Field>
      <Field label="Manager">
        {control => (
          <select {...control} value={managerPersonId ?? ''} onChange={e => setManagerPersonId(e.target.value)} className={fieldControlClassName}>
            <option value="">— No manager —</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        )}
      </Field>
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <button type="submit" disabled={saving || !canManage} {...buttonProps('primary')}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Team'}
        </button>
      </FormActions>
    </form>
  );
}

const checkboxLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' };
const rowActions: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 };
const confirmPrompt: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 12, marginRight: 4 };
