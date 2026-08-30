import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { searchAttendees } from '@/lib/events/checkIn';

type Ctx = { params: Promise<{ id: string }> };

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] as { id: string } | undefined;
}

// GET ?q=... — manual check-in fallback (section 15). Read-only,
// viewer+ (same reasoning as .../check-in/resolve — this is the exact
// same attendee data already visible via GET /api/events/[id]/orders).
// Always scoped to the caller's own organisation AND this one event —
// searchAttendees() itself enforces both; there is no code path here
// that could search across events or tenants.
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const attendees = await searchAttendees(session.organisationId, id, q);
  return NextResponse.json({ attendees });
}
