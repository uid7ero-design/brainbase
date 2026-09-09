import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getInvoiceWithLines, updateDraftInvoice, deleteDraftInvoice } from '@/lib/commercial/invoices';
import { getQuote } from '@/lib/commercial/quotes';
import { listDeliveriesForDocument } from '@/lib/commercial/documentDeliveries';
import { getInvoicePaymentSummary } from '@/lib/commercial/payments';

type Ctx = { params: Promise<{ id: string }> };

// Phase C4.2 — mirrors app/api/commercial/quotes/[id]/route.ts's shape.
// `sourceQuoteNumber` is a small, additive READ composition (not domain
// logic duplication) so the UI can render a friendly lineage link without
// a second client round trip — exactly the same pattern the quote detail
// route already uses to fold in delivery history alongside the quote
// itself.
//
// Phase C4.2 blocker fix — `overdue` is NO LONGER computed here. It was
// previously derived in this route by comparing due_date against a
// today's-calendar-date string built from the current instant in the
// server's own JS runtime, which silently coerced to `NaN` and was
// always `false` in production: getInvoiceWithLines()'s underlying
// driver parses a Postgres DATE column into a native JS Date object when
// read in-process (see lib/commercial/dates.ts's own documented,
// empirically-verified finding), and relationally comparing a Date
// object against a plain calendar-date string never behaves as a real
// date comparison. `getInvoice()` (lib/commercial/invoices.ts) now
// computes this in SQL via CURRENT_DATE instead — this route simply
// forwards that already-correct, already-boolean value; never recomputes
// it and never derives "today" in JavaScript at all.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const bundle = await getInvoiceWithLines(auth.session.organisationId, id);
  if (!bundle) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let sourceQuoteNumber: string | null = null;
  if (bundle.invoice.source_quote_id) {
    const quote = await getQuote(auth.session.organisationId, bundle.invoice.source_quote_id);
    sourceQuoteNumber = quote?.quote_number ?? null;
  }

  // Phase C4.3B — folded in the same way the quote detail route already
  // folds in its own delivery history (app/api/commercial/quotes/[id]/route.ts),
  // so the invoice detail page's existing single load() call gets it for
  // free rather than a second round trip.
  const deliveries = await listDeliveriesForDocument({ organisationId: auth.session.organisationId, documentType: 'invoice', documentId: id });

  // Phase C5.2 — folded in the same additive-read-composition way as
  // sourceQuoteNumber/deliveries above: derived at read time, never
  // stored on the invoice row itself (see getInvoicePaymentSummary()'s
  // own header for why).
  const paymentSummary = await getInvoicePaymentSummary(auth.session.organisationId, id, bundle.invoice.total_cents);

  return NextResponse.json({
    ...bundle, sourceQuoteNumber, overdue: bundle.invoice.overdue, deliveries,
    amount_paid_cents: paymentSummary.amount_paid_cents,
    outstanding_balance_cents: paymentSummary.outstanding_balance_cents,
    payment_state: paymentSummary.payment_state,
    payments: paymentSummary.payments,
  });
}

// DRAFT-only via domain enforcement (updateDraftInvoice() itself asserts
// editability and returns null for a non-draft/missing/wrong-tenant row —
// this route never bypasses that with raw SQL). Only draft-editable
// fields are read from the body; invoice_number/status/snapshots/issued
// metadata/totals are never accepted (updateDraftInvoice() has no
// parameter for any of them).
export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { customerId, notes, terms, dueDate, paymentTermsDays } = body;

  try {
    const invoice = await updateDraftInvoice({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      invoiceId: id,
      customerId,
      notes,
      terms,
      dueDate,
      paymentTermsDays: paymentTermsDays === undefined ? undefined : (paymentTermsDays === null ? null : Number(paymentTermsDays)),
    });
    if (!invoice) return NextResponse.json({ error: 'Not found, or no longer a draft.' }, { status: 404 });
    return NextResponse.json({ invoice });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update invoice.' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const ok = await deleteDraftInvoice({ organisationId: auth.session.organisationId, userId: auth.session.userId, invoiceId: id });
  if (!ok) return NextResponse.json({ error: 'Not found, or no longer a draft.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
