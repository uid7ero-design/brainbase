'use client';
import { useRef, useState } from 'react';
import { MAX_LOGO_MB, LOGO_ACCEPT_ATTR } from '@/lib/organisations/brandingLogoConstants';
import type { OrganisationBranding } from '@/lib/organisations/branding';

// Organisation Branding — Phase 2 settings UI. Self-contained: does NOT
// import TicketCard (PR #142, unmerged) or anything from app/commercial/
// _components — the live preview card below is its own small, local
// component, deliberately, to avoid any file overlap with either. No
// Events/Commercial capability check anywhere in this file — the
// server-side page (page.tsx) already gates access at admin+ before
// this component ever mounts.

const CARD = '#0e1014';
const BORDER = '#1a1d24';
const TEXT_PRIMARY = '#f9fafb';
const TEXT_MUTED = '#6b7280';
const TEXT_SECONDARY = '#9ca3af';
const ACCENT = '#8a4dff';
const RED = '#f87171';
const GREEN = '#4ade80';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', background: '#111318', border: `1px solid ${BORDER}`,
  borderRadius: 8, color: TEXT_PRIMARY, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
  color: TEXT_MUTED, marginBottom: 6,
};

function Field({
  id, label, value, onChange, placeholder, type = 'text', helpText, maxLength,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; helpText?: string; maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        style={inputStyle}
      />
      {helpText && <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 4 }}>{helpText}</div>}
    </div>
  );
}

function TextAreaField({
  id, label, value, onChange, placeholder, helpText, maxLength,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; helpText?: string; maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      {helpText && <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 4 }}>{helpText}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', color: TEXT_SECONDARY, margin: '0 0 16px' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </section>
  );
}

// Strict 3/6-digit hex check for the live text-input side of the
// colour picker — the SAME shape lib/organisations/branding.ts's own
// normalizeAccentColor accepts, so a value that passes this client-side
// check will never be silently altered by server-side coercion beyond
// case-normalization.
function isValidHexInput(value: string): boolean {
  return /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(value.trim());
}

type FormState = {
  name: string; logoUrl: string; accentColor: string; email: string; phone: string;
  website: string; address: string; abn: string; emailFooter: string; emailSenderName: string;
};

function brandingToForm(b: OrganisationBranding): FormState {
  return {
    name: b.name ?? '', logoUrl: b.logoUrl ?? '', accentColor: b.accentColor ?? '',
    email: b.email ?? '', phone: b.phone ?? '', website: b.website ?? '',
    address: b.address ?? '', abn: b.abn ?? '', emailFooter: b.emailFooter ?? '',
    emailSenderName: b.emailSenderName ?? '',
  };
}

