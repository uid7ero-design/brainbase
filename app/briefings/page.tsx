import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import BriefingsClient from './BriefingsClient';

export default async function BriefingsPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return <BriefingsClient />;
}
