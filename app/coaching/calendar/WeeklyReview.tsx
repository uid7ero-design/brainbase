import Link from 'next/link';

import type { weeklyReview } from '@/lib/scheduling/coachClasses';

import { addLocalDays } from '@/lib/scheduling/coachClassDates';

import styles from '../workspace.module.css';

type Sessions = Awaited<ReturnType<typeof weeklyReview>>;

const dateLabel = (day: string) =>
  new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day + 'T12:00:00Z'));

function SessionList({ sessions }: { sessions: Sessions }) {
  return (
    <ul className={styles.reviewList}>
      {sessions.map((s) => {
        const roster = '/coaching/roster/' + encodeURIComponent(s.id);

        return (
          <li key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <small>
                {dateLabel(s.day)} · {s.time} {s.timezone} · {s.schedule}
              </small>
            </div>

            {s.ended ? (
              <div>
                <span>
                  {s.attended} attended · {s.late} late · {s.absent} absent · {s.unmarked} unmarked
                </span>

                <Link href={roster}>Open roster</Link>
              </div>
            ) : (
              <div>
                <span>{s.planned ? 'Plan saved' : 'No saved plan'}</span>

                <Link href={roster + '/plan'}>{s.planned ? 'Open plan' : 'Prepare plan'}</Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function WeeklyReview({ start, sessions }: { start: string; sessions: Sessions }) {
  const finished = sessions.filter((s) => s.ended);

  const pending = finished.filter((s) => s.unmarked > 0);

  const upcoming = sessions.filter((s) => !s.ended);

  const reviewed = finished.filter((s) => s.unmarked === 0);

  const unmarked = pending.reduce((count, s) => count + s.unmarked, 0);

  return (
    <main className={styles.page}>
      <Link href={'/coaching/calendar?week=' + start}>Weekly class calendar</Link>

      <h1>Weekly coaching review</h1>

      <p>
        {dateLabel(start)} – {dateLabel(addLocalDays(start, 6))}
      </p>

      <nav className={styles.controls} aria-label="Review weeks">
        <Link href={'?view=review&week=' + addLocalDays(start, -7)}>Previous week</Link>

        <Link href="?view=review">This week</Link>

        <Link href={'?view=review&week=' + addLocalDays(start, 7)}>Next week</Link>
      </nav>

      <div className={styles.columns}>
        <section className={styles.panel} aria-label="Attendance to finish">
          <h2>Attendance to finish</h2>

          {pending.length ? (
            <>
              <p>
                {unmarked} unmarked {unmarked === 1 ? 'place' : 'places'} across {pending.length}{' '}
                {pending.length === 1 ? 'class' : 'classes'}
              </p>
              <SessionList sessions={pending} />
            </>
          ) : (
            <p>No finished classes need attendance for this week.</p>
          )}
        </section>

        <section className={styles.panel} aria-label="Session preparation">
          <h2>Session preparation</h2>

          {upcoming.length ? (
            <>
              <p>
                {upcoming.filter((s) => s.planned).length} of {upcoming.length} sessions have a saved plan
              </p>
              <SessionList sessions={upcoming} />
            </>
          ) : (
            <p>No upcoming or in-progress classes this week.</p>
          )}
        </section>
      </div>

      {reviewed.length > 0 && (
        <section className={styles.panel} aria-label="Finished classes with no outstanding marks">
          <h2>Finished classes with no outstanding marks</h2>
          <SessionList sessions={reviewed} />
        </section>
      )}
    </main>
  );
}
