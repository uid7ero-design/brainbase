import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ columnId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { columnId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name     = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const position = typeof body.position === 'number' ? body.position : null;
  const options  = Array.isArray(body.options) ? JSON.stringify(body.options) : null;

  const rows = await sql`
    UPDATE organiser_columns SET
      name     = COALESCE(${name}, name),
      position = COALESCE(${position}, position),
      options  = COALESCE(${options}::jsonb, options)
    WHERE id = ${columnId} AND organisation_id = ${session.organisationId}
    RETURNING id, name, type, options, position
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ column: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ columnId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { columnId } = await params;

  const rows = await sql`
    DELETE FROM organiser_columns
    WHERE id = ${columnId} AND organisation_id = ${session.organisationId}
    RETURNING id
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Column values live inside organiser_items.custom_values keyed by column id —
  // strip the now-orphaned key from every item on this org so stale data doesn't
  // linger (harmless if left, but keeps things tidy for a future re-added column
  // with a colliding id, and avoids unbounded growth of the jsonb blob).
  await sql`
    UPDATE organiser_items
    SET custom_values = custom_values - ${columnId}
    WHERE organisation_id = ${session.organisationId} AND custom_values ? ${columnId}
  `;

  return NextResponse.json({ success: true });
}
