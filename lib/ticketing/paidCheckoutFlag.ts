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
