import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

/** GET /api/admin/orgs — list all organisations */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const orgs = await sql`SELECT id, name, slug, created_at FROM organisations ORDER BY created_at DESC`;
  return NextResponse.json({ orgs });
}

/** POST /api/admin/orgs — create organisation */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const name = body.name?.trim();
  const slug = body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!slug) return NextResponse.json({ error: 'slug is required.' }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1)
    return NextResponse.json({ error: 'slug must be lowercase alphanumeric with hyphens.' }, { status: 400 });

  try {
    const rows = await sql`
      INSERT INTO organisations (name, slug) VALUES (${name}, ${slug}) RETURNING *
    `;
    return NextResponse.json({ org: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'An organisation with that slug already exists.' }, { status: 409 });
    }
    throw err;
  }
}
