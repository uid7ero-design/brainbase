import 'server-only';
import sql from '@/lib/db';
import { normaliseOrganisationBranding } from '@/lib/organisations/branding';
import { resolveFeePolicy, type FeePolicyResolution } from '@/lib/events/services/fees';

// READ-ONLY organiser view of organisation / fee / branding configuration.
// Every query is scoped to the caller's organisation. Nothing here writes,
// calls a provider, or exposes a provider identifier, an entitlement config
// blob, a storage URL or a policy id/version.

export type OrganisationRow = { id: string; name: string; slug: string; settings: unknown };

export async function getOrganisationRow(organisationId: string): Promise<OrganisationRow | null> {
  const rows = (await sql`
    SELECT id, name, slug, settings FROM organisations WHERE id = ${organisationId} LIMIT 1
  `) as OrganisationRow[];
  return rows[0] ?? null;
}

export async function getOwnEvent(organisationId: string, eventId: string): Promise<{ id: string; name: string } | null> {
  const rows = (await sql`
    SELECT id, name FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1
  `) as { id: string; name: string }[];
  return rows[0] ?? null;
}

// How many events carry their OWN fee-policy row (which would override the
// organisation-level policy for that event).
export async function countEventFeeOverrides(organisationId: string): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM ticketing_fee_policies WHERE organisation_id = ${organisationId} AND event_id IS NOT NULL
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

// Same resolver the checkout and public quote use (lib/events/services/fees.ts:
// event row > organisation row > platform default). An empty event id matches
// no event row, which yields the ORGANISATION-level answer (or the platform
// default when no organisation row exists).
export async function resolveEffectiveFeePolicy(organisationId: string, eventId: string | null): Promise<FeePolicyResolution> {
  return resolveFeePolicy(organisationId, eventId ?? '');
}

export type FeePolicyView =
  | { state: 'NO_FEE'; source: 'EVENT' | 'ORGANISATION' | 'PLATFORM_DEFAULT'; reason: 'NOT_CONFIGURED' | 'DISABLED' }
  | {
      state: 'FEE';
      source: 'EVENT' | 'ORGANISATION';
      fee_mode: 'PASS_THROUGH' | 'ABSORB';
      paid_by: 'BUYER' | 'ORGANISER';
      percent_bps: number;
      fixed_per_order_cents: number;
      fixed_per_ticket_cents: number;
      min_fee_cents: number | null;
      max_fee_cents: number | null;
      currency: string;
      label: string;
    };

// Allow-listed projection of a resolved policy. Never the policy id, version
// or tax metadata; never a hypothetical revenue figure.
export function feePolicyView(r: FeePolicyResolution): FeePolicyView {
  if (!r.policy) {
    return { state: 'NO_FEE', source: r.source, reason: r.source === 'PLATFORM_DEFAULT' ? 'NOT_CONFIGURED' : 'DISABLED' };
  }
  const p = r.policy;
  return {
    state: 'FEE',
    source: r.source === 'EVENT' ? 'EVENT' : 'ORGANISATION',
    fee_mode: p.fee_mode,
    paid_by: p.fee_mode === 'PASS_THROUGH' ? 'BUYER' : 'ORGANISER',
    percent_bps: p.percent_bps,
    fixed_per_order_cents: p.fixed_per_order_cents,
    fixed_per_ticket_cents: p.fixed_per_ticket_cents,
    min_fee_cents: p.min_fee_cents,
    max_fee_cents: p.max_fee_cents,
    currency: p.currency,
    label: p.label,
  };
}

export type BrandingView = {
  configured: boolean;
  display_name: string;
  display_name_is_custom: boolean;
  logo_configured: boolean;
  accent_color: string | null;
  website: string | null;
  support_email: string | null;
  support_phone: string | null;
  email_footer: string | null;
};

// The organiser's own saved branding (organisations.settings.branding) through
// the existing coercion. The logo URL itself is NOT returned — only whether
// one is set. Address, ABN and the BrainBase sender name are not projected.
export function brandingView(rawSettings: unknown, organisationName: string): BrandingView {
  const { branding } = normaliseOrganisationBranding(rawSettings, organisationName);
  const custom = typeof branding.name === 'string' && branding.name.trim() !== '';
  const view: BrandingView = {
    configured: false,
    display_name: custom ? (branding.name as string) : organisationName,
    display_name_is_custom: custom,
    logo_configured: !!branding.logoUrl,
    accent_color: branding.accentColor,
    website: branding.website,
    support_email: branding.email,
    support_phone: branding.phone,
    email_footer: branding.emailFooter,
  };
  view.configured = custom || view.logo_configured || !!(view.accent_color || view.website || view.support_email || view.support_phone || view.email_footer);
  return view;
}
