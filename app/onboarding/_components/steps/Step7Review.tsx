'use client';

import { FormData } from '../OnboardingWizard';
import { Button, Panel } from '@/components/ui/app';
import styles from '../Onboarding.module.css';

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

// Visual (remaining visual islands pass): review sections are shared Panels
// (h3 under the step h2) and each summary is a description list.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel title={title} titleAs="h3">
      {children}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.reviewRow}>
      <dt className={styles.reviewLabel}>{label}</dt>
      <dd className={styles.reviewValue}>{value || '—'}</dd>
    </div>
  );
}

function Answer({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={styles.answerLabel}>{label}</dt>
      <dd className={styles.answerText}>{value}</dd>
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
    <div className={styles.shell}>
      <div className={styles.shellHead}>
        <h2 className={styles.shellTitle}>Review & confirm</h2>
        <p className={styles.shellSubtitle}>
          Check everything looks right before submitting. You can edit any section after setup too.
        </p>
      </div>

      {/* Org */}
      <Section title="Organisation">
        <dl className={styles.reviewList}>
          <Row label="Name" value={org.councilName} />
          <Row label="Contact" value={org.contactName} />
          <Row label="Email" value={org.contactEmail} />
        </dl>
      </Section>

      {/* Data sources */}
      <Section title="Data Sources">
        <dl className={styles.reviewList}>
          <Row label="Systems" value={sources.systems.join(', ') || 'None selected'} />
          <Row label="File types" value={sources.fileTypes.join(', ') || 'None selected'} />
        </dl>
      </Section>

      {/* Waste mapping */}
      <Section title="Waste Data Mapping">
        {wasteMapped.length > 0 ? (
          <dl className={styles.reviewList}>
            {wasteMapped.map(([field, col]) => (
              <Row key={field} label={WASTE_LABELS[field] ?? field} value={col} />
            ))}
            {wasteMapping.fileName && <Row label="File" value={wasteMapping.fileName} />}
          </dl>
        ) : (
          <p className={styles.hint}>No waste file uploaded — can be added later.</p>
        )}
      </Section>

      {/* Fleet mapping */}
      <Section title="Fleet Data Mapping">
        {fleetMapped.length > 0 ? (
          <dl className={styles.reviewList}>
            {fleetMapped.map(([field, col]) => (
              <Row key={field} label={FLEET_LABELS[field] ?? field} value={col} />
            ))}
            {fleetMapping.fileName && <Row label="File" value={fleetMapping.fileName} />}
          </dl>
        ) : (
          <p className={styles.hint}>No fleet file uploaded — can be added later.</p>
        )}
      </Section>

      {/* Questions */}
      {(questions.challenges || questions.goals || questions.reporting || questions.other) && (
        <Section title="Key Questions">
          <dl className={styles.answers}>
            {questions.challenges && <Answer label="Challenges" value={questions.challenges} />}
            {questions.goals && <Answer label="Data-driven decisions" value={questions.goals} />}
            {questions.reporting && <Answer label="Good reporting looks like" value={questions.reporting} />}
            {questions.other && <Answer label="Other context" value={questions.other} />}
          </dl>
        </Section>
      )}

      {/* Goals */}
      <Section title="Success Goals">
        {metrics.goals.length > 0 ? (
          <ul className={styles.chips}>
            {metrics.goals.map(g => (
              <li key={g} className={styles.chip}>
                {GOAL_LABELS[g] ?? g}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>No goals selected.</p>
        )}
      </Section>

      {/* Nav */}
      <div className={styles.nav}>
        <Button variant="secondary" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? (
            <>
              <Spinner /> Setting up HLNA…
            </>
          ) : (
            'Complete Setup'
          )}
        </Button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className={styles.spinner} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5"/>
      <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    </svg>
  );
}
