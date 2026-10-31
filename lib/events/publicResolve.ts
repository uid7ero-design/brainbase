import 'server-only';
import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { normaliseEveOrganiserContact, normalisePublicOrganisationBranding, type EveOrganiserContact, type PublicOrganisationBranding } from '@/lib/organisations/branding';
import { isEveEnabledSetting } from '@/lib/organisations/eveEnablement';

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
  // Eve per-event opt-in for registration questions (ADR 0013 §4). Read by
  // the services for the EVE surface and by the Eve event read; never
  // included in any public response body. Anything but true means off.
  eve_questions_enabled?: boolean;
};

export type PublicResolveResult =
  | {
      ok: true; organisationId: string; organisationName: string; event: PublicEvent; branding: PublicOrganisationBranding;
      // Eve organiser contact v1 (public email + website allowlist, or null).
      // Read only by the Eve gateway; BrainBase pages and routes ignore it.
      eveOrganiserContact: EveOrganiserContact | null;
      // Eve organiser allow-list (settings.events.eveEnabled === true). Read
      // only by the Eve gateway, which refuses the event when false; BrainBase
      // pages and routes ignore it, so their behaviour is unchanged.
      eveEnabled: boolean;
    }
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
  // Also selects name/settings alongside the id this query already
  // needed — same round trip, wider column list only — so branding can
  // be normalised in-process below without a second query. See
  // lib/organisations/branding.ts's normaliseOrganisationBranding/
  // normalisePublicOrganisationBranding for why this pattern exists.
  const orgRows = await sql`
    SELECT id, name, settings FROM organisations WHERE slug = ${organisationSlug} LIMIT 1
  `;
  const organisationId = orgRows[0]?.id as string | undefined;
  if (!organisationId) return { ok: false };
  const organisationName = orgRows[0]?.name as string;
  const organisationSettings = orgRows[0]?.settings as unknown;

  // checkCapability() never throws — a database error resolves to
  // { allowed: false, reason: 'DATABASE_ERROR' }, which this treats
  // identically to "not entitled". That is the fail-closed behaviour
  // section 17 requires for public reads: an outage in the entitlement
  // lookup must never be interpreted as "allowed".
  const capability = await checkCapability(organisationId, 'events');
  if (!capability.allowed) return { ok: false };

  const eventRows = await sql`
    SELECT id, organisation_id, name, slug, description, venue, artwork_url, starts_at, ends_at, timezone, eve_questions_enabled
    FROM events
    WHERE organisation_id = ${organisationId} AND slug = ${eventSlug} AND status = 'PUBLISHED'
    LIMIT 1
  `;
  const event = eventRows[0] as PublicEvent | undefined;
  if (!event) return { ok: false };

  const branding = normalisePublicOrganisationBranding(organisationSettings, organisationName);

  const eveOrganiserContact = normaliseEveOrganiserContact(organisationSettings);

  const eveEnabled = isEveEnabledSetting(organisationSettings);

  return { ok: true, organisationId, organisationName, event, branding, eveOrganiserContact, eveEnabled };
}
