import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;

  const boardRows = await sql`
    SELECT id, name, color, icon, position, created_at, updated_at
    FROM organiser_boards
    WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (boardRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const groups = await sql`
    SELECT id, name, color, position
    FROM organiser_groups
    WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
    ORDER BY position ASC, created_at ASC
  `;

  const items = await sql`
    SELECT id, group_id, parent_item_id, name, status, priority, owner,
           due_date::text AS due_date, notes, fields, custom_values, position, created_at, updated_at
    FROM organiser_items
    WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
    ORDER BY position ASC, created_at ASC
  `;

  const columns = await sql`
    SELECT id, name, type, options, position
    FROM organiser_columns
    WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
    ORDER BY position ASC, created_at ASC
  `;

  return NextResponse.json({ board: boardRows[0], groups, items, columns });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const color = typeof body.color === 'string' ? body.color : null;
  const position = typeof body.position === 'number' ? body.position : null;

  const rows = await sql`
    UPDATE organiser_boards SET
      name       = COALESCE(${name}, name),
      color      = COALESCE(${color}, color),
      position   = COALESCE(${position}, position),
      updated_at = NOW()
    WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
    RETURNING id, name, color, icon, position, created_at, updated_at
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ board: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;

  const rows = await sql`
    DELETE FROM organiser_boards
    WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
    RETURNING id
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
