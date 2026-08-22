import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';
import { resolveBrainbaseOrgId, resolveFounderBoard } from '@/lib/founder/tasksBoard';

const STATUS_OPTIONS = ['Not Started', 'Working on it', 'Stuck', 'Done'] as const;
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'] as const;

// PATCH — status/priority/due_date/owner/notes. Scoped to BOTH the
// resolved BrainBase organisation AND the resolved Founder Tasks board
// specifically (not just "any organiser item in this org") — defense in
// depth beyond organiser's own organisation_id scoping, so this adapter
// can only ever touch the one board it presents as "Founder OS Tasks",
// not any other board that might also belong to the BrainBase org.
// owner remains free-text here exactly as it is in the underlying
// organiser_items.owner column — not redesigned into a users(id)
// reference in this phase.
export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { itemId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (body.status !== undefined && !(STATUS_OPTIONS as readonly string[]).includes(body.status as string)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (body.priority !== undefined && body.priority !== null && !(PRIORITY_OPTIONS as readonly string[]).includes(body.priority as string)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
  }

  const title    = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : undefined;
  if (title !== undefined && !title) {
    return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
  }
  const status   = typeof body.status === 'string' ? body.status : undefined;
  const priority = body.priority === null ? null : typeof body.priority === 'string' ? body.priority : undefined;
  const owner    = body.owner === null ? null : typeof body.owner === 'string' ? body.owner.trim().slice(0, 200) : undefined;
  const hasDueDate = Object.prototype.hasOwnProperty.call(body, 'due_date');
  const dueDate  = typeof body.due_date === 'string' && body.due_date ? body.due_date : null;
  const notes    = body.notes === null ? null : typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : undefined;

  try {
    const orgId = await resolveBrainbaseOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'BrainBase organisation not found' }, { status: 500 });
    }
    const board = await resolveFounderBoard(orgId);
    if (!board) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const existing = await sql`
      SELECT id FROM organiser_items
      WHERE id = ${itemId} AND board_id = ${board.id} AND organisation_id = ${orgId}
      LIMIT 1
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await sql`
      UPDATE organiser_items SET
        name       = COALESCE(${title ?? null}, name),
        status     = COALESCE(${status ?? null}, status),
        priority   = CASE WHEN ${priority !== undefined} THEN ${priority} ELSE priority END,
        owner      = CASE WHEN ${owner !== undefined} THEN ${owner} ELSE owner END,
        due_date   = CASE WHEN ${hasDueDate} THEN ${dueDate}::date ELSE due_date END,
        notes      = CASE WHEN ${notes !== undefined} THEN ${notes} ELSE notes END,
        updated_at = NOW()
      WHERE id = ${itemId} AND board_id = ${board.id} AND organisation_id = ${orgId}
      RETURNING id, name, status, priority, owner, due_date::text AS due_date, notes, created_at, updated_at
    `;

    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const row = rows[0];
    return NextResponse.json({
      task: {
        id: row.id,
        title: row.name,
        status: row.status,
        priority: row.priority ?? null,
        owner: row.owner ?? null,
        dueDate: row.due_date ?? null,
        notes: row.notes ?? null,
        createdAt: new Date(row.created_at as string).toISOString(),
        updatedAt: new Date(row.updated_at as string).toISOString(),
      },
    });
  } catch (err) {
    console.error('[PATCH /api/founder/tasks/[itemId]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
