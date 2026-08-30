import 'server-only';
import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';

export type PublicHubEvent = {
  id: string;
  name: string;
  slug: string;
  venue: string | null;
  artwork_url: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  // Cheapest active ticket type's price, in cents — null if the event
  // currently has no active ticket types at all (still listed; the
  // event page itself already handles "no tickets available"). 0
  // means at least one active ticket type is free.
  from_price_cents: number | null;
};

export type PublicEventsHubResult =
  | { ok: true; organisationName: string; events: PublicHubEvent[] }
  | { ok: false };

// The reusable, organisation-agnostic public events hub (§Step 4) —
// works for ANY BrainBase organisation with the Events capability
// entitled, not just one. Mirrors lib/events/publicResolve.ts's own
// discipline exactly: resolve organisation by slug (never trust an id
// from anywhere else), fail closed on a capability-lookup error
// (never "allowed" by default), and never hardcode an organisation
// name, id, or event slug anywhere in this function.
//
// "Public/upcoming eligible" uses the EXISTING model, not an invented
// one (§4.6): events.status = 'PUBLISHED' is already the sole gate
// that unlocks public registration elsewhere in this module (see
// resolvePublicEvent) — a DRAFT event was never made public in the
// first place, and a CANCELLED event is explicitly excluded here.
// There is no separate "private/internal-only" flag in this schema;
// PUBLISHED already means "intended for public visibility" — adding a
// second, redundant visibility concept would be exactly the kind of
// arbitrary new state the brief asks NOT to invent.
//
// "Upcoming" is `ends_at >= NOW()` — an event that is currently in
// progress still belongs on this list; one that has fully concluded
// does not. Ordered by starts_at ascending — soonest first.
export async function getPublicUpcomingEvents(organisationSlug: string): Promise<PublicEventsHubResult> {
  const orgRows = await sql`
    SELECT id, name FROM organisations WHERE slug = ${organisationSlug} LIMIT 1
  `;
  const org = orgRows[0] as { id: string; name: string } | undefined;
  if (!org) return { ok: false };

  const capability = await checkCapability(org.id, 'events');
  if (!capability.allowed) return { ok: false };

  const eventRows = await sql`
    SELECT
      e.id, e.name, e.slug, e.venue, e.artwork_url, e.starts_at, e.ends_at, e.timezone,
      (SELECT MIN(tt.price_cents) FROM event_ticket_types tt WHERE tt.event_id = e.id AND tt.organisation_id = e.organisation_id AND tt.active = true) AS from_price_cents
    FROM events e
    WHERE e.organisation_id = ${org.id} AND e.status = 'PUBLISHED' AND e.ends_at >= NOW()
    ORDER BY e.starts_at ASC
  `;

  return {
    ok: true,
    organisationName: org.name,
    events: (eventRows as (Omit<PublicHubEvent, 'starts_at' | 'ends_at' | 'from_price_cents'> & {
      starts_at: Date | string; ends_at: Date | string; from_price_cents: number | string | null;
    })[]).map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      venue: row.venue,
      artwork_url: row.artwork_url,
      starts_at: new Date(row.starts_at).toISOString(),
      ends_at: new Date(row.ends_at).toISOString(),
      timezone: row.timezone,
      from_price_cents: row.from_price_cents === null ? null : Number(row.from_price_cents),
    })),
  };
}
