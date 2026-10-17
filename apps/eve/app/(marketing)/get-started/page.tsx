import type { Metadata } from 'next';
import { ButtonLink, Container, PageIntro, Unavailable } from '@/components/ui/primitives';
import { product } from '@/config/product';

export const metadata: Metadata = { title: 'Create an event' };

export default function GetStartedPage() {
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Get started" title="Create your first event." lede="Event creation needs an organiser account, which opens with sign-in." />
      <div className="mt-10 max-w-xl">
        <Unavailable
          title="Self-service event creation is not open yet"
          detail={`You can read what is included and preview the organiser console now. To be told when accounts open, email ${product.supportEmail}.`}
        >
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/features" variant="ghost">What&apos;s included</ButtonLink>
            <ButtonLink href="/organiser" variant="ghost">Preview the console</ButtonLink>
          </div>
        </Unavailable>
      </div>
    </Container>
  );
}
