import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function POST(req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;
  const board = await sql`
    SELECT id FROM organiser_boards WHERE id = ${boardId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (board.length === 0) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Item name is required.' }, { status: 400 });

  const groupId = typeof body?.group_id === 'string' ? body.group_id : null;
  const parentItemId = typeof body?.parent_item_id === 'string' ? body.parent_item_id : null;
  const status = typeof body?.status === 'string' && body.status ? body.status : 'Not Started';

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_items
    WHERE board_id = ${boardId} AND parent_item_id IS NOT DISTINCT FROM ${parentItemId}
  `;
  const position = posRows[0].next as number;

  const rows = await sql`
    INSERT INTO organiser_items (board_id, organisation_id, group_id, parent_item_id, name, status, position)
    VALUES (${boardId}, ${session.organisationId}, ${groupId}, ${parentItemId}, ${name}, ${status}, ${position})
    RETURNING id, group_id, parent_item_id, name, status, priority, owner, due_date::text AS due_date, notes, fields, custom_values, position, created_at, updated_at
  `;

  return NextResponse.json({ item: rows[0] });
}
