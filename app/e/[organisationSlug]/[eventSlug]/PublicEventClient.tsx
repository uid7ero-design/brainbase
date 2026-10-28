'use client';

import { useEffect, useState } from 'react';
import { Calendar, Clock, MapPin, Users, Minus, Plus, CheckCircle2, Ticket } from 'lucide-react';
import { computeSaleStatus, SALE_STATUS_LABELS, type SaleStatus } from '@/lib/events/saleWindow';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';
import { resolvePublicEventTheme, applyAccentOverride, cssVarsFor } from '@/lib/events/publicEventTheme';
import { InstitutionalHeader, InstitutionalHero, InstitutionalFooter } from '@/components/publicEvents/InstitutionalChrome';
import { OrganisationLogo } from '@/components/organisations/OrganisationLogo';
import type { PublicEventDetail, PublicSession, PublicTicketType, PublicQuestion } from '@/lib/events/publicEventDetail';
import { computePlatformFeeCents } from '@/lib/events/feeCalculation';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

// Public event presentation (see lib/events/publicEventTheme.ts) — these
// were previously hardcoded hex/rgba literals; they are now the exact
// matching `var(--bbpe-*)` custom-property strings, set once via the
// effective `cssVars` (structural tokens + any configured
// branding.accentColor override) on this page's own root element below.
// Every existing usage of these consts throughout this file (and the
// shared EVENT_PAGE_CSS block) is therefore already theme-aware with no
// other change required — an organisation with no configured accent
// gets `cssVars` equal to these exact original values, so its rendering
// is byte-for-
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
/* Root cause of the portrait-poster crop bug: the previous rule fixed
   max-height to 560px/460px — a bound sized for landscape/banner-shaped
   artwork. Combined with width:auto;height:auto, a true portrait poster
   (aspect ratio well under 1) hit THIS height cap before it ever reached
   the column's own max-width, so it rendered far narrower than the
   column offered (e.g. ~400px in a ~540px column) — the frame's own
   background then showed as heavy letterboxing on both sides, and the
   poster read as "cut down to fit a banner." width:100%;height:auto
   removes that mismatch entirely: the image always fills its column's
   width and its height is a pure function of its own intrinsic ratio —
   no dual max-width/max-height race, no letterboxing, full artwork
   always visible for portrait, landscape, or square alike.

   Deliberately NO max-height (a prior revision of this fix used
   max-height: 85vh as a "safety valve" — that was wrong: a perfectly
   ordinary portrait poster (e.g. 1000x1400 at a ~540px column width)
   renders ~756px tall, which EXCEEDS 85vh on any desktop viewport under
   ~890px tall, silently reintroducing the exact letterboxing this fix
   exists to remove. Intrinsic aspect ratio is the sole sizing authority
   for this element; the page scrolling taller to show a tall portrait
   poster in full is correct, expected behaviour, not a bug. Existing
   upload validation (lib/events/validation.ts) already bounds file
   type/size — pathological extreme-ratio images are a separate concern,
   not one this presentation rule should trade normal posters away for.

   object-fit is also removed as redundant: it only has an effect when an
   element's box is independently constrained (e.g. by a competing
   max-height); with none here, width/height alone fully determine the
   rendered size — there is no box left for object-fit to "fit" into. */
