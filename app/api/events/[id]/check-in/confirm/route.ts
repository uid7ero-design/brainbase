import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { confirmCheckIn, type AttendeeIdentifier } from '@/lib/events/checkIn';

type Ctx = { params: Promise<{ id: string }> };

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] as { id: string } | undefined;
}

function parseIdentifier(body: { ticket_token?: unknown; attendee_id?: unknown }): AttendeeIdentifier | null {
  if (typeof body.ticket_token === 'string' && body.ticket_token.trim()) return { ticket_token: body.ticket_token };
  if (typeof body.attendee_id === 'string' && body.attendee_id.trim()) return { attendee_id: body.attendee_id };
  return null;
}

// POST — THE state-changing check-in action (scanner AND manual
// fallback both call this same endpoint, identifying the attendee by
// either ticket_token or attendee_id — see confirmCheckIn()). manager+
// only.
//
// Role choice, explained (Phase 3 brief section 8): every OTHER
// mutation in this Events module (create/edit event, sessions, ticket
// types, artwork upload/replace/remove) already requires manager+ —
// this codebase's own established convention (see
// lib/events/authorize.ts and, independently, the Data Hub ADR's note
// that "meaningful write actions require manager+"). Check-in is
// unambiguously a mutation with real operational consequences
// (permanently marks attendance, feeds duplicate-scan prevention) — it
// does not get a special carve-out to viewer just because a front-desk
// volunteer might only hold a viewer login; the safer, already-
// established convention wins per the brief's own instruction to
// "choose the safer existing role convention" under ambiguity. An
// organisation that wants a specific front-desk account to run
// check-in should give that account a manager login, not have this
// route quietly weaken the write-permission boundary every other
// Events mutation already enforces.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
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

  const result = await confirmCheckIn(session.organisationId, id, identifier, session.userId);
  if (!result.ok) {
    const status = result.reason === 'cancelled' ? 409 : 404;
    return NextResponse.json({ error: result.reason === 'cancelled' ? 'Ticket cancelled.' : 'Ticket not valid.', reason: result.reason }, { status });
  }
  return NextResponse.json({ first: result.first, attendee: result.attendee }, { status: result.first ? 200 : 409 });
}
