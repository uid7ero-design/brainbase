'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  INSPECTION_RESPONSE_TYPES, assuranceLabel, formatAssuranceDateTime,
  type ChecklistItem, type InspectionOutcome, type InspectionResponseType,
} from '@/lib/assurance/domain';
import ActionPanel from '../../_components/ActionPanel';
import type { FormField } from '../../_components/AssuranceForm';
import { Button, fieldControlClassName } from '@/components/ui/app';
import styles from '../../_components/assurance.module.css';

// Checklist execution. Items come from the inspection's bound, immutable
// template version (or are defined ad hoc). Each save posts ONE response
// to the server, which re-derives the item label/type from the version —
// nothing here is trusted for integrity.

export type RunnerResponse = {
  item_key: string; item_label: string; response_type: InspectionResponseType; response_value: unknown;
  outcome: InspectionOutcome | null; notes: string | null; responded_at: string; responded_by_name: string | null;
};
export type RunnerFinding = { id: string; finding_reference: string; status: string; source_item_key: string | null };

type Props = {
  inspectionId: string;
  editable: boolean;
  canRaiseFindings: boolean;
  adHoc: boolean;
  checklist: ChecklistItem[];
  responses: RunnerResponse[];
  findings: RunnerFinding[];
  findingFields: FormField[];
};

type OutcomeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

const OUTCOMES: { value: InspectionOutcome; label: string; tone: OutcomeTone }[] = [
  { value: 'PASS', label: 'Pass', tone: 'success' },
  { value: 'FAIL', label: 'Fail', tone: 'danger' },
  { value: 'OBSERVATION', label: 'Observation', tone: 'warning' },
  { value: 'NOT_APPLICABLE', label: 'N/A', tone: 'neutral' },
];

const control = fieldControlClassName;

export default function InspectionRunner({ inspectionId, editable, canRaiseFindings, adHoc, checklist, responses, findings, findingFields }: Props) {
  const byKey = new Map(responses.map(r => [r.item_key, r]));
  // Ad hoc inspections: the items ARE the responses recorded so far.
  const items: ChecklistItem[] = adHoc
    ? responses.map(r => ({ key: r.item_key, label: r.item_label, responseType: r.response_type, guidance: null, required: false, options: [], section: null }))
    : checklist;
  const answered = items.filter(i => byKey.has(i.key)).length;
  const failed = responses.filter(r => r.outcome === 'FAIL').length;

  return (
    <div className={styles.stackTight}>
      <div className={styles.runnerSummary}>
        {answered} of {items.length} item{items.length === 1 ? '' : 's'} answered
        {failed > 0 && <span className={styles.outcomeText} data-tone="danger"> · {failed} failed</span>}
      </div>
      {items.length === 0 && (
        <div className={styles.dim} style={{ fontSize: 13, padding: '18px 0' }}>
          {adHoc ? 'No items recorded yet. Add the first item below.' : 'This template version has no readable checklist items.'}
        </div>
      )}
      <ol className={styles.runnerList}>
        {items.map((item, idx) => (
          <Fragment key={item.key}>
            {item.section && item.section !== items[idx - 1]?.section && (
              <li className={styles.runnerSection}><h3>{item.section}</h3></li>
            )}
            <ItemRow
              index={idx}
              item={item}
              response={byKey.get(item.key) ?? null}
              inspectionId={inspectionId}
              editable={editable}
              adHoc={adHoc}
              canRaiseFindings={canRaiseFindings}
              findings={findings.filter(f => f.source_item_key === item.key)}
              findingFields={findingFields}
            />
          </Fragment>
        ))}
      </ol>
      {editable && adHoc && <AddAdHocItem inspectionId={inspectionId} />}
    </div>
  );
}

