import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';

type Ctx = { params: Promise<{ id: string }> };

// Staff-authenticated read of an event's registrations (orders + items
// + attendees) — viewer+, same authorizeEventsRequest() gate as every
// other Events route (session + 'events' capability + role). Tenant-
// scoped: every query below is explicitly filtered by the caller's own
// organisation_id, resolved only from the authenticated session.
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const eventRows = await sql`
    SELECT id FROM events WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const orders = await sql`
    SELECT
      eo.id, eo.purchaser_name, eo.purchaser_email, eo.purchaser_phone, eo.status, eo.created_at,
      eo.payment_status, eo.total_cents, eo.currency, eo.paid_at, eo.refunded_at, eo.stripe_payment_intent_id IS NOT NULL AS refundable,
      eo.expires_at, (eo.payment_status = 'PENDING' AND eo.expires_at IS NOT NULL AND eo.expires_at <= NOW()) AS is_expired_pending,
      oi.id AS order_item_id, oi.quantity,
      tt.id AS ticket_type_id, tt.name AS ticket_type_name,
      es.id AS event_session_id, es.name AS session_name,
      COALESCE(
        json_agg(json_build_object('id', ea.id, 'name', ea.attendee_name, 'email', ea.attendee_email, 'checked_in_at', ea.checked_in_at))
          FILTER (WHERE ea.id IS NOT NULL),
        '[]'
      ) AS attendees
    FROM event_orders eo
    JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    LEFT JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
    WHERE eo.event_id = ${id} AND eo.organisation_id = ${session.organisationId}
    GROUP BY eo.id, oi.id, tt.id, tt.name, es.id, es.name
    ORDER BY eo.created_at DESC
  `;

  return NextResponse.json({ orders });
}
