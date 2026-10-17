import type { Metadata } from 'next';
import { Container } from '@/components/ui/primitives';
import { CheckoutSuccess } from '@/components/buyer/CheckoutSuccess';

export const metadata: Metadata = { title: 'Order confirmation', robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ organisationSlug: string; eventSlug: string }>;
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutSuccessPage({ params, searchParams }: Props) {
  const { organisationSlug, eventSlug } = await params;
  const { session_id } = await searchParams;
  return (
    <Container className="py-12 sm:py-16">
      <CheckoutSuccess organisationSlug={organisationSlug} eventSlug={eventSlug} sessionId={session_id ?? ''} />
    </Container>
  );
}