function ItemRow({ index, item, response, inspectionId, editable, adHoc, canRaiseFindings, findings, findingFields }: {
  index: number; item: ChecklistItem; response: RunnerResponse | null; inspectionId: string; editable: boolean; adHoc: boolean;
  canRaiseFindings: boolean; findings: RunnerFinding[]; findingFields: FormField[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<InspectionOutcome | ''>(response?.outcome ?? '');
  const [value, setValue] = useState<string>(displayValue(response?.response_value));
  const [notes, setNotes] = useState(response?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showEditor = editable && (editing || !response);
  const needsValue = item.responseType !== 'PASS_FAIL';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { itemKey: item.key, outcome: outcome || null, notes: notes || null };
      if (needsValue) body.value = item.responseType === 'MULTI_CHOICE' ? value.split(',').map(s => s.trim()).filter(Boolean) : value || null;
      if (adHoc) { body.itemLabel = item.label; body.responseType = item.responseType; }
      const res = await fetch(`/api/assurance/inspections/${inspectionId}/responses`, {
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

  const outcomeStyle = OUTCOMES.find(o => o.value === response?.outcome);
  const raisable = canRaiseFindings && response && (response.outcome === 'FAIL' || response.outcome === 'OBSERVATION');

  return (
    <li className={styles.runnerItem} data-tone={outcomeStyle?.tone}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.runnerLabel}>
            {index + 1}. {item.label}
            {item.required && !adHoc && <span className={styles.runnerRequired}> · required</span>}
          </div>
          {item.guidance && <div className={styles.runnerGuidance}>{item.guidance}</div>}
          <div className={styles.runnerMeta}>{assuranceLabel(item.responseType)}{item.options.length > 0 ? ` · ${item.options.join(' / ')}` : ''}</div>
        </div>
        {response && !showEditor && (
          <div style={{ textAlign: 'right' }}>
            {response.outcome && <span className={styles.outcomeLabel} data-tone={outcomeStyle?.tone}>{assuranceLabel(response.outcome)}</span>}
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
          <div role="radiogroup" aria-label={`Outcome for ${item.label}`} className={styles.row} style={{ gap: 6 }}>
            {OUTCOMES.map(o => (
              <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} onClick={() => setOutcome(o.value)} className={styles.outcomeChip} data-tone={o.tone}>
                {o.label}
              </button>
            ))}
          </div>
          {needsValue && <ValueInput type={item.responseType} options={item.options} value={value} onChange={setValue} label={item.label} />}
          <textarea aria-label={`Notes for ${item.label}`} placeholder={outcome === 'FAIL' ? 'Describe the failure (required)' : 'Notes (optional)'}
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

      {(findings.length > 0 || raisable || (editable && response && !showEditor)) && (
        <div className={styles.row} style={{ marginTop: 10 }}>
          {findings.map(f => (
            <Link key={f.id} href={`/assurance/findings/${f.id}`} className={styles.refChip} style={{ fontFamily: 'inherit', fontSize: '0.75rem', padding: '4px 8px' }}>
              Finding {f.finding_reference} · {assuranceLabel(f.status)}
            </Link>
          ))}
          {editable && response && !showEditor && (
            <Button size="sm" onClick={() => setEditing(true)}>Revise</Button>
          )}
          {raisable && (
            <ActionPanel
              label={findings.length > 0 ? 'Raise another finding' : 'Raise finding'}
              endpoint="/api/assurance/findings"
              variant="primary"
              extraBody={{ inspectionId, inspectionItemKey: item.key }}
              fields={withDefaults(findingFields, item, response)}
              submitLabel="Raise finding"
              redirectTo="/assurance/findings/{id}"
              description="The finding is linked to this inspection and this checklist item. The inspection record itself is not changed."
            />
          )}
        </div>
      )}
    </li>
  );
}

function withDefaults(fields: FormField[], item: ChecklistItem, response: RunnerResponse): FormField[] {
  return fields.map(f => {
    if (f.kind === 'select' && f.name === 'findingType') return { ...f, defaultValue: response.outcome === 'FAIL' ? 'DEFECT' : 'OBSERVATION' };
    if (f.kind === 'text' && f.name === 'title') return { ...f, defaultValue: item.label };
    if (f.kind === 'textarea' && f.name === 'description') return { ...f, defaultValue: response.notes ?? '' };
    return f;
  });
}

function ValueInput({ type, options, value, onChange, label }: { type: InspectionResponseType; options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  if (type === 'NUMBER') return <input aria-label={`Value for ${label}`} type="number" step="any" value={value} onChange={e => onChange(e.target.value)} className={control} />;
  if (type === 'DATE') return <input aria-label={`Value for ${label}`} type="date" value={value} onChange={e => onChange(e.target.value)} className={control} />;
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
  return <input aria-label={`Value for ${label}`} type="text" value={value} onChange={e => onChange(e.target.value)}
    placeholder={type === 'MULTI_CHOICE' ? 'Comma-separated' : 'Response'} className={control} />;
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function AddAdHocItem({ inspectionId }: { inspectionId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<InspectionResponseType>('PASS_FAIL');
  const [outcome, setOutcome] = useState<InspectionOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setError(null);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
    const itemKey = `adhoc-${slug}-${Math.random().toString(36).slice(2, 8)}`;
    setBusy(true);
    try {
      const res = await fetch(`/api/assurance/inspections/${inspectionId}/responses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemKey, itemLabel: label, responseType: type, outcome: outcome || null, notes: notes || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not add the item.'); return; }
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
      <div className={styles.legend} style={{ margin: 0 }}>Add an item</div>
      <input aria-label="Item" placeholder="What was checked?" value={label} onChange={e => setLabel(e.target.value)} className={control} />
      <div className={styles.row}>
        <select aria-label="Response type" value={type} onChange={e => setType(e.target.value as InspectionResponseType)} className={control} style={{ width: 'auto' }}>
          {INSPECTION_RESPONSE_TYPES.filter(t => t === 'PASS_FAIL' || t === 'TEXT' || t === 'NUMBER').map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
        </select>
        <select aria-label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value as InspectionOutcome | '')} className={control} style={{ width: 'auto' }}>
          <option value="">Outcome…</option>
          {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <textarea aria-label="Notes" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={control} />
      {error && <div role="alert" className={styles.actionError}>{error}</div>}
      <div>
        <Button variant="primary" onClick={add} disabled={busy || !label.trim()} aria-busy={busy || undefined}>
          {busy ? 'Adding…' : 'Add item'}
        </Button>
      </div>
    </div>
  );
}
