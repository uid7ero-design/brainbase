import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventTicketTypeInput, type EventTicketTypeInput } from '@/lib/events/validation';

type Ctx = { params: Promise<{ id: string }> };

// See app/api/events/[id]/sessions/route.ts's loadOwnedEvent for why
// this check exists on every child-resource route.
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

  const ticket_types = await sql`
    SELECT * FROM event_ticket_types
    WHERE event_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY sort_order, created_at
  `;
  return NextResponse.json({ ticket_types });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: EventTicketTypeInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const error = validateEventTicketTypeInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const rows = await sql`
    INSERT INTO event_ticket_types (event_id, organisation_id, name, description, price_cents, capacity, active, sort_order)
    VALUES (
      ${id}, ${session.organisationId}, ${(body.name as string).trim()},
      ${(body.description as string | undefined)?.trim() || null},
      ${body.price_cents as number}, ${body.capacity as number},
      ${(body.active as boolean | undefined) ?? true}, ${(body.sort_order as number | undefined) ?? 0}
    )
    RETURNING *
  `;
  return NextResponse.json({ ticket_type: rows[0] }, { status: 201 });
}
