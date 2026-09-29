'use client';
import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUDIT_RESPONSE_TYPES, AUDIT_TYPES, INSPECTION_RESPONSE_TYPES, INSPECTION_TYPES, assuranceLabel,
} from '@/lib/assurance/domain';

// Builds the checklist (inspections) or criteria (audits) for a NEW
// template, or a NEW version of an existing template. It never edits an
// existing version: the database forbids it and there is no route for it.

type DraftItem = { label: string; responseType: string; guidance: string; required: boolean; options: string };

type Variant = 'inspection' | 'audit';

type Props =
  | { variant?: Variant; mode: 'template'; initialItems?: undefined; templateId?: undefined; defaultTitle?: undefined; defaultStandard?: undefined }
  | { variant?: Variant; mode: 'version'; templateId: string; initialItems: DraftItem[]; defaultTitle: string; defaultStandard?: string };

const CONFIG = {
  inspection: {
    types: INSPECTION_TYPES as readonly string[],
    responseTypes: (INSPECTION_RESPONSE_TYPES as readonly string[]).filter(t => t !== 'OTHER'),
    defaultResponseType: 'PASS_FAIL',
    multiOptionTypes: ['CHOICE', 'MULTI_CHOICE'],
    itemNoun: 'item',
    listLegend: 'Checklist items',
    itemPlaceholder: 'What should be checked?',
    templateEndpoint: '/api/assurance/templates',
    versionEndpoint: (id: string) => `/api/assurance/templates/${id}/versions`,
    detailPath: (id: string) => `/assurance/inspections/templates/${id}`,
    typeKey: 'inspectionType',
    itemsKey: 'items',
    typeLabel: 'Inspection type',
  },
  audit: {
    types: AUDIT_TYPES as readonly string[],
    responseTypes: (AUDIT_RESPONSE_TYPES as readonly string[]).filter(t => t !== 'OTHER'),
    defaultResponseType: 'COMPLIANCE_RATING',
    multiOptionTypes: ['CHOICE'],
    itemNoun: 'criterion',
    listLegend: 'Criteria',
    itemPlaceholder: 'What does the standard require?',
    templateEndpoint: '/api/assurance/audit-templates',
    versionEndpoint: (id: string) => `/api/assurance/audit-templates/${id}/versions`,
    detailPath: (id: string) => `/assurance/audits/templates/${id}`,
    typeKey: 'auditType',
    itemsKey: 'criteria',
    typeLabel: 'Audit type',
  },
} as const;

