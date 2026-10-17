import { productLinkBase, checkoutSuccessUrl, checkoutCancelUrl, type ProductLinkBase } from '@ticketing/core';

// Product identity of an event order: which product surface the buyer used
// to create it. Stamped once, atomically with the order INSERT, from the
// trusted server-side entry point that created it:
//
//   BRAINBASE  BrainBase's own public routes (/api/public/events/*)
//   EVE        the Eve server-to-server API (/api/ticketing/public/*), after
//              it has passed the TICKETING_API_SECRET gate
//
// It is never read from a request body, query string or header, and the
// Stripe webhook never writes it. event_orders.product_surface is the only
// authority; the value in Stripe metadata is informational.

export const PRODUCT_SURFACES = ['BRAINBASE', 'EVE'] as const;
export type ProductSurface = (typeof PRODUCT_SURFACES)[number];
export const DEFAULT_PRODUCT_SURFACE: ProductSurface = 'BRAINBASE';

export function isProductSurface(value: unknown): value is ProductSurface {
  return typeof value === 'string' && (PRODUCT_SURFACES as readonly string[]).includes(value);
}

// For values read back from the database. The column is NOT NULL with a
// CHECK, so anything else (an absent column on a not-yet-migrated fixture,
// for instance) is a historical BrainBase order.
export function productSurfaceFromRow(value: unknown): ProductSurface {
  return isProductSurface(value) ? value : DEFAULT_PRODUCT_SURFACE;
}

// The hosted-checkout return URLs for an order of the given product.
// EVE orders always return to the Eve origin (EVE_PUBLIC_BASE_URL, https
// required in production); BRAINBASE orders return to the origin supplied by
// the caller (BrainBase's own request origin). Null when the product's origin
// is not available, so the caller can refuse before anything is mutated.
export function eveLinkBase(): ProductLinkBase | null {
  return productLinkBase(process.env.EVE_PUBLIC_BASE_URL, process.env.NODE_ENV === 'production');
}

export function checkoutReturnUrlsFor(
  surface: ProductSurface,
  orgSlug: string,
  eventSlug: string,
  brainbaseOrigin: string | null,
): { successUrl: string; cancelUrl: string } | null {
  if (surface === 'EVE') {
    const links = eveLinkBase();
    if (!links) return null;
    return { successUrl: checkoutSuccessUrl(links, orgSlug, eventSlug), cancelUrl: checkoutCancelUrl(links, orgSlug, eventSlug) };
  }
  if (!brainbaseOrigin) return null;
  return {
    successUrl: `${brainbaseOrigin}/e/${orgSlug}/${eventSlug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${brainbaseOrigin}/e/${orgSlug}/${eventSlug}?checkout=cancelled`,
  };
}
