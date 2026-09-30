'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUDIT_RESPONSE_TYPES, AUDIT_TYPES, INSPECTION_RESPONSE_TYPES, INSPECTION_TYPES, assuranceLabel,
} from '@/lib/assurance/domain';
import { Button, Field, FormError, fieldControlClassName } from '@/components/ui/app';
import styles from './assurance.module.css';

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

  const control = fieldControlClassName;
  return (
    <div className={styles.form}>
      {props.mode === 'template' ? (
        <div className={styles.formGrid}>
          <Field id="tpl-name" label="Template name" required>
            {c => <input {...c} value={name} onChange={e => setName(e.target.value)} className={control} />}
          </Field>
          <Field id="tpl-type" label={cfg.typeLabel} required>
            {c => (
              <select {...c} value={type} onChange={e => setType(e.target.value)} className={control}>
                {cfg.types.map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
              </select>
            )}
          </Field>
          <Field id="tpl-desc" label="Description" className={styles.spanAll}>
            {c => <input {...c} value={description} onChange={e => setDescription(e.target.value)} className={control} />}
          </Field>
        </div>
      ) : (
        <Field id="ver-title" label="Version title" required>
          {c => <input {...c} value={title} onChange={e => setTitle(e.target.value)} className={control} />}
        </Field>
      )}
      {variant === 'audit' && (
        <Field id="tpl-standard" label="Standard / reference">
          {c => <input {...c} value={standard} onChange={e => setStandard(e.target.value)} placeholder="e.g. Waste Operations Procedure v3, ISO 45001 cl. 8.1" className={control} />}
        </Field>
      )}
      <Field id="tpl-instr" label="Instructions">
        {c => <textarea {...c} value={instructions} onChange={e => setInstructions(e.target.value)} rows={2} className={control} />}
      </Field>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{cfg.listLegend}</legend>
        {items.map((it, i) => (
          <div key={i} className={styles.itemCard}>
            <div className={styles.row} style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
              <span className={styles.itemIndex}>{i + 1}.</span>
              <input aria-label={`${noun} ${i + 1} label`} placeholder={cfg.itemPlaceholder} value={it.label} onChange={e => update(i, { label: e.target.value })} className={control} />
            </div>
            <div className={styles.row} style={{ alignItems: 'center' }}>
              <select aria-label={`${noun} ${i + 1} response type`} value={it.responseType} onChange={e => update(i, { responseType: e.target.value })} className={control} style={{ width: 'auto' }}>
                {cfg.responseTypes.map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
              </select>
              {(cfg.multiOptionTypes as readonly string[]).includes(it.responseType) && (
                <input aria-label={`${noun} ${i + 1} options`} placeholder="Options, comma-separated" value={it.options} onChange={e => update(i, { options: e.target.value })} className={control} style={{ width: 240, maxWidth: '100%' }} />
              )}
              <label className={styles.inlineCheck}>
                <input type="checkbox" checked={it.required} onChange={e => update(i, { required: e.target.checked })} /> Required
              </label>
              <span className={styles.row} style={{ marginLeft: 'auto', gap: 4 }}>
                <Button size="sm" variant="ghost" aria-label={`Move ${noun} ${i + 1} up`} onClick={() => move(i, -1)}>↑</Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${noun} ${i + 1} down`} onClick={() => move(i, 1)}>↓</Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => setItems(list => list.length > 1 ? list.filter((_, j) => j !== i) : list)}>Remove</Button>
              </span>
            </div>
            <input aria-label={`${noun} ${i + 1} guidance`} placeholder={variant === 'audit' ? 'What evidence satisfies this criterion? (optional)' : 'Guidance for the inspector (optional)'} value={it.guidance} onChange={e => update(i, { guidance: e.target.value })} className={control} />
          </div>
        ))}
        <div><Button size="sm" onClick={() => setItems(list => [...list, blank()])}>+ Add {noun}</Button></div>
      </fieldset>

      {error && <FormError>{error}</FormError>}
      <div>
        <Button variant="primary" onClick={submit} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Saving…' : props.mode === 'template' ? 'Create template (version 1)' : 'Publish new version'}
        </Button>
      </div>
    </div>
  );
}
