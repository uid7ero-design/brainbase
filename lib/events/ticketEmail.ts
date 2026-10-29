import 'server-only';
import { sendEmail, EmailSendError, emailLayout, escHtml } from '@/lib/email';
import { buildTicketUrl } from '@/lib/events/qr';
import type { TicketEmailBranding } from '@/lib/organisations/branding';
import { brainbaseBuyerContext, type BuyerProductContext } from '@/lib/events/buyerProduct';
import { renderPaymentReceiptHtml, type PaymentReceipt } from '@/lib/events/receipt';
import { formatEventSchedule } from '@ticketing/core/eventSchedule';

export { isOrderEligibleForTicketEmail, type TicketEmailEligibilityOrder } from './ticketEmailEligibility';

// Phase 7 §3 — "Resend ticket email". Pure template construction
// (buildTicketEmail) is kept separate from the provider side effect
// (sendTicketEmail) so the template can be unit-tested without ever
// touching the network, matching this module's own dev-fallback
// discipline in lib/email.ts.
//
// Input is server-derived domain data only (event name, purchaser
// name, attendee name + EXISTING ticket token pairs) — never a raw
// request body. Deliberately excludes everything not listed here:
// registration-question answers (event_registration_responses),
// internal staff notes (event_order_notes), Stripe ids, CRM ids, or
// any other internal/provider metadata. Every attendee/purchaser name
// is escaped via lib/email.ts's own escHtml() — the same convention
// every other Brainbase email already uses.
export type TicketEmailAttendee = {
  name: string;
  // The existing, already-issued token (lib/events/ticketToken.ts) —
  // this module never generates one. Reused verbatim so a previously
  // shared/bookmarked ticket link keeps working.
  ticketToken: string;
};

export type TicketEmailData = {
  eventName: string;
  purchaserName: string;
  attendees: TicketEmailAttendee[];
  // Booking wallet — the order's event_orders.booking_token, READ only
  // (never generated here or by any caller of buildTicketEmail/
  // sendTicketEmail — see the resend route's own comment). Optional and
  // independently nullable from `attendees`: a historical multi-
  // attendee order that predates this feature and has not yet been
  // backfilled legitimately has no booking_token at all, and this
  // function must degrade safely rather than emit a broken link — see
  // buildBookingWalletUrl's only call site below.
  bookingToken?: string | null;
  // Phase 3D — organisation presentation only, resolved server-side by
  // the caller (the resend route) from the order's own already-trusted
  // organisation_id, exactly like /t and /b's own branding threading
  // (Phase 3C). Optional/nullable: an absent or all-null value renders
  // exactly as before this phase (see buildTicketEmail's own use of it
  // below) — no organisation is ever REQUIRED to configure branding for
  // this email to render safely.
  branding?: TicketEmailBranding | null;
  // Phase 5A — the neutral payment summary for a PAID order (see
  // lib/events/receipt.ts): factual figures only — tickets, discount,
  // pass-through booking fee, total paid, payment date — and never a tax
  // claim. Optional/nullable: a free order, a historical row, or a caller
  // that supplies none renders the exact email it always has.
  receipt?: PaymentReceipt | null;
  // Eve Phase 3.2 — the buyer-facing product identity of the order, resolved
  // by the caller from event_orders.product_surface (resolveBuyerProduct).
  // Absent => BrainBase, exactly as before. Callers that hold an order row
  // MUST pass it: an Eve order built without it would carry BrainBase links.
  product?: BuyerProductContext | null;
  // When and where, read by the caller from the order's own events row and
  // rendered in the event's stored timezone (formatEventSchedule). Shown on
  // Eve emails only: BrainBase ticket emails stay exactly as they were.
  // Optional/nullable: absent renders no details section.
  event?: TicketEmailEventDetails | null;
};

export type TicketEmailEventDetails = {
  startsAt: string | Date;
  endsAt: string | Date | null;
  timezone: string;
  venue: string | null;
};

