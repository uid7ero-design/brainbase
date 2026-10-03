'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AUDIT_FINDING_OUTCOMES, AUDIT_RESPONSE_TYPES, assuranceLabel, formatAssuranceDateTime,
  type AuditCriterion, type AuditOutcome, type AuditResponseType,
} from '@/lib/assurance/domain';
import ActionPanel from '../../_components/ActionPanel';
import type { FormField } from '../../_components/AssuranceForm';
import { Button, fieldControlClassName } from '@/components/ui/app';
import styles from '../../_components/assurance.module.css';

// Audit execution. Criteria come from the Audit's bound, immutable template
// version (or are defined ad hoc). Each save posts ONE response; the server
// re-derives the criterion label/type from the version.
//
// A rating NEVER creates a Finding. For Non-compliant / Partially compliant
// / Observation the auditor is OFFERED "Raise finding" and decides whether
// the issue warrants a formal Finding.

export type AuditRunnerResponse = {
  criterion_key: string; criterion_label: string; response_type: AuditResponseType; response_value: unknown;
  outcome: AuditOutcome | null; notes: string | null; responded_at: string; responded_by_name: string | null;
};
export type AuditRunnerFinding = { id: string; finding_reference: string; status: string; source_criterion_key: string | null };

type Props = {
  auditId: string;
  editable: boolean;
  canRaiseFindings: boolean;
  adHoc: boolean;
  criteria: AuditCriterion[];
  responses: AuditRunnerResponse[];
  findings: AuditRunnerFinding[];
  findingFields: FormField[];
};

type OutcomeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

