import type { Metadata } from 'next';
import { Card, Container, PageIntro } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Venues & events' };

const KINDS = [
  { title: 'Concerts and gigs', body: 'Single or multi-night runs, tiered general admission, presales by code.' },
  { title: 'Festivals', body: 'Day-specific allocations per ticket type, with a shared cap per day.' },
  { title: 'Theatre', body: 'Performances as sessions, each with its own capacity and sale window.' },
  { title: 'Sport', body: 'Fixtures and rounds, members-only presales, capped general admission.' },
  { title: 'Conferences', body: 'Multi-day passes and single-day tickets, with attendee details per ticket.' },
  { title: 'Community events', body: 'Free registrations with the same tickets, wallet and check-in as paid events.' },
] as const;

export default function VenuesPage() {
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Venues & events" title="General admission, for any room or field." lede="The core models organisers, venues, events, sessions, ticket types, inventory, orders, attendees, tickets and payments." />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KINDS.map(k => (
          <Card key={k.title}>
            <h2 className="text-base font-semibold">{k.title}</h2>
            <p className="mt-2 text-sm text-eve-muted">{k.body}</p>
          </Card>
        ))}
      </div>
    </Container>
  );
}
