import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';
import { resolveBrainbaseOrgId, resolveFounderBoard } from '@/lib/founder/tasksBoard';

// Explicit, founder-initiated board creation — never automatic/silent.
// Per the Phase D audit: whether BrainBase's organisation already has a
// suitable Organiser board could not be verified from the repository
// alone (that's Production data, not code). Rather than guess or seed one
// automatically, GET /api/founder/tasks reports board: null when none
// exists, and the founder must explicitly trigger this endpoint to create
// one. If a board already exists, this is a deliberate no-op (409) —
// Founder OS Tasks always uses the first existing board once one is
// present, it never creates a second one.
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

    const rows = await sql`
      INSERT INTO organiser_boards (organisation_id, name, position, created_by)
      VALUES (${orgId}, 'Founder Tasks', 0, ${session.userId})
      RETURNING id, name
    `;

    return NextResponse.json({ board: { id: rows[0].id, name: rows[0].name } }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/founder/tasks/board]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
