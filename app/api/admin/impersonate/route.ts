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

  const [org] = await sql`SELECT name FROM organisations WHERE id = ${orgId}::uuid LIMIT 1`;
  return NextResponse.json({ orgId, orgName: org?.name ?? null });
}

/** POST { orgId } — set override */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const { orgId } = await req.json() as { orgId: string };
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

  const [org] = await sql`SELECT id, name FROM organisations WHERE id = ${orgId}::uuid LIMIT 1`;
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