const OUTCOMES: { value: AuditOutcome; label: string; help: string; tone: OutcomeTone }[] = [
  { value: 'COMPLIANT', label: 'Compliant', help: 'Fully meets the requirement', tone: 'success' },
  { value: 'PARTIAL', label: 'Partially compliant', help: 'Meets some of the requirement', tone: 'warning' },
  { value: 'NON_COMPLIANT', label: 'Non-compliant', help: 'Does not meet the requirement', tone: 'danger' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable', help: 'Requirement does not apply here', tone: 'neutral' },
  { value: 'OBSERVATION', label: 'Observation', help: 'Worth noting; not a breach', tone: 'info' },
];

const control = fieldControlClassName;

export default function AuditRunner({ auditId, editable, canRaiseFindings, adHoc, criteria, responses, findings, findingFields }: Props) {
  const byKey = new Map(responses.map(r => [r.criterion_key, r]));
  const items: AuditCriterion[] = adHoc
    ? responses.map(r => ({ key: r.criterion_key, label: r.criterion_label, responseType: r.response_type, guidance: null, required: false, options: [], section: null }))
    : criteria;
  const answered = items.filter(i => byKey.has(i.key)).length;
  const tally = OUTCOMES.map(o => ({ ...o, n: responses.filter(r => r.outcome === o.value).length })).filter(o => o.n > 0);

  return (
    <div className={styles.stackTight}>
      <div className={styles.runnerSummary}>
        <span>{answered} of {items.length} criteri{items.length === 1 ? 'on' : 'a'} assessed</span>
        {tally.map(t => <span key={t.value} className={styles.outcomeText} data-tone={t.tone}>{t.n} {t.label.toLowerCase()}</span>)}
      </div>
      {items.length === 0 && (
        <div className={styles.dim} style={{ fontSize: 13, padding: '18px 0' }}>
          {adHoc ? 'No criteria assessed yet. Add the first criterion below.' : 'This template version has no readable criteria.'}
        </div>
      )}
      <ol className={styles.runnerList}>
        {items.map((c, idx) => (
          <Fragment key={c.key}>
            {c.section && c.section !== items[idx - 1]?.section && (
              <li className={styles.runnerSection}><h3>{c.section}</h3></li>
            )}
            <CriterionRow index={idx} criterion={c} response={byKey.get(c.key) ?? null} auditId={auditId}
              editable={editable} adHoc={adHoc} canRaiseFindings={canRaiseFindings}
              findings={findings.filter(f => f.source_criterion_key === c.key)} findingFields={findingFields} />
          </Fragment>
        ))}
      </ol>
      {editable && adHoc && <AddAdHocCriterion auditId={auditId} />}
    </div>
  );
}

function CriterionRow({ index, criterion, response, auditId, editable, adHoc, canRaiseFindings, findings, findingFields }: {
  index: number; criterion: AuditCriterion; response: AuditRunnerResponse | null; auditId: string; editable: boolean; adHoc: boolean;
  canRaiseFindings: boolean; findings: AuditRunnerFinding[]; findingFields: FormField[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<AuditOutcome | ''>(response?.outcome ?? '');
  const [value, setValue] = useState<string>(displayValue(response?.response_value));
  const [notes, setNotes] = useState(response?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showEditor = editable && (editing || !response);
  const needsValue = criterion.responseType !== 'COMPLIANCE_RATING';
  const frozen = findings.length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { criterionKey: criterion.key, outcome: outcome || null, notes: notes || null };
      if (needsValue) body.value = value || null;
      if (adHoc) { body.criterionLabel = criterion.label; body.responseType = criterion.responseType; }
      const res = await fetch(`/api/assurance/audits/${auditId}/responses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not save this response.'); return; }
      setEditing(false);
      router.refresh();
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  const o = OUTCOMES.find(x => x.value === response?.outcome);
  const raisable = canRaiseFindings && response?.outcome && AUDIT_FINDING_OUTCOMES.includes(response.outcome);

  return (
    <li className={styles.runnerItem} data-tone={o?.tone}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.runnerLabel}>
            {index + 1}. {criterion.label}
            {criterion.required && !adHoc && <span className={styles.runnerRequired}> · required</span>}
          </div>
          {criterion.guidance && <div className={styles.runnerGuidance}>{criterion.guidance}</div>}
          <div className={styles.runnerMeta}>{assuranceLabel(criterion.responseType)}{criterion.options.length > 0 ? ` · ${criterion.options.join(' / ')}` : ''}</div>
        </div>
        {response && !showEditor && (
          <div style={{ textAlign: 'right' }}>
            {response.outcome && <span className={styles.outcomeLabel} data-tone={o?.tone}>{o?.label ?? assuranceLabel(response.outcome)}</span>}
            {response.response_value !== null && response.response_value !== undefined && (
              <div className={styles.runnerValue}>{displayValue(response.response_value)}</div>
            )}
            <div className={styles.runnerMeta} style={{ marginTop: 0 }}>{response.responded_by_name ?? 'Unknown'} · {formatAssuranceDateTime(response.responded_at)}</div>
          </div>
        )}
      </div>
      {response?.notes && !showEditor && <div className={styles.runnerNotes}>{response.notes}</div>}

      {showEditor && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div role="radiogroup" aria-label={`Rating for ${criterion.label}`} className={styles.row} style={{ gap: 6 }}>
            {OUTCOMES.map(x => (
              <button key={x.value} type="button" role="radio" aria-checked={outcome === x.value} title={x.help} onClick={() => setOutcome(x.value)} className={styles.outcomeChip} data-tone={x.tone}>
                {x.label}
              </button>
            ))}
          </div>
          {outcome && <div className={styles.runnerMeta} style={{ marginTop: 0 }}>{OUTCOMES.find(x => x.value === outcome)?.help}</div>}
          {needsValue && <ValueInput type={criterion.responseType} options={criterion.options} value={value} onChange={setValue} label={criterion.label} />}
          <textarea aria-label={`Notes for ${criterion.label}`}
            placeholder={outcome === 'NON_COMPLIANT' || outcome === 'PARTIAL' ? 'Describe the gap against the requirement (required)' : 'Notes / evidence sighted (optional)'}
            value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={control} />
          {error && <div role="alert" className={styles.actionError}>{error}</div>}
          <div className={styles.row}>
            <Button variant="primary" onClick={save} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : response ? 'Update response' : 'Save response'}
            </Button>
            {response && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      )}

      {(findings.length > 0 || raisable || (editable && response && !showEditor && !frozen)) && (
        <div className={styles.row} style={{ marginTop: 10 }}>
          {findings.map(f => (
            <Link key={f.id} href={`/assurance/findings/${f.id}`} className={styles.refChip} style={{ fontFamily: 'inherit', fontSize: '0.75rem', padding: '4px 8px' }}>
              Finding {f.finding_reference} · {assuranceLabel(f.status)}
            </Link>
          ))}
          {editable && response && !showEditor && !frozen && (
            <Button size="sm" onClick={() => setEditing(true)}>Revise</Button>
          )}
          {raisable && (
            <ActionPanel
              label={findings.length > 0 ? 'Raise another finding' : 'Raise finding'}
              endpoint="/api/assurance/findings"
              variant={response?.outcome === 'NON_COMPLIANT' ? 'primary' : 'secondary'}
              extraBody={{ auditId, auditCriterionKey: criterion.key }}
              fields={withDefaults(findingFields, criterion, response!)}
              submitLabel="Raise finding"
              redirectTo="/assurance/findings/{id}"
              description="Only raise a finding if this warrants formal corrective work. It is linked to this audit and criterion; corrective actions are then managed on the finding. The audit itself is not changed, and this criterion's response is frozen."
            />
          )}
        </div>
      )}
    </li>
  );
}

function withDefaults(fields: FormField[], criterion: AuditCriterion, response: AuditRunnerResponse): FormField[] {
  return fields.map(f => {
    if (f.kind === 'select' && f.name === 'findingType') {
      return { ...f, defaultValue: response.outcome === 'OBSERVATION' ? 'OBSERVATION' : 'NON_CONFORMANCE' };
    }
    if (f.kind === 'text' && f.name === 'title') return { ...f, defaultValue: criterion.label };
    if (f.kind === 'textarea' && f.name === 'description') return { ...f, defaultValue: response.notes ?? '' };
    return f;
  });
}

function ValueInput({ type, options, value, onChange, label }: { type: AuditResponseType; options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  if (type === 'NUMBER') return <input aria-label={`Value for ${label}`} type="number" step="any" value={value} onChange={e => onChange(e.target.value)} className={control} />;
  if (type === 'BOOLEAN') {
    return (
      <select aria-label={`Value for ${label}`} value={value} onChange={e => onChange(e.target.value)} className={control}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  }
  if (type === 'CHOICE' && options.length > 0) {
    return (
      <select aria-label={`Value for ${label}`} value={value} onChange={e => onChange(e.target.value)} className={control}>
        <option value="">Choose…</option>{options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input aria-label={`Value for ${label}`} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="Response" className={control} />;
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function AddAdHocCriterion({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<AuditResponseType>('COMPLIANCE_RATING');
  const [outcome, setOutcome] = useState<AuditOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setError(null);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'criterion';
    const criterionKey = `adhoc-${slug}-${Math.random().toString(36).slice(2, 8)}`;
    setBusy(true);
    try {
      const res = await fetch(`/api/assurance/audits/${auditId}/responses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionKey, criterionLabel: label, responseType: type, outcome: outcome || null, notes: notes || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not add the criterion.'); return; }
      setLabel(''); setOutcome(''); setNotes('');
      router.refresh();
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.runnerAdd}>
      <div className={styles.legend} style={{ margin: 0 }}>Assess another criterion</div>
      <input aria-label="Criterion" placeholder="Requirement being assessed" value={label} onChange={e => setLabel(e.target.value)} className={control} />
      <div className={styles.row}>
        <select aria-label="Response type" value={type} onChange={e => setType(e.target.value as AuditResponseType)} className={control} style={{ width: 'auto' }}>
          {AUDIT_RESPONSE_TYPES.filter(t => t === 'COMPLIANCE_RATING' || t === 'TEXT' || t === 'NUMBER').map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
        </select>
        <select aria-label="Rating" value={outcome} onChange={e => setOutcome(e.target.value as AuditOutcome | '')} className={control} style={{ width: 'auto' }}>
          <option value="">Rating…</option>
          {OUTCOMES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
      </div>
      <textarea aria-label="Notes" placeholder="Notes / evidence sighted" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={control} />
      {error && <div role="alert" className={styles.actionError}>{error}</div>}
      <div>
        <Button variant="primary" onClick={add} disabled={busy || !label.trim()} aria-busy={busy || undefined}>
          {busy ? 'Adding…' : 'Add criterion'}
        </Button>
      </div>
    </div>
  );
}
