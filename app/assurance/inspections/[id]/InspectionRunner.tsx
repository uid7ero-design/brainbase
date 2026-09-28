'use client';
import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  INSPECTION_RESPONSE_TYPES, assuranceLabel, formatAssuranceDateTime,
  type ChecklistItem, type InspectionOutcome, type InspectionResponseType,
} from '@/lib/assurance/domain';
import ActionPanel from '../../_components/ActionPanel';
import type { FormField } from '../../_components/AssuranceForm';

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

const OUTCOMES: { value: InspectionOutcome; label: string; color: string }[] = [
  { value: 'PASS', label: 'Pass', color: 'var(--bb-success)' },
  { value: 'FAIL', label: 'Fail', color: 'var(--bb-danger)' },
  { value: 'OBSERVATION', label: 'Observation', color: 'var(--bb-warning)' },
  { value: 'NOT_APPLICABLE', label: 'N/A', color: 'var(--text-secondary)' },
];

const control: CSSProperties = { padding: '8px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };

export default function InspectionRunner({ inspectionId, editable, canRaiseFindings, adHoc, checklist, responses, findings, findingFields }: Props) {
  const byKey = new Map(responses.map(r => [r.item_key, r]));
  // Ad hoc inspections: the items ARE the responses recorded so far.
  const items: ChecklistItem[] = adHoc
    ? responses.map(r => ({ key: r.item_key, label: r.item_label, responseType: r.response_type, guidance: null, required: false, options: [] }))
    : checklist;
  const answered = items.filter(i => byKey.has(i.key)).length;
  const failed = responses.filter(r => r.outcome === 'FAIL').length;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {answered} of {items.length} item{items.length === 1 ? '' : 's'} answered
        {failed > 0 && <span style={{ color: 'var(--bb-danger)', fontWeight: 600 }}> · {failed} failed</span>}
      </div>
      {items.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 0' }}>
          {adHoc ? 'No items recorded yet. Add the first item below.' : 'This template version has no readable checklist items.'}
        </div>
      )}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {items.map((item, idx) => (
          <ItemRow
            key={item.key}
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
    <li style={{ border: '1px solid var(--border)', borderLeft: `3px solid ${outcomeStyle?.color ?? 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {index + 1}. {item.label}
            {item.required && !adHoc && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> · required</span>}
          </div>
          {item.guidance && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{item.guidance}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{assuranceLabel(item.responseType)}{item.options.length > 0 ? ` · ${item.options.join(' / ')}` : ''}</div>
        </div>
        {response && !showEditor && (
          <div style={{ textAlign: 'right' }}>
            {response.outcome && <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: outcomeStyle?.color }}>{assuranceLabel(response.outcome)}</span>}
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
          <div role="radiogroup" aria-label={`Outcome for ${item.label}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {OUTCOMES.map(o => (
              <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} onClick={() => setOutcome(o.value)}
                style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${outcome === o.value ? o.color : 'var(--border)'}`,
                  background: outcome === o.value ? `color-mix(in srgb, ${o.color} 14%, transparent)` : 'transparent',
                  color: outcome === o.value ? o.color : 'var(--text-secondary)' }}>
                {o.label}
              </button>
            ))}
          </div>
          {needsValue && <ValueInput type={item.responseType} options={item.options} value={value} onChange={setValue} label={item.label} />}
          <textarea aria-label={`Notes for ${item.label}`} placeholder={outcome === 'FAIL' ? 'Describe the failure (required)' : 'Notes (optional)'}
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

      {(findings.length > 0 || raisable || (editable && response && !showEditor)) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {findings.map(f => (
            <Link key={f.id} href={`/assurance/findings/${f.id}`} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-primary)', textDecoration: 'none' }}>
              Finding {f.finding_reference} · {assuranceLabel(f.status)}
            </Link>
          ))}
          {editable && response && !showEditor && (
            <button type="button" onClick={() => setEditing(true)} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>Revise</button>
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
  if (type === 'NUMBER') return <input aria-label={`Value for ${label}`} type="number" step="any" value={value} onChange={e => onChange(e.target.value)} style={control} />;
  if (type === 'DATE') return <input aria-label={`Value for ${label}`} type="date" value={value} onChange={e => onChange(e.target.value)} style={control} />;
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
  return <input aria-label={`Value for ${label}`} type="text" value={value} onChange={e => onChange(e.target.value)}
    placeholder={type === 'MULTI_CHOICE' ? 'Comma-separated' : 'Response'} style={control} />;
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
    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 14, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Add an item</div>
      <input aria-label="Item" placeholder="What was checked?" value={label} onChange={e => setLabel(e.target.value)} style={control} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Response type" value={type} onChange={e => setType(e.target.value as InspectionResponseType)} style={{ ...control, width: 'auto' }}>
          {INSPECTION_RESPONSE_TYPES.filter(t => t === 'PASS_FAIL' || t === 'TEXT' || t === 'NUMBER').map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
        </select>
        <select aria-label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value as InspectionOutcome | '')} style={{ ...control, width: 'auto' }}>
          <option value="">Outcome…</option>
          {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <textarea aria-label="Notes" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...control, resize: 'vertical' }} />
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--bb-danger)' }}>{error}</div>}
      <div>
        <button type="button" onClick={add} disabled={busy || !label.trim()}
          style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--purple-600)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy || !label.trim() ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add item'}
        </button>
      </div>
    </div>
  );
}
