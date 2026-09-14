import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { redirect } from 'next/navigation';
import UsersClient from './UsersClient';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  const [rawUsers, orgs] = await Promise.all([
    sql`
      SELECT u.id, u.username, u.name, u.role, u.created_at,
        o.id AS organisation_id, o.name AS organisation_name
      FROM users u
      LEFT JOIN organisations o ON o.id = u.organisation_id
      ORDER BY u.created_at ASC
    `,
    sql`SELECT id, name, slug FROM organisations ORDER BY name ASC`,
  ]);

  // users.role is a real Postgres enum (UserRole: SUPER_ADMIN, ADMIN,
  // MANAGER, ANALYST, VIEWER) and comes back from this raw SQL query
  // UPPERCASE, unmodified. UsersClient's role <select> options are
  // lowercase (matching the Role type used by app/actions/users.ts's
  // updateUserRole()) — without normalizing here, the select's bound
  // value never matches any of its own <option> values, and the browser
  // silently falls back to displaying the FIRST option ("Super Admin")
  // for every row regardless of the user's actual role. Normalized once
  // here, at the server boundary, matching the same established
  // convention middleware.ts and lib/org.ts's requireSession() already
  // use for session.role.
  const users = (rawUsers as { id: string; username: string; name: string; role: string; created_at: string; organisation_id: string | null; organisation_name: string | null }[])
    .map(u => ({ ...u, role: u.role.toLowerCase() }));

  return (
    <UsersClient
      users={users}
      orgs={orgs as { id: string; name: string; slug: string }[]}
      currentUserId={session.userId}
    />
  );
}
