import Link from 'next/link';
import { notFound } from 'next/navigation';
import { squadDetails, squadDirectory, squadSession, squadTermReview } from '@/lib/scheduling/coachSquads';
import TermReview from './TermReview';
import ClassForm from '../ClassForm';
import styles from '../workspace.module.css';
import { changeSquad } from '@/lib/scheduling/coachSquadActions';

export const dynamic = 'force-dynamic';

export default async function Squads({
  searchParams,
}: {
  searchParams: Promise<{ squad?: string; term?: string; offering?: string }>;
}) {
  const session = await squadSession();
  if (!session) notFound();
  const org = session.organisationId;
  const squads = await squadDirectory(org);
  const { squad: selected, term, offering } = await searchParams;
  const squad = squads.find((s) => s.id === selected);
  if (selected && !squad) notFound();
  const details = squad && (await squadDetails(org, squad.id));
  const action = changeSquad.bind(null, org);
  const available = details?.terms.filter((t) => !t.squad) ?? [];
  const assigned = details?.terms.filter((t) => t.squad === selected) ?? [];
  if (term !== undefined || offering !== undefined) {
    const match = assigned.find((t) => t.id === term && t.offering === offering);
    if (!squad || !match) notFound();
    return (
      <TermReview squad={squad} term={match.name} sessions={await squadTermReview(org, squad.id, match)} />
    );
  }
  const fee = (t: { cents: number; currency: string }) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: t.currency }).format(t.cents / 100);
  return (
    <main className={styles.page}>
      <Link href="/coaching">Coach</Link>
      <h1>Teams and squads</h1>
      <nav className={styles.squadNav} aria-label="Choose squad">
        {squads.map((s) => (
          <Link key={s.id} aria-current={s.id === selected ? 'page' : undefined} href={'?squad=' + s.id}>
            {s.name}
          </Link>
        ))}
      </nav>
      <ClassForm action={action} label="Create squad">
        <input type="hidden" name="action" value="create" />
        <label>
          Squad name
          <input name="name" maxLength={120} required />
        </label>
      </ClassForm>
      {squad && details && (
        <section key={squad.id} className={styles.panel}>
          <h2>{squad.name}</h2>
          <h3>Training terms</h3>
          <Link href="/coaching/calendar">Set up a weekly term in the calendar</Link>
          <ul>
            {assigned.map((t) => (
              <li key={t.id}>
                <Link href={'/coaching/calendar?week=' + t.first}>{t.name}</Link>
                <small>
                  {t.first} to {t.last} · {fee(t)} per class
                </small>
                <Link
                  aria-label={'Review ' + t.name}
                  href={'?' + new URLSearchParams({ squad: squad.id, offering: t.offering, term: t.id })}
                >
                  Term review
                </Link>
              </li>
            ))}
          </ul>
          {available.length > 0 && (
            <ClassForm action={action} label="Assign training term">
              <input type="hidden" name="action" value="assign" />
              <input type="hidden" name="squad" value={squad.id} />
              <label>
                Training term
                <select name="term" required defaultValue="">
                  <option value="" disabled>
                    Choose a term
                  </option>
                  {available.map((t) => (
                    <option key={t.id} value={JSON.stringify([t.offering, t.id, t.cents, t.currency])}>
                      {t.name} · {t.first} to {t.last} · {fee(t)} per class
                    </option>
                  ))}
                </select>
              </label>
            </ClassForm>
          )}
          <p>
            Assigning a term or adding a player books eligible upcoming classes at the class fee. Attendance
            is recorded on each class roster.
          </p>
          <h3>Players</h3>
          <ClassForm action={action} label="Add player">
            <input type="hidden" name="action" value="join" />
            <input type="hidden" name="squad" value={squad.id} />
            <label>
              Player name
              <input name="name" maxLength={200} required />
            </label>
            <label>
              Booking email
              <input type="email" name="email" maxLength={320} required />
            </label>
            <label>
              Joining date
              <input type="date" name="day" required />
            </label>
          </ClassForm>
          {details.members.length === 0 && <p>No players yet.</p>}
          {details.members.map((m) => (
            <article key={m.id}>
              <h4>{m.name}</h4>
              <p>
                {m.email} ·{' '}
                {m.last && m.last < m.first
                  ? 'Withdrawn before starting ' + m.first
                  : 'From ' + m.first + (m.last ? ' through ' + m.last : '')}
              </p>
              {!m.last && (
                <details>
                  <summary>End or transfer membership</summary>
                  <ClassForm action={action} label="Save membership change">
                    <input type="hidden" name="action" value="leave" />
                    <input type="hidden" name="squad" value={squad.id} />
                    <input type="hidden" name="member" value={m.id} />
                    <label>
                      First day outside this squad
                      <input type="date" name="day" required />
                    </label>
                    <label>
                      Destination
                      <select name="destination">
                        <option value="">Leave squad</option>
                        {squads
                          .filter((s) => s.id !== squad.id)
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </ClassForm>
                </details>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
