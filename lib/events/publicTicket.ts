import 'server-only';
import sql from '@/lib/db';

export type PublicTicketDetail = {
  attendee_name: string;
  checked_in_at: string | null;
  status: 'VALID' | 'CANCELLED';
  event: {
    name: string;
    venue: string | null;
    artwork_url: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
  };
  ticket_type_name: string | null;
  session: { name: string; starts_at: string; ends_at: string } | null;
};

export type PublicTicketResult =
  | { ok: true; detail: PublicTicketDetail }
  | { ok: false };

// The single choke point every ticket-facing surface resolves through
// (the public ticket page, the public ticket API route, and QR
// generation for the digital ticket) — token in, an explicit public-
// safe field allow-list out. Mirrors lib/events/publicEventDetail.ts's
// own discipline exactly: never `SELECT *`, never returns purchaser
// email, organisation id, attendee/order/session/ticket-type internal
// ids, or created_by. A ticket_token that does not exist at all and a
// ticket_token that exists but belongs to a different organisation (a
// structurally impossible case in practice, since the token itself is
// the only credential and carries no organisation hint, but the WHERE
// clause below is still explicit about it for defense in depth) both
// collapse to the same { ok: false } — a caller can never distinguish
// "wrong token" from "token exists, wrong tenant".
//
// Phase 4 payment gating needs no change here: ticket_token is only
// ever set by lib/events/stripe.ts's issueTicketTokensForPaidOrder(),
// which only runs once a Checkout Session's own payment_status is
// genuinely 'paid' (see that file's handleCheckoutSessionCompleted
// comment) — a PENDING/FAILED/EXPIRED paid order therefore never has a
// row this query can find at all, and a REFUNDED order's existing
// token still resolves but correctly reports CANCELLED below, since a
// refund also sets the owning order's `status` to CANCELLED (§23's
// explicit "refund also cancels tickets" choice — see the refund
// route's own comment).
export async function getPublicTicketDetail(ticketToken: string): Promise<PublicTicketResult> {
  if (!ticketToken || typeof ticketToken !== 'string') return { ok: false };

  const rows = await sql`
    SELECT
      ea.attendee_name, ea.checked_in_at,
      eo.status AS order_status,
      e.name AS event_name, e.venue, e.artwork_url, e.starts_at, e.ends_at, e.timezone,
      tt.name AS ticket_type_name,
      es.name AS session_name, es.starts_at AS session_starts_at, es.ends_at AS session_ends_at
    FROM event_attendees ea
    JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
    JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
    JOIN events e ON e.id = ea.event_id AND e.organisation_id = ea.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    WHERE ea.ticket_token = ${ticketToken}
    LIMIT 1
  `;
  const row = rows[0] as {
    attendee_name: string; checked_in_at: Date | string | null; order_status: string;
    event_name: string; venue: string | null; artwork_url: string | null;
    starts_at: Date | string; ends_at: Date | string; timezone: string;
    ticket_type_name: string | null;
    session_name: string | null; session_starts_at: Date | string | null; session_ends_at: Date | string | null;
  } | undefined;
  if (!row) return { ok: false };

  return {
    ok: true,
    detail: {
      attendee_name: row.attendee_name,
      checked_in_at: row.checked_in_at ? new Date(row.checked_in_at).toISOString() : null,
      status: row.order_status === 'CANCELLED' ? 'CANCELLED' : 'VALID',
      event: {
        name: row.event_name,
        venue: row.venue,
        artwork_url: row.artwork_url,
        starts_at: new Date(row.starts_at).toISOString(),
        ends_at: new Date(row.ends_at).toISOString(),
        timezone: row.timezone,
      },
      ticket_type_name: row.ticket_type_name,
      session: row.session_name
        ? {
            name: row.session_name,
            starts_at: new Date(row.session_starts_at as Date | string).toISOString(),
            ends_at: new Date(row.session_ends_at as Date | string).toISOString(),
          }
        : null,
    },
  };
}
