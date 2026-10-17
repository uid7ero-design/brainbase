import type { Metadata } from 'next';
import { Container, PageIntro, Unavailable } from '@/components/ui/primitives';
import { getTicketingGateway } from '@/lib/ticketing/gateway';

export const metadata: Metadata = { title: 'Event' };

type Props = { params: Promise<{ eventSlug: string }> };

// Public event page. The route shape and the gateway call are real; the
// gateway is not connected in Phase 1, so the page renders the explicit
// unavailable state rather than a sample event.
export default async function PublicEventPage({ params }: Props) {
  const { eventSlug } = await params;
  const result = await getTicketingGateway().getPublicEvent(eventSlug);
  return (
    <Container className="py-12 sm:py-16">
      <PageIntro eyebrow="Event" title="Event page" />
      <div className="mt-8 max-w-2xl">
        {result.status === 'ok' ? (
          <p>{result.data.name}</p>
        ) : (
          <Unavailable
            title="This event page is not connected yet"
            detail="Public event pages will show sessions, ticket types and live availability from the shared ticketing core once this product is connected to it. No event data is shown until then."
          />
        )}
      </div>
    </Container>
  );
}
