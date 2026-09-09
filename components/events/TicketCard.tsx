// Shared presentational ticket card — the exact visual language
// app/t/[token]/page.tsx already established, extracted so the booking
// wallet (app/b/[bookingToken]/tickets/page.tsx) renders each attendee's
// ticket identically rather than duplicating ~80 lines of markup/style
// that could silently drift between the two surfaces. Pure/stateless —
// safe to render from a Server Component (as /t/[token] does today) or
// from inside the wallet's client-side navigator (BookingWalletNav).
// No data fetching, no 'use client' — just markup and inline styles.
//
// Phase 3C — organisation branding (name/logo/accent/website) is the
// ONLY new concern this file takes on, and only as presentation: this
// remains the single shared boundary for both /t and /b, so neither
// route re-derives its own fallback rules. `branding`/`organisationName`
// are optional so this stays a strict superset of the pre-3C contract.
// accentColor is used for exactly two, deliberately narrow decorative
// spots (the identity-region divider and the optional website link) —
// see the render body below. It is NEVER read anywhere near the QR
// block or the status badges: those stay on the fixed structural
// palette this file already defined, untouched by this pass.

import { OrganisationLogo } from '@/components/organisations/OrganisationLogo';
import type { PublicOrganisationBranding } from '@/lib/organisations/branding';

export const TICKET_BG = '#07080B';
export const TICKET_BORDER = 'rgba(255,255,255,.08)';
export const TICKET_BORDER_SOFT = 'rgba(255,255,255,.06)';
export const TICKET_VIOLET_SOFT = '#A78BFA';
export const TICKET_TEXT_PRIMARY = '#F5F7FA';
export const TICKET_TEXT_SECONDARY = 'rgba(226,232,240,.66)';
export const TICKET_TEXT_MUTED = 'rgba(226,232,240,.42)';
export const TICKET_GREEN = '#4ADE80';
export const TICKET_RED = '#F87171';
export const TICKET_FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

export function formatTicketDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso));
}
export function formatTicketTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}

export type TicketCardStatus = 'VALID' | 'CANCELLED' | 'EVENT_CANCELLED';

export type TicketCardProps = {
  eventName: string;
  eventVenue: string | null;
  eventArtworkUrl: string | null;
  eventStartsAt: string;
  eventEndsAt: string;
  eventTimezone: string;
  attendeeName: string;
  ticketTypeName: string | null;
  session: { name: string; starts_at: string; ends_at: string } | null;
  checkedInAt: string | null;
  status: TicketCardStatus;
  qrSvg: string;
  // Both optional and independent: branding may be null/absent (renders
  // exactly as before this pass, modulo the identity region below) while
  // organisationName is the render-layer fallback for branding.name —
  // same split lib/organisations/branding.ts's own normalisePublicOrganisationBranding
  // comment documents (branding.name is never itself substituted).
  branding?: PublicOrganisationBranding | null;
  organisationName?: string;
};

export function TicketCard(props: TicketCardProps) {
  const cancelled = props.status !== 'VALID';
  const eventCancelled = props.status === 'EVENT_CANCELLED';
  const branding = props.branding ?? null;
  const organisationName = props.organisationName ?? '';
  // Unconfigured (accentColor null) intentionally falls back to the
  // existing card border colour, not a decorative violet — so the one
  // accented element below (the divider) is pixel-identical to today's
  // plain rgba border when no organisation has configured an accent.
  // The website link is the only place TICKET_VIOLET_SOFT is used as a
  // fallback, and only reachable when branding.website is itself
  // already configured (see the identity region below).
  const dividerColor = branding?.accentColor ?? TICKET_BORDER;
  const linkColor = branding?.accentColor ?? TICKET_VIOLET_SOFT;

  return (
    <div style={{ border: `1px solid ${TICKET_BORDER}`, borderRadius: 18, background: 'rgba(255,255,255,.02)', overflow: 'hidden', boxShadow: '0 14px 40px rgba(0,0,0,.35)' }}>
      {organisationName && (
        <div style={{ padding: '18px 22px 0', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <OrganisationLogo branding={branding} organisationName={organisationName} size={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: TICKET_TEXT_SECONDARY,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {branding?.name ?? organisationName}
            </div>
            {branding?.website && (
              <a
                href={branding.website} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, fontWeight: 600, color: linkColor, textDecoration: 'none' }}
              >
                Visit website →
              </a>
            )}
          </div>
        </div>
      )}

      {props.eventArtworkUrl && (
        <div style={{ width: '100%', maxHeight: 320, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={props.eventArtworkUrl} alt={`${props.eventName} artwork`} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      <div style={{ padding: '22px 22px 6px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>{props.eventName}</h1>
        <div style={{ fontSize: 13, color: TICKET_TEXT_SECONDARY, lineHeight: 1.7 }}>
          {formatTicketDate(props.eventStartsAt, props.eventTimezone)}<br />
          {formatTicketTime(props.eventStartsAt, props.eventTimezone)} – {formatTicketTime(props.eventEndsAt, props.eventTimezone)}
          {props.eventVenue && <> · {props.eventVenue}</>}
        </div>
      </div>

      <div style={{ margin: '18px 22px', borderTop: `1px dashed ${dividerColor}` }} />

      <div style={{ padding: '0 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TicketField label="Attendee" value={props.attendeeName} />
        {props.ticketTypeName && <TicketField label="Ticket" value={props.ticketTypeName} />}
        {props.session && (
          <TicketField label="Session" value={`${props.session.name} · ${formatTicketTime(props.session.starts_at, props.eventTimezone)}`} />
        )}
      </div>

      <div style={{ padding: 22, display: 'flex', justifyContent: 'center' }}>
        {cancelled ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: TICKET_RED, fontSize: 13, fontWeight: 600 }}>
            {eventCancelled ? 'This event has been cancelled.' : 'This ticket has been cancelled.'}
          </div>
        ) : (
          <div
            aria-label={`Ticket QR code for ${props.attendeeName}`}
            style={{ background: '#fff', borderRadius: 12, padding: 14, width: 220, height: 220, boxSizing: 'border-box' }}
            dangerouslySetInnerHTML={{ __html: props.qrSvg }}
          />
        )}
      </div>

      {!cancelled && (
        <div style={{ padding: '0 22px 22px', textAlign: 'center' }}>
          {props.checkedInAt ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
              color: TICKET_GREEN, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)',
              borderRadius: 999, padding: '6px 14px',
            }}>
              Checked in
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
              color: TICKET_TEXT_SECONDARY, background: 'rgba(255,255,255,.04)', border: `1px solid ${TICKET_BORDER_SOFT}`,
              borderRadius: 999, padding: '6px 14px',
            }}>
              Valid — not yet checked in
            </span>
          )}
        </div>
      )}
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