const control: CSSProperties = { padding: '8px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const label: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 };
const smallBtn: CSSProperties = { padding: '4px 9px', borderRadius: 6, fontSize: 12, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' };

export default function ChecklistBuilder(props: Props) {
  const variant: Variant = props.variant ?? 'inspection';
  const cfg = CONFIG[variant];
  const blank = (): DraftItem => ({ label: '', responseType: cfg.defaultResponseType, guidance: '', required: true, options: '' });
  const router = useRouter();
  const [name, setName] = useState('');
  const [title, setTitle] = useState(props.mode === 'version' ? props.defaultTitle : '');
  const [type, setType] = useState<string>(cfg.types[0]);
  const [description, setDescription] = useState('');
  const [standard, setStandard] = useState(props.mode === 'version' ? props.defaultStandard ?? '' : '');
  const [instructions, setInstructions] = useState('');
  const [items, setItems] = useState<DraftItem[]>(props.mode === 'version' && props.initialItems.length > 0 ? props.initialItems : [blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = cfg.itemNoun;

  const update = (i: number, patch: Partial<DraftItem>) => setItems(list => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => setItems(list => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  async function submit() {
    setError(null);
    setBusy(true);
    const payloadItems = items.map(it => ({
      label: it.label, responseType: it.responseType, guidance: it.guidance || null, required: it.required,
      options: it.options.split(',').map(s => s.trim()).filter(Boolean),
    }));
    const endpoint = props.mode === 'template' ? cfg.templateEndpoint : cfg.versionEndpoint(props.templateId);
    const body: Record<string, unknown> = props.mode === 'template'
      ? { name, [cfg.typeKey]: type, description: description || null, instructions: instructions || null, [cfg.itemsKey]: payloadItems }
      : { title, instructions: instructions || null, [cfg.itemsKey]: payloadItems };
    if (variant === 'audit') body.standardReference = standard || null;
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not save.'); return; }
      if (props.mode === 'template') router.push(cfg.detailPath(String(data.id)));
      else router.refresh();
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {props.mode === 'template' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div><label htmlFor="tpl-name" style={label}>Template name *</label><input id="tpl-name" value={name} onChange={e => setName(e.target.value)} style={control} /></div>
          <div>
            <label htmlFor="tpl-type" style={label}>{cfg.typeLabel} *</label>
            <select id="tpl-type" value={type} onChange={e => setType(e.target.value)} style={control}>
              {cfg.types.map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label htmlFor="tpl-desc" style={label}>Description</label><input id="tpl-desc" value={description} onChange={e => setDescription(e.target.value)} style={control} /></div>
        </div>
      ) : (
        <div><label htmlFor="ver-title" style={label}>Version title *</label><input id="ver-title" value={title} onChange={e => setTitle(e.target.value)} style={control} /></div>
      )}
      {variant === 'audit' && (
        <div>
          <label htmlFor="tpl-standard" style={label}>Standard / reference</label>
          <input id="tpl-standard" value={standard} onChange={e => setStandard(e.target.value)} placeholder="e.g. Waste Operations Procedure v3, ISO 45001 cl. 8.1" style={control} />
        </div>
      )}
      <div><label htmlFor="tpl-instr" style={label}>Instructions</label><textarea id="tpl-instr" value={instructions} onChange={e => setInstructions(e.target.value)} rows={2} style={{ ...control, resize: 'vertical' }} /></div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        <legend style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>{cfg.listLegend}</legend>
        {items.map((it, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 22 }}>{i + 1}.</span>
              <input aria-label={`${noun} ${i + 1} label`} placeholder={cfg.itemPlaceholder} value={it.label} onChange={e => update(i, { label: e.target.value })} style={control} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label={`${noun} ${i + 1} response type`} value={it.responseType} onChange={e => update(i, { responseType: e.target.value })} style={{ ...control, width: 'auto' }}>
                {cfg.responseTypes.map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
              </select>
              {(cfg.multiOptionTypes as readonly string[]).includes(it.responseType) && (
                <input aria-label={`${noun} ${i + 1} options`} placeholder="Options, comma-separated" value={it.options} onChange={e => update(i, { options: e.target.value })} style={{ ...control, width: 240 }} />
              )}
              <label style={{ fontSize: 12, display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={it.required} onChange={e => update(i, { required: e.target.checked })} /> Required
              </label>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button type="button" aria-label={`Move ${noun} ${i + 1} up`} onClick={() => move(i, -1)} style={smallBtn}>↑</button>
                <button type="button" aria-label={`Move ${noun} ${i + 1} down`} onClick={() => move(i, 1)} style={smallBtn}>↓</button>
                <button type="button" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => setItems(list => list.length > 1 ? list.filter((_, j) => j !== i) : list)} style={smallBtn}>Remove</button>
              </span>
            </div>
            <input aria-label={`${noun} ${i + 1} guidance`} placeholder={variant === 'audit' ? 'What evidence satisfies this criterion? (optional)' : 'Guidance for the inspector (optional)'} value={it.guidance} onChange={e => update(i, { guidance: e.target.value })} style={control} />
          </div>
        ))}
        <div><button type="button" onClick={() => setItems(list => [...list, blank()])} style={smallBtn}>+ Add {noun}</button></div>
      </fieldset>

      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--bb-danger)', background: 'var(--bb-danger-soft)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
      <div>
        <button type="button" onClick={submit} disabled={busy}
          style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--purple-600)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : props.mode === 'template' ? 'Create template (version 1)' : 'Publish new version'}
        </button>
      </div>
    </div>
  );
}
