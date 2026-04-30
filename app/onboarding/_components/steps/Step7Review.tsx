'use client';

import { FormData } from '../OnboardingWizard';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const WASTE_LABELS: Record<string, string> = {
  service_type: 'Service Type', suburb: 'Suburb / Area', month: 'Month',
  financial_year: 'Financial Year', tonnes: 'Tonnes', collections: 'Collections',
  contamination_rate: 'Contamination Rate', cost: 'Cost',
};

const FLEET_LABELS: Record<string, string> = {
  vehicle_id: 'Vehicle ID', vehicle_type: 'Vehicle Type', make: 'Make / Model',
  year: 'Year', department: 'Department', driver: 'Driver', month: 'Month',
  financial_year: 'Financial Year', km: 'Kilometres', fuel: 'Fuel Cost',
  wages: 'Wages', maintenance: 'Maintenance', rego: 'Registration',
  repairs: 'Repairs', insurance: 'Insurance', depreciation: 'Depreciation',
  services: 'Service Count', defects: 'Defect Count',
};

const GOAL_LABELS: Record<string, string> = {
  reduce_contamination: 'Reduce contamination', improve_diversion: 'Improve diversion rates',
  fleet_efficiency: 'Fleet efficiency', cost_reduction: 'Reduce operational costs',
  service_compliance: 'Service compliance', carbon_reduction: 'Reduce carbon footprint',
  reporting_automation: 'Automate reporting', data_visibility: 'Improve data visibility',
  councillor_reporting: 'Councillor-ready reports', community_engagement: 'Community engagement insights',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', background: 'rgba(255,255,255,.03)', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: FONT }}>
          {title}
        </h3>
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
      <span style={{ fontSize: 13, color: '#71717A', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#D4D4D8', textAlign: 'right', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

export default function Step7Review({ formData, onBack, onSubmit, submitting }: {
  formData: FormData; onBack: () => void; onSubmit: () => void; submitting: boolean;
}) {
  const { org, sources, wasteMapping, fleetMapping, questions, metrics } = formData;
  const wasteMapped = Object.entries(wasteMapping.mappings).filter(([, v]) => v);
  const fleetMapped = Object.entries(fleetMapping.mappings).filter(([, v]) => v);

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 16, padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 24, fontFamily: FONT,
    }}>
      <div>
        <span style={{ fontSize: 28, lineHeight: 1, display: 'block', marginBottom: 8 }}>📋</span>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#F4F4F5' }}>Review & confirm</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#71717A' }}>
          Check everything looks right before submitting. You can edit any section after setup too.
        </p>
      </div>

      {/* Org */}
      <Section title="Organisation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Row label="Name" value={org.councilName} />
          <Row label="Contact" value={org.contactName} />
          <Row label="Email" value={org.contactEmail} />
        </div>
      </Section>

      {/* Data sources */}
      <Section title="Data Sources">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Row label="Systems" value={sources.systems.join(', ') || 'None selected'} />
          <Row label="File types" value={sources.fileTypes.join(', ') || 'None selected'} />
        </div>
      </Section>

      {/* Waste mapping */}
      <Section title="Waste Data Mapping">
        {wasteMapped.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {wasteMapped.map(([field, col]) => (
              <Row key={field} label={WASTE_LABELS[field] ?? field} value={col} />
            ))}
            {wasteMapping.fileName && <Row label="File" value={wasteMapping.fileName} />}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: '#52525B' }}>No waste file uploaded — can be added later.</p>
        )}
      </Section>

      {/* Fleet mapping */}
      <Section title="Fleet Data Mapping">
        {fleetMapped.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fleetMapped.map(([field, col]) => (
              <Row key={field} label={FLEET_LABELS[field] ?? field} value={col} />
            ))}
            {fleetMapping.fileName && <Row label="File" value={fleetMapping.fileName} />}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: '#52525B' }}>No fleet file uploaded — can be added later.</p>
        )}
      </Section>

      {/* Questions */}
      {(questions.challenges || questions.goals || questions.reporting || questions.other) && (
        <Section title="Key Questions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {questions.challenges && (
              <div>
                <div style={{ fontSize: 11, color: '#52525B', marginBottom: 3 }}>Challenges</div>
                <div style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5 }}>{questions.challenges}</div>
              </div>
            )}
            {questions.goals && (
              <div>
                <div style={{ fontSize: 11, color: '#52525B', marginBottom: 3 }}>Data-driven decisions</div>
                <div style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5 }}>{questions.goals}</div>
              </div>
            )}
            {questions.reporting && (
              <div>
                <div style={{ fontSize: 11, color: '#52525B', marginBottom: 3 }}>Good reporting looks like</div>
                <div style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5 }}>{questions.reporting}</div>
              </div>
            )}
            {questions.other && (
              <div>
                <div style={{ fontSize: 11, color: '#52525B', marginBottom: 3 }}>Other context</div>
                <div style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5 }}>{questions.other}</div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Goals */}
      <Section title="Success Goals">
        {metrics.goals.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {metrics.goals.map(g => (
              <span key={g} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: 'rgba(124,58,237,.15)', border: '1px solid rgba(124,58,237,.3)', color: '#C4B5FD',
              }}>
                {GOAL_LABELS[g] ?? g}
              </span>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: '#52525B' }}>No goals selected.</p>
        )}
      </Section>

      {/* Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
            background: 'transparent', color: '#A1A1AA', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: FONT, transition: 'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = '#F4F4F5'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A1A1AA'; }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          style={{
            padding: '11px 28px', borderRadius: 8, border: 'none',
            background: submitting ? 'rgba(124,58,237,.4)' : 'linear-gradient(135deg, #7C3AED, #6D28D9)',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
            fontFamily: FONT, transition: 'opacity .15s', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {submitting ? (
            <>
              <Spinner /> Setting up HLNA…
            </>
          ) : (
            '🚀 Complete Setup'
          )}
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="1.5"/>
      <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    </svg>
  );
}
