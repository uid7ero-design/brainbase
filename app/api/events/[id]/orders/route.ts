import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { checkCapability } from '@/lib/capabilities/requireCapability';

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

  // Phase 4B §7 — order-level and attendee-level registration-question
  // responses are attached here as nested JSON, via correlated
  // subqueries rather than an additional LEFT JOIN: a JOIN against
  // event_registration_responses would fan out against the existing
  // ea/oi join multiplicity (one row per attendee × one row per
  // response), inflating counts; a per-row scalar subquery avoids that
  // entirely. Every subquery still carries its own organisation_id
  // check, matching this schema's tenant-integrity discipline even
  // though the outer WHERE already scopes eo/ea to this organisation.
  // Reads question_label_snapshot/field_type_snapshot (never the live
  // question row) so a later edit to a question's wording never
  // rewrites how a historical registration's answers are displayed
  // here (§3). This is a viewer+ route (see authorizeEventsRequest
  // above) — never exposed on the public ticket endpoint (see
  // lib/events/publicTicket.ts, untouched by this phase) (§6).
  const orders = await sql`
    SELECT
      eo.id, eo.purchaser_name, eo.purchaser_email, eo.purchaser_phone, eo.status, eo.created_at,
      eo.payment_status, eo.total_cents, eo.currency, eo.paid_at, eo.refunded_at, eo.stripe_payment_intent_id IS NOT NULL AS refundable,
      eo.crm_contact_id,
      eo.expires_at, (eo.payment_status = 'PENDING' AND eo.expires_at IS NOT NULL AND eo.expires_at <= NOW()) AS is_expired_pending,
      oi.id AS order_item_id, oi.quantity,
      tt.id AS ticket_type_id, tt.name AS ticket_type_name,
      es.id AS event_session_id, es.name AS session_name,
      COALESCE(
        json_agg(json_build_object(
          'id', ea.id, 'name', ea.attendee_name, 'email', ea.attendee_email,
          'checked_in_at', ea.checked_in_at,
          -- Phase 6 §10 — "checked_in_by where available". Resolved by
          -- name via a LEFT JOIN (below) rather than exposing the raw
          -- checked_in_by_user_id: a manager reading this panel wants
          -- to know WHO checked someone in, not a bare id. Genuinely
          -- NULL (not fabricated) whenever checked_in_by_user_id itself
          -- is NULL — an attendee never checked in, or the checking-in
          -- user's account was since deleted (checked_in_by_user_id is
          -- ON DELETE SET NULL — see scripts/add-events-ticketing.sql).
          'checked_in_by', cu.name,
          -- Phase 6 §9 — exposes the existing ticket_token so a manager
          -- can view/copy the real ticket link without needing a
          -- separate lookup route. NULL for PENDING/CANCELLED/REFUNDED
          -- attendees exactly as already established (see
          -- lib/events/ticketToken.ts and the checkout/register routes)
          -- — this SELECT does not change when a token exists, only
          -- whether it is now included in this already-staff-only
          -- response.
          'ticket_token', ea.ticket_token,
          'responses', COALESCE((
            SELECT json_agg(json_build_object(
              -- Phase 6 §6 — 'id' (the response row's own PK) is included
              -- so the manager UI can target PATCH
              -- .../orders/[orderId]/responses/[responseId] for an edit;
              -- every other field here is unchanged from before this
              -- phase.
              'id', r.id, 'question_id', r.question_id, 'label', r.question_label_snapshot, 'field_type', r.field_type_snapshot, 'answer', r.answer
            ) ORDER BY r.created_at)
            FROM event_registration_responses r
            WHERE r.attendee_id = ea.id AND r.organisation_id = ea.organisation_id
          ), '[]')
        ))
          FILTER (WHERE ea.id IS NOT NULL),
        '[]'
      ) AS attendees,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', r.id, 'question_id', r.question_id, 'label', r.question_label_snapshot, 'field_type', r.field_type_snapshot, 'answer', r.answer
        ) ORDER BY r.created_at)
        FROM event_registration_responses r
        WHERE r.order_id = eo.id AND r.attendee_id IS NULL AND r.organisation_id = eo.organisation_id
      ), '[]') AS order_responses
    FROM event_orders eo
    JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    LEFT JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
    LEFT JOIN users cu ON cu.id = ea.checked_in_by_user_id
    WHERE eo.event_id = ${id} AND eo.organisation_id = ${session.organisationId}
    GROUP BY eo.id, oi.id, tt.id, tt.name, es.id, es.name
    ORDER BY eo.created_at DESC
  `;

  // Phase 5 — whether the "View CRM Contact" action may render at all is
  // decided server-side, once, here: crm_enabled reflects this
  // organisation's OWN CRM capability entitlement (not a global
  // modules-row check — see lib/capabilities/requireCapability.ts).
  // Never exposed on any public endpoint — this route is viewer+
  // staff-authenticated only (see this file's own header comment).
  const crmCapability = await checkCapability(session.organisationId, 'crm');

  return NextResponse.json({ orders, crm_enabled: crmCapability.allowed });
}
