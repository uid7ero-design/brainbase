import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function GET() {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const boards = await sql`
    SELECT
      b.id, b.name, b.color, b.icon, b.position, b.created_at, b.updated_at,
      COUNT(i.id) FILTER (WHERE i.id IS NOT NULL) AS item_count
    FROM organiser_boards b
    LEFT JOIN organiser_items i ON i.board_id = b.id
    WHERE b.organisation_id = ${session.organisationId}
    GROUP BY b.id
    ORDER BY b.position ASC, b.created_at ASC
  `;

  return NextResponse.json({ boards });
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Board name is required.' }, { status: 400 });
  const color = typeof body?.color === 'string' ? body.color : null;

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_boards WHERE organisation_id = ${session.organisationId}
  `;
  const position = posRows[0].next as number;

  const rows = await sql`
    INSERT INTO organiser_boards (organisation_id, name, color, position, created_by)
    VALUES (${session.organisationId}, ${name}, ${color}, ${position}, ${session.userId})
    RETURNING id, name, color, icon, position, created_at, updated_at
  `;

  return NextResponse.json({ board: { ...rows[0], item_count: 0 } });
}
