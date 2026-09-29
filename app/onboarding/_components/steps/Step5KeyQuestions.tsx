'use client';

import { useState } from 'react';
import { QuestionsData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';
import { Field, fieldControlClassName } from '@/components/ui/app';
import styles from '../Onboarding.module.css';

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
        <div className={styles.stack}>
          {QUESTIONS.map(q => (
            <Field key={q.key} label={q.label}>
              {control => (
                <textarea
                  {...control}
                  className={fieldControlClassName}
                  placeholder={q.placeholder}
                  value={form[q.key]}
                  onChange={e => setForm(f => ({ ...f, [q.key]: e.target.value }))}
                  rows={3}
                />
              )}
            </Field>
          ))}
          <p className={styles.hint}>
            All fields are optional — answer what's most relevant to you.
          </p>
        </div>

        <NavButtons onBack={onBack} />
      </StepShell>
    </form>
  );
}
