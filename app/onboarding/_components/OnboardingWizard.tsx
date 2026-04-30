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

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

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
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: FONT }}>
      {/* Minimal header */}
      <header style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', borderBottom: '1px solid rgba(255,255,255,.06)',
        background: 'rgba(7,8,11,.92)', backdropFilter: 'blur(16px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 14, color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.04em' }}>
          BR<span style={{ color: '#A78BFA' }}>Λ</span>INBASE
        </Link>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Onboarding
        </span>
      </header>

      {/* Progress bar */}
      <div style={{
        position: 'sticky', top: 52, zIndex: 90,
        background: 'rgba(7,8,11,.96)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,.05)',
        padding: '16px 28px 14px',
      }}>
        {/* Track */}
        <div style={{ maxWidth: 680, margin: '0 auto', position: 'relative' }}>
          <div style={{ position: 'relative', height: 2, background: 'rgba(255,255,255,.08)', borderRadius: 2, margin: '14px 0 10px' }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, height: '100%',
              width: `${percent}%`, background: 'linear-gradient(90deg, #6D28D9, #A78BFA)',
              borderRadius: 2, transition: 'width .4s cubic-bezier(.4,0,.2,1)',
            }} />
            {STEPS.map((s, i) => {
              const pos = (i / (STEPS.length - 1)) * 100;
              const done = step > s.id;
              const active = step === s.id;
              return (
                <div key={s.id} style={{ position: 'absolute', top: '50%', left: `${pos}%`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: active ? 28 : 20, height: active ? 28 : 20,
                    borderRadius: '50%',
                    background: done ? '#7C3AED' : active ? '#7C3AED' : 'rgba(255,255,255,.08)',
                    border: active ? '2px solid #A78BFA' : done ? 'none' : '1px solid rgba(255,255,255,.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .25s',
                    boxShadow: active ? '0 0 12px rgba(124,58,237,.5)' : 'none',
                    zIndex: 1,
                  }}>
                    {done ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <span style={{ fontSize: active ? 11 : 9, fontWeight: 600, color: active ? '#fff' : 'rgba(255,255,255,.4)' }}>
                        {s.id}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Labels – hidden on small screens via overflow hidden */}
          <div style={{ display: 'flex', justifyContent: 'space-between', overflow: 'hidden' }}>
            {STEPS.map(s => (
              <div key={s.id} style={{
                fontSize: 10, fontWeight: 500, letterSpacing: '.04em', textTransform: 'uppercase',
                color: step === s.id ? '#A78BFA' : step > s.id ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.2)',
                transition: 'color .2s', whiteSpace: 'nowrap',
                width: `${100 / STEPS.length}%`, textAlign: 'center',
              }}>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div style={{
        maxWidth: 680, margin: '0 auto', padding: '40px 20px 80px',
        opacity: visible ? 1 : 0, transition: 'opacity .18s ease',
      }}>
        {step === 1 && <Step1OrgInfo data={formData.org} onNext={d => handleNext({ org: d })} />}
        {step === 2 && <Step2DataSources data={formData.sources} onNext={d => handleNext({ sources: d })} onBack={handleBack} />}
        {step === 3 && <Step3WasteMapping data={formData.wasteMapping} onNext={d => handleNext({ wasteMapping: d })} onBack={handleBack} />}
        {step === 4 && <Step4FleetMapping data={formData.fleetMapping} onNext={d => handleNext({ fleetMapping: d })} onBack={handleBack} />}
        {step === 5 && <Step5KeyQuestions data={formData.questions} onNext={d => handleNext({ questions: d })} onBack={handleBack} />}
        {step === 6 && <Step6SuccessMetrics data={formData.metrics} onNext={d => handleNext({ metrics: d })} onBack={handleBack} />}
        {step === 7 && <Step7Review formData={formData} onBack={handleBack} onSubmit={handleSubmit} submitting={submitting} />}
      </div>
    </div>
  );
}

function SuccessScreen() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: 24, textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#F4F4F5', margin: '0 0 12px' }}>You're all set!</h1>
      <p style={{ fontSize: 15, color: '#A1A1AA', maxWidth: 400, margin: '0 0 32px', lineHeight: 1.6 }}>
        HLNA has everything it needs to get started. Your data mappings are saved and your dashboard is ready.
      </p>
      <Link href="/dashboard/overview" style={{
        display: 'inline-block', padding: '12px 28px', borderRadius: 8, background: '#7C3AED',
        color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none',
        transition: 'background .15s',
      }}>
        Go to Dashboard
      </Link>
    </div>
  );
}
