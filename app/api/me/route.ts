import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession } from '@/lib/org';
import { resolveDashboardVariant } from '@/lib/dashboard/clientDashboard';

export async function GET() {
  // requireSession() (not the raw getSession() JWT decode), for the
  // exact same reason as app/layout.tsx's own identical switch: this is
  // TopNav's client-fetch fallback path, and its enabledCapabilities/
  // dashboardVariant projection must reflect an active super_admin
  // org_override — otherwise the nav silently shows the founder's OWN
  // capabilities while "viewing as" a client org instead of that org's.
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ role: null, name: null }, { status: 401 });
  }

  // Fetch extended profile + org info + enabled modules
  let profile: Record<string, unknown> | null = null;
  let org: { name: string; industry: string | null; logo_url: string | null } | null = null;
  let enabledModules: { key: string; name: string; industry: string }[] = [];
  // Platform capability projection (Phase F.6F) — UX data only, not an
  // authorization boundary. Server routes remain the enforcement
  // authority via lib/capabilities/requireCapability.ts. Kept in its
  // own try/catch below, independent of the block above, so a failure
  // here can never affect profile/org/enabledModules/last_seen_at, and
  // vice versa.
  let enabledCapabilities: { key: string; name: string }[] = [];

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

  try {
    const capabilities = await sql`
      SELECT m.key, m.name
      FROM organisation_modules om
      JOIN modules m ON m.key = om.module_key
      WHERE om.organisation_id = ${session.organisationId}
        AND om.enabled = true
        AND m.active = true
      ORDER BY m.name
    `;
    enabledCapabilities = capabilities as typeof enabledCapabilities;
  } catch {
    // UX projection only — fail closed to an empty list, never leak the error.
  }

  // Same slug-driven resolver app/dashboard/page.tsx and app/layout.tsx
  // already use to pick the bespoke client experience (if any) an
  // organisation owns — reused here so TopNav's client-fetch fallback
  // (this endpoint) can gate LD-Tennis-specific nav items with the same
  // rule the server-rendered path already applies via serverSession.
  const dashboardVariant = await resolveDashboardVariant(session.organisationId, session.role);

  return NextResponse.json({
    userId:         session.userId,
    organisationId: session.organisationId ?? null,
    role:           session.role,
    name:           session.name,
    profile:        profile ?? null,
    org:            org ?? null,
    enabledModules,
    enabledCapabilities,
    dashboardVariant,
  });
}
