import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { logNoteEdited, logNoteDeleted } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string; noteId: string }> };

const MAX_NOTE_LENGTH = 4000;

// PATCH — edit an existing note's body. manager+.
//
// Never touches author_user_id/author_name_snapshot — an edit does not
// change WHO wrote the note, only what it currently says (matching the
// attendee/response edit routes' own "never rewrite historical
// authorship/snapshot fields" convention). Sets edited_at (in addition
// to updated_at) so the UI can show an "edited" indicator distinct from
// "created" — see the migration's own header comment for why edited_at
// is a separate column rather than inferred from created_at/updated_at.
//
// A soft-deleted note (deleted_at IS NOT NULL) cannot be edited — the
// WHERE clause below excludes it, so this route 404s exactly as if the
// note didn't exist, rather than silently reviving deleted content.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId, noteId } = await params;

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

  const updated = await sql`
    UPDATE event_order_notes
    SET body = ${trimmed}, updated_at = now(), edited_at = now()
    WHERE id = ${noteId} AND order_id = ${orderId} AND event_id = ${eventId}
      AND organisation_id = ${session.organisationId} AND deleted_at IS NULL
    RETURNING id, body, author_name_snapshot, created_at, updated_at, edited_at
  `;
  if (!updated.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  await logNoteEdited({ organisationId: session.organisationId, userId: session.userId, orderId, noteId });

  return NextResponse.json({ note: updated[0] });
}

// DELETE — soft-delete a note (sets deleted_at). manager+.
//
// Never a hard DELETE — matches §2's explicit "normal API never
// hard-deletes notes" requirement and this module's established
// non-destructive-history convention. Idempotent: deleting an
// already-deleted note (or one that never existed) both return the same
// 404 rather than distinguishing "already gone" from "never existed" —
// there is no information a manager needs from that distinction here
// (unlike the cancel/refund routes' own idempotency, this action has no
// legitimate concurrent-duplicate-click scenario worth a 200 "already
// resolved" response, since a note isn't a state machine with external
// side effects).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId, noteId } = await params;

  const updated = await sql`
    UPDATE event_order_notes
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${noteId} AND order_id = ${orderId} AND event_id = ${eventId}
      AND organisation_id = ${session.organisationId} AND deleted_at IS NULL
    RETURNING id
  `;
  if (!updated.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  await logNoteDeleted({ organisationId: session.organisationId, userId: session.userId, orderId, noteId });

  return NextResponse.json({ ok: true });
}
