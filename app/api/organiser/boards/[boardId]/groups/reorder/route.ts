import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';
import { resequenceOrganiserGroupScope } from '@/lib/organiser/reorderTransactions';

// Phase D.4.7E (Slice E2) — group reorder within one board. A thin HTTP
// wrapper: every actual lock/validate/resequence decision lives in
// resequenceOrganiserGroupScope (lib/organiser/reorderTransactions.ts),
// proven against real Postgres in that module's own integration test. This
// route only resolves the authorized session/board and maps the
// primitive's result onto a response — it never re-implements or
// duplicates that SQL. Deliberately writes no history/audit row of any
// kind (a pure reorder is position-only, matching every other Organiser
// PATCH route's own convention of excluding position from that record) —
// this route is intentionally absent from the explicit allow-list in
// tests/containment/organiserItemActivity.test.ts, which requires every
// other route file to contain zero references to that mechanism at all.
export async function POST(req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId } = await params;
  const board = await sql`
    SELECT id FROM organiser_boards WHERE id = ${boardId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (board.length === 0) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const orderedGroupIds = Array.isArray(body?.ordered_group_ids)
    ? body.ordered_group_ids.filter((id: unknown): id is string => typeof id === 'string')
    : null;
  if (!orderedGroupIds || orderedGroupIds.length !== body?.ordered_group_ids?.length) {
    return NextResponse.json({ error: 'ordered_group_ids must be an array of strings.' }, { status: 400 });
  }

  const result = await resequenceOrganiserGroupScope(
    { organisationId: session.organisationId, boardId },
    orderedGroupIds,
  );

  if (!result.ok) {
    if (result.reason === 'malformed') {
      return NextResponse.json({ error: 'ordered_group_ids contains an invalid id.' }, { status: 400 });
    }
    // duplicate / extra / missing / count_mismatch all mean the same thing
    // from the client's point of view: its view of the board's group order
    // no longer matches reality (a group was added/removed/moved
    // elsewhere since the client last loaded it) — never distinguished
    // further, matching the same "generic reason, no existence side
    // channel" discipline every other Organiser relationship-validation
    // error in this codebase already follows.
    return NextResponse.json({ error: "Board's group order changed. Refresh and try again." }, { status: 409 });
  }

  return NextResponse.json({ order: result.order });
}
