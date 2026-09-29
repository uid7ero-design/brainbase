'use client';

import { useState } from 'react';
import { MetricsData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';
import { CheckMark } from './Step2DataSources';
import styles from '../Onboarding.module.css';

const GOALS = [
  { id: 'reduce_contamination',   emoji: '♻️', label: 'Reduce contamination',          desc: 'Improve recycling quality' },
  { id: 'improve_diversion',      emoji: '📈', label: 'Improve diversion rates',        desc: 'More waste diverted from landfill' },
  { id: 'fleet_efficiency',       emoji: '🚛', label: 'Fleet efficiency',               desc: 'Lower cost-per-km, better uptime' },
  { id: 'cost_reduction',         emoji: '💰', label: 'Reduce operational costs',       desc: 'Find savings across services' },
  { id: 'service_compliance',     emoji: '✅', label: 'Service compliance',             desc: 'Meet contract & SLA targets' },
  { id: 'carbon_reduction',       emoji: '🌿', label: 'Reduce carbon footprint',        desc: 'Emissions and sustainability goals' },
  { id: 'reporting_automation',   emoji: '⚡', label: 'Automate reporting',             desc: 'Less time on manual reports' },
  { id: 'data_visibility',        emoji: '🔍', label: 'Improve data visibility',        desc: 'See everything in one place' },
  { id: 'councillor_reporting',   emoji: '🏛️', label: 'Councillor-ready reports',      desc: 'Clear briefings for elected members' },
  { id: 'community_engagement',   emoji: '🤝', label: 'Community engagement insights', desc: 'Understand resident behaviour' },
];

function toggle(arr: string[], val: string) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

export default function Step6SuccessMetrics({ data, onNext, onBack }: {
  data: MetricsData; onNext: (d: MetricsData) => void; onBack: () => void;
}) {
  const [form, setForm] = useState<MetricsData>(data);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepShell
        icon="🎯"
        title="What does success look like?"
        subtitle="Select the goals that matter most. HLNA will weight its insights accordingly."
      >
        <div role="group" aria-label="Success goals">
          <div className={styles.goalGrid}>
            {GOALS.map(g => {
              const checked = form.goals.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={checked}
                  className={styles.option}
                  onClick={() => setForm(f => ({ ...f, goals: toggle(f.goals, g.id) }))}
                >
                  <CheckMark />
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{g.label}</span>
                    <span className={styles.optionDesc}>{g.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {form.goals.length > 0 && (
            <p className={styles.hint} style={{ marginTop: 14 }}>
              {form.goals.length} goal{form.goals.length > 1 ? 's' : ''} selected
            </p>
          )}
        </div>

        <NavButtons onBack={onBack} next="Review & Submit" />
      </StepShell>
    </form>
  );
}
