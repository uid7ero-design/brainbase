import { NextRequest, NextResponse } from 'next/server';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';
import { listItemActivity, listBoardActivity } from '@/lib/organiser/activityRead';

// Phase D.4.5D — GET-only, read-only Organiser activity endpoint, item-
// scoped (itemId). Phase D.4.5E adds the board-scoped sibling (boardId),
// for the board Activity feed's "what changed on this board" view — no
// broader, organisation-wide feed exists here. See
// lib/organiser/activityRead.ts's own header for the deletion-safe,
// tenant-scoped query design both scopes share.
//
// EXACTLY ONE SCOPE PER REQUEST: supplying both itemId and boardId, or
// neither, is a 400 — this route deliberately never guesses which scope a
// caller meant, and never silently prefers one over the other.
//
// AUTH: identical boundary to every other app/api/organiser/** route —
// authorizeOrganiserRequest('viewer') (session + 'organiser' capability +
// viewer role floor). organisationId comes exclusively from that call's
// own resolved session.organisationId; the request can never supply or
// override it (no organisation_id read from query/body/header anywhere in
// this file).
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

// Every current failure code from either service (INVALID_ITEM_ID/
// INVALID_BOARD_ID/INVALID_CURSOR/INVALID_LIMIT) is a caller input problem
// -> 400. A single constant, not a switch, so this stays correct by
// construction if either failure union ever grows without a matching case
// being added here.
const VALIDATION_FAILURE_STATUS = 400;

export async function GET(req: NextRequest) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const itemId = req.nextUrl.searchParams.get('itemId');
  const boardId = req.nextUrl.searchParams.get('boardId');

  if (itemId && boardId) {
    return NextResponse.json({ error: 'Supply only one of itemId or boardId, not both.' }, { status: 400, headers: CACHE_HEADERS });
  }
  if (!itemId && !boardId) {
    return NextResponse.json({ error: 'Either itemId or boardId is required.' }, { status: 400, headers: CACHE_HEADERS });
  }

  const cursorParam = req.nextUrl.searchParams.get('cursor');
  const cursor = cursorParam ?? undefined;

  // No silent clamping: an unparseable or out-of-range limit is forwarded
  // as-is (Number(null) via ?? undefined stays undefined -> service
  // default; Number("abc") is NaN, Number("") is 0 — both already fail the
  // service's own validateLimit and produce a deterministic INVALID_LIMIT)
  // so the service's own validation remains the single source of truth for
  // what counts as a valid limit.
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam === null ? undefined : Number(limitParam);

  try {
    const result = itemId
      ? await listItemActivity({ organisationId: session.organisationId, itemId, cursor, limit })
      : await listBoardActivity({ organisationId: session.organisationId, boardId: boardId as string, cursor, limit });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: VALIDATION_FAILURE_STATUS, headers: CACHE_HEADERS });
    }
    return NextResponse.json(
      { activity: result.activity, next_cursor: result.next_cursor },
      { status: 200, headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error('[GET /api/organiser/activity]', err);
    return NextResponse.json({ error: 'Failed to load activity.' }, { status: 500, headers: CACHE_HEADERS });
  }
}
