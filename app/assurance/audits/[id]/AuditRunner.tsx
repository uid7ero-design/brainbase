'use client';
import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AUDIT_FINDING_OUTCOMES, AUDIT_RESPONSE_TYPES, assuranceLabel, formatAssuranceDateTime,
  type AuditCriterion, type AuditOutcome, type AuditResponseType,
} from '@/lib/assurance/domain';
import ActionPanel from '../../_components/ActionPanel';
import type { FormField } from '../../_components/AssuranceForm';

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

const OUTCOMES: { value: AuditOutcome; label: string; help: string; color: string }[] = [
  { value: 'COMPLIANT', label: 'Compliant', help: 'Fully meets the requirement', color: 'var(--bb-success)' },
  { value: 'PARTIAL', label: 'Partially compliant', help: 'Meets some of the requirement', color: 'var(--bb-warning)' },
  { value: 'NON_COMPLIANT', label: 'Non-compliant', help: 'Does not meet the requirement', color: 'var(--bb-danger)' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable', help: 'Requirement does not apply here', color: 'var(--text-secondary)' },
  { value: 'OBSERVATION', label: 'Observation', help: 'Worth noting; not a breach', color: 'var(--bb-info)' },
];

const control: CSSProperties = { padding: '8px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };

export default function AuditRunner({ auditId, editable, canRaiseFindings, adHoc, criteria, responses, findings, findingFields }: Props) {
  const byKey = new Map(responses.map(r => [r.criterion_key, r]));
  const items: AuditCriterion[] = adHoc
    ? responses.map(r => ({ key: r.criterion_key, label: r.criterion_label, responseType: r.response_type, guidance: null, required: false, options: [] }))
    : criteria;
  const answered = items.filter(i => byKey.has(i.key)).length;
  const tally = OUTCOMES.map(o => ({ ...o, n: responses.filter(r => r.outcome === o.value).length })).filter(o => o.n > 0);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>{answered} of {items.length} criteri{items.length === 1 ? 'on' : 'a'} assessed</span>
        {tally.map(t => <span key={t.value} style={{ color: t.color, fontWeight: 600 }}>{t.n} {t.label.toLowerCase()}</span>)}
      </div>
      {items.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 0' }}>
          {adHoc ? 'No criteria assessed yet. Add the first criterion below.' : 'This template version has no readable criteria.'}
        </div>
      )}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {items.map((c, idx) => (
          <CriterionRow key={c.key} index={idx} criterion={c} response={byKey.get(c.key) ?? null} auditId={auditId}
            editable={editable} adHoc={adHoc} canRaiseFindings={canRaiseFindings}
            findings={findings.filter(f => f.source_criterion_key === c.key)} findingFields={findingFields} />
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
    <li style={{ border: '1px solid var(--border)', borderLeft: `3px solid ${o?.color ?? 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {index + 1}. {criterion.label}
            {criterion.required && !adHoc && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> · required</span>}
          </div>
          {criterion.guidance && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{criterion.guidance}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{assuranceLabel(criterion.responseType)}{criterion.options.length > 0 ? ` · ${criterion.options.join(' / ')}` : ''}</div>
        </div>
        {response && !showEditor && (
          <div style={{ textAlign: 'right' }}>
            {response.outcome && <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: o?.color }}>{o?.label ?? assuranceLabel(response.outcome)}</span>}
            {response.response_value !== null && response.response_value !== undefined && (
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{displayValue(response.response_value)}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{response.responded_by_name ?? 'Unknown'} · {formatAssuranceDateTime(response.responded_at)}</div>
          </div>
        )}
      </div>
      {response?.notes && !showEditor && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, whiteSpace: 'pre-wrap' }}>{response.notes}</div>}

      {showEditor && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div role="radiogroup" aria-label={`Rating for ${criterion.label}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {OUTCOMES.map(x => (
              <button key={x.value} type="button" role="radio" aria-checked={outcome === x.value} title={x.help} onClick={() => setOutcome(x.value)}
                style={{ padding: '6px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${outcome === x.value ? x.color : 'var(--border)'}`,
                  background: outcome === x.value ? `color-mix(in srgb, ${x.color} 14%, transparent)` : 'transparent',
                  color: outcome === x.value ? x.color : 'var(--text-secondary)' }}>
                {x.label}
              </button>
            ))}
          </div>
          {outcome && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{OUTCOMES.find(x => x.value === outcome)?.help}</div>}
          {needsValue && <ValueInput type={criterion.responseType} options={criterion.options} value={value} onChange={setValue} label={criterion.label} />}
          <textarea aria-label={`Notes for ${criterion.label}`}
            placeholder={outcome === 'NON_COMPLIANT' || outcome === 'PARTIAL' ? 'Describe the gap against the requirement (required)' : 'Notes / evidence sighted (optional)'}
            value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...control, resize: 'vertical' }} />
          {error && <div role="alert" style={{ fontSize: 12, color: 'var(--bb-danger)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={save} disabled={busy}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--purple-600)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Saving…' : response ? 'Update response' : 'Save response'}
            </button>
            {response && <button type="button" onClick={() => setEditing(false)} style={{ padding: '7px 12px', borderRadius: 8, fontSize: 13, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>Cancel</button>}
          </div>
        </div>
      )}

      {(findings.length > 0 || raisable || (editable && response && !showEditor && !frozen)) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {findings.map(f => (
            <Link key={f.id} href={`/assurance/findings/${f.id}`} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-primary)', textDecoration: 'none' }}>
              Finding {f.finding_reference} · {assuranceLabel(f.status)}
            </Link>
          ))}
          {editable && response && !showEditor && !frozen && (
            <button type="button" onClick={() => setEditing(true)} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>Revise</button>
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
  if (type === 'NUMBER') return <input aria-label={`Value for ${label}`} type="number" step="any" value={value} onChange={e => onChange(e.target.value)} style={control} />;
  if (type === 'BOOLEAN') {
    return (
      <select aria-label={`Value for ${label}`} value={value} onChange={e => onChange(e.target.value)} style={control}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  }
  if (type === 'CHOICE' && options.length > 0) {
    return (
      <select aria-label={`Value for ${label}`} value={value} onChange={e => onChange(e.target.value)} style={control}>
        <option value="">Choose…</option>{options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input aria-label={`Value for ${label}`} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="Response" style={control} />;
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
    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 14, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Assess another criterion</div>
      <input aria-label="Criterion" placeholder="Requirement being assessed" value={label} onChange={e => setLabel(e.target.value)} style={control} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Response type" value={type} onChange={e => setType(e.target.value as AuditResponseType)} style={{ ...control, width: 'auto' }}>
          {AUDIT_RESPONSE_TYPES.filter(t => t === 'COMPLIANCE_RATING' || t === 'TEXT' || t === 'NUMBER').map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
        </select>
        <select aria-label="Rating" value={outcome} onChange={e => setOutcome(e.target.value as AuditOutcome | '')} style={{ ...control, width: 'auto' }}>
          <option value="">Rating…</option>
          {OUTCOMES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
      </div>
      <textarea aria-label="Notes" placeholder="Notes / evidence sighted" value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...control, resize: 'vertical' }} />
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--bb-danger)' }}>{error}</div>}
      <div>
        <button type="button" onClick={add} disabled={busy || !label.trim()}
          style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--purple-600)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy || !label.trim() ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add criterion'}
        </button>
      </div>
    </div>
  );
}
