import { NextRequest, NextResponse } from 'next/server';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';
import { listItemActivity } from '@/lib/organiser/activityRead';

// Phase D.4.5D — GET-only, read-only Organiser activity endpoint. Item-
// scoped only for this phase (itemId is REQUIRED) — no broad cross-board
// feed here yet; see lib/organiser/activityRead.ts's own header for the
// deletion-safe, tenant-scoped query design this route wraps.
//
// AUTH: identical boundary to every other app/api/organiser/** route —
// authorizeOrganiserRequest('viewer') (session + 'organiser' capability +
// viewer role floor). organisationId comes exclusively from that call's
// own resolved session.organisationId; the request can never supply or
// override it (no organisation_id read from query/body/header anywhere in
// this file).
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

// Every current ListItemActivityFailureCode (INVALID_ITEM_ID/INVALID_CURSOR/
// INVALID_LIMIT) is a caller input problem -> 400. A single constant, not a
// switch, so this stays correct by construction if the failure union ever
// grows without a matching case being added here.
const VALIDATION_FAILURE_STATUS = 400;

export async function GET(req: NextRequest) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const itemId = req.nextUrl.searchParams.get('itemId');
  if (!itemId) {
    return NextResponse.json({ error: 'itemId is required.' }, { status: 400, headers: CACHE_HEADERS });
  }

  const cursorParam = req.nextUrl.searchParams.get('cursor');
  const cursor = cursorParam ?? undefined;

  // No silent clamping: an unparseable or out-of-range limit is forwarded
  // as-is (Number(null) via ?? undefined stays undefined -> service
  // default; Number("abc") is NaN, Number("") is 0 — both already fail
  // listItemActivity's own validateLimit and produce a deterministic
  // INVALID_LIMIT) so the service's own validation remains the single
  // source of truth for what counts as a valid limit.
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam === null ? undefined : Number(limitParam);

  try {
    const result = await listItemActivity({ organisationId: session.organisationId, itemId, cursor, limit });
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
