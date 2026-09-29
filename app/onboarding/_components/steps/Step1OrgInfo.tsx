'use client';

import { useState } from 'react';
import { OrgData } from '../OnboardingWizard';
import { Button, Field, fieldControlClassName } from '@/components/ui/app';
import styles from '../Onboarding.module.css';

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
        <div className={styles.stack}>
          <Field label="Council / Organisation Name" required error={errors.councilName || undefined}>
            {control => (
              <input
                {...control}
                className={fieldControlClassName}
                placeholder="e.g. City of Adelaide"
                value={form.councilName}
                onChange={set('councilName')}
              />
            )}
          </Field>

          <div className={styles.twoCol}>
            <Field label="Primary Contact Name" required error={errors.contactName || undefined}>
              {control => (
                <input
                  {...control}
                  className={fieldControlClassName}
                  placeholder="Jane Smith"
                  value={form.contactName}
                  onChange={set('contactName')}
                />
              )}
            </Field>

            <Field label="Contact Email" required error={errors.contactEmail || undefined}>
              {control => (
                <input
                  {...control}
                  type="email"
                  className={fieldControlClassName}
                  placeholder="jane@council.gov.au"
                  value={form.contactEmail}
                  onChange={set('contactEmail')}
                />
              )}
            </Field>
          </div>
        </div>

        <NavButtons next="Continue" />
      </StepShell>
    </form>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────

// Visual (remaining visual islands pass): StepShell and NavButtons keep their
// props API (every step still passes `icon`), but the emoji is a decorative
// glyph and is no longer rendered — the shell is a flat token surface with
// the step title as the h2 under the wizard's page h1.
export function StepShell({ title, subtitle, children }: {
  icon: string; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <div className={styles.shellHead}>
        <h2 className={styles.shellTitle}>{title}</h2>
        <p className={styles.shellSubtitle}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function NavButtons({ next = 'Continue', onBack, nextDisabled }: {
  next?: string; onBack?: () => void; nextDisabled?: boolean;
}) {
  return (
    <div className={styles.nav}>
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </Button>
      ) : <div />}
      <Button type="submit" variant="primary" disabled={nextDisabled}>
        {next} <span aria-hidden="true">→</span>
      </Button>
    </div>
  );
}
