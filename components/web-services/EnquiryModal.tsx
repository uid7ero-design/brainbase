'use client';

import { useState, useEffect, useCallback } from 'react';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const SERVICES = [
  { key: 'website_design', label: 'Website Design & Development', color: '#6366F1' },
  { key: 'ai_website',     label: 'AI-Powered Website',           color: '#38BDF8' },
  { key: 'maintenance',    label: 'Management & Maintenance',      color: '#10B981' },
  { key: 'integrations',   label: 'Business System Integrations',  color: '#A78BFA' },
];

const BUDGETS = [
  { key: 'under_2500',   label: 'Under $2,500'     },
  { key: '2500_5000',    label: '$2,500 – $5,000'  },
  { key: '5000_10000',   label: '$5,000 – $10,000' },
  { key: '10000_20000',  label: '$10,000 – $20,000'},
  { key: '20000_plus',   label: '$20,000+'          },
  { key: 'unsure',       label: 'Not sure yet'      },
];

type Step = 'form' | 'submitting' | 'success' | 'error';

interface FormData {
  full_name:           string;
  business_name:       string;
  email:               string;
  phone:               string;
  website_url:         string;
  service_interest:    string[];
  budget_range:        string;
  project_description: string;
}

const EMPTY_FORM: FormData = {
  full_name:           '',
  business_name:       '',
  email:               '',
  phone:               '',
  website_url:         '',
  service_interest:    [],
  budget_range:        '',
  project_description: '',
};

interface Props {
  open:    boolean;
  onClose: () => void;
}

