'use client';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel } from '@/components/ui/app';
import { schedulingApi, seg, type ApiProblem, type ApiResult } from '@/lib/scheduling/dashboard/api';
import { EVERY_DAY, WEEK_ORDER, formatClock, formatWindow, overnightText, validityNote, weekItems, type OvernightPair } from '@/lib/scheduling/dashboard/availability';
import type { AvailabilityRuleView } from '@/lib/scheduling/dashboard/types';
import { dayName } from '@/lib/scheduling/dashboard/wording';
import { ConfirmDialog } from './ConfirmDialog';
import { HoursDialog } from './HoursDialog';
import { EmptyBlock, ProblemNotice } from './parts';
import styles from './scheduling.module.css';

// The weekly hours of one offering or resource: seven days, Monday first, each with its windows. An overnight window (two stored rules)
// is shown once, on the day it starts. "Available all day" saves an EXPLICIT 00:00-midnight window: nothing is ever implied by a missing rule.

type Mode =
  | { kind: 'add'; days: readonly number[] }
  | { kind: 'edit'; rule: AvailabilityRuleView }
  | { kind: 'remove'; rule: AvailabilityRuleView }
  | { kind: 'removeOvernight'; pair: OvernightPair };

export function WeeklyHours({
  ownerPath,
  ownerNoun,
  rules,
  canAdd,
  canRemove,
  onChanged,
  announce,
}: {
  ownerPath: string;
  ownerNoun: string;
  rules: AvailabilityRuleView[];
  /** Add and edit: a manager, and the offering or resource still takes availability (not archived, not inactive). */
  canAdd: boolean;
  /** Removing stays possible for a manager even when the owner no longer takes new hours. */
  canRemove: boolean;
  onChanged: () => void;
  announce: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busyDay, setBusyDay] = useState<number | 'all' | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const week = useMemo(() => weekItems(rules), [rules]);

  const close = () => setMode(null);
  const saved = (message: string) => {
    setMode(null);
    announce(message);
    onChanged();
  };
  const closeAndReload = () => {
    setMode(null);
    onChanged();
  };

  async function availableAllDay(days: readonly number[]) {
    setProblem(null);
    setBusyDay(days.length === 7 ? 'all' : days[0]);
    const result = await schedulingApi<{ rules: AvailabilityRuleView[] }>(
      'POST',
      `${ownerPath}/availability-rules`,
      days.length === 1 ? { dayOfWeek: days[0], startTime: '00:00', endTime: '24:00' } : { daysOfWeek: [...days], startTime: '00:00', endTime: '24:00' },
    );
    setBusyDay(null);
    if (!result.ok) return setProblem(result.problem);
    announce(days.length === 7 ? 'Available all day, every day.' : `Available all day on ${dayName(days[0])}.`);
    onChanged();
  }

  if (rules.length === 0) {
    return (
      <Panel title="Weekly hours">
        {problem && <ProblemNotice problem={problem} />}
        <EmptyBlock
          title="No weekly hours yet"
          action={
            canAdd ? (
              <span className={styles.dayActions}>
                <Button variant="primary" className={styles.touch} onClick={() => setMode({ kind: 'add', days: [] })}>Add hours</Button>
                <Button className={styles.touch} disabled={busyDay !== null} aria-busy={busyDay === 'all' || undefined} onClick={() => availableAllDay(EVERY_DAY)}>
                  Available all day, every day
                </Button>
              </span>
            ) : undefined
          }
        >
          {canAdd
            ? `Until you add hours, this ${ownerNoun} has no availability. “Available all day, every day” saves an explicit midnight-to-midnight window for each day.`
            : `No hours have been saved, so this ${ownerNoun} has no availability.`}
        </EmptyBlock>
        {mode?.kind === 'add' && <HoursDialog mode="add" ownerPath={ownerPath} days={mode.days.length ? mode.days : undefined} ownerNoun={ownerNoun} onClose={close} onSaved={saved} />}
      </Panel>
    );
  }

  return (
    <Panel
      title="Weekly hours"
      actions={
        canAdd ? (
          <Button variant="primary" className={styles.touch} onClick={() => setMode({ kind: 'add', days: [] })}>Add hours</Button>
        ) : undefined
      }
    >
      {problem && <ProblemNotice problem={problem} />}
      <ul className={styles.dayList} aria-label="Weekly hours">
        {WEEK_ORDER.map(day => {
          const items = week[day];
          const name = dayName(day);
          return (
            <li key={day} className={styles.dayRow} data-day={day}>
              <h3 className={styles.dayName}>{name}</h3>
              <div className={styles.dayBody}>
                {items.length === 0 ? (
                  <>
                    <p className={styles.dayClosed}>Closed: no hours</p>
                    {canAdd && (
                      <span className={styles.dayActions}>
                        <Button size="sm" className={styles.touch} aria-label={`Add hours on ${name}`} onClick={() => setMode({ kind: 'add', days: [day] })}>Add hours</Button>
                        <Button size="sm" className={styles.touch} aria-label={`Available all day on ${name}`} disabled={busyDay !== null} aria-busy={busyDay === day || undefined} onClick={() => availableAllDay([day])}>
                          Available all day
                        </Button>
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <ul className={styles.windowList}>
                      {items.map(item => {
                        if (item.type === 'continued') {
                          return (
                            <li key={`c-${item.pair.second.id}`} className={styles.windowItem}>
                              <span className={styles.windowText}>
                                <span className={styles.windowMuted}>Until {formatClock(item.pair.second.endTime)}, continuing {dayName(item.pair.first.dayOfWeek)}’s overnight hours</span>
                              </span>
                            </li>
                          );
                        }
                        if (item.type === 'overnight') {
                          const text = overnightText(item.pair);
                          return (
                            <li key={`o-${item.pair.first.id}`} className={styles.windowItem} data-overnight="true">
                              <span className={styles.windowText}>
                                <span className={styles.windowTime}>{text}</span>
                                <Badge state="info">Overnight</Badge>
                                {item.pair.first.label && <span className={styles.windowMuted}>{item.pair.first.label}</span>}
                              </span>
                              {canRemove && (
                                <span className={styles.dayActions}>
                                  <Button size="sm" variant="ghost" className={styles.touch} aria-label={`Remove overnight hours starting ${name}, ${text}`} onClick={() => setMode({ kind: 'removeOvernight', pair: item.pair })}>
                                    Remove
                                  </Button>
                                </span>
                              )}
                            </li>
                          );
                        }
                        const r = item.rule;
                        const text = formatWindow(r.startTime, r.endTime);
                        const note = validityNote(r);
                        return (
                          <li key={r.id} className={styles.windowItem}>
                            <span className={styles.windowText}>
                              <span className={styles.windowTime}>{text}</span>
                              {r.kind === 'service_period' && <Badge state="info">Service period</Badge>}
                              {r.label && <span className={styles.windowMuted}>{r.label}</span>}
                              {note && <span className={styles.windowMuted}>{note}</span>}
                            </span>
                            {(canAdd || canRemove) && (
                              <span className={styles.dayActions}>
                                {canAdd && r.kind === 'hours' && (
                                  <Button size="sm" className={styles.touch} aria-label={`Edit ${name} ${text}`} onClick={() => setMode({ kind: 'edit', rule: r })}>Edit</Button>
                                )}
                                {canRemove && (
                                  <Button size="sm" variant="ghost" className={styles.touch} aria-label={`Remove ${name} ${text}`} onClick={() => setMode({ kind: 'remove', rule: r })}>Remove</Button>
                                )}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {canAdd && (
                      <span className={styles.dayActions}>
                        <Button size="sm" variant="ghost" className={styles.touch} aria-label={`Add more hours on ${name}`} onClick={() => setMode({ kind: 'add', days: [day] })}>Add more hours</Button>
                      </span>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {mode?.kind === 'add' && <HoursDialog mode="add" ownerPath={ownerPath} days={mode.days.length ? mode.days : undefined} ownerNoun={ownerNoun} onClose={close} onSaved={saved} />}
      {mode?.kind === 'edit' && <HoursDialog mode="edit" ownerPath={ownerPath} rule={mode.rule} ownerNoun={ownerNoun} onClose={close} onSaved={saved} onReload={closeAndReload} />}
      {mode?.kind === 'remove' && (
        <ConfirmDialog
          title={`Remove ${dayName(mode.rule.dayOfWeek)} hours`}
          confirmLabel="Remove hours"
          busyLabel="Removing…"
          danger
          run={() => schedulingApi<{ deleted: true }>('DELETE', `/availability-rules/${seg(mode.rule.id)}`, { expectedUpdatedAt: mode.rule.updatedAt })}
          onClose={close}
          onDone={() => saved(`Hours removed: ${dayName(mode.rule.dayOfWeek)} ${formatWindow(mode.rule.startTime, mode.rule.endTime)}.`)}
          onReload={closeAndReload}
        >
          <p className={styles.body}>
            <strong>{dayName(mode.rule.dayOfWeek)} {formatWindow(mode.rule.startTime, mode.rule.endTime)}</strong> will be removed. Without hours on this day, this {ownerNoun} has no availability then.
          </p>
        </ConfirmDialog>
      )}
      {mode?.kind === 'removeOvernight' && (
        <ConfirmDialog
          title="Remove overnight hours"
          confirmLabel="Remove overnight hours"
          busyLabel="Removing…"
          danger
          run={() => removeOvernight(mode.pair)}
          onClose={close}
          onDone={() => saved(`Overnight hours removed: ${dayName(mode.pair.first.dayOfWeek)} ${overnightText(mode.pair)}.`)}
          onReload={closeAndReload}
        >
          <p className={styles.body}>
            <strong>{dayName(mode.pair.first.dayOfWeek)} {overnightText(mode.pair)}</strong> will be removed, both the evening and the morning part.
          </p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}

/**
 * Removes both halves of an overnight window. Creating one is atomic (one request); removing is two requests, and a failure between
 * them leaves only a SMALLER window (never more availability). The caller is told exactly that, with a way to reload.
 */
async function removeOvernight(pair: OvernightPair): Promise<ApiResult<{ deleted: true }>> {
  const first = await schedulingApi<{ deleted: true }>('DELETE', `/availability-rules/${seg(pair.first.id)}`, { expectedUpdatedAt: pair.first.updatedAt });
  if (!first.ok) return first;
  const second = await schedulingApi<{ deleted: true }>('DELETE', `/availability-rules/${seg(pair.second.id)}`, { expectedUpdatedAt: pair.second.updatedAt });
  if (second.ok) return second;
  return { ok: false, problem: { ...second.problem, stale: true, message: `The evening part was removed but the morning part could not be. ${second.problem.message} Reload to see what is left.` } };
}
