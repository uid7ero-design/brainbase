import Link from 'next/link';
import { notFound } from 'next/navigation';
import { authorizeSchedulingRequest } from '@/lib/scheduling/access';
import { readRoster } from '@/lib/scheduling/coachClasses';
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
  const action = manageClass.bind(null, org);
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
      {staffBooking && date.open && date.enrolled < date.capacity && (
        <section className={styles.panel}>
          <h2>Enrol a participant</h2>
          <p>
            Class fee per place ·{' '}
            {new Intl.NumberFormat('en-AU', { style: 'currency', currency: date.currency }).format(
              date.cents / 100,
            )}
          </p>
          <ClassForm key={date.members.length} action={action} label="Enrol participant">
            <input type="hidden" name="action" value="enrol" />
            <BookingFields date={date} />
            {date.term && date.term.dates.length > 1 && (
              <>
                <input type="hidden" name="expectedDates" value={JSON.stringify(date.term.dates)} />
                <label>
                  Enrolment covers{' '}
                  <select name="coverage" defaultValue="single">
                    <option value="single">This class only</option>
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
