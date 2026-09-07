import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sendEmail, escHtml, BASE_URL } from '@/lib/email';
import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';
import { buildQuotePdf, type QuotePdfQuote, type QuotePdfLine, type QuotePdfSupplier } from './quotePdf';

// Phase C3-POLISH-R §6/§7 — quote email delivery. Modeled directly on
// lib/events/ticketEmail.ts's own shape (buildX() pure template kept
// separate from sendX() provider side effect; the same
// sent/failed/unknown/not_configured result taxonomy) — that module's
// own header comment explains exactly why each outcome is distinguished,
// and the same reasoning applies verbatim here, so it is not repeated.

let cachedBrandLockupBase64: string | null = null;

// Server-side loader for the rasterized Hybrid Orbit icon+wordmark
// lockup PNG (see lib/commercial/quotePdf.ts's own header for why the
// PNG exists, why it's the full lockup and not the icon alone, and why
// it — not the source SVG — is what gets embedded). Reads from disk
// once per server instance and memoizes; the file is a small, static,
// committed repository asset, never user-controlled input.
async function loadBrandLockupBase64Server(): Promise<string> {
  if (cachedBrandLockupBase64) return cachedBrandLockupBase64;
  const filePath = path.join(process.cwd(), 'public', 'Brand', 'brainbase-horizontal-color-284.png');
  const buf = await fs.readFile(filePath);
  cachedBrandLockupBase64 = buf.toString('base64');
  return cachedBrandLockupBase64;
}

export interface QuoteEmailData {
  quoteNumber: string;
  customerName: string;
  totalCents: number;
  currency: string;
  // Phase C3-EMAIL-FIX — see lib/commercial/quotePdf.ts's QuotePdfQuote
  // for why this accepts a Date as well as a string.
  expiryDate: string | Date | null;
  businessDisplayName: string;
  businessEmail: string | null;
  businessPhone: string | null;
}

