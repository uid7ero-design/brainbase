import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ role: null, name: null }, { status: 401 });

  // Fetch extended profile + org info + enabled modules
  let profile: Record<string, unknown> | null = null;
  let org: { name: string; industry: string | null; logo_url: string | null } | null = null;
  let enabledModules: { key: string; name: string; industry: string }[] = [];

  try {
    const [userRow] = await sql`
      SELECT
        id, username, name, email, role,
        first_name, last_name, display_name, avatar_url, bio,
        job_title, department, phone, timezone, preferences, last_seen_at
      FROM users
      WHERE id = ${session.userId}
    `;
    if (userRow) profile = userRow as Record<string, unknown>;

    const [orgRow] = await sql`
      SELECT name, industry, logo_url
      FROM organisations
      WHERE id = ${session.organisationId}
    `;
    if (orgRow) org = orgRow as unknown as typeof org;

    const modules = await sql`
      SELECT m.key, m.name, m.industry
      FROM organisation_modules om
      JOIN modules m ON m.id = om.module_id
      WHERE om.organisation_id = ${session.organisationId}
        AND om.enabled = true
      ORDER BY m.name
    `;
    enabledModules = modules as typeof enabledModules;

    // Update last_seen_at
    await sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${session.userId}`;
  } catch {
    // Tables may not exist yet (pre-migration) — return minimal session data
  }

  return NextResponse.json({
    userId:         session.userId,
    organisationId: session.organisationId ?? null,
    role:           session.role,
    name:           session.name,
    profile:        profile ?? null,
    org:            org ?? null,
    enabledModules,
  });
}
