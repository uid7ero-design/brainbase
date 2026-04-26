import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DataClient from './DataClient';

export default async function DataPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const isAdmin = ['admin', 'super_admin'].includes(session.role);
  return <DataClient canDelete={isAdmin} />;
}
