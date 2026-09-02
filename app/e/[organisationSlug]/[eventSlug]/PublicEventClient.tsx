'use client';

import { useState } from 'react';
import { Calendar, Clock, MapPin, Users, Minus, Plus, CheckCircle2, Ticket } from 'lucide-react';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';
import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme';
import { InstitutionalHeader, InstitutionalHero, InstitutionalFooter } from '@/components/publicEvents/InstitutionalChrome';
import type { PublicEventDetail, PublicSession, PublicTicketType, PublicQuestion } from '@/lib/events/publicEventDetail';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

// Public event branding (see lib/events/publicEventTheme.ts) — these
// were previously hardcoded hex/rgba literals; they are now the exact
// matching `var(--bbpe-*)` custom-property strings, set once via
// `theme.cssVars` on this page's own root element below. Every existing
// usage of these consts throughout this file (and the shared
// EVENT_PAGE_CSS block) is therefore already theme-aware with no other
// change required — a non-branded organisation gets `theme.cssVars`
// equal to these exact original values, so its rendering is byte-for-
// byte unchanged from before this pass. Deliberately still NOT the ops-
// shell's data-theme-driven light/dark CSS vars (app/globals.css) — this
// is a public, unauthenticated destination page that must render
// identically regardless of any staff member's light/dark toggle
// elsewhere in the app (see components/theme/ThemeProvider.tsx); the
// per-organisation branding theme above is an orthogonal concern to that
// toggle, not a replacement for the "always dark base" convention
// app/page.tsx also uses.
const BG = 'var(--bbpe-bg)';
const BORDER = 'var(--bbpe-border)';
const BORDER_SOFT = 'var(--bbpe-border-soft)';
const VIOLET = 'var(--bbpe-accent)';
const VIOLET_SOFT = 'var(--bbpe-accent-soft)';
const VIOLET_GRADIENT = 'var(--bbpe-accent-gradient)';
const TEXT_PRIMARY = 'var(--bbpe-text-primary)';
const TEXT_SECONDARY = 'var(--bbpe-text-secondary)';
const TEXT_MUTED = 'var(--bbpe-text-muted)';
const GREEN = 'var(--bbpe-green)';
const RED = 'var(--bbpe-red)';

