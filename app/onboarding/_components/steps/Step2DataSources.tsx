'use client';

import { useState } from 'react';
import { SourcesData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';
import styles from '../Onboarding.module.css';

const SYSTEMS = [
  { id: 'techone', label: 'TechOne' },
  { id: 'civica', label: 'Civica' },
  { id: 'authority', label: 'Authority' },
  { id: 'pathway', label: 'Pathway' },
  { id: 'jde', label: 'JD Edwards' },
  { id: 'sap', label: 'SAP' },
  { id: 'excel', label: 'Excel / Manual' },
  { id: 'other', label: 'Other' },
];

const FILE_TYPES = [
  { id: 'csv', label: 'CSV exports', desc: 'Comma-separated files' },
  { id: 'xlsx', label: 'Excel (XLSX)', desc: 'Spreadsheet files' },
  { id: 'api', label: 'Direct API', desc: 'Live system connection' },
  { id: 'manual', label: 'Manual entry', desc: 'Enter data by hand' },
];

function toggle(arr: string[], val: string) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

export default function Step2DataSources({ data, onNext, onBack }: {
  data: SourcesData; onNext: (d: SourcesData) => void; onBack: () => void;
}) {
  const [form, setForm] = useState<SourcesData>(data);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepShell
        icon="🔌"
        title="What systems do you use?"
        subtitle="Select everything that applies — we'll configure integrations to match."
      >
        <div className={styles.stackLoose}>
          {/* Finance / Operations systems */}
          <div role="group" aria-labelledby="onboarding-systems-title">
            <h3 id="onboarding-systems-title" className={styles.groupTitle}>
              Finance & Operations Systems
            </h3>
            <div className={styles.optionGrid}>
              {SYSTEMS.map(s => {
                const checked = form.systems.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={checked}
                    className={styles.option}
                    onClick={() => setForm(f => ({ ...f, systems: toggle(f.systems, s.id) }))}
                  >
                    <CheckMark />
                    <span className={styles.optionLabel}>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* File types */}
          <div role="group" aria-labelledby="onboarding-filetypes-title">
            <h3 id="onboarding-filetypes-title" className={styles.groupTitle}>
              How do you export your data?
            </h3>
            <div className={styles.optionGridWide}>
              {FILE_TYPES.map(ft => {
                const checked = form.fileTypes.includes(ft.id);
                return (
                  <button
                    key={ft.id}
                    type="button"
                    aria-pressed={checked}
                    className={styles.option}
                    onClick={() => setForm(f => ({ ...f, fileTypes: toggle(f.fileTypes, ft.id) }))}
                  >
                    <CheckMark />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{ft.label}</span>
                      <span className={styles.optionDesc}>{ft.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {form.systems.length === 0 && form.fileTypes.length === 0 && (
            <p className={`${styles.hint} ${styles.centered}`}>
              You can skip this step and configure integrations later.
            </p>
          )}
        </div>

        <NavButtons onBack={onBack} />
      </StepShell>
    </form>
  );
}

/** Checkbox-style indicator for a pressed selection tile (state is on aria-pressed). */
export function CheckMark() {
  return (
    <span className={styles.check} aria-hidden="true">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <path d="M1.5 4.5l2 2L7.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}
