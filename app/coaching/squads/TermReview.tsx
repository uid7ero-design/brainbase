import Link from 'next/link';
import type { Squad, squadTermReview } from '@/lib/scheduling/coachSquads';
import styles from '../workspace.module.css';

type Sessions = Awaited<ReturnType<typeof squadTermReview>>;
type Marks = { attended: number; late: number; absent: number; unmarked: number };
const emptyMarks = (): Marks => ({ attended: 0, late: 0, absent: 0, unmarked: 0 });

function record(marks: Marks, player: Sessions[number]['players'][number]) {
  if (player.mark === 'attended' || player.mark === 'late' || player.mark === 'absent') {
    marks[player.mark]++;
  } else if (player.status === 'confirmed' && player.mark === null) {
    marks.unmarked++;
  }
}

function summary(m: Marks) {
  return (
    m.attended + ' attended · ' + m.late + ' late · ' + m.absent + ' absent · ' + m.unmarked + ' unmarked'
  );
}

export default function TermReview({
  squad,
  term,
  sessions,
}: {
  squad: Squad;
  term: string;
  sessions: Sessions;
}) {
  const players = new Map<string, { name: string; marks: Marks }>();
  const totals = emptyMarks();
  const rows = sessions.map((session) => {
    const marks = emptyMarks();
    if (session.ended && !session.cancelled) {
      for (const player of session.players) {
        const entry = players.get(player.id) ?? { name: player.name, marks: emptyMarks() };
        record(entry.marks, player);
        record(marks, player);
        record(totals, player);
        players.set(player.id, entry);
      }
    }
    return { session, marks };
  });
  const marked = totals.attended + totals.late + totals.absent;
  return (
    <main className={styles.page}>
      <Link href={'?squad=' + squad.id}>Back to {squad.name}</Link>
      <h1>{squad.name} term review</h1>
      <p>{term}</p>
      <section className={styles.panel}>
        <h2>Attendance so far</h2>
        <p>
          {marked
            ? Math.round((100 * (totals.attended + totals.late)) / marked) +
              '% present across ' +
              marked +
              (marked === 1 ? ' marked squad place' : ' marked squad places')
            : 'No recorded attendance for finished sessions yet.'}
        </p>
        <p>{summary(totals)}</p>
      </section>
      <section aria-label="Term sessions" className={styles.panel}>
        <h2>Term sessions</h2>
        {rows.length === 0 && <p>No session dates from this squad assignment.</p>}
        <ul className={styles.reviewList}>
          {rows.map(({ session: s, marks }) => {
            const roster = '/coaching/roster/' + encodeURIComponent(s.id);
            return (
              <li key={s.id}>
                <div>
                  <strong>
                    {s.day} · {s.time}
                  </strong>
                  <small>{s.zone}</small>
                </div>
                <div>
                  {s.cancelled ? (
                    <span>Cancelled</span>
                  ) : s.ended ? (
                    <span>{summary(marks)}</span>
                  ) : (
                    <span>
                      {s.players.length} squad places · {s.planned ? 'Plan saved' : 'No saved plan'}
                    </span>
                  )}
                  {s.archived ? (
                    <span>Archived</span>
                  ) : (
                    !s.cancelled && (
                      <Link href={s.ended ? roster : roster + '/plan'}>
                        {s.ended ? 'Open roster' : s.planned ? 'Open plan' : 'Prepare plan'}
                      </Link>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label="Player attendance" className={styles.panel}>
        <h2>Player attendance</h2>
        <p>
          Finished sessions count squad bookings from the date the term was assigned. Late arrivals count as
          present.
        </p>
        {players.size > 0 ? (
          <ul className={styles.reviewList}>
            {Array.from(players)
              .sort(([, a], [, b]) => a.name.localeCompare(b.name))
              .map(([id, p]) => (
                <li key={id}>
                  <strong>{p.name}</strong>
                  <span>{summary(p.marks)}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p>No finished squad bookings yet.</p>
        )}
      </section>
    </main>
  );
}
