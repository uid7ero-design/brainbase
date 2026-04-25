'use client';
import { useActionState, useState, useTransition } from 'react';
import { createUser, updateUserRole, deleteUser, resetUserPassword } from '@/app/actions/users';
import { logout } from '@/app/actions/auth';
import type { Role } from '@/lib/session';

const BG = '#07080B';
const CARD = '#0e1014';
const BORDER = '#1a1d24';
const ROLES: Role[] = ['super_admin', 'admin', 'manager', 'viewer'];
const ROLE_COLORS: Record<Role, string> = {
  super_admin: '#a78bfa',
  admin: '#60a5fa',
  manager: '#34d399',
  viewer: '#9ca3af',
};
const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
};

type User = { id: string; username: string; name: string; role: string; created_at: string };

export default function UsersClient({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [isPending, startTransition] = useTransition();

  const [createState, createAction, createPending] = useActionState(createUser, undefined);
  const [resetState, resetAction, resetPending] = useActionState(resetUserPassword, undefined);

  function handleRoleChange(userId: string, role: Role) {
    startTransition(() => updateUserRole(userId, role));
  }

  function handleDelete(user: User) {
    if (!confirm(`Delete user "${user.name}"? This cannot be undone.`)) return;
    startTransition(() => deleteUser(user.id));
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', fontFamily: 'var(--font-inter), Inter, sans-serif', color: '#f9fafb', padding: '40px 32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, maxWidth: 900, margin: '0 auto 32px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>User Management</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>{users.length} user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowAdd(true)} style={btnStyle('#1a6aff')}>+ Add User</button>
          <form action={logout}><button type="submit" style={btnStyle('#1a1d24')}>Sign out</button></form>
        </div>
      </div>

      {/* Users table */}
      <div style={{ maxWidth: 900, margin: '0 auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Username', 'Role', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: isPending ? 0.6 : 1 }}>
                <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500 }}>
                  {u.name}
                  {u.id === currentUserId && <span style={{ marginLeft: 8, fontSize: 10, color: '#6b7280', background: '#1a1d24', padding: '2px 6px', borderRadius: 4 }}>you</span>}
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{u.username}</td>
                <td style={{ padding: '14px 16px' }}>
                  <select
                    value={u.role}
                    disabled={u.id === currentUserId}
                    onChange={e => handleRoleChange(u.id, e.target.value as Role)}
                    style={{
                      background: '#111318', border: `1px solid ${BORDER}`, borderRadius: 6,
                      color: ROLE_COLORS[u.role as Role] ?? '#9ca3af', fontSize: 12, padding: '4px 8px', cursor: 'pointer',
                    }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setResetTarget(u)} style={smallBtn('#1f2937', '#d1d5db')}>Reset PW</button>
                    {u.id !== currentUserId && (
                      <button onClick={() => handleDelete(u)} style={smallBtn('rgba(239,68,68,0.1)', '#f87171')}>Delete</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <Modal title="Add User" onClose={() => setShowAdd(false)}>
          <form action={async (fd) => { await createAction(fd); if (!createState?.error) setShowAdd(false); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Full Name" name="name" />
            <Field label="Username" name="username" />
            <Field label="Password" name="password" type="password" />
            <div>
              <label style={labelStyle}>Role</label>
              <select name="role" defaultValue="viewer" style={{ width: '100%', padding: '10px 12px', background: '#111318', border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 14 }}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            {createState?.error && <p style={errorStyle}>{createState.error}</p>}
            {createState?.success && <p style={successStyle}>{createState.success}</p>}
            <button type="submit" disabled={createPending} style={btnStyle('#1a6aff')}>{createPending ? 'Creating…' : 'Create User'}</button>
          </form>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <Modal title={`Reset password — ${resetTarget.name}`} onClose={() => setResetTarget(null)}>
          <form action={async (fd) => { await resetAction(fd); if (!resetState?.error) setResetTarget(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input type="hidden" name="userId" value={resetTarget.id} />
            <Field label="New Password" name="password" type="password" />
            {resetState?.error && <p style={errorStyle}>{resetState.error}</p>}
            {resetState?.success && <p style={successStyle}>{resetState.success}</p>}
            <button type="submit" disabled={resetPending} style={btnStyle('#1a6aff')}>{resetPending ? 'Saving…' : 'Update Password'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
      <div style={{ background: '#0e1014', border: '1px solid #1a1d24', borderRadius: 14, padding: 28, width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, name, type = 'text' }: { label: string; name: string; type?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input name={name} type={type} required style={{ width: '100%', padding: '10px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const errorStyle: React.CSSProperties = { color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
const successStyle: React.CSSProperties = { color: '#34d399', fontSize: 13, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
function btnStyle(bg: string): React.CSSProperties { return { padding: '9px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
function smallBtn(bg: string, color: string): React.CSSProperties { return { padding: '5px 10px', background: bg, color, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
