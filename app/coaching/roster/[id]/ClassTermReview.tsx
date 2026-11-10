import Link from 'next/link';
import type { tennisClassTermReview } from '@/lib/scheduling/coachClasses';
import styles from './termReview.module.css';

type Sessions = Awaited<ReturnType<typeof tennisClassTermReview>>;
const dateLabel = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

export default function ClassTermReview({ id, name, term, sessions }: {
  id: string; name: string; term?: string; sessions: Sessions;
}) {
  const upcoming = sessions.filter(s => !s.ended && !s.cancelled && !s.archived);
  const planned = upcoming.filter(s => s.planned).length;
  const booked = sessions.reduce((total, s) => total + s.booked, 0);
  const missing = sessions.reduce((sum, s) => sum + (s.ended && !s.cancelled ? s.unmarked : 0), 0);

  return <main className={styles.page}>
    <Link className={styles.back} href={'/coaching/roster/' + encodeURIComponent(id)}>
      <span aria-hidden="true">← </span>Back to class roster
    </Link>
    <header className={styles.header}>
      <h1>{name} term review</h1>
      {term && <h2>{term}</h2>}
    </header>
    {!term ? <p>This date is outside a term. To group existing dates, open the first upcoming class roster.</p> : <>
      <dl className={styles.metrics}>
        <div><dt>Class dates</dt><dd>{sessions.length}</dd></div>
        <div><dt>Booked places across dates</dt><dd>{booked}</dd></div>
        <div><dt>Unmarked places in finished classes</dt><dd>{missing}</dd></div>
      </dl>
      <section aria-labelledby="class-dates">
        <h2 id="class-dates" className={styles.sectionTitle}>Class dates</h2>
        <p className={styles.plans}>{planned} of {upcoming.length} upcoming or in-progress sessions have a saved plan.</p>
        <ul aria-label="Class dates" className={styles.list}>{sessions.map(s => {
          const roster = '/coaching/roster/' + encodeURIComponent(s.id);
          return <li key={s.id}>
            <div className={styles.date}>
              <time dateTime={s.day}>{dateLabel.format(new Date(s.day + 'T12:00:00Z'))}</time>
              <span>{s.time} · {s.zone}</span>
            </div>
            <div className={styles.details}>
              <span className={styles.status}>{s.cancelled ? 'Class cancelled' : s.ended ? 'Finished' : 'Upcoming or in progress'}</span>
              <strong>{s.booked} booked {s.booked === 1 ? 'place' : 'places'} · {s.cancellations} cancelled {s.cancellations === 1 ? 'booking' : 'bookings'}</strong>
              {!s.cancelled && <span>{s.attended} attended · {s.late} late · {s.absent} absent · {s.unmarked} unmarked</span>}
            </div>
            <div className={styles.actions}>
              <Link href={roster}>Open roster</Link>
              {!s.cancelled && (s.planned || (!s.ended && !s.archived)) &&
                <Link href={roster + '/plan'}>{s.planned ? 'Open plan' : 'Prepare plan'}</Link>}
            </div>
          </li>;
        })}</ul>
      </section>
    </>}
  </main>;
}
