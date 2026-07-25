import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

const TYPES = new Set(['text', 'number', 'date', 'status', 'checkbox']);

const DEFAULT_STATUS_OPTIONS = [
  { label: 'Low', color: '#60A5FA' },
  { label: 'Medium', color: '#F59E0B' },
  { label: 'High', color: '#EF4444' },
];

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
  if (!name) return NextResponse.json({ error: 'Column name is required.' }, { status: 400 });

  const type = typeof body?.type === 'string' ? body.type : '';
  if (!TYPES.has(type)) return NextResponse.json({ error: 'Invalid column type.' }, { status: 400 });

  const options = type === 'status'
    ? (Array.isArray(body?.options) ? body.options : DEFAULT_STATUS_OPTIONS)
    : [];

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_columns WHERE board_id = ${boardId}
  `;
  const position = posRows[0].next as number;

  const rows = await sql`
    INSERT INTO organiser_columns (board_id, organisation_id, name, type, options, position)
    VALUES (${boardId}, ${session.organisationId}, ${name}, ${type}, ${JSON.stringify(options)}::jsonb, ${position})
    RETURNING id, name, type, options, position
  `;

  return NextResponse.json({ column: rows[0] });
}
