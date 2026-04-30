import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const [user] = await sql`
    SELECT
      u.id, u.username, u.name, u.email, u.role,
      u.first_name, u.last_name, u.display_name, u.avatar_url, u.bio,
      u.job_title, u.department, u.phone, u.timezone, u.preferences,
      u.created_at, u.last_seen_at,
      o.name  AS org_name,
      o.slug  AS org_slug,
      o.industry AS org_industry,
      o.logo_url AS org_logo_url,
      o.website  AS org_website
    FROM users u
    JOIN organisations o ON o.id = u.organisation_id
    WHERE u.id = ${session.userId}
  `;

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const modules = await sql`
    SELECT m.key, m.name, m.industry, m.description
    FROM organisation_modules om
    JOIN modules m ON m.id = om.module_id
    WHERE om.organisation_id = ${session.organisationId}
      AND om.enabled = true
    ORDER BY m.name
  `;

  return NextResponse.json({ user, modules });
}

const ALLOWED_FIELDS = [
  'first_name', 'last_name', 'display_name', 'avatar_url', 'bio',
  'job_title', 'department', 'phone', 'timezone', 'preferences',
] as const;

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;

  // Only allow safe profile fields — never role, organisation_id, etc.
  const updates: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
  }

  // Build dynamic SET clause safely using individual column checks
  const {
    first_name, last_name, display_name, avatar_url, bio,
    job_title, department, phone, timezone, preferences,
  } = updates as Partial<Record<typeof ALLOWED_FIELDS[number], unknown>>;

  try {
    await sql`
      UPDATE users SET
        first_name   = COALESCE(${(first_name as string) ?? null}, first_name),
        last_name    = COALESCE(${(last_name as string) ?? null}, last_name),
        display_name = COALESCE(${(display_name as string) ?? null}, display_name),
        avatar_url   = COALESCE(${(avatar_url as string) ?? null}, avatar_url),
        bio          = COALESCE(${(bio as string) ?? null}, bio),
        job_title    = COALESCE(${(job_title as string) ?? null}, job_title),
        department   = COALESCE(${(department as string) ?? null}, department),
        phone        = COALESCE(${(phone as string) ?? null}, phone),
        timezone     = COALESCE(${(timezone as string) ?? null}, timezone),
        preferences  = COALESCE(${preferences != null ? JSON.stringify(preferences) : null}::jsonb, preferences),
        updated_at   = NOW()
      WHERE id = ${session.userId}
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[account/profile PUT]', err);
    return NextResponse.json({ error: String((err as Error).message ?? 'Save failed') }, { status: 500 });
  }
}
