import 'server-only';
import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';

export type PublicEvent = {
  id: string;
  organisation_id: string;
  name: string;
  slug: string;
  description: string | null;
  venue: string | null;
  // Externally-hosted image URL, approved as a public-safe field — see
  // scripts/add-events-artwork.sql. Not internal storage metadata: it
  // is the exact same value the organiser typed into the event editor.
  artwork_url: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  timezone: string;
};

export type PublicResolveResult =
  | { ok: true; organisationId: string; event: PublicEvent }
  | { ok: false };

// The single choke point every public Events route (GET, register, and
// the public page's own server-side fetch) must resolve through.
// Resolves an organisation and a published event from untrusted URL
// path segments (organisationSlug, eventSlug) — never accepts an
// organisationId from any other source. Every failure reason
// (organisation doesn't exist, Events capability not entitled for that
// org — including a capability-lookup DB failure, which fails closed
// exactly like "not entitled" rather than surfacing a 500 — event
// doesn't exist, event belongs to a different organisation than the
// slug pair implies, event isn't PUBLISHED) collapses to the same
// `{ ok: false }`, so a public caller can never distinguish "doesn't
// exist" from "exists but temporarily/permanently unavailable" via
// status code, response shape, or which check failed.
export async function resolvePublicEvent(
  organisationSlug: string,
  eventSlug: string,
): Promise<PublicResolveResult> {
  const orgRows = await sql`
    SELECT id FROM organisations WHERE slug = ${organisationSlug} LIMIT 1
  `;
  const organisationId = orgRows[0]?.id as string | undefined;
  if (!organisationId) return { ok: false };

  // checkCapability() never throws — a database error resolves to
  // { allowed: false, reason: 'DATABASE_ERROR' }, which this treats
  // identically to "not entitled". That is the fail-closed behaviour
  // section 17 requires for public reads: an outage in the entitlement
  // lookup must never be interpreted as "allowed".
  const capability = await checkCapability(organisationId, 'events');
  if (!capability.allowed) return { ok: false };

  const eventRows = await sql`
    SELECT id, organisation_id, name, slug, description, venue, artwork_url, starts_at, ends_at, timezone
    FROM events
    WHERE organisation_id = ${organisationId} AND slug = ${eventSlug} AND status = 'PUBLISHED'
    LIMIT 1
  `;
  const event = eventRows[0] as PublicEvent | undefined;
  if (!event) return { ok: false };

  return { ok: true, organisationId, event };
}
