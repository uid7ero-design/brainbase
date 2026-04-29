import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import ProfileClient from './ProfileClient';

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let user: Record<string, unknown> = {};
  let org: Record<string, unknown> = {};
  let modules: { key: string; name: string; industry: string; description: string }[] = [];

  try {
    const [userRow] = await sql`
      SELECT
        id, username, name, email, role,
        first_name, last_name, display_name, avatar_url, bio,
        job_title, department, phone, timezone, preferences,
        created_at, last_seen_at
      FROM users
      WHERE id = ${session.userId}
    `;
    if (userRow) user = userRow as Record<string, unknown>;

    const [orgRow] = await sql`
      SELECT name, slug, industry, logo_url, website, contact_email, contact_phone, address
      FROM organisations
      WHERE id = ${session.organisationId}
    `;
    if (orgRow) org = orgRow as Record<string, unknown>;

    const modRows = await sql`
      SELECT m.key, m.name, m.industry, m.description
      FROM organisation_modules om
      JOIN modules m ON m.id = om.module_id
      WHERE om.organisation_id = ${session.organisationId}
        AND om.enabled = true
      ORDER BY m.name
    `;
    modules = modRows as typeof modules;
  } catch {
    // Pre-migration — show empty state
  }

  return (
    <ProfileClient
      initialUser={user}
      org={org}
      modules={modules}
      role={session.role}
    />
  );
}
