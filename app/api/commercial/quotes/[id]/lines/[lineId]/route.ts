import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { updateQuoteLine, deleteQuoteLine } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  const body = await req.json();
  const { description, quantity, unitPriceCents, taxCodeId, position } = body;

  try {
    const line = await updateQuoteLine({
      organisationId: auth.session.organisationId,
      quoteId: id,
      lineId,
      description,
      quantity: quantity === undefined ? undefined : Number(quantity),
      unitPriceCents: unitPriceCents === undefined ? undefined : Number(unitPriceCents),
      taxCodeId,
      position: position === undefined ? undefined : Number(position),
    });
    if (!line) return NextResponse.json({ error: 'Not found, or quote no longer a draft.' }, { status: 404 });
    return NextResponse.json({ line });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update line.' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  try {
    const ok = await deleteQuoteLine({ organisationId: auth.session.organisationId, quoteId: id, lineId });
    if (!ok) return NextResponse.json({ error: 'Not found, or quote no longer a draft.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete line.' }, { status: 400 });
  }
}
