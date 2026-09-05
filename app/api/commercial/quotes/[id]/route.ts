import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getQuoteWithLines, updateDraftQuote, deleteDraftQuote } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const bundle = await getQuoteWithLines(auth.session.organisationId, id);
  if (!bundle) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json(bundle);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json();
  const { customerId, notes, terms, expiryDate } = body;

  try {
    const quote = await updateDraftQuote({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      quoteId: id,
      customerId,
      notes,
      terms,
      expiryDate,
    });
    if (!quote) return NextResponse.json({ error: 'Not found, or no longer a draft.' }, { status: 404 });
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update quote.' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const ok = await deleteDraftQuote({ organisationId: auth.session.organisationId, userId: auth.session.userId, quoteId: id });
  if (!ok) return NextResponse.json({ error: 'Not found, or no longer a draft.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
