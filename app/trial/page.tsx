import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import TrialClient from './TrialClient';

export default async function TrialPage() {
  const session = await getSession();
  if (!session) redirect('/signup');
  return <TrialClient userName={session.name} />;
}
