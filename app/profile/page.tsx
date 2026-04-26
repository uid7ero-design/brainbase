import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import sql from '@/lib/db';
import ProfileClient from './ProfileClient';

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const rows = await sql`SELECT username, name FROM users WHERE id = ${session.userId} LIMIT 1`;
  const user = rows[0];

  return <ProfileClient name={String(user.name)} username={String(user.username)} />;
}
