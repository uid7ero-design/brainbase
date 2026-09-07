import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getQuoteWithLines } from '@/lib/commercial/quotes';
import { getBusinessProfile } from '@/lib/commercial/businessProfile';
import { sendQuoteEmail, maskEmailForAudit } from '@/lib/commercial/quoteEmail';
import { logQuoteEmailSent } from '@/lib/commercial/auditLog';
import { recordDeliveryAttempt, secondsSinceLastAttempt } from '@/lib/commercial/documentDeliveries';
import type { QuotePdfSupplier } from '@/lib/commercial/quotePdf';

type Ctx = { params: Promise<{ id: string }> };

const COOLDOWN_SECONDS = 60;

// POST — Phase C3-POLISH-R §6/§7/§9/§13. Sends (or resends) the issued
// quote's PDF to the customer's ISSUED snapshot email address —
// deliberately quote.email_snapshot, never a live lookup of the
// customer's current billing_email (§15's own explicit regression
// requirement: "email resend uses the issued snapshot, NOT current
// customer/product values"). manager+ (COMMERCIAL_MIN_ROLE.createEdit),
// matching the brief's §12 "issue/send: manager + quotes" /
// "resend: manager + quotes" — the SAME floor for both, since this one
// route serves both first-send and resend (there is no separate
// "resend" endpoint to give a different role to).
//
// Deliberately decoupled from issueQuote() (lib/commercial/quotes.ts):
// issuing a quote (assigning its number, locking its snapshots) and
// emailing it are two independent actions, so a transient email-provider
// failure here can NEVER roll back or corrupt an already-issued quote —
// there is nothing in this route that touches commercial_quotes at all.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: quoteId } = await params;

  // §10 — the domain model accepts a channel, but only EMAIL transport
  // exists. Never silently substitutes EMAIL for a requested SMS send —
  // an explicit, honest rejection instead.
  const body = await req.json().catch(() => ({}));
  const channel: string = body?.channel === 'SMS' ? 'SMS' : 'EMAIL';
  if (channel === 'SMS') {
    return NextResponse.json({ error: 'SMS delivery is not yet available.' }, { status: 400 });
  }

  const bundle = await getQuoteWithLines(session.organisationId, quoteId);
  if (!bundle) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { quote, lines } = bundle;

  if (quote.status === 'DRAFT') {
    return NextResponse.json({ error: 'Issue this quote before sending it.' }, { status: 409 });
  }
  const recipient = quote.email_snapshot;
  if (!recipient) {
    return NextResponse.json({ error: 'This quote has no customer email on file (captured at issue time). Add an email to the customer and re-issue, or contact them another way.' }, { status: 409 });
  }

  // Cooldown (§13): 60 seconds per quote+channel, counting every prior
  // attempt regardless of outcome — same semantics as
  // app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts's
  // own cooldown, backed here by commercial_document_deliveries instead
  // of audit_logs (this table's own attempted_at is the source of
  // truth for "when did we last try").
  const secondsSince = await secondsSinceLastAttempt({ organisationId: session.organisationId, documentType: 'quote', documentId: quoteId, channel: 'EMAIL' });
  if (secondsSince !== null && secondsSince < COOLDOWN_SECONDS) {
    return NextResponse.json(
      { error: 'This quote was already sent recently. Please wait before trying again.', retry_after_seconds: COOLDOWN_SECONDS - secondsSince },
      { status: 429 },
    );
  }

  const businessProfile = await getBusinessProfile(session.organisationId);
  const supplier: QuotePdfSupplier = {
    displayName: businessProfile?.profile.tradingName ?? businessProfile?.organisationName ?? 'BRΛINBΛSE',
    address: businessProfile?.profile.address ?? null,
    email: businessProfile?.profile.email ?? null,
    phone: businessProfile?.profile.phone ?? null,
    abn: businessProfile?.profile.abn ?? null,
  };
  const recipientMasked = maskEmailForAudit(recipient);

  const sendResult = await sendQuoteEmail({ to: recipient, quote, lines, supplier });

  if (sendResult.result === 'not_configured') {
    await recordDeliveryAttempt({
      organisationId: session.organisationId, documentType: 'quote', documentId: quoteId, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: 'Email sending is not configured for this environment.', createdBy: session.userId,
    }).catch(err => console.error('[commercial] quote delivery record failed after not_configured outcome', err, { quoteId }));
    await logQuoteEmailSent({ organisationId: session.organisationId, userId: session.userId, quoteId, result: 'not_configured', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] quote-email audit write failed after not_configured outcome', err, { quoteId }));
    return NextResponse.json({ ok: false, result: 'not_configured', error: 'Email sending is not configured for this environment.' }, { status: 503 });
  }

  if (sendResult.result === 'failed') {
    await recordDeliveryAttempt({
      organisationId: session.organisationId, documentType: 'quote', documentId: quoteId, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: sendResult.error, createdBy: session.userId,
    }).catch(err => console.error('[commercial] quote delivery record failed after provider failure', err, { quoteId }));
    await logQuoteEmailSent({ organisationId: session.organisationId, userId: session.userId, quoteId, result: 'failed', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] quote-email audit write failed after provider failure', err, { quoteId }));
    return NextResponse.json({ ok: false, result: 'failed', error: 'The email could not be sent. Please try again.' }, { status: 502 });
  }

  if (sendResult.result === 'unknown') {
    await recordDeliveryAttempt({
      organisationId: session.organisationId, documentType: 'quote', documentId: quoteId, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: 'Provider did not return a definite result.', createdBy: session.userId,
    }).catch(err => console.error('[commercial] quote delivery record failed after unknown outcome', err, { quoteId }));
    await logQuoteEmailSent({ organisationId: session.organisationId, userId: session.userId, quoteId, result: 'unknown', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] quote-email audit write failed after unknown outcome', err, { quoteId }));
    return NextResponse.json({ ok: false, result: 'unknown', error: 'Delivery status unknown — do not immediately resend.' }, { status: 504 });
  }

  // sendResult.result === 'sent' — provider accepted the send. Record
  // the delivery row FIRST (it is this route's own primary, dedicated
  // delivery-history record — §8), then the audit_logs entry. If the
  // delivery-row write itself fails, that is caught by its own
  // .catch() below the same way the resend-ticket-email precedent
  // handles the equivalent case, but note the API response still
  // reflects the true outcome for the audit-write failure below.
  await recordDeliveryAttempt({
    organisationId: session.organisationId, documentType: 'quote', documentId: quoteId, channel: 'EMAIL', recipient,
    status: 'SENT', provider: 'resend', providerMessageId: sendResult.providerMessageId, createdBy: session.userId,
  }).catch(err => console.error('[commercial] CRITICAL: quote email sent but delivery record failed', err, { quoteId }));

  try {
    await logQuoteEmailSent({ organisationId: session.organisationId, userId: session.userId, quoteId, result: 'sent', recipientMasked, providerMessageId: sendResult.providerMessageId });
  } catch (err) {
    console.error('[commercial] CRITICAL: quote email sent but audit write failed', err, { quoteId });
    return NextResponse.json(
      { ok: false, result: 'sent_audit_failed', error: 'The email may have been sent, but BrainBase could not record the send. Do not immediately resend.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, result: 'sent' });
}
