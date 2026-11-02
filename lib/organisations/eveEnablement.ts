import sql from '@/lib/db';

// Eve organiser allow-list. An organisation's published events are offered on
// Eve (eveevents.com.au) only when that organisation has been explicitly
// enabled for Eve. Being entitled to Events — and publishing an event — is
// NOT enough: Events entitlement is BrainBase's own module gate, while this
// is a separate, per-organisation decision to appear on a public product.
//
// Storage: organisations.settings.events.eveEnabled, a namespaced key on the
// existing `settings` JSONB column (sibling to settings.branding and
// settings.commercial). No new table, column or migration. Default-deny:
// anything other than the JSON boolean `true` — missing key, missing
// namespace, NULL settings, a string "true", a number — reads as disabled.
//
// Like lib/organisations/branding.ts, nothing here resolves an organisation
// or checks a role: every function takes an already-trusted organisationId
// (or already-loaded settings value) from its caller. Who may change the
// setting is the route's concern (app/api/organisations/eve/route.ts).

// Reads the setting from an already-loaded organisations.settings value, so a
// resolver that has the row in hand (resolvePublicEvent) needs no second query.
export function isEveEnabledSetting(rawSettings: unknown): boolean {
  if (!rawSettings || typeof rawSettings !== 'object') return false;
  const events = (rawSettings as Record<string, unknown>).events;
  if (!events || typeof events !== 'object') return false;
  return (events as Record<string, unknown>).eveEnabled === true;
}

// null only when the organisation does not exist.
export async function getOrganisationEveEnabled(organisationId: string): Promise<boolean | null> {
  const rows = (await sql`
    SELECT settings FROM organisations WHERE id = ${organisationId}
  `) as { settings: unknown }[];
  if (!rows[0]) return null;
  return isEveEnabledSetting(rows[0].settings);
}

// Sets only settings.events.eveEnabled, in one atomic UPDATE. Every other
// key inside settings.events, and every other top-level namespace, is
// preserved (jsonb_set touches the one path; the events object is merged,
// not replaced). A non-object settings.events value is treated as empty
// rather than merged into, so the result is always a well-formed object.
// Returns the previous value (for the audit record) or null when the
// organisation does not exist.
export async function setOrganisationEveEnabled(
  organisationId: string,
  enabled: boolean,
): Promise<{ before: boolean; after: boolean } | null> {
  const rows = (await sql`
    WITH prev AS (
      SELECT settings FROM organisations WHERE id = ${organisationId} FOR UPDATE
    )
    UPDATE organisations
    SET settings = jsonb_set(
          COALESCE(organisations.settings, '{}'::jsonb),
          '{events}',
          (CASE WHEN jsonb_typeof(organisations.settings -> 'events') = 'object'
                THEN organisations.settings -> 'events'
                ELSE '{}'::jsonb END) || jsonb_build_object('eveEnabled', ${enabled}::boolean),
          true
        ),
        updated_at = now()
    FROM prev
    WHERE organisations.id = ${organisationId}
    RETURNING prev.settings AS before_settings, organisations.settings AS after_settings
  `) as { before_settings: unknown; after_settings: unknown }[];
  if (!rows[0]) return null;
  return { before: isEveEnabledSetting(rows[0].before_settings), after: isEveEnabledSetting(rows[0].after_settings) };
}
