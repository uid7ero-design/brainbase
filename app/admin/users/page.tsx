import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { redirect } from 'next/navigation';
import UsersClient from './UsersClient';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  const users = await sql`SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC`;

  return <UsersClient users={users as { id: string; username: string; name: string; role: string; created_at: string }[]} currentUserId={session.userId} />;
}
