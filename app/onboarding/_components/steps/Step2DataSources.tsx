'use client';

import { useState } from 'react';
import { SourcesData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Finance / Operations systems */}
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Finance & Operations Systems
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {SYSTEMS.map(s => {
                const checked = form.systems.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, systems: toggle(f.systems, s.id) }))}
                    style={{
                      padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      border: checked ? '1px solid rgba(124,58,237,.6)' : '1px solid rgba(255,255,255,.08)',
                      background: checked ? 'rgba(124,58,237,.12)' : 'rgba(255,255,255,.03)',
                      color: checked ? '#C4B5FD' : '#A1A1AA', fontSize: 13, fontWeight: 500,
                      fontFamily: FONT, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                      border: checked ? 'none' : '1px solid rgba(255,255,255,.2)',
                      background: checked ? '#7C3AED' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {checked && (
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                          <path d="M1.5 4.5l2 2L7.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* File types */}
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              How do you export your data?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {FILE_TYPES.map(ft => {
                const checked = form.fileTypes.includes(ft.id);
                return (
                  <button
                    key={ft.id}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, fileTypes: toggle(f.fileTypes, ft.id) }))}
                    style={{
                      padding: '12px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      border: checked ? '1px solid rgba(124,58,237,.6)' : '1px solid rgba(255,255,255,.08)',
                      background: checked ? 'rgba(124,58,237,.12)' : 'rgba(255,255,255,.03)',
                      fontFamily: FONT, transition: 'all .15s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: checked ? '#C4B5FD' : '#F4F4F5', marginBottom: 3 }}>
                      {ft.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#52525B' }}>{ft.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {form.systems.length === 0 && form.fileTypes.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: '#52525B', textAlign: 'center' }}>
              You can skip this step and configure integrations later.
            </p>
          )}
        </div>

        <NavButtons onBack={onBack} />
      </StepShell>
    </form>
  );
}
