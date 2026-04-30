'use client';

import { useState } from 'react';
import { QuestionsData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const taStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 8, color: '#F4F4F5', fontSize: 14,
  outline: 'none', boxSizing: 'border-box', resize: 'vertical',
  fontFamily: FONT, lineHeight: 1.5, minHeight: 80,
  transition: 'border-color .15s',
};

const QUESTIONS: { key: keyof QuestionsData; label: string; placeholder: string }[] = [
  {
    key: 'challenges',
    label: "What are your biggest operational challenges right now?",
    placeholder: "e.g. We struggle to track contamination across suburbs, our fleet maintenance costs are climbing and we can't easily see why...",
  },
  {
    key: 'goals',
    label: "What decisions do you most often need data to support?",
    placeholder: "e.g. Deciding which routes to audit, whether to procure new vehicles, where to run community education...",
  },
  {
    key: 'reporting',
    label: "What does good reporting look like for you?",
    placeholder: "e.g. Weekly summary for operational managers, monthly council briefing, quarterly year-on-year comparison...",
  },
  {
    key: 'other',
    label: "Anything else HLNA should know about your organisation?",
    placeholder: "e.g. We have a sister council sharing our depot, our data goes back to FY2019, we use metric tonnes...",
  },
];

export default function Step5KeyQuestions({ data, onNext, onBack }: {
  data: QuestionsData; onNext: (d: QuestionsData) => void; onBack: () => void;
}) {
  const [form, setForm] = useState<QuestionsData>(data);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepShell
        icon="💬"
        title="A few questions for HLNA"
        subtitle="The more context you give, the more relevant your briefings and insights will be."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {QUESTIONS.map(q => (
            <div key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#A1A1AA' }}>{q.label}</label>
              <textarea
                style={taStyle}
                placeholder={q.placeholder}
                value={form[q.key]}
                onChange={e => setForm(f => ({ ...f, [q.key]: e.target.value }))}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; }}
                rows={3}
              />
            </div>
          ))}
          <p style={{ margin: 0, fontSize: 12, color: '#52525B' }}>
            All fields are optional — answer what's most relevant to you.
          </p>
        </div>

        <NavButtons onBack={onBack} />
      </StepShell>
    </form>
  );
}
