'use client';

import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '@/components/ui/app/useDialogFocus';
import { templateDrills, type Drill } from '@/lib/scheduling/trainingPlan';
import PositionsBoard from './PositionsBoard';
import styles from './sessionSheet.module.css';

export type SessionHeading = { name: string; schedule: string; day: string; time: string; venue: string | null };

export default function SessionSheet({ drills, session, minutes, state, recovery, onClose }: {
  drills: Drill[];
  session?: SessionHeading;
  minutes: number;
  state: string;
  recovery: boolean;
  onClose: () => void;
}) {
  const title = useId();
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(true, onClose, panel);
  // Board positions are useful on a handout; roster names and identifiers are not needed.
  const anonymous = templateDrills(drills);
  const rows = anonymous.reduce<{ drill: Drill; start: number | null; end: number | null; valid: boolean }[]>((result, drill) => {
    const start = result.length ? result[result.length - 1].end : 0;
    const valid = Number.isInteger(drill.minutes) && drill.minutes >= 1 && drill.minutes <= 240;
    return [...result, { drill, start, end: start !== null && valid ? start + drill.minutes : null, valid }];
  }, []);
  const total = rows.at(-1)?.end ?? null;
  return createPortal(
    <div data-coach-session-sheet="" className={styles.overlay}>
      <div ref={panel} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={title} tabIndex={-1}>
        <div className={styles.toolbar} data-dialog-body="">
          <button onClick={onClose}>Close session sheet</button>
          <button disabled={recovery} onClick={() => window.print()}>Print session sheet</button>
        </div>
        <header>
          <p className={styles.eyebrow}>Coach · session sheet</p>
          <h2 id={title}>{session ? session.name + ' session sheet' : 'Session sheet'}</h2>
          {session && <p>{session.schedule} · {session.day} · {session.time}{session.venue ? ' · ' + session.venue : ''}</p>}
          <p className={styles.state}>{state}</p>
          <p>{total === null ? 'Timing incomplete — review drill durations.' : `${total} min planned · ${minutes} min session · ${total > minutes ? total - minutes + ' min over time' : minutes - total + ' min remaining'}`}</p>
          <p className={styles.hint}>Timings are minutes from the start of the session. Board player labels are omitted; review coaching notes before sharing.</p>
        </header>
        <ol className={styles.drills}>
          {rows.map(({ drill, start, end, valid }, i) => (
            <li key={i}>
              <div className={styles.drillHeading}>
                <span className={styles.number}>{i + 1}</span>
                <div>
                  <p className={styles.timing}>{start !== null && end !== null ? `${start}–${end} min` : 'Timing incomplete'}{valid ? ` · ${drill.minutes} min drill` : ''}</p>
                  <h3>{drill.name || 'Untitled drill'}</h3>
                </div>
              </div>
              {drill.notes && <p className={styles.notes}>{drill.notes}</p>}
              <PositionsBoard drill={drill} players={[]} />
            </li>
          ))}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
