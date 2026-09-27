'use client';

import { useState, useRef } from 'react';
import {
  Field as AppField,
  FormError,
  Panel,
  buttonProps,
  fieldControlClassName,
} from '@/components/ui/app';

const FONT = "var(--font-inter), -apple-system, sans-serif";

const TIMEZONES = [
  'Australia/Adelaide', 'Australia/Sydney', 'Australia/Melbourne',
  'Australia/Brisbane', 'Australia/Perth', 'Australia/Darwin',
  'Pacific/Auckland', 'UTC', 'America/New_York', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Asia/Singapore', 'Asia/Tokyo',
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin', manager: 'Manager', viewer: 'Viewer',
};
// Domain category encoding (kept): module identity dots only, never text.
const MODULE_COLORS: Record<string, string> = {
  waste_recycling: '#34D399', fleet_management: '#38BDF8', service_requests: '#FBBF24',
  logistics_freight: '#F97316', utilities: '#818CF8', construction: '#FB7185',
};

type Module = { key: string; name: string; description: string | null };

interface Props {
  initialUser: Record<string, unknown>;
  org: Record<string, unknown>;
  modules: Module[];
  role: string;
}

function Field({ label, name, value, onChange, type = 'text', placeholder = '', multiline = false }: {
  label: string; name: string; value: string; onChange: (n: string, v: string) => void;
  type?: string; placeholder?: string; multiline?: boolean;
}) {
  return (
    <AppField label={label}>
      {control => multiline
        ? <textarea {...control} rows={3} name={name} value={value} placeholder={placeholder} onChange={e => onChange(name, e.target.value)} className={fieldControlClassName} style={{ resize: 'vertical' }} />
        : <input {...control} type={type} name={name} value={value} placeholder={placeholder} onChange={e => onChange(name, e.target.value)} className={fieldControlClassName} />}
    </AppField>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={labelText}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', letterSpacing: '0.05em' }}>
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

export default function ProfileClient({ initialUser, org, modules, role }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    first_name:   String(initialUser.first_name   ?? ''),
    last_name:    String(initialUser.last_name    ?? ''),
    display_name: String(initialUser.display_name ?? ''),
    bio:          String(initialUser.bio          ?? ''),
    job_title:    String(initialUser.job_title    ?? ''),
    department:   String(initialUser.department   ?? ''),
    phone:        String(initialUser.phone        ?? ''),
    timezone:     String(initialUser.timezone     ?? 'Australia/Adelaide'),
    avatar_url:   String(initialUser.avatar_url   ?? ''),
  });

  const [saving,          setSaving]          = useState(false);
  const [saved,           setSaved]           = useState(false);
  const [error,           setError]           = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError,     setAvatarError]     = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(name: string, value: string) { setForm(f => ({ ...f, [name]: value })); setSaved(false); }

  async function save() {
    setSaving(true); setError('');
    try {
      const res  = await fetch('/api/account/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) { setError(data.error ?? 'Failed to save'); return; }
      setSaved(true);
      setEditing(false);
    } catch { setError('Network error'); }
    finally  { setSaving(false); }
  }

  async function uploadAvatar(file: File) {
    setAvatarUploading(true); setAvatarError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/account/avatar', { method: 'POST', body: fd });
      const data = await res.json() as { success?: boolean; avatarUrl?: string; error?: string };
      if (!res.ok || !data.success) { setAvatarError(data.error ?? 'Upload failed'); return; }
      setForm(f => ({ ...f, avatar_url: data.avatarUrl! }));
    } catch { setAvatarError('Network error'); }
    finally  { setAvatarUploading(false); }
  }

  const displayName = form.display_name || `${form.first_name} ${form.last_name}`.trim() || String(initialUser.name ?? 'Your Profile');
  const initials    = displayName.split(' ').map((w: string) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
  const lastSeen    = initialUser.last_seen_at
    ? new Date(String(initialUser.last_seen_at)).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  // ── Avatar circle (shared between view + edit) ──────────────────────────────
  const AvatarCircle = ({ size = 80 }: { size?: number }) => (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ''; }} />
      <button type="button" className="pf-avatar" onClick={() => fileInputRef.current?.click()} title="Change photo" aria-label="Change profile photo"
        style={{
          width: size, height: size, borderRadius: '50%', padding: 0, cursor: 'pointer',
          background: form.avatar_url ? 'transparent' : 'var(--brand-brainbase-accent-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.3, fontWeight: 700, color: 'var(--brand-brainbase-accent)', overflow: 'hidden',
          border: '1px solid var(--brand-brainbase-accent-border)', position: 'relative',
        }}
      >
        {form.avatar_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={form.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : avatarUploading ? '…' : initials}
        {/* Media overlay over the photo — fixed scrim + white is intentional in both themes. */}
        <div className="pf-avatar-ov" aria-hidden="true" style={{
          position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: '#fff', gap: 3,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          UPLOAD
        </div>
      </button>
      {avatarUploading && (
        <div aria-hidden="true" className="pf-spin" style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'var(--brand-brainbase-accent)', pointerEvents: 'none' }} />
      )}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: FONT }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .pf-spin { animation: spin 0.8s linear infinite; }
        .pf-avatar-ov { opacity: 0; transition: opacity 0.18s; }
        .pf-avatar:hover .pf-avatar-ov, .pf-avatar:focus-visible .pf-avatar-ov { opacity: 1; }
        .pf-crumb { color: var(--text-secondary); }
        .pf-crumb:hover { color: var(--text-primary); }
        @media (prefers-reduced-motion: reduce) { .pf-spin { animation: none; } .pf-avatar-ov { transition: none; } }
      `}</style>

      {/* Top bar */}
      <nav aria-label="Breadcrumb" style={{ borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/dashboard" className="pf-crumb" style={{ textDecoration: 'none', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
          Dashboard
        </a>
        <span aria-hidden="true" style={{ color: 'var(--text-subtle)', fontSize: 12 }}>/</span>
        <span aria-current="page" style={{ fontSize: 12, color: 'var(--text-primary)' }}>Profile</span>
      </nav>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 16px 80px' }}>

        {editing ? (
          /* ══════════════════════ EDIT MODE ══════════════════════ */
          <>
            {/* Edit header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32, flexWrap: 'wrap' }}>
              <AvatarCircle size={96} />
              <div style={{ minWidth: 0 }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, overflowWrap: 'anywhere' }}>{displayName}</h1>
                <div style={{ marginTop: 6 }}><RolePill role={role} /></div>
                {avatarError && <div style={{ marginTop: 6 }}><FormError>{avatarError}</FormError></div>}
              </div>
            </div>

            <div style={columns}>
              <div style={mainColumn}>
                <Panel title="Personal Details">
                  <div style={fieldGrid}>
                    <div style={twoUp}>
                      <Field label="First Name" name="first_name" value={form.first_name} onChange={update} placeholder="Jane" />
                      <Field label="Last Name"  name="last_name"  value={form.last_name}  onChange={update} placeholder="Smith" />
                    </div>
                    <Field label="Display Name" name="display_name" value={form.display_name} onChange={update} placeholder="Jane Smith" />
                    <Field label="Bio" name="bio" value={form.bio} onChange={update} placeholder="Brief description about yourself" multiline />
                  </div>
                </Panel>

                <Panel title="Work Details">
                  <div style={fieldGrid}>
                    <div style={twoUp}>
                      <Field label="Job Title"  name="job_title"  value={form.job_title}  onChange={update} placeholder="Operations Manager" />
                      <Field label="Department" name="department" value={form.department} onChange={update} placeholder="Fleet & Waste" />
                    </div>
                    <Field label="Phone" name="phone" value={form.phone} onChange={update} placeholder="+61 4xx xxx xxx" type="tel" />
                  </div>
                </Panel>

                <Panel title="Preferences">
                  <AppField label="Timezone">
                    {control => (
                      <select {...control} value={form.timezone} onChange={e => update('timezone', e.target.value)} className={fieldControlClassName}>
                        {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    )}
                  </AppField>
                </Panel>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button type="button" onClick={save} disabled={saving} {...buttonProps('primary')}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button type="button" onClick={() => { setEditing(false); setError(''); }} {...buttonProps('secondary')}>
                    Cancel
                  </button>
                  {saved  && <span role="status" style={{ fontSize: 12, color: 'var(--status-success)' }}>Saved</span>}
                  {error  && <FormError>{error}</FormError>}
                </div>
              </div>

              {/* Right sidebar — read-only in edit mode too */}
              <OrgSidebar org={org} role={role} modules={modules} />
            </div>
          </>
        ) : (
          /* ══════════════════════ VIEW MODE ══════════════════════ */
          <>
            {/* Hero card */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '28px 24px 24px', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
                <AvatarCircle size={120} />

                <div style={{ flex: 1, minWidth: 200 }}>
                  <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, margin: '0 0 6px', overflowWrap: 'anywhere' }}>
                    {displayName}
                  </h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: form.bio ? 14 : 0 }}>
                    <RolePill role={role} />
                    {!!org.name && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{String(org.name)}</span>}
                    {lastSeen && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last seen {lastSeen}</span>}
                  </div>
                  {form.bio && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{form.bio}</p>}
                  {avatarError && <div style={{ marginTop: 8 }}><FormError>{avatarError}</FormError></div>}
                </div>

                <button type="button" onClick={() => setEditing(true)} {...buttonProps('secondary', 'sm')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Profile
                </button>
              </div>
            </div>

            <div style={columns}>

              {/* Left — details */}
              <div style={mainColumn}>

                {(form.job_title || form.department || form.phone) && (
                  <Panel title="Work Details">
                    <div style={fieldGrid}>
                      <div style={twoUp}>
                        <InfoRow label="Job Title"  value={form.job_title  || undefined} />
                        <InfoRow label="Department" value={form.department || undefined} />
                      </div>
                      <InfoRow label="Phone" value={form.phone || undefined} />
                    </div>
                  </Panel>
                )}

                {(form.first_name || form.last_name || form.timezone) && (
                  <Panel title="Personal Details">
                    <div style={fieldGrid}>
                      <div style={twoUp}>
                        <InfoRow label="First Name" value={form.first_name || undefined} />
                        <InfoRow label="Last Name"  value={form.last_name  || undefined} />
                      </div>
                      <InfoRow label="Timezone" value={form.timezone || undefined} />
                    </div>
                  </Panel>
                )}

                {saved && <span role="status" style={{ fontSize: 12, color: 'var(--status-success)' }}>Profile saved</span>}
              </div>

              {/* Right */}
              <OrgSidebar org={org} role={role} modules={modules} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OrgSidebar({ org, role, modules }: { org: Record<string, unknown>; role: string; modules: Module[] }) {
  return (
    <div style={sideColumn}>
      {!!org.name && (
        <Panel title="Organisation">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <OrgRow label="Name"     value={String(org.name     ?? '—')} />
            <OrgRow label="Industry" value={String(org.industry ?? '—')} />
            {!!org.website       && <OrgRow label="Website" value={String(org.website)} />}
            {!!org.contact_email && <OrgRow label="Email"   value={String(org.contact_email)} />}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
            Contact your admin to update organisation details.
          </div>
        </Panel>
      )}

      <Panel title="Role & Access">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RolePill role={role} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {role === 'viewer'      && 'Read dashboards and query HLNΛ.'}
          {role === 'manager'     && 'Upload data and manage integrations.'}
          {role === 'admin'       && 'Full org access including user management.'}
          {role === 'super_admin' && 'Full platform access including all organisations.'}
        </div>
      </Panel>

      {modules.length > 0 && (
        <Panel title="Active Modules">
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {modules.map(m => {
              const color = MODULE_COLORS[m.key] ?? 'var(--text-subtle)';
              return (
                <li key={m.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', background: 'var(--bg-sunken)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)' }}>
                  <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</div>
                    {m.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{m.description}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function OrgRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, color: value === '—' ? 'var(--text-muted)' : 'var(--text-primary)', textAlign: 'right', maxWidth: '65%', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

const labelText: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' };
// Two columns on desktop that wrap to one at phone width (the old fixed
// `1fr 280px` grid overflowed below ~620px).
const columns: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' };
const mainColumn: React.CSSProperties = { flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 };
const sideColumn: React.CSSProperties = { flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 };
const fieldGrid: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const twoUp: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 };
