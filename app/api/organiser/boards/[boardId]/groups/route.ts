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
  if (!name) return NextResponse.json({ error: 'Group name is required.' }, { status: 400 });
  const color = typeof body?.color === 'string' ? body.color : null;

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_groups WHERE board_id = ${boardId}
  `;
  const position = posRows[0].next as number;

  const rows = await sql`
    INSERT INTO organiser_groups (board_id, organisation_id, name, color, position)
    VALUES (${boardId}, ${session.organisationId}, ${name}, ${color}, ${position})
    RETURNING id, name, color, position
  `;

  return NextResponse.json({ group: rows[0] });
}
