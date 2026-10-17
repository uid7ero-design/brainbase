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
// own base URL.
export function publicEventUrl(config: ProductConfig, organisationSlug: string, eventSlug: string): string {
  return `${config.publicBaseUrl}/e/${encodeURIComponent(organisationSlug)}/${encodeURIComponent(eventSlug)}`;
}

export function publicTicketUrl(config: ProductConfig, ticketToken: string): string {
  return `${config.publicBaseUrl}/t/${encodeURIComponent(ticketToken)}`;
}

export function publicBookingWalletUrl(config: ProductConfig, bookingToken: string): string {
  return `${config.publicBaseUrl}/b/${encodeURIComponent(bookingToken)}/tickets`;
}
