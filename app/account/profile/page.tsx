import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import ProfileClient from './ProfileClient';

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let user: Record<string, unknown> = {};
  let org: Record<string, unknown> = {};
  // Phase C1.3: corrected join (was m.id = om.module_id — modules has no
  // `id`/`industry` column under the current schema; threw on every call, so
  // this panel never rendered anything for anyone). Now queried in its own
  // try/catch, separate from user/org, so a failure here can never affect
  // those. `industry` is dropped (never a real modules column) in favour of
  // `description`, which is. Same known data-model gap as
  // lib/agents/briefingAgent.ts's getEnabledModules(): the capability
  // registry currently only contains 'crm' | 'organiser' | 'events', not the
  // legacy industry-vertical keys (waste_recycling/fleet_management/etc.)
  // this panel originally displayed — so it will now correctly show an org's
  // real enabled platform capabilities instead, once any are enabled.
  let modules: { key: string; name: string; description: string | null }[] = [];

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
  } catch {
    // Pre-migration — show empty state
  }

  try {
    const modRows = await sql`
      SELECT m.key, m.name, m.description
      FROM organisation_modules om
      JOIN modules m ON m.key = om.module_key
      WHERE om.organisation_id = ${session.organisationId}
        AND om.enabled = true
      ORDER BY m.name
    `;
    modules = modRows as typeof modules;
  } catch {
    // Fail closed to an empty list.
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
