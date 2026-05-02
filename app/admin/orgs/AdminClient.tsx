'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Org  = { id: string; name: string; slug: string; created_at: string };
type User = { id: string; username: string; name: string; email: string; role: string; organisation_id: string; org_name: string };

const FONT  = "var(--font-inter), -apple-system, sans-serif";
const ROLES = ['viewer', 'manager', 'admin', 'super_admin'];

function fmt(ts: string) {
  return new Date(ts).toLocaleDateString('en-AU', { dateStyle: 'medium' });
}
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface Props { orgs: Org[]; users: User[]; }

export default function AdminClient({ orgs: initial, users: initialUsers }: Props) {
  const router = useRouter();
  const [orgs,    setOrgs]    = useState<Org[]>(initial);
  const [users,   setUsers]   = useState<User[]>(initialUsers);
  const [tab,     setTab]     = useState<'orgs' | 'users'>('orgs');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // Org state
  const [orgForm,    setOrgForm]    = useState({ name: '', slug: '' });
  const [editOrg,    setEditOrg]    = useState<Org | null>(null);
  const [editOrgForm, setEditOrgForm] = useState({ name: '', slug: '' });

  // User state
  const [userForm,   setUserForm]   = useState({ username: '', password: '', name: '', email: '', role: 'manager', organisationId: '' });
  const [editUser,   setEditUser]   = useState<User | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', role: '', organisationId: '', email: '', password: '' });

  function flash(msg: string, isError = false) {
    if (isError) { setError(msg); setSuccess(''); }
    else          { setSuccess(msg); setError(''); }
  }

  // ── Org actions ──────────────────────────────────────────────
  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    const res = await fetch('/api/admin/orgs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orgForm),
    });
    const data = await res.json();
    if (!res.ok) { flash(data.error ?? 'Failed.', true); setSaving(false); return; }
    setOrgs(p => [data.org, ...p]);
    setOrgForm({ name: '', slug: '' });
    flash(`Organisation "${data.org.name}" created.`);
    setSaving(false);
    router.refresh();
  }

  function openEditOrg(org: Org) {
    setEditOrg(org);
    setEditOrgForm({ name: org.name, slug: org.slug });
  }

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!editOrg) return;
    setSaving(true); setError(''); setSuccess('');
    const res = await fetch(`/api/admin/orgs?id=${editOrg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editOrgForm),
    });
    const data = await res.json();
    if (!res.ok) { flash(data.error ?? 'Failed.', true); setSaving(false); return; }
    setOrgs(p => p.map(o => o.id === editOrg.id ? data.org : o));
    setEditOrg(null);
    flash(`Organisation "${data.org.name}" updated.`);
    setSaving(false);
  }

  async function deleteOrg(org: Org) {
    if (!confirm(`Delete "${org.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/orgs?id=${org.id}`, { method: 'DELETE' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); flash(data.error ?? 'Delete failed.', true); return; }
    setOrgs(p => p.filter(o => o.id !== org.id));
    flash(`"${org.name}" deleted.`);
  }

  // ── User actions ─────────────────────────────────────────────
  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userForm),
    });
    const data = await res.json();
    if (!res.ok) { flash(data.error ?? 'Failed.', true); setSaving(false); return; }
    setUsers(p => [data.user, ...p]);
    setUserForm({ username: '', password: '', name: '', email: '', role: 'manager', organisationId: '' });
    flash(`User "${data.user.username}" created.`);
    setSaving(false);
    router.refresh();
  }

  function openEditUser(user: User) {
    setEditUser(user);
    setEditUserForm({ name: user.name, role: user.role, organisationId: user.organisation_id, email: user.email ?? '', password: '' });
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true); setError(''); setSuccess('');
    const body: Record<string, string> = {
      name: editUserForm.name,
      role: editUserForm.role,
      organisationId: editUserForm.organisationId,
      email: editUserForm.email,
    };
    if (editUserForm.password) body.password = editUserForm.password;
    const res = await fetch(`/api/admin/users?id=${editUser.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { flash(data.error ?? 'Failed.', true); setSaving(false); return; }
    setUsers(p => p.map(u => u.id === editUser.id ? data.user : u));
    setEditUser(null);
    flash(`User "${data.user.username}" updated.`);
    setSaving(false);
  }

  async function deleteUser(user: User) {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users?id=${user.id}`, { method: 'DELETE' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); flash(data.error ?? 'Delete failed.', true); return; }
    setUsers(p => p.filter(u => u.id !== user.id));
    flash(`User "${user.username}" deleted.`);
  }

  // ── Styles ──────────────────────────────────────────────────
  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8, color: '#F4F4F5', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: FONT,
  };
  const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', background: '#08090C', color: '#F4F4F5', fontFamily: FONT, padding: '24px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Administration</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.40)' }}>
            Super admin panel — manage organisations and users.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 20 }}>
          {(['orgs', 'users'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '9px 18px', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid #8B5CF6' : '2px solid transparent',
              color: tab === t ? '#C4B5FD' : 'rgba(255,255,255,0.40)',
              fontSize: 13, fontWeight: tab === t ? 600 : 400, cursor: 'pointer',
              textTransform: 'capitalize', transition: 'all 0.15s', fontFamily: FONT,
            }}>
              {t === 'orgs' ? `Organisations (${orgs.length})` : `Users (${users.length})`}
            </button>
          ))}
        </div>

        {error   && <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 13, color: '#FCA5A5', marginBottom: 14 }}>{error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#FCA5A5', cursor: 'pointer', marginLeft: 8, fontFamily: FONT }}>×</button></div>}
        {success && <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.22)', borderRadius: 8, fontSize: 13, color: '#86EFAC', marginBottom: 14 }}>{success} <button onClick={() => setSuccess('')} style={{ background: 'none', border: 'none', color: '#86EFAC', cursor: 'pointer', marginLeft: 8, fontFamily: FONT }}>×</button></div>}

        {/* ── ORGANISATIONS tab ── */}
        {tab === 'orgs' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, alignItems: 'start' }}>
            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
                Organisations
              </div>
              {orgs.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No organisations yet.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      {['Name', 'Slug', 'Created', ''].map(h => (
                        <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map(o => (
                      <tr key={o.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>{o.name}</td>
                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', fontSize: 12 }}>{o.slug}</td>
                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{fmt(o.created_at)}</td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => openEditOrg(o)} style={smallBtn('rgba(124,58,237,0.15)', '#C4B5FD', 'rgba(124,58,237,0.30)')}>Edit</button>
                            <button onClick={() => deleteOrg(o)} style={smallBtn('rgba(239,68,68,0.10)', '#FCA5A5', 'rgba(239,68,68,0.22)')}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Create org form */}
            <form onSubmit={createOrg} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>New Organisation</div>
              <Label text="Name">
                <input required value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))} placeholder="City of Springfield" style={inp} />
              </Label>
              <Label text="Slug">
                <input required value={orgForm.slug} onChange={e => setOrgForm(f => ({ ...f, slug: slugify(e.target.value) }))} placeholder="city-of-springfield" style={inp} />
              </Label>
              <PrimaryBtn disabled={saving}>{saving ? 'Creating…' : 'Create Organisation'}</PrimaryBtn>
            </form>
          </div>
        )}

        {/* ── USERS tab ── */}
        {tab === 'users' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>Users</div>
              {users.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No users yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 540 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                        {['Username', 'Name', 'Role', 'Organisation', ''].map(h => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: 12 }}>{u.username}</td>
                          <td style={{ padding: '9px 14px', fontWeight: 500 }}>{u.name}</td>
                          <td style={{ padding: '9px 14px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: u.role === 'super_admin' ? 'rgba(239,68,68,0.12)' : 'rgba(124,58,237,0.12)', color: u.role === 'super_admin' ? '#FCA5A5' : '#C4B5FD', border: `1px solid ${u.role === 'super_admin' ? 'rgba(239,68,68,0.25)' : 'rgba(124,58,237,0.25)'}` }}>
                              {u.role}
                            </span>
                          </td>
                          <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{u.org_name ?? '—'}</td>
                          <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => openEditUser(u)} style={smallBtn('rgba(124,58,237,0.15)', '#C4B5FD', 'rgba(124,58,237,0.30)')}>Edit</button>
                              <button onClick={() => deleteUser(u)} style={smallBtn('rgba(239,68,68,0.10)', '#FCA5A5', 'rgba(239,68,68,0.22)')}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Create user form */}
            <form onSubmit={createUser} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>New User</div>
              {([
                { label: 'Full Name', key: 'name',     type: 'text',     ph: 'Jane Smith' },
                { label: 'Username',  key: 'username', type: 'text',     ph: 'jane.smith' },
                { label: 'Password',  key: 'password', type: 'password', ph: '8+ characters' },
                { label: 'Email',     key: 'email',    type: 'email',    ph: 'jane@council.gov.au' },
              ] as const).map(f => (
                <Label key={f.key} text={f.label}>
                  <input
                    required={f.key !== 'email'}
                    type={f.type}
                    placeholder={f.ph}
                    value={(userForm as Record<string, string>)[f.key]}
                    onChange={e => setUserForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={inp}
                  />
                </Label>
              ))}
              <Label text="Role">
                <select value={userForm.role} onChange={e => setUserForm(p => ({ ...p, role: e.target.value }))} style={sel}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Label>
              <Label text="Organisation">
                <select required value={userForm.organisationId} onChange={e => setUserForm(p => ({ ...p, organisationId: e.target.value }))} style={sel}>
                  <option value="">Select organisation…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Label>
              <PrimaryBtn disabled={saving}>{saving ? 'Creating…' : 'Create User'}</PrimaryBtn>
            </form>
          </div>
        )}

      </div>

      {/* ── Edit Org Modal ── */}
      {editOrg && (
        <Modal title={`Edit — ${editOrg.name}`} onClose={() => setEditOrg(null)}>
          <form onSubmit={saveOrg} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Label text="Organisation Name">
              <input required value={editOrgForm.name} onChange={e => setEditOrgForm(f => ({ ...f, name: e.target.value }))} style={inp} />
            </Label>
            <Label text="Slug">
              <input required value={editOrgForm.slug} onChange={e => setEditOrgForm(f => ({ ...f, slug: slugify(e.target.value) }))} style={inp} />
            </Label>
            <PrimaryBtn disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryBtn>
          </form>
        </Modal>
      )}

      {/* ── Edit User Modal ── */}
      {editUser && (
        <Modal title={`Edit — ${editUser.username}`} onClose={() => setEditUser(null)}>
          <form onSubmit={saveUser} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Label text="Full Name">
              <input required value={editUserForm.name} onChange={e => setEditUserForm(f => ({ ...f, name: e.target.value }))} style={inp} />
            </Label>
            <Label text="Email">
              <input type="email" value={editUserForm.email} onChange={e => setEditUserForm(f => ({ ...f, email: e.target.value }))} placeholder="Leave blank to clear" style={inp} />
            </Label>
            <Label text="Role">
              <select value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))} style={sel}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Label>
            <Label text="Organisation">
              <select required value={editUserForm.organisationId} onChange={e => setEditUserForm(f => ({ ...f, organisationId: e.target.value }))} style={sel}>
                <option value="">Select organisation…</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Label>
            <Label text="New Password (leave blank to keep)">
              <input type="password" value={editUserForm.password} onChange={e => setEditUserForm(f => ({ ...f, password: e.target.value }))} placeholder="8+ characters" style={inp} />
            </Label>
            <PrimaryBtn disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryBtn>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
      <div style={{ background: '#0d0f14', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: 28, width: '100%', maxWidth: 440, fontFamily: "var(--font-inter), -apple-system, sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#F4F4F5' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.40)', fontSize: 20, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{text}</span>
      {children}
    </label>
  );
}

function PrimaryBtn({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled} style={{
      padding: '9px 14px', borderRadius: 8,
      background: disabled ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.25)',
      border: '1px solid rgba(124,58,237,0.40)', color: '#C4B5FD',
      fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s', fontFamily: "var(--font-inter), -apple-system, sans-serif",
    }}>
      {children}
    </button>
  );
}

function smallBtn(bg: string, color: string, border: string): React.CSSProperties {
  return { padding: '4px 10px', background: bg, color, border: `1px solid ${border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "var(--font-inter), -apple-system, sans-serif" };
}
