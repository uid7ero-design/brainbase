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

  // Phase D.4.5F — comment.created, atomic with the INSERT. item_id is set
  // (this is the whole reason the Item Activity tab can also show this
  // event — see lib/organiser/activityRead.ts's listItemActivity, which
  // now allow-lists entity_type IN ('item','comment','file') rather than
  // 'item' alone). The full comment body is never copied into activity —
  // only a bounded excerpt, truncated by the SAME
  // organiser_activity_sanitise_scalar policy every other string field
  // uses (200 chars + an explicit "…(truncated)" marker) — the durable
  // organiser_item_updates row remains the sole source of truth for the
  // full comment body.
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO organiser_item_updates (item_id, board_id, organisation_id, author_name, body)
      VALUES (${itemId}, ${boardId}, ${session.organisationId}, ${session.name}, ${text})
      RETURNING id, author_name, body, created_at
    ),
    activity_row AS (
      INSERT INTO organiser_activity (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        ${session.organisationId}, ${boardId}, ${itemId}, ${session.userId}, ${session.name},
        'comment.created', 'comment', inserted.id::text, NULL,
        jsonb_build_object('excerpt', organiser_activity_sanitise_scalar(to_jsonb(inserted.body)))
      FROM inserted
      RETURNING id
    )
    SELECT id, author_name, body, created_at FROM inserted
  `;

  return NextResponse.json({ update: rows[0] });
}
