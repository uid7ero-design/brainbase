import 'server-only';
import sql from '@/lib/db';
import { evaluateTicketValidity, toPublicTicketStatus, type PublicTicketStatus } from './ticketValidity';

export type PublicBookingTicket = {
  attendee_name: string;
  ticket_type_name: string | null;
  session: { name: string; starts_at: string; ends_at: string } | null;
  ticket_token: string;
  checked_in_at: string | null;
  status: PublicTicketStatus;
};

export type PublicBookingDetail = {
  purchaser_name: string;
  event: {
    name: string;
    venue: string | null;
    artwork_url: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
  };
  tickets: PublicBookingTicket[];
};

export type PublicBookingResult =
  | { ok: true; detail: PublicBookingDetail }
  | { ok: false };

// The booking-wallet counterpart to lib/events/publicTicket.ts's
// getPublicTicketDetail — same security discipline exactly: never
// `SELECT *`, an explicit public-safe field allow-list out, and a
// bookingToken that does not exist at all vs. one that exists but
// belongs to a different organisation (structurally impossible in
// practice, since the token carries no organisation hint, but the WHERE
// clause below is still explicit about it for defence in depth) both
// collapse to the same { ok: false } — a caller can never distinguish
// "wrong token" from "token exists, wrong tenant".
//
// This is a genuinely SEPARATE lookup path from getPublicTicketDetail —
// it accepts only a booking_token (event_orders) and never an attendee
// ticket_token (event_attendees), and getPublicTicketDetail accepts only
// the reverse. Neither function can resolve the other's kind of token.
// This is deliberate, not an oversight: sharing one attendee's
// individual ticket link must never also grant access to the rest of
// the order's tickets, and holding the booking link must never let you
// pretend to be one specific attendee's own shareable /t/[token] link
// (see this repo's booking-wallet design notes on why event_orders.id
// itself — already shown to purchasers as a plain "confirmation
// reference" — was deliberately rejected as a credential in favour of
// this dedicated token).
//
// Never returns: booking_token itself, organisation_id, event_id,
// order_id, order_item_id, attendee_id, purchaser_email,
// purchaser_phone, created_by, registration-question answers, internal
// staff notes, Stripe ids, or CRM ids.
export async function getPublicBookingDetail(bookingToken: string): Promise<PublicBookingResult> {
  if (!bookingToken || typeof bookingToken !== 'string') return { ok: false };

  const orderRows = await sql`
    SELECT eo.id, eo.organisation_id, eo.purchaser_name, eo.status AS order_status, eo.payment_status,
      e.status AS event_status, e.name AS event_name, e.venue, e.artwork_url, e.starts_at, e.ends_at, e.timezone
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    WHERE eo.booking_token = ${bookingToken}
    LIMIT 1
  `;
  const order = orderRows[0] as {
    id: string; organisation_id: string; purchaser_name: string; order_status: string; payment_status: string;
    event_status: string; event_name: string; venue: string | null; artwork_url: string | null;
    starts_at: Date | string; ends_at: Date | string; timezone: string;
  } | undefined;
  if (!order) return { ok: false };

  // Order/event-level validity is uniform across every ticket in this
  // one booking (there is exactly one order, one event, per booking
  // token) — computed once here and applied to every attendee row,
  // rather than re-derived per row. Per-attendee state (checked_in_at)
  // still varies row by row.
  const validity = evaluateTicketValidity({ eventStatus: order.event_status, orderStatus: order.order_status, paymentStatus: order.payment_status });
  const status = toPublicTicketStatus(validity);

  // Scoped by both order_id AND organisation_id — the organisation_id
  // here is the one just resolved from the booking token itself (never
  // client-supplied), matching getPublicTicketDetail's own tenant-
  // scoping discipline.
  const attendeeRows = await sql`
    SELECT ea.attendee_name, ea.ticket_token, ea.checked_in_at,
      tt.name AS ticket_type_name,
      es.name AS session_name, es.starts_at AS session_starts_at, es.ends_at AS session_ends_at
    FROM event_attendees ea
    JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    WHERE ea.order_id = ${order.id} AND ea.organisation_id = ${order.organisation_id}
    ORDER BY ea.created_at
  `;

  return buildResult(order, attendeeRows as AttendeeQueryRow[], status);
}

type AttendeeQueryRow = {
  attendee_name: string; ticket_token: string | null; checked_in_at: Date | string | null;
  ticket_type_name: string | null;
  session_name: string | null; session_starts_at: Date | string | null; session_ends_at: Date | string | null;
};

function buildResult(
  order: { id: string; purchaser_name: string; event_name: string; venue: string | null; artwork_url: string | null; starts_at: Date | string; ends_at: Date | string; timezone: string },
  attendeeRows: AttendeeQueryRow[],
  status: PublicTicketStatus,
): PublicBookingResult {
  const tickets = attendeeRows
    .filter(a => !!a.ticket_token)
    .map(a => ({
      attendee_name: a.attendee_name,
      ticket_type_name: a.ticket_type_name,
      session: a.session_name
        ? { name: a.session_name, starts_at: new Date(a.session_starts_at as Date | string).toISOString(), ends_at: new Date(a.session_ends_at as Date | string).toISOString() }
        : null,
      ticket_token: a.ticket_token as string,
      checked_in_at: a.checked_in_at ? new Date(a.checked_in_at).toISOString() : null,
      status,
    }));

  return {
    ok: true,
    detail: {
      purchaser_name: order.purchaser_name,
      event: {
        name: order.event_name,
        venue: order.venue,
        artwork_url: order.artwork_url,
        starts_at: new Date(order.starts_at).toISOString(),
        ends_at: new Date(order.ends_at).toISOString(),
        timezone: order.timezone,
      },
      tickets,
    },
  };
}
