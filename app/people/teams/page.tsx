'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';

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
const CARD = 'var(--bg-surface)'; const BORDER = 'var(--border)';

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

  async function load() {
    setLoading(true); setError('');
    const teamsUrl = showArchived ? '/api/hr/teams?include_archived=1' : '/api/hr/teams';
    const [teamsRes, peopleRes] = await Promise.all([
      fetch(teamsUrl),
      fetch('/api/hr/people'),
    ]);
    if (teamsRes.ok) {
      const data = await teamsRes.json();
      setTeams(data.teams ?? []);
    } else {
      const data = await teamsRes.json().catch(() => ({}));
      setError(data.error ?? 'Could not load Teams.');
    }
    if (peopleRes.ok) {
      const data = await peopleRes.json();
      setManagers(data.people ?? []);
      setCanManage(Boolean(data.canManage));
    }
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only on showArchived; `load` is redefined every render and isn't itself a dependency.
  useEffect(() => { queueMicrotask(() => { load(); }); }, [showArchived]);

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Teams</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
            Manage your organisation&apos;s teams.
          </p>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            <button onClick={() => setShowCreate(true)} style={btn('var(--purple-600)')}>+ Create Team</button>
          </div>
        )}
      </div>

      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '8px 0 0' }}>{actionError}</p>}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Description', 'Manager', 'Status', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={empty}>Loading…</td></tr>}
            {!loading && error && <tr><td colSpan={5} style={{ ...empty, color: '#f87171' }}>{error}</td></tr>}
            {!loading && !error && teams.length === 0 && (
              <tr><td colSpan={5} style={empty}>No teams yet.</td></tr>
            )}
            {!loading && !error && teams.map((t, i) => {
              const archived = t.archived_at !== null;
              return (
                <tr key={t.id} style={{ borderBottom: i < teams.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: archived ? 0.55 : 1 }}>
                  <td style={{ padding: '13px 16px', color: 'var(--text-primary)', fontWeight: 500, fontSize: 14 }}>{t.name}</td>
                  <td style={td}>{t.description ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={td}>{managerName(t.manager_person_id) ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={td}>
                    {archived
                      ? <span style={{ color: 'var(--text-secondary)' }}>Archived</span>
                      : <span style={{ color: '#6ee7b7' }}>Active</span>}
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canManage && !archived && (
                      confirmArchiveId === t.id ? (
                        <>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginRight: 6 }}>Archive this team?</span>
                          <button onClick={() => archive(t.id)} style={{ ...linkBtn, color: '#f87171' }}>Confirm</button>
                          <button onClick={() => setConfirmArchiveId(null)} style={linkBtn}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditingTeam(t)} style={linkBtn}>Edit</button>
                          <button onClick={() => setConfirmArchiveId(t.id)} style={linkBtn}>Archive</button>
                        </>
                      )
                    )}
                    {/* Archived teams have no Edit action while archived — restore, edit, optionally archive again. */}
                    {canManage && archived && (
                      <button onClick={() => restore(t.id)} style={linkBtn}>Restore</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showCreate} onClose={() => setShowCreate(false)} title="Create Team">
        <TeamForm managers={managers} onSaved={() => { setShowCreate(false); load(); }} />
      </SlidePanel>

      <SlidePanel open={editingTeam !== null} onClose={() => setEditingTeam(null)} title="Edit Team">
        {editingTeam && (
          <TeamForm initial={editingTeam} managers={managers} onSaved={() => { setEditingTeam(null); load(); }} />
        )}
      </SlidePanel>
    </div>
  );
}

function TeamForm({ initial, managers, onSaved }: {
  initial?: Team; managers: ManagerOption[]; onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [managerPersonId, setManagerPersonId] = useState(initial?.manager_person_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      <div>
        <label style={lbl}>Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} required style={inputStyle} />
      </div>
      <div>
        <label style={lbl}>Description</label>
        <input value={description ?? ''} onChange={e => setDescription(e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={lbl}>Manager</label>
        <select value={managerPersonId ?? ''} onChange={e => setManagerPersonId(e.target.value)} style={sel}>
          <option value="">— No manager —</option>
          {managers.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
        </select>
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: 'var(--purple-600)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Team'}
      </button>
    </form>
  );
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: 'var(--text-secondary)' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: '0 6px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' };
const lbl: React.CSSProperties = { display: 'block', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'var(--bg-raised)', border: '1px solid #1a1d24', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'var(--bg-raised)', border: '1px solid #1a1d24', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
