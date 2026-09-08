import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getInvoiceWithLines } from '@/lib/commercial/invoices';
import { getQuote } from '@/lib/commercial/quotes';
import { getBusinessProfile } from '@/lib/commercial/businessProfile';
import { sendInvoiceEmail } from '@/lib/commercial/invoiceEmail';
import { maskEmailForAudit } from '@/lib/commercial/documentEmail';
import { logInvoiceEmailSent } from '@/lib/commercial/auditLog';
import { recordInvoiceDeliveryAttempt, secondsSinceLastAttempt } from '@/lib/commercial/documentDeliveries';
import type { InvoicePdfSupplier } from '@/lib/commercial/invoicePdf';

type Ctx = { params: Promise<{ id: string }> };

const COOLDOWN_SECONDS = 60;

// POST — Phase C4.3B. Sends (or resends) the issued invoice's PDF to
// the customer's ISSUED snapshot email address — deliberately
// invoice.email_snapshot, never a live lookup of the customer's current
// billing_email, mirroring app/api/commercial/quotes/[id]/send-email/route.ts's
// own identical §15-derived requirement exactly. manager+
// (COMMERCIAL_MIN_ROLE.createEdit) — same floor as quotes' own
// issue/send/resend actions, and this one route serves both first-send
// and resend (no separate "resend" endpoint).
//
// Deliberately decoupled from issueInvoice()/voidInvoice()
// (lib/commercial/invoices.ts): this route contains NO SQL statement
// that touches commercial_invoices at all — a transient email-provider
// failure here can never roll back or corrupt an already-issued
// invoice, and resending can never reissue, renumber, or otherwise
// mutate the invoice's own snapshots/totals/status.
//
// ISSUED-only (stricter than quotes' own DRAFT-only gate): quotes have
// no VOID status to worry about, but an invoice does — a VOID invoice
// must never be (re)sent, so the gate below rejects anything that is
// not exactly ISSUED, not merely anything that is DRAFT.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: invoiceId } = await params;

  // Same explicit, honest SMS rejection as the quote route — the
  // domain model accepts a channel, but only EMAIL transport exists.
  const body = await req.json().catch(() => ({}));
  const channel: string = body?.channel === 'SMS' ? 'SMS' : 'EMAIL';
  if (channel === 'SMS') {
    return NextResponse.json({ error: 'SMS delivery is not yet available.' }, { status: 400 });
  }

  const bundle = await getInvoiceWithLines(session.organisationId, invoiceId);
  if (!bundle) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { invoice, lines } = bundle;

  // ISSUED only — rejects both DRAFT and VOID with the same 409 shape.
  if (invoice.status !== 'ISSUED') {
    const reason = invoice.status === 'DRAFT' ? 'Issue this invoice before sending it.' : 'A voided invoice cannot be sent.';
    return NextResponse.json({ error: reason }, { status: 409 });
  }
  const recipient = invoice.email_snapshot;
  if (!recipient) {
    return NextResponse.json({ error: 'This invoice has no customer email on file (captured at issue time). Add an email to the customer and re-issue, or contact them another way.' }, { status: 409 });
  }

  // Cooldown: identical 60s-per-document+channel semantics to the quote
  // route, backed by the same commercial_document_deliveries table.
  const secondsSince = await secondsSinceLastAttempt({ organisationId: session.organisationId, documentType: 'invoice', documentId: invoiceId, channel: 'EMAIL' });
  if (secondsSince !== null && secondsSince < COOLDOWN_SECONDS) {
    return NextResponse.json(
      { error: 'This invoice was already sent recently. Please wait before trying again.', retry_after_seconds: COOLDOWN_SECONDS - secondsSince },
      { status: 429 },
    );
  }

  const businessProfile = await getBusinessProfile(session.organisationId);
  const supplier: InvoicePdfSupplier = {
    displayName: businessProfile?.profile.tradingName ?? businessProfile?.organisationName ?? 'BRΛINBΛSE',
    address: businessProfile?.profile.address ?? null,
    email: businessProfile?.profile.email ?? null,
    phone: businessProfile?.profile.phone ?? null,
    abn: businessProfile?.profile.abn ?? null,
  };

  let sourceQuoteNumber: string | null = null;
  if (invoice.source_quote_id) {
    const quote = await getQuote(session.organisationId, invoice.source_quote_id);
    sourceQuoteNumber = quote?.quote_number ?? null;
  }

  const recipientMasked = maskEmailForAudit(recipient);

  const sendResult = await sendInvoiceEmail({
    to: recipient,
    invoice: { ...invoice, source_quote_number: sourceQuoteNumber },
    lines,
    supplier,
  });

  if (sendResult.result === 'not_configured') {
    await recordInvoiceDeliveryAttempt({
      organisationId: session.organisationId, invoice, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: 'Email sending is not configured for this environment.', createdBy: session.userId,
    }).catch(err => console.error('[commercial] invoice delivery record failed after not_configured outcome', err, { invoiceId }));
    await logInvoiceEmailSent({ organisationId: session.organisationId, userId: session.userId, invoiceId, result: 'not_configured', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] invoice-email audit write failed after not_configured outcome', err, { invoiceId }));
    return NextResponse.json({ ok: false, result: 'not_configured', error: 'Email sending is not configured for this environment.' }, { status: 503 });
  }

  if (sendResult.result === 'failed') {
    await recordInvoiceDeliveryAttempt({
      organisationId: session.organisationId, invoice, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: sendResult.error, createdBy: session.userId,
    }).catch(err => console.error('[commercial] invoice delivery record failed after provider failure', err, { invoiceId }));
    await logInvoiceEmailSent({ organisationId: session.organisationId, userId: session.userId, invoiceId, result: 'failed', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] invoice-email audit write failed after provider failure', err, { invoiceId }));
    return NextResponse.json({ ok: false, result: 'failed', error: 'The email could not be sent. Please try again.' }, { status: 502 });
  }

  if (sendResult.result === 'unknown') {
    await recordInvoiceDeliveryAttempt({
      organisationId: session.organisationId, invoice, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: 'Provider did not return a definite result.', createdBy: session.userId,
    }).catch(err => console.error('[commercial] invoice delivery record failed after unknown outcome', err, { invoiceId }));
    await logInvoiceEmailSent({ organisationId: session.organisationId, userId: session.userId, invoiceId, result: 'unknown', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] invoice-email audit write failed after unknown outcome', err, { invoiceId }));
    return NextResponse.json({ ok: false, result: 'unknown', error: 'Delivery status unknown — do not immediately resend.' }, { status: 504 });
  }

  // sendResult.result === 'sent' — provider accepted the send. Record
  // the delivery row FIRST (this route's own primary, dedicated
  // delivery-history record), then the audit_logs entry — same ordering
  // as the quote route.
  await recordInvoiceDeliveryAttempt({
    organisationId: session.organisationId, invoice, channel: 'EMAIL', recipient,
    status: 'SENT', provider: 'resend', providerMessageId: sendResult.providerMessageId, createdBy: session.userId,
  }).catch(err => console.error('[commercial] CRITICAL: invoice email sent but delivery record failed', err, { invoiceId }));

  try {
    await logInvoiceEmailSent({ organisationId: session.organisationId, userId: session.userId, invoiceId, result: 'sent', recipientMasked, providerMessageId: sendResult.providerMessageId });
  } catch (err) {
    console.error('[commercial] CRITICAL: invoice email sent but audit write failed', err, { invoiceId });
    return NextResponse.json(
      { ok: false, result: 'sent_audit_failed', error: 'The email may have been sent, but BrainBase could not record the send. Do not immediately resend.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, result: 'sent' });
}