export default function EnquiryModal({ open, onClose }: Props) {
  const [step,   setStep]   = useState<Step>('form');
  const [form,   setForm]   = useState<FormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData | '_form', string>>>({});

  // ── Keyboard & scroll lock ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = useCallback(() => {
    onClose();
    setTimeout(() => {
      setStep('form');
      setErrors({});
      setForm(EMPTY_FORM);
    }, 280);
  }, [onClose]);

  const toggleService = useCallback((key: string) => {
    setForm(f => ({
      ...f,
      service_interest: f.service_interest.includes(key)
        ? f.service_interest.filter(s => s !== key)
        : [...f.service_interest, key],
    }));
  }, []);

  const set = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(e2 => { const n = { ...e2 }; delete n[field]; return n; });
  };

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.full_name.trim())                    errs.full_name = 'Name is required';
    if (!form.email.trim())                        errs.email     = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errs.email = 'Enter a valid email address';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setStep('submitting');

    try {
      const res = await fetch('/api/web-services/lead', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });

      if (res.ok) {
        setStep('success');
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setErrors({ _form: data.error ?? 'Something went wrong. Please try again.' });
        setStep('form');
      }
    } catch {
      setErrors({ _form: 'Network error. Please check your connection.' });
      setStep('form');
    }
  };

  if (!open) return null;

  // ── Overlay ───────────────────────────────────────────────────────────────
  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        fontFamily: FONT,
      }}
    >
      {/* Modal card */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620, maxHeight: '90vh',
          overflowY: 'auto',
          background: 'rgba(9,10,16,.97)',
          border: '1px solid rgba(255,255,255,.10)',
          borderRadius: 18,
          boxShadow: '0 32px 80px rgba(0,0,0,.70), 0 0 0 1px rgba(139,92,246,.10)',
          position: 'relative',
        }}
      >
        {/* Purple top glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, #6366F1, #A78BFA, #38BDF8)',
          borderRadius: '18px 18px 0 0',
        }} />

        {step === 'success' ? (
          <SuccessState onClose={handleClose} />
        ) : (
          <div style={{ padding: '32px 36px 36px' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', color: 'rgba(129,140,248,.65)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Website Systems
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>
                  Book a Strategy Call
                </h2>
                <p style={{ fontSize: 13, color: 'rgba(226,232,240,.45)', margin: '6px 0 0', lineHeight: 1.5 }}>
                  Tell us about your business and we&apos;ll get back to you within 1–2 business days.
                </p>
              </div>
              <button
                onClick={handleClose}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,.35)', padding: '4px 6px',
                  fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: -2,
                  transition: 'color .14s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.70)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.35)')}
              >
                ×
              </button>
            </div>

            {/* Global error */}
            {errors._form && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 20,
                background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)',
                fontSize: 13, color: 'rgba(252,165,165,.90)',
              }}>
                {errors._form}
              </div>
            )}

            {/* Row 1: Name + Business */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field
                label="Full Name" required
                error={errors.full_name}
                input={<input value={form.full_name} onChange={set('full_name')} placeholder="James Palmer" style={inputStyle(!!errors.full_name)} />}
              />
              <Field
                label="Business Name"
                input={<input value={form.business_name} onChange={set('business_name')} placeholder="Acme Pty Ltd" style={inputStyle(false)} />}
              />
            </div>

            {/* Row 2: Email + Phone */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field
                label="Email Address" required
                error={errors.email}
                input={<input type="email" value={form.email} onChange={set('email')} placeholder="you@business.com" style={inputStyle(!!errors.email)} />}
              />
              <Field
                label="Phone"
                input={<input type="tel" value={form.phone} onChange={set('phone')} placeholder="+61 4xx xxx xxx" style={inputStyle(false)} />}
              />
            </div>

            {/* Website URL */}
            <div style={{ marginBottom: 20 }}>
              <Field
                label="Current Website"
                input={<input value={form.website_url} onChange={set('website_url')} placeholder="https://yourwebsite.com" style={inputStyle(false)} />}
              />
            </div>

            {/* Services */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Services Interested In</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {SERVICES.map(svc => {
                  const selected = form.service_interest.includes(svc.key);
                  return (
                    <button
                      key={svc.key}
                      type="button"
                      onClick={() => toggleService(svc.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
                        background: selected ? `${svc.color}14` : 'rgba(255,255,255,.03)',
                        border: selected ? `1px solid ${svc.color}40` : '1px solid rgba(255,255,255,.08)',
                        color: selected ? svc.color : 'rgba(226,232,240,.55)',
                        textAlign: 'left', fontFamily: FONT,
                        fontSize: 13, fontWeight: selected ? 600 : 400,
                        transition: 'all .14s',
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                        background: selected ? svc.color : 'rgba(255,255,255,.08)',
                        border: selected ? 'none' : '1px solid rgba(255,255,255,.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {selected && (
                          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                            <path d="M1 3L3 5L7 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                      {svc.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Budget */}
            <div style={{ marginBottom: 20 }}>
              <Field
                label="Estimated Budget"
                input={
                  <select value={form.budget_range} onChange={set('budget_range')} style={{ ...inputStyle(false), appearance: 'none' as const }}>
                    <option value="">Select a budget range...</option>
                    {BUDGETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                }
              />
            </div>

            {/* Project Goals */}
            <div style={{ marginBottom: 28 }}>
              <Field
                label="Project Goals"
                input={
                  <textarea
                    value={form.project_description}
                    onChange={set('project_description')}
                    placeholder="Tell us what you're trying to achieve — what problem needs solving, what outcome you're looking for..."
                    rows={4}
                    style={{ ...inputStyle(false), resize: 'vertical' as const, minHeight: 88 }}
                  />
                }
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={step === 'submitting'}
              style={{
                width: '100%', padding: '13px 24px', borderRadius: 10,
                fontFamily: FONT, fontWeight: 700, fontSize: 15, letterSpacing: '.01em',
                background: step === 'submitting'
                  ? 'rgba(99,102,241,.20)'
                  : 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                border: '1px solid rgba(99,102,241,.40)',
                color: step === 'submitting' ? 'rgba(255,255,255,.45)' : '#F5F7FA',
                cursor: step === 'submitting' ? 'not-allowed' : 'pointer',
                transition: 'all .15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
              onMouseEnter={e => { if (step !== 'submitting') e.currentTarget.style.opacity = '.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {step === 'submitting' ? (
                <>
                  <Spinner />
                  Submitting...
                </>
              ) : (
                'Book Strategy Call →'
              )}
            </button>

            <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.22)', margin: '14px 0 0', lineHeight: 1.5 }}>
              No commitment required · We respond within 1–2 business days
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SuccessState({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ padding: '56px 40px', textAlign: 'center', fontFamily: FONT }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', margin: '0 auto 24px',
        background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.30)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
          <path d="M2 11L10 19L26 3" stroke="#34D399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: '#F5F7FA', margin: '0 0 10px', letterSpacing: '-.02em' }}>
        Enquiry Received
      </h2>
      <p style={{ fontSize: 15, color: 'rgba(226,232,240,.55)', margin: '0 0 32px', lineHeight: 1.65, maxWidth: 360, marginInline: 'auto' }}>
        We&apos;ll review your details and be in touch within 1–2 business days with a tailored strategy.
      </p>
      <button
        onClick={onClose}
        style={{
          padding: '11px 28px', borderRadius: 9, fontFamily: FONT, fontSize: 14, fontWeight: 600,
          background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.30)',
          color: '#34D399', cursor: 'pointer', transition: 'all .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16,185,129,.22)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,.15)'; }}
      >
        Close
      </button>
    </div>
  );
}

function Field({
  label, required = false, error, input,
}: {
  label: string; required?: boolean; error?: string; input: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}{required && <span style={{ color: 'rgba(239,68,68,.70)', marginLeft: 3 }}>*</span>}
      </label>
      <div style={{ marginTop: 6 }}>{input}</div>
      {error && <p style={{ margin: '5px 0 0', fontSize: 11, color: 'rgba(252,165,165,.85)' }}>{error}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,.25)" strokeWidth="2"/>
      <path d="M8 2a6 6 0 0 1 6 6" stroke="rgba(255,255,255,.75)" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,.38)',
};

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 14px', borderRadius: 8,
    background: 'rgba(255,255,255,.04)',
    border: `1px solid ${hasError ? 'rgba(239,68,68,.45)' : 'rgba(255,255,255,.10)'}`,
    color: '#F5F7FA',
    fontSize: 14, fontFamily: FONT,
    outline: 'none',
    transition: 'border-color .14s',
  };
}
