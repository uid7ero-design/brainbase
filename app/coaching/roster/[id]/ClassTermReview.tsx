import Link from 'next/link';
import type { tennisClassTermReview } from '@/lib/scheduling/coachClasses';
import styles from '../../workspace.module.css';

type Sessions = Awaited<ReturnType<typeof tennisClassTermReview>>;

export default function ClassTermReview({ id, name, term, sessions }: {
  id: string; name: string; term?: string; sessions: Sessions;
}) {
  const upcoming = sessions.filter(s => !s.ended && !s.cancelled && !s.archived);
  const missing = sessions.reduce((sum,s) => sum + (s.ended && !s.cancelled ? s.unmarked : 0),0);
  return <main className={styles.page}>
    <Link href={'/coaching/roster/' + encodeURIComponent(id)}>Back to class roster</Link>
    <h1>{name} term review</h1>
    {!term ? <p>This date is outside a term. To group existing dates, open the first upcoming class roster.</p> :
      <><h2>{term}</h2>
      <p>{sessions.length} class dates · {missing} unmarked places in finished classes</p>
      <p>{upcoming.filter(s => s.planned).length} of {upcoming.length} upcoming or in-progress sessions have a saved plan.</p>
      <ul aria-label="Class dates" className={styles.reviewList}>{sessions.map(s => {
        const roster = '/coaching/roster/' + encodeURIComponent(s.id);
        return <li key={s.id}><div>
          <strong>{s.day} · {s.time}</strong><small>{s.zone}</small>
          <span>{s.cancelled ? 'Class cancelled' : s.ended ? 'Finished' : 'Upcoming or in progress'}</span>
        </div><div>
          <span>{s.booked} booked places · {s.cancellations} cancelled {s.cancellations === 1 ? 'booking' : 'bookings'}</span>
          {!s.cancelled && <span>{s.attended} attended · {s.late} late · {s.absent} absent · {s.unmarked} unmarked</span>}
          <Link href={roster}>Open roster</Link>
          {!s.cancelled && (s.planned || (!s.ended && !s.archived)) &&
            <Link href={roster + '/plan'}>{s.planned ? 'Open plan' : 'Prepare plan'}</Link>}
        </div></li>;
      })}</ul></>}
  </main>;
}
