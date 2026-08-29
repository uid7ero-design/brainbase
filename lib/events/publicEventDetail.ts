import 'server-only';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';

export type PublicSession = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  remaining: number;
};

export type PublicTicketType = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number;
  remaining: number;
};

export type PublicEventDetail = {
  event: {
    name: string;
    slug: string;
    description: string | null;
    venue: string | null;
    // Externally-hosted image URL — approved public-safe field, see
    // scripts/add-events-artwork.sql and PublicEvent's own comment.
    artwork_url: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
  };
  sessions: PublicSession[];
  ticket_types: PublicTicketType[];
};

export type PublicEventDetailResult =
  | { ok: true; detail: PublicEventDetail }
  | { ok: false };

// Shared by both the public API route and the public page's own
// server-side fetch, so the "which fields are safe to expose publicly"
// decision lives in exactly one place. Deliberately returns only:
// event name/description/venue/start/end/timezone, and per session/
// ticket-type: name, capacity, remaining availability, and (for ticket
// types) description/price. Never returns organisation internal ids,
// created_by, attendee lists, purchaser data, or internal status
// metadata — see this file's own field lists, which are the exhaustive
// allow-list, not a redaction of a wider row.
//
// "remaining" is computed by subtracting the sum of quantities from
// active (non-CANCELLED) event_order_items against that row's id — a
// read-only estimate for display purposes. It is NOT the mechanism that
// enforces capacity; that is the FOR UPDATE-gated write path in the
// register route. A remaining count read here can be stale by the time
// a registration is submitted (by design — capacity correctness is a
// write-time, not a read-time, guarantee), and is clamped to a minimum
// of 0 for display even if a legacy discrepancy ever produced a
// negative value.
//
// Both "remaining" expressions below are explicitly cast to ::int.
// Root cause of a real bug this fixes: Postgres's SUM(int) returns
// bigint, so tt.capacity - COALESCE(SUM(...), 0) is bigint arithmetic
// throughout, and GREATEST(bigint, 0) is itself bigint. The Neon
// serverless driver returns bigint columns as JS strings (not numbers)
// by default, since not every bigint value round-trips safely through
// a JS number — so `remaining` was a STRING at runtime despite
// PublicTicketType/PublicSession's own `remaining: number` type lying
// about it. That silently turned PublicEventClient's
// `.reduce((sum, t) => sum + t.remaining, 0)` into STRING
// CONCATENATION (0 + "280" + "147" -> "0280147", not 427) — the exact
// malformed "0280147 places remaining" defect this pass was asked to
// investigate. Casting to ::int here makes the driver return a real
// JS number, fixing the type at its source for every caller, not just
// the one call site that happened to reduce() over it.
export async function getPublicEventDetail(
  organisationSlug: string,
  eventSlug: string,
): Promise<PublicEventDetailResult> {
  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return { ok: false };
  const { organisationId, event } = resolved;

  const [sessionRows, ticketTypeRows] = await Promise.all([
    sql`
      SELECT
        es.id, es.name, es.starts_at, es.ends_at, es.capacity,
        GREATEST(
          es.capacity - COALESCE((
            SELECT SUM(oi.quantity)
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.event_session_id = es.id AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
          ), 0),
          0
        )::int AS remaining
      FROM event_sessions es
      WHERE es.event_id = ${event.id} AND es.organisation_id = ${organisationId}
      ORDER BY es.starts_at
    `,
    sql`
      SELECT
        tt.id, tt.name, tt.description, tt.price_cents, tt.capacity,
        GREATEST(
          tt.capacity - COALESCE((
            SELECT SUM(oi.quantity)
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.ticket_type_id = tt.id AND oi.organisation_id = ${organisationId} AND eo.status <> 'CANCELLED'
          ), 0),
          0
        )::int AS remaining
      FROM event_ticket_types tt
      WHERE tt.event_id = ${event.id} AND tt.organisation_id = ${organisationId} AND tt.active = true
      ORDER BY tt.sort_order, tt.created_at
    `,
  ]);

  return {
    ok: true,
    detail: {
      event: {
        name: event.name,
        slug: event.slug,
        description: event.description,
        venue: event.venue,
        artwork_url: event.artwork_url,
        starts_at: new Date(event.starts_at).toISOString(),
        ends_at: new Date(event.ends_at).toISOString(),
        timezone: event.timezone,
      },
      sessions: sessionRows as unknown as PublicSession[],
      ticket_types: ticketTypeRows as unknown as PublicTicketType[],
    },
  };
}