export function buildQuoteEmail(data: QuoteEmailData): { subject: string; html: string } {
  const expiry = formatCommercialDate(data.expiryDate);
  return {
    subject: `Quote ${data.quoteNumber} from ${data.businessDisplayName}`,
    html: commercialEmailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(data.customerName)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Please find attached your quote from <strong>${escHtml(data.businessDisplayName)}</strong>.
        The details are summarised below.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px">
        ${emailDetailRow('Quote number', escHtml(data.quoteNumber))}
        ${emailDetailRow('Total', formatMoneyCents(data.totalCents, data.currency))}
        ${data.expiryDate ? emailDetailRow('Valid until', expiry) : ''}
      </table>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        If you have any questions about this quote, please reply to this email${data.businessPhone ? ` or call us on ${escHtml(data.businessPhone)}` : ''}.
      </p>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        Sent by ${escHtml(data.businessDisplayName)}${data.businessEmail ? ` · ${escHtml(data.businessEmail)}` : ''} via BrainBase Commercial.
      </p>
    `),
  };
}

// Phase C3-FINAL-POLISH — a Commercial-only email shell, deliberately
// NOT lib/email.ts's shared emailLayout(). That function's header
// reconstructs "BRAINBΛSE" as literal HTML text with a Unicode Greek
// lambda character in a <span> — harmless for the many unrelated
// callers that already use it (auth verification, password reset,
// admin user invite, web-service lead notification, events ticket
// email), none of which this phase touches, but not the REAL canonical
// Hybrid Orbit identity the C3-COMMERCIAL-BRAND-RENDERING phase already
// fixed for the PDF attachment. Rather than changing emailLayout()'s own
// header for every one of those unrelated surfaces (a repo-wide
// shared-brand change this phase is explicitly not authorized to make),
// this is a small, self-contained duplicate of that same shell with
// ONLY the header cell's content swapped for a real <img> of the exact
// canonical asset — every other structural element (outer table, body
// cell, copyright footer row) is unchanged from emailLayout()'s own
// shape, for visual consistency with the rest of the Brainbase email
// family.
//
// Uses an absolute same-origin URL (BASE_URL, the exact constant
// lib/events/ticketEmail.ts's own ticket links already use), not a
// third-party image host and not an inline base64 data: URI — a linked
// image is the standard, most broadly email-client-compatible way to
// reference a logo in transactional email, and this asset is already
// confirmed publicly reachable at this exact path (verified in
// C3-BRAND-MERGE-VERIFY's runtime health check).
function commercialEmailLayout(body: string): string {
  const logoUrl = `${BASE_URL}/Brand/brainbase-horizontal-color-284.png`;
  // 1600x284 source raster — width chosen for a typical email header,
  // height computed to preserve that exact aspect ratio (never a fixed
  // guess that could distort the lockup).
  const logoWidth = 180;
  const logoHeight = Math.round((logoWidth * 284) / 1600);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="padding:24px 32px;background:#08090C;border-bottom:1px solid #1c1c2e">
          <img src="${logoUrl}" alt="BrainBase" width="${logoWidth}" height="${logoHeight}" style="display:block;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="padding:36px 32px">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#aaa">
          © ${new Date().getFullYear()} Brainbase · Adelaide SA Australia
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function emailDetailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:7px 0;color:#888;width:120px;vertical-align:top;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${label}</td>
      <td style="padding:7px 0 7px 16px;color:#222;border-bottom:1px solid #f0f0f0">${value}</td>
    </tr>
  `;
}

export type QuoteEmailSendResult =
  | { result: 'sent'; providerMessageId: string | null }
  | { result: 'failed'; error: string }
  | { result: 'unknown'; error: string }
  | { result: 'not_configured' };

export async function sendQuoteEmail(params: {
  to: string;
  quote: QuotePdfQuote;
  lines: QuotePdfLine[];
  supplier: QuotePdfSupplier;
}): Promise<QuoteEmailSendResult> {
  const { quote, lines, supplier } = params;
  if (!quote.quote_number) {
    // Structurally unreachable via the API route (a quote must be
    // issued — and therefore numbered — before send-email is callable),
    // kept as a defensive guard rather than a silent `?? 'DRAFT'` that
    // could email a customer a document that looks unissued.
    return { result: 'failed', error: 'Quote has not been issued yet.' };
  }

  // Phase C3-EMAIL-FIX §4 — rendering (loading the brand asset, building
  // the PDF, building the email HTML) is now its own try/catch, entirely
  // separate from the provider-communication try/catch below. This is
  // the fix for the bug that phase's own smoke test caught: previously,
  // an exception thrown here (e.g. a template/date-formatting bug) ran
  // OUTSIDE any try/catch in this function, so it propagated up through
  // sendQuoteEmail() uncaught, out of the API route (which has no
  // try/catch of its own around its `await sendQuoteEmail(...)` call),
  // surfacing as an unhandled 500 instead of this function's own
  // established structured result shape.
  //
  // A rendering failure is classified as 'failed', not 'unknown' — this
  // is a DEFINITE, deterministic outcome (the provider was never even
  // contacted, so there is zero ambiguity about whether an email went
  // out), unlike the 'unknown' case below which specifically means "the
  // provider call itself had an ambiguous network-level outcome." The
  // caught error is logged server-side only (console.error) — the
  // string returned to the caller is a fixed, generic message, never
  // the error's own message/stack, so a future rendering bug can never
  // leak an internal detail (a file path, a stack trace, a snapshot
  // field value) into a caller-visible error, audit log, or API response.
  let pdfBase64: string;
  let subject: string;
  let html: string;
  try {
    const brandLockupBase64 = await loadBrandLockupBase64Server();
    const pdfBytes = await buildQuotePdf({ quote, lines, supplier, brandLockupBase64 });
    pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    ({ subject, html } = buildQuoteEmail({
      quoteNumber: quote.quote_number,
      customerName: quote.customer_name_snapshot ?? 'there',
      totalCents: quote.total_cents,
      currency: quote.currency,
      expiryDate: quote.expiry_date,
      businessDisplayName: supplier.displayName,
      businessEmail: supplier.email,
      businessPhone: supplier.phone,
    }));
  } catch (err) {
    console.error('[commercial] quote email: rendering failed (PDF/template build)', err);
    return { result: 'failed', error: 'The quote document could not be prepared for sending.' };
  }

  try {
    const sent = await sendEmail({
      to: params.to,
      subject,
      html,
      attachments: [{ filename: `${quote.quote_number}.pdf`, contentBase64: pdfBase64 }],
    });
    if (sent.status === 'not_configured') return { result: 'not_configured' };
    return { result: 'sent', providerMessageId: sent.id };
  } catch (err) {
    if (err instanceof Error && err.message === 'Email send failed') {
      return { result: 'failed', error: 'The email provider rejected the request.' };
    }
    console.error('[commercial] quote email: ambiguous provider outcome', err);
    return { result: 'unknown', error: 'The email provider did not return a definite result.' };
  }
}

// Phase C3-POLISH-R §9 — audit_logs never stores the full recipient
// address, matching lib/events/ticketEmail.ts's maskEmailForAudit()
// exactly (duplicated rather than imported cross-module — Events and
// Commercial are kept independent, matching this codebase's established
// per-vertical-not-shared-utility precedent already documented in
// lib/commercial/auditLog.ts's own header).
export function maskEmailForAudit(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
