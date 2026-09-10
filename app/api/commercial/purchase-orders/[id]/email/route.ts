import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrderWithLines } from '@/lib/commercial/purchaseOrders';
import { getBusinessProfile } from '@/lib/commercial/businessProfile';
import { sendPurchaseOrderEmail } from '@/lib/commercial/purchaseOrderEmail';
import { maskEmailForAudit } from '@/lib/commercial/documentEmail';
import { logPurchaseOrderEmailSent } from '@/lib/commercial/auditLog';
import { recordPurchaseOrderDeliveryAttempt, secondsSinceLastAttempt } from '@/lib/commercial/documentDeliveries';
import type { PurchaseOrderPdfBuyer } from '@/lib/commercial/purchaseOrderPdf';

type Ctx = { params: Promise<{ id: string }> };

const COOLDOWN_SECONDS = 60;

// POST — Phase C6.5. Sends the issued purchase order's PDF to the
// SUPPLIER's ISSUED snapshot email address — deliberately
// purchaseOrder.supplier_email_snapshot, never a live lookup of the
// supplier's current email, mirroring
// app/api/commercial/invoices/[id]/send-email/route.ts's own identical
// requirement exactly (and this gate's own explicit instruction: "not
// current mutable supplier master email... do not silently pick CRM
// contact email" — there is no CRM link concept on a supplier at all,
// so this is a non-issue in practice, but the snapshot-only rule is
// enforced the same way regardless).
//
// Role floor: 'createEdit' (manager+) — matching the actual established
// quote/invoice document-send convention exactly (both
// send-email routes use COMMERCIAL_MIN_ROLE.createEdit, not .approve).
//
// ISSUED-only: a CANCELLED purchase order must never be sent as if it
// were an active order to fulfil — resending a cancellation notice is
// explicitly out of scope for this gate (a separate later feature, per
// this gate's own Section I).
//
// Deliberately decoupled from any lifecycle-mutating function
// (submitPurchaseOrder/approvePurchaseOrder/issuePurchaseOrder/
// cancelPurchaseOrder): this route contains no SQL statement that
// touches commercial_purchase_orders at all — a transient email-provider
// failure here can never roll back or corrupt an already-issued PO, and
// resending can never reissue, renumber, or otherwise mutate its
// snapshots/totals/status.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: purchaseOrderId } = await params;

  // Same explicit, honest SMS rejection as the quote/invoice routes —
  // the delivery model accepts a channel, but only EMAIL transport
  // exists.
  const body = await req.json().catch(() => ({}));
  const channel: string = body?.channel === 'SMS' ? 'SMS' : 'EMAIL';
  if (channel === 'SMS') {
    return NextResponse.json({ error: 'SMS delivery is not yet available.' }, { status: 400 });
  }

  const bundle = await getPurchaseOrderWithLines(session.organisationId, purchaseOrderId);
  if (!bundle) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { purchaseOrder, lines } = bundle;

  if (purchaseOrder.status !== 'ISSUED') {
    const reason = purchaseOrder.status === 'CANCELLED'
      ? 'A cancelled purchase order cannot be sent as an active order.'
      : 'Issue this purchase order before sending it.';
    return NextResponse.json({ error: reason }, { status: 409 });
  }
  const recipient = purchaseOrder.supplier_email_snapshot;
  if (!recipient) {
    return NextResponse.json({ error: 'This purchase order has no supplier email on file (captured at issue time). Add an email to the supplier and contact them another way.' }, { status: 409 });
  }

  // Cooldown: identical 60s-per-document+channel semantics to the
  // quote/invoice routes, backed by the same commercial_document_deliveries
  // table.
  const secondsSince = await secondsSinceLastAttempt({ organisationId: session.organisationId, documentType: 'purchase_order', documentId: purchaseOrderId, channel: 'EMAIL' });
  if (secondsSince !== null && secondsSince < COOLDOWN_SECONDS) {
    return NextResponse.json(
      { error: 'This purchase order was already sent recently. Please wait before trying again.', retry_after_seconds: COOLDOWN_SECONDS - secondsSince },
      { status: 429 },
    );
  }

  const businessProfile = await getBusinessProfile(session.organisationId);
  const buyer: PurchaseOrderPdfBuyer = {
    displayName: businessProfile?.profile.tradingName ?? businessProfile?.organisationName ?? 'BRΛINBΛSE',
    address: businessProfile?.profile.address ?? null,
    email: businessProfile?.profile.email ?? null,
    phone: businessProfile?.profile.phone ?? null,
    abn: businessProfile?.profile.abn ?? null,
  };

  const recipientMasked = maskEmailForAudit(recipient);

  const sendResult = await sendPurchaseOrderEmail({
    to: recipient,
    purchaseOrder: { ...purchaseOrder, purchase_order_number: purchaseOrder.purchase_order_number!, status: 'ISSUED' },
    lines,
    buyer,
  });

  if (sendResult.result === 'not_configured') {
    await recordPurchaseOrderDeliveryAttempt({
      organisationId: session.organisationId, purchaseOrder, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: 'Email sending is not configured for this environment.', createdBy: session.userId,
    }).catch(err => console.error('[commercial] purchase order delivery record failed after not_configured outcome', err, { purchaseOrderId }));
    await logPurchaseOrderEmailSent({ organisationId: session.organisationId, userId: session.userId, purchaseOrderId, result: 'not_configured', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] purchase-order-email audit write failed after not_configured outcome', err, { purchaseOrderId }));
    return NextResponse.json({ ok: false, result: 'not_configured', error: 'Email sending is not configured for this environment.' }, { status: 503 });
  }

  if (sendResult.result === 'failed') {
    await recordPurchaseOrderDeliveryAttempt({
      organisationId: session.organisationId, purchaseOrder, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: sendResult.error, createdBy: session.userId,
    }).catch(err => console.error('[commercial] purchase order delivery record failed after provider failure', err, { purchaseOrderId }));
    await logPurchaseOrderEmailSent({ organisationId: session.organisationId, userId: session.userId, purchaseOrderId, result: 'failed', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] purchase-order-email audit write failed after provider failure', err, { purchaseOrderId }));
    return NextResponse.json({ ok: false, result: 'failed', error: 'The email could not be sent. Please try again.' }, { status: 502 });
  }

  if (sendResult.result === 'unknown') {
    await recordPurchaseOrderDeliveryAttempt({
      organisationId: session.organisationId, purchaseOrder, channel: 'EMAIL', recipient,
      status: 'FAILED', provider: 'resend', errorSummary: 'Provider did not return a definite result.', createdBy: session.userId,
    }).catch(err => console.error('[commercial] purchase order delivery record failed after unknown outcome', err, { purchaseOrderId }));
    await logPurchaseOrderEmailSent({ organisationId: session.organisationId, userId: session.userId, purchaseOrderId, result: 'unknown', recipientMasked, providerMessageId: null })
      .catch(err => console.error('[commercial] purchase-order-email audit write failed after unknown outcome', err, { purchaseOrderId }));
    return NextResponse.json({ ok: false, result: 'unknown', error: 'Delivery status unknown — do not immediately resend.' }, { status: 504 });
  }

  // sendResult.result === 'sent' — provider accepted the send. Record
  // the delivery row FIRST (this route's own primary, dedicated
  // delivery-history record), then the audit_logs entry — same ordering
  // as the quote/invoice routes.
  await recordPurchaseOrderDeliveryAttempt({
    organisationId: session.organisationId, purchaseOrder, channel: 'EMAIL', recipient,
    status: 'SENT', provider: 'resend', providerMessageId: sendResult.providerMessageId, createdBy: session.userId,
  }).catch(err => console.error('[commercial] CRITICAL: purchase order email sent but delivery record failed', err, { purchaseOrderId }));

  try {
    await logPurchaseOrderEmailSent({ organisationId: session.organisationId, userId: session.userId, purchaseOrderId, result: 'sent', recipientMasked, providerMessageId: sendResult.providerMessageId });
  } catch (err) {
    console.error('[commercial] CRITICAL: purchase order email sent but audit write failed', err, { purchaseOrderId });
    return NextResponse.json(
      { ok: false, result: 'sent_audit_failed', error: 'The email may have been sent, but BrainBase could not record the send. Do not immediately resend.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, result: 'sent' });
}
