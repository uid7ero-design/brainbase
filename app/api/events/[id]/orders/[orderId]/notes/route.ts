import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { logNoteAdded } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

// Matches LONG_TEXT's own MAX_LONG_TEXT_LENGTH convention already
// established for registration-response answers (see the responses
// route's validateAnswerAgainstSnapshot) — kept numerically identical
// for consistency, not derived from any hard technical limit.
const MAX_NOTE_LENGTH = 4000;

// GET — list an order's internal notes, newest first. manager+.
// Deleted (soft-deleted) notes are never returned by this route — a
// separate, explicit "show deleted" surface does not exist, matching
// the brief's own "deleted notes excluded from normal manager
// responses" requirement.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const orderRows = await sql`
    SELECT id FROM event_orders
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!orderRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const notes = await sql`
    SELECT id, body, author_name_snapshot, created_at, updated_at, edited_at
    FROM event_order_notes
    WHERE order_id = ${orderId} AND organisation_id = ${session.organisationId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ notes });
}

// POST — add a new internal note. manager+.
//
// organisation_id and event_id are NEVER taken from the request body —
// organisation_id comes from the session (never client-supplied, per
// §12), and event_id comes from the URL's own [id] segment, the same
// value every sibling route in this directory already trusts for the
// same reason. author_user_id/author_name_snapshot come from the
// session too — a manager can never author a note as someone else.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  if (typeof body.body !== 'string' || !body.body.trim()) {
    return NextResponse.json({ error: 'Note body cannot be empty.' }, { status: 400 });
  }
  const trimmed = body.body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` }, { status: 400 });
  }

  // Confirms the order genuinely belongs to this event + organisation
  // BEFORE inserting — this is what makes the insert below satisfy
  // event_order_notes_order_event_org_fkey (order_id, event_id,
  // organisation_id) rather than relying on the FK alone to catch a
  // mismatch after the fact.
  const orderRows = await sql`
    SELECT id FROM event_orders
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!orderRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const inserted = await sql`
    INSERT INTO event_order_notes (organisation_id, event_id, order_id, body, author_user_id, author_name_snapshot)
    VALUES (${session.organisationId}, ${eventId}, ${orderId}, ${trimmed}, ${session.userId}, ${session.name})
    RETURNING id, body, author_name_snapshot, created_at, updated_at, edited_at
  `;
  const note = inserted[0] as { id: string; body: string; author_name_snapshot: string; created_at: string; updated_at: string; edited_at: string | null };

  await logNoteAdded({ organisationId: session.organisationId, userId: session.userId, orderId, noteId: note.id });

  return NextResponse.json({ note }, { status: 201 });
}
