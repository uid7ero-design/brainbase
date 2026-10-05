'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import styles from '@/components/public/web-systems/enquiry.module.css';

// Presentation moved onto the public-site --bb-* tokens (light + dark) in the
// public visual convergence pass, with dialog semantics and focus handling.
// Form state, validation, submission and the /api/web-services/lead request
// are unchanged.

const SERVICES = [
  { key: 'website_design', label: 'Website Design & Development' },
  { key: 'ai_website',     label: 'AI-Powered Website'           },
  { key: 'maintenance',    label: 'Management & Maintenance'      },
  { key: 'integrations',   label: 'Business System Integrations'  },
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

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function EnquiryModal({ open, onClose }: Props) {
  const [step,   setStep]   = useState<Step>('form');
  const [form,   setForm]   = useState<FormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData | '_form', string>>>({});

  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const dialogRef = useRef<HTMLDivElement>(null);

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

  // ── Focus: move into the dialog on open, restore to the opener on close ──
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { opener?.focus?.(); };
  }, [open]);

  // Keep Tab / Shift+Tab inside the dialog while it is open.
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

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

  const fid = (name: string) => `${uid}-${name}`;

  // ── Overlay ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={styles.dialog}
        onClick={e => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        {step === 'success' ? (
          <SuccessState onClose={handleClose} titleId={titleId} descId={descId} />
        ) : (
          <div className={styles.body}>

            {/* Header */}
            <div className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Website Systems</p>
                <h2 id={titleId} className={styles.title}>Book a Strategy Call</h2>
                <p id={descId} className={styles.lede}>
                  Tell us about your business and we&apos;ll get back to you within 1–2 business days.
                </p>
              </div>
              <button type="button" onClick={handleClose} className={styles.close} aria-label="Close enquiry form">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* Global error */}
            {errors._form && (
              <div role="alert" className={styles.formError}>
                {errors._form}
              </div>
            )}

            {/* Row 1: Name + Business */}
            <div className={styles.row}>
              <Field
                id={fid('full_name')} label="Full Name" required
                error={errors.full_name}
                input={<input id={fid('full_name')} value={form.full_name} onChange={set('full_name')} placeholder="James Palmer" className={styles.input} aria-required="true" {...errorProps(!!errors.full_name, fid('full_name'))} />}
              />
              <Field
                id={fid('business_name')} label="Business Name"
                input={<input id={fid('business_name')} value={form.business_name} onChange={set('business_name')} placeholder="Acme Pty Ltd" className={styles.input} />}
              />
            </div>

            {/* Row 2: Email + Phone */}
            <div className={styles.row}>
              <Field
                id={fid('email')} label="Email Address" required
                error={errors.email}
                input={<input id={fid('email')} type="email" value={form.email} onChange={set('email')} placeholder="you@business.com" className={styles.input} aria-required="true" {...errorProps(!!errors.email, fid('email'))} />}
              />
              <Field
                id={fid('phone')} label="Phone"
                input={<input id={fid('phone')} type="tel" value={form.phone} onChange={set('phone')} placeholder="+61 4xx xxx xxx" className={styles.input} />}
              />
            </div>

            {/* Website URL */}
            <div className={styles.block}>
              <Field
                id={fid('website_url')} label="Current Website"
                input={<input id={fid('website_url')} value={form.website_url} onChange={set('website_url')} placeholder="https://yourwebsite.com" className={styles.input} />}
              />
            </div>

            {/* Services */}
            <div className={styles.block} role="group" aria-labelledby={fid('services')}>
              <p id={fid('services')} className={styles.label}>Services Interested In</p>
              <div className={styles.serviceGrid}>
                {SERVICES.map(svc => {
                  const selected = form.service_interest.includes(svc.key);
                  return (
                    <button
                      key={svc.key}
                      type="button"
                      onClick={() => toggleService(svc.key)}
                      aria-pressed={selected}
                      className={styles.service}
                    >
                      <span className={styles.checkbox} aria-hidden="true">
                        {selected && (
                          <svg width="8" height="6" viewBox="0 0 8 6" fill="none" focusable="false">
                            <path d="M1 3L3 5L7 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
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
            <div className={styles.block}>
              <Field
                id={fid('budget_range')} label="Estimated Budget"
                input={
                  <select id={fid('budget_range')} value={form.budget_range} onChange={set('budget_range')} className={`${styles.input} ${styles.select}`}>
                    <option value="">Select a budget range...</option>
                    {BUDGETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                }
              />
            </div>

            {/* Project Goals */}
            <div className={styles.blockLast}>
              <Field
                id={fid('project_description')} label="Project Goals"
                input={
                  <textarea
                    id={fid('project_description')}
                    value={form.project_description}
                    onChange={set('project_description')}
                    placeholder="Tell us what you're trying to achieve — what problem needs solving, what outcome you're looking for..."
                    rows={4}
                    className={`${styles.input} ${styles.textarea}`}
                  />
                }
              />
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={step === 'submitting'}
              className={styles.submit}
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

            <p className={styles.small}>
              No commitment required · We respond within 1–2 business days
            </p>
            <p className={styles.smaller}>
              Based in Adelaide, Australia — working with businesses locally and remotely.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SuccessState({ onClose, titleId, descId }: { onClose: () => void; titleId: string; descId: string }) {
  return (
    <div className={styles.success} role="status">
      <div className={styles.successIcon} aria-hidden="true">
        <svg width="28" height="22" viewBox="0 0 28 22" fill="none" focusable="false">
          <path d="M2 11L10 19L26 3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 id={titleId} className={styles.title}>
        Enquiry Received
      </h2>
      <p id={descId} className={styles.successBody}>
        We&apos;ll review your details and be in touch within 1–2 business days with a tailored strategy.
      </p>
      <button type="button" onClick={onClose} className={styles.successClose}>
        Close
      </button>
    </div>
  );
}

function errorProps(hasError: boolean, id: string) {
  return hasError ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
}

function Field({
  id, label, required = false, error, input,
}: {
  id: string; label: string; required?: boolean; error?: string; input: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={styles.label}>
        {label}{required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      <div className={styles.control}>{input}</div>
      {error && <p id={`${id}-error`} className={styles.fieldError}>{error}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.spinner} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".3" strokeWidth="2"/>
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}
