import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventTicketTypeInput, mergeField, type EventTicketTypeInput } from '@/lib/events/validation';

type Ctx = { params: Promise<{ id: string; ticketTypeId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, ticketTypeId } = await params;

  const existingRows = await sql`
    SELECT * FROM event_ticket_types
    WHERE id = ${ticketTypeId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!existingRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const existing = existingRows[0];

  let body: Partial<EventTicketTypeInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  // Merged by property presence (mergeField), not `??` — see
  // app/api/events/[id]/route.ts's PATCH for the same rationale. Here it
  // matters for `description`, the one nullable field on this entity: an
  // explicit `null` must clear it, not be silently discarded.
  const merged: EventTicketTypeInput = {
    name: mergeField(body, 'name', existing.name),
    description: mergeField(body, 'description', existing.description),
    price_cents: mergeField(body, 'price_cents', existing.price_cents),
    capacity: mergeField(body, 'capacity', existing.capacity),
    active: mergeField(body, 'active', existing.active),
    sort_order: mergeField(body, 'sort_order', existing.sort_order),
  };
  const error = validateEventTicketTypeInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const rows = await sql`
    UPDATE event_ticket_types SET
      name = ${merged.name as string}, description = ${(merged.description as string | null) ?? null},
      price_cents = ${merged.price_cents as number}, capacity = ${merged.capacity as number},
      active = ${merged.active as boolean}, sort_order = ${merged.sort_order as number}, updated_at = now()
    WHERE id = ${ticketTypeId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ticket_type: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, ticketTypeId } = await params;

  const rows = await sql`
    DELETE FROM event_ticket_types
    WHERE id = ${ticketTypeId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING id
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
