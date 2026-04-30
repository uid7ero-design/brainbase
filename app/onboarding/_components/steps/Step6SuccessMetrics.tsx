'use client';

import { useState } from 'react';
import { MetricsData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

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
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {GOALS.map(g => {
              const checked = form.goals.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, goals: toggle(f.goals, g.id) }))}
                  style={{
                    padding: '14px 16px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                    border: checked ? '1px solid rgba(124,58,237,.6)' : '1px solid rgba(255,255,255,.07)',
                    background: checked ? 'rgba(124,58,237,.1)' : 'rgba(255,255,255,.02)',
                    fontFamily: FONT, transition: 'all .15s', position: 'relative',
                  }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; }}
                  onMouseLeave={e => { if (!checked) e.currentTarget.style.borderColor = 'rgba(255,255,255,.07)'; }}
                >
                  {checked && (
                    <div style={{
                      position: 'absolute', top: 10, right: 10,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4l2 2L6.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                  <div style={{ fontSize: 20, marginBottom: 8 }}>{g.emoji}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: checked ? '#C4B5FD' : '#F4F4F5', marginBottom: 3 }}>
                    {g.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#52525B', lineHeight: 1.4 }}>{g.desc}</div>
                </button>
              );
            })}
          </div>

          {form.goals.length > 0 && (
            <p style={{ margin: '14px 0 0', fontSize: 12, color: '#71717A' }}>
              {form.goals.length} goal{form.goals.length > 1 ? 's' : ''} selected
            </p>
          )}
        </div>

        <NavButtons onBack={onBack} next="Review & Submit" />
      </StepShell>
    </form>
  );
}
