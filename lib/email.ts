import 'server-only';

export interface EmailAttachment {
  filename: string;
  // base64-encoded file content, no "data:...;base64," prefix — matches
  // Resend's own REST API attachment shape
  // (https://resend.com/docs/api-reference/emails/send-email).
  contentBase64: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  // Phase C3-POLISH-R — added for lib/commercial/quoteEmail.ts's quote
  // PDF attachment. Optional and additive: every existing caller (auth
  // verification, password reset, admin user invite, web-services lead
  // notification, ticket email) omits it and is completely unaffected.
  attachments?: EmailAttachment[];
  // Phase 3E.1 — added for the (not-yet-wired, see
  // lib/events/ticketEmailDelivery.ts) automatic ticket-email delivery
  // path only. Optional and additive: every existing caller (auth,
  // lead notification, the EXISTING manual ticket-email resend route)
  // omits it and is completely unaffected — sendEmail() only adds the
  // Idempotency-Key header when this is present. Forwarded verbatim to
  // Resend's REST API, which documents idempotency keys as retained
  // for 24 hours and bound to the exact request payload (see
  // buildInitialTicketEmailIdempotencyKey's own comment in
  // ticketEmailDelivery.ts for the full payload-stability rule this
  // implies) — callers must never rotate a key merely to force another
  // send.
  idempotencyKey?: string;
}

const FROM = process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>';

// Return type widened (Phase 7) from Promise<void> to
// Promise<SendEmailResult> so a caller that needs to know whether an
// email was ACTUALLY accepted by Resend (the ticket-email resend
// feature — see lib/events/ticketEmail.ts) can tell that apart from
// the no-RESEND_API_KEY dev fallback below, which previously returned
// an indistinguishable-looking `{ id: null }` on success. Every
// existing caller (auth verification, password reset, admin user
// invite, web-services lead notification) already does `await
// sendEmail(...)` and discards the return value entirely, so none of
// them are affected by this widening — their dev-mode console fallback
// is completely unchanged.
//
// status is 'sent' only when Resend returned a 2xx response for this
// specific call; 'not_configured' means RESEND_API_KEY is absent and
// nothing was sent anywhere — the console log below is a LOCAL
// development convenience, never proof of delivery. A definite
// provider rejection (non-2xx) still throws Error('Email send
// failed'), and a network-level exception (timeout, DNS failure, the
// fetch() itself never completing) still propagates as whatever error
// fetch() throws — both unchanged from before this widening. Callers
// that need to distinguish "provider rejected" from "ambiguous network
// outcome" must inspect the thrown error themselves (see
// lib/events/ticketEmail.ts's sendTicketEmail()).
export type SendEmailResult =
  | { status: 'sent'; id: string | null }
  | { status: 'not_configured'; id: null };

// Thrown for a definite (non-2xx) provider rejection. Extends Error and
// keeps message === 'Email send failed' EXACTLY as before this phase
// (lib/events/ticketEmail.ts's sendTicketEmail() already branches on
// that literal message for its existing 'failed' Case A — this must
// keep working unchanged for the manual-resend path). providerErrorCode
// is additive: Resend's own REST API error body shape is
// { message, statusCode, name } (name is the machine-readable error
// code, e.g. 'invalid_idempotent_request' — confirmed from the
// installed `resend` SDK's own type definitions, which describe the
// identical REST response this file's raw fetch() call receives).
// Automatic-delivery callers (only, via ticketEmailDelivery.ts) inspect
// this field to classify a provider idempotency-payload mismatch
// specifically; every other existing caller only ever checks
// `err.message`, exactly as before.
export class EmailSendError extends Error {
  status: number;
  providerErrorCode: string | null;
  constructor(status: number, providerErrorCode: string | null) {
    super('Email send failed');
    this.name = 'EmailSendError';
    this.status = status;
    this.providerErrorCode = providerErrorCode;
  }
}

