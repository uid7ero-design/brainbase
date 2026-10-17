import type { PublicTicketStatus } from '@ticketing/core';
import { formatDateTime } from '@/lib/format';

type Props = {
  attendeeName: string;
  eventName: string;
  venue: string | null;
  startsAt: string;
  timezone: string;
  ticketTypeName: string | null;
  session: { name: string; starts_at: string } | null;
  status: PublicTicketStatus;
  checkedInAt: string | null;
  qrSvg?: string | null;
};

const STATUS_COPY: Record<PublicTicketStatus, { label: string; tone: string }> = {
  VALID: { label: 'Valid', tone: 'bg-green-100 text-green-900' },
  CANCELLED: { label: 'Cancelled or refunded — not valid for entry', tone: 'bg-red-100 text-red-900' },
  EVENT_CANCELLED: { label: 'Event cancelled — not valid for entry', tone: 'bg-red-100 text-red-900' },
};

// The one ticket view used by the ticket page and the booking wallet. Shows
// only what the API returned; never an internal id.
export function TicketCard({ attendeeName, eventName, venue, startsAt, timezone, ticketTypeName, session, status, checkedInAt, qrSvg }: Props) {
  const copy = STATUS_COPY[status];
  const checkedIn = status === 'VALID' && checkedInAt;
  return (
    <article className="rounded-[var(--radius-eve)] border border-eve-line bg-eve-surface p-6 shadow-[var(--shadow-eve)]" aria-label={`Ticket for ${attendeeName}`}>
      <p className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${copy.tone}`}>{checkedIn ? 'Checked in' : copy.label}</p>
      <h2 className="mt-3 text-xl font-semibold">{eventName}</h2>
      <dl className="mt-3 grid gap-1 text-sm">
        <div><dt className="inline text-eve-muted">Attendee: </dt><dd className="inline font-medium">{attendeeName}</dd></div>
        {ticketTypeName ? <div><dt className="inline text-eve-muted">Ticket: </dt><dd className="inline">{ticketTypeName}</dd></div> : null}
        {session ? <div><dt className="inline text-eve-muted">Session: </dt><dd className="inline">{session.name} — {formatDateTime(session.starts_at, timezone)}</dd></div> : <div><dt className="inline text-eve-muted">When: </dt><dd className="inline">{formatDateTime(startsAt, timezone)}</dd></div>}
        {venue ? <div><dt className="inline text-eve-muted">Venue: </dt><dd className="inline">{venue}</dd></div> : null}
        {checkedIn ? <div><dt className="inline text-eve-muted">Checked in: </dt><dd className="inline">{formatDateTime(checkedInAt, timezone)}</dd></div> : null}
      </dl>
      {qrSvg && status === 'VALID' ? (
        <div className="mt-5 inline-block rounded-lg bg-white p-3" role="img" aria-label="Ticket QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      ) : null}
    </article>
  );
}
