import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, Unavailable } from '@/components/ui/primitives';
import { TicketCard } from '@/components/buyer/TicketCard';
import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { formatDateTime } from '@/lib/format';
import { BearerLinkNotice } from '@/components/buyer/BearerLinkNotice';

export const metadata: Metadata = { title: 'Your tickets', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ bookingToken: string }> };

export default async function BookingWalletPage({ params }: Props) {
  const { bookingToken } = await params;
  const result = await getTicketingGateway().getBookingWallet(bookingToken);
  if (result.status !== 'ok') {
    return (
      <Container className="py-10 sm:py-14">
        <div className="max-w-xl">
          {result.status === 'not_found'
            ? <Unavailable title="Booking not found" detail="Check the link in your confirmation message." />
            : <Unavailable title="We can't load this booking right now" detail="Please try again in a moment." />}
        </div>
      </Container>
    );
  }
  const { event, tickets, purchaser_name } = result.data;
  return (
    <Container className="py-10 sm:py-14">
      <h1 className="eve-display text-3xl">{event.name}</h1>
      <p className="mt-2 text-eve-muted">{formatDateTime(event.starts_at, event.timezone)}{event.venue ? ` · ${event.venue}` : ''}</p>
      <p className="mt-1 text-sm text-eve-muted">Booked by {purchaser_name} · {tickets.length} ticket{tickets.length === 1 ? '' : 's'}</p>
      <BearerLinkNotice what="booking" />
      <ul className="mt-8 grid gap-6 md:grid-cols-2">
        {tickets.map(t => (
          <li key={t.ticket_token}>
            <TicketCard
              attendeeName={t.attendee_name} eventName={event.name} venue={event.venue} startsAt={event.starts_at} timezone={event.timezone}
              ticketTypeName={t.ticket_type_name} session={t.session} status={t.status} checkedInAt={t.checked_in_at}
            />
            <Link className="mt-2 inline-block text-sm font-medium text-eve-accent underline" href={`/t/${t.ticket_token}`}>Open ticket with QR code</Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
