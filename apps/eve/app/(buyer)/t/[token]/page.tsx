import type { Metadata } from 'next';
import { Container, Unavailable } from '@/components/ui/primitives';
import { TicketCard } from '@/components/buyer/TicketCard';
import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { BearerLinkNotice } from '@/components/buyer/BearerLinkNotice';

export const metadata: Metadata = { title: 'Ticket', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

export default async function TicketPage({ params }: Props) {
  const { token } = await params;
  const result = await getTicketingGateway().getTicket(token);
  return (
    <Container className="py-10 sm:py-14">
      <div className="max-w-xl">
        {result.status === 'ok' ? (
          <TicketCard
            attendeeName={result.data.attendee_name}
            eventName={result.data.event.name}
            venue={result.data.event.venue}
            startsAt={result.data.event.starts_at}
            timezone={result.data.event.timezone}
            ticketTypeName={result.data.ticket_type_name}
            session={result.data.session}
            status={result.data.status}
            checkedInAt={result.data.checked_in_at}
            qrSvg={result.data.qr_svg}
          />
        ) : result.status === 'not_found' ? (
          <Unavailable title="Ticket not found" detail="Check the link in your confirmation message." />
        ) : (
          <Unavailable title="We can't load this ticket right now" detail="Please try again in a moment." />
        )}
        {result.status === 'ok' ? <BearerLinkNotice what="ticket" /> : null}
      </div>
    </Container>
  );
}
