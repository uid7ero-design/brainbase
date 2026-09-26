'use client';
import { useEffect, useState } from 'react';

// HR Administrator Management UI — minimal grant/revoke surface for the
// HR-administrator entitlement, reusing app/people/page.tsx's and
// app/people/teams/page.tsx's own styling constants/structure rather
// than introducing a separate design language. Sits at a sibling route
// under the existing app/people/layout.tsx (same People-module
// capability gate, including the HR-2 super_admin bypass — no layout
// change needed).
//
// Unlike Teams (whose own GET is available to any HR-entitled viewer,
// with only the write actions canManage-gated), GET /api/hr/
// administrators itself requires canManageHrAccess — listing who the
// HR administrators are is itself sensitive organisational metadata.
// This page therefore has no separate client-side canManage flag of
// its own: a non-admin viewer's fetch simply 403s and the existing
// generic error state renders, exactly like any other denied fetch in
// this module. There is no client-side authorization decision here at
// all — the API route's own canManageHrAccess(ctx) check remains the
// only real boundary; the "Manage Administrators" entry point on
// app/people/page.tsx is a UX courtesy gated on that page's own
// server-returned canManage flag, matching "Manage Teams" exactly.
//
// Grant is explicit-selection-only from a same-org candidate list (the
// same GET response's own is_hr_administrator: false rows) — never
// auto-matched by name/email. Revoke uses the existing inline confirm/
// cancel row state app/people/teams/page.tsx's own Archive action
// already established, never a blocking native window.confirm().
const CARD = 'var(--bg-surface)'; const BORDER = 'var(--border)';

type AdminUser = { id: string; name: string; email: string | null; is_hr_administrator: boolean; grant_eligible: boolean };

export default function AdministratorsPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [granting, setGranting] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError('');
    const res = await fetch('/api/hr/administrators');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not load HR administrators.');
    }
    setLoading(false);
  }
  useEffect(() => { queueMicrotask(() => { load(); }); }, []);

  const administrators = users.filter(u => u.is_hr_administrator);
  const candidates = users.filter(u => !u.is_hr_administrator && u.grant_eligible);

  async function grant() {
    if (!selectedUserId) return;
    setGranting(true); setActionError('');
    const res = await fetch('/api/hr/administrators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: selectedUserId }),
    });
    if (res.ok) {
      setSelectedUserId('');
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error ?? 'Could not grant HR administrator access.');
    }
    setGranting(false);
  }

  async function revoke(userId: string) {
    setActionError('');
    const res = await fetch(`/api/hr/administrators?userId=${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setConfirmRevokeId(null);
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error ?? 'Could not revoke HR administrator access.');
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>HR Administrators</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
          Grant or revoke HR administrator access for your organisation.
        </p>
      </div>

      {!loading && !error && (
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} style={sel}>
            <option value="">— Select a user to grant —</option>
            {candidates.map(u => (
              <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ''}</option>
            ))}
          </select>
          <button onClick={grant} disabled={!selectedUserId || granting} style={btn('var(--purple-600)')}>
            {granting ? 'Granting…' : 'Grant'}
          </button>
        </div>
      )}

      {actionError && <p style={{ color: '#f87171', fontSize: 13, margin: '8px 0 0' }}>{actionError}</p>}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Email', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} style={empty}>Loading…</td></tr>}
            {!loading && error && <tr><td colSpan={3} style={{ ...empty, color: '#f87171' }}>{error}</td></tr>}
            {!loading && !error && administrators.length === 0 && (
              <tr><td colSpan={3} style={empty}>No HR administrators yet.</td></tr>
            )}
            {!loading && !error && administrators.map((u, i) => (
              <tr key={u.id} style={{ borderBottom: i < administrators.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px', color: 'var(--text-primary)', fontWeight: 500, fontSize: 14 }}>{u.name}</td>
                <td style={td}>{u.email ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td style={{ padding: '13px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {confirmRevokeId === u.id ? (
                    <>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginRight: 6 }}>Revoke access?</span>
                      <button onClick={() => revoke(u.id)} style={{ ...linkBtn, color: '#f87171' }}>Confirm</button>
                      <button onClick={() => setConfirmRevokeId(null)} style={linkBtn}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmRevokeId(u.id)} style={linkBtn}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: 'var(--text-secondary)' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: '0 6px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'var(--bg-raised)', border: '1px solid #1a1d24', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
