import Link from 'next/link';
import { notFound } from 'next/navigation';
import { authorizeSchedulingRequest } from '@/lib/scheduling/access';
import { trainingSession } from '@/lib/scheduling/coachClasses';
import { saveTrainingPlan } from '@/lib/scheduling/coachActions';
import TrainingEditor from './TrainingEditor';
import styles from './plan.module.css';

export const dynamic = 'force-dynamic';
export default async function Training({ params }: { params: Promise<{ id: string }> }) {
  const [roster, manage, { id }] = await Promise.all([
    authorizeSchedulingRequest('scheduling.reserve'),
    authorizeSchedulingRequest('scheduling.manage'),
    params,
  ]);
  if (!roster.ok) notFound();
  const org = roster.session.organisationId;
  const session = await trainingSession(org, id);
  if (!session) notFound();
  const editable =
    manage.ok &&
    manage.session.organisationId === org &&
    manage.session.userId === roster.session.userId &&
    session.editable;
  return (
    <main className={styles.page}>
      <Link href={'/coaching/roster/' + encodeURIComponent(id)}>Back to class roster</Link>
      <header>
        <p>
          {session.schedule} · {session.day} · {session.time}
          {session.venue ? ' · ' + session.venue : ''}
        </p>
        <h1>{session.name} training plan</h1>
      </header>
      <TrainingEditor
        key={org + ':' + id}
        initial={session.drills}
        defaultLayout={session.tennis ? 'court' : 'blank'}
        version={session.version}
        editable={editable}
        minutes={session.minutes}
        players={session.players}
        templates={editable ? session.templates : []}
        save={saveTrainingPlan.bind(null, org, id)}
      />
    </main>
  );
}
