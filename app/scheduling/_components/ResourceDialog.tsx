'use client';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, FormActions, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import { buildResourceCreate, buildResourceEdit, emptyResourceValues, valuesFromResource, type ResourceFormValues } from '@/lib/scheduling/dashboard/forms';
import type { ResourceView } from '@/lib/scheduling/dashboard/types';
import { RESOURCE_KIND_LABELS, configurableKinds } from '@/lib/scheduling/dashboard/wording';
import { ProblemNotice, ProblemsList } from './parts';
import styles from './scheduling.module.css';

// Create or edit a resource: a court, room, practitioner, space or piece of equipment that can be assigned to offerings. The type
// can only change while the resource is unused; the API says so if it is in use, and this form explains it up front.

export type ResourceDialogProps =
  | { mode: 'create'; onClose: () => void; onSaved: (resource: ResourceView) => void }
  | { mode: 'edit'; resource: ResourceView; onClose: () => void; onSaved: (resource: ResourceView) => void; onReload: () => void };

export function ResourceDialog(props: ResourceDialogProps) {
  const original = props.mode === 'edit' ? props.resource : null;
  const kinds = configurableKinds();
  const [values, setValues] = useState<ResourceFormValues>(() => (original ? valuesFromResource(original) : emptyResourceValues(kinds[0])));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string[]>([]);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const set = <K extends keyof ResourceFormValues>(key: K, value: ResourceFormValues[K]) => setValues(v => ({ ...v, [key]: value }));
  // an existing resource may have a kind outside today's list (created before); keep it selectable so the form does not silently change it
  const kindOptions = original && !kinds.includes(original.kind) ? [original.kind, ...kinds] : kinds;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const built = original ? buildResourceEdit(values, original) : buildResourceCreate(values);
    if (!built.ok) {
      setLocal(built.problems);
      return;
    }
    setLocal([]);
    setBusy(true);
    const result = original
      ? await schedulingApi<{ resource: ResourceView }>('PATCH', `/resources/${seg(original.id)}`, { expectedUpdatedAt: original.updatedAt, ...built.value })
      : await schedulingApi<{ resource: ResourceView }>('POST', '/resources', built.value);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    props.onSaved(result.data.resource);
  }

  return (
    <Dialog open onClose={props.onClose} title={original ? `Edit ${original.name}` : 'New resource'} width={520}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <Field label="Name" required helper="For example “Court 1”, “Studio A” or “Dr Chen”.">
          {p => <input {...p} className={fieldControlClassName} value={values.name} maxLength={120} autoComplete="off" onChange={e => set('name', e.target.value)} />}
        </Field>
        <div className={styles.formRow}>
          <Field label="Type" helper={original ? 'The type can only change while the resource is not assigned to an offering and has never been booked.' : undefined}>
            {p => (
              <select {...p} className={fieldControlClassName} value={values.kind} onChange={e => set('kind', e.target.value as ResourceFormValues['kind'])}>
                {kindOptions.map(k => (
                  <option key={k} value={k}>{RESOURCE_KIND_LABELS[k]}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Capacity" required helper="How many people it holds at once.">
            {p => <input {...p} className={fieldControlClassName} inputMode="numeric" value={values.capacity} onChange={e => set('capacity', e.target.value)} />}
          </Field>
        </div>
        <ProblemsList problems={local} />
        {problem && <ProblemNotice problem={problem} onReload={props.mode === 'edit' ? props.onReload : undefined} />}
        <FormActions>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : original ? 'Save changes' : 'Create resource'}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
