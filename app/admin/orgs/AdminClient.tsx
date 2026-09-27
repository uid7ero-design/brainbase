'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getOrganisationCapabilities, setOrganisationCapability, type OrganisationCapability } from '@/app/actions/orgModules';
import { Button, Dialog, PageHeader, StateMessage, TableContainer, buttonProps, tableStyles } from '@/components/ui/app';

type Org  = { id: string; name: string; slug: string; created_at: string };
type User = { id: string; username: string; name: string; email: string; role: string; organisation_id: string; org_name: string };
type CrmClient = { organisation_id?: string | null; stage?: string; estimated_value?: number | null; next_action?: string | null; org?: string };

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

  // CRM clients (founder pipeline) — fetched client-side
  const [crmClients, setCrmClients] = useState<CrmClient[]>([]);

  useEffect(() => {
    fetch('/api/admin/founder-clients')
      .then(r => r.ok ? r.json() : { clients: [] })
      .then((d: { clients?: CrmClient[] }) => { if (Array.isArray(d.clients)) setCrmClients(d.clients); })
      .catch(() => {});
  }, []);

  // Org state
  const [orgForm,    setOrgForm]    = useState({ name: '', slug: '' });
  const [editOrg,    setEditOrg]    = useState<Org | null>(null);
  const [editOrgForm, setEditOrgForm] = useState({ name: '', slug: '' });

  // Capabilities section (Phase F.6I) — loaded fresh for the explicit
  // organisation whose edit modal is open. UX projection/control only;
  // server-side requireCapability() (not wired to anything yet) remains
  // the future enforcement authority — this UI only toggles entitlement.
  const [capabilities, setCapabilities] = useState<OrganisationCapability[]>([]);
  const [capabilitiesError, setCapabilitiesError] = useState('');
  const [isCapabilityPending, startCapabilityTransition] = useTransition();

  useEffect(() => {
    if (!editOrg) return;
    let active = true;
    getOrganisationCapabilities(editOrg.id)
      .then(caps => { if (active) { setCapabilities(caps); setCapabilitiesError(''); } })
      .catch(() => { if (active) setCapabilitiesError('Unable to load capabilities.'); });
    return () => { active = false; };
  }, [editOrg]);

  function toggleCapability(capabilityKey: string, enabled: boolean) {
    if (!editOrg) return;
    const orgId = editOrg.id;
    startCapabilityTransition(async () => {
      try {
        const result = await setOrganisationCapability(orgId, capabilityKey, enabled);
        if (!result.ok) { setCapabilitiesError(result.error); return; }
        setCapabilitiesError('');
        const caps = await getOrganisationCapabilities(orgId);
        setCapabilities(caps);
      } catch {
        setCapabilitiesError('Unable to update capability.');
      }
    });
  }

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
    try {
      const res = await fetch('/api/admin/orgs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgForm),
      });
      // Tolerate a non-JSON response body (e.g. an uncontrolled server
      // failure) instead of letting res.json() throw and strand the
      // "Creating…" state — never treat that as success. Same fix as
      // saveOrg below already has; createOrg previously lacked both
      // this AND any try/catch/finally at all, which is exactly what
      // let a failed create hang forever instead of showing an error.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        flash(data?.error ?? 'Unable to create organisation.', true);
        return;
      }
      setOrgs(p => [data.org, ...p]);
      setOrgForm({ name: '', slug: '' });
      flash(`Organisation "${data.org.name}" created.`);
      router.refresh();
    } catch {
      flash('Unable to create organisation.', true);
    } finally {
      setSaving(false);
    }
  }

  function openEditOrg(org: Org) {
    setEditOrg(org);
    setEditOrgForm({ name: org.name, slug: org.slug });
  }

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!editOrg) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`/api/admin/orgs?id=${editOrg.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editOrgForm),
      });
      // Tolerate a non-JSON response body (e.g. an uncontrolled server
      // failure) instead of letting res.json() throw and strand the
      // saving state — never treat that as success.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        flash(data?.error ?? 'Unable to save organisation.', true);
        return;
      }
      setOrgs(p => p.map(o => o.id === editOrg.id ? data.org : o));
      setEditOrg(null);
      flash(`Organisation "${data.org.name}" updated.`);
    } catch {
      flash('Unable to save organisation.', true);
    } finally {
      setSaving(false);
    }
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
    // Same fix as createOrg above (see its own comment): wrapped in
    // try/catch/finally so a network-level failure (fetch() itself
    // throwing) can never strand the "Creating…" state — the
    // res.json().catch(() => ({})) tolerance already existed here, but
    // that alone didn't cover a rejected fetch() promise.
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { flash(data.error ?? 'Failed.', true); return; }
      setUsers(p => [data.user, ...p]);
      setUserForm({ username: '', password: '', name: '', email: '', role: 'manager', organisationId: '' });
      flash(`User "${data.user.username}" created.`);
      router.refresh();
    } catch {
      flash('Unable to create user.', true);
    } finally {
      setSaving(false);
    }
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
    const data = await res.json().catch(() => ({}));
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
    background: 'var(--bg-sunken)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13,
    boxSizing: 'border-box', fontFamily: FONT,
  };
  const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };

  return (
    <div style={{ color: 'var(--text-primary)', fontFamily: FONT }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>

        <PageHeader title="Administration" description="Super admin panel — manage organisations and users." />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
          {(['orgs', 'users'] as const).map(t => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} style={{
              padding: '9px 18px', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--brand-brainbase-accent)' : '2px solid transparent',
              color: tab === t ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: tab === t ? 600 : 400, cursor: 'pointer',
              textTransform: 'capitalize', transition: 'all 0.15s', fontFamily: FONT,
            }}>
              {t === 'orgs' ? `Organisations (${orgs.length})` : `Users (${users.length})`}
            </button>
          ))}
        </div>

        {error   && <div style={{ padding: '10px 14px', background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', borderRadius: 8, fontSize: 13, color: 'var(--status-danger)', marginBottom: 14 }}>{error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--status-danger)', cursor: 'pointer', marginLeft: 8, fontFamily: FONT }}>×</button></div>}
        {success && <div style={{ padding: '10px 14px', background: 'var(--status-success-muted)', border: '1px solid var(--status-success-border)', borderRadius: 8, fontSize: 13, color: 'var(--status-success)', marginBottom: 14 }}>{success} <button onClick={() => setSuccess('')} style={{ background: 'none', border: 'none', color: 'var(--status-success)', cursor: 'pointer', marginLeft: 8, fontFamily: FONT }}>×</button></div>}

        {/* ── ORGANISATIONS tab ── */}
        {tab === 'orgs' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
            {/* Table */}
            <section aria-labelledby="admin-orgs-heading" style={{ flex: '1 1 520px', minWidth: 0 }}>
              <h2 id="admin-orgs-heading" style={SECTION_HEADING}>Organisations</h2>
              {orgs.length === 0 ? (
                <StateMessage kind="empty" title="No organisations yet." />
              ) : (
                <TableContainer label="Organisations" minWidth={620}>
                  <table className={tableStyles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Slug</th>
                        <th scope="col">CRM</th>
                        <th scope="col">Created</th>
                        <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgs.map(o => {
                        const crm = crmClients.find(c => c.organisation_id === o.id);
                        // Founder CRM pipeline stage colours — a data encoding shared with
                        // Founder OS (STAGE_FG), kept as-is rather than forced into
                        // generic semantic states.
                        const STAGE_C: Record<string, string> = { lead: '#94A3B8', contacted: '#60A5FA', demo: '#A78BFA', trial: '#FCD34D', proposal: '#FDE68A', paid: '#4ADE80', lost: '#F87171' };
                        const stageColor = crm?.stage ? (STAGE_C[crm.stage] ?? '#94A3B8') : undefined;
                        return (
                          <tr key={o.id}>
                            <td className={tableStyles.primary}>{o.name}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.slug}</td>
                            <td style={{ fontSize: 11 }}>
                              {crm ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}30` }}>
                                      {(crm.stage ?? '').toUpperCase()}
                                    </span>
                                    {crm.estimated_value != null && (
                                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>${crm.estimated_value.toLocaleString()}/mo</span>
                                    )}
                                  </div>
                                  {crm.next_action && (
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{crm.next_action}</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => router.push('/admin/founder')}
                                    className={tableStyles.link}
                                    style={{ alignSelf: 'flex-start', marginTop: 2 }}
                                  >
                                    View in Founder OS →
                                  </button>
                                </div>
                              ) : (
                                <span className={tableStyles.muted}>—</span>
                              )}
                            </td>
                            <td style={{ fontSize: 12 }}>{fmt(o.created_at)}</td>
                            <td className={tableStyles.actions}>
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button type="button" onClick={() => openEditOrg(o)} {...buttonProps('secondary', 'sm')}>Edit</button>
                                <button type="button" onClick={() => deleteOrg(o)} {...buttonProps('danger', 'sm')}>Delete</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableContainer>
              )}
            </section>

            {/* Create org form */}
            <form onSubmit={createOrg} style={{ ...SIDE_FORM, gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>New Organisation</div>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
            {/* Table */}
            <section aria-labelledby="admin-users-heading" style={{ flex: '1 1 520px', minWidth: 0 }}>
              <h2 id="admin-users-heading" style={SECTION_HEADING}>Users</h2>
              {users.length === 0 ? (
                <StateMessage kind="empty" title="No users yet." />
              ) : (
                <TableContainer label="Users" minWidth={560}>
                  <table className={tableStyles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Username</th>
                        <th scope="col">Name</th>
                        <th scope="col">Role</th>
                        <th scope="col">Organisation</th>
                        <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.username}</td>
                          <td className={tableStyles.primary}>{u.name}</td>
                          <td>
                            <span style={{ padding: '2px 7px', borderRadius: 'var(--radius-sm)', fontSize: 10, fontWeight: 700, background: u.role === 'super_admin' ? 'var(--status-danger-muted)' : 'var(--brand-brainbase-accent-muted)', color: u.role === 'super_admin' ? 'var(--status-danger)' : 'var(--brand-brainbase-accent)', border: `1px solid ${u.role === 'super_admin' ? 'var(--status-danger-border)' : 'var(--brand-brainbase-accent-border)'}` }}>
                              {u.role}
                            </span>
                          </td>
                          <td style={{ fontSize: 12 }}>{u.org_name ?? '—'}</td>
                          <td className={tableStyles.actions}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button type="button" onClick={() => openEditUser(u)} {...buttonProps('secondary', 'sm')}>Edit</button>
                              <button type="button" onClick={() => deleteUser(u)} {...buttonProps('danger', 'sm')}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              )}
            </section>

            {/* Create user form */}
            <form onSubmit={createUser} style={{ ...SIDE_FORM, gap: 11 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>New User</div>
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

          {/* ── Capabilities (Phase F.6I) ── */}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
              Capabilities
            </div>
            {capabilitiesError && (
              <div style={{ fontSize: 12, color: 'var(--status-danger)', marginBottom: 8 }}>{capabilitiesError}</div>
            )}
            {capabilities.length === 0 && !capabilitiesError ? (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No registered capabilities.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: isCapabilityPending ? 0.6 : 1 }}>
                {capabilities.map(c => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: c.active || c.enabled ? 'pointer' : 'not-allowed' }}>
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      disabled={isCapabilityPending || (!c.active && !c.enabled)}
                      onChange={e => toggleCapability(c.key, e.target.checked)}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.name}</span>
                    {!c.active && (
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>
                        Inactive
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
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
    <Dialog open title={title} onClose={onClose}>
      {children}
    </Dialog>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{text}</span>
      {children}
    </label>
  );
}

function PrimaryBtn({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" variant="primary" disabled={disabled}>
      {children}
    </Button>
  );
}

const SECTION_HEADING: React.CSSProperties = { margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' };
const SIDE_FORM: React.CSSProperties = { flex: '1 1 300px', maxWidth: 420, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, display: 'flex', flexDirection: 'column' };
