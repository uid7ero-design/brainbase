import type { Metadata } from 'next';
import { Container, PageIntro, Unavailable } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Pricing' };

export default function PricingPage() {
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Pricing" title="Pricing is being finalised." lede="Fees will be published here before the product is open for sign-up. Until then, no fee figures are shown." />
      <div className="mt-12 max-w-2xl">
        <Unavailable
          title="No published pricing yet"
          detail="The fee model exists in the ticketing core (per-order, per-ticket and percentage components, passed through or absorbed), but no rate has been set for this product. This page will show the real rates once they are decided."
        />
      </div>
    </Container>
  );
}
