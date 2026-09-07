import sql from '@/lib/db';

// Phase C3-POLISH-R — the tenant's own trading identity for
// customer-facing Commercial documents (quote/future-invoice letterhead:
// "SUPPLIER SECTION" per the C3-POLISH-R brief §1). There is no dedicated
// business-profile table anywhere in this codebase, and adding one is
// out of this phase's bounded scope (it would need its own migration,
// and this phase makes no production schema changes). organisations
// already carries a `settings JSONB NOT NULL DEFAULT '{}'` column
// (prisma/schema.prisma's Organisation model) that nothing in the
// codebase currently reads or writes — a namespaced key on it
// (`settings.commercial.businessProfile`) is the correct, zero-migration
// home for this, matching the column's own evident purpose (free-form,
// per-organisation configuration) rather than inventing a second
// settings mechanism.
//
// Every field is OPTIONAL ("where configured" — the brief's own
// language): an organisation that has configured nothing still gets a
// usable, professional-looking document — it just falls back to the
// organisation's own `name` and omits the address/phone/ABN lines
// entirely (see app/commercial/quotes/[id]/page.tsx's PDF builder and
// lib/commercial/quoteEmail.ts, both of which treat every field here as
// nullable).

export interface CommercialBusinessProfile {
  tradingName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
}

const EMPTY_PROFILE: CommercialBusinessProfile = {
  tradingName: null,
  address: null,
  email: null,
  phone: null,
  abn: null,
};

function coerceProfile(raw: unknown): CommercialBusinessProfile {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROFILE };
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  return {
    tradingName: str(r.tradingName),
    address: str(r.address),
    email: str(r.email),
    phone: str(r.phone),
    abn: str(r.abn),
  };
}

// Returns the organisation's configured business profile PLUS its plain
// `name` (organisations.name always exists — this is the fallback the
// UI/PDF/email use when tradingName is not configured). Returns null
// only if the organisation itself does not exist.
export async function getBusinessProfile(organisationId: string): Promise<{ organisationName: string; profile: CommercialBusinessProfile } | null> {
  const rows = (await sql`
    SELECT name, settings FROM organisations WHERE id = ${organisationId}
  `) as { name: string; settings: unknown }[];
  const org = rows[0];
  if (!org) return null;

  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const commercial = (settings.commercial ?? {}) as Record<string, unknown>;
  return { organisationName: org.name, profile: coerceProfile(commercial.businessProfile) };
}

// Merges (never replaces) the `commercial` namespace on
// organisations.settings so an unrelated future key under
// `settings.commercial` (or any other top-level settings namespace) is
// never clobbered by a business-profile save. Fetches the current
// `commercial` object and merges in application code rather than a
// single nested jsonb_set('{commercial,businessProfile}', ...) call —
// Postgres's jsonb_set does NOT create a missing INTERMEDIATE path
// element even with create_missing=true (only the final key), so a
// two-level nested path silently no-ops on an organisation whose
// settings has no `commercial` key yet. Read-merge-write at the
// top-level `commercial` key sidesteps that entirely.
//
// administer-role gated by the calling route, not here — this module
// never resolves organisationId or checks a role itself, matching every
// other lib/commercial/*.ts module's discipline.
export async function setBusinessProfile(organisationId: string, profile: CommercialBusinessProfile): Promise<void> {
  const rows = (await sql`SELECT settings FROM organisations WHERE id = ${organisationId}`) as { settings: unknown }[];
  const settings = (rows[0]?.settings ?? {}) as Record<string, unknown>;
  const existingCommercial = (settings.commercial ?? {}) as Record<string, unknown>;
  const merged = { ...existingCommercial, businessProfile: coerceProfile(profile) };

  await sql`
    UPDATE organisations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{commercial}', ${JSON.stringify(merged)}::jsonb, true),
        updated_at = now()
    WHERE id = ${organisationId}
  `;
}
