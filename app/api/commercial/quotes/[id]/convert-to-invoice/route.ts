import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { createInvoiceFromQuote } from '@/lib/commercial/invoices';

type Ctx = { params: Promise<{ id: string }> };

// Phase C4.2 §9 — gated on 'invoicing' ONLY, deliberately not
// 'quotes' as well. createInvoiceFromQuote() (lib/commercial/invoices.ts)
// resolves the source quote itself via getQuoteWithLines(organisationId,
// quoteId) — already tenant-scoped, requiring no prior Quotes-capability
// read from this route or its caller. This route never returns general
// quote data (no quote list, no quote detail fields beyond what the
// created invoice itself already carries as its own snapshot) — it
// accepts a quoteId and returns a DRAFT invoice id, nothing more. An
// organisation entitled to Invoicing but NOT Quotes can therefore convert
// a specific quote it already somehow has the id for (e.g. shared by a
// colleague) into an invoice, without gaining any ability to browse or
// list quotes generally — the Commercial layout/quote list/quote detail
// routes remain separately gated on 'quotes' and are completely
// unaffected by this route's own gate. Requiring 'quotes' here in
// addition would incorrectly conflate "may read this one quote's data
// for conversion purposes" with "may browse Quotes as a feature" — two
// different entitlements this codebase already treats as independent
// (see lib/commercial/authorize.ts's own CommercialCapabilityKey union
// and the C4.0 architecture report's explicit rationale for keeping
// 'quotes'/'invoicing' separate keys).
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const invoice = await createInvoiceFromQuote({ organisationId: auth.session.organisationId, userId: auth.session.userId, quoteId: id });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create invoice from quote.';
    if (message.includes('quote not found')) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
