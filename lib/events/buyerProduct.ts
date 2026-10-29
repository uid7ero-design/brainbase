import 'server-only';
import { BASE_URL, type EmailProductPresentation } from '@/lib/email';
import { eveLinkBase, productSurfaceFromRow, type ProductSurface } from '@/lib/events/productSurface';

// Buyer-facing product identity for a COMMITTED order.
//
// The only input is event_orders.product_surface, read from the order row the
// caller is already holding (productSurfaceFromRow: anything unrecognised is a
// historical BRAINBASE order). It is never a request field, header, Origin or
// Stripe metadata value, so a retry, a recovery sweep or a webhook replay
// always resolves the identity the order was created with.
//
// BrainBase remains the one delivery layer (one Resend account, one send
// path). This module only decides, per product:
//   - the link base buyer links are built on (ticket, booking wallet);
//   - the shell presentation (wordmark / copyright line);
//   - the sender (From) and, for Eve only, the Reply-To (the validated
//     EVE_SUPPORT_EMAIL); BrainBase orders never carry a Reply-To.
//
// Links/branding and sender enablement are separate failure domains, so an
// operator can have one without the other:
//   EVE_LINK_BASE_UNAVAILABLE   EVE_PUBLIC_BASE_URL missing/invalid
//   EVE_SENDER_UNCONFIGURED     EVE_EMAIL_FROM missing/invalid/placeholder
// Either way NOTHING is sent for an Eve order — an Eve order is never emailed
// with BrainBase links, the BrainBase wordmark or the BrainBase sender.

// Legal + support links shown in the footer of every Eve email. Support is
// included only when a real address is configured on this deployment.
export function eveFooterLinks(linkBase: string, supportEmail: string | undefined): { label: string; url: string }[] {
  const links = [
    { label: 'Terms', url: `${linkBase}/terms` },
    { label: 'Privacy', url: `${linkBase}/privacy` },
    { label: 'Refunds & cancellations', url: `${linkBase}/refunds` },
  ];
  const s = validEveSupportEmail(supportEmail);
  if (s) links.push({ label: 'Support', url: `mailto:${s}` });
  return links;
}

// The configured Eve support address, or null when missing, malformed or on a
// placeholder domain. One rule for the footer Support link and the Reply-To, so
// both appear together or not at all.
export function validEveSupportEmail(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s) && !PLACEHOLDER_DOMAIN.test(s.split('@')[1])) return s;
  return null;
}

export type BuyerProductFailureCode = 'EVE_LINK_BASE_UNAVAILABLE' | 'EVE_SENDER_UNCONFIGURED';

export type BuyerProductContext = {
  surface: ProductSurface;
  // Origin (optionally with a path prefix), no trailing slash.
  linkBase: string;
  // null => the shell's default (BrainBase) presentation, byte-identical to
  // what it always rendered.
  presentation: EmailProductPresentation | null;
  // null => sendEmail()'s default sender (BrainBase).
  from: string | null;
  // Reply-To for the product's buyer emails. null => none is sent (BrainBase
  // default, or an Eve deployment with no valid EVE_SUPPORT_EMAIL — never a
  // BrainBase address).
  replyTo: string | null;
};

export type BuyerProductResult =
  | { ok: true; context: BuyerProductContext }
  | { ok: false; code: BuyerProductFailureCode; message: string };

// The BrainBase context — exactly what every buyer email used before this
// phase: BASE_URL links, default shell, default sender.
export function brainbaseBuyerContext(): BuyerProductContext {
  return { surface: 'BRAINBASE', linkBase: BASE_URL, presentation: null, from: null, replyTo: null };
}

const PLACEHOLDER_DOMAIN = /(^|\.)(invalid|test|example|localhost|local)$/i;
const ADDRESS = /^[^\s@<>"]+@([^\s@<>"]+\.[^\s@<>"]+)$/;

// Accepts `addr@domain` or `Display Name <addr@domain>`. Refuses placeholder
// domains (the Eve app's own dev defaults are *.invalid) and any display name
// that claims to be BrainBase — an Eve email must never be sent as BrainBase.
export function parseEveSender(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value || /[\r\n]/.test(value)) return null;
  let display = '';
  let address = value;
  const angle = /^(.*)<([^<>]+)>$/.exec(value);
  if (angle) {
    display = angle[1].trim().replace(/^"|"$/g, '').trim();
    address = angle[2].trim();
  }
  const m = ADDRESS.exec(address);
  if (!m) return null;
  if (PLACEHOLDER_DOMAIN.test(m[1])) return null;
  if (/brainbase/i.test(display)) return null;
  return value;
}

// Links + presentation only (no sender requirement). Used by anything that
// builds buyer links without sending.
export function resolveBuyerLinkBase(surface: ProductSurface): string | null {
  if (surface === 'EVE') return eveLinkBase()?.publicBaseUrl ?? null;
  return BASE_URL;
}

// `rowSurface` is event_orders.product_surface as read from the database.
export function resolveBuyerProduct(rowSurface: unknown): BuyerProductResult {
  const surface = productSurfaceFromRow(rowSurface);
  if (surface !== 'EVE') return { ok: true, context: brainbaseBuyerContext() };

  const links = eveLinkBase();
  if (!links) {
    return { ok: false, code: 'EVE_LINK_BASE_UNAVAILABLE', message: 'Eve buyer links are not configured for this environment.' };
  }
  const from = parseEveSender(process.env.EVE_EMAIL_FROM);
  if (!from) {
    return { ok: false, code: 'EVE_SENDER_UNCONFIGURED', message: 'Eve email sending is not configured for this environment.' };
  }
  return {
    ok: true,
    context: {
      surface: 'EVE',
      linkBase: links.publicBaseUrl,
      presentation: { wordmark: 'EVE', footerName: 'Eve', footerLinks: eveFooterLinks(links.publicBaseUrl, process.env.EVE_SUPPORT_EMAIL) },
      from,
      replyTo: validEveSupportEmail(process.env.EVE_SUPPORT_EMAIL),
    },
  };
}
