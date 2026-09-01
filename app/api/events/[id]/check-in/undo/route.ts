import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { undoCheckIn } from '@/lib/events/checkIn';
import { logCheckInUndone } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string }> };

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] as { id: string } | undefined;
}

// POST — explicit, authenticated reversal of a check-in mistake.
// manager+ only (same reasoning as .../check-in/confirm). This is a
// deliberate, separate action a staff member chooses from the
// attendee's own row — never an automatic toggle a repeated QR scan
// can reach (confirm/route.ts never calls undoCheckIn(); a second scan
// always resolves to "already checked in", not a silent reversal).
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: { attendee_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  if (typeof body.attendee_id !== 'string' || !body.attendee_id.trim()) {
    return NextResponse.json({ error: 'Attendee not found.' }, { status: 404 });
  }

  const result = await undoCheckIn(session.organisationId, id, body.attendee_id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === 'not_checked_in' ? 'This attendee is not currently checked in.' : 'Attendee not found.' },
      { status: result.reason === 'not_checked_in' ? 409 : 404 },
    );
  }

  const orderRows = await sql`SELECT order_id FROM event_attendees WHERE id = ${body.attendee_id} AND organisation_id = ${session.organisationId} LIMIT 1`;
  const orderId = (orderRows[0] as { order_id: string } | undefined)?.order_id;
  if (orderId) await logCheckInUndone({ organisationId: session.organisationId, userId: session.userId, orderId, attendeeId: body.attendee_id });

  return NextResponse.json({ attendee: result.attendee });
}
