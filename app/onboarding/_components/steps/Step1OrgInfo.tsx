'use client';

import { useState } from 'react';
import { OrgData } from '../OnboardingWizard';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 8, color: '#F4F4F5', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
  fontFamily: FONT, transition: 'border-color .15s',
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#A1A1AA', letterSpacing: '.03em' }}>
        {label}{required && <span style={{ color: '#EF4444', marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

export default function Step1OrgInfo({ data, onNext }: { data: OrgData; onNext: (d: OrgData) => void }) {
  const [form, setForm] = useState<OrgData>(data);
  const [errors, setErrors] = useState<Partial<OrgData>>({});

  function set(k: keyof OrgData) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm(f => ({ ...f, [k]: e.target.value }));
      if (errors[k]) setErrors(e => ({ ...e, [k]: '' }));
    };
  }

  function validate() {
    const e: Partial<OrgData> = {};
    if (!form.councilName.trim()) e.councilName = 'Required';
    if (!form.contactName.trim()) e.contactName = 'Required';
    if (!form.contactEmail.trim()) e.contactEmail = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) e.contactEmail = 'Invalid email';
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onNext(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepShell
        icon="🏛️"
        title="Tell us about your organisation"
        subtitle="This helps HLNA personalise your experience from day one."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label="Council / Organisation Name" required>
            <input
              style={{ ...inputStyle, ...(errors.councilName ? { borderColor: 'rgba(239,68,68,.5)' } : {}) }}
              placeholder="e.g. City of Adelaide"
              value={form.councilName}
              onChange={set('councilName')}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,.5)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.councilName ? 'rgba(239,68,68,.5)' : 'rgba(255,255,255,.08)'; }}
            />
            {errors.councilName && <span style={{ fontSize: 11, color: '#EF4444' }}>{errors.councilName}</span>}
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Primary Contact Name" required>
              <input
                style={{ ...inputStyle, ...(errors.contactName ? { borderColor: 'rgba(239,68,68,.5)' } : {}) }}
                placeholder="Jane Smith"
                value={form.contactName}
                onChange={set('contactName')}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = errors.contactName ? 'rgba(239,68,68,.5)' : 'rgba(255,255,255,.08)'; }}
              />
              {errors.contactName && <span style={{ fontSize: 11, color: '#EF4444' }}>{errors.contactName}</span>}
            </Field>

            <Field label="Contact Email" required>
              <input
                type="email"
                style={{ ...inputStyle, ...(errors.contactEmail ? { borderColor: 'rgba(239,68,68,.5)' } : {}) }}
                placeholder="jane@council.gov.au"
                value={form.contactEmail}
                onChange={set('contactEmail')}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = errors.contactEmail ? 'rgba(239,68,68,.5)' : 'rgba(255,255,255,.08)'; }}
              />
              {errors.contactEmail && <span style={{ fontSize: 11, color: '#EF4444' }}>{errors.contactEmail}</span>}
            </Field>
          </div>
        </div>

        <NavButtons next="Continue" />
      </StepShell>
    </form>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────

export function StepShell({ icon, title, subtitle, children }: {
  icon: string; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 16, padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 28,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#F4F4F5', fontFamily: FONT }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#71717A', lineHeight: 1.5 }}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function NavButtons({ next = 'Continue', onBack, nextDisabled }: {
  next?: string; onBack?: () => void; nextDisabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
            background: 'transparent', color: '#A1A1AA', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: FONT, transition: 'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = '#F4F4F5'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A1A1AA'; }}
        >
          ← Back
        </button>
      ) : <div />}
      <button
        type="submit"
        disabled={nextDisabled}
        style={{
          padding: '10px 24px', borderRadius: 8, border: 'none',
          background: nextDisabled ? 'rgba(124,58,237,.3)' : '#7C3AED',
          color: nextDisabled ? 'rgba(255,255,255,.4)' : '#fff',
          fontSize: 13, fontWeight: 600, cursor: nextDisabled ? 'not-allowed' : 'pointer',
          fontFamily: FONT, transition: 'background .15s',
        }}
        onMouseEnter={e => { if (!nextDisabled) e.currentTarget.style.background = '#6D28D9'; }}
        onMouseLeave={e => { if (!nextDisabled) e.currentTarget.style.background = '#7C3AED'; }}
      >
        {next} →
      </button>
    </div>
  );
}
