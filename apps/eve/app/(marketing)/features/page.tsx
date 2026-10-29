import type { Metadata } from 'next';
import { Card, Container, PageIntro } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Features' };

// Only capabilities that exist in the shared ticketing core today are
// listed. Anything not yet true for this product is left out, not
// promised.
const FEATURES = [
  { title: 'Sessions and performances', body: 'One event, many dates or times, each with its own capacity.' },
  { title: 'Ticket types with inventory', body: 'General admission tiers with event-wide or per-session allocation and all-or-nothing carts.' },
  { title: 'Card payments', body: 'Stripe Checkout in your own Stripe account, with payment retry and duplicate-charge protection.' },
  { title: 'Promotions and access codes', body: 'Discount codes, presale access codes and sale windows per ticket type.' },
  { title: 'QR tickets and booking wallet', body: 'Each attendee gets a scannable ticket; the buyer gets one page with all of them.' },
  { title: 'Check-in', body: 'Scan or search on the door; every ticket is admitted exactly once.' },
  { title: 'Refunds and cancellations', body: 'Refund an order or cancel an event, and attendees are told automatically.' },
  { title: 'Reminders and delivery tracking', body: 'Event reminders, confirmation emails and bounce tracking out of the box.' },
] as const;

export default function FeaturesPage() {
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Features" title="Everything a general-admission event needs." lede="Nothing here is a roadmap item. Each capability is live in the shared ticketing core this product is built on." />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map(f => (
          <Card key={f.title}>
            <h2 className="text-base font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-eve-muted">{f.body}</p>
          </Card>
        ))}
      </div>
    </Container>
  );
}
