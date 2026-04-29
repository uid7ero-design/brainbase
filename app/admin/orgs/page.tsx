import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import AdminClient from './AdminClient';

export default async function AdminOrgsPage() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  const [orgs, users] = await Promise.all([
    sql`SELECT id, name, slug, created_at FROM organisations ORDER BY created_at DESC`.catch(() => []),
    sql`
      SELECT u.id, u.username, u.name, u.email, u.role, u.organisation_id,
             o.name AS org_name
      FROM users u
      LEFT JOIN organisations o ON o.id = u.organisation_id
      ORDER BY u.created_at DESC
    `.catch(() => []),
  ]);

  return (
    <AdminClient
      orgs={orgs as { id: string; name: string; slug: string; created_at: string }[]}
      users={users as { id: string; username: string; name: string; email: string; role: string; organisation_id: string; org_name: string }[]}
    />
  );
}
