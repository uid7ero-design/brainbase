'use client';

import { useState } from 'react';

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
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
};

const ROLE_COLOR: Record<string, string> = {
  super_admin: '#A78BFA',
  admin: '#60A5FA',
  manager: '#34D399',
  viewer: 'rgba(255,255,255,0.40)',
};

const MODULE_COLORS: Record<string, string> = {
  waste_recycling:  '#34D399',
  fleet_management: '#38BDF8',
  service_requests: '#FBBF24',
  logistics_freight:'#F97316',
  utilities:        '#818CF8',
  construction:     '#FB7185',
};

type Module = { key: string; name: string; industry: string; description: string };

interface Props {
  initialUser: Record<string, unknown>;
  org: Record<string, unknown>;
  modules: Module[];
  role: string;
}

function Field({
  label, name, value, onChange, type = 'text', placeholder = '', multiline = false,
}: {
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
      {multiline ? (
        <textarea
          rows={3}
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(name, e.target.value)}
          style={base}
        />
      ) : (
        <input
          type={type}
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(name, e.target.value)}
          style={base}
        />
      )}
    </div>
  );
}

export default function ProfileClient({ initialUser, org, modules, role }: Props) {
  const [form, setForm] = useState({
    first_name:   String(initialUser.first_name  ?? ''),
    last_name:    String(initialUser.last_name   ?? ''),
    display_name: String(initialUser.display_name ?? ''),
    bio:          String(initialUser.bio         ?? ''),
    job_title:    String(initialUser.job_title   ?? ''),
    department:   String(initialUser.department  ?? ''),
    phone:        String(initialUser.phone       ?? ''),
    timezone:     String(initialUser.timezone    ?? 'Australia/Adelaide'),
    avatar_url:   String(initialUser.avatar_url  ?? ''),
  });

  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [error,  setError]    = useState('');

  function update(name: string, value: string) {
    setForm(f => ({ ...f, [name]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res  = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) { setError(data.error ?? 'Failed to save'); return; }
      setSaved(true);
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  const initials = (
    form.display_name || `${form.first_name} ${form.last_name}`.trim() || String(initialUser.name ?? '?')
  ).split(' ').map((w: string) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');

  const lastSeen = initialUser.last_seen_at
    ? new Date(String(initialUser.last_seen_at)).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT, fontFamily: FONT }}>

      {/* ── Top bar ── */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/dashboard" style={{ color: MUTED, textDecoration: 'none', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, transition: 'color 0.2s' }}
          onMouseEnter={e => (e.currentTarget.style.color = TEXT)}
          onMouseLeave={e => (e.currentTarget.style.color = MUTED)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
          Dashboard
        </a>
        <span style={{ color: BORDER, fontSize: 12 }}>/</span>
        <span style={{ fontSize: 12, color: MUTED }}>Profile</span>
      </div>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* ── Avatar + identity ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
            background: form.avatar_url ? 'transparent' : 'linear-gradient(135deg, #7C3AED 0%, #2563EB 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, color: '#fff', overflow: 'hidden',
            border: `2px solid rgba(124,58,237,0.35)`,
          }}>
            {form.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : initials}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {form.display_name || `${form.first_name} ${form.last_name}`.trim() || String(initialUser.name ?? 'Your Profile')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: ROLE_COLOR[role] ?? MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {ROLE_LABEL[role] ?? role}
              </span>
              {!!org.name && (
                <>
                  <span style={{ color: BORDER }}>·</span>
                  <span style={{ fontSize: 12, color: MUTED }}>{String(org.name)}</span>
                </>
              )}
              {lastSeen && (
                <>
                  <span style={{ color: BORDER }}>·</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>Last seen {lastSeen}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

          {/* ── Left: editable profile form ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <Section title="Personal Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="First Name"    name="first_name"   value={form.first_name}   onChange={update} placeholder="Jane" />
                <Field label="Last Name"     name="last_name"    value={form.last_name}    onChange={update} placeholder="Smith" />
              </div>
              <Field label="Display Name"   name="display_name" value={form.display_name} onChange={update} placeholder="Jane Smith" />
              <Field label="Bio"            name="bio"          value={form.bio}           onChange={update} placeholder="Brief description about yourself" multiline />
              <Field label="Avatar URL"     name="avatar_url"   value={form.avatar_url}   onChange={update} placeholder="https://..." />
            </Section>

            <Section title="Work Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Job Title"    name="job_title"   value={form.job_title}   onChange={update} placeholder="Operations Manager" />
                <Field label="Department"   name="department"  value={form.department}  onChange={update} placeholder="Fleet & Waste" />
              </div>
              <Field label="Phone"          name="phone"       value={form.phone}       onChange={update} placeholder="+61 4xx xxx xxx" type="tel" />
            </Section>

            <Section title="Preferences">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Timezone</label>
                <select
                  value={form.timezone}
                  onChange={e => update('timezone', e.target.value)}
                  style={{
                    padding: '9px 12px', borderRadius: 8, fontSize: 13,
                    background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
                    color: TEXT, fontFamily: FONT, outline: 'none',
                  }}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz} style={{ background: '#1a1a2e' }}>{tz}</option>
                  ))}
                </select>
              </div>
            </Section>

            {/* ── Save button ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: saving ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.20)',
                  border: '1px solid rgba(124,58,237,0.35)',
                  color: '#C4B5FD', cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', fontFamily: FONT,
                }}
              >
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
              {saved  && <span style={{ fontSize: 12, color: '#34D399' }}>Saved</span>}
              {error  && <span style={{ fontSize: 12, color: '#F87171' }}>{error}</span>}
            </div>
          </div>

          {/* ── Right: org + modules (read-only) ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Organisation */}
            <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
                Organisation
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Row label="Name"     value={String(org.name     ?? '—')} />
                <Row label="Industry" value={String(org.industry ?? '—')} />
                <Row label="Website"  value={String(org.website  ?? '—')} />
                <Row label="Email"    value={String(org.contact_email ?? '—')} />
              </div>
              <div style={{ marginTop: 10, padding: '5px 0 0', borderTop: `1px solid ${BORDER}`, fontSize: 10, color: 'rgba(255,255,255,0.20)' }}>
                Contact your admin to update organisation details.
              </div>
            </div>

            {/* Role */}
            <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Role & Access</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: `${ROLE_COLOR[role] ?? MUTED}18`,
                  border: `1px solid ${ROLE_COLOR[role] ?? MUTED}40`,
                  color: ROLE_COLOR[role] ?? MUTED,
                  letterSpacing: '0.05em',
                }}>
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

            {/* Active Modules */}
            {modules.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
                  Active Modules
                </div>
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
        </div>
      </div>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 12, color: value === '—' ? 'rgba(255,255,255,0.20)' : TEXT, textAlign: 'right', maxWidth: '65%', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}
