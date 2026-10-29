import type { Metadata } from 'next';
import { Container, Unavailable } from '@/components/ui/primitives';
import { BuyerBooking } from '@/components/buyer/BuyerBooking';
import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { formatDateTime, formatDateTimeRange } from '@/lib/format';
import { publicOrganiserName } from '@ticketing/core/publicOrganiser';

export const metadata: Metadata = { title: 'Event' };
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ organisationSlug: string; eventSlug: string }>;
  searchParams: Promise<{ checkout?: string }>;
};

// Public event page, rendered from the live ticketing API. Every figure
// shown here (sessions, types, prices, availability, sale state) is what
// the API returned; when it cannot be reached the page says so.
export default async function PublicEventPage({ params, searchParams }: Props) {
  const { organisationSlug, eventSlug } = await params;
  const { checkout } = await searchParams;
  const result = await getTicketingGateway().getPublicEvent(organisationSlug, eventSlug);

  if (result.status === 'not_found') {
    return (
      <Container className="py-16">
        <Unavailable title="This event isn't available" detail="The link may be wrong, or the event is no longer on sale." />
      </Container>
    );
  }
  if (result.status !== 'ok') {
    return (
      <Container className="py-16">
        <Unavailable title="We can't load this event right now" detail="Please try again in a moment." />
      </Container>
    );
  }

  const detail = result.data;
  const { event } = detail;
  const organiserName = publicOrganiserName(detail.organiser_name);
  return (
    <Container className="py-10 sm:py-14">
      <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,28rem)]">
        <div>
          {event.artwork_url ? (
            // Contained, never cropped: the organiser's artwork keeps its own
            // aspect ratio (poster text and logos stay whole) and is
            // letterboxed on the surface colour inside a bounded frame.
            <div data-testid="event-artwork" className="mb-6 flex justify-center overflow-hidden rounded-[var(--radius-eve)] bg-eve-surface-alt">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={event.artwork_url} alt="" className="block h-auto max-h-[36rem] w-auto max-w-full object-contain" />
            </div>
          ) : null}
          {/* The organiser's public display name only; omitted when none is configured. */}
          {organiserName ? <p data-testid="event-organiser" className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-accent">{organiserName}</p> : null}
          <h1 className={`eve-display ${organiserName ? 'mt-2 ' : ''}text-4xl sm:text-5xl`}>{event.name}</h1>
          <p className="mt-3 text-eve-muted">{formatDateTimeRange(event.starts_at, event.ends_at, event.timezone)}{event.venue ? ` · ${event.venue}` : ''}</p>
          {event.description ? <p className="mt-6 max-w-prose whitespace-pre-line">{event.description}</p> : null}
          {detail.sessions.length > 0 ? (
            <section className="mt-8" aria-labelledby="sessions-h">
              <h2 id="sessions-h" className="text-lg font-semibold">Sessions</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {detail.sessions.map(s => (
                  <li key={s.id}>{s.name} — {formatDateTime(s.starts_at, event.timezone)} {s.remaining <= 0 ? '(sold out)' : `(${s.remaining} places left)`}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div>
          {event.has_ended === true ? (
            // An ended event offers no booking or payment controls at all.
            <section data-testid="event-ended" className="rounded-[var(--radius-eve)] border border-eve-line bg-eve-surface p-6">
              <h2 className="text-xl font-semibold">This event has ended.</h2>
              <p className="mt-2 text-sm text-eve-muted">Bookings are no longer available.</p>
            </section>
          ) : (
            <BuyerBooking organisationSlug={organisationSlug} eventSlug={eventSlug} detail={detail} cancelled={checkout === 'cancelled'} />
          )}
        </div>
      </div>
    </Container>
  );
}
