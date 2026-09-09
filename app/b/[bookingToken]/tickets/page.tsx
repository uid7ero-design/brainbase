import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicBookingDetail } from '@/lib/events/publicBooking';
import { buildTicketUrl, generateTicketQrSvg } from '@/lib/events/qr';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { TicketCard, TICKET_BG, TICKET_TEXT_PRIMARY, TICKET_TEXT_MUTED, TICKET_VIOLET_SOFT, TICKET_FONT } from '@/components/events/TicketCard';
import BookingWalletNav, { type WalletTicket } from './BookingWalletNav';

type Params = { bookingToken: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { bookingToken } = await params;
  const result = await getPublicBookingDetail(bookingToken);
  if (!result.ok) return { title: 'Tickets not found' };
  return { title: `Tickets — ${result.detail.event.name}` };
}

// Same technique as app/t/[token]/page.tsx's own getOrigin() — see that
// file's comment for the full rationale.
async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Public, no-auth, bearer-token page — the booking-wallet counterpart
// to app/t/[token]/page.tsx. Sensitive resolution (which tickets exist,
// their tokens, their validity) happens entirely here, server-side, via
// getPublicBookingDetail(); only the resulting plain data — QR SVGs
// already rendered, ticket URLs already built — is handed to the one
// small client component that owns "which ticket is currently shown"
// (BookingWalletNav). No client-side fetch of any kind.
export default async function BookingWalletPage({ params }: { params: Promise<Params> }) {
  const { bookingToken } = await params;

  // Rate limited the same way as /t/[token] — same key scheme/limits,
  // distinct key prefix. Rapid switching BETWEEN tickets inside one
  // wallet visit never re-hits this limiter at all: the entire ticket
  // set is resolved once, in this one page load, and all subsequent
  // navigation (Previous/Next/chip taps) happens client-side with zero
  // further requests — so a family switching quickly between several
  // tickets at a gate is not at risk of being blocked by this limit.
  const h = await headers();
  const ip = getClientIp({ headers: h } as Request);
  if (!checkRateLimit(`public-booking-lookup:${ip}`, 60, 60 * 60_000)) {
    notFound();
  }

  const result = await getPublicBookingDetail(bookingToken);
  if (!result.ok) notFound();
  const { detail } = result;
  const { event } = detail;

  if (detail.tickets.length === 0) notFound();

  const origin = await getOrigin();

  // QR generation happens once, here, for every ticket in the booking —
  // not per-navigation. Order of tickets is whatever
  // getPublicBookingDetail already returned (event_attendees.created_at
  // — the same natural order the purchaser saw at registration).
  const tickets: WalletTicket[] = await Promise.all(
    detail.tickets.map(async t => {
      const ticketUrl = buildTicketUrl(origin, t.ticket_token);
      const qrSvg = t.status === 'VALID' ? await generateTicketQrSvg(ticketUrl) : '';
      return {
        attendeeName: t.attendee_name,
        ticketTypeName: t.ticket_type_name,
        session: t.session,
        checkedInAt: t.checked_in_at,
        status: t.status,
        qrSvg,
        ticketUrl,
      };
    }),
  );

  const eyebrow = tickets.length === 1 ? 'Ticket' : 'Tickets';

  return (
    <div style={{ minHeight: '100vh', background: TICKET_BG, color: TICKET_TEXT_PRIMARY, fontFamily: TICKET_FONT, padding: '32px 16px 56px' }}>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 20, fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: TICKET_VIOLET_SOFT }}>
          {eyebrow}
        </div>

        {tickets.length === 1 ? (
          // 1 attendee — identical experience to /t/[token], no
          // navigator, no attendee strip, no wallet-specific chrome.
          <>
            <TicketCard
              eventName={event.name}
              eventVenue={event.venue}
              eventArtworkUrl={event.artwork_url}
              eventStartsAt={event.starts_at}
              eventEndsAt={event.ends_at}
              eventTimezone={event.timezone}
              attendeeName={tickets[0].attendeeName}
              ticketTypeName={tickets[0].ticketTypeName}
              session={tickets[0].session}
              checkedInAt={tickets[0].checkedInAt}
              status={tickets[0].status}
              qrSvg={tickets[0].qrSvg}
              branding={detail.branding}
              organisationName={detail.organisationName}
            />
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <a
                href={tickets[0].ticketUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, fontWeight: 700, color: TICKET_VIOLET_SOFT, textDecoration: 'none' }}
              >
                Open individual ticket link →
              </a>
            </div>
          </>
        ) : (
          <BookingWalletNav
            event={{ name: event.name, venue: event.venue, artworkUrl: event.artwork_url, startsAt: event.starts_at, endsAt: event.ends_at, timezone: event.timezone }}
            tickets={tickets}
            branding={detail.branding}
            organisationName={detail.organisationName}
          />
        )}

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: TICKET_TEXT_MUTED }}>
          Powered by BrainBase
        </div>
      </div>
    </div>
  );
}
