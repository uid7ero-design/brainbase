import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const updates = await sql`
    SELECT id, author_name, body, created_at
    FROM organiser_item_updates
    WHERE item_id = ${itemId} AND organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;
  return NextResponse.json({ updates });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const itemRows = await sql`
    SELECT id, board_id FROM organiser_items WHERE id = ${itemId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (itemRows.length === 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  const boardId = itemRows[0].board_id as string;

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'Update text is required.' }, { status: 400 });

  const rows = await sql`
    INSERT INTO organiser_item_updates (item_id, board_id, organisation_id, author_name, body)
    VALUES (${itemId}, ${boardId}, ${session.organisationId}, ${session.name}, ${text})
    RETURNING id, author_name, body, created_at
  `;

  return NextResponse.json({ update: rows[0] });
}