// Eve "when and where" block. Every line is escaped; a blank venue is
// omitted, and an event spanning two local dates shows both ends in full.
function renderEventDetailsHtml(event: TicketEmailEventDetails): string {
  const schedule = formatEventSchedule(event.startsAt, event.endsAt, event.timezone);
  if (!schedule) return '';
  const lines = schedule.kind === 'single'
    ? [
        `<div style="font-size:14px;font-weight:600;color:#111">${escHtml(schedule.date)}</div>`,
        `<div style="font-size:14px;color:#444;margin-top:2px">${escHtml(schedule.time)}</div>`,
      ]
    : [
        `<div style="font-size:14px;color:#111"><strong>Starts</strong> ${escHtml(schedule.start)}</div>`,
        `<div style="font-size:14px;color:#111;margin-top:2px"><strong>Ends</strong> ${escHtml(schedule.end)}</div>`,
      ];
  const venue = event.venue?.trim();
  if (venue) lines.push(`<div style="font-size:14px;color:#444;margin-top:6px">${escHtml(venue)}</div>`);
  return `
      <div style="margin:0 0 24px;padding:14px 16px;background:#f7f7f7;border-radius:8px;line-height:1.5">
        ${lines.join('\n        ')}
      </div>`;
}

// Booking-wallet link shape (/b/<bookingToken>/tickets) — deliberately
// NOT in lib/events/qr.ts alongside buildTicketUrl: that module's own
// tests assert its QR payload is built from the ticket URL ONLY (see
// lib/events/qr.ts's own comment and its containment test "encodes only
// the ticket URL, no PII") — a booking-wallet link must never be
// QR-encoded (see this feature's own §K "QR semantics" invariant), so
// keeping its URL-building helper out of the QR-adjacent module is a
// small, deliberate boundary, not an oversight.
function buildBookingWalletUrl(origin: string, bookingToken: string): string {
  return `${origin}/b/${bookingToken}/tickets`;
}

// Local to this file, deliberately NOT exported alongside/instead of
// lib/email.ts's own shared `btnStyle` — that constant is used
// unconditionally by verificationEmail/passwordResetEmail/
// webServiceLeadEmail and must never vary by organisation (§17: shared
// emails must not change). This mirrors btnStyle's exact structure,
// substituting only the background colour, and falls back to the
// identical '#7C3AED' when no accent is configured — pixel-identical
// to the previous hardcoded btnStyle usage in that case.
function ticketBtnStyle(accentColor: string | null): string {
  return [
    'display:inline-block',
    'padding:12px 28px',
    `background:${accentColor ?? '#7C3AED'}`,
    'color:#fff',
    'text-decoration:none',
    'border-radius:8px',
    'font-size:14px',
    'font-weight:600',
    'letter-spacing:0.02em',
  ].join(';');
}

