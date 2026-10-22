// Kill switch for Eve PAID checkout (ADR 0013). Fails closed.
//
// Eve paid checkout is available only when EVE_PAID_CHECKOUT_ENABLED is
// exactly the string "true": no trimming, no case folding, no "1" / "yes" /
// "TRUE". Missing, empty, "false", "0" and anything else all mean unavailable.
// (Same exact-match convention as EVE_LEGAL_PUBLISHED.)
//
// This is read only by the gated Eve checkout handler. It does not affect
// BrainBase's own public checkout route, Stripe Connect configuration, the
// Stripe webhook, refunds or lifecycle handling, or free Eve registration. It
// is independent of the draft legal-version guard: either one blocks alone.
export function isEvePaidCheckoutEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVE_PAID_CHECKOUT_ENABLED === 'true';
}

// Per-organisation allow-list for Eve paid checkout. Fails closed.
//
// The global flag above opens Eve paid checkout for every organisation at
// once; this narrows it to the organisation slugs listed in
// EVE_PAID_CHECKOUT_ORGS (comma-separated, e.g. "brainbase" or
// "brainbase,other-org"). Each entry must be a lowercase slug — spaces
// around commas are not trimmed. Missing, empty, or any malformed entry
// ("*", "Brainbase", " brainbase", a trailing comma) denies EVERY
// organisation: there is no wildcard and no allow-all fallback. The match
// against the request's organisation slug is exact, and slugs are matched
// exactly by resolvePublicEvent too, so an allowed slug can only ever reach
// that one organisation.
const ORG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function evePaidCheckoutOrgAllowList(env: Record<string, string | undefined> = process.env): readonly string[] {
  const raw = env.EVE_PAID_CHECKOUT_ORGS;
  if (!raw) return [];
  const entries = raw.split(',');
  if (!entries.every(e => ORG_SLUG.test(e))) return [];
  return entries;
}

// Both controls, for one organisation: the global flag must be exactly
// "true" AND the slug must be on the allow-list.
export function isEvePaidCheckoutAllowedForOrg(
  organisationSlug: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isEvePaidCheckoutEnabled(env) && evePaidCheckoutOrgAllowList(env).includes(organisationSlug);
}
