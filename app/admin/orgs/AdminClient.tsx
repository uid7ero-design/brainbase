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

  const [orgForm, setOrgForm]   = useState({ name: '', slug: '' });
  const [userForm, setUserForm] = useState({ username: '', password: '', name: '', email: '', role: 'manager', organisationId: '' });

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    const res = await fetch('/api/admin/orgs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orgForm),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed.'); setSaving(false); return; }
    setOrgs(p => [data.org, ...p]);
    setOrgForm({ name: '', slug: '' });
    setSuccess(`Organisation "${data.org.name}" created.`);
    setSaving(false);
    router.refresh();
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userForm),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed.'); setSaving(false); return; }
    setUsers(p => [data.user, ...p]);
    setUserForm({ username: '', password: '', name: '', email: '', role: 'manager', organisationId: '' });
    setSuccess(`User "${data.user.username}" created.`);
    setSaving(false);
    router.refresh();
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8, color: '#F4F4F5', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: FONT,
  };
  const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', background: '#08090C', color: '#F4F4F5', fontFamily: FONT, padding: '24px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Administration
          </h1>
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

        {error   && <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 13, color: '#FCA5A5', marginBottom: 14 }}>{error}</div>}
        {success && <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.22)', borderRadius: 8, fontSize: 13, color: '#86EFAC', marginBottom: 14 }}>{success}</div>}

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
                      {['Name', 'Slug', 'Created'].map(h => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Create org form */}
            <form onSubmit={createOrg} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                New Organisation
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Name</span>
                <input required value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))} placeholder="City of Springfield" style={inp} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Slug (auto-generated)</span>
                <input required value={orgForm.slug} onChange={e => setOrgForm(f => ({ ...f, slug: slugify(e.target.value) }))} placeholder="city-of-springfield" style={inp} />
              </label>
              <button type="submit" disabled={saving} style={{ padding: '9px 14px', borderRadius: 8, background: saving ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.40)', color: '#C4B5FD', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s', fontFamily: FONT }}>
                {saving ? 'Creating…' : 'Create Organisation'}
              </button>
            </form>
          </div>
        )}

        {/* ── USERS tab ── */}
        {tab === 'users' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
                Users
              </div>
              {users.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No users yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                        {['Username', 'Name', 'Role', 'Organisation'].map(h => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Create user form */}
            <form onSubmit={createUser} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                New User
              </div>
              {[
                { label: 'Full Name',  key: 'name',     type: 'text',     placeholder: 'Jane Smith' },
                { label: 'Username',   key: 'username', type: 'text',     placeholder: 'jane.smith' },
                { label: 'Password',   key: 'password', type: 'password', placeholder: '8+ characters' },
                { label: 'Email',      key: 'email',    type: 'email',    placeholder: 'jane@council.gov.au' },
              ].map(f => (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{f.label}</span>
                  <input
                    required={f.key !== 'email'}
                    type={f.type}
                    placeholder={f.placeholder}
                    value={(userForm as Record<string, string>)[f.key]}
                    onChange={e => setUserForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={inp}
                  />
                </label>
              ))}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Role</span>
                <select value={userForm.role} onChange={e => setUserForm(p => ({ ...p, role: e.target.value }))} style={sel}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Organisation</span>
                <select required value={userForm.organisationId} onChange={e => setUserForm(p => ({ ...p, organisationId: e.target.value }))} style={sel}>
                  <option value="">Select organisation…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <button type="submit" disabled={saving} style={{ marginTop: 4, padding: '9px 14px', borderRadius: 8, background: saving ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.40)', color: '#C4B5FD', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s', fontFamily: FONT }}>
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