export function buildTicketEmail(data: TicketEmailData): { subject: string; html: string } {
  const multiple = data.attendees.length > 1;
  // Primary "View all tickets" CTA only for a genuinely multi-attendee
  // order that actually has a booking_token — a single-attendee order
  // is never routed through the wallet at all (no benefit, one extra
  // tap for zero benefit), and a multi-attendee order missing a
  // booking_token (a historical order that hasn't been backfilled)
  // degrades safely to exactly today's individual-links-only email
  // rather than emitting a broken/empty CTA link.
  const showWalletCta = multiple && !!data.bookingToken;
  const product = data.product ?? brainbaseBuyerContext();
  const walletUrl = showWalletCta ? buildBookingWalletUrl(product.linkBase, data.bookingToken as string) : null;

  // Phase 3D — presentation only. accentColor substitutes only the CTA
  // background + a thin divider line; nothing else in this template
  // reads it. The organisation identity row/footer render ONLY when
  // branding.name/emailFooter are themselves configured — an
  // unconfigured organisation (branding absent or every field null)
  // gets a byte-identical email to before this phase, never a fallback
  // to the raw DB organisation name here (deliberately more
  // conservative than /t or /b's own header, which already shows a DB-
  // name fallback: an email is a one-shot, unreviewable send to a
  // purchaser's inbox, not a page a manager can immediately reload and
  // fix — see this phase's own final report for the full rationale).
  const branding = data.branding ?? null;
  const accent = branding?.accentColor ?? null;
  const ticketBtn = ticketBtnStyle(accent);
  const dividerColor = accent ?? '#f0f0f0';

  const ticketRows = data.attendees.map(a => {
    // Ticket URL shape /t/<existing-token>, built via the same
    // buildTicketUrl() already used by the live ticket page
    // (app/t/[token]/page.tsx) — combined here with lib/email.ts's own
    // NEXT_PUBLIC_APP_URL-based BASE_URL rather than a request-derived
    // origin, since an email outlives the request that triggered it
    // and must use the same stable, configured base URL every other
    // Brainbase email link already uses.
    const url = buildTicketUrl(product.linkBase, a.ticketToken);
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f0f0f0">
          <div style="font-size:13px;font-weight:600;color:#222;margin-bottom:10px">${escHtml(a.name)}</div>
          <a href="${url}" style="${ticketBtn};padding:9px 20px;font-size:13px">View ticket</a>
        </td>
      </tr>
    `;
  }).join('');

  return {
    subject: `Your ticket${multiple ? 's' : ''} for ${data.eventName}`,
    html: emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(data.purchaserName)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Here ${multiple ? 'are your tickets' : 'is your ticket'} for <strong>${escHtml(data.eventName)}</strong>.
        Tap the link below to view ${multiple ? 'each ticket' : 'your ticket'} — it's what you'll show at the door.
      </p>
      ${product.surface === 'EVE' && data.event ? renderEventDetailsHtml(data.event) : ''}
      ${walletUrl ? `
      <p style="margin:0 0 20px">
        <a href="${walletUrl}" style="${ticketBtn};padding:12px 26px;font-size:14px">View all tickets</a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.04em">Individual tickets</p>
      ` : ''}
      <div style="margin:0 0 18px;border-top:1px solid ${dividerColor}"></div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px">
        ${ticketRows}
      </table>
      ${data.receipt ? renderPaymentReceiptHtml(data.receipt, escHtml) : ''}
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        Keep this email — you can use it to find your ticket link${multiple ? 's' : ''} again at any time.
      </p>
      ${product.surface === 'EVE' ? `<p style="margin:8px 0 0;font-size:12px;color:#888;line-height:1.5">Anyone with ${multiple ? 'these links' : 'this link'} can access ${multiple ? 'these tickets' : 'this ticket'}. Keep ${multiple ? 'them' : 'it'} private.</p>` : ''}
    `, {
      name: branding?.name ?? null,
      logoUrl: branding?.logoUrl ?? null,
      website: branding?.website ?? null,
      footerText: branding?.emailFooter ?? null,
    }, product.presentation),
  };
}

