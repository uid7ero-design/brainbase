import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';
import { resequenceOrganiserItemScope } from '@/lib/organiser/reorderTransactions';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string; parentItemId: string }> },
) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId, parentItemId } = await params;
  if (!UUID_RE.test(parentItemId)) {
    return NextResponse.json({ error: 'Invalid parent item.' }, { status: 400 });
  }

  const board = await sql`
    SELECT id FROM organiser_boards
    WHERE id = ${boardId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (board.length === 0) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  const parent = await sql`
    SELECT id FROM organiser_items
    WHERE id = ${parentItemId}
      AND board_id = ${boardId}
      AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (parent.length === 0) return NextResponse.json({ error: 'Parent item not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const orderedItemIds = Array.isArray(body?.ordered_item_ids)
    ? body.ordered_item_ids.filter((id: unknown): id is string => typeof id === 'string')
    : null;
  if (!orderedItemIds || orderedItemIds.length !== body?.ordered_item_ids?.length) {
    return NextResponse.json({ error: 'ordered_item_ids must be an array of strings.' }, { status: 400 });
  }

  const result = await resequenceOrganiserItemScope(
    { type: 'subitems', organisationId: session.organisationId, boardId, parentItemId },
    orderedItemIds,
  );

  if (!result.ok) {
    if (result.reason === 'malformed') {
      return NextResponse.json({ error: 'ordered_item_ids contains an invalid id.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Subitem order changed. Refresh and try again.' }, { status: 409 });
  }

  return NextResponse.json({ order: result.order });
}
