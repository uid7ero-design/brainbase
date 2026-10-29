import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

// Phase 3 — ticket type × session inventory, read side. One row per
// ticket type of this event (active or not — an inactive type may still
// hold an override and historical sales), each carrying:
//   type_capacity      the event-wide event_ticket_types.capacity (unchanged meaning)
//   override_capacity  this pair's override, or null when none is set
//   effective_capacity COALESCE(override, type) — exactly what the
//                      reservation gate applies for this type in this session
//   sold               this type's live quantity in THIS session (stale
//                      pending holds excluded — same predicate as the gate)
//   remaining          GREATEST(effective_capacity - sold, 0)
// plus the session's own shared figures. This is the smallest type ×
// session sales view the phase needs — not a reporting feature.
//
// Viewer+ may read (same as GET sessions / ticket types); every query is
// scoped by BOTH event id and the caller's own organisation, and the
// session must belong to that event, so a session id from another event
// or organisation is simply "Not found".
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, sessionId } = await params;

  const sessionRows = await sql`
    SELECT es.id, es.name, es.capacity,
      COALESCE((
        SELECT SUM(oi.quantity)
        FROM event_order_items oi
        JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
        WHERE oi.event_session_id = es.id AND oi.organisation_id = ${session.organisationId}
          AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
      ), 0)::int AS sold
    FROM event_sessions es
    WHERE es.id = ${sessionId} AND es.event_id = ${id} AND es.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!sessionRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const eventSession = sessionRows[0] as { id: string; name: string; capacity: number; sold: number };

  const rows = await sql`
    SELECT
      tt.id AS ticket_type_id, tt.name AS ticket_type_name, tt.active, tt.capacity AS type_capacity,
      inv.id AS inventory_id, inv.capacity AS override_capacity,
      COALESCE(inv.capacity, tt.capacity)::int AS effective_capacity,
      COALESCE((
        SELECT SUM(oi.quantity)
        FROM event_order_items oi
        JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
        WHERE oi.ticket_type_id = tt.id AND oi.event_session_id = ${sessionId} AND oi.organisation_id = ${session.organisationId}
          AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
      ), 0)::int AS sold
    FROM event_ticket_types tt
    LEFT JOIN event_ticket_type_session_inventory inv
      ON inv.ticket_type_id = tt.id AND inv.event_session_id = ${sessionId} AND inv.organisation_id = tt.organisation_id
    WHERE tt.event_id = ${id} AND tt.organisation_id = ${session.organisationId}
    ORDER BY tt.sort_order, tt.created_at
  `;
  const inventory = (rows as { effective_capacity: number; sold: number }[]).map(r => ({
    ...r,
    remaining: Math.max(0, r.effective_capacity - r.sold),
  }));

  return NextResponse.json({
    event_session: { ...eventSession, remaining: Math.max(0, eventSession.capacity - eventSession.sold) },
    inventory,
  });
}
