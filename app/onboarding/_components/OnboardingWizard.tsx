'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Step1OrgInfo from './steps/Step1OrgInfo';
import Step2DataSources from './steps/Step2DataSources';
import Step3WasteMapping from './steps/Step3WasteMapping';
import Step4FleetMapping from './steps/Step4FleetMapping';
import Step5KeyQuestions from './steps/Step5KeyQuestions';
import Step6SuccessMetrics from './steps/Step6SuccessMetrics';
import Step7Review from './steps/Step7Review';
import { APP_HEADER_OFFSET_VAR } from '@/lib/layout/headerOffset';
import { buttonProps } from '@/components/ui/app';
import styles from './Onboarding.module.css';

// Visual (remaining visual islands pass): the wizard is one workflow surface
// styled from Onboarding.module.css with tokens only — flat header, a token
// progress track, shared step shell. The wizard's own header is no longer a
// second sticky bar at top:0 (it slid over the app TopNav); the progress bar
// still sticks directly below the shared app header offset.

const STEPS = [
  { id: 1, label: 'Organisation' },
  { id: 2, label: 'Data Sources' },
  { id: 3, label: 'Waste Data' },
  { id: 4, label: 'Fleet Data' },
  { id: 5, label: 'Questions' },
  { id: 6, label: 'Goals' },
  { id: 7, label: 'Review' },
];

export interface OrgData { councilName: string; contactName: string; contactEmail: string }
export interface SourcesData { systems: string[]; fileTypes: string[] }
export interface MappingData { fileId?: string; fileName?: string; headers?: string[]; rows?: string[][]; mappings: Record<string, string> }
export interface QuestionsData { challenges: string; goals: string; reporting: string; other: string }
export interface MetricsData { goals: string[] }

export interface FormData {
  org: OrgData;
  sources: SourcesData;
  wasteMapping: MappingData;
  fleetMapping: MappingData;
  questions: QuestionsData;
  metrics: MetricsData;
}

const DEFAULT_FORM: FormData = {
  org: { councilName: '', contactName: '', contactEmail: '' },
  sources: { systems: [], fileTypes: [] },
  wasteMapping: { mappings: {} },
  fleetMapping: { mappings: {} },
  questions: { challenges: '', goals: '', reporting: '', other: '' },
  metrics: { goals: [] },
};

function storageKey(orgId: string) { return `bb_onboarding_${orgId}`; }

export default function OnboardingWizard({ organisationId, userId }: { organisationId: string; userId: string }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [visible, setVisible] = useState(true);

  // Load saved progress on mount
  useEffect(() => {
    const local = localStorage.getItem(storageKey(organisationId));
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (parsed.formData) setFormData(parsed.formData);
        if (parsed.step) setStep(parsed.step);
        return;
      } catch { /* ignore */ }
    }
    // Fall back to server
    fetch('/api/onboarding/progress')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && !d.completed && d.data && Object.keys(d.data).length > 0) {
          setFormData({ ...DEFAULT_FORM, ...d.data });
          setStep(d.currentStep ?? 1);
        }
      })
      .catch(() => {});
  }, [organisationId]);

  const persist = useCallback((nextStep: number, nextData: FormData) => {
    localStorage.setItem(storageKey(organisationId), JSON.stringify({ step: nextStep, formData: nextData }));
    fetch('/api/onboarding/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentStep: nextStep, data: nextData }),
    }).catch(() => {});
  }, [organisationId]);

  function transition(nextStep: number) {
    setVisible(false);
    setTimeout(() => { setStep(nextStep); setVisible(true); }, 180);
  }

  function handleNext(patch: Partial<FormData>) {
    const next = { ...formData, ...patch };
    setFormData(next);
    const nextStep = step + 1;
    persist(nextStep, next);
    transition(nextStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleBack() {
    transition(step - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: formData }),
      });
      if (res.ok) {
        localStorage.removeItem(storageKey(organisationId));
        setSubmitted(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) return <SuccessScreen />;

  const percent = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className={styles.page}>
      {/* Minimal header */}
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          BR<span className={styles.brandMark}>Λ</span>INBASE
        </Link>
        <h1 className={styles.headerTitle}>Onboarding</h1>
      </header>

      <main>
        {/* Progress bar */}
        <div className={styles.progress} style={{ top: APP_HEADER_OFFSET_VAR }}>
          <div className={styles.progressInner}>
            {/* Track — decorative; the step list below carries the semantics */}
            <div className={styles.track} aria-hidden="true">
              <div className={styles.trackFill} style={{ width: `${percent}%` }} />
              {STEPS.map((s, i) => {
                const pos = (i / (STEPS.length - 1)) * 100;
                const done = step > s.id;
                const active = step === s.id;
                return (
                  <div
                    key={s.id}
                    className={styles.marker}
                    data-state={done ? 'done' : active ? 'current' : 'upcoming'}
                    style={{ left: `${pos}%` }}
                  >
                    {done ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <span>{s.id}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <ol className={styles.steps} aria-label={`Onboarding progress, step ${step} of ${STEPS.length}`}>
              {STEPS.map(s => (
                <li
                  key={s.id}
                  className={styles.stepLabel}
                  data-state={step > s.id ? 'done' : step === s.id ? 'current' : 'upcoming'}
                  aria-current={step === s.id ? 'step' : undefined}
                >
                  {s.label}
                  {step > s.id && <span className="bb-visually-hidden"> (completed)</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Step content */}
        <div className={styles.content} data-visible={visible ? 'true' : 'false'}>
          {step === 1 && <Step1OrgInfo data={formData.org} onNext={d => handleNext({ org: d })} />}
          {step === 2 && <Step2DataSources data={formData.sources} onNext={d => handleNext({ sources: d })} onBack={handleBack} />}
          {step === 3 && <Step3WasteMapping data={formData.wasteMapping} onNext={d => handleNext({ wasteMapping: d })} onBack={handleBack} />}
          {step === 4 && <Step4FleetMapping data={formData.fleetMapping} onNext={d => handleNext({ fleetMapping: d })} onBack={handleBack} />}
          {step === 5 && <Step5KeyQuestions data={formData.questions} onNext={d => handleNext({ questions: d })} onBack={handleBack} />}
          {step === 6 && <Step6SuccessMetrics data={formData.metrics} onNext={d => handleNext({ metrics: d })} onBack={handleBack} />}
          {step === 7 && <Step7Review formData={formData} onBack={handleBack} onSubmit={handleSubmit} submitting={submitting} />}
        </div>
      </main>
    </div>
  );
}

function SuccessScreen() {
  return (
    <main className={styles.success}>
      <div className={styles.successIcon} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h1 className={styles.successTitle}>You're all set!</h1>
      <p className={styles.successCopy}>
        HLNA has everything it needs to get started. Your data mappings are saved and your dashboard is ready.
      </p>
      <Link href="/dashboard/overview" {...buttonProps('primary')}>
        Go to Dashboard
      </Link>
    </main>
  );
}
