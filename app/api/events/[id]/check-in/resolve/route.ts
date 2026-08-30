import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { resolveAttendee, type AttendeeIdentifier } from '@/lib/events/checkIn';

type Ctx = { params: Promise<{ id: string }> };

// See app/api/events/[id]/sessions/route.ts's loadOwnedEvent for why
// this check exists on every child-resource route.
async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] as { id: string } | undefined;
}

function parseIdentifier(body: { ticket_token?: unknown; attendee_id?: unknown }): AttendeeIdentifier | null {
  if (typeof body.ticket_token === 'string' && body.ticket_token.trim()) return { ticket_token: body.ticket_token };
  if (typeof body.attendee_id === 'string' && body.attendee_id.trim()) return { attendee_id: body.attendee_id };
  return null;
}

// POST — read-only ticket/attendee resolve (the scanner's and the
// manual-search-select's shared "show me who this is" preview step,
// before staff taps Confirm). viewer+ : this returns the same attendee
// data staff can already see in full via GET /api/events/[id]/orders
// (viewer+) — resolving by token/id instead of browsing the list
// exposes no new information, only a faster lookup path. The actual
// state-changing action is POST .../check-in/confirm, gated separately
// at manager+.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: { ticket_token?: unknown; attendee_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const identifier = parseIdentifier(body);
  if (!identifier) return NextResponse.json({ error: 'Ticket not valid.', reason: 'not_found' }, { status: 404 });

  const result = await resolveAttendee(session.organisationId, id, identifier);
  if (!result.ok) {
    // Same generic shape whichever reason — never distinguishes "wrong
    // tenant"/"wrong event"/"doesn't exist" from each other.
    const status = result.reason === 'not_found' ? 404 : 409;
    const message = result.reason === 'cancelled' ? 'Ticket cancelled.' : result.reason === 'unpaid' ? 'Payment not completed.' : 'Ticket not valid.';
    return NextResponse.json({ error: message, reason: result.reason }, { status });
  }
  return NextResponse.json({ attendee: result.attendee });
}
