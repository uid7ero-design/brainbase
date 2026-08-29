import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicTicketDetail } from '@/lib/events/publicTicket';
import { buildTicketUrl, generateTicketQrSvg } from '@/lib/events/qr';

type Params = { token: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { token } = await params;
  const result = await getPublicTicketDetail(token);
  if (!result.ok) return { title: 'Ticket not found' };
  return { title: `Ticket — ${result.detail.event.name}` };
}

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG = '#07080B';
const BORDER = 'rgba(255,255,255,.08)';
const BORDER_SOFT = 'rgba(255,255,255,.06)';
const VIOLET_SOFT = '#A78BFA';
const TEXT_PRIMARY = '#F5F7FA';
const TEXT_SECONDARY = 'rgba(226,232,240,.66)';
const TEXT_MUTED = 'rgba(226,232,240,.42)';
const GREEN = '#4ADE80';
const RED = '#F87171';

function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso));
}
function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
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
  const result = await getPublicTicketDetail(token);
  if (!result.ok) notFound();
  const { detail } = result;
  const { event } = detail;

  const origin = await getOrigin();
  const ticketUrl = buildTicketUrl(origin, token);
  const qrSvg = await generateTicketQrSvg(ticketUrl);

  const cancelled = detail.status === 'CANCELLED';

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, padding: '32px 16px 56px' }}>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 20, fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: VIOLET_SOFT }}>
          Ticket
        </div>

        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 18, background: 'rgba(255,255,255,.02)', overflow: 'hidden', boxShadow: '0 14px 40px rgba(0,0,0,.35)' }}>
          {event.artwork_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.artwork_url} alt={`${event.name} artwork`} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
          )}

          <div style={{ padding: '22px 22px 6px' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>{event.name}</h1>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.7 }}>
              {formatDate(event.starts_at, event.timezone)}<br />
              {formatTime(event.starts_at, event.timezone)} – {formatTime(event.ends_at, event.timezone)}
              {event.venue && <> · {event.venue}</>}
            </div>
          </div>

          <div style={{ margin: '18px 22px', borderTop: `1px dashed ${BORDER}` }} />

          <div style={{ padding: '0 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TicketField label="Attendee" value={detail.attendee_name} />
            {detail.ticket_type_name && <TicketField label="Ticket" value={detail.ticket_type_name} />}
            {detail.session && (
              <TicketField label="Session" value={`${detail.session.name} · ${formatTime(detail.session.starts_at, event.timezone)}`} />
            )}
          </div>

          <div style={{ padding: 22, display: 'flex', justifyContent: 'center' }}>
            {cancelled ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: RED, fontSize: 13, fontWeight: 600 }}>
                This ticket has been cancelled.
              </div>
            ) : (
              <div
                aria-label="Ticket QR code"
                style={{ background: '#fff', borderRadius: 12, padding: 14, width: 220, height: 220, boxSizing: 'border-box' }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            )}
          </div>

          {!cancelled && (
            <div style={{ padding: '0 22px 22px', textAlign: 'center' }}>
              {detail.checked_in_at ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
                  color: GREEN, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)',
                  borderRadius: 999, padding: '6px 14px',
                }}>
                  Checked in
                </span>
              ) : (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
                  color: TEXT_SECONDARY, background: 'rgba(255,255,255,.04)', border: `1px solid ${BORDER_SOFT}`,
                  borderRadius: 999, padding: '6px 14px',
                }}>
                  Valid — not yet checked in
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: TEXT_MUTED }}>
          Powered by BrainBase
        </div>
      </div>
    </div>
  );
}

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'rgba(226,232,240,.42)' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#F5F7FA', fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
