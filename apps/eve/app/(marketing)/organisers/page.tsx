import type { Metadata } from 'next';
import { ButtonLink, Card, Container, PageIntro } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'For organisers' };

const STEPS = [
  { n: '1', title: 'Set up', body: 'Name the event, add sessions and ticket types, set capacity and sale windows.' },
  { n: '2', title: 'Connect payments', body: 'Link your Stripe account so ticket revenue is paid to you directly.' },
  { n: '3', title: 'Publish', body: 'Share one public event page. Buyers see live availability per session.' },
  { n: '4', title: 'Run the door', body: 'Scan QR tickets or search by name. Refund or cancel from the same console.' },
] as const;

export default function OrganisersPage() {
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="For organisers" title="From first draft to final scan." lede="One console for the whole run of an event: events, orders, attendees, check-in, payments and settings." />
      <ol className="mt-12 grid gap-4 sm:grid-cols-2">
        {STEPS.map(s => (
          <li key={s.n}>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-accent">Step {s.n}</p>
              <h2 className="mt-2 text-base font-semibold">{s.title}</h2>
              <p className="mt-2 text-sm text-eve-muted">{s.body}</p>
            </Card>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/get-started">Create an event</ButtonLink>
        <ButtonLink href="/organiser" variant="ghost">Preview the organiser console</ButtonLink>
      </div>
    </Container>
  );
}
