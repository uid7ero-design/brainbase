// Product identity seam. The shared core never knows which product it is
// running inside; each application declares its own identity once and
// passes it (or the values it needs) into whatever it renders or sends.
// Nothing in this package reads process.env — the application resolves its
// environment and hands the result here, so there is exactly one place per
// product where identity lives and no default can leak across products.

export type ProductFeatureFlags = Readonly<Record<string, boolean>>;

export type ProductConfig = Readonly<{
  // Short product name used in titles and email subjects.
  name: string;
  // One-line positioning used next to the name; may be empty.
  tagline: string;
  // Absolute origin, no trailing slash, used to build public links
  // (event pages, tickets, wallets).
  publicBaseUrl: string;
  // Address shown to buyers and organisers for help.
  supportEmail: string;
  // RFC 5322 sender identity for transactional email.
  emailFrom: string;
  // Default colour scheme the product shell renders before any preference.
  defaultTheme: 'light' | 'dark';
  // Capability switches the shell may read. Absent = off.
  features: ProductFeatureFlags;
}>;

export type ProductConfigInput = {
  name: string;
  tagline?: string;
  publicBaseUrl: string;
  supportEmail: string;
  emailFrom: string;
  defaultTheme?: 'light' | 'dark';
  features?: Record<string, boolean>;
};

export class ProductConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductConfigError';
  }
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProductConfigError(`${field} is required.`);
  return value.trim();
}

// Validates and freezes a product identity. Throws ProductConfigError on a
// missing or malformed value so a misconfigured deployment fails at boot,
// not when the first email goes out with an empty sender.
export function defineProductConfig(input: ProductConfigInput): ProductConfig {
  const name = requireNonEmpty(input.name, 'name');
  const supportEmail = requireNonEmpty(input.supportEmail, 'supportEmail');
  const emailFrom = requireNonEmpty(input.emailFrom, 'emailFrom');
  const rawBase = requireNonEmpty(input.publicBaseUrl, 'publicBaseUrl');
  let publicBaseUrl: string;
  try {
    const url = new URL(rawBase);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    publicBaseUrl = url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    throw new ProductConfigError('publicBaseUrl must be an absolute http(s) URL.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) throw new ProductConfigError('supportEmail must be an email address.');
  const defaultTheme = input.defaultTheme ?? 'light';
  if (defaultTheme !== 'light' && defaultTheme !== 'dark') throw new ProductConfigError('defaultTheme must be light or dark.');
  return Object.freeze({
    name,
    tagline: (input.tagline ?? '').trim(),
    publicBaseUrl,
    supportEmail,
    emailFrom,
    defaultTheme,
    features: Object.freeze({ ...(input.features ?? {}) }),
  });
}

export function productFeatureEnabled(config: ProductConfig, feature: string): boolean {
  return config.features[feature] === true;
}

// Public link builders. The path shapes (/e, /t, /b) are the shared
// ticketing core's public namespaces; every product serves them under its
// own base URL. They need only the base URL, so a server that mints links
// on a product's behalf (e.g. hosted-checkout return URLs) can pass just
// that, validated with productLinkBase(), without the full identity.
export type ProductLinkBase = Pick<ProductConfig, 'publicBaseUrl'>;

// Validates an absolute http(s) origin (optionally with a path) and
// returns it normalised with no trailing slash, or null. `requireHttps`
// refuses plain http for deployed environments.
export function productLinkBase(raw: string | null | undefined, requireHttps: boolean): ProductLinkBase | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && (requireHttps || url.protocol !== 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return { publicBaseUrl: url.origin + url.pathname.replace(/\/+$/, '') };
  } catch {
    return null;
  }
}

// Extracts the opaque ticket token from either a bare token or a ticket
// link of the form <anything>/t/<token>. Used by check-in input, which
// accepts what a scanner or a pasted link yields. Returns null when no
// plausible token is present.
export function extractTicketToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const match = /\/t\/([^/?#\s]+)/.exec(value);
  let candidate = value;
  if (match) {
    try {
      candidate = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9_-]{16,128}$/.test(candidate) ? candidate : null;
}
export function publicEventUrl(config: ProductLinkBase, organisationSlug: string, eventSlug: string): string {
  return `${config.publicBaseUrl}/e/${encodeURIComponent(organisationSlug)}/${encodeURIComponent(eventSlug)}`;
}

export function publicTicketUrl(config: ProductLinkBase, ticketToken: string): string {
  return `${config.publicBaseUrl}/t/${encodeURIComponent(ticketToken)}`;
}

export function publicBookingWalletUrl(config: ProductLinkBase, bookingToken: string): string {
  return `${config.publicBaseUrl}/b/${encodeURIComponent(bookingToken)}/tickets`;
}

// Hosted-checkout return URLs. The `{CHECKOUT_SESSION_ID}` placeholder is
// the payment provider's own template token and must be passed through
// verbatim (never URL-encoded), so it is appended outside encodeURIComponent.
export function checkoutSuccessUrl(config: ProductLinkBase, organisationSlug: string, eventSlug: string): string {
  return `${publicEventUrl(config, organisationSlug, eventSlug)}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
}

export function checkoutCancelUrl(config: ProductLinkBase, organisationSlug: string, eventSlug: string): string {
  return `${publicEventUrl(config, organisationSlug, eventSlug)}?checkout=cancelled`;
}
