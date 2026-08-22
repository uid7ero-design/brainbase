import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';
import { resolveBrainbaseOrgId, resolveFounderBoard, FOUNDER_BOARD_NAME } from '@/lib/founder/tasksBoard';

// Explicit, founder-initiated board creation — never automatic/silent.
// Production verification found BrainBase's org already has two other
// Organiser boards ("WORK", "Tafe") with real content — this endpoint must
// never adopt, rename, or write to either of them. resolveFounderBoard()
// (shared with GET/PATCH) checks for an existing board named EXACTLY
// "Founder Tasks" first; WORK/Tafe never match that name, so they cannot be
// returned here, adopted, or duplicated. If a "Founder Tasks" board already
// exists, this is a deliberate, idempotent no-op (409) — never a second
// "Founder Tasks" board. No group is created alongside the board: the
// canonical Organiser item-creation route (app/api/organiser/boards/
// [boardId]/items/route.ts) already treats group_id as fully optional
// (items with a NULL group_id render under the Organiser UI's own built-in
// "No group" section — see app/command/organiser/page.tsx), so a group is
// not required for the board to function correctly and none is guessed
// into existence here.
export async function POST() {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const orgId = await resolveBrainbaseOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'BrainBase organisation not found' }, { status: 500 });
    }

    const existing = await resolveFounderBoard(orgId);
    if (existing) {
      return NextResponse.json({ error: 'A Founder Tasks board already exists', board: existing }, { status: 409 });
    }

    // Appended after every existing board (matches the canonical
    // app/api/organiser/boards/route.ts POST's own position convention) —
    // never hardcoded to 0, which would collide with WORK's existing
    // position 0 and disturb its ordering in the Organiser UI.
    const posRows = await sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_boards WHERE organisation_id = ${orgId}
    `;
    const position = posRows[0].next as number;

    const rows = await sql`
      INSERT INTO organiser_boards (organisation_id, name, position, created_by)
      VALUES (${orgId}, ${FOUNDER_BOARD_NAME}, ${position}, ${session.userId})
      RETURNING id, name
    `;

    return NextResponse.json({ board: { id: rows[0].id, name: rows[0].name } }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/founder/tasks/board]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
