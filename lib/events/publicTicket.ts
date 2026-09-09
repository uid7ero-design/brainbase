import 'server-only';
import sql from '@/lib/db';
import { evaluateTicketValidity, toPublicTicketStatus, type PublicTicketStatus } from './ticketValidity';
import { normalisePublicOrganisationBranding, type PublicOrganisationBranding } from '@/lib/organisations/branding';

export type PublicTicketDetail = {
  attendee_name: string;
  checked_in_at: string | null;
  status: PublicTicketStatus;
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
  // Additive (Phase 3A), now rendered via TicketCard (Phase 3C).
  // Public-safe view model only, resolved from the SAME organisation
  // join this query already needs (ea.organisation_id) — no
  // organisationId, no raw settings, ever returned.
  branding: PublicOrganisationBranding;
  // The organisation's own plain name (organisations.name) — same
  // render-layer fallback role as PublicEventDetail.organisationName
  // (Phase 3B): branding.name is deliberately never substituted inside
  // the branding module itself (see normalisePublicOrganisationBranding's
  // own comment), so callers that need a definite display name — e.g.
  // OrganisationLogo's initials fallback, which requires a non-null
  // organisationName — use this field instead. Reuses the organisation
  // row this query already joins; no new query, no tenancy change.
  organisationName: string;
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
// Payment gating: ticket_token is only ever set by
// lib/events/stripe.ts's issueTicketTokensForPaidOrder(), which only
// runs once a Checkout Session's own payment_status is genuinely 'paid'
// (see that file's handleCheckoutSessionCompleted comment) — a
// PENDING/FAILED/EXPIRED paid order therefore never has a row this
// query can find at all in practice. payment_status is still selected
// and re-checked below (evaluateTicketValidity) as defence in depth,
// not as the only thing standing between an unpaid order and a
// resolvable token.
//
// Event-cancellation gating: e.status is selected and fed through the
// same evaluateTicketValidity() the booking wallet
// (lib/events/publicBooking.ts) and staff check-in
// (lib/events/checkIn.ts) both use — a cancelled EVENT (as opposed to a
// cancelled order) now also renders as invalid here, closing a gap
// that previously existed: only order-level cancellation was checked.
export async function getPublicTicketDetail(ticketToken: string): Promise<PublicTicketResult> {
  if (!ticketToken || typeof ticketToken !== 'string') return { ok: false };

  const rows = await sql`
    SELECT
      ea.attendee_name, ea.checked_in_at,
      eo.status AS order_status, eo.payment_status,
      e.status AS event_status, e.name AS event_name, e.venue, e.artwork_url, e.starts_at, e.ends_at, e.timezone,
      tt.name AS ticket_type_name,
      es.name AS session_name, es.starts_at AS session_starts_at, es.ends_at AS session_ends_at,
      o.name AS organisation_name, o.settings AS organisation_settings
    FROM event_attendees ea
    JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
    JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
    JOIN events e ON e.id = ea.event_id AND e.organisation_id = ea.organisation_id
    JOIN organisations o ON o.id = ea.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    WHERE ea.ticket_token = ${ticketToken}
    LIMIT 1
  `;
  const row = rows[0] as {
    attendee_name: string; checked_in_at: Date | string | null; order_status: string; payment_status: string;
    event_status: string; event_name: string; venue: string | null; artwork_url: string | null;
    starts_at: Date | string; ends_at: Date | string; timezone: string;
    ticket_type_name: string | null;
    session_name: string | null; session_starts_at: Date | string | null; session_ends_at: Date | string | null;
    organisation_name: string; organisation_settings: unknown;
  } | undefined;
  if (!row) return { ok: false };

  const validity = evaluateTicketValidity({ eventStatus: row.event_status, orderStatus: row.order_status, paymentStatus: row.payment_status });

  return {
    ok: true,
    detail: {
      attendee_name: row.attendee_name,
      checked_in_at: row.checked_in_at ? new Date(row.checked_in_at).toISOString() : null,
      status: toPublicTicketStatus(validity),
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
      branding: normalisePublicOrganisationBranding(row.organisation_settings, row.organisation_name),
      organisationName: row.organisation_name,
    },
  };
}
