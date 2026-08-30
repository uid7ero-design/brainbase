import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

const OVERRIDE_COOKIE = 'org_override';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

/** GET — return current impersonation state */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const jar   = await cookies();
  const orgId = jar.get(OVERRIDE_COOKIE)?.value ?? null;

  if (!orgId) return NextResponse.json({ orgId: null, orgName: null });

  // organisations.id is TEXT (confirmed Production schema — see
  // app/api/admin/orgs/route.ts's own identical fix, adminOrgSavePath
  // test suite), never uuid — an explicit ::uuid cast on one side of
  // an equality comparison against a TEXT column has no matching
  // operator in Postgres and fails outright, regardless of whether the
  // id string happens to be UUID-shaped (LD Tennis's is; a cuid like
  // City of Onkaparinga's is not, but even LD Tennis's genuinely
  // UUID-shaped id failed this comparison before this fix).
  const [org] = await sql`SELECT name FROM organisations WHERE id = ${orgId} LIMIT 1`;
  return NextResponse.json({ orgId, orgName: org?.name ?? null });
}

/** POST { orgId } — set override */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const { orgId } = await req.json() as { orgId: string };
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

  // See the GET handler's own comment — organisations.id is TEXT, no
  // ::uuid cast.
  const [org] = await sql`SELECT id, name FROM organisations WHERE id = ${orgId} LIMIT 1`;
  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 });

  const jar = await cookies();
  jar.set(OVERRIDE_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  return NextResponse.json({ ok: true, orgId, orgName: org.name });
}

/** DELETE — clear override (back to own org) */
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const jar = await cookies();
  jar.delete(OVERRIDE_COOKIE);
  return NextResponse.json({ ok: true });
}
