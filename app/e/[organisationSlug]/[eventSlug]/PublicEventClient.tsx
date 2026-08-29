'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Calendar, Clock, MapPin, Users, Minus, Plus, CheckCircle2, Ticket } from 'lucide-react';
import type { PublicEventDetail, PublicSession, PublicTicketType } from '@/lib/events/publicEventDetail';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

// Hardcoded, always-dark tokens — deliberately NOT the ops-shell's
// data-theme-driven CSS vars (app/globals.css). This is a public,
// unauthenticated destination page; it must render identically
// regardless of any staff member's light/dark toggle elsewhere in the
// app (see components/theme/ThemeProvider.tsx), so it follows the same
// "hardcode the dark palette" convention app/page.tsx already uses
// rather than depending on a toggle that has nothing to do with this
// page's visitors.
const BG = '#07080B';
const BORDER = 'rgba(255,255,255,.08)';
const BORDER_SOFT = 'rgba(255,255,255,.06)';
const VIOLET = '#8A4DFF';
const VIOLET_SOFT = '#A78BFA';
const VIOLET_GRADIENT = 'linear-gradient(100deg,#6A3DFF 0%,#8A4DFF 55%,#5677FF 100%)';
const TEXT_PRIMARY = '#F5F7FA';
const TEXT_SECONDARY = 'rgba(226,232,240,.66)';
const TEXT_MUTED = 'rgba(226,232,240,.42)';
const GREEN = '#4ADE80';
const RED = '#F87171';

// Section-local CSS (same pattern app/page.tsx already uses for its own
// `bb-home-*` classes) — needed for :checked/:focus-visible/:disabled
// sibling styling on the ticket/session radio cards, and for the
// desktop two-column breakpoint, neither of which inline style objects
// can express.
const EVENT_PAGE_CSS = `
.bb-event-header {
  position: sticky; top: 0; z-index: 50;
  background: rgba(7,8,11,.86); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid ${BORDER_SOFT};
}
.bb-event-glow-top {
  position: fixed; inset: 0 0 auto 0; height: 560px; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse 70% 50% at 50% -10%, rgba(138,77,255,.14) 0%, rgba(74,54,180,.045) 40%, transparent 72%);
}
.bb-event-glow-orb {
  position: absolute; top: -140px; right: -160px; width: 420px; height: 420px; border-radius: 50%;
  background: radial-gradient(circle, rgba(138,77,255,.16) 0%, rgba(88,68,220,.05) 42%, transparent 70%);
  filter: blur(30px); animation: glowPulse 7s ease-in-out infinite; pointer-events: none; z-index: 0;
}
.bb-event-main { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto; padding: 40px 20px 88px; }
.bb-event-grid { display: grid; grid-template-columns: 1fr; gap: 28px; align-items: start; }
@media (min-width: 960px) {
  .bb-event-grid { grid-template-columns: 1.05fr .95fr; gap: 44px; }
  .bb-event-booking-col { position: sticky; top: 92px; }
}
@media (max-width: 640px) {
  .bb-event-main { padding: 24px 16px 72px; }
}
.bb-event-artwork-img { max-height: 560px; }
@media (max-width: 640px) {
  .bb-event-artwork-img { max-height: 460px; }
}
.bb-radio-card { position: relative; display: block; cursor: pointer; border-radius: 12px; }
.bb-radio-card input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.bb-radio-card-inner {
  border: 1px solid ${BORDER}; background: rgba(255,255,255,.02); border-radius: 12px; padding: 13px 15px;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.bb-radio-card input:checked + .bb-radio-card-inner {
  border-color: rgba(138,77,255,.55); background: rgba(138,77,255,.08);
  box-shadow: 0 0 0 1px rgba(138,77,255,.25) inset;
}
.bb-radio-card input:focus-visible + .bb-radio-card-inner { outline: 2px solid ${VIOLET}; outline-offset: 2px; }
.bb-radio-card input:disabled + .bb-radio-card-inner { opacity: .42; cursor: not-allowed; }
.bb-event-input {
  width: 100%; background: rgba(255,255,255,.03); border: 1px solid ${BORDER}; border-radius: 9px;
  padding: 10px 12px; font-size: 14px; color: ${TEXT_PRIMARY}; font-family: ${FONT};
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.bb-event-input::placeholder { color: rgba(226,232,240,.32); }
.bb-event-input:focus {
  outline: none; border-color: rgba(138,77,255,.55); background: rgba(138,77,255,.05);
  box-shadow: 0 0 0 3px rgba(124,58,237,.16);
}
.bb-event-input:disabled { opacity: .5; cursor: not-allowed; }
.bb-event-stepper-btn {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid ${BORDER};
  background: rgba(255,255,255,.03); color: ${TEXT_PRIMARY}; display: inline-flex;
  align-items: center; justify-content: center; cursor: pointer; transition: border-color .15s ease, background .15s ease;
}
.bb-event-stepper-btn:hover:not(:disabled) { border-color: rgba(138,77,255,.4); background: rgba(138,77,255,.08); }
.bb-event-stepper-btn:focus-visible { outline: 2px solid ${VIOLET}; outline-offset: 2px; }
.bb-event-stepper-btn:disabled { opacity: .35; cursor: not-allowed; }
.bb-event-cta {
  width: 100%; border: none; border-radius: 11px; padding: 14px 20px; font-size: 14px; font-weight: 650;
  color: #fff; cursor: pointer; font-family: ${FONT}; background: ${VIOLET_GRADIENT};
  box-shadow: 0 8px 26px rgba(106,61,255,.28); display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: opacity .15s ease, transform .08s ease;
}
.bb-event-cta:disabled { opacity: .48; cursor: not-allowed; box-shadow: none; }
.bb-event-cta:not(:disabled):active { transform: translateY(1px); }
.bb-event-cta:focus-visible { outline: 2px solid ${VIOLET_SOFT}; outline-offset: 3px; }
.bb-event-spin {
  width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff; animation: bbEventSpin .7s linear infinite; display: inline-block; flex: none;
}
@keyframes bbEventSpin { to { transform: rotate(360deg); } }
`;

