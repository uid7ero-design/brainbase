import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventSessionInput, type EventSessionInput } from '@/lib/events/validation';

type Ctx = { params: Promise<{ id: string }> };

// Confirms the parent event exists AND belongs to the caller's
// organisation before any child-row read/write proceeds. Returns the
// event row, or null if it doesn't exist in this organisation — callers
// must respond 404 in that case (never leak whether the id exists in a
// different organisation).
async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`
    SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const event_sessions = await sql`
    SELECT * FROM event_sessions
    WHERE event_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY starts_at
  `;
  return NextResponse.json({ event_sessions });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: EventSessionInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const error = validateEventSessionInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const rows = await sql`
    INSERT INTO event_sessions (event_id, organisation_id, name, starts_at, ends_at, capacity)
    VALUES (${id}, ${session.organisationId}, ${(body.name as string).trim()}, ${body.starts_at as string}, ${body.ends_at as string}, ${body.capacity as number})
    RETURNING *
  `;
  return NextResponse.json({ event_session: rows[0] }, { status: 201 });
}
