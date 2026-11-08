import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSchedulingPageAccess } from '@/lib/scheduling/pageAccess';
import { requireSession } from '@/lib/org';
import { AccessMessage } from '@/app/scheduling/_components/AccessMessage';
import { classSchedules, coachLinkPattern, weekDates } from '@/lib/scheduling/coachClasses';
import { weekStart, addLocalDays, dateChoices } from '@/lib/scheduling/coachClassDates';
import { manageClass } from '@/lib/scheduling/coachActions';
import ClassForm from '../ClassForm';
import ClassDateForm from '../ClassDateForm';
import styles from '../workspace.module.css';
export const dynamic = 'force-dynamic';

export default async function Calendar({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const access = await getSchedulingPageAccess();
  if (access.status === 'unauthenticated') redirect('/login');
  if (access.status !== 'ok') return <AccessMessage status={access.status} />;
  const { organisationId: org } = await requireSession();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: access.timezone ?? 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let start: string;
  try {
    start = weekStart((await searchParams).week ?? today);
  } catch {
    notFound();
  }
  const [dates, choices, schedules] = await Promise.all([
    weekDates(org, start),
    access.canManage ? dateChoices(org) : [],
    access.canManage ? classSchedules(org) : [],
  ]);
  const action = manageClass.bind(null, org);
  return (
    <main className={styles.page}>
      <Link href="/coaching">Coach</Link>
      <h1>Weekly class calendar</h1>
      <nav aria-label="Calendar weeks" className={styles.controls}>
        <Link href={'?week=' + addLocalDays(start, -7)}>Previous week</Link>
        <Link href="/coaching/calendar">This week</Link>
        <Link href={'?week=' + addLocalDays(start, 7)}>Next week</Link>
      </nav>
      <form className={styles.controls}>
        <label>
          Week containing <input type="date" name="week" defaultValue={start} required />
        </label>
        <button>Show week</button>
      </form>
      <div className={styles.week}>
        {Array.from({ length: 7 }, (_, i) => {
          const day = addLocalDays(start, i),
            classes = dates.filter((c) => c.day === day);
          return (
            <section key={day}>
              <h2>
                {new Intl.DateTimeFormat('en-AU', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                }).format(new Date(day + 'T12:00:00Z'))}
              </h2>
              {classes.length === 0 ? (
                <p>No classes</p>
              ) : (
                classes.map((c) => (
                  <article key={c.id}>
                    <time>{c.time}</time>
                    <strong>
                      {access.canManage ? (
                        <Link href={'/coaching/roster/' + encodeURIComponent(c.id)}>{c.name}</Link>
                      ) : (
                        c.name
                      )}
                    </strong>
                    <small>
                      {c.term && <>{c.term} · </>}
                      {c.schedule} · {c.timezone}
                    </small>
                    <span>
                      {c.status === 'scheduled' ? c.enrolled + ' / ' + c.capacity + ' enrolled' : c.status}
                    </span>
                  </article>
                ))
              )}
            </section>
          );
        })}
      </div>
      {access.canManage && (
        <div className={styles.columns}>
          <section className={styles.panel}>
            <h2>Add a class date</h2>
            {choices.length ? (
              <ClassDateForm action={action}>
                <label>
                  Class and location{' '}
                  <select name="offering">
                    {choices.map((c) => (
                      <option
                        key={JSON.stringify([c.id, c.resource])}
                        value={JSON.stringify([c.id, c.resource])}
                      >
                        {c.name}
                        {c.venue ? ' · ' + c.venue : ''} · {c.zone}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Class date{' '}
                  <input type="date" name="day" required defaultValue={start < today ? today : start} />
                </label>
                <label>
                  Local start time <input type="time" name="time" required />
                </label>
              </ClassDateForm>
            ) : (
              <p>
                Open a group schedule and add a class offering with a duration and capacity.{' '}
                <Link href="/coaching">Open schedules</Link>
              </p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Public booking links</h2>
            <p>Enable a link to share the next 90 days of classes on that schedule.</p>
            {schedules.map((s) => (
              <div key={s.id}>
                <h3>{s.name}</h3>
                {s.slug && coachLinkPattern.test(s.slug) && (
                  <Link href={'/class-booking/' + encodeURIComponent(org) + '/' + s.slug}>
                    Open public booking page
                  </Link>
                )}
                {(!s.slug || coachLinkPattern.test(s.slug)) && (
                  <ClassForm action={action} label={s.slug ? 'Disable booking link' : 'Enable booking link'}>
                    <input type="hidden" name="action" value={s.slug ? 'unpublish' : 'publish'} />
                    <input type="hidden" name="schedule" value={s.id} />
                    <input type="hidden" name="slug" value={s.slug ?? ''} />
                  </ClassForm>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
