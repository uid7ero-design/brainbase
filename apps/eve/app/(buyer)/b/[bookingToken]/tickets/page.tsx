import type { Metadata } from 'next';
import { Container, PageIntro, Unavailable } from '@/components/ui/primitives';
import { getTicketingGateway } from '@/lib/ticketing/gateway';

export const metadata: Metadata = { title: 'Your tickets', robots: { index: false, follow: false } };

type Props = { params: Promise<{ bookingToken: string }> };

export default async function BookingWalletPage({ params }: Props) {
  const { bookingToken } = await params;
  const result = await getTicketingGateway().getBookingWallet(bookingToken);
  return (
    <Container className="py-12 sm:py-16">
      <PageIntro eyebrow="Booking wallet" title="Your tickets" />
      <div className="mt-8 max-w-xl">
        {result.status === 'ok' ? (
          <p>{result.data.purchaserName}</p>
        ) : (
          <Unavailable
            title="The booking wallet is not connected yet"
            detail="One page with every ticket in a booking. It is not connected in this product yet; no booking is shown."
          />
        )}
      </div>
    </Container>
  );
}
