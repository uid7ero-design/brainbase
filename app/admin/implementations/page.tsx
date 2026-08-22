'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Client Implementations — list (Phase 2A) ────────────────────────────
// Founder/admin view of real client implementations. No fake/seeded rows —
// every value here comes from GET /api/implementations, which is always
// server-side organisation-scoped (super_admin sees every organisation;
// this page is itself only reachable by super_admin, gated by
// app/admin/layout.tsx). No services/milestones/tasks/progress here —
// those are later, separate slices.

const CARD = '#0e1014';
const BORDER = '#1a1d24';
const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

type Implementation = {
  id: string;
  organisation_id: string;
  organisation_name: string | null;
  name: string;
  service_type: string | null;
  stage: string;
  health: 'on_track' | 'at_risk' | 'blocked';
  owner_user_id: string | null;
  owner_name: string | null;
  target_launch_date: string | null;
  next_action: string | null;
  updated_at: string;
};

type Org = { id: string; name: string; slug: string };
type UserOption = { id: string; name: string };

const STAGE_LABEL: Record<string, string> = {
  planning: 'Planning', discovery: 'Discovery', setup: 'Setup', build: 'Build',
  client_review: 'Client Review', testing: 'Testing', ready_to_launch: 'Ready to Launch',
  live: 'Live', on_hold: 'On Hold', cancelled: 'Cancelled',
};
const HEALTH_META: Record<string, { label: string; color: string }> = {
  on_track: { label: 'On Track', color: '#34d399' },
  at_risk:  { label: 'At Risk',  color: '#f59e0b' },
  blocked:  { label: 'Blocked',  color: '#f87171' },
};

const thStyle: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const labelStyle: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', background: '#111318', border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 14, boxSizing: 'border-box' };
const errorStyle: React.CSSProperties = { color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
function btnStyle(bg: string): React.CSSProperties { return { padding: '9px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }

export default function ImplementationsPage() {
  const router = useRouter();
  const [implementations, setImplementations] = useState<Implementation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const [formOrgId, setFormOrgId] = useState('');
  const [formName, setFormName] = useState('');
  const [formServiceType, setFormServiceType] = useState('');
  const [formOwnerId, setFormOwnerId] = useState('');
  const [formTargetDate, setFormTargetDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function loadImplementations() {
    setLoading(true);
    fetch('/api/implementations')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { implementations?: Implementation[] }) => setImplementations(Array.isArray(d.implementations) ? d.implementations : []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadImplementations();
  }, []);

  function openCreate() {
    setCreateError(null);
    setShowCreate(true);
    if (orgs.length === 0) {
      fetch('/api/admin/orgs').then(r => (r.ok ? r.json() : { orgs: [] })).then(d => setOrgs(d.orgs ?? [])).catch(() => {});
    }
    if (users.length === 0) {
      fetch('/api/admin/users').then(r => (r.ok ? r.json() : { users: [] })).then(d => setUsers(d.users ?? [])).catch(() => {});
    }
  }

  async function submitCreate() {
    setCreateError(null);
    if (!formOrgId) { setCreateError('Select a client organisation.'); return; }
    if (!formName.trim()) { setCreateError('Implementation name is required.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/implementations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organisation_id: formOrgId,
          name: formName.trim(),
          service_type: formServiceType.trim() || undefined,
          owner_user_id: formOwnerId || undefined,
          target_launch_date: formTargetDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? 'Could not create implementation.'); return; }
      setShowCreate(false);
      setFormOrgId(''); setFormName(''); setFormServiceType(''); setFormOwnerId(''); setFormTargetDate('');
      loadImplementations();
      router.push(`/admin/implementations/${data.implementation.id}`);
    } catch {
      setCreateError('Could not create implementation.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, fontFamily: FONT, color: '#f9fafb' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Client Implementations</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            {loading ? 'Loading…' : `${implementations.length} implementation${implementations.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={openCreate} style={btnStyle('#1a6aff')}>+ New Implementation</button>
      </div>

      {loadError && (
        <p style={{ ...errorStyle, marginBottom: 16 }}>Couldn&apos;t load implementations. Try refreshing.</p>
      )}

      {showCreate && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>New Implementation</div>
          {createError && <p style={{ ...errorStyle, marginBottom: 12 }}>{createError}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Client organisation</label>
              <select value={formOrgId} onChange={e => setFormOrgId(e.target.value)} style={inputStyle}>
                <option value="">Select a real organisation…</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Implementation name</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} style={inputStyle} placeholder="e.g. Website rebuild" />
            </div>
            <div>
              <label style={labelStyle}>Service type</label>
              <input value={formServiceType} onChange={e => setFormServiceType(e.target.value)} style={inputStyle} placeholder="e.g. Website" />
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select value={formOwnerId} onChange={e => setFormOwnerId(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Target launch date</label>
              <input type="date" value={formTargetDate} onChange={e => setFormTargetDate(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitCreate} disabled={creating} style={btnStyle('#1a6aff')}>{creating ? 'Creating…' : 'Create Implementation'}</button>
            <button onClick={() => setShowCreate(false)} style={btnStyle('#1f2937')}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        {!loading && implementations.length === 0 && !loadError ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#9ca3af', marginBottom: 6 }}>No implementations yet</div>
            <div style={{ fontSize: 12, color: '#4b5563' }}>Create one for a real client organisation to get started.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Client', 'Implementation', 'Service type', 'Stage', 'Health', 'Owner', 'Target launch', 'Next action', 'Updated'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {implementations.map((impl, i) => {
                const health = HEALTH_META[impl.health] ?? HEALTH_META.on_track;
                return (
                  <tr
                    key={impl.id}
                    onClick={() => router.push(`/admin/implementations/${impl.id}`)}
                    style={{ borderBottom: i < implementations.length - 1 ? `1px solid ${BORDER}` : 'none', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{impl.organisation_name ?? '—'}</td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500 }}>{impl.name}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{impl.service_type ?? '—'}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{STAGE_LABEL[impl.stage] ?? impl.stage}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: health.color, background: `${health.color}18`, padding: '3px 8px', borderRadius: 4 }}>{health.label}</span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{impl.owner_name ?? 'Unassigned'}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{impl.target_launch_date ? new Date(impl.target_launch_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{impl.next_action ?? '—'}</td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#6b7280' }}>{new Date(impl.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
