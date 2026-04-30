'use client';

import { useState, useRef } from 'react';

const FONT   = "var(--font-inter), -apple-system, sans-serif";
const BG     = '#0D0D15';
const BORDER = 'rgba(255,255,255,0.08)';
const MUTED  = 'rgba(255,255,255,0.35)';
const TEXT   = '#F4F4F5';

const TIMEZONES = [
  'Australia/Adelaide', 'Australia/Sydney', 'Australia/Melbourne',
  'Australia/Brisbane', 'Australia/Perth', 'Australia/Darwin',
  'Pacific/Auckland', 'UTC', 'America/New_York', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Asia/Singapore', 'Asia/Tokyo',
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin', manager: 'Manager', viewer: 'Viewer',
};
const ROLE_COLOR: Record<string, string> = {
  super_admin: '#A78BFA', admin: '#60A5FA', manager: '#34D399', viewer: 'rgba(255,255,255,0.40)',
};
const MODULE_COLORS: Record<string, string> = {
  waste_recycling: '#34D399', fleet_management: '#38BDF8', service_requests: '#FBBF24',
  logistics_freight: '#F97316', utilities: '#818CF8', construction: '#FB7185',
};

type Module = { key: string; name: string; industry: string; description: string };

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
  const base: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
    color: TEXT, fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
    resize: multiline ? 'vertical' : undefined,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>{label}</label>
      {multiline
        ? <textarea rows={3} name={name} value={value} placeholder={placeholder} onChange={e => onChange(name, e.target.value)} style={base} />
        : <input type={type} name={name} value={value} placeholder={placeholder} onChange={e => onChange(name, e.target.value)} style={base} />}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT }}>{value}</span>
    </div>
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
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ''; }} />
      <button onClick={() => fileInputRef.current?.click()} title="Change photo"
        style={{
          width: size, height: size, borderRadius: '50%', padding: 0, cursor: 'pointer',
          background: form.avatar_url ? 'transparent' : 'linear-gradient(135deg, #7C3AED 0%, #2563EB 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.3, fontWeight: 700, color: '#fff', overflow: 'hidden',
          border: '2px solid rgba(124,58,237,0.40)', position: 'relative',
        }}
        onMouseEnter={e => { const ov = e.currentTarget.querySelector('.av-ov') as HTMLElement; if (ov) ov.style.opacity = '1'; }}
        onMouseLeave={e => { const ov = e.currentTarget.querySelector('.av-ov') as HTMLElement; if (ov) ov.style.opacity = '0'; }}
      >
        {form.avatar_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={form.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : avatarUploading ? '…' : initials}
        <div className="av-ov" style={{
          position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.55)',
          opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transition: 'opacity 0.18s', fontSize: 9, fontWeight: 700, color: '#fff', gap: 3,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          UPLOAD
        </div>
      </button>
      {avatarUploading && (
        <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: '2px solid transparent', borderTopColor: '#A78BFA', animation: 'spin 0.8s linear infinite', pointerEvents: 'none' }} />
      )}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT, fontFamily: FONT }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Top bar */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/dashboard" style={{ color: MUTED, textDecoration: 'none', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
          onMouseEnter={e => (e.currentTarget.style.color = TEXT)} onMouseLeave={e => (e.currentTarget.style.color = MUTED)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
          Dashboard
        </a>
        <span style={{ color: BORDER, fontSize: 12 }}>/</span>
        <span style={{ fontSize: 12, color: MUTED }}>Profile</span>
      </div>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px' }}>

        {editing ? (
          /* ══════════════════════ EDIT MODE ══════════════════════ */
          <>
            {/* Edit header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
              <AvatarCircle size={96} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{displayName}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: ROLE_COLOR[role] ?? MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>
                  {ROLE_LABEL[role] ?? role}
                </div>
                {avatarError && <div style={{ fontSize: 11, color: '#F87171', marginTop: 4 }}>{avatarError}</div>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Section title="Personal Details">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="First Name" name="first_name" value={form.first_name} onChange={update} placeholder="Jane" />
                    <Field label="Last Name"  name="last_name"  value={form.last_name}  onChange={update} placeholder="Smith" />
                  </div>
                  <Field label="Display Name" name="display_name" value={form.display_name} onChange={update} placeholder="Jane Smith" />
                  <Field label="Bio" name="bio" value={form.bio} onChange={update} placeholder="Brief description about yourself" multiline />
                </Section>

                <Section title="Work Details">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Job Title"  name="job_title"  value={form.job_title}  onChange={update} placeholder="Operations Manager" />
                    <Field label="Department" name="department" value={form.department} onChange={update} placeholder="Fleet & Waste" />
                  </div>
                  <Field label="Phone" name="phone" value={form.phone} onChange={update} placeholder="+61 4xx xxx xxx" type="tel" />
                </Section>

                <Section title="Preferences">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Timezone</label>
                    <select value={form.timezone} onChange={e => update('timezone', e.target.value)}
                      style={{ padding: '9px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: TEXT, fontFamily: FONT, outline: 'none' }}>
                      {TIMEZONES.map(tz => <option key={tz} value={tz} style={{ background: '#1a1a2e' }}>{tz}</option>)}
                    </select>
                  </div>
                </Section>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={save} disabled={saving} style={{ padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'rgba(124,58,237,0.20)', border: '1px solid rgba(124,58,237,0.35)', color: '#C4B5FD', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: FONT }}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => { setEditing(false); setError(''); }} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer', fontFamily: FONT }}>
                    Cancel
                  </button>
                  {saved  && <span style={{ fontSize: 12, color: '#34D399' }}>Saved</span>}
                  {error  && <span style={{ fontSize: 12, color: '#F87171' }}>{error}</span>}
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
            <div style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(37,99,235,0.06) 100%)', border: `1px solid rgba(124,58,237,0.22)`, borderRadius: 16, padding: '32px 32px 28px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
              {/* Accent bar */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg, #A78BFA, #38BDF8)', borderRadius: '16px 0 0 16px' }} />

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
                <AvatarCircle size={120} />

                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 6 }}>
                    {displayName}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: form.bio ? 14 : 0 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${ROLE_COLOR[role] ?? MUTED}18`, border: `1px solid ${ROLE_COLOR[role] ?? MUTED}40`, color: ROLE_COLOR[role] ?? MUTED, letterSpacing: '0.05em' }}>
                      {ROLE_LABEL[role] ?? role}
                    </span>
                    {!!org.name && <span style={{ fontSize: 13, color: MUTED }}>{String(org.name)}</span>}
                    {lastSeen && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>Last seen {lastSeen}</span>}
                  </div>
                  {form.bio && <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.60)', lineHeight: 1.6 }}>{form.bio}</p>}
                </div>

                <button onClick={() => setEditing(true)} style={{ padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: TEXT, cursor: 'pointer', fontFamily: FONT, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Profile
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>

              {/* Left — details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {(form.job_title || form.department || form.phone) && (
                  <Section title="Work Details">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <InfoRow label="Job Title"  value={form.job_title  || undefined} />
                      <InfoRow label="Department" value={form.department || undefined} />
                    </div>
                    <InfoRow label="Phone" value={form.phone || undefined} />
                  </Section>
                )}

                {(form.first_name || form.last_name || form.timezone) && (
                  <Section title="Personal Details">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <InfoRow label="First Name" value={form.first_name || undefined} />
                      <InfoRow label="Last Name"  value={form.last_name  || undefined} />
                    </div>
                    <InfoRow label="Timezone" value={form.timezone || undefined} />
                  </Section>
                )}

                {saved && <span style={{ fontSize: 12, color: '#34D399' }}>Profile saved</span>}
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

function OrgSidebar({ org, role, modules }: { org: Record<string, unknown>; role: string; modules: { key: string; name: string; industry: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!!org.name && (
        <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>Organisation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <OrgRow label="Name"     value={String(org.name     ?? '—')} />
            <OrgRow label="Industry" value={String(org.industry ?? '—')} />
            {!!org.website       && <OrgRow label="Website" value={String(org.website)} />}
            {!!org.contact_email && <OrgRow label="Email"   value={String(org.contact_email)} />}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}`, fontSize: 10, color: 'rgba(255,255,255,0.20)' }}>
            Contact your admin to update organisation details.
          </div>
        </div>
      )}

      <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Role & Access</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${ROLE_COLOR[role] ?? MUTED}18`, border: `1px solid ${ROLE_COLOR[role] ?? MUTED}40`, color: ROLE_COLOR[role] ?? MUTED, letterSpacing: '0.05em' }}>
            {ROLE_LABEL[role] ?? role}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.28)', lineHeight: 1.5 }}>
          {role === 'viewer'      && 'Read dashboards and query HLNΛ.'}
          {role === 'manager'     && 'Upload data and manage integrations.'}
          {role === 'admin'       && 'Full org access including user management.'}
          {role === 'super_admin' && 'Full platform access including all organisations.'}
        </div>
      </div>

      {modules.length > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>Active Modules</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {modules.map(m => {
              const color = MODULE_COLORS[m.key] ?? '#A78BFA';
              return (
                <div key={m.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', background: `${color}0a`, border: `1px solid ${color}22`, borderRadius: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{m.industry}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>{title}</div>
      {children}
    </div>
  );
}

function OrgRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 12, color: value === '—' ? 'rgba(255,255,255,0.20)' : TEXT, textAlign: 'right', maxWidth: '65%', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}
