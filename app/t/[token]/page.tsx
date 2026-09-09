import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicTicketDetail } from '@/lib/events/publicTicket';
import { buildTicketUrl, generateTicketQrSvg } from '@/lib/events/qr';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { TicketCard, TICKET_BG, TICKET_TEXT_PRIMARY, TICKET_TEXT_MUTED, TICKET_VIOLET_SOFT, TICKET_FONT } from '@/components/events/TicketCard';

type Params = { token: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { token } = await params;
  const result = await getPublicTicketDetail(token);
  if (!result.ok) return { title: 'Ticket not found' };
  return { title: `Ticket — ${result.detail.event.name}` };
}

// Deriving the deployment's own origin from the inbound request's own
// Host header (rather than a dedicated env var this repo does not
// currently define) — a standard, portable App-Router technique that
// works correctly in dev and in any real deployment with no extra
// configuration. Only used to build the value the QR encodes; nothing
// security-relevant depends on getting the protocol exactly right (an
// http vs https mismatch, worst case, produces a QR that opens the
// wrong scheme — never a credential leak, since the token itself, not
// the scheme, is what's authoritative).
async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function TicketPage({ params }: { params: Promise<Params> }) {
  const { token } = await params;

  // Rate limited like every other public Events endpoint — same key
  // scheme/limits as the JSON sibling (app/api/public/tickets/[token]/
  // route.ts), keyed by IP not by token (keying by token would let an
  // attacker learn "this exact token was rate-limited" as a side
  // channel). Previously this page route had no rate limiting at all
  // while its JSON sibling did — closing that gap here, and applying
  // the identical limit to the booking wallet page.
  const h = await headers();
  const ip = getClientIp({ headers: h } as Request);
  if (!checkRateLimit(`public-ticket-lookup:${ip}`, 60, 60 * 60_000)) {
    notFound();
  }

  const result = await getPublicTicketDetail(token);
  if (!result.ok) notFound();
  const { detail } = result;
  const { event } = detail;

  const origin = await getOrigin();
  const ticketUrl = buildTicketUrl(origin, token);
  const qrSvg = await generateTicketQrSvg(ticketUrl);

  return (
    <div style={{ minHeight: '100vh', background: TICKET_BG, color: TICKET_TEXT_PRIMARY, fontFamily: TICKET_FONT, padding: '32px 16px 56px' }}>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 20, fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: TICKET_VIOLET_SOFT }}>
          Ticket
        </div>

        <TicketCard
          eventName={event.name}
          eventVenue={event.venue}
          eventArtworkUrl={event.artwork_url}
          eventStartsAt={event.starts_at}
          eventEndsAt={event.ends_at}
          eventTimezone={event.timezone}
          attendeeName={detail.attendee_name}
          ticketTypeName={detail.ticket_type_name}
          session={detail.session}
          checkedInAt={detail.checked_in_at}
          status={detail.status}
          qrSvg={qrSvg}
          branding={detail.branding}
          organisationName={detail.organisationName}
        />

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: TICKET_TEXT_MUTED }}>
          Powered by BrainBase
        </div>
      </div>
    </div>
  );
}