.bb-event-artwork-img { width: 100%; height: auto; max-width: 100%; display: block; }
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
.bb-ticket-row {
  border: 1px solid ${BORDER}; background: rgba(255,255,255,.02); border-radius: 12px; padding: 13px 15px;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.bb-ticket-row.is-selected {
  border-color: rgba(var(--bbpe-accent-rgb),.55); background: rgba(var(--bbpe-accent-rgb),.08);
  box-shadow: 0 0 0 1px rgba(var(--bbpe-accent-rgb),.25) inset;
}
.bb-ticket-row.is-unavailable { opacity: .42; }
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
// Phase 2 — multi-ticket-type cart. The order total is the sum of every
// line's computeSelectionTotalCents — the same per-line formula the
// server uses (lib/events/services/cart.ts's computeCartTotalCents), so
// the displayed total always matches what Stripe charges.
export function computeCartSelectionTotalCents(lines: { price_cents: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + computeSelectionTotalCents(l.price_cents, l.quantity), 0);
}
// Mirrors lib/events/publicValidation.ts's MAX_QUANTITY: the whole
// order, across every ticket type, is capped at this many tickets.
const MAX_ORDER_TICKETS = 20;
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
//
// `hasEnded` is the server's verdict (PublicEventDetail.event.has_ended),
// never a client-side date comparison. An ended event reads a neutral
// "Event ended" — not "Tickets available", and not "Sold out", which
// would claim a capacity state the event may never have reached.
function availabilityState(ticketTypes: PublicTicketType[], hasEnded: boolean): { label: string; tone: 'ok' | 'soldout' | 'neutral' } {
  if (hasEnded) return { label: 'Event ended', tone: 'neutral' };
  if (ticketTypes.length === 0) return { label: 'Registration not currently open', tone: 'neutral' };
  // Phase 4 — only types inside their sale window count towards "available".
  // An older payload shape (no sale_status) is treated as on sale.
  const onSale = ticketTypes.filter(t => (t.sale_status ?? 'ON_SALE') === 'ON_SALE');
  if (onSale.some(t => t.remaining > 0)) return { label: 'Tickets available', tone: 'ok' };
  if (onSale.length === 0 && ticketTypes.some(t => t.sale_status === 'COMING_SOON')) return { label: 'Coming soon', tone: 'neutral' };
  if (onSale.length === 0) return { label: 'Sales ended', tone: 'neutral' };
  return { label: 'Sold out', tone: 'soldout' };
}

// Phase 4 — the server's quote for the current selection + codes (see
// app/api/public/events/[organisationSlug]/[eventSlug]/quote/route.ts).
// Display only: register/checkout re-derive every figure themselves.
type QuoteResponse = {
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string | null;
  pricing: 'FREE' | 'PAID' | null;
  lines: { ticket_type_id: string; quantity: number; gross_cents: number; discount_cents: number }[];
  promotion: { code: string } | null;
  promotion_error: string | null;
  access: { unlocked_ticket_type_ids: string[] } | null;
  access_error: string | null;
  cart_error: string | null;
  // Phase 6 — the server's read-side availability verdict for this
  // selection and session (the reservation gate's own rule, without a
  // lock). When it is not ok the server also sets cart_error, which the
  // page already shows; the detail is here for a later per-line hint.
  // Optional for an older payload shape.
  availability?: { ok: boolean; unavailable_ticket_type_ids: string[]; session_full: boolean } | null;
  // Phase 5A — the platform fee on the net ticket total and what the
  // purchaser pays; `fee` names a PASS_THROUGH fee (null when none applies
  // or the organiser absorbs it). Optional for an older payload shape.
  platform_fee_cents?: number;
  payment_total_cents?: number;
  fee?: { label: string } | null;
};
function normaliseCodeInput(value: string): string {
  return value.trim().toUpperCase();
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
  const { event, sessions, questions, branding, organisationName } = detail;
  // Phase 4 — ticket types are local state so a 409 at submit (a sale
  // window crossed, a code exhausted) can refresh their availability and
  // sale status from the server without a full page reload.
  const [ticketTypes, setTicketTypes] = useState<PublicTicketType[]>(detail.ticket_types);
  // Phase 3 — (ticket type, session) override pairs. Missing for an
  // older payload shape; treated as "no overrides".
  const sessionInventory = detail.session_inventory ?? [];
  // Phase 4 — codes. The promotional-code input is offered only when the
  // event has at least one live code (the server says whether, never
  // which); the access-code input whenever a listed type requires one.
  const hasPromotions = detail.has_promotions === true;
  const hasRestrictedTypes = ticketTypes.some(t => t.requires_access_code === true);
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [accessInput, setAccessInput] = useState('');
  const [appliedAccess, setAppliedAccess] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteFailure, setQuoteFailure] = useState<string | null>(null);
  const unlockedIds = new Set(quote?.access?.unlocked_ticket_type_ids ?? []);
  // Public event STRUCTURAL presentation (see lib/events/publicEventTheme.ts)
  // — a pure, synchronous lookup keyed only by the organisationSlug this
  // component already receives as a prop; no new query, no schema
  // change. Every organisation not in the registry gets `DEFAULT_THEME`.
  // Organisation IDENTITY (name/logo/website) and the effective accent
  // colour come from `detail.branding` (Phase 3A/3B) — this registry no
  // longer owns any of that. An organisation with no configured
  // branding.accentColor gets tokens byte-identical to this file's
  // original hardcoded palette (applyAccentOverride is a no-op when
  // accentColor is null).
  const theme = resolvePublicEventTheme(organisationSlug);
  const institutional = theme.variant === 'institutional';
  const effectiveTokens = applyAccentOverride(theme.tokens, branding.accentColor);
  const cssVars = cssVarsFor(effectiveTokens);
  // Phase 4B §5 — the two scopes always render as two separate blocks
  // (never interleaved): ORDER questions once, under "Booking details";
  // ATTENDEE questions once per attendee, under each attendee's own
  // name field. This grouping is also why QuestionsPanel's manager-side
  // reorder only swaps within a scope group — crossing the boundary
  // wouldn't change anything visible here.
  const orderQuestions = questions.filter(q => q.scope === 'ORDER');
  const attendeeQuestions = questions.filter(q => q.scope === 'ATTENDEE');

  // Phase 2 — one quantity per ticket type (a cart). Defaults to one
  // ticket of the first available type, matching the previous default
  // selection.
  const firstAvailable = ticketTypes.find(t => t.remaining > 0 && (t.sale_status ?? 'ON_SALE') === 'ON_SALE' && !t.requires_access_code);
  const [quantities, setQuantities] = useState<Record<string, number>>(firstAvailable ? { [firstAvailable.id]: 1 } : {});
  const [sessionId, setSessionId] = useState('');
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  // Attendee details are keyed by a stable per-ticket slot key
  // (`${ticketTypeId}:${index}`), so changing one ticket type's quantity
  // never shifts another type's attendee names/answers onto the wrong
  // person. orderAnswers is a single record (once per booking), keyed
  // by question id; attendeeAnswers is one record per slot key.
  const [attendeeNames, setAttendeeNames] = useState<Record<string, string>>({});
  const [orderAnswers, setOrderAnswers] = useState<Record<string, unknown>>({});
  const [attendeeAnswers, setAttendeeAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ reference: string; quantity: number; summary: string; tickets: { attendee_name: string; ticket_token: string }[]; bookingToken?: string } | null>(null);

  const selectedSession = sessions.find(s => s.id === sessionId);
  const availability = availabilityState(ticketTypes, event.has_ended === true);

  // Phase 3 — the remaining places for a ticket type depend on the
  // selected session: an override pair for (type, selected session)
  // wins; otherwise the type's event-wide remaining applies (exactly the
  // precedence the server-side reservation gate enforces). With no
  // session selected every figure is event-wide, as before.
  function remainingFor(t: PublicTicketType, forSessionId: string): number {
    if (!forSessionId) return t.remaining;
    const pair = sessionInventory.find(p => p.ticket_type_id === t.id && p.event_session_id === forSessionId);
    return pair ? pair.remaining : t.remaining;
  }
  // The ticket types as displayed for the CURRENT session selection —
  // same objects, with `remaining` resolved per the rule above.
  const displayTicketTypes = ticketTypes.map(t => (sessionId ? { ...t, remaining: remainingFor(t, sessionId) } : t));
  // Phase 4 — display state per type (lib/events/saleWindow.ts). Server
  // enforcement at submit is independent of this.
  function statusFor(t: PublicTicketType): SaleStatus {
    return computeSaleStatus(
      { sale_starts_at: t.sale_starts_at ?? null, sale_ends_at: t.sale_ends_at ?? null, requires_access_code: t.requires_access_code === true, remaining: t.remaining },
      { unlocked: unlockedIds.has(t.id) },
    );
  }

  // The cart, in ticket-type display order — only lines with quantity > 0.
  const cartLines = displayTicketTypes
    .filter(t => (quantities[t.id] ?? 0) > 0)
    .map(t => ({ ticket: t, quantity: quantities[t.id], price_cents: t.price_cents }));
  const quantity = cartLines.reduce((sum, l) => sum + l.quantity, 0);
  const isPaidSelection = cartLines.some(l => l.price_cents > 0);
  // An order is all-free or all-paid (server-enforced too — see
  // lib/events/services/cart.ts): once the cart holds one kind, the
  // other kind's steppers are disabled rather than offered and rejected.
  const cartPricing: 'FREE' | 'PAID' | null = cartLines.length === 0 ? null : isPaidSelection ? 'PAID' : 'FREE';
  // Gross cart total (every line at its listed price). Phase 4: when a
  // server quote with a discount matches this cart, `totalCents` below is
  // the quoted payable amount instead; otherwise it IS the gross total.
  const grossCents = computeCartSelectionTotalCents(cartLines);
  const cartSummary = cartLines.map(l => `${l.quantity} × ${l.ticket.name}`).join(', ');
  // One attendee slot per selected ticket, grouped by ticket type.
  const attendeeSlots = cartLines.flatMap(l =>
    Array.from({ length: l.quantity }, (_, i) => ({ key: `${l.ticket.id}:${i}`, ticketTypeId: l.ticket.id, ticketName: l.ticket.name })),
  );
  const showSlotTicketName = cartLines.length > 1;

  // `t.remaining` here is already the session-resolved figure (see
  // displayTicketTypes). The selected session's own shared remaining
  // additionally bounds the WHOLE cart — the server gate checks the
  // combined quantity against it — so the stepper stops where the
  // session would.
  function maxFor(t: PublicTicketType): number {
    if (statusFor(t) !== 'ON_SALE') return 0;
    const others = quantity - (quantities[t.id] ?? 0);
    const sessionBound = selectedSession ? selectedSession.remaining - others : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(t.remaining, MAX_ORDER_TICKETS - others, sessionBound));
  }

  // Phase 4 — server quote whenever a code is in play. Debounced; the
  // latest request wins (an earlier in-flight one is aborted). Without a
  // code nothing is fetched and the page behaves exactly as before.
  const cartKey = JSON.stringify(cartLines.map(l => [l.ticket.id, l.quantity]));
  useEffect(() => {
    // No code in play: nothing to fetch (the quote is cleared by the
    // Remove handlers themselves, never by this effect).
    if (!appliedPromo && !appliedAccess) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const items = (JSON.parse(cartKey) as [string, number][]).map(([ticket_type_id, q]) => ({ ticket_type_id, quantity: q }));
        const res = await fetch(`/api/public/events/${organisationSlug}/${eventSlug}/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items,
            event_session_id: sessionId || undefined,
            promotion_code: appliedPromo ?? undefined,
            access_code: appliedAccess ?? undefined,
          }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          setQuote(null);
          setQuoteFailure((body as { error?: string } | null)?.error ?? 'Could not check the code. Please try again.');
        } else {
          const next = body as QuoteResponse;
          setQuote(next);
          setQuoteFailure(null);
          // A restricted type the server did NOT unlock (code rejected or
          // re-scoped) drops out of the cart rather than being submitted
          // for the server gate to refuse.
          const unlocked = new Set(next.access?.unlocked_ticket_type_ids ?? []);
          setQuantities(prev => {
            let changed = false;
            const out: Record<string, number> = { ...prev };
            for (const [ttId, q] of Object.entries(prev)) {
              const t = ticketTypes.find(x => x.id === ttId);
              if (t?.requires_access_code === true && !unlocked.has(ttId) && q > 0) { out[ttId] = 0; changed = true; }
            }
            return changed ? out : prev;
          });
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setQuote(null);
        setQuoteFailure('Could not check the code. Please try again.');
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cartKey, sessionId, appliedPromo, appliedAccess, organisationSlug, eventSlug, ticketTypes]);

  function applyPromo() {
    const code = normaliseCodeInput(promoInput);
    if (!code) return;
    setAppliedPromo(code);
  }
  function removePromo() {
    setAppliedPromo(null);
    setPromoInput('');
    // With no access code left either, nothing remains to quote.
    if (!appliedAccess) { setQuote(null); setQuoteFailure(null); }
  }
  function applyAccess() {
    const code = normaliseCodeInput(accessInput);
    if (!code) return;
    setAppliedAccess(code);
  }
  function removeAccess() {
    setAppliedAccess(null);
    setAccessInput('');
    if (!appliedPromo) { setQuote(null); setQuoteFailure(null); }
    // Every restricted type is locked again — drop it from the cart.
    setQuantities(prev => {
      let changed = false;
      const out: Record<string, number> = { ...prev };
      for (const t of ticketTypes) {
        if (t.requires_access_code === true && (prev[t.id] ?? 0) > 0) { out[t.id] = 0; changed = true; }
      }
      return changed ? out : prev;
    });
  }

  // The discount is shown only from a quote that matches the CURRENT cart
  // (a debounced quote can lag a quantity change by a moment).
  const quoteFresh = quote !== null && quote.subtotal_cents === grossCents && quote.cart_error === null;
  const discountApplied = appliedPromo && quoteFresh && quote.promotion && quote.promotion.code === appliedPromo && quote.discount_cents > 0 ? quote : null;
  // The amount the purchaser will actually pay — the server-quoted total
  // when a discount applies, the gross total otherwise. This (and only
  // this) drives the CTA; the server independently re-derives it.
  const totalCents = computeCartSelectionTotalCents(cartLines) - (discountApplied?.discount_cents ?? 0);
  // Phase 5A — a PASS_THROUGH booking fee the purchaser pays. Display
  // only: computed here from the server-disclosed inputs with the SAME
  // pure rule the server snapshots (lib/events/feeCalculation.ts) so the
  // page can show it before any quote; whenever a fresh server quote
  // exists its figures win. Never shown for a free selection, and an
  // absorbed fee is never a purchaser fact (the server discloses none).
  const bookingFee = detail.booking_fee ?? null;
  const quotedFee = quoteFresh && quote ? quote : null;
  const feeCents = quotedFee
    ? (quotedFee.fee ? quotedFee.platform_fee_cents ?? 0 : 0)
    : (bookingFee && isPaidSelection && cartLines.length > 0 ? computePlatformFeeCents(totalCents, quantity, { fee_mode: 'PASS_THROUGH', ...bookingFee }) : 0);
  const feeLabel = quotedFee?.fee?.label ?? bookingFee?.label ?? 'Booking fee';
  const payableCents = quotedFee && typeof quotedFee.payment_total_cents === 'number' ? quotedFee.payment_total_cents : totalCents + feeCents;
  const codesPending = (appliedPromo !== null || appliedAccess !== null) && (quoting || (cartLines.length > 0 && !quoteFresh && quote?.cart_error == null));

  async function refreshDetail() {
    try {
      const res = await fetch(`/api/public/events/${organisationSlug}/${eventSlug}`);
      if (!res.ok) return;
      const body = (await res.json()) as PublicEventDetail;
      if (Array.isArray(body.ticket_types)) setTicketTypes(body.ticket_types);
    } catch {
      // Display refresh only — the submit error already tells the visitor what happened.
    }
  }
  function isPricingBlocked(t: PublicTicketType): boolean {
    if (!cartPricing || (quantities[t.id] ?? 0) > 0) return false;
    return cartPricing === 'PAID' ? t.price_cents === 0 : t.price_cents > 0;
  }
  function setTicketQuantity(t: PublicTicketType, next: number) {
    const clamped = Math.max(0, Math.min(maxFor(t), next));
    setQuantities(prev => ({ ...prev, [t.id]: clamped }));
  }
  // Changing session re-resolves every type's remaining; quantities the
  // new session cannot honour (its pair override, or its shared
  // capacity) are clamped down — never submitted for the gate to refuse.
  function selectSession(nextSessionId: string) {
    setSessionId(nextSessionId);
    const nextSession = sessions.find(s => s.id === nextSessionId);
    setQuantities(prev => {
      const next: Record<string, number> = {};
      let used = 0;
      for (const t of ticketTypes) {
        const wanted = prev[t.id] ?? 0;
        if (wanted <= 0) continue;
        let cap = Math.min(remainingFor(t, nextSessionId), MAX_ORDER_TICKETS - used);
        if (nextSession) cap = Math.min(cap, nextSession.remaining - used);
        const q = Math.max(0, Math.min(wanted, cap));
        if (q > 0) next[t.id] = q;
        used += q;
      }
      return next;
    });
  }

  // Running step counter (rather than hand-computed arithmetic per
  // label) so inserting/removing an optional step — sessions, booking
  // details — can never desynchronise the numbers shown elsewhere.
  let stepCounter = 1;
  const stepTicket = stepCounter++;
  const stepCodes = hasPromotions || hasRestrictedTypes ? stepCounter++ : null;
  const stepSession = sessions.length > 0 ? stepCounter++ : null;
  const stepPurchaser = stepCounter++;
  const stepOrderQuestions = orderQuestions.length > 0 ? stepCounter++ : null;
  const stepAttendee = stepCounter++;

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
    for (let i = 0; i < attendeeSlots.length; i++) {
      for (const q of attendeeQuestions) {
        if (q.field_type !== 'MULTI_SELECT' || !q.required) continue;
        const value = attendeeAnswers[attendeeSlots[i].key]?.[q.id];
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
    if (quantity === 0) { setError('Select at least one ticket.'); return; }
    setSubmitting(true);
    const paid = isPaidSelection;
    try {
      const res = await fetch(`/api/public/events/${organisationSlug}/${eventSlug}/${paid ? 'checkout' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Phase 2 cart shape — see lib/events/publicValidation.ts.
          items: cartLines.map(l => ({ ticket_type_id: l.ticket.id, quantity: l.quantity })),
          event_session_id: sessionId || undefined,
          purchaser_name: purchaserName,
          purchaser_email: purchaserEmail,
          purchaser_phone: purchaserPhone || undefined,
          attendees: attendeeSlots.map(slot => ({
            ticket_type_id: slot.ticketTypeId,
            name: attendeeNames[slot.key] ?? '',
            responses: buildResponses(attendeeQuestions, attendeeAnswers[slot.key] ?? {}),
          })),
          order_responses: buildResponses(orderQuestions, orderAnswers),
          // Phase 4 — code TEXT only. No discount, total or "unlocked"
          // flag is ever sent; the server re-derives everything.
          promotion_code: appliedPromo ?? undefined,
          access_code: appliedAccess ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `${paid ? 'Checkout' : 'Registration'} failed (${res.status}).`);
        setSubmitting(false);
        // A 409 means the server's state moved on (a sale window
        // boundary, a sold-out type, an exhausted code) — refresh the
        // availability and sale status shown rather than leave a stale page.
        if (res.status === 409) void refreshDetail();
        return;
      }
      if (paid) {
        window.location.href = body.checkout_url;
        return; // leave `submitting` true — the page is navigating away
      }
      setConfirmation({ reference: body.confirmation_reference, quantity: body.quantity, summary: cartSummary, tickets: body.tickets ?? [], bookingToken: body.booking_token ?? undefined });
      setSubmitting(false);
    } catch {
      setError(`${paid ? 'Checkout' : 'Registration'} failed. Please try again.`);
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, position: 'relative', overflowX: 'hidden', ...cssVars }}>
        <style>{EVENT_PAGE_CSS}</style>
        <div className="bb-event-glow-top" aria-hidden="true" />
        {institutional ? <InstitutionalHeader branding={branding} organisationName={organisationName} /> : <EventHeader />}
        <main className="bb-event-main" style={{ maxWidth: 560, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', border: `1px solid ${BORDER}`, borderRadius: 18, background: 'var(--bbpe-card-bg)', boxShadow: 'var(--bbpe-card-shadow)', padding: '36px 28px', textAlign: 'center' }}>
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

            <div style={{ textAlign: 'left', border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: 'var(--bbpe-section-bg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <ConfirmationRow label="Name" value={purchaserName} />
              <ConfirmationRow label="Tickets" value={`${confirmation.quantity} ticket${confirmation.quantity === 1 ? '' : 's'}${confirmation.summary ? ` · ${confirmation.summary}` : ''}`} />
              {selectedSession && <ConfirmationRow label="Session" value={selectedSession.name} />}
              <ConfirmationRow label="Date" value={`${formatDate(event.starts_at, event.timezone)} · ${formatTime(event.starts_at, event.timezone)}`} />
              {event.venue && <ConfirmationRow label="Venue" value={event.venue} />}
            </div>

            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 4 }}>Confirmation reference</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: VIOLET_SOFT, wordBreak: 'break-all' }}>{confirmation.reference}</div>
            </div>

            {confirmation.tickets.length > 1 && confirmation.bookingToken && (
              <a
                href={`/b/${confirmation.bookingToken}/tickets`} target="_blank" rel="noopener noreferrer"
                className="bb-event-cta"
                style={{ textDecoration: 'none', marginBottom: 20 }}
              >
                View all tickets →
              </a>
            )}

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
                        background: 'var(--bbpe-section-bg)', color: TEXT_PRIMARY, fontSize: 13, fontWeight: 600,
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
              Keep this confirmation reference for your records. We&rsquo;ll also send your ticket details by email — bookmark this page or save the link{confirmation.tickets.length === 1 ? '' : 's'}{' '}above in case it doesn&rsquo;t arrive.
            </p>
          </div>
        </main>
        {institutional && <InstitutionalFooter branding={branding} organisationName={organisationName} />}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, position: 'relative', overflowX: 'hidden', ...cssVars }}>
      <style>{EVENT_PAGE_CSS}</style>
      <div className="bb-event-glow-top" aria-hidden="true" />
      {institutional ? <InstitutionalHeader branding={branding} organisationName={organisationName} /> : <EventHeader />}
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
                  {/* Default-variant organisation identity — conservative
                      addition (Phase 3B). A compact, new visible row for
                      every default-variant organisation (including
                      unconfigured ones, via the initials/name fallback)
                      — flagged explicitly per this phase's own
                      instruction, not silently added. Does not replace
                      the BrainBaseWordmark/"Powered by BrainBase" header
                      above (EventHeader is untouched), and does not
                      alter the page background/body colours — only this
                      one small content-area row. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <OrganisationLogo branding={branding} organisationName={organisationName} size={28} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {branding.name ?? organisationName}
                      </div>
                      {branding.website && (
                        <a
                          href={branding.website} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11.5, fontWeight: 600, color: VIOLET_SOFT, textDecoration: 'none' }}
                        >
                          Visit website →
                        </a>
                      )}
                    </div>
                  </div>

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
                <p style={{ fontSize: 14.5, lineHeight: 1.7, color: TEXT_SECONDARY, margin: institutional ? '0 0 18px' : '0 0 22px', maxWidth: 480 }}>
                  {event.description}
                </p>
              )}

              <div data-testid="availability-badge" style={{
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
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 16, background: 'var(--bbpe-card-bg)', boxShadow: 'var(--bbpe-card-shadow)', padding: 22 }}>
              {event.has_ended ? (
                // The server's verdict (see PublicEventDetail.event.has_ended);
                // an ended event shows no booking or payment controls.
                <p data-testid="event-ended" style={{ fontSize: 14, color: TEXT_SECONDARY, margin: 0, textAlign: 'center', padding: '24px 4px' }}>
                  This event has ended.
                </p>
              ) : ticketTypes.length === 0 ? (
                <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: 0, textAlign: 'center', padding: '24px 4px' }}>
                  No tickets are currently available for this event.
                </p>
              ) : (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: institutional ? 18 : 22 }}>
                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={stepTicket} text="Choose tickets" softer={institutional} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {displayTicketTypes.map(t => (
                        <TicketQuantityRow
                          key={t.id}
                          ticket={t}
                          status={statusFor(t)}
                          quantity={quantities[t.id] ?? 0}
                          max={maxFor(t)}
                          blocked={isPricingBlocked(t)}
                          onChange={next => setTicketQuantity(t, next)}
                        />
                      ))}
                    </div>
                    {cartPricing && displayTicketTypes.some(isPricingBlocked) && (
                      <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 8 }}>
                        Free and paid tickets are booked in separate orders.
                      </div>
                    )}
                  </fieldset>

                  {stepCodes !== null && (
                    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                      <StepLabel index={stepCodes} text="Codes" softer={institutional} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {hasRestrictedTypes && (
                          <CodeField
                            label="Access code"
                            placeholder="Enter your access code"
                            value={accessInput}
                            onChange={setAccessInput}
                            applied={appliedAccess}
                            onApply={applyAccess}
                            onRemove={removeAccess}
                            actionLabel="Unlock"
                            busy={quoting && appliedAccess !== null}
                            error={appliedAccess ? quote?.access_error ?? null : null}
                            success={appliedAccess && quote?.access && !quote.access_error
                              ? `${appliedAccess} applied — ${quote.access.unlocked_ticket_type_ids.length} ticket type${quote.access.unlocked_ticket_type_ids.length === 1 ? '' : 's'} unlocked`
                              : null}
                          />
                        )}
                        {hasPromotions && (
                          <CodeField
                            label="Promotional code"
                            placeholder="Enter a promotional code"
                            value={promoInput}
                            onChange={setPromoInput}
                            applied={appliedPromo}
                            onApply={applyPromo}
                            onRemove={removePromo}
                            actionLabel="Apply"
                            busy={quoting && appliedPromo !== null}
                            error={appliedPromo && quoteFresh ? quote?.promotion_error ?? null : null}
                            success={discountApplied ? `${discountApplied.promotion!.code} applied — ${formatPrice(discountApplied.discount_cents)} off` : null}
                          />
                        )}
                        {appliedPromo && cartLines.length === 0 && (
                          <div style={{ fontSize: 12, color: TEXT_MUTED }}>Select tickets to see the discount.</div>
                        )}
                        {quote?.cart_error && (
                          <div role="alert" style={{ fontSize: 12.5, color: '#FCA5A5' }}>{quote.cart_error}</div>
                        )}
                        {quoteFailure && (
                          <div role="alert" style={{ fontSize: 12.5, color: '#FCA5A5' }}>{quoteFailure}</div>
                        )}
                      </div>
                    </fieldset>
                  )}

                  {sessions.length > 0 && (
                    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                      <StepLabel index={stepSession as number} text="Choose session" softer={institutional} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label className="bb-radio-card">
                          <input type="radio" name="event-session" value="" checked={sessionId === ''} onChange={() => selectSession('')} />
                          <div className="bb-radio-card-inner">
                            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }}>No specific session</div>
                          </div>
                        </label>
                        {sessions.map(s => (
                          <SessionOption key={s.id} session={s} timezone={event.timezone} selected={sessionId === s.id} onSelect={() => selectSession(s.id)} />
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <StepLabel index={stepPurchaser} text="Purchaser details" softer={institutional} />
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
                      <StepLabel index={stepOrderQuestions as number} text="Booking details" softer={institutional} />
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
                    <StepLabel index={stepAttendee} text="Attendee details" softer={institutional} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: attendeeQuestions.length > 0 ? 14 : 12 }}>
                      {attendeeSlots.map((slot, i) => (
                        <div
                          key={slot.key}
                          style={attendeeQuestions.length > 0
                            ? { border: `1px solid ${BORDER_SOFT}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }
                            : undefined}
                        >
                          <Field label={showSlotTicketName ? `Attendee ${i + 1} · ${slot.ticketName}` : `Attendee ${i + 1}`}>
                            <input
                              required value={attendeeNames[slot.key] ?? ''}
                              onChange={e => setAttendeeNames(prev => ({ ...prev, [slot.key]: e.target.value }))}
                              className="bb-event-input"
                            />
                          </Field>
                          {attendeeQuestions.map(q => (
                            <QuestionField
                              key={q.id}
                              question={q}
                              value={attendeeAnswers[slot.key]?.[q.id]}
                              onChange={v => setAttendeeAnswers(prev => ({ ...prev, [slot.key]: { ...(prev[slot.key] ?? {}), [q.id]: v } }))}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </fieldset>

                  {cartLines.length > 0 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      borderTop: `1px solid ${BORDER_SOFT}`, paddingTop: 14, fontSize: 13,
                    }}>
                      <span style={{ color: TEXT_SECONDARY, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {cartLines.map(l => (
                          <span key={l.ticket.id}>
                            {isPaidSelection
                              ? `${l.quantity} × ${l.ticket.name} · ${formatPrice(l.price_cents)}`
                              : `${l.quantity} × ${l.ticket.name}`}
                          </span>
                        ))}
                      </span>
                      {discountApplied ? (
                        // Phase 4 — server-quoted figures only (never computed
                        // from the code here): subtotal, discount, payable.
                        // Phase 5A — plus the pass-through booking fee, when one
                        // applies; "Total" is what the purchaser pays.
                        <span data-testid="cart-totals" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, textAlign: 'right' }}>
                          <span style={{ color: TEXT_SECONDARY }}>Subtotal {formatPrice(discountApplied.subtotal_cents)}</span>
                          <span style={{ color: GREEN }}>Discount ({discountApplied.promotion!.code}) −{formatPrice(discountApplied.discount_cents)}</span>
                          {feeCents > 0 && <span style={{ color: TEXT_SECONDARY }}>{feeLabel} {formatPrice(feeCents)}</span>}
                          <span style={{ fontWeight: 700, fontSize: 15, color: VIOLET_SOFT }}>Total {formatPrice(payableCents)}</span>
                        </span>
                      ) : isPaidSelection && feeCents > 0 ? (
                        // Phase 5A — no discount, but a pass-through booking fee:
                        // tickets, fee, total (what the purchaser pays).
                        <span data-testid="cart-totals" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, textAlign: 'right' }}>
                          <span style={{ color: TEXT_SECONDARY }}>Tickets {formatPrice(totalCents)}</span>
                          <span style={{ color: TEXT_SECONDARY }}>{feeLabel} {formatPrice(feeCents)}</span>
                          <span style={{ fontWeight: 700, fontSize: 15, color: VIOLET_SOFT }}>Total {formatPrice(payableCents)}</span>
                        </span>
                      ) : (
                        <span style={{ fontWeight: 700, fontSize: 15, color: isPaidSelection ? VIOLET_SOFT : GREEN }}>
                          {isPaidSelection ? `Total ${formatPrice(totalCents)}` : 'Free'}
                        </span>
                      )}
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

                  <button type="submit" disabled={submitting || quantity <= 0 || codesPending} className="bb-event-cta">
                    {submitting && <span className="bb-event-spin" aria-hidden="true" />}
                    {submitting
                      ? (isPaidSelection ? 'Redirecting to payment…' : 'Confirming…')
                      : (isPaidSelection ? `Pay ${formatPrice(payableCents)}` : 'Confirm registration')}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
      {institutional && <InstitutionalFooter branding={branding} organisationName={organisationName} />}
    </div>
  );
}

// `softer` (only ever passed true for the institutional theme — see call
// sites) lightens the uppercase/letter-spacing/weight treatment a touch,
// per the "step headings slightly lighter/less technical" polish ask.
// An explicit prop, not a CSS-var token, because the difference here is
// structural (font-weight/letter-spacing values, not colour) — this
// component has no closure access to `institutional` (it's declared
// outside PublicEventClient), and the default theme's own rendering
// must stay byte-for-byte unchanged when the prop is omitted/false.
function StepLabel({ index, text, softer }: { index: number; text: string; softer?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: softer ? 600 : 700, letterSpacing: softer ? '.03em' : '.06em',
      textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 10,
    }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', border: `1px solid ${BORDER}`, color: VIOLET_SOFT,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: softer ? 600 : 700,
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
// Natural-aspect-ratio rendering, no cropping, no distortion, no forced
// presentation shape: the image is `width: 100%; height: auto`
// (.bb-event-artwork-img) — it always fills the column's own width, and
// its rendered height is a pure function of its own intrinsic ratio.
// That is the entire sizing algorithm; there is no competing max-height
// constraint to race against it (a previous version paired width:auto
// with a fixed 560px/460px max-height, which bound PORTRAIT posters by
// height instead of width — rendering them dramatically narrower than
// the column and leaving heavy letterboxing on both sides, which read
// as "cropped to a banner shape"). The frame itself (border/shadow/
// rounded corners) simply wraps whatever height the image produces — no
// flex-centering needed, since the image is never narrower than its
// container. No max-height at all — intrinsic aspect ratio is the sole
// sizing authority for this element, including for tall portrait
// posters; the page scrolling taller to show one in full is correct,
// expected behaviour (see the CSS class's own comment for why an
// earlier viewport-relative "safety valve" was removed as unnecessary
// and actively wrong for ordinary portrait artwork).
function EventArtwork({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div style={{
      width: '100%', borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}`, marginBottom: 22,
      background: 'var(--bbpe-section-bg)', boxShadow: '0 14px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(var(--bbpe-accent-rgb),.07)',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onError={() => setFailed(true)} className="bb-event-artwork-img" />
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

// Phase 4 — a code input with Apply/Remove and inline feedback. Pure
// presentation: the parent owns the applied value and the server quote.
function CodeField({
  label, placeholder, value, onChange, applied, onApply, onRemove, actionLabel, busy, error, success,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; applied: string | null;
  onApply: () => void; onRemove: () => void; actionLabel: string; busy: boolean; error: string | null; success: string | null;
}) {
  const inputId = `code-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={inputId} style={{ fontSize: 12.5, color: TEXT_SECONDARY, fontWeight: 500 }}>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id={inputId}
          className="bb-event-input"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!applied) onApply(); } }}
          disabled={applied !== null}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          style={{ flex: 1 }}
        />
        {applied === null ? (
          <button type="button" onClick={onApply} disabled={!value.trim()} className="bb-event-stepper-btn" style={{ width: 'auto', padding: '0 14px', fontSize: 12.5, fontWeight: 700 }}>
            {actionLabel}
          </button>
        ) : (
          <button type="button" onClick={onRemove} className="bb-event-stepper-btn" style={{ width: 'auto', padding: '0 14px', fontSize: 12.5, fontWeight: 700 }} aria-label={`Remove ${label.toLowerCase()} ${applied}`}>
            Remove
          </button>
        )}
      </div>
      {busy && <div style={{ fontSize: 12, color: TEXT_MUTED }}>Checking…</div>}
      {!busy && error && <div role="alert" style={{ fontSize: 12.5, color: '#FCA5A5' }}>{error}</div>}
      {!busy && !error && success && <div style={{ fontSize: 12.5, color: GREEN }}>{success}</div>}
    </div>
  );
}

// Phase 2 — one quantity stepper per ticket type (a cart), replacing
// the single-choice radio card. `max` already accounts for this type's
// remaining capacity and the order-wide ticket cap; `blocked` is set
// when the cart already holds the other pricing kind (all-free or
// all-paid orders only). Phase 4 — `status` (lib/events/saleWindow.ts)
// replaces the plain sold-out check: Coming soon / Sales ended / Access
// code required types are listed but cannot be selected.
function TicketQuantityRow({
  ticket, status, quantity, max, blocked, onChange,
}: { ticket: PublicTicketType; status: SaleStatus; quantity: number; max: number; blocked: boolean; onChange: (next: number) => void }) {
  const soldOut = status === 'SOLD_OUT';
  const notOnSale = status !== 'ON_SALE';
  const unavailable = notOnSale || blocked;
  return (
    <div className={`bb-ticket-row${quantity > 0 ? ' is-selected' : ''}${unavailable && quantity === 0 ? ' is-unavailable' : ''}`} data-sale-status={status}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_PRIMARY }}>{ticket.name}</div>
          {ticket.description && <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 3 }}>{ticket.description}</div>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: ticket.price_cents === 0 ? GREEN : VIOLET_SOFT, whiteSpace: 'nowrap' }}>
          {formatPrice(ticket.price_cents)}
        </div>
      </div>
      <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: soldOut ? RED : TEXT_MUTED }}>
          {notOnSale ? SALE_STATUS_LABELS[status] : formatPlacesRemaining(ticket.remaining)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button" aria-label={`Decrease ${ticket.name} quantity`} className="bb-event-stepper-btn"
            disabled={quantity <= 0}
            onClick={() => onChange(quantity - 1)}
          >
            <Minus size={14} />
          </button>
          <span aria-label={`${ticket.name} quantity`} aria-live="polite" style={{ minWidth: 20, textAlign: 'center', fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY }}>
            {quantity}
          </span>
          <button
            type="button" aria-label={`Increase ${ticket.name} quantity`} className="bb-event-stepper-btn"
            disabled={unavailable || quantity >= max}
            onClick={() => onChange(quantity + 1)}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
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
