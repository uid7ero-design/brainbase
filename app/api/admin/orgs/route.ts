import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

/** GET /api/admin/orgs — list all organisations */
export async function GET() {
  try { await requireRole('super_admin'); } catch { return forbidden(); }

  const orgs = await sql`SELECT id, name, slug, created_at FROM organisations ORDER BY created_at DESC`;
  return NextResponse.json({ orgs });
}

/** PATCH /api/admin/orgs?id=… — update name/slug */
export async function PATCH(req: NextRequest) {
  try { await requireRole('super_admin'); } catch { return forbidden(); }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const name = body.name?.trim();
  const slug = body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!slug) return NextResponse.json({ error: 'slug is required.' }, { status: 400 });

  try {
    const rows = await sql`
      UPDATE organisations SET name = ${name}, slug = ${slug}
      WHERE id = ${id} RETURNING *
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ org: rows[0] });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate'))
      return NextResponse.json({ error: 'Slug already in use.' }, { status: 409 });
    throw err;
  }
}

/** DELETE /api/admin/orgs?id=… — remove organisation */
export async function DELETE(req: NextRequest) {
  try { await requireRole('super_admin'); } catch { return forbidden(); }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const [check] = await sql`SELECT COUNT(*)::int AS n FROM users WHERE organisation_id = ${id}`;
  if ((check.n as number) > 0)
    return NextResponse.json({ error: `Cannot delete: ${check.n} user(s) still assigned. Reassign or delete them first.` }, { status: 409 });

  try {
    await sql`DELETE FROM organisations WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('foreign key') || msg.includes('violates') || msg.includes('still referenced')) {
      return NextResponse.json({ error: 'Cannot delete: this organisation still has related data (uploads, records, or logs). Delete that data first or contact support.' }, { status: 409 });
    }
    return NextResponse.json({ error: `Delete failed: ${msg}` }, { status: 500 });
  }
}

/** POST /api/admin/orgs — create organisation */
export async function POST(req: NextRequest) {
  try { await requireRole('super_admin'); } catch { return forbidden(); }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const name = body.name?.trim();
  const slug = body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!slug) return NextResponse.json({ error: 'slug is required.' }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1)
    return NextResponse.json({ error: 'slug must be lowercase alphanumeric with hyphens.' }, { status: 400 });

  try {
    // organisations.id and .updated_at both have NO database-level
    // default — Organisation.id's Prisma model declares
    // `@default(cuid())` (not `@default(dbgenerated(...))`) and
    // .updated_at uses plain `@updatedAt`, both of which are
    // APPLICATION-side defaults Prisma Client applies itself; neither
    // exists as an actual Postgres DEFAULT expression on the column
    // (confirmed via information_schema.columns against DEV:
    // column_default is null for both, and both are NOT NULL). A raw
    // SQL INSERT that omits them — as this one previously did — always
    // fails with "null value in column ... violates not-null
    // constraint", unconditionally, for every organisation creation
    // attempt. gen_random_uuid()::text for id matches the exact
    // convention every other raw-SQL-inserted TEXT primary key in this
    // codebase already uses; now() for updated_at matches created_at's
    // own already-working default pattern.
    const rows = await sql`
      INSERT INTO organisations (id, name, slug, updated_at)
      VALUES (gen_random_uuid()::text, ${name}, ${slug}, now())
      RETURNING *
    `;
    return NextResponse.json({ org: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'An organisation with that slug already exists.' }, { status: 409 });
    }
    // Never re-throw into Next.js's own generic error handling here —
    // that previously produced an EMPTY response body (confirmed
    // against real DEV), which made the client's res.json() call throw
    // its own parse error downstream, permanently stranding the
    // "Creating…" UI state (see AdminClient.tsx's createOrg — now
    // fixed to tolerate this too, but this route should never rely on
    // that as its only safety net). Always return a real JSON error
    // body, matching the DELETE handler's own established convention
    // in this same file.
    console.error('[admin orgs] create failed', err);
    return NextResponse.json({ error: `Create failed: ${msg}` }, { status: 500 });
  }
}
