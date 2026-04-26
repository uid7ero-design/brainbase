import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { redirect } from 'next/navigation';
import UsersClient from './UsersClient';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  const [users, orgs] = await Promise.all([
    sql`
      SELECT u.id, u.username, u.name, u.role, u.created_at,
        o.id AS organisation_id, o.name AS organisation_name
      FROM users u
      LEFT JOIN organisations o ON o.id = u.organisation_id
      ORDER BY u.created_at ASC
    `,
    sql`SELECT id, name, slug FROM organisations ORDER BY name ASC`,
  ]);

  return (
    <UsersClient
      users={users as { id: string; username: string; name: string; role: string; created_at: string; organisation_id: string | null; organisation_name: string | null }[]}
      orgs={orgs as { id: string; name: string; slug: string }[]}
      currentUserId={session.userId}
    />
  );
}
