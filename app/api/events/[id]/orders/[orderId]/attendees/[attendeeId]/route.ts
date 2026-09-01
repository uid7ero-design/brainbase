import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { logAttendeeEdited } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string; attendeeId: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH — Phase 6 §5: edit attendee_name / attendee_email on one
// existing attendee. manager+, matching every other Events mutation.
//
// Tenant + relationship safety: the UPDATE's WHERE clause requires
// id = attendeeId AND order_id = orderId AND event_id = eventId AND
// organisation_id = session.organisationId, all four together — an
// attendeeId that exists but belongs to a different order, event, or
// organisation matches zero rows and returns 404. This is also what
// makes "editing attendee A never changes attendee B" structurally
// true: the UPDATE can only ever match the single row whose id equals
// the one path parameter given, regardless of how many other attendees
// share the same order.
//
// What this route deliberately does NOT touch, per the brief's own
// explicit constraints: it never generates a new id, never regenerates
// ticket_token (an ordinary name/email correction has no reason to
// invalidate an already-issued ticket), never touches checked_in_at/
// checked_in_by_user_id (so editing a checked-in attendee's name does
// not fabricate or erase real check-in history), and never touches any
// other attendee row.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId, attendeeId } = await params;

  let body: { attendee_name?: unknown; attendee_email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const updates: { attendee_name?: string; attendee_email?: string | null } = {};

  if (body.attendee_name !== undefined) {
    if (typeof body.attendee_name !== 'string' || !body.attendee_name.trim()) {
      return NextResponse.json({ error: 'Attendee name cannot be empty.' }, { status: 400 });
    }
    updates.attendee_name = body.attendee_name.trim();
  }
  if (body.attendee_email !== undefined) {
    if (body.attendee_email !== null && (typeof body.attendee_email !== 'string' || (body.attendee_email.trim() && !EMAIL_RE.test(body.attendee_email.trim())))) {
      return NextResponse.json({ error: 'Invalid attendee email.' }, { status: 400 });
    }
    const trimmed = typeof body.attendee_email === 'string' ? body.attendee_email.trim().toLowerCase() : null;
    updates.attendee_email = trimmed && trimmed.length > 0 ? trimmed : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  }

  const beforeRows = await sql`
    SELECT attendee_name, attendee_email FROM event_attendees
    WHERE id = ${attendeeId} AND order_id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  const before = beforeRows[0] as { attendee_name: string; attendee_email: string | null } | undefined;
  if (!before) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const updated = await sql`
    UPDATE event_attendees
    SET
      attendee_name = COALESCE(${updates.attendee_name ?? null}, attendee_name),
      attendee_email = CASE WHEN ${'attendee_email' in updates} THEN ${updates.attendee_email ?? null} ELSE attendee_email END,
      updated_at = now()
    WHERE id = ${attendeeId} AND order_id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    RETURNING id, order_id, attendee_name, attendee_email, checked_in_at
  `;
  if (!updated.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const after = updated[0] as { id: string; order_id: string; attendee_name: string; attendee_email: string | null; checked_in_at: string | null };

  await logAttendeeEdited({
    organisationId: session.organisationId, userId: session.userId, orderId, attendeeId,
    before: { attendee_name: before.attendee_name, attendee_email: before.attendee_email },
    after: { attendee_name: after.attendee_name, attendee_email: after.attendee_email },
  });

  return NextResponse.json({ attendee: after });
}
