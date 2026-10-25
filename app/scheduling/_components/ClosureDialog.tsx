'use client';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, FormActions, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import {
  MAX_REASON,
  buildClosureCreate,
  buildClosureEdit,
  closureTimesText,
  effectiveEnd,
  emptyClosureValues,
  formatDateRange,
  isCalendarDate,
  isClock,
  valuesFromClosure,
  type ClosureFormValues,
} from '@/lib/scheduling/dashboard/availability';
import type { AvailabilityClosureView } from '@/lib/scheduling/dashboard/types';
import { ProblemNotice, ProblemsList } from './parts';
import styles from './scheduling.module.css';

// Add or edit a closure: whole days, or part of each day (a lunch break, a late start). Closures only: this screen never creates
// opening-hours overrides. Closing part of a day needs the staged migration 035; until it is applied the option is shown but cannot be
// chosen, and says why, so nobody is surprised by a refusal.

export type ClosureDialogProps =
  | { mode: 'add'; ownerPath: string; partialClosures: boolean; onClose: () => void; onSaved: (message: string) => void }
  | { mode: 'edit'; ownerPath: string; closure: AvailabilityClosureView; partialClosures: boolean; onClose: () => void; onSaved: (message: string) => void; onReload: () => void };

export function ClosureDialog(props: ClosureDialogProps) {
  const original = props.mode === 'edit' ? props.closure : null;
  const [values, setValues] = useState<ClosureFormValues>(() => (original ? valuesFromClosure(original) : emptyClosureValues()));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string[]>([]);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const set = <K extends keyof ClosureFormValues>(key: K, value: ClosureFormValues[K]) => setValues(v => ({ ...v, [key]: value }));
  // an existing partial closure stays editable as one even if the capability probe says otherwise (it cannot be, but never hide what exists)
  const partialChoosable = props.partialClosures || (original !== null && original.startTime !== null);

  const to = values.toDate === '' ? values.fromDate : values.toDate;
  const end = effectiveEnd(values);
  const datesOk = isCalendarDate(values.fromDate) && isCalendarDate(to) && to >= values.fromDate;
  const timesOk = values.scope === 'full' || (isClock(values.start) && (isClock(end) || end === '24:00'));
  const summary = !datesOk
    ? 'Choose the date, or the first and last dates.'
    : !timesOk
      ? 'Choose when the closure starts and ends.'
      : `Closed ${formatDateRange(values.fromDate, to)}: ${values.scope === 'partial' ? `${closureTimesText({ startTime: values.start, endTime: end })} each day` : 'the whole day'}.`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const built = original ? buildClosureEdit(values, original) : buildClosureCreate(values);
    if (!built.ok) return setLocal(built.problems);
    setLocal([]);
    setBusy(true);
    const result = original
      ? await schedulingApi<{ exception: AvailabilityClosureView }>('PATCH', `/availability-exceptions/${seg(original.id)}`, { expectedUpdatedAt: original.updatedAt, ...built.value })
      : await schedulingApi<{ exception: AvailabilityClosureView }>('POST', `${props.ownerPath}/availability-exceptions`, built.value);
    setBusy(false);
    if (!result.ok) return setProblem(result.problem);
    props.onSaved(`${original ? 'Closure changed' : 'Closure added'}: ${summary.replace(/^Closed /, '').replace(/\.$/, '')}.`);
  }

  return (
    <Dialog open onClose={props.onClose} title={original ? 'Edit closure' : 'Add closure'} width={560}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>What is closed?</legend>
          <div className={styles.radioGroup}>
            <label className={styles.radio}>
              <input type="radio" name="closure-scope" checked={values.scope === 'full'} onChange={() => set('scope', 'full')} />
              <span>
                Whole days
                <span className={styles.radioHint}>Nothing is available on these dates, for example a public holiday.</span>
              </span>
            </label>
            <label className={`${styles.radio} ${partialChoosable ? '' : styles.radioDisabled}`} aria-disabled={partialChoosable ? undefined : true}>
              <input type="radio" name="closure-scope" checked={values.scope === 'partial'} disabled={!partialChoosable} onChange={() => set('scope', 'partial')} />
              <span>
                Part of a day
                <span className={styles.radioHint}>
                  {partialChoosable
                    ? 'Only the times you choose are closed on each date, for example a lunch break or a late start.'
                    : 'Not available yet: closing part of a day needs a database update that has not been applied. Closing whole days works now.'}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className={styles.formRow}>
          <Field label={values.fromDate !== '' && to !== values.fromDate ? 'First date' : 'Date'} required>
            {p => <input {...p} type="date" className={fieldControlClassName} value={values.fromDate} onChange={e => set('fromDate', e.target.value)} />}
          </Field>
          <Field label="Last date" helper="Leave empty for a single day.">
            {p => <input {...p} type="date" className={fieldControlClassName} value={values.toDate} min={values.fromDate || undefined} onChange={e => set('toDate', e.target.value)} />}
          </Field>
        </div>

        {values.scope === 'partial' && (
          <>
            <div className={styles.formRow}>
              <Field label="Closed from" required>
                {p => <input {...p} type="time" className={fieldControlClassName} value={values.start} onChange={e => set('start', e.target.value)} />}
              </Field>
              <Field label="Until" required>
                {p => <input {...p} type="time" className={fieldControlClassName} value={values.end} disabled={values.untilMidnight} onChange={e => set('end', e.target.value)} />}
              </Field>
            </div>
            <label className={styles.checkTouch}>
              <input type="checkbox" checked={values.untilMidnight} onChange={e => set('untilMidnight', e.target.checked)} />
              <span>Until midnight (the end of the day)</span>
            </label>
          </>
        )}

        <Field label="Reason" helper="Optional. Visible to everyone who can see this page.">
          {p => <input {...p} type="text" className={fieldControlClassName} value={values.reason} maxLength={MAX_REASON} autoComplete="off" onChange={e => set('reason', e.target.value)} />}
        </Field>

        <p className={styles.summary} role="status" data-testid="closure-summary">{summary}</p>
        <ProblemsList problems={local} />
        {problem && <ProblemNotice problem={problem} onReload={props.mode === 'edit' ? props.onReload : undefined} />}
        <FormActions>
          <Button variant="ghost" className={styles.touch} onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" className={styles.touch} type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : original ? 'Save changes' : 'Add closure'}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
