import Link from 'next/link';
import { redirect } from 'next/navigation';
import { coachingAccess } from '@/lib/tennisBusiness/coachingAccess';
import CoachingRecovery from './CoachingRecovery';
export default async function CoachingPage() {
  const access = await coachingAccess(false);
  if (!access.ok) {
    if (access.status === 401) redirect('/login');
    return <section><h1>Coaching timetable unavailable</h1><p>This staff view needs LD Tennis Scheduling access.</p></section>;
  }
  return <><p><Link href="/business/tennis">LD Tennis business</Link> · Your existing coaching sessions, bookings and attendance.</p><CoachingRecovery /></>;
}