export async function sendEmail({ to, subject, html, attachments, idempotencyKey }: EmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Dev fallback — print to console. NOT a send: no network request
    // is made at all, so this must never be reported to a caller as
    // 'sent'.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    console.log('\n── EMAIL (no RESEND_API_KEY) ─────────────────────');
    console.log(`TO:      ${to}`);
    console.log(`SUBJECT: ${subject}`);
    if (attachments?.length) console.log(`ATTACHMENTS: ${attachments.map(a => a.filename).join(', ')}`);
    console.log(text.slice(0, 600));
    console.log('──────────────────────────────────────────────────\n');
    return { status: 'not_configured', id: null };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: FROM,
      to,
      subject,
      html,
      ...(attachments?.length
        ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.contentBase64 })) }
        : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[email] Resend ${res.status}:`, err);
    let providerErrorCode: string | null = null;
    try {
      providerErrorCode = (JSON.parse(err) as { name?: string } | null)?.name ?? null;
    } catch {
      // Non-JSON error body — providerErrorCode stays null, caller
      // falls back to its generic "provider rejected" classification.
    }
    throw new EmailSendError(res.status, providerErrorCode);
  }

  const body = await res.json().catch(() => null) as { id?: string } | null;
  return { status: 'sent', id: body?.id ?? null };
}

// Exported (Phase 7) so lib/events/ticketEmail.ts can build its ticket
// links from the exact same base-URL convention every other email in
// this file already uses, rather than re-deriving
// process.env.NEXT_PUBLIC_APP_URL itself and risking the two
// expressions drifting apart.
export const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export function verificationEmail(name: string, token: string) {
  const link = `${BASE_URL}/api/auth/verify-email?token=${token}`;
  return {
    subject: 'Verify your Brainbase email',
    html: emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(name)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Your Brainbase account has been created. Click the button below to verify
        your email address and activate your account.
      </p>
      <a href="${link}" style="${btnStyle}">Verify email address</a>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        This link expires in 24 hours. If you didn't expect this email, ignore it.
      </p>
    `),
  };
}

