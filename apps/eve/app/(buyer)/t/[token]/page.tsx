import type { Metadata } from 'next';
import { Container, PageIntro, Unavailable } from '@/components/ui/primitives';
import { getTicketingGateway } from '@/lib/ticketing/gateway';

export const metadata: Metadata = { title: 'Ticket', robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

export default async function TicketPage({ params }: Props) {
  const { token } = await params;
  const result = await getTicketingGateway().getTicket(token);
  return (
    <Container className="py-12 sm:py-16">
      <PageIntro eyebrow="Your ticket" title="Ticket" />
      <div className="mt-8 max-w-xl">
        {result.status === 'ok' ? (
          <p>{result.data.attendeeName}</p>
        ) : (
          <Unavailable
            title="Tickets cannot be displayed yet"
            detail="A ticket page shows the attendee, event, session and a QR code, and reflects cancellations and refunds. It is not connected in this product yet; no ticket is shown."
          />
        )}
      </div>
    </Container>
  );
}
