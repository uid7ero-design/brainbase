'use client';

import { useEffect, useState } from 'react';
import styles from './plan.module.css';

export default function DrillTimer({ minutes }: { minutes: number }) {
  const duration = minutes * 60_000;
  const [remaining, setRemaining] = useState(duration);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const end = deadline;
    function refresh() {
      const left = Math.max(0, end - Date.now());
      setRemaining(left);
      if (left === 0) setDeadline(null);
    }
    const interval = window.setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [deadline]);

  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    return <p>Enter a drill duration from 1 to 240 minutes to use the timer.</p>;
  }
  const seconds = Math.ceil(remaining / 1000);
  const running = deadline !== null;
  const finished = remaining === 0;
  function reset() {
    setDeadline(null);
    setRemaining(duration);
  }
  return (
    <section aria-label="Drill timer" className={styles.timer}>
      <h3>Drill timer</h3>
      <strong role="timer" aria-label="Time remaining">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </strong>
      <p role="status">{finished ? 'Time is up' : running ? 'Running' : remaining < duration ? 'Paused' : 'Ready'}</p>
      <div className={styles.tools}>
        {running ? (
          <button onClick={() => {
            setRemaining(Math.max(0, deadline - Date.now()));
            setDeadline(null);
          }}>Pause timer</button>
        ) : (
          <button disabled={finished} onClick={() => setDeadline(Date.now() + remaining)}>
            {remaining < duration && !finished ? 'Resume timer' : 'Start timer'}
          </button>
        )}
        <button disabled={!running && remaining === duration} onClick={reset}>Reset timer</button>
      </div>
    </section>
  );
}
