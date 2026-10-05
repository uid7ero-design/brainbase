'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUDIT_RESPONSE_TYPES, AUDIT_TYPES, INSPECTION_RESPONSE_TYPES, INSPECTION_TYPES, TEMPLATE_KINDS,
  assuranceLabel, groupTemplateSections, type TemplateKind,
} from '@/lib/assurance/domain';
import { Button, Field, FormError, fieldControlClassName } from '@/components/ui/app';
import styles from './assurance.module.css';

// Edits the content of a DRAFT template version (or creates a template whose
// version 1 is a draft). Published and retired versions are never edited:
// the database forbids it and there is no route for it. Publishing is a
// separate, server-validated step that only applies to saved content.

type DraftItem = { label: string; responseType: string; guidance: string; required: boolean; options: string };
type DraftSection = { title: string; items: DraftItem[] };

export type EditorItem = { label: string; responseType: string; guidance: string | null; required: boolean; options: string[]; section: string | null };

type Identity = { name: string; templateType: string; description: string };

type Props =
  | { mode: 'create'; initialKind?: TemplateKind }
  | {
      mode: 'draft';
      kind: TemplateKind;
      templateId: string;
      versionId: string;
      versionNumber: number;
      lockVersion: number;
      /** Present only while the template has never been published. */
      identity: Identity | null;
      title: string;
      instructions: string | null;
      standardReference: string | null;
      items: EditorItem[];
      /** The published version publishing would retire, if any. */
      replacesVersionNumber: number | null;
    };

const CONFIG = {
  inspection: {
    types: INSPECTION_TYPES as readonly string[],
    responseTypes: (INSPECTION_RESPONSE_TYPES as readonly string[]).filter(t => t !== 'OTHER'),
    defaultResponseType: 'PASS_FAIL',
    multiOptionTypes: ['CHOICE', 'MULTI_CHOICE'],
    itemNoun: 'item',
    listLegend: 'Checklist',
    itemPlaceholder: 'What should be checked?',
    guidancePlaceholder: 'Guidance for the inspector (optional)',
    typeLabel: 'Inspection type',
    recordNoun: 'inspections',
  },
  audit: {
    types: AUDIT_TYPES as readonly string[],
    responseTypes: (AUDIT_RESPONSE_TYPES as readonly string[]).filter(t => t !== 'OTHER'),
    defaultResponseType: 'COMPLIANCE_RATING',
    multiOptionTypes: ['CHOICE'],
    itemNoun: 'criterion',
    listLegend: 'Criteria',
    itemPlaceholder: 'What does the standard require?',
    guidancePlaceholder: 'What evidence satisfies this criterion? (optional)',
    typeLabel: 'Audit type',
    recordNoun: 'audits',
  },
} as const;

function toSections(items: EditorItem[], blank: () => DraftItem): DraftSection[] {
  if (items.length === 0) return [{ title: '', items: [blank()] }];
  return groupTemplateSections(items).map(g => ({
    title: g.title ?? '',
    items: g.items.map(it => ({ label: it.label, responseType: it.responseType, guidance: it.guidance ?? '', required: it.required, options: it.options.join(', ') })),
  }));
}