export type TicketEmailSendResult =
  | { result: 'sent'; providerMessageId: string | null }
  // idempotencyPayloadMismatch is Phase 3E.1: OPTIONAL and only ever
  // `true` when the caller supplied an idempotencyKey (the not-yet-
  // wired automatic delivery path — the EXISTING manual resend route
  // below never passes one, so this flag is structurally unreachable
  // from manual resend and that call site's existing `result ===
  // 'failed'` handling is completely unaffected by its addition).
  // Deliberately kept as a FLAG on the existing 'failed' variant,
  // rather than a new top-level `result` value: the manual resend
  // route's own control flow narrows TicketEmailSendResult by checking
  // 'not_configured' / 'failed' / 'unknown' and treats anything else as
  // success — a new top-level discriminant would silently fall through
  // that route's own logic as a false "sent". Resend reported that this
  // exact idempotency key was already used with a DIFFERENT request
  // payload — a caller must never respond to this by minting a new
  // idempotency key just to force another send; see
  // lib/events/ticketEmailDelivery.ts's
  // buildInitialTicketEmailIdempotencyKey and markTicketEmailFailed for
  // the full payload-stability rule and why this outcome is terminal
  // for automatic delivery (a manager's own manual resend, which never
  // uses this key at all, is the only way to recover).
  | { result: 'failed'; error: string; idempotencyPayloadMismatch?: true }
  // Case C — the provider call itself threw something other than the
  // definite "Resend rejected the request" error below (e.g. a network
  // timeout or connection reset): we genuinely do not know whether the
  // email was sent. No automatic retry is attempted for this result —
  // that decision belongs to whoever calls sendTicketEmail().
  | { result: 'unknown'; error: string }
  // Pre-push hardening — RESEND_API_KEY is absent (common in Preview
  // environments). sendEmail()'s dev fallback only console-logs; NO
  // network request is made and NOTHING was sent to the purchaser. This
  // must never be reported as 'sent' — a Preview manager clicking
  // resend must never see a false "Sent" state.
  | { result: 'not_configured' };

// Provider side effect. Distinguishes:
//   - Case A (failed):        sendEmail() throws an EmailSendError (or
//     any other Error with message 'Email send failed') after a non-ok
//     HTTP response from Resend — a DEFINITE provider rejection.
//     idempotencyPayloadMismatch is set to true on this SAME 'failed'
//     result only when the EmailSendError's providerErrorCode is
//     Resend's own 'invalid_idempotent_request' (only possible when an
//     idempotencyKey was supplied).
//   - Case C (unknown):       sendEmail() throws anything else (e.g.
//     the fetch() itself never completing) — an AMBIGUOUS outcome.
//   - not_configured:         sendEmail() resolves with status
//     'not_configured' — RESEND_API_KEY is absent, nothing was sent.
//   - Case B (sent):          sendEmail() resolves with status 'sent'
//     — Resend genuinely returned a 2xx response for this call.
// None of this modifies sendEmail()'s own behaviour, which is shared
// by unrelated auth/lead-notification emails (see lib/email.ts's own
// SendEmailResult doc comment).
//
// options.idempotencyKey is OPTIONAL and additive — the EXISTING manual
// resend route (app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts)
// calls sendTicketEmail(recipient, data) with no third argument and is
// completely unaffected; only a future automatic-delivery caller
// (lib/events/ticketEmailDelivery.ts's consumer — not built in this
// phase) would ever pass one.
export async function sendTicketEmail(
  to: string,
  data: TicketEmailData,
  options?: { idempotencyKey?: string },
): Promise<TicketEmailSendResult> {
  const { subject, html } = buildTicketEmail(data);
  try {
    const product = data.product ?? null;
    const sent = await sendEmail({
      to, subject, html, idempotencyKey: options?.idempotencyKey,
      ...(product?.from ? { from: product.from } : {}),
      ...(product?.replyTo ? { replyTo: product.replyTo } : {}),
    });
    if (sent.status === 'not_configured') {
      return { result: 'not_configured' };
    }
    return { result: 'sent', providerMessageId: sent.id };
  } catch (err) {
    if (err instanceof EmailSendError && err.providerErrorCode === 'invalid_idempotent_request') {
      return {
        result: 'failed',
        error: 'The email provider reported this request no longer matches a previous attempt.',
        idempotencyPayloadMismatch: true,
      };
    }
    if (err instanceof Error && err.message === 'Email send failed') {
      return { result: 'failed', error: 'The email provider rejected the request.' };
    }
    console.error('[events] ticket email: ambiguous provider outcome', err);
    return { result: 'unknown', error: 'The email provider did not return a definite result.' };
  }
}

// Phase 7 §9 — audit_logs never stores the full recipient address.
// Masks everything before the '@' except the first character, e.g.
// "jane@example.com" -> "j***@example.com".
export function maskEmailForAudit(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
