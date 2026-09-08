import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getInvoiceWithLines, updateDraftInvoice, deleteDraftInvoice } from '@/lib/commercial/invoices';
import { getQuote } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

// Phase C4.2 — mirrors app/api/commercial/quotes/[id]/route.ts's shape.
// `sourceQuoteNumber` is a small, additive READ composition (not domain
// logic duplication) so the UI can render a friendly lineage link without
// a second client round trip — exactly the same pattern the quote detail
// route already uses to fold in delivery history alongside the quote
// itself. `overdue` is computed HERE, in the route, from already-fetched
// fields (status/due_date) — never persisted, never written back;
// lib/commercial/invoices.ts has no OVERDUE column or write path at all.
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

  const overdue = bundle.invoice.status === 'ISSUED' && !!bundle.invoice.due_date && bundle.invoice.due_date < new Date().toISOString().slice(0, 10);

  return NextResponse.json({ ...bundle, sourceQuoteNumber, overdue });
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
