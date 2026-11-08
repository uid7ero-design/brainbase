import Link from 'next/link';
import { notFound } from 'next/navigation';
import { authorizeSchedulingRequest } from '@/lib/scheduling/access';
import { RosterScreen } from '@/app/scheduling/_components/CoachingWorkspaceScreen';
import { readRoster, tennisTermChoices } from '@/lib/scheduling/coachClasses';
import { manageClass } from '@/lib/scheduling/coachActions';
import { getStaffBookingVisibility } from '@/lib/scheduling/staffBookingVisibility';
import ClassForm from '../../ClassForm';
import BookingFields from '../../BookingFields';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function Roster({ params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeSchedulingRequest('scheduling.reserve');
  if (!auth.ok) notFound();
  const org = auth.session.organisationId;
  const date = await readRoster(org, (await params).id);
  if (!date) notFound();
  const staffBooking = await getStaffBookingVisibility();
  const canEnrol = staffBooking && date.open && date.enrolled < date.capacity;
  const action = manageClass.bind(null, org);
  const canGroup =
    date.tennis &&
    date.open &&
    !date.archived &&
    !date.term &&
    (await authorizeSchedulingRequest('scheduling.manage')).ok;
  const choices = canGroup ? await tennisTermChoices(org, date.id) : [];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: date.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    <main className={styles.page}>
      <Link href={'/coaching/calendar?week=' + date.day}>Back to class calendar</Link>
      <h1>{date.name}</h1>
      <p>
        {date.day} · {date.time} {date.timezone} · {date.schedule}
      </p>
      <p>
        {date.term && <>{date.term.name} · </>}
        {date.enrolled} of {date.capacity} places filled
      </p>
      {date.tennis ? (
        <RosterScreen
          key={date.id + ':' + date.enrolled}
          id={date.id}
          active={!date.archived}
          today={today}
        />
      ) : (
        <section className={styles.panel}>
          <h2>Class roster</h2>
          {date.members.length === 0 && <p>No enrolments yet.</p>}
          {date.members.map((member) => (
            <article key={member.id}>
              <h3>{member.name}</h3>
              <p>
                {member.recurring && <>Term enrolment · </>}
                {member.status} · {member.attendance ?? 'Attendance unmarked'}
              </p>
              {member.status === 'confirmed' && date.status !== 'cancelled' && (
                <div className={styles.controls}>
                  {(['attended', 'absent', 'cancel'] as const)
                    .filter(
                      (value) =>
                        value !== member.attendance &&
                        (value !== 'cancel' || (!member.attendance && member.paid === 'unpaid')),
                    )
                    .map((value) => (
                      <ClassForm
                        key={value}
                        action={action}
                        label={value === 'cancel' ? 'Cancel enrolment' : 'Mark ' + value}
                      >
                        <input type="hidden" name="action" value={value} />
                        <input type="hidden" name="class" value={date.id} />
                        <input type="hidden" name="member" value={member.id} />
                        <input type="hidden" name="version" value={member.version} />
                      </ClassForm>
                    ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      {canGroup && choices.length < 2 && (
        <p>
          To start a term here, add another weekly date before the next term begins.{' '}
          <Link href="/scheduling/schedules/tennis-coaching">Manage Tennis class dates</Link>
        </p>
      )}
      {choices.length >= 2 && (
        <section className={styles.panel}>
          <h2>Group existing dates into a term</h2>
          <ClassForm action={action} label="Create term from these dates">
            <input type="hidden" name="action" value="group-tennis-term" />
            <input type="hidden" name="class" value={date.id} />
            <label>
              Term name <input name="termName" required maxLength={120} />
            </label>
            <label>
              Last scheduled class{' '}
              <select name="expectedDates">
                {choices.slice(1).map((d, i) => (
                  <option key={d.id} value={JSON.stringify(choices.slice(0, i + 2).map((c) => c.id))}>
                    {d.day} · {i + 2} classes
                  </option>
                ))}
              </select>
            </label>
          </ClassForm>
        </section>
      )}
      {canEnrol && !date.archived && (!date.tennis || (date.term && date.term.dates.length > 1)) && (
          <section className={styles.panel}>
            <h2>Enrol a participant</h2>
            <p>
              Class fee per place ·{' '}
              {new Intl.NumberFormat('en-AU', { style: 'currency', currency: date.currency }).format(
                date.cents / 100,
              )}
            </p>
            <ClassForm
              key={date.tennis ? date.enrolled : date.members.length}
              action={action}
              label="Enrol participant"
            >
              <input type="hidden" name="action" value="enrol" />
              <BookingFields date={date} />
              {date.term && date.term.dates.length > 1 && (
                <>
                  <input type="hidden" name="expectedDates" value={JSON.stringify(date.term.dates)} />
                  <label>
                    Enrolment covers{' '}
                    <select name="coverage" defaultValue={date.tennis ? 'term' : 'single'}>
                      {!date.tennis && <option value="single">This class only</option>}
                      <option value="term">
                        Remaining term · {date.term.dates.length} classes through {date.term.last}
                      </option>
                    </select>
                  </label>
                </>
              )}
            </ClassForm>
          </section>
        )}
    </main>
  );
}
