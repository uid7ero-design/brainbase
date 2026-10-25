'use client';
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, FormActions, fieldControlClassName } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import {
  EVERY_DAY,
  MAX_LABEL,
  WEEKDAYS,
  WEEK_ORDER,
  buildHoursCreate,
  buildHoursEdit,
  effectiveEnd,
  emptyHoursValues,
  formatClock,
  formatWindow,
  isClock,
  runsPastMidnight,
  valuesFromRule,
  type HoursFormValues,
} from '@/lib/scheduling/dashboard/availability';
import type { AvailabilityRuleView } from '@/lib/scheduling/dashboard/types';
import { dayName } from '@/lib/scheduling/dashboard/wording';
import { ProblemNotice, ProblemsList } from './parts';
import styles from './scheduling.module.css';

// Add or edit weekly hours. Adding takes any set of weekdays and writes them in ONE request; hours that run past midnight (an end
// before the start) go in the same request and are stored as two linked rules, together, so a half can never be saved on its own.
// Editing changes one stored window: it keeps its weekday, and cannot be turned into an overnight window (remove and add again).

export type HoursDialogProps =
  | { mode: 'add'; ownerPath: string; days?: readonly number[]; ownerNoun: string; onClose: () => void; onSaved: (message: string) => void }
  | { mode: 'edit'; ownerPath: string; rule: AvailabilityRuleView; ownerNoun: string; onClose: () => void; onSaved: (message: string) => void; onReload: () => void };

function describeDays(days: readonly number[]): string {
  const sorted = WEEK_ORDER.filter(d => days.includes(d));
  if (sorted.length === 7) return 'every day';
  if (sorted.length === 5 && WEEKDAYS.every(d => days.includes(d))) return 'Monday to Friday';
  return sorted.map(dayName).join(', ');
}

export function HoursDialog(props: HoursDialogProps) {
  const original = props.mode === 'edit' ? props.rule : null;
  const [values, setValues] = useState<HoursFormValues>(() => (original ? valuesFromRule(original) : emptyHoursValues(props.mode === 'add' && props.days ? props.days : WEEKDAYS)));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string[]>([]);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const set = <K extends keyof HoursFormValues>(key: K, value: HoursFormValues[K]) => setValues(v => ({ ...v, [key]: value }));
  const toggleDay = (day: number, on: boolean) => setValues(v => ({ ...v, days: on ? [...v.days, day] : v.days.filter(d => d !== day) }));

  const end = effectiveEnd(values);
  const overnight = runsPastMidnight(values);
  const ready = isClock(values.start) && (isClock(end) || end === '24:00');
  const daysText = describeDays(values.days);
  const summary = !ready
    ? 'Choose a start and an end time.'
    : values.days.length === 0 && !original
      ? 'Choose at least one day.'
      : overnight
        ? `Runs past midnight: ${daysText} ${formatClock(values.start)} to ${formatClock(end)} the next day. It is saved as two linked windows, together.`
        : `${original ? dayName(original.dayOfWeek) : daysText}: ${formatWindow(values.start, end)}.`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    if (original) {
      const built = buildHoursEdit(values, original);
      if (!built.ok) return setLocal(built.problems);
      setLocal([]);
      setBusy(true);
      const result = await schedulingApi<{ rule: AvailabilityRuleView }>('PATCH', `/availability-rules/${seg(original.id)}`, { expectedUpdatedAt: original.updatedAt, ...built.value });
      setBusy(false);
      if (!result.ok) return setProblem(result.problem);
      (props as Extract<HoursDialogProps, { mode: 'edit' }>).onSaved(`Hours changed: ${dayName(original.dayOfWeek)} ${formatWindow(result.data.rule.startTime, result.data.rule.endTime)}.`);
      return;
    }
    const built = buildHoursCreate(values);
    if (!built.ok) return setLocal(built.problems);
    setLocal([]);
    setBusy(true);
    const result = await schedulingApi<{ rules: AvailabilityRuleView[] }>('POST', `${props.ownerPath}/availability-rules`, built.value.body);
    setBusy(false);
    if (!result.ok) return setProblem(result.problem);
    props.onSaved(`Hours added: ${built.value.overnight ? `${daysText} ${formatClock(values.start)} to ${formatClock(end)} the next day` : `${daysText}, ${formatWindow(values.start, end)}`}.`);
  }

  return (
    <Dialog open onClose={props.onClose} title={original ? `Edit hours on ${dayName(original.dayOfWeek)}` : 'Add hours'} width={560}>
      <form onSubmit={submit} className={styles.form} noValidate>
        {original ? (
          <p className={styles.body}>
            <strong>{dayName(original.dayOfWeek)}</strong> for this {props.ownerNoun}. To change the day, remove this window and add it again.
          </p>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Days</legend>
            <div className={styles.dayPicker}>
              {WEEK_ORDER.map(day => (
                <label key={day} className={styles.checkTouch}>
                  <input type="checkbox" checked={values.days.includes(day)} onChange={e => toggleDay(day, e.target.checked)} />
                  <span>{dayName(day)}</span>
                </label>
              ))}
            </div>
            <div className={styles.quickRow}>
              <Button size="sm" className={styles.touch} onClick={() => set('days', [...WEEKDAYS])}>Weekdays</Button>
              <Button size="sm" className={styles.touch} onClick={() => set('days', [...EVERY_DAY])}>Every day</Button>
              <Button size="sm" variant="ghost" className={styles.touch} onClick={() => set('days', [])}>Clear</Button>
            </div>
          </fieldset>
        )}

        <div className={styles.formRow}>
          <Field label="Opens" required>
            {p => <input {...p} type="time" className={fieldControlClassName} value={values.start} onChange={e => set('start', e.target.value)} />}
          </Field>
          <Field label="Closes" required helper={values.untilMidnight ? 'Open until midnight.' : 'Earlier than the opening time means it runs past midnight.'}>
            {p => <input {...p} type="time" className={fieldControlClassName} value={values.end} disabled={values.untilMidnight} onChange={e => set('end', e.target.value)} />}
          </Field>
        </div>
        <label className={styles.checkTouch}>
          <input type="checkbox" checked={values.untilMidnight} onChange={e => set('untilMidnight', e.target.checked)} />
          <span>Until midnight (the end of the day)</span>
        </label>
        <Field label="Note" helper="Optional, for example “Peak hours”.">
          {p => <input {...p} type="text" className={fieldControlClassName} value={values.label} maxLength={MAX_LABEL} autoComplete="off" onChange={e => set('label', e.target.value)} />}
        </Field>

        <p className={styles.summary} role="status" data-testid="hours-summary">{summary}</p>
        <ProblemsList problems={local} />
        {problem && <ProblemNotice problem={problem} onReload={props.mode === 'edit' ? props.onReload : undefined} />}
        <FormActions>
          <Button variant="ghost" className={styles.touch} onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" className={styles.touch} type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : original ? 'Save changes' : 'Add hours'}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
