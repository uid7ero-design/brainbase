import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import SocialClient from './SocialClient';
import { IS_DEMO_MODE } from '@/lib/social/demo';

export default async function SocialPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <SocialClient isDemo={IS_DEMO_MODE} />;
}
