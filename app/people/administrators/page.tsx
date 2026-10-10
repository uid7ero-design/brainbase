'use client';
import { useEffect, useState } from 'react';
import {
  FormError,
  PageHeader,
  TableContainer,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';

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

type AdminUser = { id: string; name: string; email: string | null; is_hr_administrator: boolean; grant_eligible: boolean };

export default function AdministratorsPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [granting, setGranting] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const [refresh, setRefresh] = useState(0);

  async function load() { setRefresh(value => value + 1); }
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setLoading(true); setError(''); setUsers([]); setSelectedUserId(''); setConfirmRevokeId(null);
      try {
        const res = await fetch('/api/hr/administrators', { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('Unavailable');
        const data = await res.json();
        if (!Array.isArray(data.users) || !data.users.every((user: AdminUser) => user && typeof user.id === 'string' && typeof user.name === 'string'
          && (user.email === null || typeof user.email === 'string') && typeof user.is_hr_administrator === 'boolean' && typeof user.grant_eligible === 'boolean')) throw new Error('Invalid administrators');
        if (!controller.signal.aborted) setUsers(data.users);
      } catch { if (!controller.signal.aborted) setError('Could not load HR administrators. Please refresh to try again.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    });
    return () => controller.abort();
  }, [refresh]);


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
      <PageHeader
        title="HR Administrators"
        actions={<button type="button" {...buttonProps('secondary')} disabled={loading} onClick={load}>Refresh</button>}
        description="Grant or revoke HR administrator access for your organisation."
      />

      {!loading && !error && (
        <WorkToolbar>
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className={toolbarControlClassName} aria-label="User to grant HR administrator access" style={{ flex: '1 1 240px', minWidth: 0 }}>
            <option value="">— Select a user to grant —</option>
            {candidates.map(u => (
              <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ''}</option>
            ))}
          </select>
          <button onClick={grant} disabled={!selectedUserId || granting} type="button" {...buttonProps('primary')}>
            {granting ? 'Granting…' : 'Grant'}
          </button>
        </WorkToolbar>
      )}

      {actionError && <div style={{ marginBottom: 12 }}><FormError>{actionError}</FormError></div>}

      <TableContainer label="HR administrators" minWidth={560}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} style={empty}>Loading…</td></tr>}
            {!loading && error && <tr><td colSpan={3} style={{ ...empty, color: '#f87171' }}>{error}</td></tr>}
            {!loading && !error && administrators.length === 0 && (
              <tr><td colSpan={3} style={empty}>No HR administrators yet.</td></tr>
            )}
            {!loading && !error && administrators.map(u => (
              <tr key={u.id}>
                <td className={tableStyles.primary}>{u.name}</td>
                <td>{u.email ?? <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.actions}>
                  <div style={rowActions}>
                  {confirmRevokeId === u.id ? (
                    <>
                      <span style={confirmPrompt}>Revoke access?</span>
                      <button onClick={() => revoke(u.id)} type="button" {...buttonProps('danger', 'sm')} aria-label={`Confirm revoke HR administrator access for ${u.name}`}>Confirm</button>
                      <button onClick={() => setConfirmRevokeId(null)} type="button" {...buttonProps('ghost', 'sm')}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmRevokeId(u.id)} type="button" {...buttonProps('ghost', 'sm')} aria-label={`Revoke HR administrator access for ${u.name}`}>Revoke</button>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}

// Mirrors the shared TableStateRow look. The loading / error rows keep
// their literal markup (and the error row its '#f87171' override) because
// tests/containment/hrAdministratorsUi.test.ts pins those exact strings.
const empty: React.CSSProperties = { padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 };
const rowActions: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 };
const confirmPrompt: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 12, marginRight: 4 };