// Section-local CSS (same pattern app/page.tsx already uses for its own
// `bb-home-*` classes) — needed for :checked/:focus-visible/:disabled
// sibling styling on the ticket/session radio cards, and for the
// desktop two-column breakpoint, neither of which inline style objects
// can express.
const EVENT_PAGE_CSS = `
.bb-event-header {
  position: sticky; top: 0; z-index: 50;
  background: var(--bbpe-bg-translucent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid ${BORDER_SOFT};
}
.bb-event-glow-top {
  position: fixed; inset: 0 0 auto 0; height: 560px; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse 70% 50% at 50% -10%, rgba(var(--bbpe-accent-rgb),.14) 0%, rgba(var(--bbpe-accent-rgb),.045) 40%, transparent 72%);
}
.bb-event-glow-orb {
  position: absolute; top: -140px; right: -160px; width: 420px; height: 420px; border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--bbpe-accent-rgb),.16) 0%, rgba(var(--bbpe-accent-rgb),.05) 42%, transparent 70%);
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
  border-color: rgba(var(--bbpe-accent-rgb),.55); background: rgba(var(--bbpe-accent-rgb),.08);
  box-shadow: 0 0 0 1px rgba(var(--bbpe-accent-rgb),.25) inset;
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
  outline: none; border-color: rgba(var(--bbpe-accent-rgb),.55); background: rgba(var(--bbpe-accent-rgb),.05);
  box-shadow: 0 0 0 3px rgba(var(--bbpe-accent-rgb),.16);
}
.bb-event-input:disabled { opacity: .5; cursor: not-allowed; }
.bb-event-stepper-btn {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid ${BORDER};
  background: rgba(255,255,255,.03); color: ${TEXT_PRIMARY}; display: inline-flex;
  align-items: center; justify-content: center; cursor: pointer; transition: border-color .15s ease, background .15s ease;
}
.bb-event-stepper-btn:hover:not(:disabled) { border-color: rgba(var(--bbpe-accent-rgb),.4); background: rgba(var(--bbpe-accent-rgb),.08); }
.bb-event-stepper-btn:focus-visible { outline: 2px solid ${VIOLET}; outline-offset: 2px; }
.bb-event-stepper-btn:disabled { opacity: .35; cursor: not-allowed; }
.bb-event-cta {
  width: 100%; border: none; border-radius: 11px; padding: 14px 20px; font-size: 14px; font-weight: 650;
  color: #fff; cursor: pointer; font-family: ${FONT}; background: ${VIOLET_GRADIENT};
  box-shadow: 0 8px 26px rgba(var(--bbpe-accent-rgb),.28); display: flex; align-items: center; justify-content: center; gap: 8px;
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
// Exported (not just used inline) so it's directly unit-testable — see
// tests/containment/eventsPublicCheckoutTotal.test.ts. Integer cents
// in, integer cents out; never floating-point dollars at any point.
// This is the exact same formula the checkout route computes
// server-side (`ticketType.price_cents * validated.quantity`) — kept
// here only for DISPLAY, so the number shown always matches what
// Stripe is actually charged, for any quantity, not just quantity 1.
export function computeSelectionTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
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
        <BrainBaseWordmark width={110} />
        <span style={{ fontSize: 11, color: TEXT_MUTED, letterSpacing: '.03em', fontWeight: 500 }}>Powered by BrainBase</span>
      </div>
    </header>
  );
}

export default function PublicEventClient({
  organisationSlug,
  eventSlug,
  detail,
  checkoutCancelled,
}: {
  organisationSlug: string;
  eventSlug: string;
  detail: PublicEventDetail;
  checkoutCancelled: boolean;
}) {
  const { event, sessions, ticket_types: ticketTypes, questions } = detail;
  // Public event branding (see lib/events/publicEventTheme.ts) — a pure,
  // synchronous lookup keyed only by the organisationSlug this component
  // already receives as a prop; no new query, no schema change. Every
  // organisation not in the registry gets `DEFAULT_THEME`, whose tokens
  // are byte-identical to this file's original hardcoded palette.
  const theme = resolvePublicEventTheme(organisationSlug);
  const institutional = theme.variant === 'institutional';
  // Phase 4B §5 — the two scopes always render as two separate blocks
  // (never interleaved): ORDER questions once, under "Booking details";
  // ATTENDEE questions once per attendee, under each attendee's own
  // name field. This grouping is also why QuestionsPanel's manager-side
  // reorder only swaps within a scope group — crossing the boundary
  // wouldn't change anything visible here.
  const orderQuestions = questions.filter(q => q.scope === 'ORDER');
  const attendeeQuestions = questions.filter(q => q.scope === 'ATTENDEE');

  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? '');
  const [sessionId, setSessionId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [attendeeNames, setAttendeeNames] = useState<string[]>(['']);
  // Keyed by question id. orderAnswers is a single record (once per
  // booking); attendeeAnswers is one record per attendee, resized in
  // lockstep with attendeeNames by the same setQuantityAndResizeAttendees
  // below, so a quantity change never leaves an attendee's answers
  // pointing at the wrong array index.
  const [orderAnswers, setOrderAnswers] = useState<Record<string, unknown>>({});
  const [attendeeAnswers, setAttendeeAnswers] = useState<Record<string, unknown>[]>([{}]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ reference: string; quantity: number; tickets: { attendee_name: string; ticket_token: string }[] } | null>(null);

  const selectedTicketType = ticketTypes.find(t => t.id === ticketTypeId);
  const selectedSession = sessions.find(s => s.id === sessionId);
  const maxQuantity = selectedTicketType ? Math.max(0, Math.min(selectedTicketType.remaining, 20)) : 0;
  const availability = availabilityState(ticketTypes);
  const isPaidSelection = (selectedTicketType?.price_cents ?? 0) > 0;
  const totalCents = computeSelectionTotalCents(selectedTicketType?.price_cents ?? 0, quantity);

  // Running step counter (rather than hand-computed arithmetic per
  // label) so inserting/removing an optional step — sessions, booking
  // details — can never desynchronise the numbers shown elsewhere.
  let stepCounter = 1;
  const stepTicket = stepCounter++;
  const stepSession = sessions.length > 0 ? stepCounter++ : null;
  const stepQuantity = stepCounter++;
  const stepPurchaser = stepCounter++;
  const stepOrderQuestions = orderQuestions.length > 0 ? stepCounter++ : null;
  const stepAttendee = stepCounter++;

  function setQuantityAndResizeAttendees(next: number) {
    setQuantity(next);
    setAttendeeNames(prev => {
      const arr = prev.slice(0, next);
      while (arr.length < next) arr.push('');
      return arr;
    });
    setAttendeeAnswers(prev => {
      const arr = prev.slice(0, next);
      while (arr.length < next) arr.push({});
      return arr;
    });
  }

  // Structural-shape builder for the wire format lib/events/
  // publicValidation.ts's parseResponsesArray() expects — only
  // questions the visitor actually has a value for are included (an
  // untouched optional field simply never appears in the array, rather
  // than being sent as an explicit null); the server treats a missing
  // entry for a required question as "not answered" either way.
  function buildResponses(qs: PublicQuestion[], answers: Record<string, unknown>) {
    return qs.filter(q => q.id in answers).map(q => ({ question_id: q.id, answer: answers[q.id] }));
  }

  // Client-side required-field enforcement is UX only — the server
  // (lib/events/registrationQuestions.ts's validateSubmittedResponses)
  // is authoritative and re-checks every one of these independently.
  // Native HTML `required` already covers SHORT_TEXT/LONG_TEXT/
  // SINGLE_SELECT (an empty <select>/<input> blocks submission) and
  // YES_NO (two radios sharing one `name`, each marked required — the
  // browser treats the whole group as satisfied once either is
  // checked). MULTI_SELECT has no native equivalent for "at least one
  // checkbox in this set must be checked", so it's the one case that
  // needs an explicit pre-submit check here.
  function findMissingRequiredMultiSelect(): string | null {
    for (const q of orderQuestions) {
      if (q.field_type !== 'MULTI_SELECT' || !q.required) continue;
      const value = orderAnswers[q.id];
      if (!Array.isArray(value) || value.length === 0) return `${q.label} is required.`;
    }
    for (let i = 0; i < attendeeAnswers.length; i++) {
      for (const q of attendeeQuestions) {
        if (q.field_type !== 'MULTI_SELECT' || !q.required) continue;
        const value = attendeeAnswers[i]?.[q.id];
        if (!Array.isArray(value) || value.length === 0) return `${q.label} is required for Attendee ${i + 1}.`;
      }
    }
    return null;
  }

  // Free ticket types post to /register and land on the in-page
  // confirmation state below, unchanged from Phase 2/3. A paid ticket
  // type (price_cents > 0) instead posts to /checkout, which reserves
  // capacity and returns a Stripe-hosted Checkout URL — the browser is
  // redirected there directly; there is no local "confirmation" state
  // for a paid submission, since nothing is confirmed yet (§5: only the
  // webhook, after Stripe redirects back to /checkout/success, can
  // confirm payment).
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const missing = findMissingRequiredMultiSelect();
    if (missing) { setError(missing); return; }
    setSubmitting(true);
    const paid = (selectedTicketType?.price_cents ?? 0) > 0;
    try {
      const res = await fetch(`/api/public/events/${organisationSlug}/${eventSlug}/${paid ? 'checkout' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_type_id: ticketTypeId,
          event_session_id: sessionId || undefined,
          quantity,
          purchaser_name: purchaserName,
          purchaser_email: purchaserEmail,
          purchaser_phone: purchaserPhone || undefined,
          attendees: attendeeNames.map((name, i) => ({ name, responses: buildResponses(attendeeQuestions, attendeeAnswers[i] ?? {}) })),
          order_responses: buildResponses(orderQuestions, orderAnswers),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `${paid ? 'Checkout' : 'Registration'} failed (${res.status}).`);
        setSubmitting(false);
        return;
      }
      if (paid) {
        window.location.href = body.checkout_url;
        return; // leave `submitting` true — the page is navigating away
      }
      setConfirmation({ reference: body.confirmation_reference, quantity: body.quantity, tickets: body.tickets ?? [] });
      setSubmitting(false);
    } catch {
      setError(`${paid ? 'Checkout' : 'Registration'} failed. Please try again.`);
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, position: 'relative', overflowX: 'hidden', ...theme.cssVars }}>
        <style>{EVENT_PAGE_CSS}</style>
        <div className="bb-event-glow-top" aria-hidden="true" />
        {institutional ? <InstitutionalHeader theme={theme} /> : <EventHeader />}
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
        {institutional && <InstitutionalFooter theme={theme} />}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, position: 'relative', overflowX: 'hidden', ...theme.cssVars }}>
      <style>{EVENT_PAGE_CSS}</style>
      <div className="bb-event-glow-top" aria-hidden="true" />
      {institutional ? <InstitutionalHeader theme={theme} /> : <EventHeader />}
      {institutional && (
        <InstitutionalHero
          eyebrow="Event"
          title={event.name}
          subtitle={
            <>
              {formatDate(event.starts_at, event.timezone)} · {formatTime(event.starts_at, event.timezone)}
              {event.venue ? ` · ${event.venue}` : ''}
            </>
          }
        />
      )}

      <main className="bb-event-main">
        <div className="bb-event-grid">
          {/* Left: event hero / details */}
          <div style={{ position: 'relative' }}>
            <div className="bb-event-glow-orb" aria-hidden="true" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              {event.artwork_url && <EventArtwork src={event.artwork_url} alt={`${event.name} artwork`} />}

              {/* The institutional variant already presented the eyebrow,
                  title, and date/time/venue meta in the hero band above —
                  repeating them here would be redundant, so this block
                  (never EventHeader — see this file's own comment on
                  EventHeader's untouched, org-agnostic contract) is the
                  only piece conditionally skipped for that variant. */}
              {!institutional && (
                <>
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
                </>
              )}

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
                    <StepLabel index={stepTicket} text="Choose ticket" />
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
                      <StepLabel index={stepSession as number} text="Choose session" />
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
                    <StepLabel index={stepQuantity} text="Quantity" />
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
                    <StepLabel index={stepPurchaser} text="Purchaser details" />
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

                  {orderQuestions.length > 0 && (
                    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                      <StepLabel index={stepOrderQuestions as number} text="Booking details" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {orderQuestions.map(q => (
                          <QuestionField
                            key={q.id}
                            question={q}
                            value={orderAnswers[q.id]}
                            onChange={v => setOrderAnswers(prev => ({ ...prev, [q.id]: v }))}
                          />
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={stepAttendee} text="Attendee details" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: attendeeQuestions.length > 0 ? 14 : 12 }}>
                      {attendeeNames.map((name, i) => (
                        <div
                          key={i}
                          style={attendeeQuestions.length > 0
                            ? { border: `1px solid ${BORDER_SOFT}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }
                            : undefined}
                        >
                          <Field label={`Attendee ${i + 1}`}>
                            <input
                              required value={name}
                              onChange={e => setAttendeeNames(prev => prev.map((n, idx) => (idx === i ? e.target.value : n)))}
                              className="bb-event-input"
                            />
                          </Field>
                          {attendeeQuestions.map(q => (
                            <QuestionField
                              key={q.id}
                              question={q}
                              value={attendeeAnswers[i]?.[q.id]}
                              onChange={v => setAttendeeAnswers(prev => prev.map((a, idx) => (idx === i ? { ...a, [q.id]: v } : a)))}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </fieldset>

                  {selectedTicketType && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      borderTop: `1px solid ${BORDER_SOFT}`, paddingTop: 14, fontSize: 13,
                    }}>
                      <span style={{ color: TEXT_SECONDARY }}>
                        {isPaidSelection
                          ? `${quantity} × ${formatPrice(selectedTicketType.price_cents)}`
                          : `${quantity} ticket${quantity === 1 ? '' : 's'}`}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: isPaidSelection ? VIOLET_SOFT : GREEN }}>
                        {isPaidSelection ? `Total ${formatPrice(totalCents)}` : 'Free'}
                      </span>
                    </div>
                  )}

                  {checkoutCancelled && !error && (
                    <div role="alert" style={{
                      fontSize: 13, color: TEXT_SECONDARY, background: 'rgba(255,255,255,.03)',
                      border: `1px solid ${BORDER}`, borderRadius: 9, padding: '10px 12px', lineHeight: 1.5,
                    }}>
                      Payment was not completed.
                    </div>
                  )}

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
                    {submitting
                      ? (isPaidSelection ? 'Redirecting to payment…' : 'Confirming…')
                      : (isPaidSelection ? `Pay ${formatPrice(totalCents)}` : 'Confirm registration')}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
      {institutional && <InstitutionalFooter theme={theme} />}
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

// Phase 4B §5 — renders one registration question, for either scope
// (the caller passes the right value/onChange for ORDER vs a specific
// attendee's slot in ATTENDEE). Native HTML `required` covers every
// field type except MULTI_SELECT — see findMissingRequiredMultiSelect's
// own comment above for why that one case needs a manual pre-submit
// check instead.
function QuestionField({ question, value, onChange }: { question: PublicQuestion; value: unknown; onChange: (v: unknown) => void }) {
  const label = question.required ? question.label : `${question.label} (optional)`;
  const groupName = `q-${question.id}`;
  return (
    <Field label={label}>
      {question.help_text && <span style={{ fontSize: 11.5, color: TEXT_MUTED, fontWeight: 400 }}>{question.help_text}</span>}
      {question.field_type === 'SHORT_TEXT' && (
        <input
          required={question.required} maxLength={300} value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)} className="bb-event-input"
        />
      )}
      {question.field_type === 'LONG_TEXT' && (
        <textarea
          required={question.required} maxLength={4000} value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)} className="bb-event-input" style={{ minHeight: 72, resize: 'vertical' }}
        />
      )}
      {question.field_type === 'YES_NO' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT_PRIMARY, fontWeight: 400 }}>
            <input type="radio" required={question.required} name={groupName} checked={value === true} onChange={() => onChange(true)} /> Yes
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT_PRIMARY, fontWeight: 400 }}>
            <input type="radio" required={question.required} name={groupName} checked={value === false} onChange={() => onChange(false)} /> No
          </label>
        </div>
      )}
      {question.field_type === 'SINGLE_SELECT' && (
        <select
          required={question.required} value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value || undefined)} className="bb-event-input"
        >
          <option value="">Select…</option>
          {(question.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {question.field_type === 'MULTI_SELECT' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {(question.options ?? []).map(o => {
            const selected = Array.isArray(value) ? (value as string[]) : [];
            const checked = selected.includes(o);
            return (
              <label key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT_PRIMARY, fontWeight: 400 }}>
                <input
                  type="checkbox" checked={checked}
                  onChange={e => onChange(e.target.checked ? [...selected, o] : selected.filter(x => x !== o))}
                />
                {o}
              </label>
            );
          })}
        </div>
      )}
    </Field>
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
      background: 'rgba(255,255,255,.02)', boxShadow: '0 14px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(var(--bbpe-accent-rgb),.07)',
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
