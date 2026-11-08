import { notFound } from 'next/navigation';
import { publicClasses } from '@/lib/scheduling/coachClasses';
import { bookPublicClass } from '@/lib/scheduling/coachActions';
import BookingFields from '@/app/coaching/BookingFields';
import ClassForm from '@/app/coaching/ClassForm';
import styles from '@/app/coaching/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function PublicClasses({ params }: { params: Promise<{ org: string; link: string }> }) {
  const { org, link } = await params;
  const schedule = await publicClasses(org, link);
  if (!schedule) notFound();
  const action = bookPublicClass.bind(null, org, link);
  return (
    <main className={styles.page}>
      <h1>{schedule.name}</h1>
      {schedule.classes.length === 0 && <p>No upcoming classes are available.</p>}
      {schedule.classes.map((date) => (
        <section key={date.id} className={styles.panel}>
          <h2>{date.name}</h2>
          <p>
            {date.day} · {date.time} {date.timezone}
          </p>
          <p>
            {new Intl.NumberFormat('en-AU', { style: 'currency', currency: date.currency }).format(
              date.cents / 100,
            )}{' '}
            · {date.enrolled >= date.capacity ? 'Full' : date.capacity - date.enrolled + ' places available'}
          </p>
          {date.enrolled < date.capacity && (
            <ClassForm action={action} label="Book a place" once>
              <BookingFields date={date} />
            </ClassForm>
          )}
        </section>
      ))}
    </main>
  );
}
