import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';

type Ctx = { params: Promise<{ id: string }> };

// Phase 6 (GA inventory hardening) — the whole-event ticket type ×
// session inventory matrix, read side only. The per-session view
// (GET .../sessions/[sessionId]/inventory) answers "how is THIS session
// selling by type"; this endpoint answers the organiser's cross-session
// question in one read: every (type, session) cell of the event with its
// effective capacity (pair override, else the type's event-wide
// capacity), what is live-sold in that cell and what is left, plus each
// session's shared figures and each type's event-wide figures (including
// sales not bound to any session). It is the smallest useful reporting
// read path for session-specific inventory — not an analytics surface:
// no dates, no revenue, no purchaser data, no CSV (the registrations
// export already carries session and ticket type per row).
//
// Every "sold" figure uses the reservation gate's own live predicate
// (non-cancelled orders; a PENDING paid hold counts only until its
// expires_at) so the numbers here agree with what the gate will admit
// next. Viewer+ may read, exactly like the per-session endpoint; every
// statement is scoped by the caller's own organisation AND this event, so
// another organisation's event id is simply "Not found".
type SessionRow = { id: string; name: string; starts_at: string; ends_at: string; capacity: number; sold: number };
type TicketTypeRow = { id: string; name: string; active: boolean; capacity: number; sold: number; sold_without_session: number };
type CellRow = { event_session_id: string; ticket_type_id: string; override_capacity: number | null; effective_capacity: number; sold: number };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const eventRows = await sql`
    SELECT id FROM events WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [sessionRows, typeRows, cellRows] = await Promise.all([
    sql`
      SELECT es.id, es.name, es.starts_at, es.ends_at, es.capacity,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.event_session_id = es.id AND oi.organisation_id = ${session.organisationId}
            AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        ), 0)::int AS sold
      FROM event_sessions es
      WHERE es.event_id = ${id} AND es.organisation_id = ${session.organisationId}
      ORDER BY es.starts_at, es.id
    `,
    sql`
      SELECT tt.id, tt.name, tt.active, tt.capacity,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.ticket_type_id = tt.id AND oi.organisation_id = ${session.organisationId}
            AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        ), 0)::int AS sold,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.ticket_type_id = tt.id AND oi.event_session_id IS NULL AND oi.organisation_id = ${session.organisationId}
            AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        ), 0)::int AS sold_without_session
      FROM event_ticket_types tt
      WHERE tt.event_id = ${id} AND tt.organisation_id = ${session.organisationId}
      ORDER BY tt.sort_order, tt.created_at, tt.id
    `,
    sql`
      SELECT es.id AS event_session_id, tt.id AS ticket_type_id,
        inv.capacity AS override_capacity,
        COALESCE(inv.capacity, tt.capacity)::int AS effective_capacity,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM event_order_items oi
          JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
          WHERE oi.ticket_type_id = tt.id AND oi.event_session_id = es.id AND oi.organisation_id = ${session.organisationId}
            AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
        ), 0)::int AS sold
      FROM event_sessions es
      JOIN event_ticket_types tt ON tt.event_id = es.event_id AND tt.organisation_id = es.organisation_id
      LEFT JOIN event_ticket_type_session_inventory inv
        ON inv.ticket_type_id = tt.id AND inv.event_session_id = es.id AND inv.organisation_id = es.organisation_id
      WHERE es.event_id = ${id} AND es.organisation_id = ${session.organisationId}
      ORDER BY es.starts_at, es.id, tt.sort_order, tt.created_at, tt.id
    `,
  ]);

  const sessions = (sessionRows as SessionRow[]).map(s => ({ ...s, remaining: Math.max(0, s.capacity - s.sold) }));
  const ticketTypes = (typeRows as TicketTypeRow[]).map(t => ({ ...t, remaining: Math.max(0, t.capacity - t.sold) }));
  const cells = (cellRows as CellRow[]).map(c => ({
    ...c,
    // A cell with no override is still bounded by the type's EVENT-WIDE
    // remaining (its sales anywhere count), exactly as the gate's
    // fallback counts — so `remaining` here is what a purchaser could
    // actually book in that cell right now, before the session's own
    // shared cap (reported on the session) is applied.
    remaining: Math.max(0, c.override_capacity === null
      ? Math.min(c.effective_capacity - c.sold, (ticketTypes.find(t => t.id === c.ticket_type_id)?.remaining ?? 0))
      : c.effective_capacity - c.sold),
  }));

  return NextResponse.json({ sessions, ticket_types: ticketTypes, cells });
}