export default function BrandingSettingsClient({
  initialOrganisationName,
  initialBranding,
}: {
  initialOrganisationName: string;
  initialBranding: OrganisationBranding;
}) {
  const [form, setForm] = useState<FormState>(brandingToForm(initialBranding));
  const [orgName] = useState(initialOrganisationName);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    setSaveSuccess(false);
  }

  function validateBeforeSave(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (form.accentColor && !isValidHexInput(form.accentColor)) {
      errors.accentColor = 'Enter a hex colour like #8A4DFF.';
    }
    if (form.website && !/^https?:\/\/.+/i.test(form.website.trim())) {
      errors.website = 'Website must start with http:// or https://.';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validateBeforeSave()) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/organisations/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Save failure never wipes local values — `form` state is left
        // exactly as the user had it, only an error message is shown.
        setSaveError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      setForm(brandingToForm(data.branding));
      setSaveSuccess(true);
    } catch {
      setSaveError('Save failed. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);

    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      setLogoError(`File too large — max ${MAX_LOGO_MB}MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setLogoError('Only JPEG, PNG, or WebP images are allowed.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const previousLogoUrl = form.logoUrl; // preserved if the upload fails
    setUploadingLogo(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/organisations/branding/logo', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLogoError(data.error ?? `Upload failed (${res.status}).`);
        setForm(f => ({ ...f, logoUrl: previousLogoUrl })); // explicit — the current saved logo is preserved, not cleared
        return;
      }
      setForm(f => ({ ...f, logoUrl: data.logoUrl }));
    } catch {
      setLogoError('Upload failed. Please check your connection and try again.');
      setForm(f => ({ ...f, logoUrl: previousLogoUrl }));
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleLogoRemove() {
    setLogoError(null);
    setRemovingLogo(true);
    try {
      const res = await fetch('/api/organisations/branding/logo', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLogoError(data.error ?? `Remove failed (${res.status}).`);
        return;
      }
      setForm(f => ({ ...f, logoUrl: '' }));
    } catch {
      setLogoError('Remove failed. Please check your connection and try again.');
    } finally {
      setRemovingLogo(false);
    }
  }

  const previewAccent = isValidHexInput(form.accentColor) ? (form.accentColor.startsWith('#') ? form.accentColor : `#${form.accentColor}`) : ACCENT;
  const previewName = form.name.trim() || orgName || 'Your organisation';

  return (
    <div style={{ maxWidth: 760, padding: '32px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 6px', color: TEXT_PRIMARY }}>Organisation Branding</h1>
      <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '0 0 24px' }}>
        These settings are not yet used anywhere on your public event, ticket, or email surfaces — this is a preview of what will control them once that integration ships.
      </p>

      <form onSubmit={handleSave}>
        <Section title="Brand">
          <Field
            id="brand-name"
            label="Display name"
            value={form.name}
            onChange={v => set('name', v)}
            placeholder={orgName}
            maxLength={120}
            helpText={form.name.trim() ? undefined : `Left blank, "${orgName || 'your organisation name'}" will be used instead.`}
          />

          <div>
            <label style={labelStyle}>Logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 64, height: 64, borderRadius: 10, border: `1px solid ${BORDER}`,
                  background: '#111318', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', flexShrink: 0,
                }}
              >
                {form.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="Organisation logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 10, color: TEXT_MUTED, textAlign: 'center' }}>No logo</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label
                    style={{
                      padding: '7px 14px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8,
                      fontSize: 12.5, fontWeight: 600, cursor: uploadingLogo ? 'default' : 'pointer',
                      opacity: uploadingLogo ? 0.6 : 1, display: 'inline-block',
                    }}
                  >
                    {uploadingLogo ? 'Uploading…' : form.logoUrl ? 'Replace logo' : 'Upload logo'}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={LOGO_ACCEPT_ATTR}
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      style={{ display: 'none' }}
                      aria-label="Upload organisation logo"
                    />
                  </label>
                  {form.logoUrl && (
                    <button
                      type="button"
                      onClick={handleLogoRemove}
                      disabled={removingLogo || uploadingLogo}
                      style={{
                        padding: '7px 14px', background: 'none', border: `1px solid ${BORDER}`, color: RED, borderRadius: 8,
                        fontSize: 12.5, fontWeight: 600, cursor: removingLogo ? 'default' : 'pointer', opacity: removingLogo ? 0.6 : 1,
                      }}
                    >
                      {removingLogo ? 'Removing…' : 'Remove logo'}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>JPEG, PNG, or WebP · max {MAX_LOGO_MB}MB</div>
                {logoError && <div style={{ fontSize: 12, color: RED }} role="alert">{logoError}</div>}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="brand-accent" style={labelStyle}>Accent colour</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="color"
                aria-label="Accent colour picker"
                value={isValidHexInput(form.accentColor) ? (form.accentColor.startsWith('#') ? form.accentColor : `#${form.accentColor}`) : '#8a4dff'}
                onChange={e => set('accentColor', e.target.value)}
                style={{ width: 40, height: 36, padding: 0, border: `1px solid ${BORDER}`, borderRadius: 6, background: 'none', cursor: 'pointer' }}
              />
              <input
                id="brand-accent"
                type="text"
                value={form.accentColor}
                onChange={e => set('accentColor', e.target.value)}
                placeholder="#8A4DFF"
                maxLength={7}
                style={{ ...inputStyle, width: 140 }}
              />
            </div>
            {fieldErrors.accentColor && <div style={{ fontSize: 12, color: RED, marginTop: 4 }} role="alert">{fieldErrors.accentColor}</div>}
          </div>
        </Section>

        <Section title="Business details">
          <TextAreaField id="brand-address" label="Address" value={form.address} onChange={v => set('address', v)} placeholder="1 Example St, Adelaide SA 5000" maxLength={500} />
          <Field id="brand-abn" label="ABN / business number" value={form.abn} onChange={v => set('abn', v)} placeholder="12 345 678 901" maxLength={200} />
        </Section>

        <Section title="Customer-facing contact">
          <Field id="brand-email" label="Support/contact email" value={form.email} onChange={v => set('email', v)} placeholder="hello@example.com" type="email" maxLength={254} />
          {fieldErrors.email && <div style={{ fontSize: 12, color: RED, marginTop: -8 }} role="alert">{fieldErrors.email}</div>}
          <Field id="brand-phone" label="Phone" value={form.phone} onChange={v => set('phone', v)} placeholder="0400 000 000" maxLength={200} />
          <Field id="brand-website" label="Website" value={form.website} onChange={v => set('website', v)} placeholder="https://example.com" maxLength={2048} />
          {fieldErrors.website && <div style={{ fontSize: 12, color: RED, marginTop: -8 }} role="alert">{fieldErrors.website}</div>}
        </Section>

        <Section title="Email identity">
          <Field
            id="brand-sender-name"
            label="Sender display name"
            value={form.emailSenderName}
            onChange={v => set('emailSenderName', v)}
            placeholder={form.name.trim() || orgName}
            maxLength={120}
            helpText="Shown as the visible sender name on emails — never the actual delivery domain."
          />
          <TextAreaField id="brand-footer" label="Footer / signoff" value={form.emailFooter} onChange={v => set('emailFooter', v)} placeholder="Thanks for your support!" maxLength={1000} />
        </Section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '10px 20px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save branding'}
          </button>
          {saveSuccess && <span style={{ color: GREEN, fontSize: 13 }}>Saved.</span>}
          {saveError && <span style={{ color: RED, fontSize: 13 }} role="alert">{saveError}</span>}
        </div>
      </form>

      {/* Live preview — a small, self-contained card local to this
          settings page only. Deliberately NOT components/events/
          TicketCard.tsx (PR #142, unmerged) — this preview has no
          relationship to that component and must not create any file
          overlap with it. */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT_MUTED, margin: '0 0 10px' }}>Preview</h2>
        <div
          style={{
            width: 260, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden',
            background: '#07080b', boxShadow: '0 10px 30px rgba(0,0,0,.3)',
          }}
        >
          <div style={{ height: 4, background: previewAccent }} />
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logoUrl} alt="" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8 }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 8, background: previewAccent, opacity: 0.85 }} />
            )}
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY }}>{previewName}</div>
            <div style={{ fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT_MUTED }}>Sample ticket header</div>
          </div>
        </div>
      </div>
    </div>
  );
}
