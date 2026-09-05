import 'server-only';
import { sendEmail, emailLayout, escHtml, btnStyle, BASE_URL } from '@/lib/email';
import { buildTicketUrl } from '@/lib/events/qr';

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
};

export function buildTicketEmail(data: TicketEmailData): { subject: string; html: string } {
  const multiple = data.attendees.length > 1;

  const ticketRows = data.attendees.map(a => {
    // Ticket URL shape /t/<existing-token>, built via the same
    // buildTicketUrl() already used by the live ticket page
    // (app/t/[token]/page.tsx) — combined here with lib/email.ts's own
    // NEXT_PUBLIC_APP_URL-based BASE_URL rather than a request-derived
    // origin, since an email outlives the request that triggered it
    // and must use the same stable, configured base URL every other
    // Brainbase email link already uses.
    const url = buildTicketUrl(BASE_URL, a.ticketToken);
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f0f0f0">
          <div style="font-size:13px;font-weight:600;color:#222;margin-bottom:10px">${escHtml(a.name)}</div>
          <a href="${url}" style="${btnStyle};padding:9px 20px;font-size:13px">View ticket</a>
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
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px">
        ${ticketRows}
      </table>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        Keep this email — you can use it to find your ticket link again at any time.
      </p>
    `),
  };
}

export type TicketEmailSendResult =
  | { result: 'sent'; providerMessageId: string | null }
  | { result: 'failed'; error: string }
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
//   - Case A (failed):        sendEmail() throws its own 'Email send
//     failed' Error after getting a non-ok HTTP response from Resend —
//     a DEFINITE provider rejection.
//   - Case C (unknown):       sendEmail() throws anything else (e.g.
//     the fetch() itself never completing) — an AMBIGUOUS outcome.
//   - not_configured:         sendEmail() resolves with status
//     'not_configured' — RESEND_API_KEY is absent, nothing was sent.
//   - Case B (sent):          sendEmail() resolves with status 'sent'
//     — Resend genuinely returned a 2xx response for this call.
// None of this modifies sendEmail()'s own behaviour, which is shared
// by unrelated auth/lead-notification emails (see lib/email.ts's own
// SendEmailResult doc comment).
export async function sendTicketEmail(to: string, data: TicketEmailData): Promise<TicketEmailSendResult> {
  const { subject, html } = buildTicketEmail(data);
  try {
    const sent = await sendEmail({ to, subject, html });
    if (sent.status === 'not_configured') {
      return { result: 'not_configured' };
    }
    return { result: 'sent', providerMessageId: sent.id };
  } catch (err) {
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
