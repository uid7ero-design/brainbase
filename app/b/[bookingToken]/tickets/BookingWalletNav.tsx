'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TicketCard, TICKET_BORDER, TICKET_BORDER_SOFT, TICKET_VIOLET_SOFT,
  TICKET_TEXT_PRIMARY, TICKET_TEXT_SECONDARY, TICKET_TEXT_MUTED, type TicketCardStatus,
} from '@/components/events/TicketCard';
import type { PublicOrganisationBranding } from '@/lib/organisations/branding';

// Client-only interactive slice of the booking wallet — everything
// sensitive (which tickets exist, their tokens, their validity) was
// already resolved server-side (see page.tsx) and is passed in here as
// plain props; this component only tracks "which index is currently
// shown" and renders navigation chrome around the shared, stateless
// TicketCard. No data fetching happens client-side — this is exactly
// the "keep sensitive data resolution server-side, isolate only the
// interactive navigation" boundary the booking-wallet design calls for.
//
// Deliberately never renders more than one QR at a time (see the
// booking-wallet design's own "show one at a time, never simultaneous"
// reasoning: multiple visible QR codes on one screen at a real gate
// risks a scanner reading the wrong attendee's ticket). There is no
// "show all" mode anywhere in this component, not even opt-in.
export type WalletTicket = {
  attendeeName: string;
  ticketTypeName: string | null;
  session: { name: string; starts_at: string; ends_at: string } | null;
  checkedInAt: string | null;
  status: TicketCardStatus;
  qrSvg: string;
  ticketUrl: string;
};

export type WalletEvent = {
  name: string;
  venue: string | null;
  artworkUrl: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

const navBtnStyle: React.CSSProperties = {
  minWidth: 44, minHeight: 44, padding: '0 18px', borderRadius: 12,
  border: `1px solid ${TICKET_BORDER}`, background: 'rgba(255,255,255,.03)',
  color: TICKET_TEXT_PRIMARY, fontSize: 14, fontWeight: 700, cursor: 'pointer',
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  minWidth: 44, minHeight: 44, padding: '0 14px', borderRadius: 10, flex: '0 0 auto',
  border: `1px solid ${active ? TICKET_VIOLET_SOFT : TICKET_BORDER_SOFT}`,
  background: active ? 'rgba(167,139,250,.14)' : 'rgba(255,255,255,.02)',
  color: active ? TICKET_TEXT_PRIMARY : TICKET_TEXT_SECONDARY,
  fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});

const SWIPE_THRESHOLD_PX = 40;

// Phase 3C: branding/organisationName are forwarded straight through to
// the shared TicketCard below — the same object every attendee in this
// booking gets, resolved once by page.tsx, never re-derived per
// attendee. This component's OWN navigation chrome (Prev/Next, the
// attendee chip strip, the jump <select>) deliberately stays on its
// existing TICKET_* structural constants, unbranded — the smaller,
// lower-coupling option explicitly preferred for this pass over also
// threading an accent into the active-chip/button treatment.
export default function BookingWalletNav({
  event, tickets, branding, organisationName,
}: {
  event: WalletEvent;
  tickets: WalletTicket[];
  branding?: PublicOrganisationBranding | null;
  organisationName?: string;
}) {
  const total = tickets.length;
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const goTo = useCallback((i: number) => {
    setIndex(((i % total) + total) % total);
    setCopied(false);
  }, [total]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  // Keyboard Previous/Next — buttons remain the primary discoverable
  // control; arrow keys are a progressive enhancement layered on top,
  // not a replacement.
  useEffect(() => {
    if (total <= 1) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [total, goPrev, goNext]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — the ticket's own link is still openable directly */ }
  }

  const current = tickets[index];

  return (
    <div>
      {total > 1 && (
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: TICKET_TEXT_SECONDARY, marginBottom: 10 }}>
            {index + 1} of {total} · <span style={{ color: TICKET_TEXT_PRIMARY, fontWeight: 600 }}>{current.attendeeName}</span>
          </div>

          {/* Compact attendee jump strip — the ONLY horizontally-
              scrollable element on this page; the page itself must
              never overflow horizontally. */}
          <div
            role="tablist"
            aria-label="Jump to attendee"
            style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 2px 8px', justifyContent: total <= 5 ? 'center' : 'flex-start' }}
          >
            {tickets.map((t, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === index}
                aria-label={`Show ticket for ${t.attendeeName}`}
                onClick={() => goTo(i)}
                style={chipStyle(i === index)}
              >
                {t.attendeeName}
              </button>
            ))}
          </div>

          {/* 10+ attendees — a native <select> as a compact, fully
              accessible direct-jump control (keyboard/screen-reader
              support for free, no extra ARIA wiring needed), additive
              to the chip strip above rather than replacing it. */}
          {total >= 10 && (
            <label style={{ display: 'block', marginTop: 8, fontSize: 12, color: TICKET_TEXT_MUTED }}>
              Jump to attendee
              <select
                value={index}
                onChange={e => goTo(Number(e.target.value))}
                style={{
                  display: 'block', width: '100%', marginTop: 4, minHeight: 44, borderRadius: 10,
                  border: `1px solid ${TICKET_BORDER}`, background: 'rgba(255,255,255,.03)', color: TICKET_TEXT_PRIMARY,
                  fontSize: 13, padding: '0 10px',
                }}
              >
                {tickets.map((t, i) => <option key={i} value={i}>{t.attendeeName}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      <div
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchStartX.current === null || total <= 1) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current = null;
          if (dx > SWIPE_THRESHOLD_PX) goPrev();
          else if (dx < -SWIPE_THRESHOLD_PX) goNext();
        }}
      >
        <TicketCard
          eventName={event.name}
          eventVenue={event.venue}
          eventArtworkUrl={event.artworkUrl}
          eventStartsAt={event.startsAt}
          eventEndsAt={event.endsAt}
          eventTimezone={event.timezone}
          attendeeName={current.attendeeName}
          ticketTypeName={current.ticketTypeName}
          session={current.session}
          checkedInAt={current.checkedInAt}
          status={current.status}
          qrSvg={current.qrSvg}
          branding={branding}
          organisationName={organisationName}
        />
      </div>

      {total > 1 && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={goPrev} aria-label="Previous ticket" style={navBtnStyle}>‹ Previous</button>
          <button onClick={goNext} aria-label="Next ticket" style={navBtnStyle}>Next ›</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
        <a
          href={current.ticketUrl} target="_blank" rel="noopener noreferrer"
          style={{ ...navBtnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 12, padding: '0 14px' }}
        >
          Open individual ticket
        </a>
        <button onClick={() => copyLink(current.ticketUrl)} style={{ ...navBtnStyle, fontSize: 12, padding: '0 14px' }}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}
