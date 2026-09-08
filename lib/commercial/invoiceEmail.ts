import 'server-only';
import { sendEmail, escHtml } from '@/lib/email';
import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';
import { buildInvoicePdf, type InvoicePdfInvoice, type InvoicePdfLine, type InvoicePdfSupplier } from './invoicePdf';
import { commercialEmailLayout, emailDetailRow, loadBrandLockupBase64Server } from './documentEmail';

// Phase C4.3B — invoice email delivery. Structurally mirrors
// lib/commercial/quoteEmail.ts's sendQuoteEmail() exactly (same
// sent/failed/unknown/not_configured result taxonomy, same
// rendering-try/catch-separate-from-provider-try/catch discipline) —
// that file's own header comment explains why each outcome is
// distinguished; the same reasoning applies verbatim here.

export interface InvoiceEmailData {
  invoiceNumber: string;
  customerName: string;
  totalCents: number;
  currency: string;
  dueDate: string | Date | null;
  businessDisplayName: string;
  businessEmail: string | null;
  businessPhone: string | null;
}

export function buildInvoiceEmail(data: InvoiceEmailData): { subject: string; html: string } {
  const due = formatCommercialDate(data.dueDate);
  return {
    subject: `Invoice ${data.invoiceNumber} from ${data.businessDisplayName}`,
    html: commercialEmailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(data.customerName)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Please find attached your invoice from <strong>${escHtml(data.businessDisplayName)}</strong>.
        The details are summarised below.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px">
        ${emailDetailRow('Invoice number', escHtml(data.invoiceNumber))}
        ${emailDetailRow('Total', formatMoneyCents(data.totalCents, data.currency))}
        ${data.dueDate ? emailDetailRow('Due date', due) : ''}
      </table>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        If you have any questions about this invoice, please reply to this email${data.businessPhone ? ` or call us on ${escHtml(data.businessPhone)}` : ''}.
      </p>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        Sent by ${escHtml(data.businessDisplayName)}${data.businessEmail ? ` · ${escHtml(data.businessEmail)}` : ''} via BrainBase Commercial.
      </p>
    `),
  };
}

export type InvoiceEmailSendResult =
  | { result: 'sent'; providerMessageId: string | null }
  | { result: 'failed'; error: string }
  | { result: 'unknown'; error: string }
  | { result: 'not_configured' };

export async function sendInvoiceEmail(params: {
  to: string;
  invoice: InvoicePdfInvoice;
  lines: InvoicePdfLine[];
  supplier: InvoicePdfSupplier;
}): Promise<InvoiceEmailSendResult> {
  const { invoice, lines, supplier } = params;
  if (invoice.status !== 'ISSUED') {
    // Structurally unreachable via the API route (the send-email route
    // itself rejects anything but ISSUED before ever calling this
    // function), kept as a defensive guard rather than trusting the
    // caller — mirrors quoteEmail.ts's own identical guard.
    return { result: 'failed', error: 'Invoice is not in a sendable state.' };
  }
  if (!invoice.invoice_number) {
    return { result: 'failed', error: 'Invoice has not been issued yet.' };
  }

  // Rendering (brand asset + PDF + email template) is its own try/catch,
  // entirely separate from the provider-communication try/catch below —
  // same fix quoteEmail.ts already applies, for the identical reason: a
  // template/date-formatting bug here must classify as a DEFINITE
  // 'failed' outcome (the provider was never contacted), never leak as
  // an unhandled 500, and never expose the real error's own
  // message/stack to the caller — only a fixed, generic string, with
  // the real error logged server-side only.
  let pdfBase64: string;
  let subject: string;
  let html: string;
  try {
    const brandLockupBase64 = await loadBrandLockupBase64Server();
    const pdfBytes = await buildInvoicePdf({ invoice, lines, supplier, brandLockupBase64 });
    pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    ({ subject, html } = buildInvoiceEmail({
      invoiceNumber: invoice.invoice_number,
      customerName: invoice.customer_name_snapshot ?? 'there',
      totalCents: invoice.total_cents,
      currency: invoice.currency,
      dueDate: invoice.due_date,
      businessDisplayName: supplier.displayName,
      businessEmail: supplier.email,
      businessPhone: supplier.phone,
    }));
  } catch (err) {
    console.error('[commercial] invoice email: rendering failed (PDF/template build)', err);
    return { result: 'failed', error: 'The invoice document could not be prepared for sending.' };
  }

  try {
    const sent = await sendEmail({
      to: params.to,
      subject,
      html,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, contentBase64: pdfBase64 }],
    });
    if (sent.status === 'not_configured') return { result: 'not_configured' };
    return { result: 'sent', providerMessageId: sent.id };
  } catch (err) {
    if (err instanceof Error && err.message === 'Email send failed') {
      return { result: 'failed', error: 'The email provider rejected the request.' };
    }
    console.error('[commercial] invoice email: ambiguous provider outcome', err);
    return { result: 'unknown', error: 'The email provider did not return a definite result.' };
  }
}
