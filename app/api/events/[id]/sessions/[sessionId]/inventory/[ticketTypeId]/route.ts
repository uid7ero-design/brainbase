import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventTicketTypeSessionInventoryInput, type EventTicketTypeSessionInventoryInput } from '@/lib/events/validation';
import { logEventTicketTypeSessionInventorySet, logEventTicketTypeSessionInventoryCleared } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; sessionId: string; ticketTypeId: string }> };

// Phase 3 — ticket type × session inventory, write side (manager+).
//   PUT    { capacity }  set (create or change) this pair's override
//   DELETE               clear it (row deletion — there is no null state)
//
// Both resolve the (event, session, ticket type) triple inside the
// caller's OWN organisation first and answer 404 otherwise — never
// leaking whether an id exists elsewhere. The database enforces the
// same thing a second time through the composite FKs on
// event_ticket_type_session_inventory (see the migration's header), so
// even a bug here could not attach a pair to another organisation's or
// another event's rows.
async function loadOwnedPair(eventId: string, sessionId: string, ticketTypeId: string, organisationId: string) {
  const rows = await sql`
    SELECT es.id AS session_id, tt.id AS ticket_type_id
    FROM events e
    JOIN event_sessions es ON es.event_id = e.id AND es.organisation_id = e.organisation_id AND es.id = ${sessionId}
    JOIN event_ticket_types tt ON tt.event_id = e.id AND tt.organisation_id = e.organisation_id AND tt.id = ${ticketTypeId}
    WHERE e.id = ${eventId} AND e.organisation_id = ${organisationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, sessionId, ticketTypeId } = await params;

  const pair = await loadOwnedPair(id, sessionId, ticketTypeId, session.organisationId);
  if (!pair) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: EventTicketTypeSessionInventoryInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const error = validateEventTicketTypeSessionInventoryInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const capacity = body.capacity as number;

  // Upsert on the pair key. A concurrent reservation for this pair holds
  // FOR UPDATE on this very row (lib/events/services/cart.ts), so this
  // UPDATE simply waits for that transaction to finish — the gate never
  // reads a half-applied capacity. Lowering an override below what is
  // already sold is allowed, exactly as it is for the existing
  // ticket-type and session capacities (it stops further sales; it
  // never cancels anything).
  const rows = await sql`
    WITH prior AS (
      SELECT capacity FROM event_ticket_type_session_inventory
      WHERE ticket_type_id = ${ticketTypeId} AND event_session_id = ${sessionId} AND organisation_id = ${session.organisationId}
    ),
    upsert AS (
      INSERT INTO event_ticket_type_session_inventory (organisation_id, event_id, ticket_type_id, event_session_id, capacity)
      VALUES (${session.organisationId}, ${id}, ${ticketTypeId}, ${sessionId}, ${capacity})
      ON CONFLICT (ticket_type_id, event_session_id, organisation_id)
        DO UPDATE SET capacity = EXCLUDED.capacity, updated_at = now()
      RETURNING id, organisation_id, event_id, ticket_type_id, event_session_id, capacity, created_at, updated_at
    )
    SELECT upsert.*, (SELECT capacity FROM prior) AS prior_capacity FROM upsert
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { prior_capacity, ...inventory } = rows[0] as { id: string; capacity: number; prior_capacity: number | null } & Record<string, unknown>;

  await logEventTicketTypeSessionInventorySet({
    organisationId: session.organisationId, userId: session.userId, eventId: id, sessionId, ticketTypeId,
    inventoryId: inventory.id, beforeCapacity: prior_capacity ?? null, afterCapacity: inventory.capacity,
  });
  return NextResponse.json({ inventory });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, sessionId, ticketTypeId } = await params;

  const rows = await sql`
    DELETE FROM event_ticket_type_session_inventory
    WHERE ticket_type_id = ${ticketTypeId} AND event_session_id = ${sessionId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING id, capacity
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const removed = rows[0] as { id: string; capacity: number };

  await logEventTicketTypeSessionInventoryCleared({
    organisationId: session.organisationId, userId: session.userId, eventId: id, sessionId, ticketTypeId,
    inventoryId: removed.id, beforeCapacity: removed.capacity,
  });
  return NextResponse.json({ success: true });
}
