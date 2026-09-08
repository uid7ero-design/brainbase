import 'server-only';
import { sendEmail, escHtml } from '@/lib/email';
import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';
import { buildQuotePdf, type QuotePdfQuote, type QuotePdfLine, type QuotePdfSupplier } from './quotePdf';
import { commercialEmailLayout, emailDetailRow, loadBrandLockupBase64Server } from './documentEmail';

// Phase C3-POLISH-R §6/§7 — quote email delivery. Modeled directly on
// lib/events/ticketEmail.ts's own shape (buildX() pure template kept
// separate from sendX() provider side effect; the same
// sent/failed/unknown/not_configured result taxonomy) — that module's
// own header comment explains exactly why each outcome is distinguished,
// and the same reasoning applies verbatim here, so it is not repeated.
//
// Phase C4.3B — the shared email shell (commercialEmailLayout,
// emailDetailRow, loadBrandLockupBase64Server, maskEmailForAudit) moved
// out to lib/commercial/documentEmail.ts, unchanged, so
// lib/commercial/invoiceEmail.ts can reuse it. Pure extraction: every
// function body is byte-identical to before, just re-exported from a
// shared module. Re-exported here too so any existing external import
// of maskEmailForAudit from this file keeps working.
export { maskEmailForAudit } from './documentEmail';

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
