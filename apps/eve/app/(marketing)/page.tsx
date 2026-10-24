import { Tagline } from '@/components/brand/Tagline';
import { ButtonLink, Card, Container, Eyebrow } from '@/components/ui/primitives';

const PILLARS = [
  { title: 'Create', body: 'Set up an event with sessions, ticket types and capacity in minutes.' },
  { title: 'Sell', body: 'A clean public event page with clear availability and simple checkout.' },
  { title: 'Scan', body: 'QR tickets and check-in that works on the door, with every scan recorded once.' },
  { title: 'Manage', body: 'Orders, attendees, refunds and payouts in one organiser console.' },
] as const;

const EVENT_KINDS = ['Concerts', 'Festivals', 'Theatre', 'Sport', 'Conferences', 'Community events'] as const;

export default function HomePage() {
  return (
    <>
      <section className="border-b border-eve-line">
        <Container className="py-20 sm:py-28">
          <Eyebrow>Early access</Eyebrow>
          <Tagline as="h1" className="eve-display mt-4 max-w-4xl text-5xl sm:text-7xl" />
          <p className="mt-6 max-w-2xl text-xl text-eve-ink-soft">Ticketing built for every kind of event.</p>
          <p className="mt-2 max-w-2xl text-lg text-eve-muted">Create, sell, scan and manage — without the complexity.</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink href="/get-started">Create an event</ButtonLink>
            <ButtonLink href="/features" variant="ghost">See what&apos;s included</ButtonLink>
          </div>
          <ul className="mt-14 flex flex-wrap gap-x-6 gap-y-2 text-sm text-eve-muted" aria-label="Event types">
            {EVENT_KINDS.map(k => (
              <li key={k} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-eve-accent" />
                {k}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="pillars">
        <Container className="py-16 sm:py-20">
          <h2 id="pillars" className="eve-display text-3xl sm:text-4xl">Four things, done properly.</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map(p => (
              <Card key={p.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-accent">{p.title}</p>
                <p className="mt-3 text-sm text-eve-ink-soft">{p.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-eve-ink text-white">
        <Container className="py-16 sm:py-20">
          <h2 className="eve-display max-w-3xl text-3xl sm:text-4xl">Built on a ticketing core that is already selling tickets.</h2>
          <p className="mt-4 max-w-2xl text-base text-white/75">
            Sessions and ticket types with real inventory, card payments through Stripe, QR tickets, a booking wallet, check-in and refunds. The product shell is new; the engine underneath is not.
          </p>
          <div className="mt-8">
            <ButtonLink href="/organisers" variant="secondary">For organisers</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
