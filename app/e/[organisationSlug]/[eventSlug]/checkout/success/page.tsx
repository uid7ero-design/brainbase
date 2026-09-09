import { resolvePublicEvent } from '@/lib/events/publicResolve';
import CheckoutSuccessClient from './CheckoutSuccessClient';

type Params = { organisationSlug: string; eventSlug: string };

// Thin server wrapper only. Reuses resolvePublicEvent — the exact same
// choke point every other public Events surface (the hub, the event
// detail page, getPublicEventDetail) already resolves organisation
// identity through — rather than adding a second, bespoke checkout-only
// branding lookup. This is deliberately NOT the heavier
// getPublicEventDetail (which also loads sessions/ticket types/
// questions this page never needs); resolvePublicEvent alone already
// returns organisationName + PublicOrganisationBranding.
//
// No notFound() on a failed resolution: this is a payment-confirmation
// surface reached via a Stripe redirect after a real purchase, not a
// browsing surface, and must keep rendering the payment-status poll
// regardless (e.g. even if the event was unpublished in the moments
// between checkout and this redirect). A failed resolution here just
// means CheckoutSuccessClient falls back to unbranded chrome — it never
// falls back to a slug-derived organisation name.
export default async function CheckoutSuccessPage({ params }: { params: Promise<Params> }) {
  const { organisationSlug, eventSlug } = await params;
  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);

  return (
    <CheckoutSuccessClient
      organisationSlug={organisationSlug}
      eventSlug={eventSlug}
      organisationName={resolved.ok ? resolved.organisationName : null}
      branding={resolved.ok ? resolved.branding : null}
    />
  );
}
