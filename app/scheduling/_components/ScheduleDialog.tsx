'use client';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, FormActions, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import { buildScheduleCreate, buildScheduleEdit, emptyScheduleValues, valuesFromSchedule, withPreset, type ScheduleFormValues } from '@/lib/scheduling/dashboard/forms';
import type { ScheduleView } from '@/lib/scheduling/dashboard/types';
import { presetChoices } from '@/lib/scheduling/dashboard/wording';
import { ProblemNotice, ProblemsList } from './parts';
import styles from './scheduling.module.css';

// Create or edit a schedule. The preset picker is offered on create and, on edit, only while the schedule has no offerings (the
// API refuses it afterwards with PRESET_LOCKED, so the form says why instead of offering a control that cannot work).

export type ScheduleDialogProps =
  | { mode: 'create'; onClose: () => void; onSaved: (schedule: ScheduleView) => void; onReload?: () => void }
  | { mode: 'edit'; schedule: ScheduleView; presetChangeable: boolean; onClose: () => void; onSaved: (schedule: ScheduleView) => void; onReload: () => void };

export function ScheduleDialog(props: ScheduleDialogProps) {
  const original = props.mode === 'edit' ? props.schedule : null;
  const [values, setValues] = useState<ScheduleFormValues>(() => (original ? valuesFromSchedule(original) : emptyScheduleValues()));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string[]>([]);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const choices = presetChoices();
  const presetPickable = props.mode === 'create' || props.presetChangeable;
  const set = <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => setValues(v => ({ ...v, [key]: value }));
  const needsHours = values.customerCanCancel;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const built = original ? buildScheduleEdit(values, original, props.mode === 'edit' && props.presetChangeable) : buildScheduleCreate(values);
    if (!built.ok) {
      setLocal(built.problems);
      return;
    }
    setLocal([]);
    setBusy(true);
    const result = original
      ? await schedulingApi<{ schedule: ScheduleView }>('PATCH', `/schedules/${seg(original.id)}`, { expectedUpdatedAt: original.updatedAt, ...built.value })
      : await schedulingApi<{ schedule: ScheduleView }>('POST', '/schedules', built.value);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    props.onSaved(result.data.schedule);
  }

  return (
    <Dialog open onClose={props.onClose} title={original ? `Edit ${original.name}` : 'New schedule'} width={680}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <Field label="Name" required helper="What your team and customers call this, for example “Junior coaching” or “Court hire”.">
          {p => <input {...p} className={fieldControlClassName} value={values.name} maxLength={120} autoComplete="off" onChange={e => set('name', e.target.value)} />}
        </Field>

        <fieldset className={styles.fieldset} disabled={!presetPickable}>
          <legend className={styles.legend}>Type of schedule</legend>
          <div className={styles.presetGrid} role="radiogroup" aria-label="Type of schedule">
            {choices.map(c => (
              <label key={c.key} className={`${styles.preset} ${!presetPickable ? styles.presetDisabled : ''}`}>
                <span className={styles.presetHead}>
                  <input type="radio" name="preset" value={c.key} checked={values.presetKey === c.key} onChange={() => setValues(v => withPreset(v, c.key))} />
                  {c.name}
                </span>
                <span className={styles.presetHint}>{c.description}</span>
                <span className={styles.presetHint}>
                  You will set up {c.offeringPlural.toLowerCase()}
                  {c.resourcesRequired ? `, each with ${c.resourcePlural.toLowerCase()} assigned.` : `; ${c.resourcePlural.toLowerCase()} are optional.`}
                </span>
              </label>
            ))}
          </div>
          {!presetPickable && <p className={styles.dim}>The type cannot change once the schedule has offerings. Create a new schedule if you need a different type.</p>}
        </fieldset>

        <Field label="Timezone" helper="Optional, for example Australia/Perth. Leave blank to use your organisation’s timezone.">
          {p => <input {...p} className={fieldControlClassName} value={values.timezone} autoComplete="off" placeholder="Organisation default" onChange={e => set('timezone', e.target.value)} />}
        </Field>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Cancellation</legend>
          <label className={styles.check}>
            <input type="checkbox" checked={values.customerCanCancel} onChange={e => set('customerCanCancel', e.target.checked)} />
            <span>Customers can cancel their own reservations</span>
          </label>
          {needsHours && (
            <div className={styles.formRow}>
              <Field label="Free cancellation until (hours before the start)" helper="Blank means a cancellation is never late.">
                {p => <input {...p} className={fieldControlClassName} inputMode="numeric" value={values.freeHours} onChange={e => set('freeHours', e.target.value)} />}
              </Field>
              <Field label="Late cancellation charge">
                {p => (
                  <select {...p} className={fieldControlClassName} value={values.lateKind} onChange={e => set('lateKind', e.target.value as ScheduleFormValues['lateKind'])}>
                    <option value="none">No charge</option>
                    <option value="percent">A percentage of the price</option>
                    <option value="fixed">A fixed amount</option>
                  </select>
                )}
              </Field>
            </div>
          )}
          {needsHours && values.lateKind !== 'none' && (
            <Field label={values.lateKind === 'percent' ? 'Percentage (0 to 100)' : 'Amount (for example 20.00)'}>
              {p => <input {...p} className={fieldControlClassName} inputMode="decimal" value={values.lateValue} onChange={e => set('lateValue', e.target.value)} />}
            </Field>
          )}
        </fieldset>

        <ProblemsList problems={local} />
        {problem && <ProblemNotice problem={problem} onReload={props.mode === 'edit' ? props.onReload : undefined} />}
        <FormActions>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : original ? 'Save changes' : 'Create schedule'}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