export function passwordResetEmail(name: string, token: string) {
  const link = `${BASE_URL}/reset-password?token=${token}`;
  return {
    subject: 'Reset your Brainbase password',
    html: emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(name)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        We received a request to reset your password. Click below to choose a new one.
      </p>
      <a href="${link}" style="${btnStyle}">Reset password</a>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.
      </p>
    `),
  };
}

// ── Web Service Lead notification ────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  website_design: 'Website Design & Development',
  ai_website:     'AI-Powered Website',
  maintenance:    'Management & Maintenance',
  integrations:   'Business System Integrations',
};

const BUDGET_LABELS: Record<string, string> = {
  under_2500:   'Under $2,500',
  '2500_5000':  '$2,500 – $5,000',
  '5000_10000': '$5,000 – $10,000',
  '10000_20000':'$10,000 – $20,000',
  '20000_plus': '$20,000+',
  unsure:       'Not sure yet',
};

export function webServiceLeadEmail(lead: {
  id: string;
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  serviceInterest: string[];
  budgetRange: string;
  projectDesc: string;
}) {
  const adminUrl = `${BASE_URL}/admin/web-services`;
  const services = lead.serviceInterest.map(s => SERVICE_LABELS[s] ?? s).join(', ') || '—';
  const budget   = (BUDGET_LABELS[lead.budgetRange] ?? lead.budgetRange) || '—';

  return {
    subject: `New Website Systems Lead — ${escHtml(lead.fullName)}${lead.businessName ? ` · ${escHtml(lead.businessName)}` : ''}`,
    html: emailLayout(`
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111">New Website Systems Enquiry</h2>
      <p style="margin:0 0 24px;font-size:13px;color:#888">Submitted via BrainBase Website Systems</p>

      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px">
        ${detailRow('Name',     escHtml(lead.fullName))}
        ${detailRow('Business', lead.businessName ? escHtml(lead.businessName) : '—')}
        ${detailRow('Email',    `<a href="mailto:${escHtml(lead.email)}" style="color:#7C3AED">${escHtml(lead.email)}</a>`)}
        ${detailRow('Phone',    lead.phone ? escHtml(lead.phone) : '—')}
        ${detailRow('Services', services)}
        ${detailRow('Budget',   budget)}
      </table>

      ${lead.projectDesc ? `
        <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:0 0 24px;border:1px solid #e4e4e7">
          <div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Project Goals</div>
          <p style="margin:0;color:#333;font-size:14px;line-height:1.6">${escHtml(lead.projectDesc)}</p>
        </div>
      ` : ''}

      <a href="${adminUrl}" style="${btnStyle}">View Lead in Admin →</a>
      <p style="margin:20px 0 0;font-size:12px;color:#aaa">Lead ID: ${lead.id}</p>
    `),
  };
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:7px 0;color:#888;width:90px;vertical-align:top;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${label}</td>
      <td style="padding:7px 0 7px 16px;color:#222;border-bottom:1px solid #f0f0f0">${value}</td>
    </tr>
  `;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// btnStyle/escHtml/emailLayout exported (Phase 7) so
// lib/events/ticketEmail.ts's ticket email reuses the exact same
// button styling, escaping convention, and BrainBase layout shell as
// every other email here, rather than a second copy of any of them.
export const btnStyle = [
  'display:inline-block',
  'padding:12px 28px',
  'background:#7C3AED',
  'color:#fff',
  'text-decoration:none',
  'border-radius:8px',
  'font-size:14px',
  'font-weight:600',
  'letter-spacing:0.02em',
].join(';');

// Escapes &, <, >, ", ' — safe for both HTML text content (where the
// quote entities are simply harmless/inert) and HTML attribute values
// (href="...", src="...") alike, which Phase 3D's org-branding
// presentation (website links, logo src) is the first caller in this
// file to actually need. Every existing caller already only used this
// for text content, so widening it is purely additive — no existing
// output changes shape, only quote characters (rare in names/emails)
// now render as entities instead of literal quotes.
export function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Phase 3D — optional organisation-presentation hook. Every existing
// caller (verificationEmail, passwordResetEmail, webServiceLeadEmail,
// and any future one that doesn't pass this) omits the second
// argument entirely, so `org` is undefined and every expression below
// that depends on it evaluates to the empty string — the returned HTML
// is byte-identical to this function's pre-3D output. Only
// lib/events/ticketEmail.ts passes a populated object. Deliberately
// does NOT accept accentColor: the CTA-button/divider accent is
// ticket-email body content (built by buildTicketEmail itself, using
// its own local button-style helper), never part of this shared
// shell — keeping this function's own change surface to "header
// identity" and "pre-footer text" only.
export interface EmailOrgPresentation {
  name?: string | null;
  logoUrl?: string | null;
  website?: string | null;
  footerText?: string | null;
}

export function emailLayout(body: string, org?: EmailOrgPresentation | null) {
  // Identity row directly below the BrainBase wordmark — never
  // replacing it (§7's own "do not replace BrainBase attribution
  // entirely"). Logo, if present, is a small inline glyph only; no
  // OrganisationLogo-style initials fallback here (§7: "omission is
  // acceptable" when no logo is configured — an email client is not
  // the right place to reproduce that component's own contain/backing
  // plate logic).
  const orgIdentity = org?.name ? `
          <div style="margin-top:8px;font-size:12px;color:#9CA3AF">
            ${org.logoUrl ? `<img src="${escHtml(org.logoUrl)}" alt="${escHtml(org.name)}" style="height:16px;width:auto;max-width:120px;vertical-align:middle;margin-right:6px;border-radius:3px" />` : ''}<span style="vertical-align:middle">${escHtml(org.name)}</span>${org.website ? ` · <a href="${escHtml(org.website)}" style="color:#9CA3AF;text-decoration:underline">${escHtml(org.website.replace(/^https?:\/\//i, ''))}</a>` : ''}
          </div>` : '';

  const orgFooter = org?.footerText ? `<div style="margin:0 0 8px;color:#666">${escHtml(org.footerText)}</div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="padding:24px 32px;background:#08090C;border-bottom:1px solid #1c1c2e">
          <span style="font-size:18px;font-weight:700;letter-spacing:.1em;color:#f4f4f5">
            BRAINB<span style="color:#A78BFA">Λ</span>SE
          </span>${orgIdentity}
        </td></tr>
        <tr><td style="padding:36px 32px">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#aaa">
          ${orgFooter}© ${new Date().getFullYear()} Brainbase · Adelaide SA Australia
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