function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso));
}
function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}
function formatPrice(cents: number): string {
  return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`;
}
// "280 places remaining" — sentence case, never the all-caps "280
// REMAINING" the uppercase-transform styling used to force onto this
// same text.
function formatPlacesRemaining(remaining: number): string {
  return `${remaining} place${remaining === 1 ? '' : 's'} remaining`;
}

// Deliberately never adds/combines remaining quantities across ticket
// types (or, previously, across ticket types and sessions) into one
// synthetic "overall remaining" number — those are genuinely different
// capacity pools (e.g. Adult Guest vs. Student, or a ticket type vs. a
// session), and summing them produced a meaningless total at best. This
// is also the fix for a real defect: a bigint/string type mismatch in
// the underlying SQL (see lib/events/publicEventDetail.ts's own
// comment) meant a prior version of this reduce() over `t.remaining`
// silently did STRING CONCATENATION instead of addition, rendering a
// malformed value like "0280147 places remaining". The correct fix is
// not just casting the type — it's to never combine independent
// capacity pools into one figure at all. Each ticket type's and each
// session's own remaining count is still shown independently, right on
// its own choice card, exactly where it's meaningful.
function availabilityState(ticketTypes: PublicTicketType[]): { label: string; tone: 'ok' | 'soldout' | 'neutral' } {
  if (ticketTypes.length === 0) return { label: 'Registration not currently open', tone: 'neutral' };
  const anyAvailable = ticketTypes.some(t => t.remaining > 0);
  if (!anyAvailable) return { label: 'Sold out', tone: 'soldout' };
  return { label: 'Tickets available', tone: 'ok' };
}

function EventHeader() {
  return (
    <header className="bb-event-header">
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '13px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Image src="/Brand/brainbase-logo-dark.svg" alt="BRΛINBΛSE" width={132} height={30} priority style={{ display: 'block', width: 120, height: 'auto' }} />
        <span style={{ fontSize: 11, color: TEXT_MUTED, letterSpacing: '.03em', fontWeight: 500 }}>Powered by BrainBase</span>
      </div>
    </header>
  );
}

export default function PublicEventClient({
  organisationSlug,
  eventSlug,
  detail,
}: {
  organisationSlug: string;
  eventSlug: string;
  detail: PublicEventDetail;
}) {
  const { event, sessions, ticket_types: ticketTypes } = detail;

  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? '');
  const [sessionId, setSessionId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [attendeeNames, setAttendeeNames] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ reference: string; quantity: number; tickets: { attendee_name: string; ticket_token: string }[] } | null>(null);

  const selectedTicketType = ticketTypes.find(t => t.id === ticketTypeId);
  const selectedSession = sessions.find(s => s.id === sessionId);
  const maxQuantity = selectedTicketType ? Math.max(0, Math.min(selectedTicketType.remaining, 20)) : 0;
  const availability = availabilityState(ticketTypes);

  function setQuantityAndResizeAttendees(next: number) {
    setQuantity(next);
    setAttendeeNames(prev => {
      const arr = prev.slice(0, next);
      while (arr.length < next) arr.push('');
      return arr;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/events/${organisationSlug}/${eventSlug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_type_id: ticketTypeId,
          event_session_id: sessionId || undefined,
          quantity,
          purchaser_name: purchaserName,
          purchaser_email: purchaserEmail,
          purchaser_phone: purchaserPhone || undefined,
          attendees: attendeeNames.map(name => ({ name })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Registration failed (${res.status}).`);
        return;
      }
      setConfirmation({ reference: body.confirmation_reference, quantity: body.quantity, tickets: body.tickets ?? [] });
    } catch {
      setError('Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, position: 'relative', overflowX: 'hidden' }}>
        <style>{EVENT_PAGE_CSS}</style>
        <div className="bb-event-glow-top" aria-hidden="true" />
        <EventHeader />
        <main className="bb-event-main" style={{ maxWidth: 560, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', border: `1px solid ${BORDER}`, borderRadius: 18, background: 'rgba(255,255,255,.02)', padding: '36px 28px', textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(74,222,128,.12)', border: '1px solid rgba(74,222,128,.35)', boxShadow: '0 0 32px rgba(74,222,128,.18)',
            }}>
              <CheckCircle2 size={28} color={GREEN} />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>You&rsquo;re registered</h1>
            <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: '0 0 24px' }}>
              Your registration is confirmed for <strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>{event.name}</strong>.
            </p>

            <div style={{ textAlign: 'left', border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: 'rgba(255,255,255,.02)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <ConfirmationRow label="Name" value={purchaserName} />
              <ConfirmationRow label="Tickets" value={`${confirmation.quantity} ticket${confirmation.quantity === 1 ? '' : 's'}${selectedTicketType ? ` · ${selectedTicketType.name}` : ''}`} />
              {selectedSession && <ConfirmationRow label="Session" value={selectedSession.name} />}
              <ConfirmationRow label="Date" value={`${formatDate(event.starts_at, event.timezone)} · ${formatTime(event.starts_at, event.timezone)}`} />
              {event.venue && <ConfirmationRow label="Venue" value={event.venue} />}
            </div>

            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 4 }}>Confirmation reference</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: VIOLET_SOFT, wordBreak: 'break-all' }}>{confirmation.reference}</div>
            </div>

            {confirmation.tickets.length > 0 && (
              <div style={{ textAlign: 'left', marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 8 }}>
                  Your ticket{confirmation.tickets.length === 1 ? '' : 's'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {confirmation.tickets.map(t => (
                    <a
                      key={t.ticket_token} href={`/t/${t.ticket_token}`} target="_blank" rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', textDecoration: 'none',
                        background: 'rgba(255,255,255,.02)', color: TEXT_PRIMARY, fontSize: 13, fontWeight: 600,
                      }}
                    >
                      {t.attendee_name}
                      <span style={{ color: VIOLET_SOFT, fontSize: 12, fontWeight: 700 }}>View ticket →</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <p style={{ fontSize: 12, color: TEXT_MUTED, lineHeight: 1.6, margin: 0 }}>
              Keep this confirmation reference for your records. No email has been sent — bookmark this page or save your ticket link{confirmation.tickets.length === 1 ? '' : 's'} above.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, position: 'relative', overflowX: 'hidden' }}>
      <style>{EVENT_PAGE_CSS}</style>
      <div className="bb-event-glow-top" aria-hidden="true" />
      <EventHeader />

      <main className="bb-event-main">
        <div className="bb-event-grid">
          {/* Left: event hero / details */}
          <div style={{ position: 'relative' }}>
            <div className="bb-event-glow-orb" aria-hidden="true" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              {event.artwork_url && <EventArtwork src={event.artwork_url} alt={`${event.name} artwork`} />}

              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
                letterSpacing: '.09em', textTransform: 'uppercase', color: VIOLET_SOFT, marginBottom: 14,
              }}>
                <Ticket size={13} /> Event
              </div>

              <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.12, margin: '0 0 18px' }}>
                {event.name}
              </h1>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <MetaRow icon={<Calendar size={15} color={VIOLET_SOFT} />} text={formatDate(event.starts_at, event.timezone)} />
                <MetaRow icon={<Clock size={15} color={VIOLET_SOFT} />} text={`${formatTime(event.starts_at, event.timezone)} – ${formatTime(event.ends_at, event.timezone)}`} />
                {event.venue && <MetaRow icon={<MapPin size={15} color={VIOLET_SOFT} />} text={event.venue} />}
              </div>

              {event.description && (
                <p style={{ fontSize: 14.5, lineHeight: 1.7, color: TEXT_SECONDARY, margin: '0 0 22px', maxWidth: 480 }}>
                  {event.description}
                </p>
              )}

              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600,
                padding: '7px 13px', borderRadius: 999,
                border: `1px solid ${availability.tone === 'soldout' ? 'rgba(248,113,113,.3)' : availability.tone === 'neutral' ? BORDER : 'rgba(74,222,128,.28)'}`,
                background: availability.tone === 'soldout' ? 'rgba(248,113,113,.08)' : availability.tone === 'neutral' ? 'rgba(255,255,255,.03)' : 'rgba(74,222,128,.08)',
                color: availability.tone === 'soldout' ? RED : availability.tone === 'neutral' ? TEXT_SECONDARY : GREEN,
              }}>
                <Users size={13} /> {availability.label}
              </div>
            </div>
          </div>

          {/* Right: booking card */}
          <div className="bb-event-booking-col">
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 16, background: 'rgba(255,255,255,.025)', padding: 22 }}>
              {ticketTypes.length === 0 ? (
                <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: 0, textAlign: 'center', padding: '24px 4px' }}>
                  No tickets are currently available for this event.
                </p>
              ) : (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={1} text="Choose ticket" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {ticketTypes.map(t => (
                        <TicketOption
                          key={t.id}
                          ticket={t}
                          selected={ticketTypeId === t.id}
                          onSelect={() => { setTicketTypeId(t.id); setQuantityAndResizeAttendees(1); }}
                        />
                      ))}
                    </div>
                  </fieldset>

                  {sessions.length > 0 && (
                    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                      <StepLabel index={2} text="Choose session" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label className="bb-radio-card">
                          <input type="radio" name="event-session" value="" checked={sessionId === ''} onChange={() => setSessionId('')} />
                          <div className="bb-radio-card-inner">
                            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }}>No specific session</div>
                          </div>
                        </label>
                        {sessions.map(s => (
                          <SessionOption key={s.id} session={s} timezone={event.timezone} selected={sessionId === s.id} onSelect={() => setSessionId(s.id)} />
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={sessions.length > 0 ? 3 : 2} text="Quantity" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button
                        type="button" aria-label="Decrease quantity" className="bb-event-stepper-btn"
                        disabled={quantity <= 1}
                        onClick={() => setQuantityAndResizeAttendees(Math.max(1, quantity - 1))}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        required type="number" inputMode="numeric" min={1} max={maxQuantity || 1}
                        value={quantity} aria-label="Quantity"
                        onChange={e => setQuantityAndResizeAttendees(Math.max(1, Math.min(maxQuantity || 1, Number(e.target.value) || 1)))}
                        className="bb-event-input" style={{ width: 56, textAlign: 'center' }}
                      />
                      <button
                        type="button" aria-label="Increase quantity" className="bb-event-stepper-btn"
                        disabled={quantity >= maxQuantity}
                        onClick={() => setQuantityAndResizeAttendees(Math.min(maxQuantity || 1, quantity + 1))}
                      >
                        <Plus size={14} />
                      </button>
                      <span style={{ fontSize: 12, color: TEXT_MUTED }}>{maxQuantity} max</span>
                    </div>
                  </fieldset>

                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={sessions.length > 0 ? 4 : 3} text="Purchaser details" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Field label="Name">
                        <input required value={purchaserName} onChange={e => setPurchaserName(e.target.value)} className="bb-event-input" autoComplete="name" />
                      </Field>
                      <Field label="Email">
                        <input required type="email" value={purchaserEmail} onChange={e => setPurchaserEmail(e.target.value)} className="bb-event-input" autoComplete="email" />
                      </Field>
                      <Field label="Phone (optional)">
                        <input value={purchaserPhone} onChange={e => setPurchaserPhone(e.target.value)} className="bb-event-input" autoComplete="tel" />
                      </Field>
                    </div>
                  </fieldset>

                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={sessions.length > 0 ? 5 : 4} text="Attendee details" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {attendeeNames.map((name, i) => (
                        <Field key={i} label={`Attendee ${i + 1}`}>
                          <input
                            required value={name}
                            onChange={e => setAttendeeNames(prev => prev.map((n, idx) => (idx === i ? e.target.value : n)))}
                            className="bb-event-input"
                          />
                        </Field>
                      ))}
                    </div>
                  </fieldset>

                  {error && (
                    <div role="alert" style={{
                      fontSize: 13, color: '#FCA5A5', background: 'rgba(239,68,68,.08)',
                      border: '1px solid rgba(239,68,68,.25)', borderRadius: 9, padding: '10px 12px', lineHeight: 1.5,
                    }}>
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={submitting || maxQuantity <= 0} className="bb-event-cta">
                    {submitting && <span className="bb-event-spin" aria-hidden="true" />}
                    {submitting ? 'Confirming…' : 'Confirm registration'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepLabel({ index, text }: { index: number; text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
      textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 10,
    }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', border: `1px solid ${BORDER}`, color: VIOLET_SOFT,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
      }}>
        {index}
      </span>
      {text}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: TEXT_SECONDARY, fontWeight: 500 }}>
      {label}
      {children}
    </label>
  );
}

// event.artwork_url is a staff-pasted external URL (see
// scripts/add-events-artwork.sql), never verified server-side to
// actually resolve to an image — so this renders nothing at all rather
// than a broken-image icon if the URL 404s or the host refuses to load.
// A plain <img>, not next/image: the source is an arbitrary external
// host chosen per-event by the organiser, not a configurable, bounded
// set of remote origins next/image's own allow-list expects.
//
// Deliberately no fixed aspect-ratio box / object-fit: cover — that
// cropped portrait posters badly. Instead: the frame spans the full
// column width (so its dark panel/border/shadow always reads as an
// intentional "poster frame", even for a narrow portrait image with
// visible side padding) but has NO fixed height — a flex container
// with no explicit height simply hugs its tallest child, so the
// frame's height always equals the image's own rendered height. The
// image itself uses object-fit: contain with both max-width: 100% and
// a CSS-only max-height cap (.bb-event-artwork-img, 560px desktop /
// 460px mobile — media queries can't live in inline styles), which is
// enough on its own for the browser to compute the largest size
// preserving aspect ratio within both bounds — no JS orientation
// detection, no distortion, no crop, ever.
function EventArtwork({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div style={{
      width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center',
      borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}`, marginBottom: 22,
      background: 'rgba(255,255,255,.02)', boxShadow: '0 14px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(138,77,255,.07)',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt={alt} onError={() => setFailed(true)} className="bb-event-artwork-img"
        style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}

function MetaRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, color: TEXT_SECONDARY }}>
      {icon}
      {text}
    </div>
  );
}

function ConfirmationRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span style={{ color: TEXT_MUTED }}>{label}</span>
      <span style={{ color: TEXT_PRIMARY, fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function TicketOption({
  ticket, selected, onSelect,
}: { ticket: PublicTicketType; selected: boolean; onSelect: () => void }) {
  const soldOut = ticket.remaining <= 0;
  return (
    <label className="bb-radio-card">
      <input type="radio" name="event-ticket-type" value={ticket.id} checked={selected} disabled={soldOut} onChange={onSelect} />
      <div className="bb-radio-card-inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_PRIMARY }}>{ticket.name}</div>
            {ticket.description && <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 3 }}>{ticket.description}</div>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: ticket.price_cents === 0 ? GREEN : VIOLET_SOFT, whiteSpace: 'nowrap' }}>
            {formatPrice(ticket.price_cents)}
          </div>
        </div>
        <div style={{ marginTop: 9, fontSize: 11.5, fontWeight: 600, color: soldOut ? RED : TEXT_MUTED }}>
          {soldOut ? 'Sold out' : formatPlacesRemaining(ticket.remaining)}
        </div>
      </div>
    </label>
  );
}

function SessionOption({
  session, timezone, selected, onSelect,
}: { session: PublicSession; timezone: string; selected: boolean; onSelect: () => void }) {
  const soldOut = session.remaining <= 0;
  return (
    <label className="bb-radio-card">
      <input type="radio" name="event-session" value={session.id} checked={selected} disabled={soldOut} onChange={onSelect} />
      <div className="bb-radio-card-inner">
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_PRIMARY }}>{session.name}</div>
        <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 3 }}>
          {formatTime(session.starts_at, timezone)} – {formatTime(session.ends_at, timezone)}
        </div>
        <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: soldOut ? RED : TEXT_MUTED }}>
          {soldOut ? 'Sold out' : formatPlacesRemaining(session.remaining)}
        </div>
      </div>
    </label>
  );
}
