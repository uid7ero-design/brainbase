import 'server-only';
import { sendEmail, escHtml } from '@/lib/email';
import { formatMoneyCents } from './money';
import { formatCommercialDate } from './dates';
import { buildPurchaseOrderPdf, type PurchaseOrderPdfPurchaseOrder, type PurchaseOrderPdfLine, type PurchaseOrderPdfBuyer } from './purchaseOrderPdf';
import { commercialEmailLayout, emailDetailRow, loadBrandLockupBase64Server } from './documentEmail';

// Phase C6.5 — purchase order email delivery. Structurally mirrors
// lib/commercial/invoiceEmail.ts's sendInvoiceEmail() exactly (same
// sent/failed/unknown/not_configured result taxonomy, same
// rendering-try/catch-separate-from-provider-try/catch discipline, same
// reasoning for each) — reproduced here rather than shared, matching
// this codebase's own established per-document-type-module convention.

export interface PurchaseOrderEmailData {
  purchaseOrderNumber: string;
  supplierName: string;
  totalCents: number;
  currency: string;
  deliveryDate: string | Date | null;
  buyerDisplayName: string;
  buyerEmail: string | null;
  buyerPhone: string | null;
}

export function buildPurchaseOrderEmail(data: PurchaseOrderEmailData): { subject: string; html: string } {
  const delivery = formatCommercialDate(data.deliveryDate);
  return {
    subject: `Purchase Order ${data.purchaseOrderNumber} from ${data.buyerDisplayName}`,
    html: commercialEmailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(data.supplierName)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Please find attached purchase order <strong>${escHtml(data.purchaseOrderNumber)}</strong> from
        <strong>${escHtml(data.buyerDisplayName)}</strong>. The details are summarised below.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px">
        ${emailDetailRow('PO number', escHtml(data.purchaseOrderNumber))}
        ${emailDetailRow('Total', formatMoneyCents(data.totalCents, data.currency))}
        ${data.deliveryDate ? emailDetailRow('Delivery date', delivery) : ''}
      </table>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        If you have any questions about this order, please reply to this email${data.buyerPhone ? ` or call us on ${escHtml(data.buyerPhone)}` : ''}.
      </p>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        Sent by ${escHtml(data.buyerDisplayName)}${data.buyerEmail ? ` · ${escHtml(data.buyerEmail)}` : ''} via BrainBase Commercial.
      </p>
    `),
  };
}

export type PurchaseOrderEmailSendResult =
  | { result: 'sent'; providerMessageId: string | null }
  | { result: 'failed'; error: string }
  | { result: 'unknown'; error: string }
  | { result: 'not_configured' };

export async function sendPurchaseOrderEmail(params: {
  to: string;
  purchaseOrder: PurchaseOrderPdfPurchaseOrder;
  lines: PurchaseOrderPdfLine[];
  buyer: PurchaseOrderPdfBuyer;
}): Promise<PurchaseOrderEmailSendResult> {
  const { purchaseOrder, lines, buyer } = params;
  if (purchaseOrder.status !== 'ISSUED') {
    // Structurally unreachable via the API route (the email route
    // itself rejects anything but ISSUED before ever calling this
    // function), kept as a defensive guard rather than trusting the
    // caller — mirrors sendInvoiceEmail()'s own identical guard.
    return { result: 'failed', error: 'Purchase order is not in a sendable state.' };
  }

  // Rendering (brand asset + PDF + email template) is its own try/catch,
  // entirely separate from the provider-communication try/catch below —
  // same fix sendInvoiceEmail()/sendQuoteEmail() already apply, for the
  // identical reason: a template/date-formatting bug here must classify
  // as a DEFINITE 'failed' outcome (the provider was never contacted),
  // never leak as an unhandled 500, and never expose the real error's
  // own message/stack to the caller — only a fixed, generic string, with
  // the real error logged server-side only.
  let pdfBase64: string;
  let subject: string;
  let html: string;
  try {
    const brandLockupBase64 = await loadBrandLockupBase64Server();
    const pdfBytes = await buildPurchaseOrderPdf({ purchaseOrder, lines, buyer, brandLockupBase64 });
    pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    ({ subject, html } = buildPurchaseOrderEmail({
      purchaseOrderNumber: purchaseOrder.purchase_order_number,
      supplierName: purchaseOrder.supplier_contact_name_snapshot ?? purchaseOrder.supplier_name_snapshot ?? 'there',
      totalCents: purchaseOrder.total_cents,
      currency: purchaseOrder.currency,
      deliveryDate: purchaseOrder.delivery_date,
      buyerDisplayName: buyer.displayName,
      buyerEmail: buyer.email,
      buyerPhone: buyer.phone,
    }));
  } catch (err) {
    console.error('[commercial] purchase order email: rendering failed (PDF/template build)', err);
    return { result: 'failed', error: 'The purchase order document could not be prepared for sending.' };
  }

  try {
    const sent = await sendEmail({
      to: params.to,
      subject,
      html,
      attachments: [{ filename: `${purchaseOrder.purchase_order_number}.pdf`, contentBase64: pdfBase64 }],
    });
    if (sent.status === 'not_configured') return { result: 'not_configured' };
    return { result: 'sent', providerMessageId: sent.id };
  } catch (err) {
    if (err instanceof Error && err.message === 'Email send failed') {
      return { result: 'failed', error: 'The email provider rejected the request.' };
    }
    console.error('[commercial] purchase order email: ambiguous provider outcome', err);
    return { result: 'unknown', error: 'The email provider did not return a definite result.' };
  }
}
