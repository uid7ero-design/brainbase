import { redirect } from 'next/navigation';
import { tennisBusinessAccess } from '@/lib/tennisBusiness/access';
import TennisBusiness from './TennisBusiness';
export default async function TennisBusinessPage() {
  const access = await tennisBusinessAccess();
  if (!access.ok) {
    if (access.status === 401) redirect('/login');
    return <main style={{ padding: 24 }}><h1>Business workspace unavailable</h1><p>Ask your organisation administrator to check your access, or try again later.</p></main>;
  }
  return <TennisBusiness />;
}