export default function TemplateEditor(props: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<TemplateKind>(props.mode === 'draft' ? props.kind : props.initialKind ?? 'inspection');
  const cfg = CONFIG[kind];
  const blank = (): DraftItem => ({ label: '', responseType: cfg.defaultResponseType, guidance: '', required: true, options: '' });

  const initialIdentity: Identity | null = props.mode === 'create' ? { name: '', templateType: '', description: '' } : props.identity;
  const [identity, setIdentity] = useState<Identity | null>(initialIdentity);
  const [title, setTitle] = useState(props.mode === 'draft' ? props.title : '');
  const [instructions, setInstructions] = useState(props.mode === 'draft' ? props.instructions ?? '' : '');
  const [standard, setStandard] = useState(props.mode === 'draft' ? props.standardReference ?? '' : '');
  const [sections, setSections] = useState<DraftSection[]>(() => toSections(props.mode === 'draft' ? props.items : [], blank));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'publish'>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = cfg.itemNoun;
  const touch = () => { setDirty(true); setConfirmPublish(false); };

  const numbering = useMemo(() => {
    let n = 0;
    return sections.map(s => s.items.map(() => ++n));
  }, [sections]);

  const updateItem = (si: number, ii: number, patch: Partial<DraftItem>) => {
    touch();
    setSections(list => list.map((s, j) => (j === si ? { ...s, items: s.items.map((it, k) => (k === ii ? { ...it, ...patch } : it)) } : s)));
  };
  const moveItem = (si: number, ii: number, d: -1 | 1) => {
    touch();
    setSections(list => list.map((s, j) => {
      if (j !== si) return s;
      const k = ii + d;
      if (k < 0 || k >= s.items.length) return s;
      const items = [...s.items];
      [items[ii], items[k]] = [items[k], items[ii]];
      return { ...s, items };
    }));
  };
  const removeItem = (si: number, ii: number) => {
    touch();
    setSections(list => {
      const total = list.reduce((n, s) => n + s.items.length, 0);
      if (total <= 1) return list;
      const next = list.map((s, j) => (j === si ? { ...s, items: s.items.filter((_, k) => k !== ii) } : s));
      return next.filter(s => s.items.length > 0);
    });
  };
  const moveSection = (si: number, d: -1 | 1) => {
    touch();
    setSections(list => {
      const j = si + d;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[si], copy[j]] = [copy[j], copy[si]];
      return copy;
    });
  };

  function payloadItems() {
    return sections.flatMap(s => s.items.map(it => ({
      label: it.label, responseType: it.responseType, guidance: it.guidance || null, required: it.required,
      options: it.options.split(',').map(o => o.trim()).filter(Boolean),
      section: s.title.trim() || null,
    })));
  }

  async function post(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not save.'); return null; }
    return data as Record<string, unknown>;
  }

  async function save() {
    setError(null);
    setBusy('save');
    try {
      const content = {
        kind, title: title || (identity?.name ?? ''), instructions: instructions || null, items: payloadItems(),
        ...(kind === 'audit' ? { standardReference: standard || null } : {}),
      };
      if (props.mode === 'create') {
        const data = await post('/api/assurance/templates', {
          ...content, name: identity?.name ?? '', templateType: identity?.templateType ?? '', description: identity?.description || null,
        });
        if (data) router.push(`/assurance/templates/${kind}/${String(data.id)}`);
      } else {
        const data = await post(`/api/assurance/templates/${props.templateId}/draft`, {
          ...content, versionId: props.versionId, lockVersion: props.lockVersion,
          ...(identity ? { name: identity.name, templateType: identity.templateType, description: identity.description || null } : {}),
        });
        if (data) { setDirty(false); router.refresh(); }
      }
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (props.mode !== 'draft') return;
    setError(null);
    setBusy('publish');
    try {
      const data = await post(`/api/assurance/templates/${props.templateId}/publish`, {
        kind, versionId: props.versionId, lockVersion: props.lockVersion,
      });
      if (data) { setConfirmPublish(false); router.refresh(); }
    } catch {
      setError('Network error. Nothing was published.');
    } finally {
      setBusy(null);
    }
  }

  const control = fieldControlClassName;
  const setId = (patch: Partial<Identity>) => { touch(); setIdentity(i => (i ? { ...i, ...patch } : i)); };

  return (
    <div className={styles.form}>
      {props.mode === 'create' && (
        <Field id="tpl-kind" label="Template for" required>
          {c => (
            <select {...c} value={kind} onChange={e => { setKind(e.target.value as TemplateKind); setIdentity(i => (i ? { ...i, templateType: '' } : i)); setSections([{ title: '', items: [{ label: '', responseType: CONFIG[e.target.value as TemplateKind].defaultResponseType, guidance: '', required: true, options: '' }] }]); }} className={control}>
              {TEMPLATE_KINDS.map(k => <option key={k} value={k}>{k === 'inspection' ? 'Inspections' : 'Audits'}</option>)}
            </select>
          )}
        </Field>
      )}
      {identity && (
        <div className={styles.formGrid}>
          <Field id="tpl-name" label="Template name" required>
            {c => <input {...c} value={identity.name} onChange={e => setId({ name: e.target.value })} className={control} />}
          </Field>
          <Field id="tpl-type" label={cfg.typeLabel} required>
            {c => (
              <select {...c} value={identity.templateType} onChange={e => setId({ templateType: e.target.value })} className={control}>
                <option value="">Choose…</option>
                {cfg.types.map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
              </select>
            )}
          </Field>
          <Field id="tpl-desc" label="Description" className={styles.spanAll}>
            {c => <input {...c} value={identity.description} onChange={e => setId({ description: e.target.value })} className={control} />}
          </Field>
        </div>
      )}
      {props.mode === 'draft' && (
        <Field id="ver-title" label="Version title" required>
          {c => <input {...c} value={title} onChange={e => { touch(); setTitle(e.target.value); }} className={control} />}
        </Field>
      )}
      {kind === 'audit' && (
        <Field id="tpl-standard" label="Standard / reference">
          {c => <input {...c} value={standard} onChange={e => { touch(); setStandard(e.target.value); }} placeholder="e.g. Waste Operations Procedure v3, ISO 45001 cl. 8.1" className={control} />}
        </Field>
      )}
      <Field id="tpl-instr" label="Instructions">
        {c => <textarea {...c} value={instructions} onChange={e => { touch(); setInstructions(e.target.value); }} rows={2} className={control} />}
      </Field>

      <div className={styles.legend}>{cfg.listLegend}</div>
      {sections.map((s, si) => (
        <fieldset key={si} className={styles.fieldset}>
          <legend className="bb-visually-hidden">{s.title.trim() ? `Section: ${s.title}` : `Section ${si + 1}`}</legend>
          <div className={styles.row} style={{ alignItems: 'center' }}>
            <input aria-label={`Section ${si + 1} heading`} placeholder={sections.length > 1 ? `Section ${si + 1} heading` : 'Section heading (optional)'}
              value={s.title} onChange={e => { touch(); const v = e.target.value; setSections(list => list.map((x, j) => (j === si ? { ...x, title: v } : x))); }}
              className={control} style={{ flex: '1 1 180px', minWidth: 0 }} />
            {sections.length > 1 && (
              <span className={styles.row} style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" aria-label={`Move section ${si + 1} up`} onClick={() => moveSection(si, -1)}>↑</Button>
                <Button size="sm" variant="ghost" aria-label={`Move section ${si + 1} down`} onClick={() => moveSection(si, 1)}>↓</Button>
              </span>
            )}
          </div>
          {s.items.map((it, ii) => {
            const n = numbering[si][ii];
            return (
              <div key={ii} className={styles.itemCard}>
                <div className={styles.row} style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
                  <span className={styles.itemIndex}>{n}.</span>
                  <input aria-label={`${noun} ${n} label`} placeholder={cfg.itemPlaceholder} value={it.label} onChange={e => updateItem(si, ii, { label: e.target.value })} className={control} style={{ minWidth: 0 }} />
                </div>
                <div className={styles.row} style={{ alignItems: 'center' }}>
                  <select aria-label={`${noun} ${n} response type`} value={it.responseType} onChange={e => updateItem(si, ii, { responseType: e.target.value })} className={control} style={{ width: 'auto', maxWidth: '100%' }}>
                    {cfg.responseTypes.map(t => <option key={t} value={t}>{assuranceLabel(t)}</option>)}
                  </select>
                  {(cfg.multiOptionTypes as readonly string[]).includes(it.responseType) && (
                    <input aria-label={`${noun} ${n} options`} placeholder="Options, comma-separated" value={it.options} onChange={e => updateItem(si, ii, { options: e.target.value })} className={control} style={{ width: 240, maxWidth: '100%' }} />
                  )}
                  <label className={styles.inlineCheck}>
                    <input type="checkbox" checked={it.required} onChange={e => updateItem(si, ii, { required: e.target.checked })} /> Required
                  </label>
                  <span className={styles.row} style={{ marginLeft: 'auto', gap: 4 }}>
                    <Button size="sm" variant="ghost" aria-label={`Move ${noun} ${n} up`} onClick={() => moveItem(si, ii, -1)}>↑</Button>
                    <Button size="sm" variant="ghost" aria-label={`Move ${noun} ${n} down`} onClick={() => moveItem(si, ii, 1)}>↓</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${noun} ${n}`} onClick={() => removeItem(si, ii)}>Remove</Button>
                  </span>
                </div>
                <input aria-label={`${noun} ${n} guidance`} placeholder={cfg.guidancePlaceholder} value={it.guidance} onChange={e => updateItem(si, ii, { guidance: e.target.value })} className={control} />
              </div>
            );
          })}
          <div>
            <Button size="sm" onClick={() => { touch(); setSections(list => list.map((x, j) => (j === si ? { ...x, items: [...x.items, blank()] } : x))); }}>
              + Add {noun}{sections.length > 1 ? ' to this section' : ''}
            </Button>
          </div>
        </fieldset>
      ))}
      <div><Button size="sm" variant="ghost" onClick={() => { touch(); setSections(list => [...list, { title: '', items: [blank()] }]); }}>+ Add section</Button></div>

      {error && <FormError>{error}</FormError>}
      <div className={styles.row} style={{ alignItems: 'center' }}>
        <Button variant={props.mode === 'create' ? 'primary' : 'secondary'} onClick={save} disabled={busy !== null} aria-busy={busy === 'save' || undefined}>
          {busy === 'save' ? 'Saving…' : props.mode === 'create' ? 'Create draft template' : 'Save draft'}
        </Button>
        {props.mode === 'draft' && !confirmPublish && (
          <Button variant="primary" onClick={() => setConfirmPublish(true)} disabled={busy !== null || dirty}>
            Publish version {props.versionNumber}
          </Button>
        )}
        {props.mode === 'draft' && dirty && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Save the draft before publishing.</span>}
      </div>
      {props.mode === 'draft' && confirmPublish && (
        <div className={styles.disclosure} role="group" aria-label={`Confirm: publish version ${props.versionNumber}`}>
          <div className={styles.disclosureText}>
            Version {props.versionNumber} becomes the version offered when planning new {cfg.recordNoun}, and its wording can no longer change.
            {props.replacesVersionNumber !== null
              ? ` Version ${props.replacesVersionNumber} is retired; ${cfg.recordNoun} already using it keep it exactly as it is.`
              : ''}
          </div>
          <div className={styles.row}>
            <Button variant="primary" onClick={publish} disabled={busy !== null} aria-busy={busy === 'publish' || undefined}>
              {busy === 'publish' ? 'Publishing…' : `Confirm — publish version ${props.versionNumber}`}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmPublish(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
