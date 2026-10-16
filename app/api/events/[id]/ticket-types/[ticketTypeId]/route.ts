import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventTicketTypeInput, mergeField, type EventTicketTypeInput } from '@/lib/events/validation';
import { logEventTicketTypeUpdated, logEventTicketTypeDeleted } from '@/lib/events/auditLog';

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
    // Phase 4 — the two nullable window bounds follow the same explicit-
    // null-clears contract as description; omitted keeps the stored value.
    sale_starts_at: mergeField(body, 'sale_starts_at', existing.sale_starts_at instanceof Date ? existing.sale_starts_at.toISOString() : existing.sale_starts_at),
    sale_ends_at: mergeField(body, 'sale_ends_at', existing.sale_ends_at instanceof Date ? existing.sale_ends_at.toISOString() : existing.sale_ends_at),
    requires_access_code: mergeField(body, 'requires_access_code', existing.requires_access_code),
  };
  const error = validateEventTicketTypeInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  // A concurrent reservation that holds FOR UPDATE on this ticket type
  // simply makes this UPDATE wait; the gate never reads a half-applied
  // window. Narrowing a window after sales began stops further sales from
  // the boundary onward — it never cancels anything already booked.
  const rows = await sql`
    UPDATE event_ticket_types SET
      name = ${merged.name as string}, description = ${(merged.description as string | null) ?? null},
      price_cents = ${merged.price_cents as number}, capacity = ${merged.capacity as number},
      active = ${merged.active as boolean}, sort_order = ${merged.sort_order as number},
      sale_starts_at = ${(merged.sale_starts_at as string | null | undefined) || null}, sale_ends_at = ${(merged.sale_ends_at as string | null | undefined) || null},
      requires_access_code = ${(merged.requires_access_code as boolean | null | undefined) ?? false},
      updated_at = now()
    WHERE id = ${ticketTypeId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const updated = rows[0] as Record<string, unknown>;
  await logEventTicketTypeUpdated({
    organisationId: session.organisationId, userId: session.userId, eventId: id, ticketTypeId,
    before: existing as never, after: updated as never,
  });
  return NextResponse.json({ ticket_type: updated });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, ticketTypeId } = await params;

  const rows = await sql`
    DELETE FROM event_ticket_types
    WHERE id = ${ticketTypeId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING id, name, description, price_cents, capacity, active, sort_order, sale_starts_at, sale_ends_at, requires_access_code
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  await logEventTicketTypeDeleted({
    organisationId: session.organisationId, userId: session.userId, eventId: id, ticketTypeId,
    before: rows[0] as never,
  });
  return NextResponse.json({ success: true });
}
