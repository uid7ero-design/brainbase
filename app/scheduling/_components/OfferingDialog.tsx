'use client';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, FormActions, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import { buildOfferingCreate, buildOfferingEdit, emptyOfferingValues, offeringFieldPlan, valuesFromOffering, type EndMode, type OfferingFormValues } from '@/lib/scheduling/dashboard/forms';
import type { OfferingView, ScheduleView } from '@/lib/scheduling/dashboard/types';
import { DAY_OPTIONS, wordingFor } from '@/lib/scheduling/dashboard/wording';
import { ProblemNotice, ProblemsList } from './parts';
import styles from './scheduling.module.css';

// Create or edit an offering (a "session", "service" or "facility", per the schedule's type). Which fields appear, and which are
// required, is read from the schedule's preset in the shared core (offeringFieldPlan), so a new preset needs no change here:
// classes ask for a headcount limit and a duration; appointments for a duration; hire lets the customer choose the duration.

const END_LABELS: Record<EndMode, string> = {
  ongoing: 'Keeps repeating',
  after_occurrences: 'Ends after a number of times',
  on_date: 'Ends on a date',
};

export type OfferingDialogProps = {
  schedule: ScheduleView;
  currency: string;
  onClose: () => void;
  onSaved: (offering: OfferingView) => void;
} & ({ mode: 'create' } | { mode: 'edit'; offering: OfferingView; onReload: () => void });

export function OfferingDialog(props: OfferingDialogProps) {
  const { schedule, currency } = props;
  const words = wordingFor(schedule);
  const plan = offeringFieldPlan(schedule.presetKey);
  const original = props.mode === 'edit' ? props.offering : null;
  const [values, setValues] = useState<OfferingFormValues>(() => (original ? valuesFromOffering(original) : emptyOfferingValues(schedule.presetKey)));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string[]>([]);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const set = <K extends keyof OfferingFormValues>(key: K, value: OfferingFormValues[K]) => setValues(v => ({ ...v, [key]: value }));
  const weekly = values.recurrence === 'weekly';
  const singular = words.offering.toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const built = original ? buildOfferingEdit(values, original, schedule.presetKey) : buildOfferingCreate(values, schedule.presetKey);
    if (!built.ok) {
      setLocal(built.problems);
      return;
    }
    setLocal([]);
    setBusy(true);
    const result = original
      ? await schedulingApi<{ offering: OfferingView }>('PATCH', `/offerings/${seg(original.id)}`, { expectedUpdatedAt: original.updatedAt, ...built.value })
      : await schedulingApi<{ offering: OfferingView }>('POST', `/schedules/${seg(schedule.id)}/offerings`, built.value);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    props.onSaved(result.data.offering);
  }

  return (
    <Dialog open onClose={props.onClose} title={original ? `Edit ${original.name}` : `New ${singular}`} width={640}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <Field label="Name" required>
          {p => <input {...p} className={fieldControlClassName} value={values.name} maxLength={120} autoComplete="off" onChange={e => set('name', e.target.value)} />}
        </Field>

        <div className={styles.formRow}>
          {plan.duration !== 'hidden' && (
            <Field
              label={plan.duration === 'required' ? 'Duration (minutes)' : 'Duration (minutes, optional)'}
              required={plan.duration === 'required'}
              helper={plan.duration === 'optional' ? 'Leave blank to let the customer choose how long they book.' : undefined}
            >
              {p => <input {...p} className={fieldControlClassName} inputMode="numeric" value={values.durationMinutes} onChange={e => set('durationMinutes', e.target.value)} />}
            </Field>
          )}
          {plan.capacity === 'required' && (
            <Field label="Capacity" required helper={`The most people who can join one ${singular}.`}>
              {p => <input {...p} className={fieldControlClassName} inputMode="numeric" value={values.capacity} onChange={e => set('capacity', e.target.value)} />}
            </Field>
          )}
          <Field label={`Price (${currency})`} helper="Per reservation. Use 0.00 for free.">
            {p => <input {...p} className={fieldControlClassName} inputMode="decimal" value={values.price} onChange={e => set('price', e.target.value)} />}
          </Field>
        </div>

        {plan.recurrenceKinds.includes('weekly') && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>When it runs</legend>
            <Field label="Repeat">
              {p => (
                <select {...p} className={fieldControlClassName} value={values.recurrence} onChange={e => set('recurrence', e.target.value as OfferingFormValues['recurrence'])}>
                  <option value="none">Does not repeat</option>
                  <option value="weekly">Every week</option>
                </select>
              )}
            </Field>
            {weekly && (
              <>
                <div className={styles.formRow}>
                  <Field label="Day">
                    {p => (
                      <select {...p} className={fieldControlClassName} value={values.dayOfWeek} onChange={e => set('dayOfWeek', e.target.value)}>
                        {DAY_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    )}
                  </Field>
                  <Field label="Start time (24 hour)" required>
                    {p => <input {...p} type="time" className={fieldControlClassName} value={values.startTime} onChange={e => set('startTime', e.target.value)} />}
                  </Field>
                </div>
                <div className={styles.formRow}>
                  <Field label="First date" helper="Optional unless the series ends after a number of times.">
                    {p => <input {...p} type="date" className={fieldControlClassName} value={values.startDate} onChange={e => set('startDate', e.target.value)} />}
                  </Field>
                  <Field label="How it ends">
                    {p => (
                      <select {...p} className={fieldControlClassName} value={values.endMode} onChange={e => set('endMode', e.target.value as EndMode)}>
                        {plan.endModes.map(m => <option key={m} value={m}>{END_LABELS[m]}</option>)}
                      </select>
                    )}
                  </Field>
                </div>
                {values.endMode === 'after_occurrences' && (
                  <Field label="Number of times">
                    {p => <input {...p} className={fieldControlClassName} inputMode="numeric" value={values.endCount} onChange={e => set('endCount', e.target.value)} />}
                  </Field>
                )}
                {values.endMode === 'on_date' && (
                  <Field label="Last date">
                    {p => <input {...p} type="date" className={fieldControlClassName} value={values.endDate} onChange={e => set('endDate', e.target.value)} />}
                  </Field>
                )}
              </>
            )}
          </fieldset>
        )}

        <ProblemsList problems={local} />
        {problem && <ProblemNotice problem={problem} onReload={props.mode === 'edit' ? props.onReload : undefined} />}
        <FormActions>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : original ? 'Save changes' : `Create ${singular}`}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
